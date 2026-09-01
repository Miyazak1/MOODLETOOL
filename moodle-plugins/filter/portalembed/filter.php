<?php
defined('MOODLE_INTERNAL') || die();

class filter_portalembed extends moodle_text_filter {
    public function filter($text, array $options = array()) {
        if (stripos($text, '[portal_') === false) {
            return $text;
        }

        $text = preg_replace_callback('/\[portal_iframe\s+([^\]]+)\]/i', function ($matches) {
            $attrs = self::parse_attributes($matches[1]);
            return self::render_iframe($attrs);
        }, $text);

        $text = preg_replace_callback('/\[portal_ispring\s+([^\]]+)\]/i', function ($matches) {
            $attrs = self::parse_attributes($matches[1]);
            if (empty($attrs['src'])) {
                $attrs['src'] = self::build_portal_src('ispring', $attrs);
            }
            $attrs['height'] = $attrs['height'] ?? '720';
            return self::render_iframe($attrs);
        }, $text);

        $text = preg_replace_callback('/\[portal_video\s+([^\]]+)\]/i', function ($matches) {
            $attrs = self::parse_attributes($matches[1]);
            if (empty($attrs['src'])) {
                $attrs['src'] = self::build_portal_src('video', $attrs);
            }
            $attrs['height'] = $attrs['height'] ?? '540';
            return self::render_iframe($attrs);
        }, $text);

        return $text;
    }

    private static function parse_attributes($raw) {
        $attrs = array();
        preg_match_all('/([a-zA-Z0-9_-]+)\s*=\s*"([^"]*)"/', $raw, $matches, PREG_SET_ORDER);
        foreach ($matches as $match) {
            $attrs[strtolower($match[1])] = html_entity_decode($match[2], ENT_QUOTES | ENT_HTML5, 'UTF-8');
        }
        return $attrs;
    }

    private static function build_portal_src($kind, array $attrs) {
        if (empty($attrs['course']) || empty($attrs['lesson']) || empty($attrs['id']) || empty($attrs['token'])) {
            return '';
        }
        $origin = self::portal_origin();
        return $origin . '/embed/' . rawurlencode($kind) . '/'
            . rawurlencode($attrs['course']) . '/'
            . rawurlencode($attrs['lesson']) . '/'
            . rawurlencode($attrs['id']) . '?token=' . rawurlencode($attrs['token']);
    }

    private static function render_iframe(array $attrs) {
        $src = trim($attrs['src'] ?? '');
        if (!self::is_allowed_src($src)) {
            return '';
        }

        $width = self::clean_dimension($attrs['width'] ?? '100%', '100%');
        $height = self::clean_dimension($attrs['height'] ?? '720', '720');
        $title = s($attrs['title'] ?? get_string('embedtitle', 'filter_portalembed'));
        $src = s($src);

        return '<iframe class="portalembed-frame" '
            . 'src="' . $src . '" '
            . 'title="' . $title . '" '
            . 'width="' . $width . '" '
            . 'height="' . $height . '" '
            . 'frameborder="0" '
            . 'scrolling="auto" '
            . 'sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads allow-presentation allow-modals" '
            . 'allow="autoplay; fullscreen; clipboard-write; encrypted-media; picture-in-picture" '
            . 'allowfullscreen="allowfullscreen"></iframe>';
    }

    private static function clean_dimension($value, $fallback) {
        $value = trim((string)$value);
        if (preg_match('/^\d{1,4}%?$/', $value)) {
            return s($value);
        }
        return s($fallback);
    }

    private static function portal_origin() {
        $configured = trim((string)get_config('filter_portalembed', 'portalorigin'));
        return rtrim($configured ?: 'https://www.moodletool.work', '/');
    }

    private static function allowed_prefixes() {
        $configured = trim((string)get_config('filter_portalembed', 'allowedprefixes'));
        $lines = $configured ?: "https://www.moodletool.work/embed/\nhttp://127.0.0.1:8891/embed/";
        return array_values(array_filter(array_map('trim', preg_split('/\r?\n/', $lines))));
    }

    private static function is_allowed_src($src) {
        if (!preg_match('/^https?:\/\//i', $src)) {
            return false;
        }
        foreach (self::allowed_prefixes() as $prefix) {
            if (stripos($src, $prefix) === 0) {
                return true;
            }
        }
        return false;
    }
}
