import type { Metadata } from "next"
import { Inter } from "next/font/google"
import "./globals.css"
import AuthGate from "@/components/AuthGate"
import AppChrome from "@/components/AppChrome"

const inter = Inter({ subsets: ["latin"] })

export const metadata: Metadata = {
  title: "BIST Intelligence Platform (BIP)",
  description: "AI-Powered BIST Terminal and Research Platform",
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
