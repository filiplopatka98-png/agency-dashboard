import { describe, expect, it } from 'vitest';
import { wpCronKickUrl } from './runWpCronKick';

describe('wpCronKickUrl', () => {
  it('volá wp-cron.php BEZ hodnoty doing_wp_cron — s cudzou hodnotou WordPress cron nespustí', () => {
    // wp-cron.php porovná GET `doing_wp_cron` s transientom `doing_cron`, ktorý
    // si nastaví LEN sám spawn_cron(); náš vymyslený timestamp nesedí → return
    // bez spustenia jobov. Bez parametra ide vetva „externý cron" (sám si nastaví zámok).
    expect(wpCronKickUrl('krivosik.sk')).toBe('https://krivosik.sk/wp-cron.php');
  });
});
