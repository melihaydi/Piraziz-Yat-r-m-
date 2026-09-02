"use client"

/**
 * Fon detay sayfasının tarihsel NAV eğrisi.
 *
 * Ayrı dosyada olmasının sebebi diğer charts/* bileşenleriyle aynı:
 * recharts (~324KB) sayfanın İLK yükünden çıksın diye dynamic() ile
 * yükleniyor. Bu sayfada ekstra önemli - /funds/[code] herkese açık
 * (bkz. AuthGate'in PUBLIC_PATHS'i), yani arama motorundan gelen ilk
 * ziyaretçinin gördüğü sayfa; grafik ekranda görünene kadar o 324KB'ı
 * indirmesi için sebep yok.
 */

import React from "react"
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip } from "recharts"

export interface FundPriceAreaChartProps {
  data: { date: any; price: number }[]
}

export default function FundPriceAreaChart({ data }: FundPriceAreaChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data}>
        <defs>
          <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#10b981" stopOpacity={0.2} />
            <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis dataKey="date" stroke="#52525b" fontSize={10} tickLine={false} />
        <YAxis stroke="#52525b" fontSize={10} domain={["auto", "auto"]} tickLine={false} />
        <Tooltip formatter={(value) => `₺${Number(value).toFixed(4)}`} />
        <Area type="monotone" dataKey="price" stroke="#10b981" strokeWidth={2} fillOpacity={1} fill="url(#colorPrice)" />
      </AreaChart>
    </ResponsiveContainer>
  )
}
