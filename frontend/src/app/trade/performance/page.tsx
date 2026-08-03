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

interface TaxYearRow {
  year: number
  stock_realized_pnl: number
  stock_trade_count: number
  stock_stopaj_estimate: number
  viop_realized_pnl: number
  viop_trade_count: number
  viop_stopaj_estimate: number
  total_realized_pnl: number
  total_stopaj_estimate: number
  net_after_stopaj_estimate: number
}

interface TaxReportData {
  stock_stopaj_pct: number
  viop_stopaj_pct: number
  years: TaxYearRow[]
}

function MetricCard({ label, value, colorClass }: { label: string; value: string; colorClass?: string }) {
  return (
    <div className="bg-[#16171E] border border-slate-800 rounded-xl p-4">
      <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">{label}</div>
      <div className={`text-lg font-black mt-1 ${colorClass || "text-white"}`}>{value}</div>
    </div>
  )
}

export default function TradePerformancePage() {
  const { account, activeAccountId, loading: accountLoading } = useTrade()
  const [data, setData] = useState<PerformanceData | null>(null)
  const [loading, setLoading] = useState(true)

  const [taxData, setTaxData] = useState<TaxReportData | null>(null)
  const [taxLoading, setTaxLoading] = useState(true)
  const [stockStopajPct, setStockStopajPct] = useState("0")
  const [viopStopajPct, setViopStopajPct] = useState("10")

  useEffect(() => {
    if (!account) return
    authFetch(`/trade/performance?account_id=${activeAccountId}`)
      .then(res => res.json())
      .then(d => setData(d))
      .catch(err => console.error("Failed to load trade performance:", err))
      .finally(() => setLoading(false))
  }, [account, activeAccountId])

  const loadTaxReport = React.useCallback(() => {
    if (!account) return
    setTaxLoading(true)
    const stockPct = parseFloat(stockStopajPct) || 0
    const viopPct = parseFloat(viopStopajPct) || 0
    authFetch(`/trade/tax-report?stock_stopaj_pct=${stockPct}&viop_stopaj_pct=${viopPct}&account_id=${activeAccountId}`)
      .then(res => res.json())
      .then(d => setTaxData(d))
      .catch(err => console.error("Failed to load tax report:", err))
      .finally(() => setTaxLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, activeAccountId])

  useEffect(() => {
    loadTaxReport()
  }, [loadTaxReport])

  if (accountLoading || loading) {
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-4rem)]">
        <Loader2 className="h-8 w-8 text-white animate-spin" />
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
        <Link href="/trade" className="text-slate-500 hover:text-white transition-colors">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="text-xl font-black tracking-tight text-white">Performans</h1>
      </div>

      <div className="bg-[#16171E] border border-slate-800 rounded-xl p-4">
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

      <div className="bg-[#16171E] border border-slate-800 rounded-xl p-4 space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">Vergi / Maliyet Raporu</div>
            <p className="text-[10px] text-slate-600 mt-1 max-w-md">
              Gerçekleşen kâr/zararınızın yıl bazında dökümü. Stopaj oranları resmi bir kaynak değildir - kendi
              tahmininizi girip güncelleyebilirsiniz; kesin oranlar için resmi kaynakları kontrol edin. Bu bir
              yatırım/vergi tavsiyesi değildir.
            </p>
          </div>
          <div className="flex items-end gap-3">
            <div>
              <label className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">Hisse Stopaj %</label>
              <input
                type="number"
                step="any"
                value={stockStopajPct}
                onChange={e => setStockStopajPct(e.target.value)}
                className="w-20 h-8 mt-1 px-2 rounded-md bg-[#1c1d26] border border-slate-800 text-xs font-bold text-white focus:outline-none focus:border-white/30"
              />
            </div>
            <div>
              <label className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">VİOP Stopaj %</label>
              <input
                type="number"
                step="any"
                value={viopStopajPct}
                onChange={e => setViopStopajPct(e.target.value)}
                className="w-20 h-8 mt-1 px-2 rounded-md bg-[#1c1d26] border border-slate-800 text-xs font-bold text-white focus:outline-none focus:border-white/30"
              />
            </div>
            <button
              onClick={loadTaxReport}
              disabled={taxLoading}
              className="h-8 px-3 rounded-md bg-white text-[#101015] text-[11px] font-bold cursor-pointer disabled:opacity-50"
            >
              {taxLoading ? "..." : "Hesapla"}
            </button>
          </div>
        </div>

        {taxLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 text-slate-500 animate-spin" />
          </div>
        ) : !taxData || taxData.years.length === 0 ? (
          <p className="text-[11px] text-slate-500 py-4 text-center">
            Henüz kapanmış bir işleminiz yok - gerçekleşen kâr/zarar burada birikecek.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="text-slate-400 font-bold border-b border-slate-800 h-8">
                  <th className="px-3">Yıl</th>
                  <th className="px-3 text-right">Hisse K/Z</th>
                  <th className="px-3 text-right">VİOP K/Z</th>
                  <th className="px-3 text-right">Toplam K/Z</th>
                  <th className="px-3 text-right">Tahmini Stopaj</th>
                  <th className="px-3 text-right">Stopaj Sonrası Net</th>
                </tr>
              </thead>
              <tbody>
                {taxData.years.map(row => (
                  <tr key={row.year} className="border-b border-slate-900 h-10">
                    <td className="px-3 font-bold text-white">{row.year}</td>
                    <td className={`px-3 text-right font-semibold ${row.stock_realized_pnl >= 0 ? "text-emerald-400" : "text-rose-500"}`}>
                      ₺{row.stock_realized_pnl.toFixed(2)}
                      <span className="text-slate-600 font-normal"> ({row.stock_trade_count})</span>
                    </td>
                    <td className={`px-3 text-right font-semibold ${row.viop_realized_pnl >= 0 ? "text-emerald-400" : "text-rose-500"}`}>
                      ₺{row.viop_realized_pnl.toFixed(2)}
                      <span className="text-slate-600 font-normal"> ({row.viop_trade_count})</span>
                    </td>
                    <td className={`px-3 text-right font-bold ${row.total_realized_pnl >= 0 ? "text-emerald-400" : "text-rose-500"}`}>
                      ₺{row.total_realized_pnl.toFixed(2)}
                    </td>
                    <td className="px-3 text-right text-slate-400">₺{row.total_stopaj_estimate.toFixed(2)}</td>
                    <td className="px-3 text-right font-bold text-white">₺{row.net_after_stopaj_estimate.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
