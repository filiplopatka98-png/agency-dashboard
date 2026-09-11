<?php
/**
 * Plugin Name: Monitorix Agent
 * Description: Posiela stav webu (WP/PHP/MySQL verzie, pluginy + updaty, téma, záloha) do Monitorix dashboardu. Stačí nainštalovať a aktivovať — žiadna konfigurácia.
 * Version: 2.2.1
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

define('MONITORIX_AGENT_VERSION', '2.2.1');
define('MONITORIX_INGEST_URL', 'https://agency-dashboard-scheduler.filip-lopatka98.workers.dev/wp-ingest');

// Ingest token — riešený tak, aby update pluginu NEVYMAZAL token. Starý súbor sa
// pri update prepíše, preto sa token číta v poradí:
//   1) konštanta MONITORIX_INGEST_TOKEN z wp-config.php (ak je tam nastavená),
//   2) uložená WP option `monitorix_ingest_token` (raz nastavená, prežije každý
//      ďalší update pluginu),
//   3) placeholder nižšie (kým nie je nastavené nič → /wp-ingest vráti 401).
// Reálnu konštantu (z wp-config) si plugin sám uloží do option, takže token stačí
// nastaviť JEDENkrát a všetky budúce ZIP updaty sa nahrávajú bez úprav.
if (!defined('MONITORIX_INGEST_TOKEN')) {
    define('MONITORIX_INGEST_TOKEN', '__MONITORIX_INGEST_TOKEN__');
}

function monitorix_agent_token()
{
    $c = MONITORIX_INGEST_TOKEN;
    if ($c && $c !== '__MONITORIX_INGEST_TOKEN__') {
        if (get_option('monitorix_ingest_token') !== $c) {
            update_option('monitorix_ingest_token', $c, false); // persist real token cez update
        }
        return $c;
    }
    $opt = get_option('monitorix_ingest_token');
    return $opt ? $opt : '';
}

// Okamžitý push pri (re)aktivácii — len regulárny plugin (mu-plugin tento hook
// nikdy nespustí, viď komentár vyššie). Doplnok k plánovanému behu, nie náhrada.
register_activation_hook(__FILE__, 'monitorix_agent_do_push');

// Naplánuj denný push + jednorazový hneď po prvom načítaní (funguje aj ako mu-plugin).
add_action('init', function () {
    if (!wp_next_scheduled('monitorix_agent_push')) {
        wp_schedule_event(time() + 60, 'hourly', 'monitorix_agent_push');
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

// Event-driven: the instant a send fails, push immediately (debounced) so the
// dashboard sees an acute outage within minutes — not at the next hourly beat.
add_action('wp_mail_failed', function ($wp_error) {
    if (get_transient('monitorix_agent_mail_fail_kick')) {
        return; // debounce: at most one event push / 10 min
    }
    set_transient('monitorix_agent_mail_fail_kick', 1, 10 * MINUTE_IN_SECONDS);
    monitorix_agent_do_push('event');
});

/** Zozbiera stav WordPressu a pošle ho do Monitorixu (read-only). */
function monitorix_agent_do_push($source = 'heartbeat')
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

    $payload['email_health'] = monitorix_agent_email_health();

    wp_remote_post(MONITORIX_INGEST_URL, [
        'timeout'  => 15,
        'blocking' => false,
        'headers'  => [
            'Content-Type'      => 'application/json',
            'X-Monitorix-Token' => monitorix_agent_token(),
            'X-Monitorix-Source'=> is_string($source) ? $source : 'heartbeat',
        ],
        'body'     => wp_json_encode($payload),
    ]);
}

/**
 * E-mail deliverability aggregates from the SMTP log plugin. Read-only.
 * Returns null if no supported log table exists. NO recipient addresses or
 * bodies leave the site — only counts + a sanitized last error.
 */
