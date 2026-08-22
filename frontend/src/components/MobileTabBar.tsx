"use client"

import { useEffect, useState } from "react"
import { usePathname } from "next/navigation"
import Link from "next/link"
import { LayoutDashboard, Briefcase, Coins, CandlestickChart, Menu } from "lucide-react"
import { cn } from "@/lib/utils"
import { authFetch } from "@/lib/auth"

/**
 * Mobil/tablet birincil gezinme - alt sekme çubuğu.
 *
 * Neden bu var: uygulama iOS ana ekranına kurulabiliyor
 * (layout.tsx'teki appleWebApp.capable), yani kullanıcı onu bir Safari
 * sekmesi değil bir UYGULAMA olarak açıyor. Ama tek gezinme yolu sağ üstteki
 * hamburger + tam ekran çekmeceydi - masaüstü web deseni. Tek elle kullanılan
 * bir finans uygulamasında birincil hedefler (Portföy, Piyasa, Fonlar,
 * İşlem) başparmağın ulaşabildiği yerde olmalı; çekmece ikincil şeyler
 * ("Daha" - Ayarlar, Notlar, Haberler, admin sayfaları) için kalıyor.
 *
 * Header'daki hamburger KALDIRILMADI - iki yol bir arada zararsız ve o
 * tuşun kendi iOS dokunuş-gecikmesi düzeltmesi (pointerdown+click) hâlâ
 * geçerli. Bu çubuk birincil, hamburger ikincil bir erişim yolu oluyor.
 */

interface MobileTabBarProps {
  onMoreClick: () => void
  /** Çekmece açıkken "Daha" sekmesinin etkin görünmesi için. */
  drawerOpen: boolean
}

interface TabItem {
  name: string
  href?: string
  icon: React.ComponentType<{ className?: string }>
  onClick?: () => void
  isActive: (pathname: string, drawerOpen: boolean) => boolean
}

export default function MobileTabBar({ onMoreClick, drawerOpen }: MobileTabBarProps) {
  const pathname = usePathname() || "/"

  // İşlem sekmesi ücretsiz üyelikte tamamen gizli - Header'daki Trade
  // butonuyla aynı ürün kararı ("gösterip griletmek yerine hiç gösterme").
  // /trade'e zaten girilse bile kendi accessDenied ekranını gösteriyor,
  // ama tutarlılık için burada da aynı kural uygulanıyor.
  const [role, setRole] = useState<string | null>(null)
  useEffect(() => {
    authFetch("/auth/me")
      .then(res => (res.ok ? res.json() : null))
      .then(data => { if (data?.role) setRole(data.role) })
      .catch(() => {})
  }, [])
  const isFreeTier = role === "free"

  const primaryHrefs = ["/", "/portfolio", "/funds", "/trade"]

  const items: TabItem[] = [
    {
      name: "Piyasa",
      href: "/",
      icon: LayoutDashboard,
      isActive: (p) => p === "/",
    },
    {
      name: "Portföy",
      href: "/portfolio",
      icon: Briefcase,
      isActive: (p) => p === "/portfolio" || p.startsWith("/portfolio/"),
    },
    {
      name: "Fonlar",
      href: "/funds",
      icon: Coins,
      isActive: (p) => p === "/funds" || p.startsWith("/funds/"),
    },
    ...(isFreeTier ? [] : [{
      name: "İşlem",
      href: "/trade",
      icon: CandlestickChart,
      isActive: (p: string) => p.startsWith("/trade"),
    } as TabItem]),
    {
      name: "Daha",
      icon: Menu,
      onClick: onMoreClick,
      // Birincil dört hedeften hiçbirinde değilsek (Ayarlar, Notlar,
      // Haberler, admin sayfaları...) ya da çekmece açıksa "Daha" etkin
      // görünür - kullanıcı her an uygulamanın neresinde olduğunu görebilsin.
      isActive: (p, open) => open || !primaryHrefs.some(h => h === "/" ? p === "/" : p === h || p.startsWith(h + "/")),
    },
  ]

  return (
    <nav
      className={cn(
        // z-20: Header ile aynı katman, Sidebar'ın perdesinin (z-30) ALTINDA
        // kalıyor bilerek - çekmece açıkken sayfanın geri kalanı gibi bu da
        // perdenin arkasında kalsın, üstüne binip tıklanabilir kalmasın.
        "lg:hidden fixed inset-x-0 bottom-0 z-20",
        // V2: Base yüzeyi (sürgü/üst çubukla aynı kademe) - içerik alanı
        // Workspace'te durduğu için çubuk ondan kendiliğinden ayrılıyor.
        "border-t border-border bg-background/95 backdrop-blur-md",
        // env(safe-area-inset-bottom) bazı Android WebView'lerde gerçek
        // jest navigasyon çubuğundan çok daha büyük bir değer bildirebiliyor
        // - çubuk o zaman gerektiğinden fazla yukarı şişiyor, ikonlarla asıl
        // ekran alt kenarı arasında büyük bir boş şerit bırakıyor. min() ile
        // en fazla 16px'e sınırlanıyor; gerçek çentik/jest payı buna kadarsa
        // yine tam saygı görüyor.
        "pb-[min(env(safe-area-inset-bottom),16px)]"
      )}
      aria-label="Birincil gezinme"
    >
      <div className="grid h-14" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map((item) => {
          const Icon = item.icon
          const active = item.isActive(pathname, drawerOpen)
          const className = cn(
            "press flex flex-col items-center justify-center gap-0.5 h-full min-w-0 cursor-pointer touch-manipulation",
            active ? "text-primary" : "text-muted-foreground"
          )
          const content = (
            <>
              <Icon className="h-5 w-5 shrink-0" />
              <span className={cn("text-[10px] leading-none truncate max-w-full px-1", active ? "font-bold" : "font-semibold")}>
                {item.name}
              </span>
            </>
          )
          if (item.href) {
            return (
              <Link key={item.name} href={item.href} className={className} aria-label={item.name}>
                {content}
              </Link>
            )
          }
          return (
            <button
              key={item.name}
              type="button"
              onClick={item.onClick}
              className={className}
              aria-label={item.name}
            >
              {content}
            </button>
          )
        })}
      </div>
    </nav>
  )
}
