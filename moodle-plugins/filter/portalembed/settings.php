<?php
defined('MOODLE_INTERNAL') || die();

if ($ADMIN->fulltree) {
    $settings->add(new admin_setting_configtext(
        'filter_portalembed/portalorigin',
        get_string('portalorigin', 'filter_portalembed'),
        get_string('portalorigin_desc', 'filter_portalembed'),
        'https://www.moodletool.work',
        PARAM_URL
    ));

    $settings->add(new admin_setting_configtextarea(
        'filter_portalembed/allowedprefixes',
        get_string('allowedprefixes', 'filter_portalembed'),
        get_string('allowedprefixes_desc', 'filter_portalembed'),
        "https://www.moodletool.work/embed/\nhttp://127.0.0.1:8891/embed/",
        PARAM_RAW
    ));
}
