"use client"

import React, { useState } from "react"
import { X, Loader2 } from "lucide-react"
import { useTrade } from "@/contexts/TradeContext"

export default function PositionsTable() {
  const { account, activeTab, placeOrder } = useTrade()
  const [closingSymbol, setClosingSymbol] = useState<string | null>(null)

  const positions = (account?.positions || []).filter(p => p.instrument_type === activeTab)

  // A SHORT position must be closed by buying it back ("AL"), not "SAT" -
  // "SAT" on a symbol with no long position actually OPENS a new short on
  // VİOP now that shorting is supported, so using the wrong side here would
  // have doubled the short instead of closing it.
  const handleClose = async (symbol: string, lot: number, side: "LONG" | "SHORT") => {
    setClosingSymbol(symbol)
    await placeOrder(activeTab, symbol, side === "SHORT" ? "AL" : "SAT", lot)
    setClosingSymbol(null)
  }

  return (
    <div className="bg-slate-950/60 border border-slate-800 rounded-xl overflow-hidden">
      <div className="px-4 py-2.5 border-b border-slate-800">
        <span className="text-xs font-black text-slate-300 uppercase tracking-wider">Açık Pozisyonlar</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs text-left">
          <thead>
            <tr className="text-slate-500 font-bold border-b border-slate-800 h-8">
              <th className="px-4">Hisse</th>
              {activeTab === "viop" && <th className="px-4">Yön</th>}
              <th className="px-4 text-right">Lot</th>
              <th className="px-4 text-right">Maliyet</th>
              <th className="px-4 text-right">Anlık Fiyat</th>
              <th className="px-4 text-right">Kar/Zarar</th>
              <th className="px-4 text-right">%</th>
              <th className="px-4 text-right">Pozisyon Değeri</th>
              <th className="px-4 text-center">İşlem</th>
            </tr>
          </thead>
          <tbody>
            {positions.length === 0 ? (
              <tr>
                <td colSpan={activeTab === "viop" ? 9 : 8} className="text-center text-slate-600 py-6">Açık pozisyon bulunmuyor.</td>
              </tr>
            ) : (
              positions.map(pos => (
                <tr key={pos.id} className="border-b border-slate-900 h-11 hover:bg-slate-900/40">
                  <td className="px-4 font-bold text-slate-200">{pos.symbol}</td>
                  {activeTab === "viop" && (
                    <td className="px-4">
                      <span
                        className={`text-[9px] font-black px-1.5 py-0.5 rounded ${
                          pos.position_side === "SHORT"
                            ? "bg-amber-500/15 text-amber-400"
                            : "bg-cyan-500/15 text-cyan-300"
                        }`}
                      >
                        {pos.position_side}
                      </span>
                    </td>
                  )}
                  <td className="px-4 text-right font-mono text-slate-300">{pos.lot}</td>
                  <td className="px-4 text-right font-mono text-slate-400">{pos.avg_cost.toFixed(2)}</td>
                  <td className="px-4 text-right font-mono text-slate-300">{pos.current_price.toFixed(2)}</td>
                  <td className={`px-4 text-right font-mono font-bold ${pos.pnl >= 0 ? "text-emerald-400" : "text-rose-500"}`}>
                    {pos.pnl >= 0 ? "+" : ""}{pos.pnl.toFixed(2)}
                  </td>
                  <td className={`px-4 text-right font-mono font-bold ${pos.pnl_pct >= 0 ? "text-emerald-400" : "text-rose-500"}`}>
                    {pos.pnl_pct >= 0 ? "+" : ""}{pos.pnl_pct.toFixed(2)}%
                  </td>
                  <td className="px-4 text-right font-mono text-slate-300">{pos.position_value.toFixed(2)}</td>
                  <td className="px-4 text-center">
                    <button
                      onClick={() => handleClose(pos.symbol, pos.lot, pos.position_side)}
                      disabled={closingSymbol === pos.symbol}
                      className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-400 hover:text-rose-300 disabled:opacity-50 cursor-pointer"
                    >
                      {closingSymbol === pos.symbol ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
                      Kapat
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
