import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // "standalone" makes `next build` also emit .next/standalone: a minimal,
  // self-contained server.js plus only the node_modules subset actually
  // needed at runtime. This is what makes the Electron/NSIS Windows
  // installer (see frontend/electron-main.js + package.json's "build"
  // config) practical to bundle - without it, packaging would require
  // shipping the entire node_modules folder (hundreds of MB, plus the full
  // Next.js CLI) just to run `next start`. Doesn't change anything about
  // `next dev` / `next start` in normal development.
  //
  // Skipped when deploying on Netlify (which sets NETLIFY=true during every
  // build automatically) - Netlify's own Next.js Runtime has its own
  // serverless bundling and doesn't support "standalone" output; leaving it
  // on there produced a build that looked successful but 404'd on every
  // route.
  output: process.env.NETLIFY ? undefined : "standalone",
};

export default nextConfig;
