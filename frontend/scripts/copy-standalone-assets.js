// Next.js's "standalone" output (see next.config.ts) produces a minimal
// .next/standalone/server.js, but deliberately does NOT copy static assets
// into it (https://nextjs.org/docs/pages/api-reference/config/next-config-js/output).
// Those have to be copied in manually as a post-build step:
//   - .next/static  -> .next/standalone/.next/static
//   - public/       -> .next/standalone/public
// This is exactly that step, run automatically after `next build` (see the
// "build" script in package.json) so the folder that gets bundled into the
// Windows installer (frontend-standalone, via electron-builder's
// extraResources) is immediately runnable as-is.

const fs = require("fs")
const path = require("path")

const root = path.join(__dirname, "..")
const standaloneDir = path.join(root, ".next", "standalone")

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return
  fs.mkdirSync(dest, { recursive: true })
  fs.cpSync(src, dest, { recursive: true })
}

if (!fs.existsSync(standaloneDir)) {
  console.warn("[copy-standalone-assets] .next/standalone not found - is next.config.ts missing output: \"standalone\"? Skipping.")
  process.exit(0)
}

copyDir(path.join(root, ".next", "static"), path.join(standaloneDir, ".next", "static"))
copyDir(path.join(root, "public"), path.join(standaloneDir, "public"))

console.log("[copy-standalone-assets] Copied .next/static and public/ into .next/standalone.")
