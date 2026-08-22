"use client"

import React, { useEffect, useMemo, useState } from "react"
import { Search, Star, TrendingUp, TrendingDown, PanelLeftClose, ListFilter } from "lucide-react"
import { useTrade, WatchlistItem, InstrumentType } from "@/contexts/TradeContext"
import { TickerLogo } from "@/components/ui/TickerLogo"
import { fetchWatchlist, setWatchlistEntry } from "@/lib/watchlist"

interface WatchlistProps {
  onCollapse?: () => void
}

interface WatchlistRowProps {
  item: WatchlistItem
  activeTab: InstrumentType
  isSelected: boolean
  isFav: boolean
  onSelect: (symbol: string) => void
  onToggleFavorite: (symbol: string) => void
}

// The watchlist re-fetches all 30+ rows every 2s (see TradeContext's poll),
// which previously re-rendered every row on every tick even when only one
// or two prices actually moved - each row is now its own memoized component
// so React can skip re-rendering rows whose price/selection/favorite state
// didn't change this tick.
const WatchlistRow = React.memo(function WatchlistRow({
  item, activeTab, isSelected, isFav, onSelect, onToggleFavorite,
}: WatchlistRowProps) {
  const isUp = item.change_percent >= 0

  // --- Tik yonu vurgusu --------------------------------------------------
  // Bir alim-satim terminalinde "fiyat degisti" bilgisi rakami okumadan,
  // cevresel gorusle alinabilmeli - bant (tape) boyle izlenir. globals.css
  // bunun icin flash-up/flash-down'i zaten tanimliyordu ama uygulamada
  // hicbir yerde kullanilmiyordu.
  //
  // Gunluk degisim yuzdesi (change_percent) bu isi goremez: o, ONCEKI KAPANISA
  // gore yon. Burada gereken SON TIKE gore yon - fiyat gun boyu eksideyken de
  // yukari tikleyebilir.
  //
  // Efekt yerine render sirasinda state ayarlaniyor: React'in "prop
  // degistiginde state'i ayarla" kalibi. useEffect kullanmak bu projedeki
  // react-hooks/set-state-in-effect kuralini ihlal ederdi ve iki kere render
  // gerektirirdi.
  const [prevPrice, setPrevPrice] = useState(item.price)
  const [flash, setFlash] = useState<{ dir: "up" | "down"; seq: number } | null>(null)
  if (item.price !== prevPrice) {
    setPrevPrice(item.price)
    // 0 fiyat "veri yok" demek - ilk gercek fiyat geldiginde bunu yukari
    // tik sayip tum listeyi yesile boyamak yanlis bilgi olurdu.
    if (prevPrice > 0 && item.price > 0) {
      setFlash({ dir: item.price > prevPrice ? "up" : "down", seq: (flash?.seq ?? 0) + 1 })
    }
  }

  return (
    <button
      onClick={() => onSelect(item.symbol)}
      className={`w-full text-left px-3 py-2.5 border-b border-border/60 flex items-center justify-between transition-colors cursor-pointer group ${
        isSelected ? "bg-secondary border-l-2 border-l-primary" : "hover:bg-secondary/60 border-l-2 border-l-transparent"
      }`}
    >
      <div className="flex items-center gap-2 min-w-0">
        {activeTab === "stock" && (
          <span
            onClick={e => {
              e.stopPropagation()
              onToggleFavorite(item.symbol)
            }}
            className="shrink-0"
          >
            <Star className={`h-3.5 w-3.5 ${isFav ? "text-warn fill-warn" : "text-muted-foreground/50 hover:text-muted-foreground"}`} />
          </span>
        )}
        <TickerLogo ticker={item.underlying_symbol || item.symbol} size={16} />
        <div className="min-w-0">
          <div className="text-xs font-bold text-foreground">{item.symbol}</div>
          <div className="text-[10px] text-muted-foreground truncate max-w-[110px]">{item.name}</div>
        </div>
      </div>
      <div className="text-right shrink-0">
        <div
          key={flash?.seq ?? 0}
          className={`text-xs font-semibold text-foreground ${flash ? (flash.dir === "up" ? "flash-up" : "flash-down") : ""}`}
        >
          {item.price > 0 ? item.price.toFixed(2) : "-"}
        </div>
        <div className={`text-[10px] font-bold flex items-center justify-end ${isUp ? "text-bull" : "text-bear"}`}>
          {isUp ? <TrendingUp className="h-2.5 w-2.5 mr-0.5" /> : <TrendingDown className="h-2.5 w-2.5 mr-0.5" />}
          {isUp ? "+" : ""}{item.change_percent.toFixed(2)}%
        </div>
      </div>
    </button>
  )
}, (prev, next) =>
  prev.item.price === next.item.price &&
  prev.item.change_percent === next.item.change_percent &&
  prev.item.symbol === next.item.symbol &&
  prev.item.name === next.item.name &&
  prev.isSelected === next.isSelected &&
  prev.isFav === next.isFav &&
  prev.activeTab === next.activeTab
)

