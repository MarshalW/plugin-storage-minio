# MinIO Storage URL 过期问题分析与解决方案

## 问题现象

使用 `PluginFileManagerServer.createFileRecord()` 上传文件后，生成的 URL 是预签名 URL：

```
http://ant:9000/mineru-doc-app/dev/uploads/1770294135248-news-01.jpg?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=nm3GCqOVIFSb27tlcycs%2F20260205%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20260205T122224Z&X-Amz-Expires=3600&X-Amz-SignedHeaders=host&X-Amz-Signature=23cfca8dff112087fb87166a3e13989631b1ebe633d72057714b2edbcfe6f922
```

其中 `X-Amz-Expires=3600` 表示 1 小时后过期。

## 根本原因分析

### MinioStorageType 当前实现

```typescript
// MinioStorageType.ts:37-42
async getFileURL(file: AttachmentModel, preview?: boolean): Promise<string> {
  const { expires, bucketName, path } = this.storage.options;
  const normalizedPath = path ? path.replace(/^\/+|\/+$/g, '') : '';
  const objectName = normalizedPath ? `${normalizedPath}/${file.filename}` : file.filename;
  return await this.getClient().presignedGetObject(bucketName, objectName, expires)
}
```

**问题**：`getFileURL()` **总是**使用 `presignedGetObject()` 生成预签名 URL。

### 与官方实现的对比

| 存储类型 | getFileURL() 实现 | URL 类型 | 是否有过期时间 |
|---------|------------------|----------|--------------|
| **MinioStorageType** | 重写，使用 `presignedGetObject()` | 预签名 URL | ✅ 有 |
| **S3 Storage** | 未重写，使用父类方法 | 公共 URL | ❌ 无 |
| **Ali OSS** | 未重写，使用父类方法 | 公共 URL | ❌ 无 |
| **Local Storage** | 使用父类 + APP_PUBLIC_PATH | 公共 URL | ❌ 无 |

父类 `StorageType.getFileURL()` 的实现（直接拼接）：

```typescript
// @nocobase/plugin-file-manager/src/server/storages/index.ts
getFileURL(file: AttachmentModel, preview?: boolean): string | Promise<string> {
  if (file.url && isURL(file.url)) {
    if (preview && this.storage.options.thumbnailRule) {
      return encodeURL(file.url) + this.storage.options.thumbnailRule;
    }
    return encodeURL(file.url);
  }
  const keys = [
    this.storage.baseUrl,
    file.path && encodeURI(file.path),
    ensureUrlEncoded(file.filename),
    preview && this.storage.options.thumbnailRule,
  ].filter(Boolean);
  return urlJoin(keys);
}
```

**结论**：MinioStorageType 与官方实现不一致，总是生成预签名 URL。

## 解决方案

### 方案一：添加 `public` 配置选项（推荐）

支持两种 URL 生成模式：
- **Public URL**：直接拼接，无过期时间（适用于公开访问的文件）
- **Presigned URL**：带签名和过期时间（适用于需要访问控制的文件）

#### 实现步骤

**1. 修改 MinioStorageType.ts**

