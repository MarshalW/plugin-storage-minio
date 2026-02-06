# MinIO Storage 异步时序问题分析与解决方案

## 问题描述

使用 `fileManager.createFileRecord()` 创建文件记录后，在 `afterSave` hook 中立即查询记录会失败。

### 问题现象

```typescript
// 创建文件记录
const pageImage = await fileManager.createFileRecord({
  filePath: '/path/to/image.jpg',
  storageName: 'storageDefaultMinio',
  collectionName: 'newspaperPageImages',
  values: {
    title: data.pageTitle,
  }
});

// ❌ afterSave hook 中立即查询 - 失败
this.app.db.on('newspaperPageImages.afterSave', async (page: any) => {
    if (!page._changed?.has('pageId')) return;

    const PageImages = this.app.db.getRepository('newspaperPageImages');
    const pageImage = await PageImages.findOne({
        filterByTk: page.id,
        appends: ['storage'],
    })

    if (!pageImage) {
        throw new Error('pageImage not found');  // ❌ 执行到这里
    }
});
```

### 临时解决方案（不可靠）

```typescript
// ✅ setTimeout 延迟查询 - 成功
this.app.db.on('newspaperPageImages.afterSave', async (page: any) => {
    setTimeout(async () => {
        const PageImages = this.app.db.getRepository('newspaperPageImages');
        const pageImage = await PageImages.findOne({
            filterByTk: page.id,
            appends: ['storage'],
        })
        if (!pageImage) {
            throw new Error('pageImage not found');  // ✅ 不会执行到这里
        }
    }, 100);
});
```

**问题**：
- `setTimeout(0)` 也会失败
- `setTimeout(100)` 可以成功
- 说明这不是微任务 vs 宏任务的问题，而是真正的异步操作未完成

## 根本原因分析

### 1. createFileRecord 的实现逻辑

从 NocoBase file-manager 源码分析：

```typescript
// @nocobase/plugin-file-manager/src/server/server.ts

async createFileRecord(options: FileRecordOptions) {
    const { values, storageName, collectionName, filePath, transaction } = options;
    const collection = this.db.getCollection(collectionName);
    if (!collection) {
        throw new Error(`collection does not exist`);
    }
    const collectionRepository = this.db.getRepository(collectionName);
    const name = storageName || collection.options.storage;
    const data = await this.uploadFile({ storageName: name, filePath });
    // ⚠️ 关键：先调用 uploadFile，然后创建数据库记录
    return await collectionRepository.create({ values: { ...data, ...values }, transaction });
}

async uploadFile(options: UploadFileOptions) {
    const { storageName, filePath, documentRoot } = options;

    // 加载 storage 配置
    if (!this.storagesCache.size) {
        await this.loadStorages();
    }
    const storages = Array.from(this.storagesCache.values());
    const storage = storages.find((item) => item.name === storageName) || storages.find((item) => item.default);

    if (!storage) {
        throw new Error('[file-manager] no linked or default storage provided');
    }

    // 创建文件流
    const fileStream = fs.createReadStream(filePath);

    // 获取 StorageType 实例
    const StorageType = this.storageTypes.get(storage.type);
    const storageInstance = new StorageType(storage);

    if (!storageInstance) {
        throw new Error(`[file-manager] storage type "${storage.type}" is not defined`);
    }

    // 调用 storage engine
    const engine = storageInstance.make();

    const file = {
        originalname: basename(filePath),
        path: filePath,
        stream: fileStream,
    } as any;

    // ⚠️ 关键：_handleFile 使用 callback 风格
    await new Promise((resolve, reject) => {
        engine._handleFile({} as any, file, (error, info) => {
            if (error) {
                reject(error);
            }
            Object.assign(file, info);
            resolve(info);
        });
    });

    return storageInstance.getFileData(file, {});
}
```

### 2. MinioStorageEngine 的异步处理

