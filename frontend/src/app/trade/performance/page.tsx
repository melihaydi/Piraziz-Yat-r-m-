"use client"

import React, { useEffect, useState } from "react"
import Link from "next/link"
import { ArrowLeft, Loader2 } from "lucide-react"
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts"
import { authFetch } from "@/lib/auth"
import { useTrade } from "@/contexts/TradeContext"

interface PerformanceData {
  equity_curve: { date: string; equity: number }[]
  win_rate_pct: number
  realized_pnl: number
  unrealized_pnl: number
  max_drawdown_pct: number
  total_trades: number
  closed_trades: number
  avg_win: number
  avg_loss: number
}

function MetricCard({ label, value, colorClass }: { label: string; value: string; colorClass?: string }) {
  return (
    <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4">
      <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">{label}</div>
      <div className={`text-lg font-mono font-black mt-1 ${colorClass || "text-slate-100"}`}>{value}</div>
    </div>
  )
}

export default function TradePerformancePage() {
  const { account, loading: accountLoading } = useTrade()
  const [data, setData] = useState<PerformanceData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!account) return
    authFetch("/trade/performance")
      .then(res => res.json())
      .then(d => setData(d))
      .catch(err => console.error("Failed to load trade performance:", err))
      .finally(() => setLoading(false))
  }, [account])

  if (accountLoading || loading) {
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-4rem)]">
        <Loader2 className="h-8 w-8 text-blue-400 animate-spin" />
      </div>
    )
  }

  if (!account) {
    return (
      <div className="p-8 text-center text-sm text-slate-400">
        Önce Trade sekmesinden bir hesap oluşturmalısınız.
      </div>
    )
  }

  if (!data) {
    return <div className="p-8 text-center text-sm text-slate-400">Performans verileri alınamadı.</div>
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center gap-3">
        <Link href="/trade" className="text-slate-500 hover:text-blue-300 transition-colors">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="text-xl font-black tracking-tight text-slate-100">Performans</h1>
      </div>

      <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4">
        <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Equity Curve</div>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data.equity_curve}>
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
        </div>
        {data.equity_curve.length <= 1 && (
          <p className="text-[10px] text-slate-600 mt-2">
            Equity curve, hesabınız gün geçtikçe biriken gerçek günlük değerlerle dolacak.
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MetricCard label="Kazanma Oranı" value={`%${data.win_rate_pct.toFixed(1)}`} />
        <MetricCard
          label="Gerçekleşen Kâr"
          value={`₺${data.realized_pnl.toFixed(2)}`}
          colorClass={data.realized_pnl >= 0 ? "text-emerald-400" : "text-rose-500"}
        />
        <MetricCard
          label="Gerçekleşmeyen Kâr"
          value={`₺${data.unrealized_pnl.toFixed(2)}`}
          colorClass={data.unrealized_pnl >= 0 ? "text-emerald-400" : "text-rose-500"}
        />
        <MetricCard label="Maks. Düşüş (Drawdown)" value={`%${data.max_drawdown_pct.toFixed(2)}`} colorClass="text-rose-400" />
        <MetricCard label="Toplam İşlem" value={`${data.total_trades}`} />
        <MetricCard label="Kapanan İşlem" value={`${data.closed_trades}`} />
        <MetricCard label="Ortalama Kâr" value={`₺${data.avg_win.toFixed(2)}`} colorClass="text-emerald-400" />
        <MetricCard label="Ortalama Zarar" value={`₺${data.avg_loss.toFixed(2)}`} colorClass="text-rose-500" />
      </div>
    </div>
  )
}