```typescript
import { StorageType } from '@nocobase/plugin-file-manager';
import { encodeURL, ensureUrlEncoded } from '@nocobase/plugin-file-manager/src/server/utils';
import urlJoin from 'url-join';
import { isURL } from '@nocobase/utils';

export class StorageTypeMinio extends StorageType {
  make(): StorageEngine {
    const { bucketName, path } = this.storage.options;
    const normalizedPath = path ? path.replace(/^\/+|\/+$/g, '') : '';
    return new MinioStorageEngine({
      minioClient: this.getClient(),
      bucketName,
      path: normalizedPath,
    })
  }

  async delete(records: AttachmentModel[]): Promise<[number, AttachmentModel[]]> {
    const { bucketName, path } = this.storage.options;
    const normalizedPath = path ? path.replace(/^\/+|\/+$/g, '') : '';

    let successCount = 0;
    const failedRecords: AttachmentModel[] = [];

    for (const record of records) {
      try {
        const objectName = normalizedPath ? `${normalizedPath}/${record.filename}` : record.filename;
        await this.getClient().removeObject(bucketName, objectName);
        successCount++;
      } catch (err) {
        failedRecords.push(record);
      }
    }

    return [successCount, failedRecords];
  }

  async getFileURL(file: AttachmentModel, preview?: boolean): Promise<string> {
    // 如果配置了 public 或没有配置 expires，使用公共 URL
    if (this.storage.options.public === true || !this.storage.options.expires) {
      const keys = [
        this.storage.baseUrl,
        file.path && encodeURI(file.path),
        ensureUrlEncoded(file.filename),
        preview && this.storage.options.thumbnailRule,
      ].filter(Boolean);
      return urlJoin(keys);
    }

    // 否则使用预签名 URL
    const { expires, bucketName, path } = this.storage.options;
    const normalizedPath = path ? path.replace(/^\/+|\/+$/g, '') : '';
    const objectName = normalizedPath ? `${normalizedPath}/${file.filename}` : file.filename;
    return await this.getClient().presignedGetObject(bucketName, objectName, expires);
  }

  getClient() {
    const { accessKey, secretKey, endPoint, port, region, useSSL = false } = this.storage.options;
    return new Client({
      endPoint,
      port,
      useSSL,
      accessKey,
      secretKey,
      region,
    });
  }
}
```

**2. 修改 storage 配置（plugin.ts）**

```typescript
// plugin.ts:21-41
await Storages.create({
  values: {
    id: 346055714406400,
    type: process.env.STORAGE_DEFAULT_TYPE,
    name: process.env.STORAGE_DEFAULT_NAME || 'storageDefaultMinio',
    title: process.env.STORAGE_DEFAULT_TITLE || 'Storage default minio',
    baseUrl: process.env.STORAGE_DEFAULT_BASEURL || 'http://ant:9000/mineru-doc-app',
    options: {
      endPoint: process.env.STORAGE_DEFAULT_ENDPOINT || 'localhost',
      port: Number(process.env.STORAGE_DEFAULT_PORT) || 9000,
      expires: process.env.STORAGE_DEFAULT_EXPIRES !== undefined 
        ? Number(process.env.STORAGE_DEFAULT_EXPIRES) 
        : undefined,  // undefined = 不使用预签名
      public: process.env.STORAGE_DEFAULT_PUBLIC !== 'false',  // 默认 true
      accessKey: process.env.STORAGE_DEFAULT_ACCESSKEY || '',
      secretKey: process.env.STORAGE_DEFAULT_SECRETKEY || '',
      bucketName: process.env.STORAGE_DEFAULT_BUCKETNAME || 'test',
      path: process.env.STORAGE_DEFAULT_PATH || '',
    },
    rules: {
      size: 20 * 1024 * 1024,  // 20 MB
    },
  },
});
```

**3. 环境变量配置**

```bash
# 公共访问模式（推荐）
STORAGE_DEFAULT_PUBLIC=true
STORAGE_DEFAULT_EXPIRES=  # 不设置或为空

# 预签名模式（需要访问控制）
STORAGE_DEFAULT_PUBLIC=false
STORAGE_DEFAULT_EXPIRES=3600
```

#### 使用效果

**Public 模式**（`public: true` 或 `expires` 未设置）：
```
http://ant:9000/mineru-doc-app/dev/uploads/1770294135248-news-01.jpg
```
✅ 无过期时间，长期有效

**Presigned 模式**（`public: false` 且 `expires` 有值）：
```
http://ant:9000/mineru-doc-app/dev/uploads/1770294135248-news-01.jpg?X-Amz-Expires=3600&...
```
✅ 有过期时间，适合临时访问

### 方案二：后端动态生成 URL（更灵活）

服务端存储时不生成 URL，客户端请求时动态生成。

#### 实现思路

