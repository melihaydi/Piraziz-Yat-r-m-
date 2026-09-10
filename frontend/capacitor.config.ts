import type { CapacitorConfig } from "@capacitor/cli"

// This wraps the already-deployed Netlify site in a native Android shell
// (server.url mode) rather than bundling a static export - the app is a
// dynamic, auth-gated, live-data trading terminal (real-time BIST quotes,
// server-rendered API calls), which isn't a good fit for `next export`'s
// static-only output. Same approach conceptually as the Electron desktop
// build, just for Android instead of Windows.
const config: CapacitorConfig = {
  appId: "com.pirazizyatirim.app",
  appName: "BIP Terminal",
  webDir: "public",
  server: {
    // bipterminal.com - Netlify'in kendi alt alani DEGIL.
    //
    // Eskiden burasi https://pirazizyatirim.netlify.app'i gosteriyordu ve
    // APK BOZUKTU: o alan adi API'nin CORS listesinde yok (backend
    // config.py get_cors_origins yalnizca localhost + FRONTEND_URL +
    // EXTRA_CORS_ORIGINS'e izin veriyor). Canli dogrulandi - Netlify
    // Origin'i ile yapilan preflight istegine Access-Control-Allow-Origin
    // BASLIGI HIC DONMUYOR, bipterminal.com ile donuyor.
    //
    // Sonuc: uygulama aciliyor, giris formu goruntuleniyor ama /auth/* dahil
    // hicbir API cagrisi calismiyordu - yani indirilen APK pratikte olu bir
    // kabuktu. Netlify alt alaninin API'den kesilmesi BILEREK yapilmisti
    // (bkz. main.py'deki CORS notu); atlanan sey, mobil kabugun hala o
    // adresi yukluyor olmasiydi.
    url: "https://bipterminal.com",
    cleartext: false,
  },
}

export default config
