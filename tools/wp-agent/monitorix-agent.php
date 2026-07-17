<?php
/**
 * Plugin Name: Monitorix Agent
 * Description: Posiela stav webu (WP/PHP/MySQL verzie, pluginy + updaty, téma, záloha) do Monitorix dashboardu. Stačí nainštalovať a aktivovať — žiadna konfigurácia.
 * Version: 2.1.0
 * Author: Lopatka
 *
 * Inštalácia (nič iné netreba):
 *   A) wp-admin: zabaľ tento súbor do ZIP → Pluginy → Pridať nový → Nahrať → Aktivuj.
 *   B) FTP/mu-plugin: nahraj do wp-content/mu-plugins/monitorix-agent.php (aktivuje sa sám).
 *
 * Plugin sám (cez WP-cron) raz denne pošle stav do Monitorixu. Ingest URL + token
 * sú zapečené nižšie — netreba nič nastavovať.
 *
 * POZOR (2026-07): WP-cron NIE JE skutočný cron — spustí sa len keď niekto
 * načíta stránku. Na málo navštevovanom webe sa tak pôvodný "kick 30s po
 * aktivácii" (nižšie, `init` + transient) nemusel spustiť VÔBEC, lebo aj on
 * čaká na návštevníka. Preto activation hook nižšie pushne stav OKAMŽITE pri
 * aktivácii (bežíme v admin requeste, žiadny visitor netreba) — funguje ale
 * len pri regulárnej aktivácii pluginu cez wp-admin (register_activation_hook
 * sa pri mu-plugine nikdy nespustí, mu-plugin sa "aktivuje" len tým, že leží
 * v mu-plugins/). Preto ide o DOPLNOK k naplánovanému behu nižšie, nie náhradu
 * — mu-plugin nasadenie sa aj naďalej spolieha na `init` kick + denný cron
 * (a od tejto verzie navyše na `wp-cron.php` kick zo strany Monitorix Workera,
 * pozri apps/scheduler/src/runWpCronKick.ts).
 */

if (!defined('ABSPATH')) {
    exit;
}

define('MONITORIX_AGENT_VERSION', '2.1.0');
define('MONITORIX_INGEST_URL', 'https://agency-dashboard-scheduler.filip-lopatka98.workers.dev/wp-ingest');
define('MONITORIX_INGEST_TOKEN', '__MONITORIX_INGEST_TOKEN__');

// Okamžitý push pri (re)aktivácii — len regulárny plugin (mu-plugin tento hook
// nikdy nespustí, viď komentár vyššie). Doplnok k plánovanému behu, nie náhrada.
register_activation_hook(__FILE__, 'monitorix_agent_do_push');

// Naplánuj denný push + jednorazový hneď po prvom načítaní (funguje aj ako mu-plugin).
add_action('init', function () {
    if (!wp_next_scheduled('monitorix_agent_push')) {
        wp_schedule_event(time() + 60, 'daily', 'monitorix_agent_push');
    }
    if (!get_transient('monitorix_agent_kick')) {
        set_transient('monitorix_agent_kick', 1, DAY_IN_SECONDS);
        wp_schedule_single_event(time() + 30, 'monitorix_agent_push');
    }
});

add_action('monitorix_agent_push', 'monitorix_agent_do_push');

// Upratanie pri deaktivácii (len regulárny plugin; mu-plugin sa nedeaktivuje).
register_deactivation_hook(__FILE__, function () {
    wp_clear_scheduled_hook('monitorix_agent_push');
});

/** Zozbiera stav WordPressu a pošle ho do Monitorixu (read-only). */
function monitorix_agent_do_push()
{
    global $wpdb;
    require_once ABSPATH . 'wp-admin/includes/plugin.php';
    require_once ABSPATH . 'wp-admin/includes/update.php';

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

    $coreT    = get_site_transient('update_core');
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

    $backupAt = null;
    $ud = get_option('updraft_last_backup');
    if (is_array($ud) && !empty($ud['backup_time'])) {
        $backupAt = gmdate('c', (int) $ud['backup_time']);
    }

    $payload = [
        'url'           => home_url(),
        'wp_version'    => get_bloginfo('version'),
        'wp_update'     => $wpUpdate,
        'php_version'   => PHP_VERSION,
        'mysql_version' => $wpdb->db_version(),
        'theme'         => $theme ? $theme->get('Name') . ' ' . $theme->get('Version') : null,
        'plugins'       => $plugins,
        'backup_at'     => $backupAt,
        'agent_version' => MONITORIX_AGENT_VERSION,
    ];

    wp_remote_post(MONITORIX_INGEST_URL, [
        'timeout'  => 15,
        'blocking' => false,
        'headers'  => [
            'Content-Type'      => 'application/json',
            'X-Monitorix-Token' => MONITORIX_INGEST_TOKEN,
        ],
        'body'     => wp_json_encode($payload),
    ]);
}
