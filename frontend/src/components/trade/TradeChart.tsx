"use client"

import React, { useEffect, useRef, useState } from "react"
import { ExternalLink } from "lucide-react"

// NOTE: trade/page.tsx only ever mounts this component for gold/FX
// instruments (see its TV_WIDGET_CAPABLE set) - BIST-exchange symbols
// (regular BIST30 stocks, XU030, etc.) are routed to TradeBistChart instead,
// because TradingView's free embeddable widget cannot display BIST data at
// all (confirmed with TradingView: some exchanges simply aren't licensed for
// the widget product, even though the same symbol is fully viewable on
// tradingview.com itself). That's what the "Bu sembol sadece TradingView'de
// bulunabilir" popup on BIST:AKBNK actually was - not a fixable config issue.
//
// Maps our internal symbol naming to a TradingView chart symbol. Previously
// this force-prefixed every non-BIST symbol with "FX_IDC:", which doesn't
// actually resolve for gold on TradingView (FX_IDC has no XAUUSD/XAUTRYG
// listing) - that's what caused the "this symbol was not found" banner on
// first load. Gold now points at TVC:GOLD, the standard always-available
// USD spot gold reference; there's no reliable TRY-denominated gram altın
// symbol on TradingView, so Gram Altın charts the same underlying ons altın
// price (still the right instrument, just quoted in USD instead of TRY).
const SYMBOL_OVERRIDES: Record<string, string> = {
  XAUUSD: "TVC:GOLD",
  XAUTRYG: "TVC:GOLD",
  USDTRY: "USDTRY",
  EURTRY: "EURTRY",
  BTCUSDT: "BINANCE:BTCUSDT",
}

function toTradingViewSymbol(rawSymbol: string): string {
  const symbol = rawSymbol.toUpperCase()
  if (SYMBOL_OVERRIDES[symbol]) return SYMBOL_OVERRIDES[symbol]
  return `BIST:${symbol}`
}

interface TradeChartProps {
  /** Underlying live symbol to chart (already resolved from a VİOP contract
   * code to its real underlying instrument, if applicable). */
  symbol: string
  displayLabel?: string
}

/**
 * The Trade module's centerpiece chart. Embeds TradingView's official
 * "Advanced Chart" widget (not the lite/mini variants used elsewhere in this
 * app for the Economic Calendar / News widgets) - this is the full
 * interactive charting product: candles, volume, crosshair, price labels,
 * native timeframe + range switchers, and a real indicator/drawing toolbar
 * (EMA/SMA/RSI/MACD/Bollinger/VWAP preloaded, trend & support/resistance
 * lines drawable by hand via TradingView's own tools), all fed by the same
 * live TradingView data everything else in this app already uses - no new
 * data source, per the module's technical constraints.
 */
export default function TradeChart({ symbol, displayLabel }: TradeChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!containerRef.current) return
    containerRef.current.innerHTML = '<div class="tradingview-widget-container__widget" style="height:100%;width:100%"></div>'
    setFailed(false)

    const tvSymbol = toTradingViewSymbol(symbol)

    const script = document.createElement("script")
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js"
    script.type = "text/javascript"
    script.async = true
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol: tvSymbol,
      interval: "60",
      timezone: "Europe/Istanbul",
      theme: "dark",
      style: "1",
      locale: "tr",
      toolbar_bg: "#0b1220",
      enable_publishing: false,
      allow_symbol_change: false,
      hide_side_toolbar: false,
      withdateranges: true,
      studies: [
        "MASimple@tv-basicstudies",
        "MAExp@tv-basicstudies",
        "RSI@tv-basicstudies",
        "MACD@tv-basicstudies",
        "BB@tv-basicstudies",
        "VWAP@tv-basicstudies",
      ],
      support_host: "https://www.tradingview.com",
    })
    script.onerror = () => setFailed(true)

    const fallbackTimer = setTimeout(() => {
      if (containerRef.current && containerRef.current.childElementCount <= 1) {
        setFailed(true)
      }
    }, 7000)

    containerRef.current.appendChild(script)

    return () => clearTimeout(fallbackTimer)
  }, [symbol])

  if (failed) {
    return (
      <div className="flex flex-col items-center justify-center text-center py-16 space-y-3 h-full bg-[#0E0E13]">
        <p className="text-xs text-slate-500 leading-relaxed px-2">
          Grafik şu anda yüklenemedi.
        </p>
        <a
          href={`https://www.tradingview.com/symbols/${toTradingViewSymbol(symbol).replace(":", "-")}/`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-bold text-blue-400 hover:underline flex items-center"
        >
          TradingView&apos;de Aç <ExternalLink className="h-3 w-3 ml-1" />
        </a>
      </div>
    )
  }

  return (
    <div className="relative h-full w-full bg-[#0E0E13]">
      {displayLabel && (
        <div className="absolute top-2 left-2 z-10 text-[10px] font-bold text-slate-400 bg-[#1c1d26]/80 px-2 py-1 rounded pointer-events-none">
          {displayLabel}
        </div>
      )}
      <div className="tradingview-widget-container h-full w-full" ref={containerRef} />
    </div>
  )
}
