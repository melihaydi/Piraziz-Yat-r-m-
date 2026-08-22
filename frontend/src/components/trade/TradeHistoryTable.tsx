"use client"

import React, { useMemo } from "react"
import { History, Info } from "lucide-react"
import { useTrade } from "@/contexts/TradeContext"
import { TickerLogo } from "@/components/ui/TickerLogo"

export default function TradeHistoryTable() {
  const { history, activeTab, viopWatchlist } = useTrade()
  const filtered = history.filter(h => h.instrument_type === activeTab)

  const underlyingBySymbol = useMemo(() => {
    const map: Record<string, string> = {}
    for (const c of viopWatchlist) {
      if (c.underlying_symbol) map[c.symbol] = c.underlying_symbol
    }
    return map
  }, [viopWatchlist])

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center gap-2">
        <History className="h-3.5 w-3.5 text-foreground" />
        <span className="text-xs font-black text-foreground uppercase tracking-wider">İşlem Geçmişi</span>
        {filtered.length > 0 && (
          <span className="ml-auto text-[10px] font-bold text-foreground/80 bg-secondary border border-border rounded-full px-2 py-0.5">
            {filtered.length}
          </span>
        )}
      </div>
      <div className="overflow-x-auto max-h-72 overflow-y-auto">
        <table className="w-full text-xs text-left">
          <thead className="sticky top-0 bg-card">
            <tr className="text-foreground/80 font-bold border-b border-border h-8">
              <th className="px-4">Tarih</th>
              <th className="px-4">Saat</th>
              <th className="px-4">Yön</th>
              <th className="px-4">Hisse</th>
              <th className="px-4 text-right">Lot</th>
              <th className="px-4 text-right">Fiyat</th>
              <th className="px-4 text-right">Komisyon</th>
              <th className="px-4 text-right">Toplam</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-10">
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <Info className="h-5 w-5" />
                    <span className="font-bold text-foreground/80 text-[11px]">Henüz işlem yapılmadı</span>
                  </div>
                </td>
              </tr>
            ) : (
              filtered.map(item => {
                const dt = item.executed_at ? new Date(item.executed_at) : null
                const dateStr = dt ? dt.toLocaleDateString("tr-TR") : "-"
                const timeStr = dt ? dt.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }) : "-"
                return (
                  <tr key={item.id} className="border-b border-border/60 h-10 hover:bg-secondary/40">
                    <td className="px-4 text-foreground/80">{dateStr}</td>
                    <td className="px-4 text-foreground/80">{timeStr}</td>
                    <td className="px-4">
                      <span className={`text-[10px] font-black px-1.5 py-0.5 rounded ${
                        item.side === "AL" ? "bg-bull/10 text-bull" : "bg-bear/10 text-bear"
                      }`}>
                        {item.side}
                      </span>
                    </td>
                    <td className="px-4 font-bold text-foreground">
                      <div className="flex items-center gap-1.5">
                        <TickerLogo ticker={underlyingBySymbol[item.symbol] || item.symbol} size={16} />
                        {item.symbol}
                      </div>
                    </td>
                    <td className="px-4 text-right font-semibold text-foreground">{item.lot}</td>
                    <td className="px-4 text-right font-semibold text-foreground">{item.price.toFixed(2)}</td>
                    <td className="px-4 text-right text-foreground/80">{item.commission.toFixed(2)}</td>
                    <td className="px-4 text-right font-semibold text-foreground">{item.total.toFixed(2)}</td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
