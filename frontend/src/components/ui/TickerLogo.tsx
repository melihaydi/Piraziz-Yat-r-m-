"use client"

import React, { useState } from "react"
import { logoUrlFor } from "@/lib/companyLogos"

// A small fixed palette, not a truly random color per render - deterministic
// per ticker (same ticker always gets the same color) via a cheap string
// hash, so the same stock doesn't visually flicker between colors across
// re-renders or pages.
const FALLBACK_COLORS = [
  "#a855f7", "#06b6d4", "#10b981", "#f59e0b", "#ec4899",
  "#3b82f6", "#ef4444", "#14b8a6", "#8b5cf6", "#f97316",
]

function fallbackColorFor(ticker: string): string {
  let hash = 0
  for (let i = 0; i < ticker.length; i++) {
    hash = (hash * 31 + ticker.charCodeAt(i)) >>> 0
  }
  return FALLBACK_COLORS[hash % FALLBACK_COLORS.length]
}

/**
 * Small company logo shown to the left of a ticker badge. Falls back to a
 * deterministic colored initial-letter avatar (not a real logo, just a
 * placeholder so something always renders) when the ticker has no known
 * logo domain, or if the real logo image fails to load.
 */
export function TickerLogo({ ticker, size = 18, className = "" }: { ticker: string; size?: number; className?: string }) {
  const [failed, setFailed] = useState(false)
  const url = logoUrlFor(ticker, size * 2)

  if (!url || failed) {
    return (
      <div
        className={`rounded-sm shrink-0 flex items-center justify-center font-black text-white ${className}`}
        style={{ width: size, height: size, backgroundColor: fallbackColorFor(ticker), fontSize: Math.max(8, size * 0.45) }}
      >
        {ticker.slice(0, 1)}
      </div>
    )
  }

  return (
    <img
      src={url}
      alt=""
      width={size}
      height={size}
      onError={() => setFailed(true)}
      className={`rounded-sm object-contain bg-white/5 shrink-0 ${className}`}
      style={{ width: size, height: size }}
    />
  )
}