```typescript
// 1. 上传时，不生成 URL
await fileManager.createFileRecord({
  filePath: '/path/to/image.jpg',
  collectionName: 'newspaperPageImages',
  values: {
    // 不设置 url 和 preview
    // 只存储 filename, path, storageId
  }
});

// 2. 自定义 Action 返回带签名的 URL
this.app.resourceManager.define({
  name: 'files',
  actions: {
    getDownloadUrl: async (ctx, next) => {
      const { id } = ctx.action.params;
      const fileManager = this.app.pm.get(PluginFileManagerServer);
      
      const record = await db.getRepository('newspaperPageImages').findOne({
        filterByTk: id,
      });
      
      const url = await fileManager.getFileURL(record);
      
      ctx.body = { url };
      await next();
    }
  }
});
```

**缺点**：
- 客户端需要额外请求获取 URL
- 每次访问文件都要生成新 URL

### 方案三：使用非常长的过期时间（不推荐）

将 `expires` 设置为最大值（7 天）：

```typescript
options: {
  expires: 7 * 24 * 60 * 60,  // 7 天
}
```

**缺点**：
- 仍然有到期时间，不是长期解决方案
- URL 可能被滥用（有效期太长）
- 7 天后仍需重新生成

## 推荐配置

根据不同场景选择配置：

### 场景 1：公开访问的图片（推荐）

适用于：用户头像、公共文档、展示图片等

```typescript
// plugin.ts
options: {
  public: true,           // 或不设置 public，不设置 expires
  // expires: undefined,   // 不使用预签名
}
```

结果：生成无过期时间的公共 URL

### 场景 2：需要访问控制的文件

适用于：用户私密文件、临时下载链接等

```typescript
// plugin.ts
options: {
  public: false,
  expires: 3600,           // 1 小时过期
}
```

结果：生成带签名的预签名 URL

### 场景 3：混合使用（同时支持两种 URL）

可以配置多个 storage：

```typescript
// 公共访问的图片 storage
await Storages.create({
  values: {
    name: 'publicImages',
    type: 'minio-storage',
    options: {
      public: true,
      bucketName: 'public-files',
    }
  }
});

// 私密文件 storage
await Storages.create({
  values: {
    name: 'privateDocuments',
    type: 'minio-storage',
    options: {
      public: false,
      expires: 3600,
      bucketName: 'private-files',
    }
  }
});
```

不同 collection 使用不同的 storage：

```typescript
// newspaperPageImages - 使用公共 storage
defineCollection({
  name: 'newspaperPageImages',
  storage: 'publicImages',  // 无过期时间
  template: 'file',
  // ...
});

// userDocuments - 使用私密 storage
defineCollection({
  name: 'userDocuments',
  storage: 'privateDocuments',  // 有过期时间
  template: 'file',
  // ...
});
```

## MinIO Bucket 策略配合

确保 MinIO bucket 策略与 URL 类型匹配：

### Public 模式下的 Bucket 策略

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": "*"
      },
      "Action": [
        "s3:GetObject"
      ],
      "Resource": [
        "arn:aws:s3:::public-files/*"
      ]
    }
  ]
}
```

### Presigned 模式下的 Bucket 策略

```json
{
  "Version": "2012-10-17",
  "Statement": []
}
```

或只允许特定的操作权限，不公开读取。

## 总结

| 方案 | 优点 | 缺点 | 推荐度 |
|-----|------|------|--------|
| **方案一** | 兼顾灵活性和安全性，与官方实现一致 | 需要修改代码 | ⭐⭐⭐⭐⭐ |
| 方案二 | 最安全，URL 不会泄露 | 客户端需要额外请求 | ⭐⭐⭐ |
| 方案三 | 实现简单 | 仍有到期时间，不安全 | ⭐ |

**最佳实践**：使用方案一，根据业务需求配置 `public` 和 `expires`：

- 公开访问：`public: true` 或不设置 `expires`
- 需要访问控制：`public: false` + `expires: 3600`

这样既保持了预签名能力，又不会影响长期使用场景。
