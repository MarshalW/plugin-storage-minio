项目是 nocobase 插件，用于扩展兼容 s3 的 file manager 类型

使用的是 minio lib 实现的

通过加载 ./.env 文件的：

STORAGE_DEFAULT_TYPE=minio-storage
STORAGE_DEFAULT_NAME=storageDefaultMinio
STORAGE_DEFAULT_TITLE="Storage default minio"
STORAGE_DEFAULT_BASEURL=http://ant:9000/test
STORAGE_DEFAULT_ENDPOINT=ant
STORAGE_DEFAULT_PORT=9000
STORAGE_DEFAULT_ACCESSKEY=nm3GCqOVIFSb27tlcycs
STORAGE_DEFAULT_SECRETKEY=E5UNhXa5lMhSlRqUjFF8SIEc742JF8Ma6KHah3Rr
STORAGE_DEFAULT_BUCKETNAME=test

在 nocobase 中实现一个 file manager 实例，将 nocobase 附件类型数据保存到指定的 minio/s3 bucket 中

现在需要扩展一下：

- 存储到 bucket 下的指定路径下，比如 bucket name=‘myBucket’, 路径是 myBucket/dev/uploads


分析代码，见：

- packages/plugins/@marshal/plugin-storage-minio/src/server/plugin.ts


分析代码，主要是 minio lib 是否有支持（应该是有的）

如果可行，要求：

- .env 增加一个常量 STORAGE_DEFAULT_PATH
- STORAGE_DEFAULT_PATH 允许为空，就按照现在默认的逻辑走，相当于存储在 myBucket 根下
- 相应的，在前端增加一个输入框，代码见 packages/plugins/@marshal/plugin-storage-minio/src/client/index.tsx 