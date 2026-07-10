<?php
/**
 * Plugin Name: Monitorix Agent
 * Description: Read-only stavový endpoint pre Monitorix dashboard (WP/PHP/MySQL verzie, pluginy + updaty, téma, záloha). Chránené HMAC podpisom.
 * Version: 1.0.0
 * Author: Lopatka
 *
 * Inštalácia:
 *   A) wp-admin: zabaľ tento súbor do ZIP a nahraj cez Pluginy → Pridať nový → Nahrať, aktivuj.
 *   B) FTP/mu-plugin: nahraj do wp-content/mu-plugins/monitorix-agent.php (aktivuje sa sám).
 *
 * Secret (POVINNÉ) — do wp-config.php pridaj:
 *   define('MONITORIX_AGENT_SECRET', 'ten-isty-nahodny-retazec-na-vsetkych-weboch');
 *
 * Endpoint: GET /wp-json/monitorix/v1/status
 *   Hlavičky: X-Monitorix-Timestamp: <unix>, X-Monitorix-Signature: hex(hmac_sha256(secret, timestamp))
 */

if (!defined('ABSPATH')) {
    exit;
}

add_action('rest_api_init', function () {
    register_rest_route('monitorix/v1', '/status', [
        'methods'             => 'GET',
        'permission_callback' => 'monitorix_agent_verify',
        'callback'            => 'monitorix_agent_status',
    ]);
});

/** HMAC overenie: timestamp v okne ±300 s + zhoda podpisu (hash_equals proti timing). */
function monitorix_agent_verify(WP_REST_Request $req)
{
    if (!defined('MONITORIX_AGENT_SECRET') || MONITORIX_AGENT_SECRET === '') {
        return new WP_Error('monitorix_no_secret', 'MONITORIX_AGENT_SECRET nie je nastavený', ['status' => 500]);
    }
    $ts  = (string) $req->get_header('x-monitorix-timestamp');
    $sig = (string) $req->get_header('x-monitorix-signature');
    if ($ts === '' || $sig === '') {
        return new WP_Error('monitorix_unauth', 'Chýba podpis', ['status' => 401]);
    }
    if (abs(time() - (int) $ts) > 300) {
        return new WP_Error('monitorix_stale', 'Podpis expiroval', ['status' => 401]);
    }
    $expected = hash_hmac('sha256', $ts, MONITORIX_AGENT_SECRET);
    if (!hash_equals($expected, $sig)) {
        return new WP_Error('monitorix_bad_sig', 'Neplatný podpis', ['status' => 401]);
    }
    return true;
}

/** Zozbiera stav WordPressu (read-only). */
function monitorix_agent_status()
{
    global $wpdb;
    require_once ABSPATH . 'wp-admin/includes/plugin.php';
    require_once ABSPATH . 'wp-admin/includes/update.php';

    // Pluginy + dostupné updaty.
    $all     = get_plugins();
    $updates = get_site_transient('update_plugins');
    $upMap   = ($updates && !empty($updates->response)) ? $updates->response : [];
    $plugins = [];
    foreach ($all as $file => $data) {
        $slug = dirname($file);
        if ($slug === '.' || $slug === '') {
            $slug = basename($file, '.php');
        }
        $plugins[] = [
            'name'           => $data['Name'],
            'slug'           => $slug,
            'version'        => $data['Version'],
            'active'         => is_plugin_active($file),
            'update_version' => isset($upMap[$file]->new_version) ? $upMap[$file]->new_version : null,
        ];
    }

    // WP core update.
    $coreT   = get_site_transient('update_core');
    $wpUpdate = null;
    if ($coreT && !empty($coreT->updates)) {
        foreach ($coreT->updates as $u) {
            if (isset($u->response) && $u->response === 'upgrade') {
                $wpUpdate = $u->version;
                break;
            }
        }
    }

    $theme = wp_get_theme();

    // Záloha — best-effort (UpdraftPlus). Iné pluginy → null.
    $backupAt = null;
    $ud = get_option('updraft_last_backup');
    if (is_array($ud) && !empty($ud['backup_time'])) {
        $backupAt = gmdate('c', (int) $ud['backup_time']);
    }

    return [
        'wp_version'     => get_bloginfo('version'),
        'wp_update'      => $wpUpdate,
        'php_version'    => PHP_VERSION,
        'mysql_version'  => $wpdb->db_version(),
        'theme'          => $theme ? $theme->get('Name') . ' ' . $theme->get('Version') : null,
        'multisite'      => is_multisite(),
        'plugins'        => $plugins,
        'backup_at'      => $backupAt,
        'agent_version'  => '1.0.0',
    ];
}
