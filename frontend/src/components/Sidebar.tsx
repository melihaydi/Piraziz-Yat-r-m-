"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { 
  LayoutDashboard, 
  Search, 
  Briefcase, 
  Settings,
  Coins,
  Newspaper
} from "lucide-react"
import { cn } from "@/lib/utils"
import Logo from "@/components/Logo"

export default function Sidebar() {
  const pathname = usePathname()

  const menuItems = [
    { name: "Piyasa Takip", href: "/", icon: LayoutDashboard },
    { name: "Screener (Filtre)", href: "/screener", icon: Search },
    { name: "Fon Takip", href: "/funds", icon: Coins, highlight: true },
    { name: "Portföyüm", href: "/portfolio", icon: Briefcase },
    { name: "Ekonomi Haberleri", href: "/news", icon: Newspaper },
    { name: "Ayarlar", href: "/settings", icon: Settings },
  ]

  return (
    <aside className="w-64 border-r border-border bg-card flex flex-col h-screen sticky top-0">
      {/* Brand Header */}
      <div className="h-16 flex items-center px-6 border-b border-border">
        <Link href="/" className="flex items-center">
          <Logo />
        </Link>
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 px-4 py-6 space-y-1.5 overflow-y-auto">
        {menuItems.map((item) => {
          const isActive = pathname === item.href
          const Icon = item.icon
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                "flex items-center px-4 h-10 rounded-lg text-sm font-medium transition-all duration-200 group cursor-pointer",
                isActive
                  ? "bg-primary text-primary-foreground shadow-md shadow-primary/20"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                item.highlight && !isActive && "text-emerald-400 hover:text-emerald-300 font-semibold"
              )}
            >
              <Icon className={cn(
                "h-4 w-4 mr-3 transition-transform duration-200 group-hover:scale-110",
                isActive ? "text-primary-foreground" : "text-muted-foreground group-hover:text-foreground",
                item.highlight && !isActive && "text-emerald-400"
              )} />
              {item.name}
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
