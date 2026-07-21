"use client"

import React, { useEffect, useRef, useState } from "react"
import { ExternalLink } from "lucide-react"

interface TradingViewNewsWidgetProps {
  /** BIST ticker (e.g. "GARAN") to show single-symbol news for. Omit for the
   * general market feed. */
  symbol?: string
  height?: number
}

/**
 * Embeds TradingView's official (free, always-live) news/timeline widget.
 * Replaces the old backend RSS+KAP scraping pipeline (app/services/news.py) -
 * that setup was fragile (dead RSS URLs, slow KAP + AI enrichment calls) and
 * the user asked to just pull news straight from TradingView instead, the
 * same way the Economic Calendar widget already does.
 *
 * Mirrors EconomicCalendarWidget.tsx's proven pattern: inject the embed
 * script with a JSON config, and fall back to a plain link if it fails to
 * render within a few seconds.
 */
export default function TradingViewNewsWidget({ symbol, height = 550 }: TradingViewNewsWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!containerRef.current) return
    containerRef.current.innerHTML = '<div class="tradingview-widget-container__widget"></div>'
    setFailed(false)

    const config: Record<string, unknown> = symbol
      ? { feedMode: "symbol", symbol: `BIST:${symbol.toUpperCase()}` }
      : { feedMode: "market", market: "stock" }

    const script = document.createElement("script")
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-timeline.js"
    script.type = "text/javascript"
    script.async = true
    script.innerHTML = JSON.stringify({
      ...config,
      colorTheme: "dark",
      isTransparent: true,
      displayMode: "regular",
      width: "100%",
      height,
      locale: "tr"
    })
    script.onerror = () => setFailed(true)

    const fallbackTimer = setTimeout(() => {
      if (containerRef.current && containerRef.current.childElementCount <= 1) {
        setFailed(true)
      }
    }, 6000)

    containerRef.current.appendChild(script)

    return () => clearTimeout(fallbackTimer)
  }, [symbol, height])

  if (failed) {
    const fallbackUrl = symbol
      ? `https://www.tradingview.com/symbols/BIST-${symbol.toUpperCase()}/news/`
      : "https://www.tradingview.com/news/"
    return (
      <div className="flex flex-col items-center justify-center text-center py-10 space-y-3">
        <p className="text-[11px] text-muted-foreground leading-relaxed px-2">
          Haber widget'ı şu anda yüklenemedi. Güncel haberleri doğrudan TradingView üzerinden inceleyebilirsiniz.
        </p>
        <a
          href={fallbackUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-bold text-primary hover:underline flex items-center"
        >
          Haberleri Aç <ExternalLink className="h-3 w-3 ml-1" />
        </a>
      </div>
    )
  }

  return <div className="tradingview-widget-container" ref={containerRef} style={{ minHeight: height }} />
}
