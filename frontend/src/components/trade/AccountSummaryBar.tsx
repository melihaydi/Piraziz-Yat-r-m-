"use client"

import React from "react"
import { useTrade } from "@/contexts/TradeContext"

function StatBlock({ label, value, colorClass }: { label: string; value: string; colorClass?: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">{label}</span>
      <span className={`text-sm font-mono font-black ${colorClass || "text-slate-100"}`}>{value}</span>
    </div>
  )
}

const fmt = (n: number) => n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function AccountSummaryBar() {
  const { account } = useTrade()
  if (!account) return null

  const dailyColor = account.daily_pnl >= 0 ? "text-emerald-400" : "text-rose-500"
  const totalColor = account.total_pnl >= 0 ? "text-emerald-400" : "text-rose-500"
  const returnColor = account.return_pct >= 0 ? "text-emerald-400" : "text-rose-500"

  return (
    <div className="grid grid-cols-3 sm:grid-cols-6 gap-4 bg-slate-950/60 border border-slate-800 rounded-xl px-5 py-4">
      <StatBlock label="Toplam Portföy" value={`₺${fmt(account.total_portfolio_value)}`} />
      <StatBlock label="Nakit" value={`₺${fmt(account.cash_balance)}`} />
      <StatBlock label="Kullanılan Teminat" value={`₺${fmt(account.used_margin)}`} />
      <StatBlock
        label="Günlük K/Z"
        value={`${account.daily_pnl >= 0 ? "+" : ""}₺${fmt(account.daily_pnl)}`}
        colorClass={dailyColor}
      />
      <StatBlock
        label="Toplam K/Z"
        value={`${account.total_pnl >= 0 ? "+" : ""}₺${fmt(account.total_pnl)}`}
        colorClass={totalColor}
      />
      <StatBlock
        label="Getiri %"
        value={`${account.return_pct >= 0 ? "+" : ""}${account.return_pct.toFixed(2)}%`}
        colorClass={returnColor}
      />
    </div>
  )
}
