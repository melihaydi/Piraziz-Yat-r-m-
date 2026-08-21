"use client"

/**
 * Simüle trading hesabının equity eğrisi (/trade/performance).
 *
 * Diğer grafiklerle aynı gerekçeyle ayrı dosyada + tembel yükleniyor:
 * recharts derlenmiş hâlde 324 KB'lık bir parça. Bu sayfada grafik asıl
 * içerik olduğu için kazanç "hiç indirmemek" değil - üstteki metrik
 * kartları ve sayfa iskeleti grafik parçası inmeden çizilebiliyor.
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

export interface EquityCurveChartProps {
  data: { date: string; equity: number }[]
}

export default function EquityCurveChart({ data }: EquityCurveChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data}>
        <defs>
          <linearGradient id="equityGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#22d3ee" stopOpacity={0.4} />
            <stop offset="95%" stopColor="#22d3ee" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
        <XAxis dataKey="date" stroke="#64748b" fontSize={10} />
        <YAxis stroke="#64748b" fontSize={10} domain={["auto", "auto"]} />
        <Tooltip
          contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8, fontSize: 11 }}
          labelStyle={{ color: "#94a3b8" }}
        />
        <Area type="monotone" dataKey="equity" stroke="#22d3ee" fill="url(#equityGradient)" strokeWidth={2} />
      </AreaChart>
    </ResponsiveContainer>
  )
}
