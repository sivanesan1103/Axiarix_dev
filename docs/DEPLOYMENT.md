# Deployment

Hosting (hospital cloud or on-premises), identity provider, data residency and service levels are **open stakeholder decisions** (SRS §13). This guide describes a reference deployment that satisfies the security requirements.

## Reference topology

```
Internet / hospital LAN
   │ HTTPS (TLS 1.2+, hospital certificate)       NFR-SEC-01
   ▼
Load balancer / ingress (TLS termination, HSTS)
   ▼
web   (frontend/Dockerfile: nginx serving the SPA, proxies /api)   :8080
   ▼
api   (backend/Dockerfile: Node.js, runs `prisma migrate deploy` then starts)  :5050
   ├── PostgreSQL 16 (managed or VM; encrypted storage; private network)
   ├── S3-compatible bucket (private, SSE enabled, versioning on, no public access)
   ├── ClamAV clamd (MALWARE_SCANNER=clamav)
   └── SMTP relay (hospital mail)
```

## Steps

1. Provision PostgreSQL, a private bucket, ClamAV and an SMTP relay.
2. Build images:
   ```bash
   docker build -t axiarix-api ./backend
   docker build -t axiarix-web ./frontend
   ```
3. Configure the API environment (see `.env.example`) through a secrets manager, not files:
   - `NODE_ENV=production`, `COOKIE_SECURE=true`, `FRONTEND_ORIGIN=https://<host>`
   - Strong random secrets: `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `DOWNLOAD_TOKEN_SECRET` (≥32 characters), `MFA_ENCRYPTION_KEY` (exactly 32)
   - `DATABASE_URL` with TLS (`?sslmode=require`), `S3_*`, `MALWARE_SCANNER=clamav`, `CLAMAV_HOST`, `SMTP_*`
4. Run `api` (applies migrations on start) and `web` (its nginx proxies `/api` to the `api` host on the internal network).
5. Create the first administrator: in production, do **not** run the demo seed. Run only the reference/RBAC part once, then create the organisation and admin, e.g. with a one-off script based on `src/seed/seed-lib.ts` (`seedIsoReferences`, `seedRbac`) and a manually created admin user, or by using a staging seed and changing credentials before go-live.
6. Enable **Security policy → Enforce MFA for privileged roles** and ask admins, ISMS owners and auditors to enrol.
7. Confirm and configure upload limits, retention, scoring and report branding in **Settings**.

Startup without Docker: `cd backend && npm ci && npm run build && npx prisma migrate deploy && npm start`; `cd frontend && npm ci && npm run build`, then serve `dist/` with any static server that proxies `/api`.

## Operations

- **Health:** `GET /api/v1/health` (503 if the database or storage is down) for load balancer and monitoring checks.
- **Logs:** one JSON line per request on stdout (request id, path, status, latency, user). Ship them to the hospital SIEM.
- **Audit integrity:** run `GET /api/v1/audit-logs/verify` periodically and export the audit trail (CSV) to protected archival storage for stronger tamper resistance (NFR-SEC-06).
- **Reminders:** deadline reminders run every 6 hours inside the API process, and on demand from Settings.

## Backup & restore (NFR-SEC-09, NFR-07)

RPO/RTO are to be agreed with the hospital. Proposed baseline: nightly full backup, 15-minute WAL archiving, 30-day retention.

**Database**
```bash
# Backup (logical)
pg_dump --format=custom --no-owner "$DATABASE_URL" > axiarix-$(date +%F).dump
# Restore into an empty database
pg_restore --clean --if-exists --no-owner -d "$RESTORE_DATABASE_URL" axiarix-YYYY-MM-DD.dump
npx prisma migrate status   # confirm schema matches the release
```
For managed PostgreSQL, enable point-in-time recovery instead of relying on dumps alone.

**Evidence and report objects**
```bash
# MinIO client example – mirror the private bucket to a backup bucket or site
mc mirror --preserve prod/axiarix-private backup/axiarix-private-$(date +%F)
```
Enable bucket versioning and object lock where available. Database rows reference objects by `storageKey` and `checksum`; after a restore, verify integrity by re-scanning a sample (`POST /evidence/versions/:id/rescan` also verifies the SHA-256 checksum).

**Restore test (quarterly):** restore the database and bucket into a staging environment, start the API, sign in, open three evidence files and one report, and run `GET /audit-logs/verify`. Record the result in the ISMS records.

## Hardening checklist

- [ ] TLS everywhere; HSTS enabled (automatic in production mode)
- [ ] `COOKIE_SECURE=true`; single public origin for web and API
- [ ] Database and bucket on a private network; encryption at rest enabled (NFR-SEC-05)
- [ ] ClamAV enabled and kept up to date (`MALWARE_SCANNER=clamav`)
- [ ] Secrets in a secrets manager; rotate JWT secrets on compromise (forces re-login)
- [ ] Demo seed never run in production (`npm run db:seed` refuses when `NODE_ENV=production`)
- [ ] Administrative database access restricted and logged (NFR-SEC-10)
- [ ] Backups configured and a restore test performed
