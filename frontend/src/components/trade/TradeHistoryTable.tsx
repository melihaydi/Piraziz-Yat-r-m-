"use client"

import React from "react"
import { useTrade } from "@/contexts/TradeContext"

export default function TradeHistoryTable() {
  const { history, activeTab } = useTrade()
  const filtered = history.filter(h => h.instrument_type === activeTab)

  return (
    <div className="bg-slate-950/60 border border-slate-800 rounded-xl overflow-hidden">
      <div className="px-4 py-2.5 border-b border-slate-800">
        <span className="text-xs font-black text-slate-300 uppercase tracking-wider">İşlem Geçmişi</span>
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
                <td colSpan={8} className="text-center text-slate-600 py-6">Henüz işlem yapılmadı.</td>
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
