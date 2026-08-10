"use client"

import { useEffect, useState } from "react"
import { usePathname } from "next/navigation"
import Link from "next/link"
import {
  LayoutDashboard,
  Search,
  Briefcase,
  Settings,
  Coins,
  Newspaper,
  CandlestickChart,
  X,
  ChevronsLeft,
  ChevronsRight,
  Bot,
  ShieldCheck,
  StickyNote,
  Users
} from "lucide-react"
import { cn } from "@/lib/utils"
import Logo from "@/components/Logo"
import { authFetch } from "@/lib/auth"

interface SidebarProps {
  open?: boolean
  onClose?: () => void
  collapsed?: boolean
  onToggleCollapse?: () => void
}

export default function Sidebar({ open = false, onClose, collapsed = false, onToggleCollapse }: SidebarProps) {
  const pathname = usePathname()

  // The collapsed width only applies at the desktop (lg, >=1024px) layout -
  // below that the sidebar is always the full-width off-canvas drawer
  // regardless of the collapse preference. Tracked in JS (not a `lg:` class)
  // and applied as an inline style so the width always wins the cascade
  // outright, rather than depending on a Tailwind arbitrary-value class
  // beating whichever utility layer order Tailwind v4 happens to compile
  // `w-64` into for this element.
  const [isDesktop, setIsDesktop] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)")
    setIsDesktop(mq.matches)
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches)
    mq.addEventListener("change", handler)
    return () => mq.removeEventListener("change", handler)
  }, [])
  const isCollapsedNow = collapsed && isDesktop

  // Only superusers see the admin panel link - the backend enforces this
  // for real (every /admin/* endpoint requires is_superuser), this is just
  // UX so a regular user never sees a link to a page they'd get a 403 from.
  const [isSuperuser, setIsSuperuser] = useState(false)
  useEffect(() => {
    authFetch("/auth/me")
      .then(res => (res.ok ? res.json() : null))
      .then(data => { if (data) setIsSuperuser(!!data.is_superuser) })
      .catch(() => {})
  }, [])

  const menuItems = [
    {
      name: "Piyasa Takip",
      href: "/",
      icon: LayoutDashboard,
      activeClass: "bg-purple-500/10 text-purple-400 border border-purple-500/20 shadow-[0_0_12px_rgba(168,85,247,0.1)] font-extrabold",
      hoverClass: "text-muted-foreground hover:bg-purple-500/5 hover:text-purple-400",
      iconClass: "text-purple-400"
    },
    {
      name: "Hisseler",
      href: "/screener",
      icon: Search,
      activeClass: "bg-blue-500/10 text-blue-400 border border-blue-500/20 shadow-[0_0_12px_rgba(59,130,246,0.1)] font-extrabold",
      hoverClass: "text-muted-foreground hover:bg-blue-500/5 hover:text-blue-400",
      iconClass: "text-blue-400"
    },
    {
      name: "Trade",
      href: "/trade",
      icon: CandlestickChart,
      // Deliberately distinct color theme from every other menu item - the
      // Trade module is styled as its own professional brokerage terminal
      // (see app/trade/*), so its sidebar entry should read as its own thing
      // at a glance rather than blending into the app's usual palette.
      activeClass: "bg-cyan-500/10 text-cyan-300 border border-cyan-400/30 shadow-[0_0_14px_rgba(34,211,238,0.15)] font-extrabold",
      hoverClass: "text-muted-foreground hover:bg-cyan-500/5 hover:text-cyan-300",
      iconClass: "text-cyan-300"
    },
    {
      name: "Frantic Algoritmik Strateji",
      href: "/strategy",
      icon: Bot,
      // Also its own distinct theme (amber) - a live signal engine is a
      // different kind of tool than the informational pages around it and
      // should read as such at a glance, same reasoning as Trade above.
      activeClass: "bg-amber-500/10 text-amber-300 border border-amber-400/30 shadow-[0_0_14px_rgba(245,158,11,0.15)] font-extrabold",
      hoverClass: "text-muted-foreground hover:bg-amber-500/5 hover:text-amber-300",
      iconClass: "text-amber-300"
    },
    {
      name: "Fon Takip",
      href: "/funds",
      icon: Coins,
      activeClass: "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shadow-[0_0_12px_rgba(16,185,129,0.1)] font-extrabold",
      hoverClass: "text-muted-foreground hover:bg-emerald-500/5 hover:text-emerald-400",
      iconClass: "text-emerald-400"
    },
    {
      name: "Portföyüm",
      href: "/portfolio",
      icon: Briefcase,
      activeClass: "bg-orange-500/10 text-orange-400 border border-orange-500/20 shadow-[0_0_12px_rgba(249,115,22,0.1)] font-extrabold",
      hoverClass: "text-muted-foreground hover:bg-orange-500/5 hover:text-orange-400",
      iconClass: "text-orange-400"
    },
    {
      name: "Ekonomi Haberleri",
      href: "/news",
      icon: Newspaper,
      activeClass: "bg-purple-500/10 text-purple-400 border border-purple-500/20 shadow-[0_0_12px_rgba(168,85,247,0.1)] font-extrabold",
      hoverClass: "text-muted-foreground hover:bg-purple-500/5 hover:text-purple-400",
      iconClass: "text-purple-400"
    },
    {
      name: "Notlarım",
      href: "/notes",
      icon: StickyNote,
      activeClass: "bg-pink-500/10 text-pink-400 border border-pink-500/20 shadow-[0_0_12px_rgba(236,72,153,0.1)] font-extrabold",
      hoverClass: "text-muted-foreground hover:bg-pink-500/5 hover:text-pink-400",
      iconClass: "text-pink-400"
    },
    {
      name: "Ayarlar",
      href: "/settings",
      icon: Settings,
      activeClass: "bg-zinc-800/40 text-zinc-300 border border-zinc-700/60 shadow-inner font-extrabold",
      hoverClass: "text-muted-foreground hover:bg-zinc-800/20 hover:text-zinc-300",
      iconClass: "text-zinc-400"
    },
    ...(isSuperuser ? [{
      name: "Yönetim Paneli",
      href: "/admin",
      icon: ShieldCheck,
      activeClass: "bg-red-500/10 text-red-400 border border-red-500/20 shadow-[0_0_12px_rgba(239,68,68,0.1)] font-extrabold",
      hoverClass: "text-muted-foreground hover:bg-red-500/5 hover:text-red-400",
      iconClass: "text-red-400"
    }, {
      // Reached directly from the sidebar (not nested inside the admin
      // dashboard) per explicit request - own page, own route, same
      // superuser-only visibility as "Yönetim Paneli" above.
      name: "Yönetilen Portföyler",
      href: "/admin/managed-portfolios",
      icon: Users,
      activeClass: "bg-red-500/10 text-red-400 border border-red-500/20 shadow-[0_0_12px_rgba(239,68,68,0.1)] font-extrabold",
      hoverClass: "text-muted-foreground hover:bg-red-500/5 hover:text-red-400",
      iconClass: "text-red-400"
    }] : []),
  ]


  return (
    <>
      {/* Backdrop - mobile/tablet only, closes the drawer on tap outside */}
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        style={{ width: isCollapsedNow ? 76 : 256 }}
        className={cn(
          "border-r border-border bg-card flex flex-col h-screen z-40 transition-[transform,width] duration-250 ease-out",
          "fixed inset-y-0 left-0 lg:sticky lg:top-0 lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Brand Header */}
        <div className={cn("h-16 flex items-center border-b border-border shrink-0", isCollapsedNow ? "justify-center px-0" : "px-6 justify-between")}>
          {!isCollapsedNow && (
            <Link href="/" onClick={() => onClose?.()} className="flex items-center cursor-pointer min-w-0">
              <Logo />
            </Link>
          )}
          {/* Collapsed-desktop: just the mark, no wordmark, no wasted space */}
          {isCollapsedNow && (
            <Link
              href="/"
              onClick={() => onClose?.()}
              className="flex h-9 w-9 rounded-xl overflow-hidden cursor-pointer shrink-0"
            >
              <img src="/logo.png" alt="Piraziz Yatırım" className="h-full w-full object-cover" />
            </Link>
          )}
          {!isCollapsedNow && (
            <button
              onClick={onClose}
              className="lg:hidden text-muted-foreground hover:text-foreground cursor-pointer"
              aria-label="Menüyü kapat"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        {/* Navigation Links */}
        <nav className={cn("flex-1 py-6 space-y-1.5 overflow-y-auto overflow-x-hidden", isCollapsedNow ? "px-3" : "px-4")}>
          {(() => {
            // "/" needs an exact match (otherwise it'd match every route);
            // everything else uses startsWith so sub-routes like /trade/performance
            // or a fund detail page still keep their parent menu item highlighted.
            // Two entries can both be href-prefixes of the same pathname now
            // that /admin has a child route with its own sidebar entry
            // (/admin/managed-portfolios) - only the LONGEST matching href
            // should light up, otherwise "Yönetim Paneli" and "Yönetilen
            // Portföyler" both showed active at once on the child page.
            const matchingHrefs = menuItems
              .map(i => i.href)
              .filter(href => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/")))
            const activeHref = matchingHrefs.sort((a, b) => b.length - a.length)[0]

            return menuItems.map((item) => {
            const isActive = item.href === activeHref
            const Icon = item.icon
            return (
              <div key={item.name} className="relative group/navitem">
                <Link
                  href={item.href}
                  onClick={() => onClose?.()}
                  className={cn(
                    "w-full flex items-center h-10 rounded-lg text-sm font-medium transition-all duration-200 group cursor-pointer border border-transparent text-left",
                    isCollapsedNow ? "justify-center px-0" : "px-4",
                    isActive ? item.activeClass : item.hoverClass
                  )}
                >
                  <Icon className={cn(
                    "h-4 w-4 shrink-0 transition-transform duration-200 group-hover:scale-110",
                    !isCollapsedNow && "mr-3",
                    isActive ? item.iconClass : "text-muted-foreground group-hover:text-foreground"
                  )} />
                  {!isCollapsedNow && <span className="truncate">{item.name}</span>}
                </Link>
                {/* Tooltip - collapsed desktop only, shown on hover next to the icon */}
                {isCollapsedNow && (
                  <div className="hidden group-hover/navitem:block absolute left-full top-1/2 -translate-y-1/2 ml-2 px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-700 text-xs font-semibold text-foreground whitespace-nowrap shadow-lg z-50 pointer-events-none">
                    {item.name}
                  </div>
                )}
              </div>
            )
            })
          })()}
        </nav>

        {/* Collapse/expand toggle - desktop only, mobile uses the drawer's own close button */}
        <div className={cn("hidden lg:flex border-t border-border p-3", isCollapsedNow ? "justify-center" : "justify-end")}>
          <button
            onClick={onToggleCollapse}
            title={collapsed ? "Menüyü genişlet (Ctrl+B)" : "Menüyü daralt (Ctrl+B)"}
            className="h-9 w-9 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-zinc-800/40 transition-colors cursor-pointer"
            aria-label={collapsed ? "Menüyü genişlet" : "Menüyü daralt"}
          >
            {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
          </button>
        </div>
      </aside>
    </>
  )
}
