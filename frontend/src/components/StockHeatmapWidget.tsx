"use client"

import React, { useEffect, useRef, useState } from "react"
import { ExternalLink } from "lucide-react"

/**
 * Embeds TradingView's official Stock Heatmap widget for BIST100, replacing
 * the previous custom-built box heatmap (per-ticker boxes sized by market
 * cap, colored by daily change) that looked rough compared to TradingView's
 * own. Same load/fallback pattern as EconomicCalendarWidget.tsx.
 */
export default function StockHeatmapWidget({ height = 420 }: { height?: number }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!containerRef.current) return
    containerRef.current.innerHTML = '<div class="tradingview-widget-container__widget"></div>'

    const script = document.createElement("script")
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-stock-heatmap.js"
    script.type = "text/javascript"
    script.async = true
    script.innerHTML = JSON.stringify({
      exchanges: [],
      dataSource: "BIST100",
      grouping: "sector",
      blockSize: "market_cap_basic",
      blockColor: "change",
      locale: "tr",
      symbolUrl: "",
      colorTheme: "dark",
      hasTopBar: true,
      isDataSetEnabled: false,
      isZoomEnabled: true,
      hasSymbolTooltip: true,
      isMonoSize: false,
      width: "100%",
      height: String(height),
    })
    script.onerror = () => setFailed(true)

    const fallbackTimer = setTimeout(() => {
      if (containerRef.current && containerRef.current.childElementCount <= 1) {
        setFailed(true)
      }
    }, 6000)

    containerRef.current.appendChild(script)

    return () => clearTimeout(fallbackTimer)
  }, [height])

  if (failed) {
    return (
      <div className="flex flex-col items-center justify-center text-center py-10 space-y-3">
        <p className="text-[11px] text-muted-foreground leading-relaxed px-2">
          Isı haritası widget'ı şu anda yüklenemedi. Güncel haritayı doğrudan TradingView üzerinden inceleyebilirsiniz.
        </p>
        <a
          href="https://www.tradingview.com/heatmap/stock/?dataset=BIST100"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-bold text-primary hover:underline flex items-center"
        >
          Isı Haritasını Aç <ExternalLink className="h-3 w-3 ml-1" />
        </a>
      </div>
    )
  }

  return <div className="tradingview-widget-container" ref={containerRef} style={{ minHeight: height }} />
}
