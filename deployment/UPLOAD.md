# Background Courseware Upload

Current production direction: course files are stored on our own Baota server data disk:

```text
/www/wwwroot/ossd-portal/courseware-active/<COURSE>
```

For selected first-launch courses, generate the current transfer plan first:

```text
npm run prepare:launch-transfer -- --courses ENG3U,ESLEO
```

Outputs:

```text
deployment/launch-course-transfer-plan.md
deployment/launch-course-transfer-plan.json
```

The plan includes local source folders, server target folders, file counts, total size, largest files, and ready-to-edit `rclone`/`rsync` commands.

The portal separates the small frontend build from the large courseware folder. Upload them separately:

- Frontend: `ossd-course-portal/dist/`
- Courseware: `courseware/ENG3U/`

ENG3U currently has an upload list of about 7.65 GB and 5,641 files.

## Recommended Tool

Use `rclone` for background courseware upload. It supports R2, S3, Azure Blob, Google Drive, SharePoint/OneDrive, SFTP, and many other targets.

Configure a remote first:

```text
rclone config
```

Examples of remote targets:

```text
r2:school-courseware/ENG3U
s3:school-courseware/ENG3U
gdrive:OSSD-Courseware/ENG3U
sharepoint:OSSD-Courseware/ENG3U
```

## Generate Upload Lists

From `ossd-course-portal/`:

```text
npm.cmd run export:courseware-list
npm.cmd run export:rclone-files
```

Outputs:

```text
deployment/ENG3U-courseware-upload-list.json
deployment/ENG3U-rclone-files-from.txt
```

## Dry Run

From the workspace root:

```text
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ossd-course-portal\deployment\upload-courseware-rclone.ps1 -Course ENG3U -Remote r2:school-courseware -DryRun
```

## Background Upload

From the workspace root:

```text
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ossd-course-portal\deployment\upload-courseware-rclone.ps1 -Course ENG3U -Remote r2:school-courseware -Background
```

The default destination is:

```text
<remote>/ENG3U
```

You can override it:

```text
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ossd-course-portal\deployment\upload-courseware-rclone.ps1 -Course ENG3U -Remote r2:school-courseware -Destination r2:school-courseware/courses/ENG3U -Background
```

## Logs

Logs are written to:

```text
deployment/logs/
```

The upload can be safely run again. `rclone copy` will skip files that already match the destination.

## After Upload

Update `public/course-catalog.json` or production environment values so ENG3U points to the hosted courseware base URL:

```text
https://courseware.example.com/ENG3U/
```

Then rebuild and smoke test:

```text
npm.cmd run build
npm.cmd run smoke:http -- --base-url https://your-portal.example.com
```
