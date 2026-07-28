# OSSD Course Portal

Unit-first course resource portal for SunnyBrook OSSD teacher preparation.

## Local Development

Use the included launcher for the local website:

```text
START_LOCAL_WEBSITE.bat
```

It builds the React app, starts the local server, enables the local teacher-admin upload API, and opens the website. The preferred address is:

```text
http://127.0.0.1:8891/
```

If `8891` is already in use, the launcher automatically tries `8892` through `8895`.
The command window prints the actual address after startup.

The website header includes a `管理后台` entry. Use this local login:

```text
Username: admin
Password: local-admin-password
```

Keep the command window open while testing.

The portal reads ENG3U data from:

```text
../courseware/ENG3U/course-manifest.json
```

Courseware files remain outside this project folder. This keeps the website code separate from the large iSpring and resource packages.

## Configuration

Local defaults:

```text
VITE_COURSE_CATALOG_URL=/course-catalog.json
VITE_COURSE_MANIFEST_URL=/courseware/ENG3U/course-manifest.json
VITE_COURSE_BASE_URL=/courseware/ENG3U/
```

`public/course-catalog.json` lists the courses available in the portal. For the current production plan, keep each catalog entry on the same cloud server under `/courseware/<COURSE>/`, for example `/courseware/ENG3U/course-manifest.json` and `/courseware/ENG3U/`.

The current catalog includes ENG3U with iSpring courseware plus planning-only manifests generated from the OSSD `Unit Plans and Lesson Plans` source directory. Textbook folders are intentionally excluded.
Planning-only courses use stable per-lesson folders such as `courseware/MCR3U/lessons/U01L01/`, so iSpring ZIPs uploaded later through the admin page can be installed and shown as page entries.

## Validation

```text
npm.cmd run verify:release
```

`verify:release` runs the server syntax check, teacher-admin script syntax check, manifest validation, readiness audit, upload gap export, production build, Baota preflight, frontend/admin smoke tests, portal-wide Basic Auth smoke, and batch import smoke tests.

For Baota/self-hosted deployment, run a final local preflight after building:

```text
npm.cmd run preflight:baota
```

The report is written to `deployment/baota-preflight-report.md` and lists deployment blockers separately from known content gaps.

Useful individual checks:

```text
npm.cmd run audit:readiness
npm.cmd run audit:online-resources
npm.cmd run audit:content-workbench
npm.cmd run export:preview-queue
npm.cmd run export:ispring-queue
npm.cmd run export:gap-checklist
npm.cmd run validate:manifest
npm.cmd run export:courseware-list
npm.cmd run build
npm.cmd run smoke:http
```

`audit:readiness` writes course readiness reports into `deployment/`, including missing course outlines, unit plans, lesson plans, and literary works that still need review.
When run without `--course`, it also writes the all-course summary to `deployment/course-readiness-summary.md`.
`audit:online-resources` writes `deployment/online-resource-readiness.md` and `.json`, checking whether indexed files have downloadable sources and browser-friendly preview paths, and whether iSpring entries have both play and download sources. It also includes a per-course summary and a unique Office preview queue so repeated manifest entries do not inflate the real file work.
`audit:content-workbench` writes `deployment/course-content-workbench.md` and `.json`, combining readiness, upload tasks, iSpring gaps, text review, and preview work into one prioritized per-course dashboard.
`export:preview-queue` writes `deployment/office-preview-queue.md`, `.json`, and `inbox/office-preview-queue.csv`, sorting Office PDF preview work by the same course priority used in the content workbench.
`export:ispring-queue` writes `deployment/ispring-package-queue.md`, `.json`, and `inbox/ispring-package-queue.csv`, listing the expected iSpring ZIP filename for each course/lesson that still needs an iSpring package.
`export:gap-checklist` writes `deployment/upload-gap-checklist.md` and `.json`, turning readiness gaps into admin upload tasks with suggested filenames and Unit/Lesson targets.
`smoke:http` checks the running local preview at `http://127.0.0.1:8891/`, including the app shell, catalog, manifest, a course document, an iSpring page, a literary work resource, and video range support.

## Backup

Create a courseware backup archive:

```text
npm.cmd run backup:courseware
```

By default, this writes to `../backups/ossd-course-portal/` and backs up `../courseware/`. For a custom location:

```text
npm.cmd run backup:courseware -- --out D:\OSSD-backups --retention 7
```

Use `--dry-run` first to see source size and file counts without writing an archive.

Verify the latest backup in the default backup folder:

```text
npm.cmd run verify:backup
```

Or verify a specific archive:

```text
npm.cmd run verify:backup -- --archive D:\OSSD-backups\ossd-courseware-backup-example.zip
```

Before relying on a backup, test restore it into a new directory:

```text
npm.cmd run restore:backup -- --archive D:\OSSD-backups\ossd-courseware-backup-example.zip --target D:\OSSD-restore-test --dry-run
npm.cmd run restore:backup -- --archive D:\OSSD-backups\ossd-courseware-backup-example.zip --target D:\OSSD-restore-test
```

Restore refuses to write into a non-empty target unless `--force` is provided. Use `--force` only after checking the target path.

To batch-import files that match the gap checklist, put files into:

```text
ossd-course-portal/inbox/upload-gaps/
```

Use the suggested filenames from `deployment/upload-gap-checklist.md`, then run:

```text
npm.cmd run import:gap-files -- --dry-run
npm.cmd run import:gap-files -- --rebuild-manifest
```

The importer also accepts files grouped by course, such as `ossd-course-portal/inbox/upload-gaps/MCR3U/MCR3U_Course_Outline.pdf`.
It does not overwrite existing courseware files unless `--overwrite` is passed.

To create a collection folder for gathering the missing files from other people, run:

```text
npm.cmd run prepare:collection-inbox
```

It writes `ossd-course-portal/inbox/collection/` with per-course instructions, suggested filenames, iSpring batch ZIP names, and text-review notes.
The import commands also read from this collection folder directly, so collected direct-upload files can stay under `inbox/collection/direct-uploads/<COURSE>/`, and collected iSpring ZIPs can stay under `inbox/collection/ispring-batches/<COURSE>/`.

To batch-import iSpring ZIP packages, put files into:

```text
ossd-course-portal/inbox/ispring/<COURSE>/
```

Supported ZIP names include:

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

The importer installs each package into the matching lesson folder as `html5-package-admin/` and rebuilds that course manifest.

The web admin also supports `iSpring ZIP Batch`: upload one outer ZIP for a selected course, with inner packages named `U01_L01.zip` or `<COURSE>_U01_L01.zip`. The server installs matching inner packages lesson by lesson and rebuilds the manifest once.

For legacy iSpring entries that are already installed as extracted `html5-package*/` folders but do not have a downloadable ZIP, run:

```text
npm.cmd run package:ispring-downloads -- --course ENG3U
```

This creates sibling ZIP downloads and rebuilds the course manifest.

## Import Teacher Documents

Put files into:

```text
ossd-course-portal/inbox/<COURSE>/
```

Recommended names:

```text
MCR3U Course Outline.docx
MCR3U Introduction.docx
U01 Unit Plan.docx
U01 L01 Lesson Plan.docx
```

Then run from `ossd-course-portal/`:

```text
npm.cmd run import:teacher-docs -- --course MCR3U --dry-run
npm.cmd run import:teacher-docs -- --course MCR3U --rebuild-manifest
```

The files are copied into `courseware/<COURSE>/plans/` and exposed through `course-manifest.json`.
The importer rebuilds ENG3U with the ENG3U+iSpring manifest builder, and rebuilds other courses with the plan-only manifest builder.

To download one missing course document directly from SunnyBrook Moodle and import it, use the workspace-level helper:

```text
..\DOWNLOAD_COURSE_DOCUMENT_AND_IMPORT.bat
```

It asks for the course code, Moodle file URL, document role, and Moodle login, then downloads into `ossd-course-portal/inbox/<COURSE>/` and rebuilds that course manifest. Use this for the remaining Course Outline gaps once the Moodle file URL is known.

For multiple missing course documents, generate a Moodle URL queue:

```text
npm.cmd run export:gap-checklist
npm.cmd run prepare:moodle-doc-queue
```

Fill the `url` column in:

```text
ossd-course-portal/inbox/moodle-course-document-queue.csv
```

The queue is sorted by `priorityScore` from the content workbench. Use `moodleSearchHint` to find the matching Moodle file, then paste the direct Moodle file URL into `url`.

Then run the workspace-level batch helper:

```text
..\DOWNLOAD_COURSE_DOCUMENT_QUEUE_AND_IMPORT.bat
```

Before downloading, preview the batch without touching Moodle:

```text
npm.cmd run plan:moodle-doc-queue
npm.cmd run validate:moodle-doc-download-report
```

If Moodle requires authentication, set `MOODLE_COOKIE` in the shell environment before running the batch helper. The project does not store Moodle passwords or browser cookies in source files. The downloader rejects HTML/login pages and validates Office/PDF file signatures before writing course files.

ENG3U plan files imported from the OSSD source directory were mapped by unit/lesson titles because the source unit order differs from the iSpring unit order. See:

```text
docs/ENG3U_PLAN_IMPORT_NOTES.md
```

To re-import the OSSD ENG3U plan set with the correct iSpring unit order:

```text
npm.cmd run import:eng3u-plans
```

To regenerate the admin course dropdown from the external Unit Plans and Lesson Plans folder:

```text
npm.cmd run build:admin-courses
```

To import non-ENG3U planning documents and regenerate the frontend course catalog:

```text
npm.cmd run import:plan-library
```

This imports plan-only courses into `courseware/<COURSE>/plans/source/` and creates `courseware/<COURSE>/course-manifest.json`.

To rebuild all non-ENG3U plan-only course manifests from the existing `courseware/<COURSE>/plans` folders:

```text
npm.cmd run build:plan-courses
```

To rebuild one plan-only course:

```text
npm.cmd run build:plan-course -- --course MCR3U
```

To generate missing teacher-facing prep notes from the current course manifests:

```text
npm.cmd run generate:teacher-prep-notes
npm.cmd run build:plan-courses
```

Generated teacher prep notes are preparation notes for teachers. They are not official course introductions or course outlines.

## Online Preview and Download

Every indexed resource is shown with two actions in the teacher portal:

- `在线查看` opens the browser-playable or preview version.
- `下载` downloads the original file from the server.

This is a product requirement for the hosted portal: course outlines, introductions, unit plans, lesson plans, teacher files, literary/text materials, videos, H5P/HTML, and iSpring packages should all be both viewable/playable online and downloadable. If a file type cannot be opened directly by the browser, the manifest should point `在线查看` to a generated preview while keeping `下载` pointed at the original file.

Browsers can directly preview PDF, text, images, video, H5P/HTML, and iSpring pages. Office files such as DOCX, PPTX, and XLSX need PDF preview copies. On the cloud server, install LibreOffice headless and generate preview PDFs:

```text
npm run generate:previews
```

This writes PDF previews under:

```text
courseware/<COURSE>/previews/
```

The original file remains the download source. The generated `previewPath` in `course-manifest.json` is used only for online viewing.
The preview generator continues after individual conversion failures and writes `deployment/document-preview-generation-report.md`. Use `npm run generate:previews -- --dry-run` to estimate the conversion queue without writing files.

Run this audit after imports, Moodle downloads, admin uploads, or iSpring batch work:

```text
npm.cmd run audit:online-resources
npm.cmd run audit:content-workbench
npm.cmd run export:preview-queue
```

The portal should not be considered finished until this report has no file preview/download gaps and no iSpring play/download gaps. Known content gaps can remain while a course is being built, but completed courses should pass this check.

## Text Materials

Public-domain or school-licensed text files can be placed under:

```text
courseware/ENG3U/texts/
```

Recommended paths:

```text
courseware/ENG3U/texts/macbeth/Macbeth.pdf
courseware/ENG3U/texts/frankenstein/Frankenstein.pdf
courseware/ENG3U/texts/the-birthmark/The_Birthmark.pdf
```

After adding text files, rebuild the manifest:

```text
python ossd-course-portal\tools\build_course_manifest.py --course ENG3U
```

For a production-style preview after building:

```text
npm.cmd run build
npm.cmd run preview
```

For Vite development with hot reload:

```text
npm.cmd run dev
```

## Teacher Admin

The server includes a minimal protected upload page at:

```text
http://127.0.0.1:8891/teacher-admin
```

When using `START_LOCAL_WEBSITE.bat`, uploads are enabled for local testing. See `ADMIN.md` before enabling uploads on a production server.

For normal content updates, the preferred workflow is still batch import and rebuild by the project maintainer/Codex: collect files, import them into `courseware/<COURSE>/`, rebuild manifests, generate previews, then run the readiness audits. The web admin stays available for small replacements, emergency uploads, and server-side iSpring ZIP batch uploads.

For Baota deployment, see:

```text
deployment/BAOTA_DEPLOYMENT.md
```

For PM2 process supervision, auto-start after reboot, and production log locations, see:

```text
docs/宝塔PM2生产运行说明_2026-07-28.md
```

## Structure

```text
ossd-course-portal/
  ADMIN.md
  index.html
  docs/
    OSSD课程资源门户建设方案.md
  src/
    main.tsx
    styles.css
    types.ts
  tools/
    build_course_manifest.py
    import_teacher_documents.py
  server.mjs
  vite.config.ts
  START_LOCAL_WEBSITE.bat
```

## Notes

- iSpring entries open as pages.
- Downloadable resources link to the existing courseware files.
- The current version is a React + TypeScript + Vite app.
