#!/usr/bin/env bash
# Produkčný deploy — spúšťaj LOKÁLNE ty (Node 22 + wrangler/Supabase auth).
# Secrety sa čítajú z PROSTREDIA (nikdy nie hardcoded, nikdy neprejdú cez agenta).
#
# Použitie:
#   nvm use                     # Node 22 (wrangler to vyžaduje)
#   export NEXT_PUBLIC_SUPABASE_URL=...
#   export NEXT_PUBLIC_SUPABASE_ANON_KEY=...
#   export SUPABASE_SERVICE_ROLE_KEY=...      # len pri builde; BEZ NEXT_PUBLIC_ prefixu
#   ./deploy-prod.sh
#
# Predpoklady: `wrangler` je prihlásený; Worker secrety (RESEND_*, ALERT_*,
# SUPABASE_*) sú už nastavené cez `wrangler secret put` (viď README). Žiadne nové
# DB migrácie v tomto release → Supabase `db push` NETREBA.
set -euo pipefail

# ── 0) Sanity ────────────────────────────────────────────────────────────────
node -v | grep -qE 'v(2[2-9]|[3-9][0-9])' || { echo "❌ Treba Node 22+ (wrangler). Spusti: nvm use"; exit 1; }
: "${NEXT_PUBLIC_SUPABASE_URL:?nastav NEXT_PUBLIC_SUPABASE_URL}"
: "${NEXT_PUBLIC_SUPABASE_ANON_KEY:?nastav NEXT_PUBLIC_SUPABASE_ANON_KEY}"
: "${SUPABASE_SERVICE_ROLE_KEY:?nastav SUPABASE_SERVICE_ROLE_KEY (potrebný pri web builde, inak Next 16.2 padne)}"

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

echo "▸ install (frozen)"
pnpm install --frozen-lockfile

echo "▸ CI brána: typecheck + test + lint"
pnpm typecheck
pnpm test
pnpm lint

# ── 1) Scheduler (Cloudflare Worker) ─────────────────────────────────────────
# NUTNÉ: oprava esc() v alert e-mailoch je v jeho ceste (renderAlertHtml).
echo "▸ scheduler → wrangler deploy"
( cd apps/scheduler && wrangler deploy )

# ── 2) Web (Cloudflare Pages) ────────────────────────────────────────────────
echo "▸ web build (so service key len pri builde)"
pnpm --filter web build

echo "▸ kontrola, že service key NEÚNIKOL do klientského bundlu (musí byť prázdne)"
if grep -rl "$SUPABASE_SERVICE_ROLE_KEY" apps/web/out/ >/dev/null 2>&1; then
  echo "❌ SUPABASE_SERVICE_ROLE_KEY sa našiel v apps/web/out/ — NEDEPLOYUJ, oprav najprv."
  exit 1
fi
echo "  ✓ čisté"

echo "▸ web → wrangler pages deploy"
wrangler pages deploy apps/web/out

# ── 3) Hotovo ────────────────────────────────────────────────────────────────
cat <<'DONE'

✅ Scheduler + web nasadené.

Zostáva ručne:
  • Collectory (SEO/AEO opravy): spusti workflow_dispatch na seo-crawl.yml a
    aeo-probe.yml (alebo počkaj na ďalší cron beh — Actions si core dist buildnú samy).
  • Po prvom KOMPLETNOM SEO crawle: zmaž z change_log nevyexpedované SEO 'fixed'
    eventy z dňa nasadenia (jednorazový artefakt z premenovania issue typov).
  • Preklikaj prihlásené obrazovky + verejnú status stránku (dark mode).
DONE
