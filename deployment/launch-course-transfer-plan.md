# Launch Course Transfer Plan

Generated: 2026-07-29T09:53:25.634Z
Target root: /www/wwwroot/ossd-portal/courseware-active
Courses: HFC3M
Status: ready

| Course | Status | Files | Dirs | Size GB | Local Source | Server Target |
| --- | --- | ---: | ---: | ---: | --- | --- |
| HFC3M | ready | 160 | 111 | 0.04 | D:\工作文件\SUNNYBROOK\courseware\HFC3M | /www/wwwroot/ossd-portal/courseware-active/HFC3M |

## Upload Commands

Use one command per course. `rclone` over SFTP is the most convenient from Windows after configuring a remote.

### HFC3M

PowerShell / rclone:

```powershell
rclone copy "D:\工作文件\SUNNYBROOK\courseware\HFC3M" "<server-sftp-remote>:/www/wwwroot/ossd-portal/courseware-active/HFC3M" --transfers 4 --checkers 8 --progress --log-file "deployment/logs/HFC3M-course-transfer.log" --log-level INFO
```

Linux/macOS rsync alternative:

```bash
rsync -avh --partial --progress 'D:/工作文件/SUNNYBROOK/courseware/HFC3M/' 'root@your-server:/www/wwwroot/ossd-portal/courseware-active/HFC3M/'
```

Server verification:

```bash
test -f '/www/wwwroot/ossd-portal/courseware-active/HFC3M/course-manifest.json' && find '/www/wwwroot/ossd-portal/courseware-active/HFC3M' -type f | wc -l
```

Largest files:
- localized-moodle-activities/assign/U03L03-5677-033fdfd4db/files/11cc40594e-international-foods-part1.ppt: 4.4 MB
- localized-moodle-activities/assign/U03L02-5676-b82f7c3898/files/617884a205-introductory-lesson-what-is-culture2.pptx: 3.8 MB
- localized-moodle-activities/assign/U03L02-5676-b82f7c3898/files/9ec0c7c25c-introductory-lesson-what-is-culture1.pptx: 2.4 MB
- localized-moodle-activities/assign/U03L03-5677-033fdfd4db/files/d46636ce22-international-foods-2.ppt: 2.3 MB
- localized-moodle-activities/assign/U03L02-5676-b82f7c3898/files/b324f43d5d-nutrition-powerpoint-1.pptx: 2.2 MB

## After Upload

```bash
cd /www/wwwroot/ossd-course-portal
npm run check:launch-courses -- --courses HFC3M
npm run smoke:deployed-site -- --base-url https://your-domain --username teacher1 --password TEACHER_PASSWORD --course HFC3M
```

