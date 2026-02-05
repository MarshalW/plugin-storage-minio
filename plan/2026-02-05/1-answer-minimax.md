# NocoBase File Manager 上传图片到 MinIO 的解决方案

## 一、核心原理分析

### 1.1 NocoBase File Manager 架构

NocoBase 的文件管理系统由两部分组成：

1. **文件存储层 (Storage)**：定义文件存储的位置和方式（本地、MinIO、S3 等）
2. **附件管理层 (Attachment/File)**：管理文件的元数据（文件名、URL、大小、关联存储等）

你的 `newspaperPageImages` 是一个基于 `file` 模板的 collection，它的字段（filename、url、mimetype、path、size 等）都是文件管理器自动生成的。

### 1.2 上传流程

当通过 REST API 上传文件时：

```
客户端 multipart/form-data 请求
    ↓
NocoBase 路由匹配到 :create action
    ↓
multer 中间件解析文件
    ↓
StorageType (minio-storage) 的 make() 创建 MinioStorageEngine
    ↓
文件流通过 putObject() 上传到 MinIO
    ↓
生成 presigned URL (有效期 3600 秒)
    ↓
在 attachments 表（或 newspaperPageImages）创建记录
    ↓
返回文件元数据和 URL
```

### 1.3 关键代码路径

从 `MinioStorageType.ts:37-42` 可以看到 URL 生成逻辑：

```typescript
async getFileURL(file: AttachmentModel, preview?: boolean): Promise<string> {
    const { expires, bucketName, path } = this.storage.options;
    const normalizedPath = path ? path.replace(/^\/+|\/+$/g, '') : '';
    const objectName = normalizedPath ? `${normalizedPath}/${file.filename}` : file.filename;
    return await this.getClient().presignedGetObject(bucketName, objectName, expires)
}
```

## 二、解决方案

### 方案 1：使用 NocoBase REST API（推荐）

NocoBase 提供了统一的文件上传 API，可以自动处理文件存储并创建记录。

#### 2.1.1 前端/客户端方式（浏览器环境）

```javascript
/**
 * 上传本地图片到 NocoBase newspaperPageImages collection
 * @param {File} file - 文件对象 (从 <input type="file"> 获取)
 * @param {string} title - 文件标题
 * @param {string} apiUrl - NocoBase API 地址
 * @param {string} token - 认证令牌
 */
async function uploadImage(file, title, apiUrl, token) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('title', title);

    const response = await fetch(`${apiUrl}/newspaperPageImages:create`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
        },
        body: formData,
    });

    if (!response.ok) {
        throw new Error(`Upload failed: ${response.statusText}`);
    }

    const result = await response.json();
    return result.data;
}

// 使用示例
const input = document.querySelector('input[type="file"]');
const file = input.files[0];

const record = await uploadImage(
    file,
    'My Image Title',
    'http://ant:13000/api',
    'your-jwt-token-here'
);

console.log('Uploaded file URL:', record.url);
console.log('File ID:', record.id);
```

#### 2.1.2 Node.js 服务器端方式

```javascript
/**
 * Node.js 环境下上传本地图片到 NocoBase
 * 需要安装 axios 和 form-data
 */
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');

/**
 * 上传本地文件到 NocoBase
 * @param {string} filePath - 本地文件路径
 * @param {string} title - 文件标题
 * @param {string} apiUrl - NocoBase API 地址
 * @param {string} token - JWT 令牌
 */
async function uploadLocalImage(filePath, title, apiUrl, token) {
    const fileStream = fs.createReadStream(filePath);
    const formData = new FormData();
    formData.append('file', fileStream, { filename: title });
    formData.append('title', title);

    const response = await axios.post(
        `${apiUrl}/newspaperPageImages:create`,
        formData,
        {
            headers: {
                ...formData.getHeaders(),
                'Authorization': `Bearer ${token}`,
            },
        }
    );

    return response.data.data;
}

// 使用示例
async function main() {
    const record = await uploadLocalImage(
        '/path/to/local/image.jpg',
        'news-01',
        'http://ant:13000/api',
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
    );

    console.log('File URL:', record.url);
    console.log('File ID:', record.id);
}

main().catch(console.error);
```

#### 2.1.3 使用 NocoBase Repository（在 NocoBase 插件/服务中）

如果你在 NocoBase 的服务器端代码中（如另一个插件），可以直接使用 Repository：

```typescript
/**
 * 在 NocoBase 插件中上传文件
 * 使用 Repository 和 Action 方式
 */
class MyPluginServer extends Plugin {
    async uploadImage(filePath: string, title: string) {
        // 方法 1：直接使用 attachments repository 的 create  action
        // 注意：file 类型的 collection 会自动处理文件上传
        const repository = this.db.getRepository('newspaperPageImages');

        // 这里有个问题：Repository.create 主要处理 JSON 数据
        // 对于文件上传，需要通过 Action 机制
        // 下面是一种 hack 方式，实际推荐使用 REST API

        // 更好的方式是调用现有的 action
        const ctx = this.app.createAnonymousContext();
        ctx.request = {
            files: {
                file: [{
                    path: filePath,
                    originalname: title + '.jpg',
                    mimetype: 'image/jpeg',
                    size: fs.statSync(filePath).size,
                }]
            },
            body: {
                title: title,
            }
        };

        // 调用 file manager 的 create action
        await this.app.runAction('newspaperPageImages:create', ctx);

        return ctx.body?.data;
    }
}
```

