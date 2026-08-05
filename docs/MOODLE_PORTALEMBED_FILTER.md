# Moodle Portal Embed Filter

The portal embed filter is a normal Moodle filter plugin directory:

```text
filter/portalembed/
  version.php
  filter.php
  settings.php
  lang/en/filter_portalembed.php
```

It is not a single command. Terminal commands only install the directory into Moodle and run Moodle's upgrade script.

Canonical download URL after deploying the portal:

```text
https://www.moodletool.work/downloads/filter_portalembed.zip
```

Install on a Moodle server:

```bash
cd /www/wwwroot/www.esunnybrook.com/moodle
curl -L https://www.moodletool.work/downloads/filter_portalembed.zip -o /tmp/filter_portalembed.zip
rm -rf filter/portalembed
unzip -q /tmp/filter_portalembed.zip -d filter
/www/server/php/81/bin/php admin/cli/upgrade.php --non-interactive
/www/server/php/81/bin/php admin/cli/purge_caches.php
```

Enable it in Moodle:

```text
Site administration -> Plugins -> Filters -> Manage filters -> Portal embed shortcode
```

Use shortcodes instead of raw iframe HTML:

```text
[portal_iframe src="https://www.moodletool.work/embed/ispring/ESLEO/U01L01/87b225257bd8?token=..." width="100%" height="720"]
```

The filter only renders iframe URLs whose `src` starts with an allowed prefix. By default:

```text
https://www.moodletool.work/embed/
http://127.0.0.1:8891/embed/
```

The rendered iframe intentionally does not add a `sandbox` attribute. iSpring, H5P, and
other HTML5 courseware can break inside a sandboxed iframe; access is controlled by
the allowed embed prefixes and the Portal embed token instead.
