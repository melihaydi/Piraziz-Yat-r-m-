"use client"

import React, { useEffect, useRef, useState } from "react"
import { ExternalLink } from "lucide-react"

/**
 * Embeds TradingView's official (free, always-live) Economic Calendar widget.
 * This replaces the old hardcoded 3-item static list that never changed.
 * If the external script fails to load for any reason (offline, blocked, etc.)
 * we fall back to a direct link so the section is never just a dead blank box.
 */
export default function EconomicCalendarWidget() {
  const containerRef = useRef<HTMLDivElement>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!containerRef.current) return
    containerRef.current.innerHTML = '<div class="tradingview-widget-container__widget"></div>'

    const script = document.createElement("script")
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-events.js"
    script.type = "text/javascript"
    script.async = true
    script.innerHTML = JSON.stringify({
      colorTheme: "dark",
      isTransparent: true,
      width: "100%",
      height: "460",
      locale: "tr",
      importanceFilter: "1",
      countryFilter: "tr,us"
    })
    script.onerror = () => setFailed(true)

    // If the widget hasn't rendered anything after a few seconds, show the fallback too.
    const fallbackTimer = setTimeout(() => {
      if (containerRef.current && containerRef.current.childElementCount <= 1) {
        setFailed(true)
      }
    }, 6000)

    containerRef.current.appendChild(script)

    return () => clearTimeout(fallbackTimer)
  }, [])

  if (failed) {
    return (
      <div className="flex flex-col items-center justify-center text-center py-10 space-y-3">
        <p className="text-[11px] text-muted-foreground leading-relaxed px-2">
          Ekonomi takvimi widget'ı şu anda yüklenemedi. Güncel takvimi doğrudan TradingView üzerinden inceleyebilirsiniz.
        </p>
        <a
          href="https://www.tradingview.com/economic-calendar/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-bold text-primary hover:underline flex items-center"
        >
          Ekonomi Takvimini Aç <ExternalLink className="h-3 w-3 ml-1" />
        </a>
      </div>
    )
  }

  return <div className="tradingview-widget-container" ref={containerRef} style={{ minHeight: 460 }} />
}