### 方案 2：手动实现（需要更多代码，但更灵活）

如果你需要在服务器端完全控制上传流程：

```javascript
/**
 * 完全手动上传文件到 MinIO，然后创建记录
 * 步骤：
 * 1. 读取本地文件
 * 2. 上传到 MinIO
 * 3. 获取 presigned URL
 * 4. 创建 newspaperPageImages 记录
 */
const { Client } = require('minio');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

class NocoBaseFileUploader {
    constructor(config) {
        this.minioClient = new Client({
            endPoint: config.minioEndpoint,
            port: config.minioPort,
            accessKey: config.minioAccessKey,
            secretKey: config.minioSecretKey,
            useSSL: false,
        });
        this.bucketName = config.bucketName;
        this.pathPrefix = config.pathPrefix || '';
        this.apiUrl = config.apiUrl;
        this.token = config.token;
    }

    /**
     * 上传文件到 MinIO
     */
    async uploadToMinio(filePath, filename) {
        const objectName = this.pathPrefix
            ? `${this.pathPrefix}/${filename}`
            : filename;

        await this.minioClient.putObject(
            this.bucketName,
            objectName,
            fs.createReadStream(filePath),
            fs.statSync(filePath).size,
            { 'Content-Type': 'image/jpeg' }
        );

        return objectName;
    }

    /**
     * 生成 presigned URL（与 StorageTypeMinio 相同的逻辑）
     */
    async getPresignedUrl(filename) {
        const objectName = this.pathPrefix
            ? `${this.pathPrefix}/${filename}`
            : filename;

        return await this.minioClient.presignedGetObject(
            this.bucketName,
            objectName,
            3600 // expires in seconds
        );
    }

    /**
     * 创建 newspaperPageImages 记录
     */
    async createRecord(filename, title, extname, mimetype, size, url) {
        const response = await axios.post(
            `${this.apiUrl}/newspaperPageImages:create`,
            {
                title,
                filename,
                extname,
                mimetype,
                size,
                url,
                path: '',
                meta: {},
            },
            {
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                    'Content-Type': 'application/json',
                },
            }
        );

        return response.data.data;
    }

    /**
     * 完整上传流程
     */
    async uploadImage(filePath, title) {
        const extname = path.extname(filePath);
        const baseName = path.basename(filePath);
        const filename = `${Date.now()}-${baseName}`;

        // 步骤 1: 上传到 MinIO
        await this.uploadToMinio(filePath, filename);

        // 步骤 2: 获取 URL
        const url = await this.getPresignedUrl(filename);

        // 步骤 3: 创建记录
        const record = await this.createRecord(
            filename,
            title,
            extname,
            'image/jpeg',
            fs.statSync(filePath).size,
            url
        );

        return record;
    }
}

// 使用示例
const uploader = new NocoBaseFileUploader({
    minioEndpoint: 'ant',
    minioPort: 9000,
    minioAccessKey: 'your-access-key',
    minioSecretKey: 'your-secret-key',
    bucketName: 'mineru-doc-app',
    pathPrefix: 'dev/uploads',
    apiUrl: 'http://ant:13000/api',
    token: 'your-jwt-token',
});

const record = await uploader.uploadImage(
    '/path/to/image.jpg',
    'news-01'
);

console.log('Uploaded:', record.url);
```

## 三、回答你的核心问题

### 3.1 文件表中存的是什么？

你的理解是正确的。`newspaperPageImages` 表存储的只是 **presigned URL**（带签名的临时访问 URL），不是文件内容本身。文件实际存储在 MinIO 中。

### 3.2 是否提供了统一的 API？

**是的**，NocoBase 提供了统一的 REST API：

```
POST /api/{collectionName}:create
Content-Type: multipart/form-data
```

这个 API：
- 自动识别文件上传（通过 multer）
- 自动选择对应的 Storage 类型（你配置了 `storage: "storageDefaultMinio"`）
- 自动处理文件到存储后端的上传
- 自动生成 presigned URL
- 自动创建记录

**这就是统一 API 的价值**：无论底层是 MinIO、本地存储还是 S3，上传代码完全一样。将来换存储方式时，**不需要修改任何代码**。

### 3.3 如何设置 newspaperPageImages 的文件？

有两种方式：

#### 方式 A：通过 REST API 上传文件（推荐）

