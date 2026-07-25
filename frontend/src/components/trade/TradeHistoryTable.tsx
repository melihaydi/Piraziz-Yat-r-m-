"use client"

import React from "react"
import { History, Info } from "lucide-react"
import { useTrade } from "@/contexts/TradeContext"

export default function TradeHistoryTable() {
  const { history, activeTab } = useTrade()
  const filtered = history.filter(h => h.instrument_type === activeTab)

  return (
    <div className="bg-slate-950/60 border border-slate-800 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-800 flex items-center gap-2">
        <History className="h-3.5 w-3.5 text-cyan-400" />
        <span className="text-xs font-black text-slate-300 uppercase tracking-wider">İşlem Geçmişi</span>
        {filtered.length > 0 && (
          <span className="ml-auto text-[10px] font-bold text-slate-500 bg-slate-900 border border-slate-800 rounded-full px-2 py-0.5">
            {filtered.length}
          </span>
        )}
      </div>
      <div className="overflow-x-auto max-h-72 overflow-y-auto">
        <table className="w-full text-xs text-left">
          <thead className="sticky top-0 bg-slate-950">
            <tr className="text-slate-500 font-bold border-b border-slate-800 h-8">
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
                  <div className="flex flex-col items-center gap-2 text-slate-600">
                    <Info className="h-5 w-5" />
                    <span className="font-bold text-slate-500 text-[11px]">Henüz işlem yapılmadı</span>
                  </div>
                </td>
              </tr>
            ) : (
              filtered.map(item => {
                const dt = item.executed_at ? new Date(item.executed_at) : null
                const dateStr = dt ? dt.toLocaleDateString("tr-TR") : "-"
                const timeStr = dt ? dt.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }) : "-"
                return (
                  <tr key={item.id} className="border-b border-slate-900 h-10 hover:bg-slate-900/40">
                    <td className="px-4 text-slate-400">{dateStr}</td>
                    <td className="px-4 text-slate-400">{timeStr}</td>
                    <td className="px-4">
                      <span className={`text-[10px] font-black px-1.5 py-0.5 rounded ${
                        item.side === "AL" ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400"
                      }`}>
                        {item.side}
                      </span>
                    </td>
                    <td className="px-4 font-bold text-slate-200">{item.symbol}</td>
                    <td className="px-4 text-right font-mono text-slate-300">{item.lot}</td>
                    <td className="px-4 text-right font-mono text-slate-300">{item.price.toFixed(2)}</td>
                    <td className="px-4 text-right font-mono text-slate-500">{item.commission.toFixed(2)}</td>
                    <td className="px-4 text-right font-mono text-slate-200">{item.total.toFixed(2)}</td>
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
