分析下插件代码，在

@packages/plugins/@marshal/plugin-storage-minio/src/server

如果这样保存：

const pageImage = await fileManager.createFileRecord({
  filePath: '/path/to/your/local/image.jpg',
  storageName: 'storageDefaultMinio',
  collectionName: 'newspaperPageImages',
  values: {
    title: data.pageTitle,
    // 可以添加其他字段的值
  }
});

出现一个问题，监听：

newspaperPageImages.afterSave:

        this.app.db.on('newspaperPageImages.afterSave', async (page: any) => {
            // console.dir(page)
            if (!page._changed?.has('pageId')) return;

            const { id, pageId } = page
            console.log(`>>>>>pageImage, id: ${id}, pageId:${pageId} ✅`)

            const PageImages = this.app.db.getRepository('newspaperPageImages');
            const pageImage = await PageImages.findOne({
                filterByTk: page.id,
                appends: ['storage'],
            })

            if (!pageImage) {
                throw new Error('pageImage not found');
            }


会 throw new Error('pageImage not found');

如果：

        this.app.db.on('newspaperPageImages.afterSave', async (page: any) => {
            // console.dir(page)
            if (!page._changed?.has('pageId')) return;

            const { id, pageId } = page
            console.log(`>>>>>pageImage, id: ${id}, pageId:${pageId} ✅`)

            setTimeout(async () => {
                const PageImages = this.app.db.getRepository('newspaperPageImages');
                const pageImage = await PageImages.findOne({
                    filterByTk: page.id,
                    appends: ['storage'],
                })

                if (!pageImage) {
                    throw new Error('pageImage not found');
                }
        }, 100);

就可以正常运行

如果setTimeout 设置从 100 改为 0，也会 throw new Error('pageImage not found');

我判断是因为 minio storage 有一个延时

给分析下相关代码，是不是有需要 await 的地方，是异步处理了，造成这样的问题

虽然我设置 timeout 可以缓解这个问题，但如果io缓慢还是会报错

分析并形成报告，写在 plan/2026-02-06/1-answer.md 