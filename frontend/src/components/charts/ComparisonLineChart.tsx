"use client"

/**
 * Çoklu karşılaştırma eğrisi - /funds (fon kodları) ve /screener (hisse
 * kodları) tarafından paylaşılıyor. İki sayfada bu grafiğin JSX'i satır
 * satır aynıydı; tek fark serilerin hangi alandan okunduğuydu (`code` /
 * `ticker`), o da artık `seriesKeys` parametresi.
 *
 * Ayrı dosya + next/dynamic ile tembel yükleniyor: recharts derlenmiş hâlde
 * 324 KB ve her iki sayfanın da ilk yüküne giriyordu - halbuki grafik
 * yalnızca kullanıcı karşılaştırma yapmayı seçtiğinde çiziliyor.
 */

import React from "react"
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
} from "recharts"
import { COMPARE_COLORS } from "@/lib/chartColors"

export interface ComparisonLineChartProps {
  /** Her satır bir tarih; seriesKeys'teki her anahtar o tarihteki % değişim. */
  data: any[]
  /** Çizilecek seriler - fon kodu ya da hisse sembolü. */
  seriesKeys: string[]
}

export default function ComparisonLineChart({ data, seriesKeys }: ComparisonLineChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.3} />
        <XAxis
          dataKey="time"
          tickFormatter={(t) => new Date(t * 1000).toLocaleDateString("tr-TR", { month: "short", day: "numeric" })}
          tick={{ fontSize: 10 }}
          minTickGap={30}
        />
        <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}%`} width={45} />
        <RechartsTooltip
          labelFormatter={(t) => new Date(Number(t) * 1000).toLocaleDateString("tr-TR")}
          formatter={(value: any, name: any) => [`${value}%`, name]}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {seriesKeys.map((key, idx) => (
          <Line
            key={key}
            type="monotone"
            dataKey={key}
            stroke={COMPARE_COLORS[idx % COMPARE_COLORS.length]}
            dot={false}
            strokeWidth={2}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}
