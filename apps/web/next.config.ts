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
};

export default nextConfig;
