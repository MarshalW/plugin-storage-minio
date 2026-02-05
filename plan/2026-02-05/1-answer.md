# 使用内部 API 上传本地文件到 newspaperPageImages

## 基本原理分析

### 架构关系

```
NocoBase File Manager (框架层)
    └── 提供统一的文件管理 API
    └── 抽象了 StorageEngine 接口
    └── 注册不同的存储类型 (local, s3, minio, etc.)
        
MinioStorageType (实现层)
    └── 继承自 StorageType
    └── 实现 make(), delete(), getFileURL() 等方法
    └── 注册到 file-manager 的 storageTypes 中

newspaperPageImages (collection)
    └── template: "file" - 标识为文件类型集合
    └── storage: "storageDefaultMinio" - 指定使用的存储
```

### 核心流程

1. **文件上传** - file-manager 提供统一的 `uploadFile()` 方法
2. **存储适配** - 根据 storage type 调用对应的 StorageType 实现
3. **记录创建** - `createFileRecord()` 创建数据库记录并关联文件

## 内部 API 方案

### 方法一：使用 PluginFileManagerServer.uploadFile()

```typescript
import { PluginFileManagerServer } from '@nocobase/plugin-file-manager';

// 获取 file manager 插件实例
const fileManager = app.pm.get(PluginFileManagerServer);

// 上传本地文件
const fileData = await fileManager.uploadFile({
  filePath: '/path/to/your/local/image.jpg',
  storageName: 'storageDefaultMinio'
});

// fileData 返回值：
// {
//   title: "news-01",
//   filename: "1770291824693-news-01.jpg",
//   extname: ".jpg",
//   path: "dev/uploads",
//   size: 1024000,
//   mimetype: "image/jpeg",
//   meta: {},
//   storageId: 346055714406400
// }

// 创建 newspaperPageImages 记录
const newspaperPageImagesRepo = db.getRepository('newspaperPageImages');
const record = await newspaperPageImagesRepo.create({
  values: {
    ...fileData,
    title: '自定义标题'
  }
});
```

### 方法二：使用 PluginFileManagerServer.createFileRecord()

```typescript
import { PluginFileManagerServer } from '@nocobase/plugin-file-manager';

const fileManager = app.pm.get(PluginFileManagerServer);

// 一步完成上传和记录创建
const record = await fileManager.createFileRecord({
  filePath: '/path/to/your/local/image.jpg',
  storageName: 'storageDefaultMinio',
  collectionName: 'newspaperPageImages',
  values: {
    title: '自定义标题',
    // 可以添加其他字段的值
  }
});
```

## 关键点说明

### 1. 为什么不需要用 REST API？

- REST API (`POST /api/newspaperPageImages:create`) 需要：
  - multipart/form-data 编码
  - 认证 token (authorization header)
  - 权限验证 (ACL)
  
- 内部 API (`PluginFileManagerServer`) 直接在服务端执行：
  - 绕过网络传输
  - 无需认证（已有上下文）
  - 避开 ACL 检查（服务端直接调用）

### 2. 统一 API 的优势

```typescript
// 无论使用什么存储，API 调用方式完全一致

// 使用 minio 存储
await fileManager.uploadFile({ 
  filePath: '/path/file.jpg', 
  storageName: 'storageDefaultMinio' 
});

// 使用本地存储
await fileManager.uploadFile({ 
  filePath: '/path/file.jpg', 
  storageName: 'storageDefaultLocal' 
});

// 使用 S3 存储
await fileManager.uploadFile({ 
  filePath: '/path/file.jpg', 
  storageName: 'storageDefaultS3' 
});
```

### 3. uploadFile() 实现原理

```typescript
// 核心代码位置：@nocobase/plugin-file-manager/src/server/server.ts

async uploadFile(options: UploadFileOptions) {
  // 1. 从缓存获取 storage 配置
  const storage = this.storagesCache.get(storageName);
  
  // 2. 根据类型获取对应的 StorageType 实现
  const StorageType = this.storageTypes.get(storage.type);
  const storageInstance = new StorageType(storage);
  
  // 3. 创建 StorageEngine (multer 兼容)
  const engine = storageInstance.make();
  
  // 4. 调用 engine._handleFile() 上传文件
  await new Promise((resolve, reject) => {
    engine._handleFile({}, file, (error, info) => {
      // info 包含: filename, size, mimetype 等
    });
  });
  
  // 5. 生成文件数据
  return storageInstance.getFileData(file, {});
}
```

