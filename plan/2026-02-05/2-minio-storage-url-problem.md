代码：

    const fileManager = this.app.pm.get(PluginFileManagerServer);
    console.log(`>>>>>>fileManager: ${fileManager} ✅`)

    // 一步完成上传和记录创建
    const record = await fileManager.createFileRecord({
      filePath: '/home/ubuntu/plugin-mineru-doc/news-02.jpg',
      storageName: 'storageDefaultMinio',
      collectionName: 'newspaperPageImages',
      values: {
        title: '自定义标题',
        // 可以添加其他字段的值
      }
    });

    console.log(`>>>>>>record: ${record} ✅`)

这样确实是可以保存图片到表里的

主要依据的文档：

plan/2026-02-05/1-answer.md

但是有个问题，生成的 url：

http://ant:9000/mineru-doc-app/dev/uploads/1770294135248-news-01.jpg?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=nm3GCqOVIFSb27tlcycs%2F20260205%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20260205T122224Z&X-Amz-Expires=3600&X-Amz-SignedHeaders=host&X-Amz-Signature=23cfca8dff112087fb87166a3e13989631b1ebe633d72057714b2edbcfe6f922


是一个预签名的url，也就是说，它有过期时间

这个怎么解决？

是我的插件写的有问题么？

代码在 packages/plugins/@marshal/plugin-storage-minio/src/server 目录下

还是 nocobase file manager 框架自身问题 -- 我注意到它官方实现的s3，是没有预签名能力的‘


我是既希望有预签名，又不希望自己在服务器端代码实现方面被这个限制影响

给出你的分析和建议，形成文档： plan/2026-02-05/2-answer.md