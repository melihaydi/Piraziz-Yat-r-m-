import type { CapacitorConfig } from "@capacitor/cli"

// This wraps the already-deployed Netlify site in a native Android shell
// (server.url mode) rather than bundling a static export - the app is a
// dynamic, auth-gated, live-data trading terminal (real-time BIST quotes,
// server-rendered API calls), which isn't a good fit for `next export`'s
// static-only output. Same approach conceptually as the Electron desktop
// build, just for Android instead of Windows.
const config: CapacitorConfig = {
  appId: "com.pirazizyatirim.app",
  appName: "Piraziz Yatırım",
  webDir: "public",
  server: {
    url: "https://pirazizyatirim.netlify.app",
    cleartext: false,
  },
}

export default config
