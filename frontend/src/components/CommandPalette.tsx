"use client"

import React, { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
  Search, LayoutDashboard, Briefcase, Coins, Newspaper, StickyNote, Settings,
  Bot, ShieldCheck, CornerDownLeft,
} from "lucide-react"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/Dialog"
import { TickerLogo } from "@/components/ui/TickerLogo"
import { useTickerDirectory } from "@/lib/tickerDirectory"

interface StaticCommand {
  label: string
  href: string
  icon: React.ComponentType<{ className?: string }>
  keywords?: string
}

// Sidebar.tsx'teki navGroups'un düz, aranabilir hali - admin kalemleri
// bilerek yok (küçük bir kitle, Sidebar'dan zaten erişilebilir). Trade da
// yok, kendi tam ekran terminali Header'daki ayrı butondan açılıyor.
const STATIC_COMMANDS: StaticCommand[] = [
  { label: "Piyasa Takip", href: "/", icon: LayoutDashboard },
  { label: "Hisseler", href: "/screener", icon: Search, keywords: "tarama screener" },
  { label: "Frantic Algoritmik Strateji", href: "/strategy", icon: Bot, keywords: "sinyal strateji" },
  { label: "Portföyüm", href: "/portfolio", icon: Briefcase },
  { label: "Fon Takip", href: "/funds", icon: Coins, keywords: "tefas fon" },
  { label: "Sinyal Karnesi", href: "/scorecard", icon: ShieldCheck, keywords: "karne sonuç" },
  { label: "Ekonomi Haberleri", href: "/news", icon: Newspaper, keywords: "haber" },
  { label: "Notlarım", href: "/notes", icon: StickyNote, keywords: "not" },
  { label: "Ayarlar", href: "/settings", icon: Settings },
]

type PaletteResult =
  | { kind: "page"; key: string; label: string; sub?: string; href: string; icon: React.ComponentType<{ className?: string }> }
  | { kind: "asset"; key: string; code: string; name: string; isFund: boolean; href: string }

/**
 * Ctrl+K / Cmd+K ile açılan global komut paleti - sayfa arasında ve hisse/
 * fon koduna doğrudan atlamak için. Header'daki arama kutusuyla AYNI veri
 * kaynağını (tickerDirectory) paylaşıyor, ayrı bir fetch yapmıyor.
 *
 * AppChrome'da bir kere mount ediliyor (Trade ve bare/public-auth
 * rotalarında değil - Ctrl+B sidebar kısayoluyla aynı kapsam).
 */
export default function CommandPalette() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const directory = useTickerDirectory()

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setOpen(prev => !prev)
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [])

  useEffect(() => {
    if (open) {
      setQuery("")
      setActiveIndex(0)
      // Radix Dialog kendi focus yönetimini bir sonraki tick'te uyguluyor -
      // aynı senkron anda focus() çağırmak Radix'in kendi autofocus'uyla
      // yarışıp bazen kaybediyordu.
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  const results = useMemo<PaletteResult[]>(() => {
    const q = query.trim().toLowerCase()

    const pages: PaletteResult[] = STATIC_COMMANDS
      .filter(c => !q || c.label.toLowerCase().includes(q) || c.keywords?.includes(q))
      .map(c => ({ kind: "page", key: c.href, label: c.label, href: c.href, icon: c.icon }))

    if (!q) return pages.slice(0, 8)

    const assets: PaletteResult[] = directory
      .filter(e => e.code.toLowerCase().includes(q) || (e.name && e.name.toLowerCase().includes(q)))
      .slice(0, 6)
      .map(e => ({
        kind: "asset", key: e.code, code: e.code, name: e.name, isFund: e.isFund,
        href: e.isFund ? `/funds/${e.code}` : `/stock/${e.code}`,
      }))

    return [...pages.slice(0, 4), ...assets]
  }, [query, directory])

  useEffect(() => {
    setActiveIndex(0)
  }, [results.length, query])

  const activate = (r: PaletteResult) => {
    router.push(r.href)
    setOpen(false)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setActiveIndex(i => Math.min(i + 1, results.length - 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setActiveIndex(i => Math.max(i - 1, 0))
    } else if (e.key === "Enter") {
      e.preventDefault()
      const r = results[activeIndex]
      if (r) activate(r)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-xl p-0 gap-0 top-[18%] translate-y-0 overflow-hidden">
        <DialogTitle className="sr-only">Komut Paleti</DialogTitle>
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border/50">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Sayfa ara, ya da bir hisse/fon kodu yaz..."
            className="flex-1 bg-transparent outline-none text-sm placeholder:text-muted-foreground"
            autoComplete="off"
          />
          <kbd className="hidden sm:inline-block text-[10px] font-bold text-muted-foreground border border-border/60 rounded px-1.5 py-0.5">
            ESC
          </kbd>
        </div>

        <div className="max-h-[55vh] overflow-y-auto py-1.5">
          {results.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-8">Sonuç bulunamadı.</p>
          ) : (
            results.map((r, i) => (
              <button
                key={r.key}
                type="button"
                onClick={() => activate(r)}
                onMouseEnter={() => setActiveIndex(i)}
                className={`w-full text-left px-4 py-2.5 flex items-center gap-3 cursor-pointer transition-colors ${
                  i === activeIndex ? "bg-secondary/70" : "hover:bg-secondary/40"
                }`}
              >
                {r.kind === "page" ? (
                  <r.icon className="h-4 w-4 text-primary shrink-0" />
                ) : (
                  <TickerLogo ticker={r.code} size={20} />
                )}
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="text-sm font-bold text-foreground flex items-center gap-1.5">
                    {r.kind === "page" ? r.label : r.code}
                    {r.kind === "asset" && r.isFund && (
                      <span className="text-[8px] bg-secondary text-muted-foreground border border-border px-1 rounded">FON</span>
                    )}
                  </span>
                  {r.kind === "asset" && (
                    <span className="text-[10px] text-muted-foreground truncate">{r.name}</span>
                  )}
                </div>
                {i === activeIndex && <CornerDownLeft className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
