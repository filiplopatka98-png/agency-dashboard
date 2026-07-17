/** Secrets sa nastavujú cez `wrangler secret put` — NIKDY nie do repo. */
export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  RESEND_API_KEY: string;
  ALERT_EMAIL_TO: string;
  ALERT_EMAIL_FROM: string;
  UPTIME_PROVIDER: string;
  WP_INGEST_TOKEN: string;
  // Ručné spustenie jobu z UI (voliteľné — kým nie sú nastavené GH_*, /trigger vráti 503).
  // Overenie prihláseného admina je ES256 cez Supabase JWKS (SUPABASE_URL
  // vyššie) — žiadny zdieľaný JWT secret už netreba.
  GH_DISPATCH_TOKEN: string; // fine-grained PAT, actions:write
  GH_REPO: string; // "owner/repo"
}
