import { Plugin } from '@nocobase/client';
import { PluginFileManagerClient } from '@nocobase/plugin-file-manager/client';
import common from './common';

export class PluginStorageMinioClient extends Plugin {

  async load() {
    const plugin = this.app.pm.get<PluginFileManagerClient>('file-manager');
    plugin.registerStorageType('minio-storage', {
      title: `{{t("Minio storage")}}`,
      name: 'minio-storage',
      fieldset: {
        title: common.title,
        name: common.name,
        baseUrl: common.baseUrl,
        options: {
          type: 'object',
          'x-component': 'div',
          properties: {
            accessKey: {
              title: `AccessKey`,
              type: 'string',
              'x-decorator': 'FormItem',
              'x-component': 'TextAreaWithGlobalScope',
              required: true,
            },
            secretKey: {
              title: `SecretKey`,
              type: 'string',
              'x-decorator': 'FormItem',
              'x-component': 'TextAreaWithGlobalScope',
              required: true,
            },
            bucketName: {
              title: `BucketName`,
              type: 'string',
              'x-decorator': 'FormItem',
              'x-component': 'TextAreaWithGlobalScope',
              required: true,
            },
            endPoint: {
              title: `Endpoint`,
              type: 'string',
              'x-decorator': 'FormItem',
              'x-component': 'TextAreaWithGlobalScope',
              default: 'localhost',
            },
            port: {
              title: `Port`,
              type: 'number',
              'x-decorator': 'FormItem',
              'x-component': 'InputNumber',
              default: 9000,
            },
            region: {
              title: `Region`,
              type: 'string',
              'x-decorator': 'FormItem',
              'x-component': 'TextAreaWithGlobalScope',
            },
            useSSL: {
              title: `UseSSL`,
              type: 'boolean',
              'x-decorator': 'FormItem',
              'x-component': 'Checkbox',
            },
            expires: {
              title: `Expires`,
              type: 'number',
              'x-decorator': 'FormItem',
              'x-component': 'InputNumber',
              default: 3600,
            },
          },

        },
        rules: common.rules,
        default: common.default,
        paranoid: common.paranoid,
      },
    });
  }
}

export default PluginStorageMinioClient;
