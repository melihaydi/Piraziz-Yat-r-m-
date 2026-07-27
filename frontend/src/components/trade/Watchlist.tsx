"use client"

import React, { useEffect, useMemo, useState } from "react"
import { Search, Star, TrendingUp, TrendingDown, PanelLeftClose, ListFilter } from "lucide-react"
import { useTrade, WatchlistItem, InstrumentType } from "@/contexts/TradeContext"

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
  return (
    <button
      onClick={() => onSelect(item.symbol)}
      className={`w-full text-left px-3 py-2.5 border-b border-slate-900 flex items-center justify-between transition-colors cursor-pointer group ${
        isSelected ? "bg-[#232530] border-l-2 border-l-white" : "hover:bg-[#232530]/60 border-l-2 border-l-transparent"
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
            <Star className={`h-3.5 w-3.5 ${isFav ? "text-amber-400 fill-amber-400" : "text-slate-700 hover:text-slate-500"}`} />
          </span>
        )}
        <div className="min-w-0">
          <div className="text-xs font-bold text-white">{item.symbol}</div>
          <div className="text-[10px] text-slate-400 truncate max-w-[110px]">{item.name}</div>
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className="text-xs font-semibold text-white">
          {item.price > 0 ? item.price.toFixed(2) : "-"}
        </div>
        <div className={`text-[10px] font-bold flex items-center justify-end ${isUp ? "text-emerald-400" : "text-rose-500"}`}>
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

  useEffect(() => {
    const saved = localStorage.getItem("favorites_stocks")
    if (saved) setFavorites(JSON.parse(saved))
  }, [])

  const toggleFavorite = (symbol: string) => {
    setFavorites(prev => {
      const updated = prev.includes(symbol) ? prev.filter(s => s !== symbol) : [...prev, symbol]
      localStorage.setItem("favorites_stocks", JSON.stringify(updated))
      return updated
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
    <div className="flex flex-col h-full bg-[#16171E] border border-slate-800 rounded-xl overflow-hidden">
      <div className="px-3 pt-3 pb-2 flex items-center gap-2">
        <ListFilter className="h-3.5 w-3.5 text-white" />
        <span className="text-xs font-black text-slate-300 uppercase tracking-wider">İzleme Listesi</span>
        <span className="ml-auto text-[10px] font-bold text-slate-500 bg-[#1c1d26] border border-slate-800 rounded-full px-2 py-0.5">
          {list.length}
        </span>
      </div>
      <div className="p-3 pt-1 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-500" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={activeTab === "stock" ? "BIST30 içinde ara..." : "VİOP kontratlarında ara..."}
              className="w-full h-8 pl-8 pr-3 rounded-lg bg-[#1c1d26] border border-slate-800 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-white/30"
            />
          </div>
          {onCollapse && (
            <button
              onClick={onCollapse}
              title="Listeyi kapat"
              className="shrink-0 h-8 w-8 flex items-center justify-center rounded-lg border border-slate-800 text-slate-500 hover:text-white hover:border-white/20 transition-colors cursor-pointer"
            >
              <PanelLeftClose className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="text-center text-[11px] text-slate-600 py-8">Sonuç bulunamadı.</div>
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