export default function Watchlist({ onCollapse }: WatchlistProps) {
  const { activeTab, watchlist, viopWatchlist, selectedSymbol, setSelectedSymbol } = useTrade()
  const [query, setQuery] = useState("")
  const [favorites, setFavorites] = useState<string[]>([])

  const list = activeTab === "stock" ? watchlist : viopWatchlist

  // Favoriler sunucuda tutuluyor, localStorage'da DEGIL. Gerekce
  // lib/watchlist.ts'te ayrintili: bu panel localStorage'a yaziyordu, oysa
  // /screener ayni favorileri sunucuda tutup yerel anahtari siliyor. Sonuc,
  // iki yonlu bozuk bir eslesmeydi - burada yildizlanan hisse taramada
  // gorunmuyor, taramada yildizlanan burada gorunmuyordu.
  useEffect(() => {
    fetchWatchlist().then(setFavorites)
  }, [])

  const toggleFavorite = (symbol: string) => {
    setFavorites(prev => {
      const isRemoving = prev.includes(symbol)
      // Iyimser guncelleme: yildiz aninda dolsun, sunucu istegi arkada
      // tamamlansin, basarisiz olursa geri alinsin. /screener'daki
      // toggleFavorite ile ayni davranis.
      setWatchlistEntry(symbol, !isRemoving).then(ok => {
        if (!ok) {
          setFavorites(current =>
            isRemoving ? [...current, symbol] : current.filter(s => s !== symbol),
          )
        }
      })
      return isRemoving ? prev.filter(s => s !== symbol) : [...prev, symbol]
    })
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const base = q
      ? list.filter(item => item.symbol.toLowerCase().includes(q) || item.name.toLowerCase().includes(q))
      : list
    // Favorites float to the top (stock tab only - VİOP contracts aren't
    // part of the app-wide favorites system).
    if (activeTab !== "stock") return base
    return [...base].sort((a, b) => {
      const aFav = favorites.includes(a.symbol) ? 1 : 0
      const bFav = favorites.includes(b.symbol) ? 1 : 0
      return bFav - aFav
    })
  }, [list, query, favorites, activeTab])

  return (
    <div className="flex flex-col h-full bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-3 pt-3 pb-2 flex items-center gap-2">
        <ListFilter className="h-3.5 w-3.5 text-foreground" />
        <span className="text-xs font-black text-foreground/80 uppercase tracking-wider">İzleme Listesi</span>
        <span className="ml-auto text-[10px] font-bold text-muted-foreground bg-secondary border border-border rounded-full px-2 py-0.5">
          {list.length}
        </span>
      </div>
      <div className="p-3 pt-1 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={activeTab === "stock" ? "BIST30 içinde ara..." : "VİOP kontratlarında ara..."}
              className="w-full h-8 pl-8 pr-3 rounded-lg bg-secondary border border-border text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/40"
            />
          </div>
          {onCollapse && (
            <button
              onClick={onCollapse}
              title="Listeyi kapat"
              className="shrink-0 h-8 w-8 flex items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-foreground hover:border-primary/30 transition-colors cursor-pointer"
            >
              <PanelLeftClose className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="text-center text-[11px] text-muted-foreground/70 py-8">Sonuç bulunamadı.</div>
        ) : (
          filtered.map(item => (
            <WatchlistRow
              key={item.symbol}
              item={item}
              activeTab={activeTab}
              isSelected={selectedSymbol === item.symbol}
              isFav={favorites.includes(item.symbol)}
              onSelect={setSelectedSymbol}
              onToggleFavorite={toggleFavorite}
            />
          ))
        )}
      </div>
    </div>
  )
}
