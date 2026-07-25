"use client"

import React, { useState } from "react"
import { Wallet, TrendingUp, ShieldHalf, Activity, PieChart, Percent, PlusCircle } from "lucide-react"
import { useTrade } from "@/contexts/TradeContext"
import DepositModal from "@/components/trade/DepositModal"

function StatBlock({
  icon: Icon,
  label,
  value,
  colorClass,
  iconColorClass,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  colorClass?: string
  iconColorClass?: string
}) {
  return (
    <div className="flex items-center gap-2.5">
      <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 bg-slate-900/80 border border-slate-800 ${iconColorClass || "text-slate-500"}`}>
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 flex flex-col">
        <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wider truncate">{label}</span>
        <span className={`text-sm font-mono font-black leading-tight ${colorClass || "text-slate-100"}`}>{value}</span>
      </div>
    </div>
  )
}

const fmt = (n: number) => n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function AccountSummaryBar() {
  const { account } = useTrade()
  const [showDeposit, setShowDeposit] = useState(false)
  if (!account) return null

  const dailyColor = account.daily_pnl >= 0 ? "text-emerald-400" : "text-rose-500"
  const totalColor = account.total_pnl >= 0 ? "text-emerald-400" : "text-rose-500"
  const returnColor = account.return_pct >= 0 ? "text-emerald-400" : "text-rose-500"

  return (
    <>
      <div className="flex items-center gap-4 bg-gradient-to-b from-slate-900/80 to-slate-950/60 border border-slate-800 rounded-xl px-5 py-4">
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-x-5 gap-y-4 flex-1">
          <StatBlock icon={Wallet} label="Toplam Portföy" value={`₺${fmt(account.total_portfolio_value)}`} iconColorClass="text-cyan-300" />
          <StatBlock icon={PieChart} label="Nakit" value={`₺${fmt(account.cash_balance)}`} iconColorClass="text-slate-400" />
          <StatBlock icon={ShieldHalf} label="Kullanılan Teminat" value={`₺${fmt(account.used_margin)}`} iconColorClass="text-amber-400" />
          <StatBlock
            icon={Activity}
            label="Günlük K/Z"
            value={`${account.daily_pnl >= 0 ? "+" : ""}₺${fmt(account.daily_pnl)}`}
            colorClass={dailyColor}
            iconColorClass={dailyColor}
          />
          <StatBlock
            icon={TrendingUp}
            label="Toplam K/Z"
            value={`${account.total_pnl >= 0 ? "+" : ""}₺${fmt(account.total_pnl)}`}
            colorClass={totalColor}
            iconColorClass={totalColor}
          />
          <StatBlock
            icon={Percent}
            label="Getiri %"
            value={`${account.return_pct >= 0 ? "+" : ""}${account.return_pct.toFixed(2)}%`}
            colorClass={returnColor}
            iconColorClass={returnColor}
          />
        </div>

        <button
          onClick={() => setShowDeposit(true)}
          className="shrink-0 inline-flex items-center gap-1.5 h-10 px-3.5 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/20 text-xs font-bold transition-colors cursor-pointer"
        >
          <PlusCircle className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Bakiye Ekle</span>
        </button>
      </div>

      {showDeposit && <DepositModal onClose={() => setShowDeposit(false)} />}
    </>
  )
}
