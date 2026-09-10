import type { Metadata, Viewport } from "next"
import { Inter, IBM_Plex_Mono } from "next/font/google"
import "./globals.css"
import AuthGate from "@/components/AuthGate"
import AppChrome from "@/components/AppChrome"

// subsets'e "latin-ext" ZORUNLU: Turkce'nin g-breve, s-cedilla, noktasiz i
// ve buyuk noktali I harfleri (ğ ş ı İ) latin-ext alt kumesinde. Yalnizca
// "latin" yuklendiginde bu harfler Inter'den DEGIL, tarayicinin yedek
// sistem fontundan geliyordu - yani Turkce her metinde harflerin bir kismi
// baska bir yazi tipiyle diziliyordu. Ayni kelimenin icinde iki font demek;
// "fontlar biraz daha guzel olsun" isteginin en somut karsiligi bu.
//
// display "swap": font inerken metin GORUNMEZ kalmiyor, once yedek yuzle
// ciziliyor sonra degisiyor. Sayfa gecislerinde bos ekran suresini kesiyor.
const inter = Inter({ subsets: ["latin", "latin-ext"], display: "swap" })

// Yalnızca gerçekten kod olan içerik için (.font-mono-code, globals.css) -
// 2FA/kurtarma kodları, hata kodu gibi. Fiyat/tutar/yüzde artık bu yüzü
// KULLANMIYOR; onlar Inter + tabular rakamla diziliyor (bkz. globals.css'teki
// .font-mono override'ının yanındaki not). CSS değişkeni yöntemi: variable
// className <html>'e ekleniyor, gerçek font-family ataması globals.css'te.
const plexMono = IBM_Plex_Mono({
  // latin-ext BILEREK YOK: bu yuz yalnizca .font-mono-code'da kullaniliyor
  // (2FA/kurtarma kodlari, hata kodu - hepsi ASCII). Turkce harf hic
  // gecmiyor, latin-ext eklemek her sayfaya iki fazla font dosyasi
  // bindiriyordu.
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
  // preload false: mobilde olculdu, ilk boyamadan once 6 font dosyasi
  // indiriliyordu. Bu yuz uygulamanin ANA ekranlarinin HICBIRINDE
  // kullanilmiyor - yalnizca 2FA kurulumu, kurtarma kodlari ve hata
  // ekraninda. Kritik yoldan cikarildi; ihtiyac duyulan sayfada normal
  // sekilde yukleniyor.
  preload: false,
  variable: "--font-mono-code",
})

export const metadata: Metadata = {
  title: "BIST Intelligence Platform (BIP)",
  description: "AI-Powered BIST Terminal and Research Platform",
  icons: {
    icon: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
  manifest: "/site.webmanifest",
  appleWebApp: {
    capable: true,
    title: "BIP Terminal",
    statusBarStyle: "black-translucent",
  },
  other: {
    // This Next.js version's appleWebApp.capable only emits the generic
    // "mobile-web-app-capable" tag (confirmed by reading metadata.js in
    // node_modules) - iOS Safari specifically requires the apple- prefixed
    // one to launch a home-screen shortcut in standalone/full-screen mode
    // instead of a regular browser tab with Safari's chrome.
    "apple-mobile-web-app-capable": "yes",
  },
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#07090B",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // h-dvh yerine fixed inset-0: standalone (Ana Ekrana Ekle) modda gerçek
  // Safari'den bildirilen bir şikayetle uyuşan bilinen bir WebKit hatası var
  // - 100vh/100dvh standalone modda GERÇEK görünür alandan biraz daha KISA
  // hesaplanabiliyor, bu da body'nin (ve içindeki fixed alt sekme çubuğunun)
  // ekranın gerçek alt kenarına ulaşamayıp bir miktar yukarıda kalmasına,
  // altında boş (aynı arkaplan renginde, fark edilmesi güç) bir şerit
  // bırakmasına yol açıyor. `position: fixed; inset: 0` hiçbir vh/dvh
  // hesabına dayanmıyor - tarayıcının GERÇEK görsel viewport'una göre
  // tanımlanıyor, bu yüzden bu sınıf hatalara karşı bağışık.
  return (
    <html lang="tr" className={`dark ${plexMono.variable}`}>
      <body className={`${inter.className} bg-background text-foreground fixed inset-0 overflow-hidden flex`}>
        <AuthGate>
          <AppChrome>{children}</AppChrome>
        </AuthGate>
      </body>
    </html>
  )
}
