# MinIO Storage URL 问题修复说明

## 问题描述

之前的实现总是生成带过期时间的预签名 URL，不适合长期使用场景。

## 修复内容

### 1. MinioStorageType.ts 修改

`getFileURL()` 方法现在支持两种 URL 生成模式：

```typescript
async getFileURL(file: AttachmentModel, preview?: boolean): Promise<string> {
    const { baseUrl, expires, bucketName, path: storagePath } = this.storage.options;
    const normalizedPath = storagePath ? storagePath.replace(/^\/+|\/+$/g, '') : '';

    // Public 模式：直接拼接 URL，无过期时间
    if (this.storage.options.public === true || !expires) {
        const parts = [
            baseUrl,
            normalizedPath,
            file.filename,
            preview && this.storage.options.thumbnailRule
        ].filter(Boolean);
        return parts.join('/').replace(/\/+/g, '/');
    }

    // Presigned 模式：生成带签名的预签名 URL
    const objectName = normalizedPath ? `${normalizedPath}/${file.filename}` : file.filename;
    return await this.getClient().presignedGetObject(bucketName, objectName, expires)
}
```

### 2. plugin.ts 修改

添加了 `public` 和 `expires` 配置项：

```typescript
options: {
    endPoint: process.env.STORAGE_DEFAULT_ENDPOINT || 'localhost',
    port: Number(process.env.STORAGE_DEFAULT_PORT) || 9000,
    expires: process.env.STORAGE_DEFAULT_EXPIRES !== undefined 
      ? Number(process.env.STORAGE_DEFAULT_EXPIRES)
      : undefined,
    public: process.env.STORAGE_DEFAULT_PUBLIC !== 'false',
    accessKey: process.env.STORAGE_DEFAULT_ACCESSKEY || '',
    secretKey: process.env.STORAGE_DEFAULT_SECRETKEY || '',
    bucketName: process.env.STORAGE_DEFAULT_BUCKETNAME || 'test',
    path: process.env.STORAGE_DEFAULT_PATH || '',
}
```

## 环境变量配置

### Public 模式（推荐，无过期时间）

```bash
STORAGE_DEFAULT_PUBLIC=true
# STORAGE_DEFAULT_EXPIRES=  # 不设置或为空
```

生成的 URL：
```
http://ant:9000/mineru-doc-app/dev/uploads/1770294135248-news-01.jpg
```

### Presigned 模式（有过期时间）

```bash
STORAGE_DEFAULT_PUBLIC=false
STORAGE_DEFAULT_EXPIRES=3600  # 秒数
```

生成的 URL：
```
http://ant:9000/mineru-doc-app/dev/uploads/1770294135248-news-01.jpg?X-Amz-Expires=3600&...
```

## MinIO Bucket 策略

### Public 模式 Bucket 策略

确保 bucket 允许公共读取：

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
        "arn:aws:s3:::YOUR_BUCKET_NAME/*"
      ]
    }
  ]
}
```

## 使用示例

```typescript
const fileManager = app.pm.get(PluginFileManagerServer);

// 上传文件（使用配置的 URL 模式）
const record = await fileManager.createFileRecord({
  filePath: '/path/to/image.jpg',
  storageName: 'storageDefaultMinio',
  collectionName: 'newspaperPageImages',
  values: {
    title: 'My Image'
  }
});

// record.url 将根据配置生成：
// - public: true → 无过期时间的 URL
// - public: false → 带过期时间的预签名 URL
```

## 与官方实现一致

修复后，MinioStorageType 的行为与官方的 S3、Ali OSS、Local Storage 一致：
- 支持公共 URL（直接拼接）
- 支持预签名 URL（带过期时间）
- 可通过配置灵活切换
