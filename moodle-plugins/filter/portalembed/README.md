# Moodle filter: portalembed

This Moodle text filter renders stable course-portal embed shortcodes after Moodle editor cleanup.

Supported shortcodes:

```text
[portal_iframe src="https://www.moodletool.work/embed/ispring/ESLEO/U01L01/87b225257bd8?token=..." width="100%" height="720"]
[portal_video src="https://www.moodletool.work/embed/video/ENG4U/U01L01/resourceid?token=..." height="540"]
[portal_ispring course="ESLEO" lesson="U01L01" id="87b225257bd8" token="..."]
```

The rendered iframe is capped to the Moodle content width (`width:100%; max-width:100%`) so legacy shortcodes with a fixed pixel width do not stretch the page.

Install from a Moodle root:

```bash
curl -L https://www.moodletool.work/downloads/filter_portalembed.zip -o /tmp/filter_portalembed.zip
rm -rf filter/portalembed
unzip -q /tmp/filter_portalembed.zip -d filter
/www/server/php/81/bin/php admin/cli/upgrade.php --non-interactive
/www/server/php/81/bin/php admin/cli/purge_caches.php
```

Then enable the filter in Moodle:

Site administration -> Plugins -> Filters -> Manage filters -> Portal embed shortcode.
