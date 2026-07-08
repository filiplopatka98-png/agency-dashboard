import type { NextConfig } from "next";

/**
 * Železné pravidlo fázy 1: UI je čistý statický export (žiadny SSR / Server
 * Actions / API routes). To je jediný dôvod, prečo je fáza 1 zadarmo.
 */
const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  trailingSlash: true,
};

export default nextConfig;
