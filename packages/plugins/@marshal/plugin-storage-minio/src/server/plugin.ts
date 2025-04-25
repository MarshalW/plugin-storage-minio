import { Plugin } from '@nocobase/server';
import { PluginFileManagerServer } from '@nocobase/plugin-file-manager';
import { StorageTypeMinio } from './MinioStorageType';

export class PluginStorageMinioServer extends Plugin {
  async afterAdd() { }

  async beforeLoad() { }

  async load() {
    const plugin = this.app.pm.get(PluginFileManagerServer);
    plugin.registerStorageType('minio-storage', StorageTypeMinio);
  }

  async install() { }

  async afterEnable() { }

  async afterDisable() { }

  async remove() { }
}

export default PluginStorageMinioServer;
