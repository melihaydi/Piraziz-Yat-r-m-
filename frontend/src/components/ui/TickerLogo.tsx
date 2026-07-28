"use client"

import React, { useState } from "react"
import { logoUrlFor } from "@/lib/companyLogos"

/**
 * Small company logo shown to the left of a ticker badge. Renders nothing
 * (not a broken-image icon or placeholder) when the ticker has no known
 * logo domain, or if the image fails to load - callers already render a
 * ticker-code badge next to this, so there's always a fallback in view.
 */
export function TickerLogo({ ticker, size = 18, className = "" }: { ticker: string; size?: number; className?: string }) {
  const [failed, setFailed] = useState(false)
  const url = logoUrlFor(ticker, size * 2)
  if (!url || failed) return null
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
