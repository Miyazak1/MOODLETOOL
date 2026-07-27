# Baota Deployment Guide

This deployment path is for a small private OSSD course portal used by a few teachers.

## Recommended Server

```text
CPU: 2 cores
RAM: 4 GB
System disk: 40 GB
Data disk: 500 GB recommended for 30 courses
Bandwidth: 5 Mbps
OS: Ubuntu 22.04 or 24.04
Panel: Baota Linux
```

## Server Paths

Use separate folders for code and course resources:

```text
/www/wwwroot/ossd-course-portal
/www/wwwroot/ossd-portal/data
/www/wwwroot/ossd-portal/courseware-active
/www/wwwroot/ossd-portal/courseware-archive
```

The local equivalents are:

```text
D:\工作文件\SUNNYBROOK\ossd-course-portal
D:\工作文件\SUNNYBROOK\courseware
```

## Baota Software

Install:

```text
Nginx
Node.js project manager or PM2
Python 3
PM2 manager
SSL certificate
```

Server packages needed by the project:

```text
node >= 20
npm
python3
unzip
rsync or rclone
```

## Upload Files

Website code and course resources are uploaded separately. The release package only contains the portal code, built frontend, admin pages, scripts, deployment templates, and preflight reports. It does not contain `node_modules`, `courseware`, `courseware-archive`, `data`, or `inbox`.

On the local machine, build and package the website code:

```text
cd D:\工作文件\SUNNYBROOK\ossd-course-portal
npm run build
npm run preflight:baota
npm run package:baota
```

The generated archive and manifest are written to:

```text
D:\工作文件\SUNNYBROOK\ossd-course-portal\deployment\releases
```

Upload the newest `ossd-course-portal-baota-*.zip` or `.tar.gz` package to:

```text
/www/wwwroot/ossd-course-portal
```

Then extract it in that folder. The generated `.manifest.json` next to the archive is for checking what was included.

Upload active course resources to:

```text
/www/wwwroot/ossd-portal/courseware-active
```

The courseware folder should contain course directories:

```text
/www/wwwroot/ossd-portal/courseware-active/ENG3U/course-manifest.json
/www/wwwroot/ossd-portal/courseware-active/ENG3U/...
```

For first-launch courses, generate the course data transfer plan locally:

```text
npm run prepare:launch-transfer -- --courses ENG3U,ESLEO
npm run prepare:launch-status -- --courses ENG3U,ESLEO --out deployment/launch-course-status.json --force
```

Use the generated commands in:

```text
deployment/launch-course-transfer-plan.md
```

The transfer plan lists one rclone/SFTP or rsync command per selected course, local source folders, server target folders, file counts, total size, and largest files.

The launch status file is important for the first private deployment. It marks selected completed courses as `active` and every other catalog course as `archived`, so unfinished courses are hidden and direct `/courseware/<COURSE>/...` URLs return locked. Upload it to the server as:

```text
/www/wwwroot/ossd-portal/data/course-status.json
```

If this file already exists on the server, back it up before replacing it.

## Build

After extracting the release package, install production dependencies and rebuild once on the server:

```text
cd /www/wwwroot/ossd-course-portal
npm install --omit=dev
npm run build
npm run check:production-env -- --env .env.production
npm run verify:release
```

Before copying the site into production, run the Baota preflight. It checks the built `dist` files, catalog/manifests, referenced courseware paths, nginx template, service template, and current readiness gaps:

```text
npm run preflight:baota
```

If you are only launching selected completed courses first, run a stricter gate for that launch set:

```text
npm run check:launch-courses -- --courses ENG3U,ESLEO
npm run prepare:launch-transfer -- --courses ENG3U,ESLEO
npm run prepare:launch-status -- --courses ENG3U,ESLEO --out deployment/launch-course-status.json --force
```

This report ignores unrelated unfinished courses, but it blocks if a selected launch course is archived, missing its manifest, has incomplete iSpring according to the manifest audit, or references missing local files.

Reports are written to:

```text
deployment/baota-preflight-report.md
deployment/baota-preflight-report.json
deployment/launch-readiness-report.md
deployment/launch-readiness-report.json
deployment/launch-course-transfer-plan.md
deployment/launch-course-transfer-plan.json
deployment/launch-course-status.json
```

## Node Project

Start command:

```text
npm run start:production
```

Environment variables:

```text
ADMIN_UPLOADS_ENABLED=1
ADMIN_USERNAME=your-admin-name
ADMIN_PASSWORD=replace-with-a-strong-password
ADMIN_SESSION_SECRET=replace-with-a-long-random-secret
ADMIN_TOKEN=replace-with-another-long-random-secret
ADMIN_COOKIE_SECURE=1
PORTAL_AUTH_ENABLED=1
PORTAL_SESSION_SECRET=replace-with-a-long-random-secret
PORTAL_COOKIE_SECURE=1
PORTAL_DATA_DIR=/www/wwwroot/ossd-portal/data
COURSE_STATUS_FILE=/www/wwwroot/ossd-portal/data/course-status.json
COURSE_ACTIVE_ROOT=/www/wwwroot/ossd-portal/courseware-active
COURSE_ARCHIVE_ROOT=/www/wwwroot/ossd-portal/courseware-archive
X_ACCEL_COURSEWARE_PREFIX=/_protected_courseware/
PORTAL_USERS_JSON=[{"username":"admin","password":"CHANGE_ME_ADMIN_PASSWORD","role":"admin","courses":["*"]}]
LOGIN_RATE_LIMIT_MAX_FAILURES=8
LOGIN_RATE_LIMIT_WINDOW_SECONDS=900
LOGIN_RATE_LIMIT_LOCK_SECONDS=900
ADMIN_MAX_DOCUMENT_MB=100
ADMIN_MAX_ISPRING_MB=4096
# Optional only for authenticated Moodle batch document imports:
# MOODLE_COOKIE=MoodleSession=...
```

