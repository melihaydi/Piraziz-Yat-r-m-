"use client"

import React, { useEffect, useState } from "react"
import { usePathname } from "next/navigation"
import Sidebar from "@/components/Sidebar"
import Header from "@/components/Header"

interface AppChromeProps {
  children: React.ReactNode
}

/**
 * Trade is a dedicated, full-page brokerage terminal - it needs the entire
 * viewport (no room lost to the app's persistent left nav + top ticker
 * header), has its own account summary bar in place of the global Header,
 * and its own internal navigation back to the main app. Every other route
 * keeps the normal Sidebar + Header shell untouched.
 */
export default function AppChrome({ children }: AppChromeProps) {
  const pathname = usePathname()
  const isTradeRoute = pathname?.startsWith("/trade") ?? false
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  // Below lg, Sidebar renders as an off-canvas drawer (see Sidebar.tsx) -
  // close it automatically whenever the route changes so it doesn't stay
  // open over the new page after tapping a nav link.
  useEffect(() => {
    setMobileMenuOpen(false)
  }, [pathname])

  if (isTradeRoute) {
    return <div className="flex-1 flex flex-col overflow-hidden h-screen w-full">{children}</div>
  }

  return (
    <>
      <Sidebar open={mobileMenuOpen} onClose={() => setMobileMenuOpen(false)} />
      <div className="flex-1 flex flex-col overflow-hidden h-screen w-full min-w-0">
        <Header onMenuClick={() => setMobileMenuOpen(true)} />
        <main className="flex-1 overflow-y-auto bg-gradient-to-b from-background to-[#0b0b0f] p-4 md:p-8">
          {children}
        </main>
      </div>
    </>
  )
}
