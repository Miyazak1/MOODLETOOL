# Teacher Admin Uploads

The course portal includes a minimal teacher admin page:

```text
/teacher-admin
```

Admin uploads are disabled by default. Enable them only on a protected server with HTTPS.

```text
set ADMIN_UPLOADS_ENABLED=1
set ADMIN_USERNAME=admin
set ADMIN_PASSWORD=replace-with-a-strong-password
set ADMIN_SESSION_SECRET=replace-with-a-long-random-secret
set ADMIN_TOKEN=replace-with-a-long-random-token
npm.cmd run preview
```

PowerShell example:

```text
$env:ADMIN_UPLOADS_ENABLED="1"
$env:ADMIN_USERNAME="admin"
$env:ADMIN_PASSWORD="replace-with-a-strong-password"
$env:ADMIN_SESSION_SECRET="replace-with-a-long-random-secret"
$env:ADMIN_TOKEN="replace-with-a-long-random-token"
npm.cmd run preview
```

`ADMIN_USERNAME` and `ADMIN_PASSWORD` are used by the `/teacher-admin` login page. `ADMIN_SESSION_SECRET` signs the HttpOnly session cookie. `ADMIN_TOKEN` remains as a fallback/internal API token and should still be random.

If the site is served over HTTPS, also set:

```text
ADMIN_COOKIE_SECURE=1
```

## Supported Uploads

- Course Outline
- Introduction
- Unit Plan
- Lesson Plan
- Literary Text
- iSpring ZIP
- iSpring ZIP Batch

Literary Text uploads are stored under `courseware/<COURSE>/texts/<TEXT_ID>/` and then attached to the selected text entry in that course manifest. Full course textbooks/course packs should still be handled as a reviewed resource set before being exposed to teachers.

The admin page is a retained support entry, not the main production data pipeline. For normal course updates, the preferred flow is maintainer/Codex batch work: collect or download files, import them into `courseware/<COURSE>/`, rebuild manifests, generate Office previews, and run the online resource audit. Use `/teacher-admin` for small replacements, missing one-off documents, emergency fixes, or iSpring ZIP batches that are easier to upload from the server UI.

Default size limits:

- Course documents and planning files: 50 MB
- iSpring ZIP / iSpring ZIP Batch: 2048 MB

Override these with:

```text
ADMIN_MAX_DOCUMENT_MB=100
ADMIN_MAX_ISPRING_MB=4096
```

After each upload, the server rebuilds the selected course manifest:

```text
courseware/<COURSE>/course-manifest.json
```

ENG3U uses the iSpring-aware manifest builder. Other courses currently use the plan-only manifest builder generated from planning documents.
Plan-only courses also reserve a stable lesson folder such as `lessons/U01L01/`, so an uploaded iSpring ZIP can be attached to the selected lesson and indexed after the manifest rebuild.

For online viewing of Office documents, run the preview generator after batch imports or after uploading DOCX/PPTX/XLSX files:

```text
npm run generate:previews -- --course ENG3U
```

The generator uses LibreOffice headless to create PDF previews under `courseware/<COURSE>/previews/`. The original Office file remains the download file, and the generated PDF is used by the `在线查看` button.
The generator continues after individual conversion failures and writes a report to:

```text
deployment/document-preview-generation-report.md
```

## Authenticated Moodle Text Imports

Some English/literacy courses have Moodle resource links for source texts. To turn those into local files that teachers can view/download from this portal, first generate or refresh the Moodle localization queue:

```text
npm.cmd run export:moodle-localization-queue
```

Preview the text-source rows for one course:

```text
npm.cmd run download:moodle-texts -- --course ENG2D --dry-run
```

To download and attach the files, run the command with temporary Moodle credentials in the shell environment:

```text
set MOODLE_USERNAME=your-moodle-username
set MOODLE_PASSWORD=your-moodle-password
npm.cmd run download:moodle-texts -- --course ENG2D --apply-manifest
```

The script writes files to `courseware/<COURSE>/texts/<TEXT_ID>/`, updates `courseware/<COURSE>/course-manifest.json` when `--apply-manifest` is present, and records the result in `deployment/moodle-text-download-report-<COURSE>.md`.

On the production server, document uploads can run this automatically:

```text
GENERATE_PREVIEWS_AFTER_UPLOADS=1
LIBREOFFICE_BIN=/usr/bin/soffice
```

If LibreOffice is missing, the upload still succeeds and the response records a preview warning. The original file remains downloadable, and previews can be regenerated after LibreOffice is installed.

For completed courses, do not stop at a successful upload. Run or trigger preview generation and then check:

```text
npm.cmd run audit:online-resources
```

Completed resources should have both a view/play source and a download source. iSpring entries need a playable `presentation.html` path and a downloadable ZIP path.

The admin maintenance area also has `生成当前课程预览`, which calls `/api/admin/generate-previews` for the selected course. Use it after a batch of Office documents has been uploaded or imported, then check the preview generation report if any files still lack online preview.

