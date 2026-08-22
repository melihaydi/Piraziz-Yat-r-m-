"use client"

import { useEffect, useRef, useState } from "react"
import { usePathname } from "next/navigation"
import Link from "next/link"
import {
  LayoutDashboard,
  Search,
  Briefcase,
  Settings,
  Coins,
  Newspaper,
  X,
  ChevronsLeft,
  ChevronsRight,
  Bot,
  ShieldCheck,
  StickyNote,
  Users,
  PieChart,
  Star,
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

interface NavItem {
  name: string
  href: string
  icon: React.ComponentType<{ className?: string }>
}

interface NavGroup {
  /** Grup başlığı - daraltılmış masaüstünde gizlenir. */
  label: string
  items: NavItem[]
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

  // Sürgü açıldıktan sonra gelen İLK click yutulur ("armed" olana kadar).
  //
  // Sebep: açılan sürgünün kendi marka satırındaki logo bağlantısı (h-16,
  // px-6) ekranın sol üst köşesine, yani az önce basılan hamburger tuşunun
  // ÜSTÜNE oturuyor. Menüyü açan dokunuşun ardından gelen click - iOS'ta
  // hem gecikmeli hem de bazen ikinci bir sentetik olay olarak - o
  // bağlantıya düşüyor, Link'in kendi onClick'i onClose çağırdığı için menü
  // açıldığı anda geri kapanıyordu. Dışarıdan görüntü: "bastım, açılmadı".
  //
  // Zamanlayıcı yerine pointerdown'a bağlı, çünkü GERÇEK bir ikinci dokunuş
  // her zaman kendi pointerdown'ıyla başlar; sürgü açıldıktan sonra sarkan
  // click'in ise sürgü üstünde bir pointerdown'ı yoktur. Böylece kullanıcı
  // menü belirir belirmez bir öğeye dokunabiliyor (sabit bir bekleme süresi
  // dayatmıyoruz), sarkan click ise geçmiyor. 500ms'lik zamanlayıcı sadece
  // emniyet supabı: klavyeyle (Tab+Enter) gezinmede pointerdown hiç
  // olmadığı için sürgü sonsuza kadar kilitli kalmasın.
  // useState değil useRef, bilerek: pointerdown ile onu izleyen click aynı
  // dokunuşun iki ayrı olayı. State kullanılsa "armed" değerinin click'e
  // yetişmesi React'in arada bir render yapmasına bağlı kalırdı; ref
  // senkron okunur, yarış yok. Zaten hiçbir şey render etmiyor.
  const armedRef = useRef(false)
  useEffect(() => {
    armedRef.current = false
    if (!open) return
    const t = setTimeout(() => { armedRef.current = true }, 500)
    return () => clearTimeout(t)
  }, [open])

  // Only superusers see the admin panel link - the backend enforces this
  // for real (every /admin/* endpoint requires is_superuser), this is just
  // UX so a regular user never sees a link to a page they'd get a 403 from.
  // Same reasoning for role: free-tier users can't use Frantic Algoritmik
  // Strateji at all (trade.py/strategy.py's routers now require
  // get_current_premium_user) - hiding its own link here is the UX half of
  // that same enforcement.
  const [isSuperuser, setIsSuperuser] = useState(false)
  const [role, setRole] = useState("free")
  useEffect(() => {
    authFetch("/auth/me")
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (!data) return
        setIsSuperuser(!!data.is_superuser)
        if (data.role) setRole(data.role)
      })
      .catch(() => {})
  }, [])
  const isFreeTier = role === "free"

  /* V2 gezinme: düz bir liste yerine anlam gruplarına ayrıldı.
     Ölçüm: liste 9-12 öğeye kadar çıkıyordu (admin'de) ve hepsi aynı
     görsel ağırlıktaydı - kullanıcı aradığını taramak zorundaydı. Gruplar
     tarama alanını 3-4 öğeye indiriyor.

     İkonlar artık MONOKROM. Eskiden her sayfanın kendi rengi vardı (mor,
     mavi, kehribar, zümrüt, turuncu, pembe, kırmızı, çinko) - sekiz farklı
     vurgu rengi, hiçbiri bir şey ifade etmiyordu ve ürünü "birbiriyle
     ilgisiz ekranlar" gibi gösteren en büyük etkendi. V2'de renk yalnızca
     DURUM taşır: etkin öğe yeşil, geri kalan nötr.

     Trade bilerek burada değil - kendi tam ekran terminali var ve Header'daki
     kendi butonundan açılıyor (bkz. AppChrome'un isTradeRoute erken dönüşü). */
  const navGroups: NavGroup[] = [
    {
      label: "Piyasa",
      items: [
        { name: "Piyasa Takip", href: "/", icon: LayoutDashboard },
        { name: "Hisseler", href: "/screener", icon: Search },
      ],
    },
    ...(isFreeTier ? [] : [{
      label: "Strateji",
      items: [
        { name: "Frantic Algoritmik Strateji", href: "/strategy", icon: Bot },
      ],
    }]),
    {
      label: "Yatırım",
      items: [
        { name: "Portföyüm", href: "/portfolio", icon: Briefcase },
        { name: "Fon Takip", href: "/funds", icon: Coins },
      ],
    },
    {
      label: "Haberler",
      items: [
        { name: "Ekonomi Haberleri", href: "/news", icon: Newspaper },
      ],
    },
    {
      label: "Sistem",
      items: [
        { name: "Notlarım", href: "/notes", icon: StickyNote },
        { name: "Ayarlar", href: "/settings", icon: Settings },
        ...(isSuperuser ? [
          { name: "Yönetim Paneli", href: "/admin", icon: ShieldCheck },
          { name: "Yönetilen Portföyler", href: "/admin/managed-portfolios", icon: Users },
          { name: "Fon Ağırlık Ayarlamaları", href: "/admin/fund-compositions", icon: PieChart },
        ] : []),
      ],
    },
  ]

  // "/" needs an exact match (otherwise it'd match every route); everything
  // else uses startsWith so sub-routes like a fund detail page still keep
  // their parent menu item highlighted. Two entries can both be href-prefixes
  // of the same pathname (/admin and /admin/managed-portfolios) - only the
  // LONGEST matching href should light up, otherwise both show active at once.
  const allHrefs = navGroups.flatMap(g => g.items.map(i => i.href))
  const activeHref = allHrefs
    .filter(href => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/")))
    .sort((a, b) => b.length - a.length)[0]

  return (
    <>
      {/* Backdrop - mobile/tablet only, closes the drawer on tap outside.
          Kalıcı olarak DOM'da duruyor ve yalnızca opaklığı değişiyor; ayrıca
          `backdrop-blur-sm` KALDIRILDI. İkisi de aynı iOS sorununun parçası:

          Perde, menü açılmasıyla AYNI karede oluşturulunca Safari tam ekran
          bir backdrop-filter katmanı kurmak için sayfanın tamamının anlık
          görüntüsünü alıp bulanıklaştırmak zorunda kalıyordu. Bu iş, sürgünün
          kayma animasyonunun ilk karelerini bloke ediyor - dışarıdan görüntü
          tam olarak "tuşa bastım, menü geç geliyor".

          Düz koyu bir perde aynı işi görüyor (içeriği geri plana itmek) ve
          hiçbir şey bulanıklaştırmıyor. `pointer-events-none`, kapalıyken
          perdenin sayfayla etkileşimi engellememesini garanti eder. */}
      <div
        aria-hidden
        className={cn(
          "fixed inset-0 z-30 bg-black/70 lg:hidden transition-opacity duration-200 ease-out",
          open ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
        onPointerDown={() => { armedRef.current = true }}
        onClick={() => { if (armedRef.current) onClose?.() }}
      />

      <aside
        style={{ width: isCollapsedNow ? 72 : 248 }}
        className={cn(
          // Tailwind v4'te `-translate-x-full` / `translate-x-0` artık
          // `transform` değil `translate` özelliğini yazıyor - üretilen CSS
          // `--tw-translate-x:-100%; translate:var(--tw-translate-x) ...`
          // şeklinde. Önceki `transition-[transform,width]` bu yüzden hiçbir
          // şeyi yakalamıyordu: sürgü kayarak değil, tek karede yerine
          // zıplayarak açılıyordu. Hareket görünmediği için menünün açıldığı
          // da fark edilmiyordu.
          // h-full, h-dvh DEGIL: layout.tsx'te body artik `fixed inset-0` ile
          // gercek gorsel viewport'a kilitli (kesin bir yukseklik veriyor),
          // bu yuzden burada tekrar dvh hesaplamaya gerek yok - standalone
          // modda dvh'nin kendi (surgunun alt kismini ekranin altinda
          // birakan) hesaplama tutarsizligini miras almiyoruz.
          // V2: sürgü Base yüzeyinde (workspace'ten bir tık koyu), böylece
          // içerik alanı ondan ayrılıyor - kenarlık taşımaya gerek kalmıyor.
          "border-r border-border bg-background flex flex-col h-full z-40 transition-[translate,width] duration-250 ease-out touch-manipulation",
          "fixed inset-y-0 left-0 lg:sticky lg:top-0 lg:translate-x-0",
          // Same safe-area reasoning as Header.tsx - this drawer is `fixed
          // inset-y-0`, so on a notched phone/PWA its own top row (logo,
          // close button) would otherwise sit behind the status bar too.
          "pt-[env(safe-area-inset-top)] lg:pt-0",
          // Ayni gerekce alt taraf icin: standalone modda surgunun en alt
          // satiri iPhone'un home gostergesinin arkasinda kaliyordu.
          "pb-[env(safe-area-inset-bottom)] lg:pb-0",
          open ? "translate-x-0" : "-translate-x-full"
        )}
        onPointerDownCapture={() => { armedRef.current = true }}
        onClickCapture={(e) => {
          if (open && !armedRef.current) {
            e.preventDefault()
            e.stopPropagation()
          }
        }}
      >
        {/* Brand Header */}
        <div className={cn("h-16 flex items-center border-b border-border shrink-0", isCollapsedNow ? "justify-center px-0" : "px-5 justify-between")}>
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
              className="flex h-9 w-9 rounded-lg overflow-hidden cursor-pointer shrink-0"
            >
              <img src="/logo.png" alt="BIP Terminal" className="h-full w-full object-cover" />
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

        {/* Navigation */}
        <nav className={cn("flex-1 py-4 overflow-y-auto overflow-x-hidden", isCollapsedNow ? "px-2.5" : "px-3")}>
          {navGroups.map((group, groupIndex) => (
            <div key={group.label} className={cn(groupIndex > 0 && "mt-5")}>
              {/* Grup başlığı daraltılmış modda gizleniyor - 72px genişlikte
                  okunacak yer yok, ama ayrım gerekiyor: onun yerine ince bir
                  çizgi konuyor. */}
              {isCollapsedNow ? (
                groupIndex > 0 && <div className="mx-2 mb-3 border-t border-border/70" />
              ) : (
                <div className="px-3 mb-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground/55">
                  {group.label}
                </div>
              )}

              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const isActive = item.href === activeHref
                  const Icon = item.icon
                  return (
                    <div key={item.name} className="relative group/navitem">
                      <Link
                        href={item.href}
                        onClick={() => onClose?.()}
                        data-active={isActive}
                        className={cn(
                          // nav-item: etkin öğenin sol kenarında büyüyerek
                          // beliren çubuk (globals.css). Renk zaten ayırt
                          // ediyor ama tek başına renge dayanmak renk
                          // körlüğünde çalışmaz.
                          // press: dokunmatikte basıldığını gösteren tepki.
                          "nav-item press w-full flex items-center h-9 rounded-md text-[13px] transition-colors duration-150 cursor-pointer text-left",
                          isCollapsedNow ? "justify-center px-0" : "px-3",
                          isActive
                            // V2 etkin durum: beyaz metin, yeşil ikon, çok
                            // hafif yeşil zemin. Sekiz farklı sayfa rengi
                            // yerine tek bir dil.
                            ? "bg-primary/[0.08] text-foreground font-semibold"
                            : "text-muted-foreground hover:bg-secondary/70 hover:text-foreground font-medium"
                        )}
                      >
                        <Icon className={cn(
                          "h-4 w-4 shrink-0 transition-colors duration-150",
                          !isCollapsedNow && "mr-2.5",
                          isActive ? "text-primary" : "text-muted-foreground/70 group-hover/navitem:text-foreground"
                        )} />
                        {!isCollapsedNow && <span className="truncate">{item.name}</span>}
                      </Link>
                      {/* Tooltip - collapsed desktop only, shown on hover next to the icon */}
                      {isCollapsedNow && (
                        <div className="hidden group-hover/navitem:block animate-pop absolute left-full top-1/2 -translate-y-1/2 ml-2 px-2.5 py-1.5 rounded-md surface-modal border border-border text-xs font-semibold text-foreground whitespace-nowrap shadow-[var(--elev-3)] z-50 pointer-events-none">
                          {item.name}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Collapse/expand toggle - desktop only, mobile uses the drawer's own close button */}
        <div className={cn("hidden lg:flex border-t border-border p-2.5", isCollapsedNow ? "justify-center" : "justify-end")}>
          <button
            onClick={onToggleCollapse}
            title={collapsed ? "Menüyü genişlet (Ctrl+B)" : "Menüyü daralt (Ctrl+B)"}
            className="h-8 w-8 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors cursor-pointer"
            aria-label={collapsed ? "Menüyü genişlet" : "Menüyü daralt"}
          >
            {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
          </button>
        </div>
      </aside>
    </>
  )
}
