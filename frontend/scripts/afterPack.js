// electron-builder's extraResources copy step silently drops the nested
// node_modules folder from the bundled Next.js "standalone" output (it seems
// to apply its own npm-dependency pruning meant for the *app's own*
// node_modules to any node_modules it finds during copying, including this
// unrelated one, and ends up stripping it to nothing - filed upstream as a
// known footgun with "standalone" server bundles). Without node_modules the
// packaged server.js throws immediately on `require("next")`. Since the
// Electron main process spawns it with stdio: "ignore" (see
// frontend/electron-main.js), that crash was completely invisible - the app
// just sat on its loading screen forever, looking "stuck" with no error.
//
// Fix: force-copy the real node_modules from the source standalone build
// into the packaged output ourselves, after electron-builder has finished
// packing, bypassing whatever pruning it was doing.
const fs = require("fs")
const path = require("path")

module.exports = async function afterPack(context) {
  const src = path.join(__dirname, "..", ".next", "standalone", "node_modules")
  const dest = path.join(context.appOutDir, "resources", "frontend-standalone", "node_modules")

  if (!fs.existsSync(src)) {
    console.warn("[afterPack] .next/standalone/node_modules not found - skipping frontend-standalone fix-up.")
    return
  }

  fs.rmSync(dest, { recursive: true, force: true })
  fs.cpSync(src, dest, { recursive: true })
  console.log(`[afterPack] Restored node_modules into packaged frontend-standalone (${dest}).`)
}
