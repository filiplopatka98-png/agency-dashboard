/** Secrets sa nastavujú cez `wrangler secret put` — NIKDY nie do repo. */
export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  RESEND_API_KEY: string;
  ALERT_EMAIL_TO: string;
  ALERT_EMAIL_FROM: string;
  UPTIME_PROVIDER: string;
  WP_INGEST_TOKEN: string;
  // Ručné spustenie jobu z UI (voliteľné — kým nie sú nastavené, /trigger vráti 503).
  GH_DISPATCH_TOKEN: string; // fine-grained PAT, actions:write
  GH_REPO: string; // "owner/repo"
  SUPABASE_JWT_SECRET: string; // overenie prihláseného admina
}
