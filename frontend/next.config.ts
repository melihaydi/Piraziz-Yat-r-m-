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
  output: "standalone",
};

export default nextConfig;
