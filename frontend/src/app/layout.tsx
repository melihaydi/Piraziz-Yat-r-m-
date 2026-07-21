import type { Metadata } from "next"
import { Inter } from "next/font/google"
import "./globals.css"
import Sidebar from "@/components/Sidebar"
import Header from "@/components/Header"
import AuthGate from "@/components/AuthGate"

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
          {/* Sidebar */}
          <Sidebar />
          
          {/* Main Content Area */}
          <div className="flex-1 flex flex-col overflow-hidden h-screen">
            <Header />
            <main className="flex-1 overflow-y-auto bg-gradient-to-b from-background to-[#0b0b0f] p-8">
              {children}
            </main>
          </div>
        </AuthGate>
      </body>
    </html>
  )
}
