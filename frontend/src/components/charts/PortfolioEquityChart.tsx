"use client"

/**
 * Portföy değer/karşılaştırma eğrisi.
 *
 * Sayfa gövdesinden AYRI bir dosyada olmasının sebebi tasarım değil, boyut:
 * recharts derlenmiş hâlde 344 KB'lık bir parça ve /portfolio içinden statik
 * olarak import edildiğinde sayfa ilk açılışta bu 344 KB'ı indirmek zorunda
 * kalıyordu - oysa grafik varsayılan sekmede bile değil, kullanıcı
 * "Performans" sekmesine geçene kadar hiç çizilmiyor. Ayrı dosya + üst
 * taraftaki next/dynamic sarmalayıcısı sayesinde parça ancak sekme
 * açıldığında iniyor.
 */

import React from "react"
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts"

const GRADIENT_ID = "portfolioEquityGradient"

function Gradient() {
  return (
    <defs>
      <linearGradient id={GRADIENT_ID} x1="0" y1="0" x2="0" y2="1">
        <stop offset="5%" stopColor="#a855f7" stopOpacity={0.4} />
        <stop offset="95%" stopColor="#a855f7" stopOpacity={0} />
      </linearGradient>
    </defs>
  )
}

const TOOLTIP_STYLE = {
  background: "#0f172a",
  border: "1px solid #1e293b",
  borderRadius: 8,
  fontSize: 11,
} as const

export interface PortfolioEquityChartProps {
  /** XU100 karşılaştırması varsa yüzde bazlı seri, yoksa null. */
  comparisonData: any[]
  /** Ham portföy değeri serisi - karşılaştırma yokken kullanılır. */
  equityHistory: any[]
  /** Karşılaştırma modunda mıyız + para akışı arındırması yapıldı mı. */
  hasBenchmark: boolean
  hasFlows: boolean
}

export default function PortfolioEquityChart({
  comparisonData,
  equityHistory,
  hasBenchmark,
  hasFlows,
}: PortfolioEquityChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      {hasBenchmark ? (
        <AreaChart data={comparisonData}>
          <Gradient />
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis dataKey="date" stroke="#64748b" fontSize={10} />
          <YAxis stroke="#64748b" fontSize={10} domain={["auto", "auto"]} unit="%" />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            labelStyle={{ color: "#94a3b8" }}
            formatter={(value: any, name: any) => [
              value == null ? "—" : `${Number(value) >= 0 ? "+" : ""}${Number(value).toFixed(2)}%`,
              name === "portfolio_pct"
                ? (hasFlows ? "Portföyünüz (para akışı arındırılmış)" : "Portföyünüz")
                : "XU100",
            ]}
          />
          <Area
            type="monotone" dataKey="portfolio_pct" name="portfolio_pct"
            stroke="#a855f7" fill={`url(#${GRADIENT_ID})`} strokeWidth={2}
          />
          <Area
            type="monotone" dataKey="index_pct" name="index_pct"
            stroke="#64748b" fill="none" strokeWidth={1.5}
            strokeDasharray="4 3" connectNulls={false}
          />
        </AreaChart>
      ) : (
        <AreaChart data={equityHistory}>
          <Gradient />
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis dataKey="date" stroke="#64748b" fontSize={10} />
          <YAxis stroke="#64748b" fontSize={10} domain={["auto", "auto"]} />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            labelStyle={{ color: "#94a3b8" }}
            formatter={(value: any) => [
              `₺${Number(value).toLocaleString("tr-TR", { maximumFractionDigits: 2 })}`,
              "Portföy Değeri",
            ]}
          />
          <Area type="monotone" dataKey="total_value" stroke="#a855f7" fill={`url(#${GRADIENT_ID})`} strokeWidth={2} />
        </AreaChart>
      )}
    </ResponsiveContainer>
  )
}
