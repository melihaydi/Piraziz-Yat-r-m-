"use client"

/**
 * Dağılım halkası (hisse / varlık sınıfı / sektör).
 *
 * PortfolioEquityChart ile aynı sebeple ayrı dosyada: recharts'ı sayfanın
 * ilk yükünden çıkarmak için. Bu grafik "Analiz" sekmesinde, yani kullanıcı
 * oraya geçmeden hiç çizilmiyor.
 */

import React from "react"
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from "recharts"

export interface PortfolioDistributionChartProps {
  data: { name: string; value: number; color: string }[]
}

export default function PortfolioDistributionChart({ data }: PortfolioDistributionChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          innerRadius={45}
          outerRadius={65}
          paddingAngle={4}
          dataKey="value"
        >
          {data.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={entry.color} />
          ))}
        </Pie>
        <Tooltip
          formatter={(value) =>
            value !== undefined && value !== null ? `₺${Number(value).toLocaleString("tr-TR")}` : ""
          }
        />
      </PieChart>
    </ResponsiveContainer>
  )
}
