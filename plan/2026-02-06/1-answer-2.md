# MinIO Storage 异步时序问题 - 重新分析

## 用户的关键观察

1. ✅ 其他 collection 的 afterSave 从未出现这个问题
2. ✅ 只有涉及 file manager storage 才出现
3. ✅ setTimeout(0) 失败，setTimeout(100) 成功
4. ✅ 如果只是数据库事务，不应该需要 100ms

## 结论：问题不在数据库事务

用户的观察非常关键，这表明：
- ❌ 不是简单的数据库事务提交延迟
- ✅ 问题确实在 file manager 的实现中
- ✅ 很可能是异步操作没有被正确等待

## 可能的问题点分析

### 1. createFileRecord 的实现

```typescript
// file-manager 的 createFileRecord
async createFileRecord(options: FileRecordOptions) {
    const { values, storageName, collectionName, filePath, transaction } = options;
    const collection = this.db.getCollection(collectionName);
    const collectionRepository = this.db.getRepository(collectionName);
    const name = storageName || collection.options.storage;

    // ⚠️ uploadFile 可能有问题
    const data = await this.uploadFile({ storageName: name, filePath });

    // ⚠️ 或者这里有异步操作没等待？
    return await collectionRepository.create({ values: { ...data, ...values }, transaction });
}
```

### 2. uploadFile 的实现

```typescript
async uploadFile(options: UploadFileOptions) {
    const { storageName, filePath, documentRoot } = options;

    // 获取 storage 配置
    if (!this.storagesCache.size) {
        await this.loadStorages();
    }
    const storages = Array.from(this.storagesCache.values());
    const storage = storages.find((item) => item.name === storageName) || storages.find((item) => item.default);

    // 创建文件流
    const fileStream = fs.createReadStream(filePath);

    // 获取 StorageType 实例
    const StorageType = this.storageTypes.get(storage.type);
    const storageInstance = new StorageType(storage);

    // 调用 storage engine
    const engine = storageInstance.make();

    const file = {
        originalname: basename(filePath),
        path: filePath,
        stream: fileStream,
    } as any;

    // ⚠️ 包装 callback 到 Promise
    await new Promise((resolve, reject) => {
        engine._handleFile({} as any, file, (error, info) => {
            if (error) {
                reject(error);
            }
            Object.assign(file, info);
            resolve(info);  // ⚠️ 这里可能有问题
        });
    });

    return storageInstance.getFileData(file, {});
}
```

### 3. MinioStorageEngine._handleFile

```typescript
_handleFile(req, file, callback): void {
    const generateFilename = this.filename
        ? this.filename(req, file)
        : Promise.resolve(Date.now() + '-' + file.originalname);

    const generateMetadata = this.metadata
        ? this.metadata(req, file)
        : Promise.resolve({});

    Promise.all([generateFilename, generateMetadata])
        .then(async ([filename, metadata]) => {
            const _fileName = Buffer.from(filename, 'latin1').toString('utf-8')
            const objectName = this.path ? `${this.path}/${_fileName}` : _fileName;
            try {
                // 上传到 MinIO
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

                callback(null, info);  // ⚠️ 看起来没问题
            } catch (err) {
                callback(err);
            }
        })
        .catch(callback);
}
```

## 最可能的原因

根据用户的观察，最可能的原因是：

**file-manager 的 `createFileRecord` 或 `uploadFile` 有某些异步操作没有被正确等待**

可能包括：
1. 文件流完全关闭的异步操作
2. MinIO 客户端的某些内部异步操作
3. `collectionRepository.create()` 的某些异步钩子
4. file-manager 可能有额外的异步操作（如清理临时文件）

## 调试方案：添加详细日志

