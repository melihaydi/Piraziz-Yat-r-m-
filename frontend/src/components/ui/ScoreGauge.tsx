import React from "react"
import { cn } from "@/lib/utils"

/**
 * Dairesel 0-100 skor göstergesi - "Piyasa Nabzı" (ana sayfa) ve hisse
 * detayının AI Skoru için ortak, kütüphanesiz (recharts'a dokunmuyor) SVG
 * bileşeni. Renk skorun kendisinden türüyor: >=60 yeşil (bull), <=40
 * kırmızı (bear), arası turuncu (warn) - V2'nin üç semantik renginin
 * dışına çıkmıyor.
 */

export interface ScoreGaugeProps {
  /** 0-100 aralığında ham skor. */
  score: number
  /** Skorun altında gösterilecek kısa etiket, örn. "BULLISH". */
  label?: string
  size?: number
  className?: string
}

export function ScoreGauge({ score, label, size = 128, className }: ScoreGaugeProps) {
  const clamped = Math.min(100, Math.max(0, score))
  const strokeWidth = Math.max(6, size * 0.07)
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - clamped / 100)
  const center = size / 2

  const tone = clamped >= 60 ? "hsl(var(--bull))" : clamped <= 40 ? "hsl(var(--bear))" : "hsl(var(--warn))"

  return (
    <div className={cn("relative inline-flex items-center justify-center shrink-0", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
        <circle cx={center} cy={center} r={radius} fill="none" stroke="hsl(var(--border))" strokeWidth={strokeWidth} />
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={tone}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset var(--dur-3) var(--ease-out)" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="t-metric-lg leading-none" style={{ color: tone }}>{Math.round(clamped)}</span>
        <span className="text-[10px] font-bold text-muted-foreground mt-0.5">/100</span>
        {label && (
          <span className="text-[11px] font-black tracking-wide mt-1.5" style={{ color: tone }}>
            {label}
          </span>
        )}
      </div>
    </div>
  )
}
