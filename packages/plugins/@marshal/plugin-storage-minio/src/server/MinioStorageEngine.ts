import multer from 'multer';
import { Client } from 'minio';


interface ItemBucketMetadata {
    [key: string]: string;
}

interface MinioStorageOptions {
    minioClient: Client;
    bucketName: string;
    // 可选：为上传的文件生成自定义名称
    filename?: (req: Express.Request, file: Express.Multer.File) => Promise<string>;
    // 可选：自定义元数据
    metadata?: (req: Express.Request, file: Express.Multer.File) => Promise<ItemBucketMetadata>;
}

export class MinioStorageEngine implements multer.StorageEngine {
    private minioClient: Client;
    private bucketName: string;
    private filename?: (req: Express.Request, file: Express.Multer.File) => Promise<string>;
    private metadata?: (req: Express.Request, file: Express.Multer.File) => Promise<ItemBucketMetadata>;

    constructor(options: MinioStorageOptions) {
        this.minioClient = options.minioClient;
        this.bucketName = options.bucketName;
        this.filename = options.filename;
        this.metadata = options.metadata;
    }

    _handleFile(
        req: Express.Request,
        file: Express.Multer.File,
        callback: (error?: any, info?: Partial<Express.Multer.File>) => void
    ): void {
        const generateFilename = this.filename
            ? this.filename(req, file)
            : Promise.resolve(Date.now() + '-' + file.originalname);

        const generateMetadata = this.metadata
            ? this.metadata(req, file)
            : Promise.resolve({});


        Promise.all([generateFilename, generateMetadata])
            .then(async ([filename, metadata]) => {
                // multer 的 bug: https://github.com/expressjs/multer/issues/1104
                const _fileName = Buffer.from(filename, 'latin1').toString('utf-8')
                try {
                    await this.minioClient.putObject(
                        this.bucketName,
                        _fileName,
                        file.stream,
                        file.size,
                        metadata
                    );

                    const info = {
                        filename: _fileName,
                        bucketName: this.bucketName,
                        size: file.size,
                        mimetype: file.mimetype,
                        originalname: file.originalname,
                    };

                    callback(null, info);
                } catch (err) {
                    callback(err);
                }
            })
            .catch(callback);
    }

    // 只为实现接口，实际删除文件时没有调用这个函数
    _removeFile(
        req: Express.Request,
        file: Express.Multer.File & { bucketName?: string; filename?: string },
        callback: (error: Error | null) => void
    ): void {
        if (!file.filename || !file.bucketName) {
            callback(new Error('File information is incomplete'));
            return;
        }

        this.minioClient.removeObject(file.bucketName, file.filename)
            .then(() => callback(null))
            .catch(err => callback(err));
    }
}