```typescript
// ========== 在调用 createFileRecord 的地方 ==========

console.log('[1] ===== Start createFileRecord =====');
console.log('[2] File path:', '/path/to/image.jpg');
console.log('[3] Storage name:', 'storageDefaultMinio');

const startTime = Date.now();

const pageImage = await fileManager.createFileRecord({
  filePath: '/path/to/image.jpg',
  storageName: 'storageDefaultMinio',
  collectionName: 'newspaperPageImages',
  values: {
    title: data.pageTitle,
  }
});

const elapsed = Date.now() - startTime;
console.log('[4] ===== createFileRecord completed =====');
console.log('[5] Total time:', elapsed, 'ms');
console.log('[6] Record created:');
console.log('    - id:', pageImage.id);
console.log('    - filename:', pageImage.filename);
console.log('    - url:', pageImage.url?.substring(0, 50) + '...');
console.log('    - pageId:', pageImage.pageId);

// ========== 在 afterSave hook 中 ==========

this.app.db.on('newspaperPageImages.afterSave', async (page: any) => {
    const hookStartTime = Date.now();

    console.log('[7] ===== afterSave triggered =====');
    console.log('[8] page.id:', page.id);
    console.log('[9] page._changed:', Array.from(page._changed || []));
    console.log('[10] page.isNewRecord:', page.isNewRecord);
    console.log('[11] page instance:', page.constructor.name);
    console.log('[12] Time since createFileRecord started:', hookStartTime - startTime, 'ms');

    if (!page._changed?.has('pageId')) {
        console.log('[13] pageId not changed, skipping');
        return;
    }

    console.log('[14] ===== About to query record =====');
    const queryStartTime = Date.now();

    const PageImages = this.app.db.getRepository('newspaperPageImages');
    const pageImage = await PageImages.findOne({
        filterByTk: page.id,
        appends: ['storage'],
    });

    const queryElapsed = Date.now() - queryStartTime;
    const totalElapsed = Date.now() - startTime;

    console.log('[15] Query completed in:', queryElapsed, 'ms');
    console.log('[16] Total time since start:', totalElapsed, 'ms');

    if (!pageImage) {
        console.log('[17] ❌ ===== RECORD NOT FOUND =====');
        console.log('[18] Total elapsed time:', totalElapsed, 'ms');
        throw new Error('pageImage not found');
    }

    console.log('[19] ✅ ===== RECORD FOUND =====');
    console.log('[20] Record data:');
    console.log('    - id:', pageImage.id);
    console.log('    - filename:', pageImage.filename);
    console.log('    - url:', pageImage.url?.substring(0, 50) + '...');
});
```

## 日志分析

根据日志输出，可以判断：

### 情况A：查询很快但查不到

```
[5] Total time: 50ms
[14] ===== About to query record =====
[15] Query completed in: 5ms
[17] ❌ ===== RECORD NOT FOUND =====
```

**结论**：查询速度正常，但记录不可见
**原因**：可能是数据库事务或缓存问题

### 情况B：查询很慢

```
[5] Total time: 50ms
[14] ===== About to query record =====
[15] Query completed in: 150ms  ⚠️ 查询本身很慢
```

**结论**：数据库查询慢
**原因**：可能是索引或数据库性能问题

### 情况C：创建本身很慢

```
[5] Total time: 200ms  ⚠️ 创建很慢
[14] ===== About to query record =====
[15] Query completed in: 5ms
```

**结论**：`createFileRecord` 本身很慢
**原因**：可能是 MinIO 上传慢或某些异步操作

### 情况D：afterSave 触发时机早

```
[5] Total time: 50ms
[12] Time since createFileRecord started: 10ms  ⚠️ afterSave 提前触发
```

**结论**：afterSave 在 create 完成前触发
**原因**：Sequelize hook 的触发时机问题

## 临时解决方案

### 方案1：直接使用 afterSave 传入的记录（推荐）

```typescript
this.app.db.on('newspaperPageImages.afterSave', async (page: any) => {
    if (!page._changed?.has('pageId')) return;

    // ✅ 直接使用 page，不要再查询
    console.log('Record created:', {
        id: page.id,
        pageId: page.pageId,
        filename: page.filename,
        title: page.title,
        size: page.size,
        mimetype: page.mimetype,
    });

    // 如果需要 url（经过 afterFind hook 处理的）
    // 可以手动延迟查询
    await new Promise(resolve => setTimeout(resolve, 100));
    const freshRecord = await this.app.db.getRepository('newspaperPageImages').findOne({
        filterByTk: page.id,
        appends: ['storage'],
    });

    if (freshRecord) {
        console.log('Fresh record with URL:', {
            id: freshRecord.id,
            url: freshRecord.url,
            preview: freshRecord.preview,
        });
    }
});
```

**优点**：
- 不依赖重新查询，避免时序问题
- 直接使用刚创建的记录
- 性能最好

