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
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center gap-2">
        <ListOrdered className="h-3.5 w-3.5 text-foreground" />
        <span className="text-xs font-black text-foreground uppercase tracking-wider">Emir Defteri</span>
        {filtered.length > 0 && (
          <span className="ml-auto text-[10px] font-bold text-foreground/80 bg-secondary border border-border rounded-full px-2 py-0.5">
            {filtered.length}
          </span>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs text-left">
          <thead>
            <tr className="text-foreground/80 font-bold border-b border-border h-8">
              <th className="px-4">Hisse</th>
              <th className="px-4">Yön</th>
              <th className="px-4">Tip</th>
              <th className="px-4 text-right">Lot</th>
              <th className="px-4 text-right">Stop</th>
              <th className="px-4 text-right">Limit</th>
              <th className="px-4 text-center">İşlem</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-10">
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <Info className="h-5 w-5" />
                    <span className="font-bold text-foreground/80 text-[11px]">Bekleyen emrin bulunmuyor</span>
                    <span className="text-[10px] text-muted-foreground">
                      Limit/Stop emir girdiğinde fiyat seviyenize ulaşana kadar burada bekler.
                    </span>
                  </div>
                </td>
              </tr>
            ) : (
              filtered.map(order => (
                <tr key={order.id} className="border-b border-border/60 h-11 hover:bg-secondary/40">
                  <td className="px-4 font-bold text-foreground">{order.symbol}</td>
                  <td className="px-4">
                    <span className={`text-[10px] font-black px-1.5 py-0.5 rounded ${
                      order.side === "AL" ? "bg-bull/10 text-bull" : "bg-bear/10 text-bear"
                    }`}>
                      {order.side}
                    </span>
                  </td>
                  <td className="px-4">
                    <span className="text-[10px] font-bold text-muted-foreground">
                      {order.order_type === "STOP" ? "Stop" : order.order_type === "STOP_LIMIT" ? "Stop Limit" : "Limit"}
                    </span>
                  </td>
                  <td className="px-4 text-right font-semibold text-foreground">{order.lot}</td>
                  <td className="px-4 text-right font-semibold text-foreground">
                    {order.stop_price != null ? order.stop_price.toFixed(2) : "—"}
                  </td>
                  <td className="px-4 text-right font-semibold text-foreground">
                    {order.limit_price != null ? order.limit_price.toFixed(2) : "—"}
                  </td>
                  <td className="px-4 text-center">
                    <button
                      onClick={() => handleCancel(order.id)}
                      disabled={cancellingId === order.id}
                      className="inline-flex items-center gap-1 text-[10px] font-bold text-bear hover:text-bear/80 disabled:opacity-50 cursor-pointer"
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