```typescript
// MinioStorageEngine.ts

_handleFile(req, file, callback): void {
    const generateFilename = this.filename
        ? this.filename(req, file)
        : Promise.resolve(Date.now() + '-' + file.originalname);

    const generateMetadata = this.metadata
        ? this.metadata(req, file)
        : Promise.resolve({});

    // ⚠️ 使用 Promise.all 并行处理
    Promise.all([generateFilename, generateMetadata])
        .then(async ([filename, metadata]) => {
            const _fileName = Buffer.from(filename, 'latin1').toString('utf-8')
            const objectName = this.path ? `${this.path}/${_fileName}` : _fileName;
            try {
                // ⚠️ 上传文件到 MinIO
                await this.minioClient.putObject(
                    this.bucketName,
                    objectName,
                    file.stream,
                    file.size,
                    metadata
                );

                const info = {
                    filename: _fileName,
                    bucketName: this.bucketName,
                    size: file.size,
                    mimetype: file.mimetype,
                    originalname: file.originalname,
                };

                callback(null, info);
            } catch (err) {
                callback(err);
            }
        })
        .catch(callback);
}
```

### 3. 问题根源推测

基于代码分析和用户问题描述，可能的原因有：

#### 原因A：数据库事务提交延迟（最可能）

**现象**：
- `create()` 返回了记录（有 id）
- 但 `afterSave` hook 中查不到
- 延迟 100ms 后能查到

**推测**：
```typescript
// createFileRecord 的执行顺序：
1. uploadFile() - 上传文件到 MinIO（完成）
2. collectionRepository.create() - 创建数据库记录（等待事务提交）
   ↓
3. afterSave hook 立即触发（事务可能还未提交）
   ↓
4. 查询失败（事务未提交，记录不可见）
   ↓
5. 100ms 后事务提交
   ↓
6. 查询成功
```

**关键点**：
- `collectionRepository.create({ values, transaction })` 可能在事务中
- `afterSave` hook 可能在事务提交前触发
- 如果不传 `transaction` 参数，可能使用默认事务

#### 原因B：缓存刷新延迟

**可能性较低**，因为：
- 如果是缓存问题，`setTimeout(0)` 应该能解决
- 但用户说 `setTimeout(0)` 也会失败

#### 原因C：MinIO 文件流未完全关闭

**可能性较低**，因为：
- MinioStorageEngine 使用 callback 确保上传完成
- `await minioClient.putObject()` 会等待上传完成

## 解决方案

### 方案1：使用 afterCommit hook（推荐）

使用 Sequelize 的 `afterCommit` hook，确保事务提交后执行：

```typescript
// ✅ 正确方式：使用 afterCommit
this.app.db.on('newspaperPageImages.afterSave', async (page: any) => {
    if (!page._changed?.has('pageId')) return;

    // 使用 afterCommit 确保事务提交
    await new Promise(resolve => page.sequelize.transactionManager.afterCommit(() => {
        resolve(undefined);
    }));

    // 或者直接使用 Sequelize 的 afterCommit hook
    // (需要 NocoBase 的 Sequelize 版本支持)

    const PageImages = this.app.db.getRepository('newspaperPageImages');
    const pageImage = await PageImages.findOne({
        filterByTk: page.id,
        appends: ['storage'],
    });

    if (!pageImage) {
        throw new Error('pageImage not found');
    }
});
```

### 方案2：不使用事务

在 `createFileRecord` 中不传递 `transaction` 参数：

```typescript
const pageImage = await fileManager.createFileRecord({
  filePath: '/path/to/image.jpg',
  storageName: 'storageDefaultMinio',
  collectionName: 'newspaperPageImages',
  values: {
    title: data.pageTitle,
  },
  transaction: undefined,  // 显式不使用事务
});
```

### 方案3：在 afterSave 中使用 setTimeout（但不推荐）