**注意**：
- 刚创建的记录可能没有经过 `afterFind` hook
- url 和 preview 字段可能没有动态生成
- 如需要 url，可以手动查询一次（带延迟）

### 方案2：重试机制（最可靠）

```typescript
this.app.db.on('newspaperPageImages.afterSave', async (page: any) => {
    if (!page._changed?.has('pageId')) return;

    // ✅ 重试查询，直到成功
    const maxRetries = 5;
    const retryDelay = 100;  // 100ms
    let pageImage = null;

    for (let i = 0; i < maxRetries; i++) {
        const PageImages = this.app.db.getRepository('newspaperPageImages');
        pageImage = await PageImages.findOne({
            filterByTk: page.id,
            appends: ['storage'],
        });

        if (pageImage) {
            console.log(`Record found on attempt ${i + 1}`);
            break;
        }

        console.log(`Attempt ${i + 1} failed, retrying in ${retryDelay}ms...`);
        if (i < maxRetries - 1) {
            await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
    }

    if (!pageImage) {
        throw new Error(`pageImage not found after ${maxRetries} attempts`);
    }
});
```

**优点**：
- 可靠，能处理各种延迟情况
- 有最大重试次数，避免无限等待
- 日志清晰，容易调试

**缺点**：
- 可能有额外延迟
- 代码稍复杂

### 方案3：智能延迟（折中方案）

```typescript
this.app.db.on('newspaperPageImages.afterSave', async (page: any) => {
    if (!page._changed?.has('pageId')) return;

    // ✅ 智能延迟：先尝试立即查询，失败再延迟
    const PageImages = this.app.db.getRepository('newspaperPageImages');
    let pageImage = await PageImages.findOne({
        filterByTk: page.id,
        appends: ['storage'],
    });

    if (!pageImage) {
        console.log('First query failed, retrying with delay...');
        await new Promise(resolve => setTimeout(resolve, 100));

        pageImage = await PageImages.findOne({
            filterByTk: page.id,
            appends: ['storage'],
        });
    }

    if (!pageImage) {
        throw new Error('pageImage not found');
    }
});
```

**优点**：
- 尝试立即查询，不延迟（如果能成功）
- 如果失败，自动延迟重试
- 简单实用

### 方案4：不使用 hook（如果场景允许）

```typescript
// ✅ 直接在 createFileRecord 后处理
const pageImage = await fileManager.createFileRecord({
  filePath: '/path/to/image.jpg',
  storageName: 'storageDefaultMinio',
  collectionName: 'newspaperPageImages',
  values: {
    title: data.pageTitle,
    pageId: data.pageId,
  }
});

// 直接在这里处理，不使用 afterSave hook
console.log('Record created:', pageImage.id);
// ... 其他逻辑
```

**适用场景**：
- 逻辑简单，不需要 hook
- 知道调用 createFileRecord 的地方
- 不需要在多个地方统一处理

## 推荐方案对比

| 方案 | 可靠性 | 复杂度 | 性能 | 适用场景 |
|-----|-------|-------|------|---------|
| **方案1：直接使用记录** | ⭐⭐⭐⭐⭐ | ⭐ | ⭐⭐⭐⭐⭐ | 不需要 url 或可以接受无 url |
| **方案2：重试机制** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | 需要可靠获取完整记录 |
| **方案3：智能延迟** | ⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐ | 一般场景，推荐 |
| **方案4：不使用 hook** | ⭐⭐⭐⭐⭐ | ⭐ | ⭐⭐⭐⭐⭐ | 简单场景 |

## 最终建议

1. **第一步：添加日志**
   - 使用上面的详细日志代码
   - 确定问题出在哪一步
   - 看看是创建慢、查询慢、还是时机问题

2. **第二步：选择合适的解决方案**
   - 如果不需要 url：用方案1（直接使用记录）
   - 如果需要可靠获取完整记录：用方案2（重试机制）
   - 一般场景：用方案3（智能延迟）

3. **第三步：如果问题持续**
   - 向 NocoBase 提 issue
   - 说明只在 file manager storage 时出现
   - 提供日志和复现步骤

## 关于 MinIO Storage 代码

当前代码看起来是正确的：
- `_handleFile` 正确等待文件上传
- `await minioClient.putObject()` 确保完成
- callback 时机合理

**问题不在 MinIO Storage 的异步处理上，而在更高层的 file manager 实现中。**
