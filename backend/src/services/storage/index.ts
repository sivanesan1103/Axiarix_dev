import fs from 'node:fs/promises';
import path from 'node:path';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { env } from '../../config/env.js';

/**
 * Private object storage abstraction. Objects are never publicly addressable:
 * all downloads are streamed through the API after a permission check and a
 * short-lived signed download token (see evidence/report download routes).
 */
export interface StorageAdapter {
  readonly driver: string;
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  healthy(): Promise<boolean>;
}

/** Storage keys are generated server-side only; this guard rejects traversal attempts defensively. */
export function assertSafeKey(key: string) {
  if (!/^[a-zA-Z0-9/_\-.]+$/.test(key) || key.includes('..') || key.startsWith('/')) {
    throw new Error(`Unsafe storage key: ${key}`);
  }
}

class S3Storage implements StorageAdapter {
  readonly driver = 's3';
  private client = new S3Client({
    region: env.S3_REGION,
    endpoint: env.S3_ENDPOINT,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    credentials:
      env.S3_ACCESS_KEY && env.S3_SECRET_KEY
        ? { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY }
        : undefined,
  });
  private ready: Promise<void> | null = null;

  private ensureBucket() {
    this.ready ??= (async () => {
      try {
        await this.client.send(new HeadBucketCommand({ Bucket: env.S3_BUCKET }));
      } catch {
        await this.client.send(new CreateBucketCommand({ Bucket: env.S3_BUCKET }));
      }
    })().catch((e) => {
      this.ready = null;
      throw e;
    });
    return this.ready;
  }

  async put(key: string, body: Buffer, contentType: string) {
    assertSafeKey(key);
    await this.ensureBucket();
    await this.client.send(
      new PutObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: key,
        Body: body,
        ContentType: contentType,
        ServerSideEncryption: env.S3_ENDPOINT ? undefined : 'AES256',
      }),
    );
  }

  async get(key: string) {
    assertSafeKey(key);
    const out = await this.client.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
    const bytes = await out.Body!.transformToByteArray();
    return Buffer.from(bytes);
  }

  async delete(key: string) {
    assertSafeKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
  }

  async healthy() {
    try {
      await this.ensureBucket();
      return true;
    } catch {
      return false;
    }
  }
}

class LocalStorage implements StorageAdapter {
  readonly driver = 'local';
  private root = path.resolve(env.LOCAL_STORAGE_DIR);

  private resolve(key: string) {
    assertSafeKey(key);
    const full = path.resolve(this.root, key);
    if (!full.startsWith(this.root + path.sep)) throw new Error('Path traversal blocked');
    return full;
  }

  async put(key: string, body: Buffer) {
    const full = this.resolve(key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, body, { mode: 0o600 });
  }

  async get(key: string) {
    return fs.readFile(this.resolve(key));
  }

  async delete(key: string) {
    await fs.rm(this.resolve(key), { force: true });
  }

  async healthy() {
    await fs.mkdir(this.root, { recursive: true });
    return true;
  }
}

export const storage: StorageAdapter = env.STORAGE_DRIVER === 's3' ? new S3Storage() : new LocalStorage();