```typescript
this.app.db.on('newspaperPageImages.afterSave', async (page: any) => {
    if (!page._changed?.has('pageId')) return;

    // 使用 setTimeout 等待事务提交
    await new Promise(resolve => setTimeout(resolve, 100));

    const PageImages = this.app.db.getRepository('newspaperPageImages');
    const pageImage = await PageImages.findOne({
        filterByTk: page.id,
        appends: ['storage'],
    });

    if (!pageImage) {
        throw new Error('pageImage not found');
    }
});
```

**缺点**：
- 不可靠，如果 IO 慢还是会失败
- 延迟时间不好确定

### 方案4：直接使用创建的记录（最佳）

如果只是为了获取刚创建的记录，直接使用返回值，不需要再次查询：

```typescript
// ✅ 最佳方案：直接使用返回的记录
const pageImage = await fileManager.createFileRecord({
  filePath: '/path/to/image.jpg',
  storageName: 'storageDefaultMinio',
  collectionName: 'newspaperPageImages',
  values: {
    title: data.pageTitle,
    pageId: data.pageId,
  }
});

// ⚠️ 问题：这个记录是刚创建的，可能还没有经过 afterFind hook
// 也就是说，url 和 preview 字段可能没有动态生成

// 解决方案：重新查询获取最新的 url
const freshRecord = await this.app.db.getRepository('newspaperPageImages').findOne({
  filterByTk: pageImage.id,
  appends: ['storage'],
});

// 或者手动生成 url（不太推荐）
const fileManager = this.app.pm.get(PluginFileManagerServer);
const url = await fileManager.getFileURL(pageImage);
const preview = await fileManager.getFileURL(pageImage, true);
```

### 方案5：修改 createFileRecord 实现以支持回调

如果可能，修改 `createFileRecord` 使其在事务提交后触发回调：

```typescript
// 修改 file-manager 的 createFileRecord
async createFileRecord(options: FileRecordOptions) {
    const { values, storageName, collectionName, filePath, transaction, afterCommit } = options;
    const collection = this.db.getCollection(collectionName);
    const collectionRepository = this.db.getRepository(collectionName);
    const name = storageName || collection.options.storage;
    const data = await this.uploadFile({ storageName: name, filePath });

    if (transaction && afterCommit) {
        // 使用事务并注册 afterCommit 回调
        const record = await collectionRepository.create({
            values: { ...data, ...values },
            transaction
        });

        transaction.afterCommit(() => {
            afterCommit(record);
        });

        return record;
    }

    return await collectionRepository.create({
        values: { ...data, ...values },
        transaction
    });
}

// 使用
await fileManager.createFileRecord({
    filePath: '/path/to/image.jpg',
    storageName: 'storageDefaultMinio',
    collectionName: 'newspaperPageImages',
    values: {
        title: data.pageTitle,
    },
    afterCommit: async (record) => {
        // 事务提交后执行
        console.log('Record created and committed:', record);
        // 可以在这里执行后续操作
    }
});
```

**注意**：这需要修改 NocoBase 的 file-manager 插件。

## 推荐方案对比

| 方案 | 可靠性 | 复杂度 | 适用场景 |
|-----|-------|-------|---------|
| **方案1：afterCommit hook** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | 需要在事务提交后执行操作 |
| **方案2：不使用事务** | ⭐⭐⭐⭐⭐ | ⭐ | 不需要事务的场景 |
| **方案3：setTimeout** | ⭐⭐ | ⭐ | 临时方案，不推荐 |
| **方案4：直接使用返回值** | ⭐⭐⭐⭐⭐ | ⭐ | 只需要创建记录的场景 |
| **方案5：修改源码** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | 需要框架级支持 |

## 具体建议

根据你的场景，推荐：

### 场景A：只需要处理创建的记录

```typescript
const pageImage = await fileManager.createFileRecord({
  filePath: '/path/to/image.jpg',
  storageName: 'storageDefaultMinio',
  collectionName: 'newspaperPageImages',
  values: {
    title: data.pageTitle,
    pageId: data.pageId,  // 直接设置需要的字段
  }
});

// 直接使用 pageImage，不需要 afterSave hook
console.log('Created:', pageImage.id, pageImage.pageId);
```