The admin upload form loads Unit and Lesson options from the selected course manifest. Course-level files and iSpring ZIP Batch uploads do not need a Unit or Lesson. Unit Plan and Lesson Plan uploads can use the next generated Unit/Lesson option. Single iSpring ZIP uploads must be attached to an existing lesson, because the server installs the extracted package inside that lesson folder.

After a successful upload, the admin page refreshes the selected course manifest, current course status, and all-course readiness summary automatically. If the upload created a backup, the backup list is refreshed as well.

When an upload replaces an existing course document, unit plan, lesson plan, or installed iSpring package, the old file or folder is backed up before replacement. Backup paths are returned in the upload response and recorded in upload history.

```text
courseware/<COURSE>/_admin_uploads/backups/
```

The `读取备份列表` button calls `/api/admin/backups` and lists the backup folders for the selected course. Restore is intentionally manual for now, so an accidental click cannot roll a course backward.

`_admin_uploads` is admin-only storage. The Node server and nginx template block public `/courseware/<COURSE>/_admin_uploads/...` access.

For whole-courseware backups, use:

```text
npm.cmd run backup:courseware
```

This creates a timestamped archive and a JSON sidecar manifest under `../backups/ossd-course-portal/` by default. On a production server, point `--out` to a disk or backup mount outside the public website folders:

```text
npm run backup:courseware -- --out /www/backup/ossd-course-portal --retention 7
```

Verify the latest backup after the scheduled task runs:

```text
npm run verify:backup -- --out /www/backup/ossd-course-portal
```

Test a restore into a separate directory before touching live courseware:

```text
npm run restore:backup -- --archive /www/backup/ossd-course-portal/ossd-courseware-backup-example.zip --target /www/restore-test/ossd-courseware --dry-run
npm run restore:backup -- --archive /www/backup/ossd-course-portal/ossd-courseware-backup-example.zip --target /www/restore-test/ossd-courseware
```

The restore command refuses non-empty targets by default. Do not point it at the live courseware directory unless the server has been stopped, the target has been checked, and a fresh backup exists.

## iSpring ZIP Uploads

iSpring must be uploaded as a complete ZIP package. The ZIP must contain:

```text
presentation.html
lms.js
data/
```

The admin endpoint extracts the ZIP, finds the folder containing `presentation.html`, and installs it into the selected lesson as:

```text
html5-package-admin/
```

The manifest generator indexes `html5-package*`, so the uploaded package appears as an iSpring page entry.
The uploaded ZIP is also kept beside the installed package as `html5-package-admin.zip`; the manifest exposes it as `downloadPath`, so teachers can play the iSpring page online and download the original package from the portal.
For plan-only courses, the installed package lives under the lesson folder, for example:

```text
courseware/MCR3U/lessons/U01L01/html5-package-admin/
courseware/MCR3U/lessons/U01L01/html5-package-admin.zip
```

For older iSpring packages that already exist only as extracted folders, create downloadable ZIPs from the installed package folders:

```text
npm run package:ispring-downloads -- --course ENG3U
```

This writes sibling ZIP files such as `html5-package.zip` and rebuilds the manifest so the teacher portal shows the iSpring `下载` action.

For web-admin batch upload, select `iSpring ZIP Batch` and upload one outer ZIP for the selected course. Put one iSpring ZIP per lesson inside the outer ZIP. Supported inner ZIP names:

```text
MCR3U_U01_L01.zip
MCR3U_U01L01.zip
U01_L01.zip
U01L01.zip
```

The server skips inner ZIPs whose filenames do not match a lesson or whose package does not contain `presentation.html`. Installed packages are reported in the upload response, and the course manifest is rebuilt once after the batch finishes.

## Maintenance

The admin page can show per-course storage information, readiness gaps, read upload history, and clean temporary iSpring extraction folders.

The `读取状态` button shows:

- course outline and introduction status
- unit plan and lesson plan coverage
- iSpring connection status
- text review items
- courseware and admin upload storage usage

The `读取全课程缺口` button calls `/api/admin/readiness` and shows the same readiness fields across every course in the catalog. Use it after uploading a batch of outlines, plans, or iSpring ZIPs to confirm which courses still need attention.

The `读取上传清单` button calls `/api/admin/upload-gaps` and turns the same gaps into upload tasks with course code, upload type, Unit/Lesson target, and a suggested filename. The same checklist can be exported locally with:

```text
npm.cmd run export:gap-checklist
```

Output files:

```text
deployment/upload-gap-checklist.md
deployment/upload-gap-checklist.json
```

The `读取内容工作台` button calls `/api/admin/content-workbench` and shows the prioritized per-course dashboard from:

```text
deployment/course-content-workbench.md
```

Use it as the main queue for deciding which course outline, iSpring package, preview batch, or text review to handle next.

For Office preview generation planning, export the prioritized preview queue:

```text
npm.cmd run export:preview-queue
```

Outputs:

