import type { Metadata, Viewport } from "next"
import { Inter } from "next/font/google"
import "./globals.css"
import AuthGate from "@/components/AuthGate"
import AppChrome from "@/components/AppChrome"

const inter = Inter({ subsets: ["latin"] })

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
    title: "Piraziz Yatırım",
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
  themeColor: "#101015",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="tr" className="h-full dark">
      <body className={`${inter.className} bg-background text-foreground h-full overflow-hidden flex`}>
        <AuthGate>
          <AppChrome>{children}</AppChrome>
        </AuthGate>
      </body>
    </html>
  )
}