### 场景B：需要在事务提交后执行操作

```typescript
// 在调用 createFileRecord 的地方
const pageImage = await fileManager.createFileRecord({
  filePath: '/path/to/image.jpg',
  storageName: 'storageDefaultMinio',
  collectionName: 'newspaperPageImages',
  values: {
    title: data.pageTitle,
    pageId: data.pageId,
  }
});

// 如果需要确保事务提交，可以：
// 1. 不传 transaction，立即提交
// 2. 或者在事务外调用

// 然后执行后续操作
const freshRecord = await this.app.db.getRepository('newspaperPageImages').findOne({
  filterByTk: pageImage.id,
  appends: ['storage'],
});
```

### 场景C：必须使用 afterSave hook

```typescript
this.app.db.on('newspaperPageImages.afterSave', async (page: any) => {
    if (!page._changed?.has('pageId')) return;

    // 方案：使用 setImmediate 或 process.nextTick
    // 但需要确保足够的时间让事务提交

    await new Promise(resolve => {
        // 尝试多个层级的事件循环
        setTimeout(() => {
            resolve(undefined);
        }, 100);  // 或使用更可靠的方案1
    });

    const PageImages = this.app.db.getRepository('newspaperPageImages');
    const pageImage = await PageImages.findOne({
        filterByTk: page.id,
        appends: ['storage'],
    });

    if (!pageImage) {
        throw new Error('pageImage not found');
    }
});
```

## 总结

### 核心问题

- `create()` 返回后，`afterSave` hook 立即触发
- 此时数据库事务可能还未提交
- 导致查询不到刚创建的记录

### 根本原因

不是 MinIO 的异步问题，而是：
1. 数据库事务提交延迟
2. Hook 触发时机在事务提交之前

### 最佳实践

1. **如果不需要 hook**：直接使用 `createFileRecord` 返回的记录
2. **如果需要事务提交后执行**：使用 `afterCommit` hook（如果可用）
3. **如果必须用 setTimeout**：至少设置 100ms，但不是最佳方案

### 关于 MinIO Storage 的代码

MinioStorageType 和 MinioStorageEngine 的实现是正确的：
- `_handleFile` 正确等待文件上传完成
- `await minioClient.putObject()` 确保上传完成
- 没有需要添加 `await` 的地方

问题不在 MinIO Storage 的异步处理上。

## 调试建议

如果你想验证问题，可以添加日志：

```typescript
// 1. 在调用 createFileRecord 的地方
console.log('[1] Start creating file record...');
const pageImage = await fileManager.createFileRecord({
  filePath: '/path/to/image.jpg',
  storageName: 'storageDefaultMinio',
  collectionName: 'newspaperPageImages',
  values: {
    title: data.pageTitle,
    pageId: data.pageId,
  }
});
console.log('[1] File record created:', pageImage.id);

// 2. 在 afterSave hook 中
this.app.db.on('newspaperPageImages.afterSave', async (page: any) => {
    console.log('[2] afterSave triggered, page.id:', page.id);
    console.log('[2] page._changed:', page._changed);

    if (!page._changed?.has('pageId')) return;

    console.log('[3] About to query...');

    const PageImages = this.app.db.getRepository('newspaperPageImages');
    const pageImage = await PageImages.findOne({
        filterByTk: page.id,
        appends: ['storage'],
    });

    if (pageImage) {
        console.log('[3] Found record:', pageImage.id);
    } else {
        console.log('[3] Record NOT found!');
    }
});

// 3. 检查 NocoBase 的数据库配置
// 看看是否使用了自动提交事务
```

通过日志，你可以看到：
- `createFileRecord` 何时完成
- `afterSave` 何时触发
- 查询何时成功或失败

这将帮助你确认是否是事务提交时机的问题。
