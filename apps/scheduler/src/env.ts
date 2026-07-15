/** Secrets sa nastavujú cez `wrangler secret put` — NIKDY nie do repo. */
export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  RESEND_API_KEY: string;
  ALERT_EMAIL_TO: string;
  ALERT_EMAIL_FROM: string;
  UPTIME_PROVIDER: string;
  WP_INGEST_TOKEN: string;
}
