# Launch Course Transfer Plan

Generated: 2026-07-27T07:29:28.752Z
Target root: /www/wwwroot/ossd-portal/courseware-active
Courses: ENG3U, ESLEO
Status: ready

| Course | Status | Files | Dirs | Size GB | Local Source | Server Target |
| --- | --- | ---: | ---: | ---: | --- | --- |
| ENG3U | ready | 7163 | 1327 | 9.55 | D:\工作文件\SUNNYBROOK\courseware\ENG3U | /www/wwwroot/ossd-portal/courseware-active/ENG3U |
| ESLEO | ready | 4545 | 149 | 3.96 | D:\工作文件\SUNNYBROOK\courseware\ESLEO | /www/wwwroot/ossd-portal/courseware-active/ESLEO |

## Upload Commands

Use one command per course. `rclone` over SFTP is the most convenient from Windows after configuring a remote.

### ENG3U

PowerShell / rclone:

```powershell
rclone copy "D:\工作文件\SUNNYBROOK\courseware\ENG3U" "<server-sftp-remote>:/www/wwwroot/ossd-portal/courseware-active/ENG3U" --transfers 4 --checkers 8 --progress --log-file "deployment/logs/ENG3U-course-transfer.log" --log-level INFO
```

Linux/macOS rsync alternative:

```bash
rsync -avh --partial --progress 'D:/工作文件/SUNNYBROOK/courseware/ENG3U/' 'root@your-server:/www/wwwroot/ossd-portal/courseware-active/ENG3U/'
```

Server verification:

```bash
test -f '/www/wwwroot/ossd-portal/courseware-active/ENG3U/course-manifest.json' && find '/www/wwwroot/ossd-portal/courseware-active/ENG3U' -type f | wc -l
```

Largest files:
- Unit 1/Lesson 6 - Macbeth Act V/html5-package.zip: 182.9 MB
- Unit 1/Lesson 2 - Macbeth Act I/downloaded_resources_from_direct_index/consolidation/video/ENG3U-U1L2.mp4: 172.7 MB
- Unit 1/Lesson 2 - Macbeth Act I/downloaded_resources_from_direct_index/consolidation/video/ENG3U-U1L2-2.mp4: 172.7 MB
- Unit 1/Lesson 2 - Macbeth Act I/downloaded_resources/consolidation/video/ENG3U-U1L2.mp4: 172.7 MB
- Unit 1/Lesson 7 - Macbeth Themes Motifs and Symbols/html5-package.zip: 153.6 MB

### ESLEO

PowerShell / rclone:

```powershell
rclone copy "D:\工作文件\SUNNYBROOK\courseware\ESLEO" "<server-sftp-remote>:/www/wwwroot/ossd-portal/courseware-active/ESLEO" --transfers 4 --checkers 8 --progress --log-file "deployment/logs/ESLEO-course-transfer.log" --log-level INFO
```

Linux/macOS rsync alternative:

```bash
rsync -avh --partial --progress 'D:/工作文件/SUNNYBROOK/courseware/ESLEO/' 'root@your-server:/www/wwwroot/ossd-portal/courseware-active/ESLEO/'
```

Server verification:

```bash
test -f '/www/wwwroot/ossd-portal/courseware-active/ESLEO/course-manifest.json' && find '/www/wwwroot/ossd-portal/courseware-active/ESLEO' -type f | wc -l
```

Largest files:
- ispring-localized/unit-01/U01L04.zip: 154.1 MB
- localized-moodle/video/ded892a891-ESLEO-U2L2.mp4: 97.2 MB
- ispring-localized/unit-03/U03L03.zip: 79.4 MB
- ispring-localized/unit-03/U03L04.zip: 75.3 MB
- localized-moodle/video/b0270fc61b-ESLEO-U2L4.mp4: 74.7 MB

## After Upload

```bash
cd /www/wwwroot/ossd-course-portal
npm run check:launch-courses -- --courses ENG3U,ESLEO
npm run smoke:deployed-site -- --base-url https://your-domain --username teacher1 --password TEACHER_PASSWORD --course ENG3U
```