```text
deployment/office-preview-queue.md
inbox/office-preview-queue.csv
```

Use it on the server after LibreOffice is installed. It lists per-course `npm run generate:previews -- --course <COURSE>` commands in content-priority order.

For iSpring package collection, export the lesson ZIP queue:

```text
npm.cmd run export:ispring-queue
```

Outputs:

```text
deployment/ispring-package-queue.md
inbox/ispring-package-queue.csv
```

The CSV lists expected lesson ZIP filenames such as `SBI3U_U01_L01.zip`, matching the batch import naming rules.

For a local batch import, place files in:

```text
ossd-course-portal/inbox/upload-gaps/
```

Use the suggested filenames from the checklist, then run:

```text
npm.cmd run import:gap-files -- --dry-run
npm.cmd run import:gap-files -- --rebuild-manifest
```

Files can also be grouped by course, for example:

```text
ossd-course-portal/inbox/upload-gaps/MCR3U/MCR3U_Course_Outline.pdf
```

The batch importer does not overwrite existing courseware files unless `--overwrite` is passed.

To prepare a human-friendly collection folder from the current checklist, run:

```text
npm.cmd run prepare:collection-inbox
```

This writes:

```text
ossd-course-portal/inbox/collection/
```

The collection folder contains per-course README files for direct uploads, iSpring batch ZIP naming, and text review items. It does not create placeholder course files. After collecting real direct-upload files, you can leave them in `ossd-course-portal/inbox/collection/direct-uploads/<COURSE>/` and run `npm.cmd run import:gap-files -- --rebuild-manifest`, or upload them through `/teacher-admin`.

For local batch iSpring imports, put ZIP packages into:

```text
ossd-course-portal/inbox/ispring/<COURSE>/
```

Supported ZIP names:

```text
MCR3U_U01_L01.zip
MCR3U_U01L01.zip
U01_L01.zip
U01L01.zip
```

Then run:

```text
npm.cmd run import:ispring-packages -- --course MCR3U --dry-run
npm.cmd run import:ispring-packages -- --course MCR3U --overwrite
```

The batch importer uses the selected course manifest to find the matching lesson folder, installs each ZIP as `html5-package-admin/`, and rebuilds the manifest.
It also reads ZIPs from `ossd-course-portal/inbox/collection/ispring-batches/<COURSE>/`, so the collection folder can be used directly for local imports.

Upload history is stored per course:

```text
courseware/<COURSE>/_admin_uploads/upload-history.jsonl
```

Temporary iSpring extraction folders live under:

```text
courseware/<COURSE>/_admin_uploads/ispring-extracted/
courseware/<COURSE>/_admin_uploads/ispring-batch-extracted/
```

Interrupted ordinary uploads may leave temporary incoming files under:

```text
courseware/<COURSE>/_admin_uploads/incoming/
```

The `清理临时上传/解压目录` button removes temporary incoming upload files and temporary iSpring extraction folders. It does not remove installed iSpring packages, backups, upload history, or ordinary course documents.

The `清理 iSpring ZIP 原包` button removes uploaded ZIP originals from:

```text
courseware/<COURSE>/_admin_uploads/ispring/
courseware/<COURSE>/_admin_uploads/ispring-batches/
```

Installed iSpring pages remain in the lesson folder as `html5-package-admin/`.

## Security Notes

- For production, use the portal login system and course assignment rules. Do not expose `/courseware/` directly with a public nginx `alias`.
- Route `/courseware/` through Node so login and course permissions are checked. Let nginx serve the real file only through the internal `/_protected_courseware/` location after Node returns `X-Accel-Redirect`.
- Do not enable admin uploads without `ADMIN_USERNAME`, `ADMIN_PASSWORD`, and `ADMIN_SESSION_SECRET`.
- Keep `ADMIN_TOKEN` random if you use direct API calls or automation.
- Put this behind HTTPS.
- Prefer restricting `/teacher-admin` and `/api/admin/*` with nginx basic auth, VPN, or a private network.
- Keep `/courseware/<COURSE>/_admin_uploads/` blocked from public static access.
- If using nginx, set `client_max_body_size` high enough for iSpring ZIP uploads.
- Large files are streamed to disk, but this is not yet a chunked/resumable uploader.
- Keep enough free disk space for ZIP upload + extraction + installed iSpring package.
- For very large courseware migrations, use `rclone` from `deployment/UPLOAD.md`.

## nginx and systemd

Production templates:

```text
deployment/nginx-ossd-course-portal.conf
deployment/ossd-course-portal.service
```

Recommended server paths:

```text
/www/wwwroot/ossd-course-portal/
/www/wwwroot/ossd-portal/courseware-active/<COURSE>/
/www/wwwroot/ossd-portal/courseware-archive/
```

The nginx template proxies `/courseware/` and portal/admin routes to Node on port `8891`. The internal `/_protected_courseware/` alias is not publicly accessible; it is only used by nginx after Node authorizes the request.
