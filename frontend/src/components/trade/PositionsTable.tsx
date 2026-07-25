"use client"

import React, { useState } from "react"
import { X, Loader2, Layers, Info } from "lucide-react"
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
    <div className="bg-[#16171E] border border-slate-800 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-800 flex items-center gap-2">
        <Layers className="h-3.5 w-3.5 text-blue-400" />
        <span className="text-xs font-black text-slate-300 uppercase tracking-wider">Açık Pozisyonlar</span>
        {positions.length > 0 && (
          <span className="ml-auto text-[10px] font-bold text-slate-500 bg-[#1c1d26] border border-slate-800 rounded-full px-2 py-0.5">
            {positions.length}
          </span>
        )}
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
                <td colSpan={activeTab === "viop" ? 9 : 8} className="py-10">
                  <div className="flex flex-col items-center gap-2 text-slate-600">
                    <Info className="h-5 w-5" />
                    <span className="font-bold text-slate-500 text-[11px]">Yatırım pozisyonun bulunmuyor</span>
                    <span className="text-[10px] text-slate-700">Yatırım yaptıkça varlıklarını burada görebilirsin.</span>
                  </div>
                </td>
              </tr>
            ) : (
              positions.map(pos => (
                <tr key={pos.id} className="border-b border-slate-900 h-11 hover:bg-[#1c1d26]/40">
                  <td className="px-4 font-bold text-slate-200">{pos.symbol}</td>
                  {activeTab === "viop" && (
                    <td className="px-4">
                      <span
                        className={`text-[9px] font-black px-1.5 py-0.5 rounded ${
                          pos.position_side === "SHORT"
                            ? "bg-amber-500/15 text-amber-400"
                            : "bg-blue-500/15 text-blue-300"
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
