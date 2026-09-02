"use client"

/**
 * Fon detay sayfasının "Varlık Kırılımı" halkası.
 *
 * PortfolioDistributionChart'tan ayrı bir bileşen çünkü biçimlendirmesi
 * farklı: buradaki değerler YÜZDE (fonun içindeki ağırlık), portföydeki
 * ise TL tutar. Aynı bileşeni parametreyle esnetmek yerine ayrı tutuldu -
 * ikisi de tek bir recharts chunk'ından besleniyor zaten.
 */

import React from "react"
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from "recharts"

export interface FundDistributionPieChartProps {
  data: { name: string; value: number }[]
  colors: string[]
}

export default function FundDistributionPieChart({ data, colors }: FundDistributionPieChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          innerRadius={40}
          outerRadius={58}
          paddingAngle={3}
          dataKey="value"
        >
          {data.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />
          ))}
        </Pie>
        <Tooltip formatter={(value) => `%${value}`} />
      </PieChart>
    </ResponsiveContainer>
  )
}
