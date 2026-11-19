import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // This folder is the whole app. Saying so stops Next guessing a wider root (and warning) when a
  // parent folder also has a package-lock.json, as the download's root does after `npm install` there.
  turbopack: { root: __dirname },
  outputFileTracingRoot: __dirname,
  experimental: {
    // Pages in the app fetch their own data on the client (kept live over Realtime), so their server
    // part can be reused when switching back to them: no round trip on every click.
    staleTimes: { dynamic: 60 },
  },
};

export default nextConfig;
