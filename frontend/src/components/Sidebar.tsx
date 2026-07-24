"use client"

import { useRouter, usePathname } from "next/navigation"
import {
  LayoutDashboard,
  Search,
  Briefcase,
  Settings,
  Coins,
  Newspaper,
  CandlestickChart,
  X
} from "lucide-react"
import { cn } from "@/lib/utils"
import Logo from "@/components/Logo"

interface SidebarProps {
  open?: boolean
  onClose?: () => void
}

export default function Sidebar({ open = false, onClose }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()

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
      name: "Ayarlar", 
      href: "/settings", 
      icon: Settings,
      activeClass: "bg-zinc-800/40 text-zinc-300 border border-zinc-700/60 shadow-inner font-extrabold",
      hoverClass: "text-muted-foreground hover:bg-zinc-800/20 hover:text-zinc-300",
      iconClass: "text-zinc-400"
    },
  ]

  const handleNav = (href: string) => {
    router.push(href)
    onClose?.()
  }

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
        className={cn(
          "w-64 border-r border-border bg-card flex flex-col h-screen z-40 transition-transform duration-200 ease-out",
          "fixed inset-y-0 left-0 lg:sticky lg:top-0 lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Brand Header */}
        <div className="h-16 flex items-center justify-between px-6 border-b border-border">
          <div onClick={() => handleNav("/")} className="flex items-center cursor-pointer">
            <Logo />
          </div>
          <button
            onClick={onClose}
            className="lg:hidden text-muted-foreground hover:text-foreground cursor-pointer"
            aria-label="Menüyü kapat"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Navigation Links */}
        <nav className="flex-1 px-4 py-6 space-y-1.5 overflow-y-auto">
          {menuItems.map((item) => {
            // "/" needs an exact match (otherwise it'd match every route);
            // everything else uses startsWith so sub-routes like /trade/performance
            // or a fund detail page still keep their parent menu item highlighted.
            const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href)
            const Icon = item.icon
            return (
              <button
                key={item.name}
                onClick={() => handleNav(item.href)}
                className={cn(
                  "w-full flex items-center px-4 h-10 rounded-lg text-sm font-medium transition-all duration-200 group cursor-pointer border border-transparent text-left",
                  isActive ? item.activeClass : item.hoverClass
                )}
              >
                <Icon className={cn(
                  "h-4 w-4 mr-3 transition-transform duration-200 group-hover:scale-110",
                  isActive ? item.iconClass : "text-muted-foreground group-hover:text-foreground"
                )} />
                {item.name}
              </button>
            )
          })}
        </nav>
      </aside>
    </>
  )
}
