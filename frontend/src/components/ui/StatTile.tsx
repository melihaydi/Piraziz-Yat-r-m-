import React from "react"
import { cn } from "@/lib/utils"

/**
 * Bir rakamı her yerde aynı üç parçadan kurar: etiket, değer, değişim
 * (+ isteğe bağlı bir eğri). Tasarım incelemesindeki "sayı grameri" önerisinin
 * karşılığı - boyut hiyerarşiyi taşır, renk yalnızca yönü söyler.
 *
 * Tahmini rakamlar (henüz kesinleşmemiş, örn. bir fonun canlı NAV tahmini)
 * bilerek turuncu - yeşil/kırmızıdan tamamen ayrı bir dil, kesinleşmiş bir
 * rakamla asla karışmasın diye (bkz. portfolio/page.tsx'teki
 * daily_change_is_estimate kuralı, aynı ilke burada genelleştirildi).
 */

export interface StatTileDelta {
  /** Örn. "+₺6.240" - biçimlendirme çağıran tarafın sorumluluğunda. */
  label: string
  /** Yönü belirler: pozitif/negatif/sıfır. */
  value: number
  /** true ise turuncu tonla çizilir, yön rengi hiç kullanılmaz. */
  isEstimate?: boolean
}

export interface StatTileProps {
  label: string
  /** Örn. "₺482.310,44" - biçimlendirme çağıran tarafın sorumluluğunda. */
  value: string
  delta?: StatTileDelta
  /** Ham veri noktaları - en az 2 değer gerekir, azsa çizilmez. */
  sparkline?: number[]
  className?: string
}

function toneClass(delta: StatTileDelta): string {
  if (delta.isEstimate) return "text-warn"
  if (delta.value > 0) return "text-bull"
  if (delta.value < 0) return "text-bear"
  return "text-muted-foreground"
}

function Sparkline({ data, tone }: { data: number[]; tone: string }) {
  const w = 96
  const h = 32
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w
    const y = h - ((v - min) / range) * (h - 4) - 2
    return [x, y] as const
  })
  const linePath = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ")
  const areaPath = `${linePath} L${w} ${h} L0 ${h} Z`
  const [lastX, lastY] = points[points.length - 1]
  const gradientId = `sparkline-gradient-${tone.replace(/[^a-z0-9]/gi, "")}`

  // currentColor: SVG'nin rengi ebeveynin text- sınıfından gelsin, ayrı bir
  // renk haritası tutmaya gerek kalmasın - tone zaten dışarıdan geliyor.
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className={tone} aria-hidden>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity={0.32} />
          <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradientId})`} stroke="none" />
      <path d={linePath} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lastX} cy={lastY} r={2.6} fill="currentColor" />
    </svg>
  )
}

export function StatTile({ label, value, delta, sparkline, className }: StatTileProps) {
  const tone = delta ? toneClass(delta) : ""
  return (
    <div className={cn("flex items-center justify-between gap-3", className)}>
      <div className="min-w-0">
        <div className="t-label">{label}</div>
        <div className="t-metric text-foreground truncate">{value}</div>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        {delta && (
          <span className={cn("text-sm font-bold font-mono", tone)}>{delta.label}</span>
        )}
        {sparkline && sparkline.length >= 2 && (
          <Sparkline data={sparkline} tone={delta ? tone : "text-primary"} />
        )}
      </div>
    </div>
  )
}