function monitorix_agent_email_health()
{
    global $wpdb;

    // FluentSMTP — verify the real table name at runtime (do not assume).
    $fsmtp = $wpdb->get_var("SHOW TABLES LIKE '{$wpdb->prefix}fsmpt_email_logs'");
    if ($fsmtp) {
        // Verified on a live install (2026-08-12): status values 'sent'/'failed'/'pending',
        // time column `created_at` (TIMESTAMP → stored UTC, read in session tz).
        return monitorix_agent_agg($wpdb->prefix . 'fsmpt_email_logs', 'created_at', "status = 'failed'", "status = 'sent'", "status = 'pending'", 'FluentSMTP');
    }
    // WP Mail Logging fallback.
    $wpml = $wpdb->get_var("SHOW TABLES LIKE '{$wpdb->prefix}wpml_mails'");
    if ($wpml) {
        // WP Mail Logging does not always record status; treat presence as sent, no reliable failed/pending signal.
        return monitorix_agent_agg($wpdb->prefix . 'wpml_mails', 'timestamp', null, null, null, 'WP Mail Logging');
    }
    return null; // no provider → dashboard shows "not monitored", NOT zero.
}

/**
 * Windowed counts + last success/failure from a log table.
 *
 * All time math runs IN SQL relative to the DB server clock: `$timeCol` and
 * NOW() share the same session timezone, so the 1h/24h windows are correct no
 * matter whether the plugin stores UTC or local time. (Verified 2026-08-12:
 * FluentSMTP's `created_at` is a TIMESTAMP read in the site's local tz — a
 * PHP/UTC boundary was off by the site's offset.) Outgoing ISO timestamps are
 * absolute UTC via UNIX_TIMESTAMP(), which converts the stored value to a real
 * epoch. `$*Where` args are code constants (never user input).
 */
function monitorix_agent_agg($table, $timeCol, $failedWhere, $sentWhere, $pendingWhere, $providerName)
{
    global $wpdb;

    $count = function ($where, $interval) use ($wpdb, $table, $timeCol) {
        $sql = "SELECT COUNT(*) FROM `$table` WHERE `$timeCol` >= (NOW() - INTERVAL $interval)"
             . ($where ? " AND $where" : '');
        return (int) $wpdb->get_var($sql);
    };

    $sent1h    = $sentWhere   ? $count($sentWhere, '1 HOUR')    : $count('', '1 HOUR');
    $failed1h  = $failedWhere ? $count($failedWhere, '1 HOUR')  : 0;
    $sent24h   = $sentWhere   ? $count($sentWhere, '24 HOUR')   : $count('', '24 HOUR');
    $failed24h = $failedWhere ? $count($failedWhere, '24 HOUR') : 0;

    // Absolute-UTC epoch of the newest sent/failed row → ISO 8601.
    $maxEpoch = function ($where) use ($wpdb, $table, $timeCol) {
        $sql = "SELECT UNIX_TIMESTAMP(MAX(`$timeCol`)) FROM `$table`" . ($where ? " WHERE $where" : '');
        $v = $wpdb->get_var($sql);
        return $v ? (int) $v : null;
    };
    $lastSuccessEpoch = $maxEpoch($sentWhere ? $sentWhere : '');
    $lastFailEpoch    = $failedWhere ? $maxEpoch($failedWhere) : null;

    // Last failure message — sanitized: strip anything that looks like an e-mail address.
    $lastFailMsg = null;
    if ($failedWhere) {
        $raw = $wpdb->get_var("SELECT `response` FROM `$table` WHERE $failedWhere ORDER BY `$timeCol` DESC LIMIT 1");
        if ($raw) {
            $raw = preg_replace('/[\w.+-]+@[\w.-]+/', '[email]', (string) $raw);
            $lastFailMsg = mb_substr(trim($raw), 0, 200);
        }
    }

    // Queue depth — messages still waiting to be sent (e.g. FluentSMTP 'pending').
    $queueDepth = $pendingWhere ? (int) $wpdb->get_var("SELECT COUNT(*) FROM `$table` WHERE $pendingWhere") : null;

    return [
        'provider'             => $providerName,
        'sent_1h'              => $sent1h,
        'failed_1h'            => $failed1h,
        'sent_24h'             => $sent24h,
        'failed_24h'           => $failed24h,
        'last_success_at'      => $lastSuccessEpoch ? gmdate('c', $lastSuccessEpoch) : null,
        'last_failure_at'      => $lastFailEpoch ? gmdate('c', $lastFailEpoch) : null,
        'last_failure_message' => $lastFailMsg,
        'queue_depth'          => $queueDepth,
    ];
}
