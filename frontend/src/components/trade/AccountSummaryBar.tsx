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
  // Each stat is its own small rectangular card (bg-[#16171E]) rather than
  // plain inline text floating on the bar's background - reads as distinct
  // "tiles" instead of one crowded row, and gives the currency figure a
  // little breathing room so the ₺ glyph doesn't crowd the first digit.
  return (
    <div className="min-w-0 flex flex-col gap-1 rounded-lg bg-[#16171E] border border-white/5 px-2.5 py-2">
      <div className="flex items-center gap-1.5 min-w-0">
        <Icon className={`h-3 w-3 shrink-0 ${iconColorClass || "text-slate-500"}`} />
        <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider truncate">{label}</span>
      </div>
      <span className={`text-sm font-bold leading-tight truncate ${colorClass || "text-white"}`}>{value}</span>
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
      <div className="flex items-center gap-2 bg-[#101015] border border-white/5 rounded-xl p-2">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 flex-1 min-w-0">
          <StatBlock icon={Wallet} label="Toplam Portföy" value={`₺${fmt(account.total_portfolio_value)}`} iconColorClass="text-white" />
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
          className="shrink-0 inline-flex items-center gap-1.5 h-full self-stretch px-3.5 rounded-lg bg-[#16171E] border border-white/10 text-white hover:bg-[#232530] text-xs font-bold transition-colors cursor-pointer"
        >
          <PlusCircle className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Bakiye Ekle</span>
        </button>
      </div>

      {showDeposit && <DepositModal onClose={() => setShowDeposit(false)} />}
    </>
  )
}
