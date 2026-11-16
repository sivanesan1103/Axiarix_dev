import { execSync } from 'node:child_process';

/** Applies migrations to the test database once before the suite. */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL ?? 'postgresql://axiarix:axiarix_dev_only@localhost:5433/axiarix_test?schema=public';
  execSync('npx prisma migrate deploy', { stdio: 'inherit', env: { ...process.env, DATABASE_URL: url } });
}
