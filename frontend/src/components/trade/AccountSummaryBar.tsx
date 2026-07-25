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
  // Icon sits inline with the label (not in its own boxed square) so the
  // whole block reads as one compact column - a fixed icon box ate ~40px
  // before any text got a chance to render, which on a 2-3 column mobile
  // grid squeezed labels like "Toplam Portföy" down to an unreadable ~18px.
  return (
    <div className="min-w-0 flex flex-col gap-0.5">
      <div className="flex items-center gap-1 min-w-0">
        <Icon className={`h-3 w-3 shrink-0 ${iconColorClass || "text-slate-500"}`} />
        <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wider truncate">{label}</span>
      </div>
      <span className={`text-sm font-mono font-black leading-tight truncate ${colorClass || "text-slate-100"}`}>{value}</span>
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
      <div className="flex items-center gap-3 sm:gap-4 bg-gradient-to-b from-slate-900/80 to-slate-950/60 border border-slate-800 rounded-xl px-3 sm:px-5 py-3 sm:py-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-x-3 sm:gap-x-5 gap-y-3 flex-1 min-w-0">
          <StatBlock icon={Wallet} label="Toplam Portföy" value={`₺${fmt(account.total_portfolio_value)}`} iconColorClass="text-blue-300" />
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
          className="shrink-0 inline-flex items-center gap-1.5 h-10 px-3.5 rounded-lg bg-blue-500/10 border border-blue-500/30 text-blue-300 hover:bg-blue-500/20 text-xs font-bold transition-colors cursor-pointer"
        >
          <PlusCircle className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Bakiye Ekle</span>
        </button>
      </div>

      {showDeposit && <DepositModal onClose={() => setShowDeposit(false)} />}
    </>
  )
}
