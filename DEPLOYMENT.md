# Deployment Plan

This project deploys the lightweight portal and the large courseware package together on a private cloud server. The frontend build stays small, but the courseware folder is served by the same protected website.

## Build Outputs

Frontend:

```text
ossd-course-portal/dist/
```

Courseware source:

```text
../courseware/
```

Courseware should not be bundled into the frontend build. Keep it as a sibling server folder and expose it through `/courseware/`.

## Recommended Hosting Model

Use one purchased Linux server:

```text
/var/www/ossd-course-portal/
/var/www/ossd-courseware/
  <COURSE>/
```

The Node service runs `server.mjs --root dist --port 8891`. nginx serves `/courseware/` from `/var/www/ossd-courseware/` and proxies the portal/admin routes to Node.

Recommended software:

- Node.js LTS
- nginx
- LibreOffice headless if DOCX/PPTX/XLSX files must be previewed online

## Production Environment

Copy `.env.production.example` to `.env.production` and set:

```text
VITE_COURSE_CATALOG_URL=/course-catalog.json
VITE_COURSE_MANIFEST_URL=/courseware/ENG3U/course-manifest.json
VITE_COURSE_BASE_URL=/courseware/ENG3U/
```

For multiple courses, edit `public/course-catalog.json` and add one entry per course. Each entry needs:

- `code`
- `title`
- `manifestUrl`
- `baseUrl`

Then build:

```text
npm.cmd run validate:manifest
npm.cmd run audit:online-resources
npm.cmd run audit:content-workbench
npm.cmd run export:preview-queue
npm.cmd run export:ispring-queue
npm.cmd run export:courseware-list
npm.cmd run build
```

## Courseware Upload List

Generate the upload list:

```text
npm.cmd run export:courseware-list
```

Output:

```text
deployment/ENG3U-courseware-upload-list.json
```

Each item contains:

- local source path
- target object key
- size
- role

Use the `key` field as the server-relative file path under `/var/www/ossd-courseware/`. The expected hosted structure is:

```text
<COURSE>/course-manifest.json
<COURSE>/...
```

## Access Control

Use a private teacher-only website. Do not expose Moodle token URLs.

Recommended production access:

- Require portal-level login or Basic Auth for the frontend.
- Protect `/courseware/` with the same access control, because nginx may serve those files directly.
- Keep `/teacher-admin` and `/api/admin/*` behind the admin login and, preferably, an additional nginx restriction.

## Teacher Admin Uploads

The Node server includes a protected upload page:

```text
/teacher-admin
```

Uploads are disabled by default. Enable them only on a protected server:

```text
ADMIN_UPLOADS_ENABLED=1
ADMIN_USERNAME=<admin-username>
ADMIN_PASSWORD=<strong-password>
ADMIN_SESSION_SECRET=<long-random-secret>
ADMIN_TOKEN=<long-random-token>
```

Supported uploads include course outline, introduction, unit plan, lesson plan, and complete iSpring ZIP packages. See `ADMIN.md`.

The web admin is retained as a support tool. Most data updates should still be handled by maintainer/Codex batch workflows: download or collect files, import into `courseware/<COURSE>/`, rebuild manifests, generate previews, and run readiness audits.

## Online File Preview

The portal keeps original files downloadable and opens a preview/playback version for online viewing. PDF, TXT/MD, images, MP4, HTML/H5P, and iSpring packages can be opened directly by the browser.

The hosted site requirement is: every completed course resource must have both an online view/play action and a download action. For Office documents, `在线查看` uses the generated PDF preview, while `下载` keeps the original DOCX/PPTX/XLSX file.

For DOCX, PPTX, and XLSX, install LibreOffice on the server and generate PDF previews after imports or uploads:

```text
sudo apt install libreoffice
cd /var/www/ossd-course-portal
npm run generate:previews
```

If LibreOffice is installed somewhere custom, set:

```text
LIBREOFFICE_BIN=/path/to/soffice
```

Preview PDFs are written to `courseware/<COURSE>/previews/`, while the original Office files remain the download files.
The command continues after individual conversion failures and writes:

```text
deployment/document-preview-generation-report.md
deployment/document-preview-generation-report.json
```

Use `--dry-run` to estimate work without writing previews:

```text
npm run generate:previews -- --dry-run
```

Before deployment, check the online-view/download readiness report:

```text
npm run audit:online-resources
npm run audit:content-workbench
npm run export:preview-queue
```

The report is written to:

```text
deployment/online-resource-readiness.md
deployment/office-preview-queue.md
```

Use `deployment/office-preview-queue.md` for the prioritized per-course preview commands. The raw issue count can be higher than the unique preview count because the same file may appear in more than one course/lesson resource slot.

To make web-admin document uploads generate previews automatically, set:

```text
GENERATE_PREVIEWS_AFTER_UPLOADS=1
LIBREOFFICE_BIN=/usr/bin/soffice
```

Batch Moodle imports also try to generate previews after each successful import. If LibreOffice is missing, the import still completes and prints a preview warning.
The teacher admin maintenance area can also generate previews for the currently selected course after deployment.

## Linux Server Templates

Templates are included in `deployment/`:

```text
deployment/nginx-ossd-course-portal.conf
deployment/ossd-course-portal.service
```

Recommended server flow:

```text
git clone <your-github-repo-url> /var/www/ossd-course-portal
cd /var/www/ossd-course-portal
npm install
npm run build
cp .env.production.example .env.production
npm run check:production-env -- --env .env.production
sudo cp deployment/ossd-course-portal.service /etc/systemd/system/
sudo systemctl enable --now ossd-course-portal
sudo cp deployment/nginx-ossd-course-portal.conf /etc/nginx/sites-available/ossd-course-portal
sudo ln -s /etc/nginx/sites-available/ossd-course-portal /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

For later code releases, push local changes to GitHub first, then update the server with:

```text
cd /var/www/ossd-course-portal
git pull
npm install
npm run build
npm run check:production-env -- --env .env.production
sudo systemctl restart ossd-course-portal
sudo nginx -t
sudo systemctl reload nginx
```

Do not store courseware, `.env.production`, user data, session data, upload inboxes, or release ZIPs in GitHub. Keep courseware on the server data disk and transfer large course files separately with rclone/rsync/SFTP or the admin upload workflow.

The nginx template sets `client_max_body_size 2048m` for iSpring ZIP uploads and serves `/courseware/` as static files with byte-range support.

## Release Checklist

Before publishing:

- `npm.cmd run validate:manifest` passes.
- `npm.cmd run audit:online-resources` has no preview/download gaps for completed courses.
- `npm.cmd run audit:content-workbench` has been reviewed for remaining content gaps.
- `npm.cmd run export:preview-queue` has been reviewed for Office PDF preview work.
- `npm.cmd run export:ispring-queue` has been reviewed for missing iSpring lesson ZIPs.
- `npm.cmd run build` passes.
- Courseware files are copied to `/var/www/ossd-courseware/`.
- `.env.production` uses same-server `/courseware/...` URLs unless the hosting model is deliberately changed.
- Office previews have been generated on the server with LibreOffice.
- At least one iSpring package from each Unit has been tested over HTTP.
- Copyright status for Unit 5 modern short stories remains marked as review/link-only unless permissions are confirmed.
