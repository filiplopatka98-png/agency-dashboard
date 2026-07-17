import type { NextConfig } from "next";

/**
 * Železné pravidlo fázy 1: UI je čistý statický export (žiadny SSR / Server
 * Actions / API routes). To je jediný dôvod, prečo je fáza 1 zadarmo.
 */
const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  trailingSlash: true,
  // Dev-only: povoľ HMR/hydratáciu aj z 127.0.0.1 (nie len localhost). Bez toho
  // Next 16 blokuje dev assety z „cudzieho" originu → stránka sa nezhydratuje.
  allowedDevOrigins: ["localhost", "127.0.0.1"],
  // @agency/core je workspace balík, ktorého "main" ukazuje priamo na
  // TypeScript zdroj (./src/index.ts), nie na skompilovaný JS — bez
  // transpilePackages by ho webpack/Next nevedel spracovať. Používame ho na
  // zdieľanie JOB_SCHEDULES/isOverdue (dead-man's switch, settings/page.tsx)
  // s apps/scheduler, nech interval jobu nie je hardcoded na dvoch miestach.
  transpilePackages: ["@agency/core", "@agency/shared"],
  // packages/core/src/*.ts si interne importuje súrodenecké moduly s príponou
  // `.js` (napr. `from './reportText.js'`) — štandardný TS/ESM trik, aby
  // skompilovaný `dist/*.js` (ktorý čítajú Node nástroje) fungoval bez
  // extra kroku. Turbopack (na rozdiel od esbuildu, ktorý používa
  // apps/scheduler) tento .js→.ts alias nevie sám — bez `extensionAlias`
  // build padne na "Module not found: Can't resolve './reportText.js'"
  // (overené). Preto build/dev bežia na webpacku (`--webpack` v scriptoch
  // nižšie) — jediný spôsob, ako @agency/core importovať priamo zo zdroja
  // bez duplikovania report rendererov v apps/web.
  webpack(config) {
    config.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"] };
    return config;
  },
};

export default nextConfig;
