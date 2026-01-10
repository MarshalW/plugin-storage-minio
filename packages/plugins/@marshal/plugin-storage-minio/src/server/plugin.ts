import { Plugin } from '@nocobase/server';
import { PluginFileManagerServer } from '@nocobase/plugin-file-manager';
import { StorageTypeMinio } from './MinioStorageType';

export class PluginStorageMinioServer extends Plugin {
  async afterAdd() { }

  async beforeLoad() { }

  async load() {
    const plugin = this.app.pm.get(PluginFileManagerServer);
    plugin.registerStorageType('minio-storage', StorageTypeMinio);

    this.app.resourceManager.define({
      name: 'dl',
      actions: {
        myFile: async (ctx, next) => {
          const { attachmentId } = ctx.action.params;

          const filePlugin = this.app.pm.get(PluginFileManagerServer) as PluginFileManagerServer;
          const AttachmentRepo = this.db.getRepository('attachments');
          const record = await AttachmentRepo.findOne({
            filterByTk: attachmentId,
            appends: ['storage'],
          });

          if (!record) {
            return ctx.throw(404, '附件不存在');
          }

          const { stream, contentType } = await filePlugin.getFileStream(record);

          ctx.type = contentType || 'application/octet-stream';
          ctx.set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(record.filename)}`);
          ctx.body = stream;

          await next();
        },
      },
    });

    this.app.acl.allow('dl', '*', 'public');
  }

  async install() { }

  async afterEnable() { }

  async afterDisable() { }

  async remove() { }
}

export default PluginStorageMinioServer;