```javascript
// 这会自动：
// 1. 上传文件到 MinIO
// 2. 生成 presigned URL
// 3. 创建 newspaperPageImages 记录
// 4. 返回完整记录

const formData = new FormData();
formData.append('file', localFile);
formData.append('title', 'My Image');

const result = await fetch('http://ant:13000/api/newspaperPageImages:create', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token },
    body: formData,
});
```

#### 方式 B：先上传文件，再创建关联记录

如果你的业务场景是：已经有文件存在某处，想把它关联到 newspaperPageImages：

```javascript
// 场景：用户填表单，附件是已有的文件 ID

// 先上传文件获取 ID
const fileRecord = await uploadToFileCollection(filePath, 'image.jpg');

// 再创建主记录，关联文件
const post = await db.getRepository('posts').create({
    values: {
        title: 'Post Title',
        // 关键：使用 hasOne 或 belongsTo 关联
        attachmentId: fileRecord.id,  // 或者 attachment: { id: fileRecord.id }
    }
});
```

## 四、完整示例代码

### 4.1 完整 Node.js 脚本

```javascript
/**
 * 上传本地图片到 NocoBase newspaperPageImages collection
 * 使用方法: node upload.js /path/to/image.jpg "Image Title"
 */
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');

const API_URL = process.env.NOCOBAE_API_URL || 'http://ant:13000/api';
const TOKEN = process.env.NOCOBAE_TOKEN || 'your-jwt-token';

async function uploadImage(filePath, title) {
    if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
    }

    const fileStream = fs.createReadStream(filePath);
    const formData = new FormData();

    // formData 的 field name 必须是 'file'
    formData.append('file', fileStream, {
        filename: path.basename(filePath),
        contentType: getMimeType(filePath),
    });
    formData.append('title', title);

    console.log(`Uploading ${filePath} to ${API_URL}/newspaperPageImages:create...`);

    const response = await axios.post(
        `${API_URL}/newspaperPageImages:create`,
        formData,
        {
            headers: {
                ...formData.getHeaders(),
                'Authorization': `Bearer ${TOKEN}`,
            },
            maxBodyLength: Infinity, // 允许大文件
        }
    );

    console.log('Upload successful!');
    console.log('File ID:', response.data.data.id);
    console.log('File URL:', response.data.data.url);
    console.log('Preview:', response.data.data.preview);

    return response.data.data;
}

function getMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.svg': 'image/svg+xml',
    };
    return mimeTypes[ext] || 'application/octet-stream';
}

// CLI 使用
if (require.main === module) {
    const args = process.argv.slice(2);
    if (args.length < 2) {
        console.log('Usage: node upload.js <filePath> <title>');
        console.log('Example: node upload.js ./image.jpg "My Image"');
        process.exit(1);
    }

    uploadImage(args[0], args[1])
        .then(() => process.exit(0))
        .catch(err => {
            console.error('Error:', err.message);
            process.exit(1);
        });
}

module.exports = { uploadImage };
```

### 4.2 在 NocoBase 插件中使用

如果你需要在 NocoBase 插件中处理文件上传：

```typescript
/**
 * 在 NocoBase 插件中上传文件的示例
 * 场景：批量导入时上传图片
 */
import { Plugin } from '@nocobase/server';
import fs from 'fs';

export class MyPlugin extends Plugin {
    async importImages(imageDir: string) {
        const repository = this.db.getRepository('newspaperPageImages');
        const fileManager = this.app.pm.get('file-manager');

        const results = [];

        for (const filename of fs.readdirSync(imageDir)) {
            const filePath = path.join(imageDir, filename);
            if (!fs.statSync(filePath).isFile()) continue;

            // 方法：调用 file-manager 的 action
            const ctx = this.app.createAnonymousContext();
            ctx.request = {
                files: {
                    file: [{
                        path: filePath,
                        originalname: filename,
                        mimetype: this.getMimeType(filename),
                        size: fs.statSync(filePath).size,
                    }]
                },
                body: {
                    title: filename.replace(/\.[^/.]+$/, ''),
                }
            };

            // 调用 newspaperPageImages:create action
            await this.app.runAction('newspaperPageImages:create', ctx);

            if (ctx.body?.data) {
                results.push(ctx.body.data);
            }
        }

        return results;
    }

    private getMimeType(filename: string): string {
        const ext = path.extname(filename).toLowerCase();
        const mimeTypes: Record<string, string> = {
            '.jpg': 'image/jpeg',
            '.png': 'image/png',
            // ...
        };
        return mimeTypes[ext] || 'application/octet-stream';
    }
}
```

## 五、总结

1. **统一 API**：使用 `POST /api/newspaperPageImages:create` + `multipart/form-data`
2. **无需关心底层存储**：无论是 MinIO、S3 还是本地，代码都一样
3. **返回值包含 presigned URL**：直接用于预览和访问
4. **推荐使用方式**：通过 HTTP 客户端（axios、fetch）上传文件

这种方式的好处是：
- 解耦：业务代码不依赖具体存储实现
- 灵活：随时切换存储后端
- 标准化：符合 NocoBase 的设计模式
- 安全：presigned URL 有时效性
