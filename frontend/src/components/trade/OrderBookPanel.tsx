"use client"

import React, { useState } from "react"
import { ListOrdered, X, Loader2, Info } from "lucide-react"
import { useTrade } from "@/contexts/TradeContext"

export default function OrderBookPanel() {
  const { pendingOrders, activeTab, cancelPendingOrder } = useTrade()
  const [cancellingId, setCancellingId] = useState<number | null>(null)

  const filtered = pendingOrders.filter(o => o.instrument_type === activeTab)

  const handleCancel = async (id: number) => {
    setCancellingId(id)
    await cancelPendingOrder(id)
    setCancellingId(null)
  }

  return (
    <div className="bg-[#16171E] border border-slate-800 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-800 flex items-center gap-2">
        <ListOrdered className="h-3.5 w-3.5 text-white" />
        <span className="text-xs font-black text-white uppercase tracking-wider">Emir Defteri</span>
        {filtered.length > 0 && (
          <span className="ml-auto text-[10px] font-bold text-slate-300 bg-[#1c1d26] border border-slate-800 rounded-full px-2 py-0.5">
            {filtered.length}
          </span>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs text-left">
          <thead>
            <tr className="text-slate-300 font-bold border-b border-slate-800 h-8">
              <th className="px-4">Hisse</th>
              <th className="px-4">Yön</th>
              <th className="px-4 text-right">Lot</th>
              <th className="px-4 text-right">Limit Fiyatı</th>
              <th className="px-4 text-center">İşlem</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-10">
                  <div className="flex flex-col items-center gap-2 text-slate-400">
                    <Info className="h-5 w-5" />
                    <span className="font-bold text-slate-300 text-[11px]">Bekleyen limit emrin bulunmuyor</span>
                    <span className="text-[10px] text-slate-500">
                      Limit emir girdiğinde fiyat seviyenize ulaşana kadar burada bekler.
                    </span>
                  </div>
                </td>
              </tr>
            ) : (
              filtered.map(order => (
                <tr key={order.id} className="border-b border-slate-900 h-11 hover:bg-[#1c1d26]/40">
                  <td className="px-4 font-bold text-white">{order.symbol}</td>
                  <td className="px-4">
                    <span className={`text-[10px] font-black px-1.5 py-0.5 rounded ${
                      order.side === "AL" ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400"
                    }`}>
                      {order.side}
                    </span>
                  </td>
                  <td className="px-4 text-right font-semibold text-white">{order.lot}</td>
                  <td className="px-4 text-right font-semibold text-white">{order.limit_price.toFixed(2)}</td>
                  <td className="px-4 text-center">
                    <button
                      onClick={() => handleCancel(order.id)}
                      disabled={cancellingId === order.id}
                      className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-400 hover:text-rose-300 disabled:opacity-50 cursor-pointer"
                    >
                      {cancellingId === order.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
                      İptal
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
