"use client"

import React, { useEffect, useMemo, useState } from "react"
import { ArrowUpCircle, ArrowDownCircle, Loader2, Info, Receipt } from "lucide-react"
import { useTrade } from "@/contexts/TradeContext"

// Kept in sync with backend/app/services/trade_service.py's COMMISSION_RATE -
// this is only an on-screen estimate before submitting; the real commission
// is always computed server-side at the live execution price.
const COMMISSION_RATE = 0.001

export default function OrderPanel() {
  const { activeTab, watchlist, viopWatchlist, selectedSymbol, account, placeOrder } = useTrade()
  const [lot, setLot] = useState("10")
  const [orderType, setOrderType] = useState<"MARKET" | "LIMIT">("MARKET")
  const [limitPrice, setLimitPrice] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [feedback, setFeedback] = useState<{ type: "ok" | "error"; text: string } | null>(null)

  const list = activeTab === "stock" ? watchlist : viopWatchlist
  const instrument = list.find(i => i.symbol === selectedSymbol)

  useEffect(() => {
    setFeedback(null)
  }, [selectedSymbol, activeTab])

  // Default the limit price field to the last price whenever the selected
  // instrument changes or Limit mode is first switched on, so the user
  // isn't staring at a blank/stale price from a different symbol.
  useEffect(() => {
    if (orderType === "LIMIT" && instrument) {
      setLimitPrice(instrument.price.toFixed(2))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderType, selectedSymbol])

  const lotNum = parseFloat(lot) || 0
  const lastPrice = instrument?.price || 0
  const limitPriceNum = parseFloat(limitPrice.replace(",", ".")) || 0
  const effectivePrice = orderType === "LIMIT" ? limitPriceNum : lastPrice
  const notional = effectivePrice * lotNum
  const commission = notional * COMMISSION_RATE
  const total = notional + commission

  const openPosition = useMemo(() => {
    if (!account) return null
    return account.positions.find(p => p.instrument_type === activeTab && p.symbol === selectedSymbol) || null
  }, [account, activeTab, selectedSymbol])

  const handleOrder = async (side: "AL" | "SAT") => {
    if (!instrument || lotNum <= 0) return
    if (orderType === "LIMIT" && limitPriceNum <= 0) return
    setSubmitting(true)
    setFeedback(null)
    const result = await placeOrder(
      activeTab, selectedSymbol, side, lotNum, orderType, orderType === "LIMIT" ? limitPriceNum : undefined
    )
    setSubmitting(false)
    if (result.ok) {
      setFeedback({
        type: "ok",
        text: orderType === "LIMIT"
          ? `${side === "AL" ? "Alış" : "Satış"} limit emri emir defterine eklendi.`
          : `${side === "AL" ? "Alış" : "Satış"} emri gerçekleşti.`,
      })
    } else {
      setFeedback({ type: "error", text: result.error || "Emir gerçekleştirilemedi." })
    }
  }

  if (!instrument) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2 bg-[#16171E] border border-slate-800 rounded-xl text-slate-600">
        <Receipt className="h-5 w-5" />
        <span className="text-xs font-bold">Enstrüman seçin</span>
      </div>
    )
  }

  const isUp = instrument.change_percent >= 0
  const spread = instrument.ask - instrument.bid

  // Stocks are always long-only; a SAT with no open long stays disabled.
  // VİOP allows shorting, so SAT stays enabled even with no position -
  // it opens a short instead of erroring.
  const satDisabled =
    submitting ||
    lotNum <= 0 ||
    (activeTab === "stock" && (!openPosition || openPosition.position_side !== "LONG"))

  return (
    <div className="flex flex-col h-full bg-[#16171E] border border-slate-800 rounded-xl overflow-hidden">
      {/* Selected instrument header */}
      <div className="p-4 border-b border-slate-800">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-black text-white">{instrument.symbol}</div>
            <div className="text-[10px] text-slate-500 truncate max-w-[160px]">{instrument.name}</div>
          </div>
          <div className="text-right">
            <div className="text-lg font-black text-white">{lastPrice.toFixed(2)}</div>
            <div className={`text-[10px] font-bold ${isUp ? "text-emerald-400" : "text-rose-500"}`}>
              {isUp ? "+" : ""}{instrument.change_percent.toFixed(2)}%
            </div>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 mt-3 text-center">
          <div className="bg-[#1c1d26]/80 rounded-lg py-1.5">
            <div className="text-[9px] text-slate-500 uppercase">Alış</div>
            <div className="text-xs font-bold text-emerald-400">{instrument.bid.toFixed(2)}</div>
          </div>
          <div className="bg-[#1c1d26]/80 rounded-lg py-1.5">
            <div className="text-[9px] text-slate-500 uppercase">Satış</div>
            <div className="text-xs font-bold text-rose-400">{instrument.ask.toFixed(2)}</div>
          </div>
          <div className="bg-[#1c1d26]/80 rounded-lg py-1.5">
            <div className="text-[9px] text-slate-500 uppercase">Spread</div>
            <div className="text-xs font-bold text-white">{spread.toFixed(2)}</div>
          </div>
        </div>

        {openPosition && (
          <div
            className={`mt-3 flex items-center justify-between text-[10px] rounded-lg px-2.5 py-2 border ${
              openPosition.position_side === "SHORT"
                ? "bg-amber-500/5 border-amber-500/20"
                : "bg-white/5 border-white/10"
            }`}
          >
            <span className="flex items-center gap-1.5 text-slate-400">
              <span
                className={`text-[8px] font-black px-1.5 py-0.5 rounded ${
                  openPosition.position_side === "SHORT"
                    ? "bg-amber-500/15 text-amber-400"
                    : "bg-white/10 text-white"
                }`}
              >
                {openPosition.position_side === "SHORT" ? "SHORT" : "LONG"}
              </span>
              <span className="font-bold text-white">{openPosition.lot} lot</span>
            </span>
            <span className={openPosition.pnl >= 0 ? "text-emerald-400 font-bold" : "text-rose-500 font-bold"}>
              {openPosition.pnl >= 0 ? "+" : ""}{openPosition.pnl.toFixed(2)} ₺
            </span>
          </div>
        )}
      </div>

      {/* Order form */}
      <div className="p-4 space-y-3 flex-1">
        <div className="flex gap-1 bg-[#1c1d26] border border-slate-800 rounded-lg p-1">
          <button
            onClick={() => setOrderType("MARKET")}
            className={`flex-1 h-8 rounded-md text-xs font-bold cursor-pointer transition-colors ${
              orderType === "MARKET" ? "bg-white text-[#101015]" : "text-slate-400 hover:text-white"
            }`}
          >
            Piyasa
          </button>
          <button
            onClick={() => setOrderType("LIMIT")}
            className={`flex-1 h-8 rounded-md text-xs font-bold cursor-pointer transition-colors ${
              orderType === "LIMIT" ? "bg-white text-[#101015]" : "text-slate-400 hover:text-white"
            }`}
          >
            Limit
          </button>
        </div>

        <div className={`grid ${orderType === "LIMIT" ? "grid-cols-2 gap-2" : "grid-cols-1"}`}>
          <div>
            <label className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">Lot</label>
            <input
              type="number"
              min={1}
              value={lot}
              onChange={e => setLot(e.target.value)}
              className="w-full h-9 mt-1 px-3 rounded-lg bg-[#1c1d26] border border-slate-800 text-sm font-bold text-white focus:outline-none focus:border-white/30"
            />
          </div>
          {orderType === "LIMIT" && (
            <div>
              <label className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">Limit Fiyatı</label>
              <input
                type="text"
                inputMode="decimal"
                value={limitPrice}
                onChange={e => setLimitPrice(e.target.value)}
                className="w-full h-9 mt-1 px-3 rounded-lg bg-[#1c1d26] border border-slate-800 text-sm font-bold text-white focus:outline-none focus:border-white/30"
              />
            </div>
          )}
        </div>

        {orderType === "LIMIT" && (
          <div className="flex items-start gap-1.5 text-[10px] text-slate-500 leading-relaxed">
            <Info className="h-3 w-3 shrink-0 mt-0.5" />
            <span>
              Emir hemen gerçekleşmez, fiyat limit seviyenize ulaştığında otomatik gerçekleşir ve emir defterinde bekler.
            </span>
          </div>
        )}

        {/* Order breakdown - given its own distinct card treatment rather
         * than a flat inline list, so lot/cost/total/commission read as a
         * clear "order ticket" block. */}
        <div className="rounded-xl border border-slate-800 bg-[#1c1d26]/50 divide-y divide-slate-800/80 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 text-[11px]">
            <span className="text-slate-500">{orderType === "LIMIT" ? "Limit Fiyatı" : "Fiyat"}</span>
            <span className="font-semibold text-white">{effectivePrice.toFixed(2)} ₺</span>
          </div>
          <div className="flex items-center justify-between px-3 py-2 text-[11px]">
            <span className="text-slate-500">Toplam Tutar</span>
            <span className="font-semibold text-white">{notional.toFixed(2)} ₺</span>
          </div>
          <div className="flex items-center justify-between px-3 py-2 text-[11px]">
            <span className="text-slate-500">Komisyon (tahmini)</span>
            <span className="font-semibold text-slate-300">{commission.toFixed(2)} ₺</span>
          </div>
          <div className="flex items-center justify-between px-3 py-2.5 bg-[#1c1d26]/80">
            <span className="text-[11px] font-bold text-slate-300">Tahmini Toplam</span>
            <span className="font-black text-white text-sm">{total.toFixed(2)} ₺</span>
          </div>
        </div>

        {activeTab === "viop" && !openPosition && (
          <div className="flex items-start gap-1.5 text-[10px] text-slate-500 leading-relaxed">
            <Info className="h-3 w-3 shrink-0 mt-0.5" />
            <span>SAT butonu pozisyonunuz yokken kısa (short) pozisyon açar; AL ise long pozisyon açar.</span>
          </div>
        )}

        {feedback && (
          <div
            className={`text-[11px] font-semibold rounded-lg px-2.5 py-1.5 ${
              feedback.type === "ok"
                ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
            }`}
          >
            {feedback.text}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2 pt-1">
          <button
            onClick={() => handleOrder("AL")}
            disabled={submitting || lotNum <= 0}
            className="flex items-center justify-center gap-1.5 h-11 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-black text-sm transition-colors cursor-pointer"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUpCircle className="h-4 w-4" />}
            AL
          </button>
          <button
            onClick={() => handleOrder("SAT")}
            disabled={satDisabled}
            className="flex items-center justify-center gap-1.5 h-11 rounded-lg bg-rose-500 hover:bg-rose-400 disabled:opacity-50 text-slate-950 font-black text-sm transition-colors cursor-pointer"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowDownCircle className="h-4 w-4" />}
            SAT
          </button>
        </div>
      </div>
    </div>
  )
}
