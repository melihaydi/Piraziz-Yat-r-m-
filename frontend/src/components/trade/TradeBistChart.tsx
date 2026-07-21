"use client"

import React, { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import TradingViewChart from "@/components/TradingViewChart"

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
const TIMEFRAMES: { label: string; value: string }[] = [
  { label: "1dk", value: "1m" },
  { label: "5dk", value: "5m" },
  { label: "15dk", value: "15m" },
  { label: "1s", value: "1h" },
  { label: "4s", value: "4h" },
  { label: "Günlük", value: "1d" },
  { label: "Haftalık", value: "1wk" },
  { label: "Aylık", value: "1mo" },
]

interface TradeBistChartProps {
  symbol: string
  displayLabel?: string
}

export default function TradeBistChart({ symbol, displayLabel }: TradeBistChartProps) {
  const [interval, setInterval_] = useState("1h")
  const [data, setData] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    setLoading(true)
    setFailed(false)
    fetch(`http://localhost:8000/api/v1/screener/chart/${symbol}?interval=${interval}`)
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

  return (
    <div className="relative h-full w-full bg-slate-950 overflow-y-auto">
      {displayLabel && (
        <div className="absolute top-2 left-2 z-10 text-[10px] font-bold text-slate-400 bg-slate-900/80 px-2 py-1 rounded pointer-events-none">
          {displayLabel}
        </div>
      )}

      <div className="flex items-center gap-1.5 p-2 border-b border-slate-800 overflow-x-auto">
        {TIMEFRAMES.map(tf => (
          <button
            key={tf.value}
            onClick={() => setInterval_(tf.value)}
            className={`shrink-0 px-2.5 py-1 rounded-md text-[10px] font-bold transition-colors cursor-pointer ${
              interval === tf.value
                ? "bg-cyan-500/15 text-cyan-300 border border-cyan-500/30"
                : "text-slate-500 hover:text-slate-300 border border-transparent"
            }`}
          >
            {tf.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-6 w-6 text-cyan-400 animate-spin" />
        </div>
      ) : failed ? (
        <div className="flex items-center justify-center h-64 text-xs text-slate-500">
          Grafik verisi şu anda alınamadı.
        </div>
      ) : (
        <div className="p-3">
          <TradingViewChart data={data} />
        </div>
      )}
    </div>
  )
}
