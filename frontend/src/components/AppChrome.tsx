"use client"

import React, { useEffect, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import Sidebar from "@/components/Sidebar"
import Header from "@/components/Header"
import Footer from "@/components/Footer"

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
const SIDEBAR_COLLAPSED_KEY = "bip_sidebar_collapsed"

// Same reasoning as isTradeRoute below, but for the public auth pages
// (password reset / email verification / legal) - these render for a
// logged-out visitor (see AuthGate's PUBLIC_PATHS), so the normal
// Sidebar/Header shell (which assumes an authenticated session, e.g.
// Header's own /auth/me call) doesn't belong here either.
const BARE_PATHS = ["/forgot-password", "/reset-password", "/verify-email"]
const isBarePath = (path: string | null) =>
  !!path && (BARE_PATHS.includes(path) || path.startsWith("/legal/"))

export default function AppChrome({ children }: AppChromeProps) {
  const pathname = usePathname()
  const router = useRouter()
  const isTradeRoute = pathname?.startsWith("/trade") ?? false
  const isBareRoute = isBarePath(pathname)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  // Starts false (expanded) on the server/first paint - the persisted value
  // is read after mount so the initial render always matches what the
  // server sent (avoids a hydration mismatch), then a brief re-render
  // applies the user's saved preference. localStorage isn't available
  // during SSR at all, so this couldn't be the initial state directly.
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    const saved = localStorage.getItem(SIDEBAR_COLLAPSED_KEY)
    if (saved === "1") setCollapsed(true)
  }, [])

  const toggleCollapse = () => {
    setCollapsed(prev => {
      const next = !prev
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0")
      return next
    })
  }

  // Below lg, Sidebar renders as an off-canvas drawer (see Sidebar.tsx) -
  // close it automatically whenever the route changes so it doesn't stay
  // open over the new page after tapping a nav link.
  useEffect(() => {
    setMobileMenuOpen(false)
  }, [pathname])

  // Ctrl+B (or Cmd+B on Mac) toggles the sidebar, matching the common
  // editor/IDE convention for this exact action. Skipped entirely on Trade
  // routes since they don't render this sidebar at all.
  useEffect(() => {
    if (isTradeRoute) return
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
        e.preventDefault()
        toggleCollapse()
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [isTradeRoute])

  if (isTradeRoute || isBareRoute) {
    return <div className="flex-1 flex flex-col overflow-hidden h-screen w-full">{children}</div>
  }

  return (
    <>
      <Sidebar
        open={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
        collapsed={collapsed}
        onToggleCollapse={toggleCollapse}
      />
      <div className="flex-1 flex flex-col overflow-hidden h-screen w-full min-w-0">
        <Header onMenuClick={() => setMobileMenuOpen(true)} />
        <main className="flex-1 overflow-y-auto bg-gradient-to-b from-background to-[#0b0b0f] p-4 md:p-8">
          {/* Every page except the homepage gets a back button - added here
              once, in the shared shell, rather than duplicated per-page. */}
          {pathname !== "/" && (
            <button
              onClick={() => router.back()}
              className="inline-flex items-center gap-1.5 text-xs font-bold text-muted-foreground hover:text-foreground cursor-pointer transition-colors mb-4"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Geri
            </button>
          )}
          {children}
          <Footer />
        </main>
      </div>
    </>
  )
}
