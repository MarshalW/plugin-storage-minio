import { Plugin } from '@nocobase/server';
import { PluginFileManagerServer } from '@nocobase/plugin-file-manager';
import { StorageTypeMinio } from './MinioStorageType';

export class PluginStorageMinioServer extends Plugin {
  async afterAdd() {
    this.app.on('afterInstall', async () => {
      await this.afterInstall()
    })
  }

  async beforeLoad() { }

  // 安装后执行
  async afterInstall() {
    // minio storage - file manager
    // 确保只在你需要的地方执行一次，例如 app.ts 或启动脚本里
    if (process.env.STORAGE_DEFAULT_TYPE) {
      const Storages = this.app.db.getRepository('storages');

      await Storages.create({
        values: {
          id: 346055714406400,
          type: process.env.STORAGE_DEFAULT_TYPE,
          name: process.env.STORAGE_DEFAULT_NAME || 'storageDefaultMinio',
          title: process.env.STORAGE_DEFAULT_TITLE || 'Storage default minio',
          baseUrl: process.env.STORAGE_DEFAULT_BASEURL,
          options: {
            endPoint: process.env.STORAGE_DEFAULT_ENDPOINT || 'localhost',
            port: Number(process.env.STORAGE_DEFAULT_PORT) || 9000,
            expires: 3600,          // 固定值，可按需提取到环境变量
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
    }
  }
  async load() {
    const plugin = this.app.pm.get(PluginFileManagerServer);
    plugin.registerStorageType('minio-storage', StorageTypeMinio);

    // 需要测试的时候可以下载附件
    // this.app.resourceManager.define({
    //   name: 'dl',
    //   actions: {
    //     myFile: async (ctx, next) => {
    //       const { attachmentId } = ctx.action.params;

    //       const filePlugin = this.app.pm.get(PluginFileManagerServer) as PluginFileManagerServer;
    //       const AttachmentRepo = this.db.getRepository('attachments');
    //       const record = await AttachmentRepo.findOne({
    //         filterByTk: attachmentId,
    //         appends: ['storage'],
    //       });

    //       if (!record) {
    //         return ctx.throw(404, '附件不存在');
    //       }

    //       const { stream, contentType } = await filePlugin.getFileStream(record);

    //       ctx.type = contentType || 'application/octet-stream';
    //       ctx.set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(record.filename)}`);
    //       ctx.body = stream;

    //       await next();
    //     },
    //   },
    // });

    // this.app.acl.allow('dl', '*', 'public');
  }

  async install() { }

  async afterEnable() { }

  async afterDisable() { }

  async remove() { }
}

export default PluginStorageMinioServer;
