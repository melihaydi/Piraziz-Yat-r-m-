"use client"

import React, { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import TradingViewChart, { PendingOrderLine } from "@/components/TradingViewChart"
import { TickerLogo } from "@/components/ui/TickerLogo"
import { authFetch } from "@/lib/auth"
import { CHART_TIMEFRAMES } from "@/lib/chartTimeframes"

// TradingView's free "Advanced Chart" embed widget (used for gold/FX/crypto
// in TradeChart.tsx) cannot display BIST-exchange symbols at all - TradingView
// themselves confirm certain exchanges aren't licensed for their embeddable
// widget product even though the same symbol is fully viewable on
// tradingview.com directly. That's what the "Bu sembol sadece TradingView'de
// bulunabilir" popup on BIST:AKBNK etc. actually was - not a bug in our config,
// an unbypassable data-licensing wall on TradingView's side. So for every BIST
// instrument (the whole BIST30 tab, and any VİOP contract whose underlying is
// a BIST ticker or the XU030 index) Trade renders its OWN chart instead,
// reusing the exact same component and live-data endpoint the Hisseler/
// Screener page already relies on (real borsapy candle data, no new source).
const TIMEFRAMES = CHART_TIMEFRAMES

interface TradeBistChartProps {
  symbol: string
  displayLabel?: string
  /** Instrument name, live price and % change - shown in a header above the
   * chart (symbol · price · change), matching a real brokerage terminal's
   * chart title instead of the chart having no price context of its own. */
  name?: string
  price?: number
  changePercent?: number
  /** Resting LIMIT orders for this exact instrument, drawn as price lines. */
  pendingOrders?: PendingOrderLine[]
}

const activeTimeframe = (value: string) => TIMEFRAMES.find(tf => tf.value === value)?.label || value

export default function TradeBistChart({ symbol, displayLabel, name, price, changePercent, pendingOrders }: TradeBistChartProps) {
  const [interval, setInterval_] = useState("1h")
  const [data, setData] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    setLoading(true)
    setFailed(false)
    authFetch(`/screener/chart/${symbol}?interval=${interval}`)
      .then(res => {
        if (!res.ok) throw new Error("chart fetch failed")
        return res.json()
      })
      .then(candles => {
        if (!active) return
        if (Array.isArray(candles) && candles.length > 0) {
          setData(candles)
        } else {
          setFailed(true)
        }
      })
      .catch(() => {
        if (active) setFailed(true)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [symbol, interval])

  const isUp = (changePercent ?? 0) >= 0
  const absoluteChange = price !== undefined && changePercent !== undefined ? price - price / (1 + changePercent / 100) : undefined

  return (
    <div className="relative h-full w-full bg-background overflow-y-auto">
      {(name || price !== undefined) && (
        <div className="flex items-baseline gap-2.5 px-3 pt-3 pb-1">
          <TickerLogo ticker={symbol} size={18} className="self-center" />
          <span className="text-sm font-black text-foreground">{displayLabel || symbol}</span>
          {name && <span className="text-[11px] text-muted-foreground truncate max-w-[160px]">{name}</span>}
          {price !== undefined && (
            <span className="ml-auto flex items-baseline gap-1.5">
              <span className="text-base font-black text-foreground">{price.toFixed(2)}</span>
              {changePercent !== undefined && (
                <span className={`text-xs font-bold ${isUp ? "text-bull" : "text-bear"}`}>
                  {isUp ? "+" : ""}{absoluteChange !== undefined ? absoluteChange.toFixed(2) : ""} ({isUp ? "+" : ""}{changePercent.toFixed(2)}%)
                </span>
              )}
            </span>
          )}
        </div>
      )}

      <div className="flex items-center gap-1.5 p-2 border-b border-border overflow-x-auto">
        {TIMEFRAMES.map(tf => (
          <button
            key={tf.value}
            onClick={() => setInterval_(tf.value)}
            className={`shrink-0 px-2.5 py-1 rounded-md text-[10px] font-bold transition-colors cursor-pointer ${
              interval === tf.value
                ? "bg-secondary text-foreground border border-border"
                : "text-muted-foreground hover:text-foreground/80 border border-transparent"
            }`}
          >
            {tf.label}
          </button>
        ))}
        <span className="ml-auto shrink-0 text-[10px] font-bold text-muted-foreground/70 pl-2">
          Aralık: <span className="text-muted-foreground">{activeTimeframe(interval)}</span>
        </span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-6 w-6 text-primary animate-spin" />
        </div>
      ) : failed ? (
        <div className="flex items-center justify-center h-64 text-xs text-muted-foreground">
          Grafik verisi şu anda alınamadı.
        </div>
      ) : (
        <div className="p-3">
          <TradingViewChart data={data} pendingOrders={pendingOrders} symbol={symbol} />
        </div>
      )}
    </div>
  )
}
