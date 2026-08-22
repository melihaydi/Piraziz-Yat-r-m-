"use client"

import React, { useEffect, useState } from "react"
import Link from "next/link"
import dynamic from "next/dynamic"
import { ArrowLeft, Loader2, FileDown } from "lucide-react"
import { authFetch } from "@/lib/auth"
import { useTrade } from "@/contexts/TradeContext"

// Equity eğrisi tembel yükleniyor - gerekçe bileşenin kendi başlığında.
const EquityCurveChart = dynamic(() => import("@/components/charts/EquityCurveChart"), {
  ssr: false,
  loading: () => (
    <div className="h-full flex items-center justify-center">
      <Loader2 className="h-6 w-6 text-muted-foreground animate-spin" />
    </div>
  ),
})

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
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider">{label}</div>
      <div className={`text-lg font-black mt-1 ${colorClass || "text-foreground"}`}>{value}</div>
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
  const [statementLoading, setStatementLoading] = useState(false)

  const handleDownloadStatement = async () => {
    setStatementLoading(true)
    try {
      const res = await authFetch(`/trade/statement?account_id=${activeAccountId}`)
      if (!res.ok) return
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `bip-terminal-ekstre-${new Date().toISOString().slice(0, 10)}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setStatementLoading(false)
    }
  }

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
    const stockPct = parseFloat(stockStopajPct.replace(",", ".")) || 0
    const viopPct = parseFloat(viopStopajPct.replace(",", ".")) || 0
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
        <Loader2 className="h-8 w-8 text-primary animate-spin" />
      </div>
    )
  }

  if (!account) {
    return (
      <div className="p-8 text-center text-sm text-muted-foreground">
        Önce Trade sekmesinden bir hesap oluşturmalısınız.
      </div>
    )
  }

  if (!data) {
    return <div className="p-8 text-center text-sm text-muted-foreground">Performans verileri alınamadı.</div>
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/trade" className="text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <h1 className="text-xl font-black tracking-tight text-foreground">Performans</h1>
        </div>
        <button
          onClick={handleDownloadStatement}
          disabled={statementLoading}
          className="flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-md border border-border bg-card text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors cursor-pointer disabled:opacity-50"
        >
          {statementLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />}
          PDF Ekstre İndir
        </button>
      </div>

      <div className="bg-card border border-border rounded-xl p-4">
        <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3">Equity Curve</div>
        <div className="h-64">
          <EquityCurveChart data={data.equity_curve} />
        </div>
        {data.equity_curve.length <= 1 && (
          <p className="text-[10px] text-muted-foreground/70 mt-2">
            Equity curve, hesabınız gün geçtikçe biriken gerçek günlük değerlerle dolacak.
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MetricCard label="Kazanma Oranı" value={`%${data.win_rate_pct.toFixed(1)}`} />
        <MetricCard
          label="Gerçekleşen Kâr"
          value={`₺${data.realized_pnl.toFixed(2)}`}
          colorClass={data.realized_pnl >= 0 ? "text-bull" : "text-bear"}
        />
        <MetricCard
          label="Gerçekleşmeyen Kâr"
          value={`₺${data.unrealized_pnl.toFixed(2)}`}
          colorClass={data.unrealized_pnl >= 0 ? "text-bull" : "text-bear"}
        />
        <MetricCard label="Maks. Düşüş (Drawdown)" value={`%${data.max_drawdown_pct.toFixed(2)}`} colorClass="text-bear" />
        <MetricCard label="Toplam İşlem" value={`${data.total_trades}`} />
        <MetricCard label="Kapanan İşlem" value={`${data.closed_trades}`} />
        <MetricCard label="Ortalama Kâr" value={`₺${data.avg_win.toFixed(2)}`} colorClass="text-bull" />
        <MetricCard label="Ortalama Zarar" value={`₺${data.avg_loss.toFixed(2)}`} colorClass="text-bear" />
      </div>

      <div className="bg-card border border-border rounded-xl p-4 space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Vergi / Maliyet Raporu</div>
            <p className="text-[10px] text-muted-foreground/70 mt-1 max-w-md">
              Gerçekleşen kâr/zararınızın yıl bazında dökümü. Stopaj oranları resmi bir kaynak değildir - kendi
              tahmininizi girip güncelleyebilirsiniz; kesin oranlar için resmi kaynakları kontrol edin. Bu bir
              yatırım/vergi tavsiyesi değildir.
            </p>
          </div>
          <div className="flex items-end gap-3">
            <div>
              <label className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider">Hisse Stopaj %</label>
              <input
                type="text"
                inputMode="decimal"
                value={stockStopajPct}
                onChange={e => setStockStopajPct(e.target.value)}
                className="w-20 h-8 mt-1 px-2 rounded-md bg-secondary border border-border text-xs font-bold text-foreground focus:outline-none focus:border-primary/40"
              />
            </div>
            <div>
              <label className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider">VİOP Stopaj %</label>
              <input
                type="text"
                inputMode="decimal"
                value={viopStopajPct}
                onChange={e => setViopStopajPct(e.target.value)}
                className="w-20 h-8 mt-1 px-2 rounded-md bg-secondary border border-border text-xs font-bold text-foreground focus:outline-none focus:border-primary/40"
              />
            </div>
            <button
              onClick={loadTaxReport}
              disabled={taxLoading}
              className="h-8 px-3 rounded-md bg-primary text-background text-[11px] font-bold cursor-pointer disabled:opacity-50"
            >
              {taxLoading ? "..." : "Hesapla"}
            </button>
          </div>
        </div>

        {taxLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 text-muted-foreground animate-spin" />
          </div>
        ) : !taxData || taxData.years.length === 0 ? (
          <p className="text-[11px] text-muted-foreground py-4 text-center">
            Henüz kapanmış bir işleminiz yok - gerçekleşen kâr/zarar burada birikecek.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="text-muted-foreground font-bold border-b border-border h-8">
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
                  <tr key={row.year} className="border-b border-border/60 h-10">
                    <td className="px-3 font-bold text-foreground">{row.year}</td>
                    <td className={`px-3 text-right font-semibold ${row.stock_realized_pnl >= 0 ? "text-bull" : "text-bear"}`}>
                      ₺{row.stock_realized_pnl.toFixed(2)}
                      <span className="text-muted-foreground/70 font-normal"> ({row.stock_trade_count})</span>
                    </td>
                    <td className={`px-3 text-right font-semibold ${row.viop_realized_pnl >= 0 ? "text-bull" : "text-bear"}`}>
                      ₺{row.viop_realized_pnl.toFixed(2)}
                      <span className="text-muted-foreground/70 font-normal"> ({row.viop_trade_count})</span>
                    </td>
                    <td className={`px-3 text-right font-bold ${row.total_realized_pnl >= 0 ? "text-bull" : "text-bear"}`}>
                      ₺{row.total_realized_pnl.toFixed(2)}
                    </td>
                    <td className="px-3 text-right text-muted-foreground">₺{row.total_stopaj_estimate.toFixed(2)}</td>
                    <td className="px-3 text-right font-bold text-foreground">₺{row.net_after_stopaj_estimate.toFixed(2)}</td>
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
