"use client"

/**
 * Ana sayfadaki endeks (XU100/XU030) eğrisi.
 *
 * Ayrı dosya + next/dynamic ile tembel yükleniyor: recharts derlenmiş hâlde
 * 324 KB'lık bir parça ve ana sayfanın ilk yükünü tek başına en çok
 * büyüten kalemdi. Grafik ekranın üst kısmında olduğu için burada kazanç
 * "hiç indirmemek" değil, "sayfanın geri kalanını bloklamamak": kartlar,
 * favoriler ve haber akışı grafik parçası inmeden çizilebiliyor.
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

export interface IndexAreaChartProps {
  data: { time: string; value: number }[]
}

export default function IndexAreaChart({ data }: IndexAreaChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data}>
        <defs>
          <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#10b981" stopOpacity={0.25} />
            <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
        <XAxis dataKey="time" stroke="#71717a" fontSize={11} tickLine={false} />
        <YAxis
          stroke="#71717a"
          fontSize={11}
          tickLine={false}
          domain={["dataMin - 100", "dataMax + 100"]}
        />
        <Tooltip
          contentStyle={{ backgroundColor: "#18181b", borderColor: "#27272a", borderRadius: "8px" }}
          labelStyle={{ color: "#a1a1aa" }}
          itemStyle={{ color: "#fff" }}
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke="#10b981"
          strokeWidth={2.5}
          fillOpacity={1}
          fill="url(#colorValue)"
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
