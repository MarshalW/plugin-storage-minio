import { AttachmentModel, StorageEngine, StorageType } from '@nocobase/plugin-file-manager';
import { Client } from 'minio';
import { MinioStorageEngine } from './MinioStorageEngine';

export class StorageTypeMinio extends StorageType {
    make(): StorageEngine {
        const { bucketName } = this.storage.options;
        return new MinioStorageEngine({
            minioClient: this.getClient(),
            bucketName,
        })
    }

    async delete(records: AttachmentModel[]): Promise<[number, AttachmentModel[]]> {

        const { bucketName } = this.storage.options;

        let successCount = 0;
        const failedRecords: AttachmentModel[] = [];

        for (const record of records) {
            try {
                await this.getClient().removeObject(bucketName, record.filename);
                successCount++;
            } catch (err) {
                failedRecords.push(record); // 记录删除失败的条目
            }
        }

        return [successCount, failedRecords];
    }

    async getFileURL(file: AttachmentModel, preview?: boolean): Promise<string> {
        const { expires, bucketName } = this.storage.options;
        return await this.getClient().presignedGetObject(bucketName, file.filename, expires)
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