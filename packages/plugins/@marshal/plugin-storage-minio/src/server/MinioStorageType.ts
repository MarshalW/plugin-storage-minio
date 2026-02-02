import { AttachmentModel, StorageEngine, StorageType } from '@nocobase/plugin-file-manager';
import { Client } from 'minio';
import { MinioStorageEngine } from './MinioStorageEngine';

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
                failedRecords.push(record); // 记录删除失败的条目
            }
        }

        return [successCount, failedRecords];
    }

    async getFileURL(file: AttachmentModel, preview?: boolean): Promise<string> {
        const { expires, bucketName, path } = this.storage.options;
        const normalizedPath = path ? path.replace(/^\/+|\/+$/g, '') : '';
        const objectName = normalizedPath ? `${normalizedPath}/${file.filename}` : file.filename;
        return await this.getClient().presignedGetObject(bucketName, objectName, expires)
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