## 完整示例

### 在自定义插件中上传文件

```typescript
import { Plugin } from '@nocobase/server';
import { PluginFileManagerServer } from '@nocobase/plugin-file-manager';
import fs from 'fs';

class MyCustomPlugin extends Plugin {
  async load() {
    // 注册自定义 action
    this.app.resourceManager.define({
      name: 'customUpload',
      actions: {
        uploadPageImage: async (ctx, next) => {
          const { pageId, localFilePath } = ctx.action.params.values;
          
          // 获取 file manager
          const fileManager = this.app.pm.get(PluginFileManagerServer);
          
          // 验证文件存在
          if (!fs.existsSync(localFilePath)) {
            ctx.throw(400, 'File not found');
          }
          
          // 上传并创建记录
          const record = await fileManager.createFileRecord({
            filePath: localFilePath,
            storageName: 'storageDefaultMinio',
            collectionName: 'newspaperPageImages',
            values: {
              title: `Page ${pageId}`,
              meta: { pageId } // 自定义元数据
            }
          });
          
          ctx.body = {
            success: true,
            data: record.toJSON()
          };
          
          await next();
        }
      }
    });
    
    // 设置权限（可选）
    this.app.acl.allow('customUpload', '*');
  }
}

export default MyCustomPlugin;
```

### 批量上传示例

```typescript
import { PluginFileManagerServer } from '@nocobase/plugin-file-manager';
import fs from 'fs';
import path from 'path';

async function batchUploadImages(app, directoryPath) {
  const fileManager = app.pm.get(PluginFileManagerServer);
  const records = [];
  
  // 读取目录下所有图片
  const files = fs.readdirSync(directoryPath);
  const imageFiles = files.filter(f => 
    /\.(jpg|jpeg|png|gif|webp)$/i.test(f)
  );
  
  for (const filename of imageFiles) {
    const filePath = path.join(directoryPath, filename);
    
    try {
      const record = await fileManager.createFileRecord({
        filePath,
        storageName: 'storageDefaultMinio',
        collectionName: 'newspaperPageImages',
        values: {
          title: path.basename(filename, path.extname(filename))
        }
      });
      
      records.push(record);
    } catch (error) {
      console.error(`Failed to upload ${filename}:`, error);
    }
  }
  
  return records;
}
```

## 注意事项

1. **存储必须已注册**
   - 确保 `storageDefaultMinio` 在 `storages` 集合中存在
   - 检查存储配置是否正确（endpoint, bucketName, accessKey 等）

2. **文件路径必须是绝对路径**
   ```typescript
   // 正确
   filePath: '/home/ubuntu/images/news-01.jpg'
   
   // 错误
   filePath: './images/news-01.jpg'
   ```

3. **storageName 默认值**
   - 如果不指定 `storageName`，会使用 collection 配置的 storage
   - collection 配置：`collection.options.storage`

4. **事务支持**
   ```typescript
   const transaction = await db.sequelize.transaction();
   
   try {
     await fileManager.createFileRecord({
       filePath,
       collectionName: 'newspaperPageImages',
       transaction  // 支持事务
     });
     
     await transaction.commit();
   } catch (error) {
     await transaction.rollback();
     throw error;
   }
   ```

## 总结

使用内部 API 上传文件的优势：

- **统一接口** - `uploadFile()` 和 `createFileRecord()` 适用于所有存储类型
- **无网络开销** - 直接服务端调用，不需要 HTTP 请求
- **无认证问题** - 跳过权限验证，适合内部逻辑
- **易于测试** - 可以在服务端直接测试和调试
- **易于迁移** - 更换存储实现时，代码无需修改

核心就是：使用 `PluginFileManagerServer` 提供的内部 API，而不是 REST API。