Create `/www/wwwroot/ossd-course-portal/.env.production` from `.env.production.example`, fill all passwords and secrets, then verify it before starting the Node project:

```text
npm run check:production-env -- --env .env.production
```

You can generate a strong initial environment file locally or on the server:

```text
npm run generate:production-env -- --out .env.production --courses ENG3U,ESLEO --domain your-domain.com
npm run check:production-env -- --env .env.production
```

The generator writes a separate `.credentials.txt` file beside the env file. Keep both private; the release package never includes generated `.env.production` files.

The check must have zero `BLOCK` lines before the site is exposed to teachers. Warnings are acceptable only when the tradeoff is intentional, such as temporarily setting Moodle import credentials for a batch job.

`npm run start:production` loads `.env.production`, runs the same environment check, and only then starts `server.mjs`.

## Nginx

Use HTTPS and proxy the app to Node. Do not expose `/courseware/` with `alias`; it must pass through Node for login and course-permission checks. Nginx only reads real files through an internal location after Node returns `X-Accel-Redirect`.

```nginx
client_max_body_size 4096m;

location /_protected_courseware/ {
    internal;
    alias /www/wwwroot/ossd-portal/courseware-active/;
    autoindex off;
    add_header Accept-Ranges bytes always;
}

location /courseware/ {
    proxy_pass http://127.0.0.1:8891;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location / {
    proxy_pass http://127.0.0.1:8891;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

## Checks

After deployment:

```text
https://your-domain/
https://your-domain/teacher-admin
https://your-domain/course-catalog.json
https://your-domain/courseware/ENG3U/course-manifest.json
```

Login to admin with `ADMIN_USERNAME` and `ADMIN_PASSWORD`.

Run the read-only deployed-site smoke test from your local machine or from the server:

```text
npm run smoke:deployed-site -- --base-url https://your-domain --username teacher1 --password TEACHER_PASSWORD --course ENG3U
```

If you also want to verify admin login without changing data:

```text
npm run smoke:deployed-site -- --base-url https://your-domain --username teacher1 --password TEACHER_PASSWORD --course ENG3U --admin-username ADMIN_USERNAME --admin-password ADMIN_PASSWORD
```

The smoke test checks login protection, teacher login, assigned course catalog visibility, course manifest access, one local view/download resource, and that `_admin_uploads` is not publicly readable.

Login rate limiting is enabled by default for both teacher portal login and the admin backend. With the recommended settings, repeated failed attempts from the same IP or same IP plus username are locked for 15 minutes. Keep `LOGIN_RATE_LIMIT_MAX_FAILURES=8` or stricter in production.

## Maintenance

Keep at least 15 GB free on the data disk. iSpring ZIP uploads temporarily use extra space during extraction.

Use the admin page maintenance buttons to:

```text
Read upload history
Clean temporary iSpring extraction folders
Clean uploaded iSpring ZIP originals
```

Upload history is stored in:

```text
/www/wwwroot/ossd-portal/courseware-active/<COURSE>/_admin_uploads/upload-history.jsonl
```

Back up:

```text
/www/wwwroot/ossd-course-portal
/www/wwwroot/ossd-portal/data
/www/wwwroot/ossd-portal/courseware-active
/www/wwwroot/ossd-portal/courseware-archive
Baota site config and environment variables
```

The project includes a backup command suitable for Baota scheduled tasks:

```text
cd /www/wwwroot/ossd-course-portal
npm run backup:courseware -- --source /www/wwwroot/ossd-portal/data --source /www/wwwroot/ossd-portal/courseware-archive --out /www/backup/ossd-course-portal --label ossd-critical --retention 7
```

Run a dry run first:

```text
npm run backup:courseware -- --source /www/wwwroot/ossd-portal/data --source /www/wwwroot/ossd-portal/courseware-archive --out /www/backup/ossd-course-portal --label ossd-critical --dry-run
```

Each backup writes an archive plus a `.json` manifest with source paths, file counts, byte counts, archive size, and pruned old archives.

Verify the latest backup without restoring anything:

```text
npm run verify:backup -- --out /www/backup/ossd-course-portal
```

Test restore into a separate directory:

```text
npm run restore:backup -- --archive /www/backup/ossd-course-portal/ossd-ossd-critical-backup-example.tar.gz --target /www/restore-test/ossd-critical --dry-run
npm run restore:backup -- --archive /www/backup/ossd-course-portal/ossd-ossd-critical-backup-example.tar.gz --target /www/restore-test/ossd-critical
```

Restore refuses non-empty targets unless `--force` is provided. Keep restores pointed at a test directory first, then manually replace live courseware only after verification.
