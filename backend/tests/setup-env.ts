import os from 'node:os';
import path from 'node:path';

// Integration tests use an isolated database and local file storage.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://axiarix:axiarix_dev_only@localhost:5433/axiarix_test?schema=public';
process.env.STORAGE_DRIVER = 'local';
process.env.LOCAL_STORAGE_DIR = path.join(os.tmpdir(), 'axiarix-test-storage');
process.env.SMTP_HOST = '';
