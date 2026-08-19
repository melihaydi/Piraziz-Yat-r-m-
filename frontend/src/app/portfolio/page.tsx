"use client"

import React, { useState, useEffect, useRef } from "react"
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid
} from "recharts"
import { 
  Plus,
  Bell,
  TrendingUp,
  TrendingDown,
  Briefcase,
  Trash2, 
  ToggleLeft, 
  ToggleRight,
  PieChart as PieIcon,
  Activity,
  Loader2,
  Sparkles,
  Zap,
  ChevronDown,
  DollarSign,
  Minus,
  History,
  Coins
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card"
import { Button } from "@/components/ui/Button"
import { Input } from "@/components/ui/Input"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger
} from "@/components/ui/Dialog"
import { authFetch } from "@/lib/auth"
import { pollWhileVisibleAndOpen } from "@/lib/usePolling"
import { parseTLAmount } from "@/lib/utils"
import { TickerLogo } from "@/components/ui/TickerLogo"

const COLORS = ["#a855f7", "#06b6d4", "#10b981", "#fbbf24", "#ec4899", "#f97316"]

// Hareket defteri tipleri (backend TRANSACTION_TYPES ile aynı).
const TX_LABELS: Record<string, string> = {
  BUY: "ALIŞ",
  SELL: "SATIŞ",
  DIVIDEND: "TEMETTÜ",
  BONUS: "BEDELSİZ",
}

function PortfolioStressTest({ beta, currentValue }: { beta: number | null; currentValue: number }) {
  const [scenario, setScenario] = useState(-10)

  if (beta == null) {
    return <p className="text-[11px] text-muted-foreground py-4 text-center">Beta hesaplanamadığı için stres testi yapılamıyor.</p>
  }

  const estimatedChangePct = beta * scenario
  const estimatedValue = currentValue * (1 + estimatedChangePct / 100)
  const estimatedDiff = estimatedValue - currentValue

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs font-bold">
        <span className="text-muted-foreground">XU100 senaryosu</span>
        <span className={scenario >= 0 ? "text-emerald-400" : "text-rose-500"}>{scenario >= 0 ? "+" : ""}{scenario}%</span>
      </div>
      <input
        type="range"
        min={-30}
        max={30}
        step={1}
        value={scenario}
        onChange={e => setScenario(Number(e.target.value))}
        className="w-full accent-purple-500 cursor-pointer"
      />
      <div className="flex items-center justify-between text-xs pt-1">
        <span className="text-muted-foreground">Tahmini portföy etkisi</span>
        <span className={`font-mono font-bold ${estimatedChangePct >= 0 ? "text-emerald-400" : "text-rose-500"}`}>
          {estimatedChangePct >= 0 ? "+" : ""}{estimatedChangePct.toFixed(1)}% (₺{estimatedDiff.toLocaleString("tr-TR", { maximumFractionDigits: 0 })})
        </span>
      </div>
      <p className="text-[11px] text-muted-foreground/70 leading-relaxed pt-1">
        Beta ({beta.toFixed(2)}) kullanılarak yapılan doğrusal bir yaklaşık tahmindir, kesin bir risk modeli değildir.
      </p>
    </div>
  )
}

export default function PortfolioPage() {
  const [portfolios, setPortfolios] = useState<any[]>([])
  const [alerts, setAlerts] = useState<any[]>([])
  const [analytics, setAnalytics] = useState<any>(null)
  const [analyticsLoading, setAnalyticsLoading] = useState(true)
  const [equityHistory, setEquityHistory] = useState<{ date: string; total_value: number }[]>([])
  const [equityHistoryLoading, setEquityHistoryLoading] = useState(true)
  const [loading, setLoading] = useState(true)
  const [liveEstimate, setLiveEstimate] = useState<any>(null)
  const [liveEstimateLoading, setLiveEstimateLoading] = useState(false)
  const [showLiveEstimate, setShowLiveEstimate] = useState(false)
  const [distributionTab, setDistributionTab] = useState<"hisse" | "sektor" | "tur">("hisse")

  // Guards the auto-create-default-portfolio POST below from firing twice
  // concurrently (e.g. loadData re-entering before the first POST resolves),
  // which previously created duplicate "Ana Portföyüm" portfolios.
  const autoCreatingDefaultRef = useRef(false)

  // Modal states
  const [isOpenAlertModal, setIsOpenAlertModal] = useState(false)
  const [isOpenAssetModal, setIsOpenAssetModal] = useState(false)
  const [isOpenEditModal, setIsOpenEditModal] = useState(false)
  const [isOpenSellModal, setIsOpenSellModal] = useState(false)
  const [selectedAsset, setSelectedAsset] = useState<any>(null)

  // New Alert state
  const [alertTicker, setAlertTicker] = useState("")
  const [alertType, setAlertType] = useState("price")
  const [alertCondition, setAlertCondition] = useState("")

  // New Asset state
  const [assetTicker, setAssetTicker] = useState("")
  const [assetShares, setAssetShares] = useState("")
  const [assetCost, setAssetCost] = useState("")

  // Edit/Sell states
  const [editShares, setEditShares] = useState("")
  const [editCost, setEditCost] = useState("")
  const [sellShares, setSellShares] = useState("")
  const [sellPrice, setSellPrice] = useState("")

  // Hareket geçmişi + gerçekleşen performans
  const [transactions, setTransactions] = useState<any[]>([])
  const [realized, setRealized] = useState<any>(null)
  const [isOpenHistoryModal, setIsOpenHistoryModal] = useState(false)
  const [isOpenDividendModal, setIsOpenDividendModal] = useState(false)
  const [dividendTicker, setDividendTicker] = useState("")
  const [dividendPerShare, setDividendPerShare] = useState("")
  const [dividendTax, setDividendTax] = useState("")

  // Surfaces a failure from any of the mutation handlers below (add/edit/
  // sell/delete asset, add/toggle/delete alert) - previously these only
  // checked `res.ok` with no `else`, so a validation error or an expired
  // session just silently did nothing and the modal sat there looking stuck.
  const [actionError, setActionError] = useState<string | null>(null)
  const flashActionError = (msg: string) => {
    setActionError(msg)
    setTimeout(() => setActionError(null), 5000)
  }

  const [usdCashAmount, setUsdCashAmount] = useState("")
  const [usdCashBusy, setUsdCashBusy] = useState(false)

  // sign: +1 deposit, -1 withdraw - user always types a positive amount,
  // this decides direction, same convention as
  // admin/managed-portfolios/page.tsx's adjustCash.
  const adjustUsdCash = async (sign: 1 | -1) => {
    if (!activePortfolio) return
    const parsed = parseTLAmount(usdCashAmount)
    if (!usdCashAmount || !Number.isFinite(parsed) || parsed <= 0) return
    setUsdCashBusy(true)
    try {
      const res = await authFetch(`/portfolio/${activePortfolio.id}/usd-cash`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: sign * parsed }),
      })
      if (res.ok) {
        setUsdCashAmount("")
        await loadCore()
      } else {
        const body = await res.json().catch(() => null)
        flashActionError(body?.detail || "Döviz nakti güncellenemedi.")
      }
    } catch (e) {
      flashActionError("Sunucuya ulaşılamadı.")
    } finally {
      setUsdCashBusy(false)
    }
  }

  // Load portfolios and alerts. AuthGate guarantees a valid session by the
  // time this page renders, so this just needs authFetch (lib/auth.ts),
  // which attaches the token and logs the session out on a 401 - no more
  // local login/register bootstrapping here (that previously even sent
  // {"role": "premium"} on self-registration, since fixed server-side too).
  //
  // Split into a fast "core" load (portfolios + alerts, plain DB reads) that
  // gates the page's main spinner, and a separate, slower analytics load
  // (/portfolio/analytics does real historical-price fetches per holding to
  // compute Beta/Sharpe) that runs independently with its own loading flag.
  // Previously analytics was awaited as a 3rd sequential step inside the
  // same function the main spinner depended on, so opening the page could
  // hang for many seconds (or fail to appear at all under TradingView rate
  // limiting) - the assets table, winners/losers, and alerts had no reason
  // to wait on that.
  const loadCore = async () => {
    try {
      const portRes = await authFetch("/portfolio/")
      if (portRes.ok) {
        const portData = await portRes.json()
        setPortfolios(portData)

        // Auto-create a default portfolio if user has none. Guarded so a
        // second overlapping loadData() call can't fire this POST again
        // before the first one resolves.
        if (portData.length === 0 && !autoCreatingDefaultRef.current) {
          autoCreatingDefaultRef.current = true
          try {
            const createRes = await authFetch("/portfolio/", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name: "Ana Portföyüm" })
            })
            if (createRes.ok) {
              const newPort = await createRes.json()
              setPortfolios([newPort])
            }
          } finally {
            autoCreatingDefaultRef.current = false
          }
        }
      }

      const alertRes = await authFetch("/alert/")
      if (alertRes.ok) {
        const alertData = await alertRes.json()
        setAlerts(alertData)
      }
    } catch (err) {
      console.error("Failed to load portfolio/alert data:", err)
    } finally {
      setLoading(false)
    }
  }

  const loadAnalytics = async () => {
    setAnalyticsLoading(true)
    try {
      const analyticsRes = await authFetch("/portfolio/analytics")
      if (analyticsRes.ok) {
        setAnalytics(await analyticsRes.json())
      }
    } catch (err) {
      console.error("Failed to load portfolio analytics:", err)
    } finally {
      setAnalyticsLoading(false)
    }
  }

  const loadEquityHistory = async () => {
    setEquityHistoryLoading(true)
    try {
      const historyRes = await authFetch("/portfolio/history")
      if (historyRes.ok) {
        const data = await historyRes.json()
        setEquityHistory(data.history || [])
      }
    } catch (err) {
      console.error("Failed to load portfolio equity history:", err)
    } finally {
      setEquityHistoryLoading(false)
    }
  }

  // Hareket defteri + gerçekleşen (kapatılmış) performans. Ayrı bir yükleme
  // olarak duruyor çünkü ikisi de düz DB okuması - ana spinner'ı bekletmeye
  // veya analytics'in yavaş fiyat çekmelerine bağlanmaya gerek yok.
  const loadLedger = async () => {
    try {
      const [txRes, realizedRes] = await Promise.all([
        authFetch("/portfolio/transactions?limit=200"),
        authFetch("/portfolio/realized"),
      ])
      if (txRes.ok) setTransactions(await txRes.json())
      if (realizedRes.ok) setRealized(await realizedRes.json())
    } catch (err) {
      console.error("Failed to load portfolio ledger:", err)
    }
  }

  const loadData = () => {
    loadCore()
    loadAnalytics()
    loadEquityHistory()
    loadLedger()
  }

  // Initial fetch shows a spinner; background refreshes (the interval
  // below, while the panel stays open) update silently without re-showing it.
  const fetchLiveEstimate = async (showSpinner: boolean) => {
    if (showSpinner) setLiveEstimateLoading(true)
    try {
      const res = await authFetch("/portfolio/live-estimate")
      if (res.ok) {
        setLiveEstimate(await res.json())
      }
    } catch (err) {
      console.error("Failed to load portfolio live estimate:", err)
    } finally {
      if (showSpinner) setLiveEstimateLoading(false)
    }
  }

  // The PANEL (full holdings breakdown) only opens on-demand (per user
  // request: "basayım" - "let me press [the button]") - but the summary
  // number itself (used for the small badge in the TOPLAM KÂR/ZARAR card)
  // is fetched silently on mount below, so it's visible without clicking.
  const handleToggleLiveEstimate = () => {
    setShowLiveEstimate(prev => {
      const next = !prev
      if (next) fetchLiveEstimate(true)
      return next
    })
  }

  useEffect(() => {
    loadData()
    fetchLiveEstimate(false)
    // Keeps the headline PORTFÖY DEĞERİ card (and fund holdings' estimate-
    // projected price) moving during the live session instead of only
    // reflecting whatever was true at page load. pollWhileVisible - stops
    // while the tab is hidden (see usePolling.ts).
    return pollWhileVisibleAndOpen(() => { loadCore(); fetchLiveEstimate(false) }, 15000)
  }, [])

  // Derive active portfolio (default to first one)
  const activePortfolio = portfolios[0] || null

  // Calculate stats
  const assetsList = activePortfolio ? activePortfolio.assets || [] : []
  const totalCost = activePortfolio ? activePortfolio.total_cost || 0.0 : 0.0
  const currentValue = activePortfolio ? activePortfolio.total_value || 0.0 : 0.0
  const totalProfit = activePortfolio ? activePortfolio.total_profit || 0.0 : 0.0
  const profitPercentage = activePortfolio ? activePortfolio.profit_percentage || 0.0 : 0.0
  const cashBalance = activePortfolio ? activePortfolio.cash_balance || 0.0 : 0.0
  const viopMargin = activePortfolio ? activePortfolio.viop_margin || 0.0 : 0.0
  const usdCashBalance = activePortfolio ? activePortfolio.usd_cash_balance || 0.0 : 0.0
  const usdCashValueTry = activePortfolio ? activePortfolio.usd_cash_value_try || 0.0 : 0.0

  // Portfolio-wide OFFICIAL daily gain (₺ + %) - aggregated from each
  // asset's official_daily_gain_value: a real live quote for stocks, the
  // real PUBLISHED TEFAS daily_return for funds (never the intraday
  // estimate - see portfolio.py's _official_daily_change_pct). This is the
  // "how much did I make TODAY" figure the all-time TOPLAM KÂR/ZARAR card
  // can't answer. Deliberately NOT the estimate-based daily_gain_value used
  // in the per-row assets table below (that one is fine there since it's
  // clearly labeled "tahmini" per row) - this headline figure must be
  // settled, official data only.
  const dailyGain = React.useMemo(() => {
    const known = assetsList.filter((a: any) => a.official_daily_gain_value != null)
    if (known.length === 0) return null
    const value = known.reduce((sum: number, a: any) => sum + a.official_daily_gain_value, 0)
    const yesterdayBase = known.reduce((sum: number, a: any) => sum + ((a.total_value || 0) - a.official_daily_gain_value), 0)
    const pct = yesterdayBase > 0 ? (value / yesterdayBase) * 100 : 0
    const isPartial = known.length < assetsList.length
    return { value, pct, isPartial }
  }, [assetsList])

  // Sector distribution for PieChart (Request 6!)
  const pieData = assetsList.map((item: any, index: number) => ({
    name: item.ticker,
    value: Math.round(item.total_value || 0),
    color: COLORS[index % COLORS.length]
  }))

  // Real sector/asset-type breakdown from the backend (computed from actual
  // holdings' sector map and fund-vs-stock classification, see
  // portfolio_analytics.py) - previously this was a 5-entry hardcoded ticker
  // map that silently lumped everything else into "Diğer / ETF".
  const sectorPieData = React.useMemo(() => {
    const rows = analytics?.sector_breakdown || []
    return rows.map((r: any, idx: number) => ({
      name: r.name,
      value: Math.round(r.value),
      color: COLORS[idx % COLORS.length]
    }))
  }, [analytics])

  const assetTypePieData = React.useMemo(() => {
    const rows = analytics?.asset_type_breakdown || []
    return rows.map((r: any, idx: number) => ({
      name: r.name,
      value: Math.round(r.value),
      color: COLORS[idx % COLORS.length]
    }))
  }, [analytics])

  const distributionData =
    distributionTab === "hisse" ? pieData : distributionTab === "sektor" ? sectorPieData : assetTypePieData

  // Winners/losers are real per-asset profit figures (unchanged). Sharpe/Beta/
  // volatility now come from `analytics` (real historical daily returns vs
  // XU100), not the old count-based formulas.
  const advancedMetrics = React.useMemo(() => {
    const sortedAssets = [...assetsList].sort((a, b) => (b.profit_percentage || 0) - (a.profit_percentage || 0))
    const winners = sortedAssets.filter(a => (a.total_profit || 0) > 0)
    const losers = sortedAssets.filter(a => (a.total_profit || 0) <= 0).reverse()

    const divScore = Math.min(40, assetsList.length * 8)
    const retScore = Math.min(30, Math.max(0, profitPercentage * 1.5))
    const healthScore = Math.min(100, Math.max(20, Math.round(divScore + retScore + 40)))

    return { winners, losers, healthScore }
  }, [assetsList, profitPercentage])

  // Add Asset Handler
  const handleAddAsset = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!activePortfolio || !assetTicker || !assetShares || !assetCost) return
    const shares = parseTLAmount(assetShares)
    const averageCost = parseTLAmount(assetCost)
    if (!Number.isFinite(shares) || !Number.isFinite(averageCost)) {
      flashActionError("Adet veya maliyet geçersiz - örn. 12,5 ya da 1.500,50 yazın.")
      return
    }

    try {
      const res = await authFetch(`/portfolio/${activePortfolio.id}/assets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker: assetTicker.toUpperCase(),
          shares,
          average_cost: averageCost
        })
      })
      if (res.ok) {
        setAssetTicker("")
        setAssetShares("")
        setAssetCost("")
        setIsOpenAssetModal(false)
        loadData() // Refresh
      } else {
        const body = await res.json().catch(() => null)
        flashActionError(body?.detail || "Varlık eklenemedi.")
      }
    } catch (err) {
      flashActionError("Sunucuya ulaşılamadı.")
    }
  }

  // Delete Asset Handler
  const handleDeleteAsset = async (assetId: number) => {
    try {
      const res = await authFetch(`/portfolio/assets/${assetId}`, { method: "DELETE" })
      if (res.ok) {
        loadData()
      } else {
        const body = await res.json().catch(() => null)
        flashActionError(body?.detail || "Varlık silinemedi.")
      }
    } catch (err) {
      flashActionError("Sunucuya ulaşılamadı.")
    }
  }

  // Edit Asset Handler
  const handleEditAsset = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedAsset || !editShares || !editCost) return
    const shares = parseTLAmount(editShares)
    const averageCost = parseTLAmount(editCost)
    if (!Number.isFinite(shares) || !Number.isFinite(averageCost)) {
      flashActionError("Adet veya maliyet geçersiz - örn. 12,5 ya da 1.500,50 yazın.")
      return
    }

    try {
      const res = await authFetch(`/portfolio/assets/${selectedAsset.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shares,
          average_cost: averageCost
        })
      })
      if (res.ok) {
        setIsOpenEditModal(false)
        setSelectedAsset(null)
        loadData()
      } else {
        const body = await res.json().catch(() => null)
        flashActionError(body?.detail || "Varlık güncellenemedi.")
      }
    } catch (err) {
      flashActionError("Sunucuya ulaşılamadı.")
    }
  }

  // Sell Asset Handler
  const handleSellAsset = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedAsset || !sellShares) return
    const shares = parseTLAmount(sellShares)
    if (!Number.isFinite(shares)) {
      flashActionError("Adet geçersiz - örn. 12,5 yazın.")
      return
    }
    // Satış fiyatı gerçekleşen kâr/zararın hesaplandığı yer - boş
    // bırakılırsa backend anlık fiyatı kullanır ("piyasadan sattım").
    const price = sellPrice.trim() ? parseTLAmount(sellPrice) : null
    if (price !== null && (!Number.isFinite(price) || price <= 0)) {
      flashActionError("Satış fiyatı geçersiz - örn. 312,50 yazın.")
      return
    }

    try {
      const res = await authFetch(`/portfolio/assets/${selectedAsset.id}/sell`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shares,
          ...(price !== null ? { price } : {}),
        })
      }, 0) // never silently retry a sell on a network failure - could double-sell
      if (res.ok) {
        setIsOpenSellModal(false)
        setSelectedAsset(null)
        setSellShares("")
        setSellPrice("")
        loadData()
      } else {
        const body = await res.json().catch(() => null)
        flashActionError(body?.detail || "Satış gerçekleştirilemedi.")
      }
    } catch (err) {
      flashActionError("Sunucuya ulaşılamadı.")
    }
  }

  // Temettü kaydı - pozisyonun lotunu/maliyetini değiştirmez, sadece
  // gelir olarak deftere yazılır (bkz. backend portfolio_ledger).
  const handleAddDividend = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!activePortfolio || !dividendTicker || !dividendPerShare) return

    const perShare = parseTLAmount(dividendPerShare)
    if (!Number.isFinite(perShare) || perShare <= 0) {
      flashActionError("Lot başına temettü geçersiz - örn. 2,50 yazın.")
      return
    }
    const tax = dividendTax.trim() ? parseTLAmount(dividendTax) : 0
    if (!Number.isFinite(tax) || tax < 0) {
      flashActionError("Stopaj tutarı geçersiz.")
      return
    }

    try {
      const res = await authFetch(`/portfolio/${activePortfolio.id}/dividends`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker: dividendTicker.toUpperCase(),
          per_share: perShare,
          tax,
        })
      }, 0)
      if (res.ok) {
        setIsOpenDividendModal(false)
        setDividendTicker("")
        setDividendPerShare("")
        setDividendTax("")
        loadData()
      } else {
        const body = await res.json().catch(() => null)
        flashActionError(body?.detail || "Temettü kaydedilemedi.")
      }
    } catch (err) {
      flashActionError("Sunucuya ulaşılamadı.")
    }
  }

  // Add Alert Handler
  const handleAddAlert = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!alertTicker || !alertCondition) return

    // Parse UI string (e.g. "> 310") into structured Dict for backend
    const match = alertCondition.trim().match(/^([><=]+)\s*([\d.]+)/)
    const operator = match ? match[1] : ">"
    const value = match ? parseFloat(match[2]) : parseFloat(alertCondition) || 0.0

    try {
      const res = await authFetch(`/alert/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker: alertTicker.toUpperCase(),
          alert_type: alertType,
          trigger_condition: { operator, value }
        })
      })
      if (res.ok) {
        setAlertTicker("")
        setAlertCondition("")
        setIsOpenAlertModal(false)
        loadData()
      } else {
        const body = await res.json().catch(() => null)
        flashActionError(body?.detail || "Alarm oluşturulamadı.")
      }
    } catch (err) {
      flashActionError("Sunucuya ulaşılamadı.")
    }
  }

  // Toggle Alert Status Handler
  const handleToggleAlert = async (id: number) => {
    try {
      const res = await authFetch(`/alert/${id}/toggle`, { method: "POST" })
      if (res.ok) {
        loadData()
      } else {
        const body = await res.json().catch(() => null)
        flashActionError(body?.detail || "Alarm güncellenemedi.")
      }
    } catch (err) {
      flashActionError("Sunucuya ulaşılamadı.")
    }
  }

  // Delete Alert Handler
  const handleDeleteAlert = async (id: number) => {
    try {
      const res = await authFetch(`/alert/${id}`, { method: "DELETE" })
      if (res.ok) {
        loadData()
      } else {
        const body = await res.json().catch(() => null)
        flashActionError(body?.detail || "Alarm silinemedi.")
      }
    } catch (err) {
      flashActionError("Sunucuya ulaşılamadı.")
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-48 space-y-4">
        <Loader2 className="h-10 w-10 text-primary animate-spin" />
        <span className="text-sm text-muted-foreground font-semibold">Portföy Canlı Verileri Derleniyor...</span>
      </div>
    )
  }

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {actionError && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-950/30 px-4 py-3 text-sm font-semibold text-rose-400 flex items-center justify-between gap-3">
          <span>{actionError}</span>
          <button onClick={() => setActionError(null)} className="text-rose-400/70 hover:text-rose-300 cursor-pointer shrink-0">✕</button>
        </div>
      )}
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Portföy ve Alarm Sistemi</h1>
          <p className="text-muted-foreground mt-1">Maliyet hesaplaması, sektör dağılımları ve TradingView tetikleyici alarmlar.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button
            variant="outline"
            className="cursor-pointer flex items-center"
            onClick={() => setIsOpenHistoryModal(true)}
          >
            <History className="h-4 w-4 mr-2 text-cyan-400" />
            İşlem Geçmişi
          </Button>
          <Button
            variant="outline"
            className="cursor-pointer flex items-center"
            onClick={() => setIsOpenDividendModal(true)}
          >
            <Coins className="h-4 w-4 mr-2 text-amber-400" />
            Temettü Ekle
          </Button>
          {/* Create Alarm Dialog */}
          <Dialog open={isOpenAlertModal} onOpenChange={setIsOpenAlertModal}>
            <DialogTrigger asChild>
              <Button variant="outline" className="cursor-pointer flex items-center">
                <Bell className="h-4 w-4 mr-2 text-purple-400" />
                Alarm Kur
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
              <DialogHeader>
                <DialogTitle>Yeni Alarm Oluştur</DialogTitle>
                <DialogDescription>
                  Fiyat veya teknik indikatörler belirtilen seviyeye geldiğinde anlık bildirim alın.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleAddAlert} className="space-y-4 py-4">
                <div className="grid grid-cols-3 items-center gap-4">
                  <label className="text-sm font-semibold text-muted-foreground text-right">Hisse Kodu</label>
                  <Input 
                    value={alertTicker}
                    onChange={(e) => setAlertTicker(e.target.value)}
                    placeholder="THYAO" 
                    className="col-span-2 bg-secondary/50" 
                    required 
                  />
                </div>
                <div className="grid grid-cols-3 items-center gap-4">
                  <label className="text-sm font-semibold text-muted-foreground text-right">Kriter</label>
                  <select 
                    value={alertType}
                    onChange={(e) => setAlertType(e.target.value)}
                    className="col-span-2 h-9 rounded-md border border-input bg-secondary px-3 text-sm focus-visible:outline-none"
                  >
                    <option value="price">Fiyat</option>
                    <option value="rsi">RSI (14)</option>
                    <option value="macd">MACD Kesişimi</option>
                  </select>
                </div>
                <div className="grid grid-cols-3 items-center gap-4">
                  <label className="text-sm font-semibold text-muted-foreground text-right">Koşul</label>
                  <Input 
                    value={alertCondition}
                    onChange={(e) => setAlertCondition(e.target.value)}
                    placeholder="Ör: > 310.50 veya < 120" 
                    className="col-span-2 bg-secondary/50" 
                    required
                  />
                </div>
                <DialogFooter className="pt-4 border-t border-border/50">
                  <Button type="submit" className="w-full cursor-pointer">Alarmı Kaydet</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>

          {/* Add Asset Dialog */}
          <Dialog open={isOpenAssetModal} onOpenChange={setIsOpenAssetModal}>
            <DialogTrigger asChild>
              <Button variant="default" className="cursor-pointer flex items-center">
                <Plus className="h-4 w-4 mr-2" />
                Varlık Ekle
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
              <DialogHeader>
                <DialogTitle>Portföye Varlık (Hisse veya Fon) Ekle</DialogTitle>
                <DialogDescription>
                  Portföyünüze yeni hisse senedi (örn: THYAO) veya TEFAS yatırım fonu (örn: PHE, THF) ekleyin.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleAddAsset} className="space-y-4 py-4">
                <div className="grid grid-cols-3 items-center gap-4">
                  <label className="text-sm font-semibold text-muted-foreground text-right">Hisse veya Fon Kodu</label>
                  <Input
                    value={assetTicker}
                    onChange={(e) => setAssetTicker(e.target.value)}
                    placeholder="THYAO veya PHE"
                    className="col-span-2 bg-secondary/50"
                    required
                  />
                </div>
                {/* Döviz/altın hızlı seçim - USDTRY/XAUTRYG gerçek ticker
                    kodları (market_data_service'te canlı takip ediliyor),
                    ezbere bilinmesin diye kısayol. */}
                <div className="grid grid-cols-3 items-center gap-4">
                  <span />
                  <div className="col-span-2 flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => setAssetTicker("USDTRY")}
                      className="h-7 px-2 rounded-md border border-input bg-secondary/40 text-xs font-bold text-muted-foreground hover:text-foreground hover:border-emerald-500/40 cursor-pointer"
                    >
                      USD/TRY
                    </button>
                    <button
                      type="button"
                      onClick={() => setAssetTicker("XAUTRYG")}
                      className="h-7 px-2 rounded-md border border-input bg-secondary/40 text-xs font-bold text-muted-foreground hover:text-foreground hover:border-amber-500/40 cursor-pointer"
                    >
                      Gram Altın
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-3 items-center gap-4">
                  <label className="text-sm font-semibold text-muted-foreground text-right">Adet (Lot)</label>
                  <Input
                    type="text"
                    inputMode="decimal"
                    value={assetShares}
                    onChange={(e) => setAssetShares(e.target.value)}
                    placeholder="100"
                    className="col-span-2 bg-secondary/50"
                    required
                  />
                </div>
                <div className="grid grid-cols-3 items-center gap-4">
                  <label className="text-sm font-semibold text-muted-foreground text-right">Ort. Maliyet</label>
                  <Input
                    type="text"
                    inputMode="decimal"
                    value={assetCost}
                    onChange={(e) => setAssetCost(e.target.value)}
                    placeholder="312,50"
                    className="col-span-2 bg-secondary/50"
                    required
                  />
                </div>
                <DialogFooter className="pt-4 border-t border-border/50">
                  <Button type="submit" className="w-full cursor-pointer">Portföye Ekle</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>

          {/* Edit Asset Dialog */}
          <Dialog open={isOpenEditModal} onOpenChange={setIsOpenEditModal}>
            <DialogContent className="sm:max-w-[425px]">
              <DialogHeader>
                <DialogTitle>Varlığı Düzenle ({selectedAsset?.ticker})</DialogTitle>
                <DialogDescription>
                  Hisse adedini ve ortalama maliyetinizi güncelleyin.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleEditAsset} className="space-y-4 py-4">
                <div className="grid grid-cols-3 items-center gap-4">
                  <label className="text-sm font-semibold text-muted-foreground text-right">Adet (Lot)</label>
                  <Input
                    type="text"
                    inputMode="decimal"
                    value={editShares}
                    onChange={(e) => setEditShares(e.target.value)}
                    placeholder="12,5"
                    className="col-span-2 bg-secondary/50"
                    required
                  />
                </div>
                <div className="grid grid-cols-3 items-center gap-4">
                  <label className="text-sm font-semibold text-muted-foreground text-right">Ort. Maliyet</label>
                  <Input
                    type="text"
                    inputMode="decimal"
                    value={editCost}
                    onChange={(e) => setEditCost(e.target.value)}
                    placeholder="1.500,50"
                    className="col-span-2 bg-secondary/50"
                    required
                  />
                </div>
                <DialogFooter className="pt-4 border-t border-border/50">
                  <Button type="submit" className="w-full cursor-pointer">Değişiklikleri Kaydet</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>

          {/* Sell Asset Dialog */}
          <Dialog open={isOpenSellModal} onOpenChange={setIsOpenSellModal}>
            <DialogContent className="sm:max-w-[425px]">
              <DialogHeader>
                <DialogTitle>Hisse Satışı ({selectedAsset?.ticker})</DialogTitle>
                <DialogDescription>
                  Satılacak lot miktarını ve satış fiyatını girin. Gerçekleşen
                  kâr/zarar bu fiyata göre hesaplanıp işlem geçmişinize kaydedilir.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleSellAsset} className="space-y-4 py-4">
                <div className="grid grid-cols-3 items-center gap-4">
                  <label className="text-sm font-semibold text-muted-foreground text-right">Satılacak Adet</label>
                  <Input
                    type="text"
                    inputMode="decimal"
                    value={sellShares}
                    onChange={(e) => setSellShares(e.target.value)}
                    placeholder={`Maks: ${selectedAsset?.shares ?? 0}`}
                    className="col-span-2 bg-secondary/50"
                    required
                  />
                </div>
                <div className="grid grid-cols-3 items-center gap-4">
                  <label className="text-sm font-semibold text-muted-foreground text-right">Satış Fiyatı</label>
                  <Input
                    type="text"
                    inputMode="decimal"
                    value={sellPrice}
                    onChange={(e) => setSellPrice(e.target.value)}
                    placeholder={selectedAsset?.current_price ? `Anlık: ${selectedAsset.current_price.toFixed(2)}` : "Boş = anlık fiyat"}
                    className="col-span-2 bg-secondary/50"
                  />
                </div>
                {selectedAsset && sellShares && sellPrice && (() => {
                  const s = parseTLAmount(sellShares)
                  const p = parseTLAmount(sellPrice)
                  if (!Number.isFinite(s) || !Number.isFinite(p)) return null
                  const pnl = (p - (selectedAsset.average_cost || 0)) * s
                  return (
                    <p className={`text-xs font-bold text-center ${pnl >= 0 ? "text-emerald-400" : "text-rose-500"}`}>
                      Tahmini gerçekleşen K/Z: {pnl >= 0 ? "+" : ""}₺
                      {pnl.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                  )
                })()}
                <DialogFooter className="pt-4 border-t border-border/50">
                  <Button type="submit" variant="destructive" className="w-full cursor-pointer">Satışı Gerçekleştir</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>

          {/* Temettü kaydı */}
          <Dialog open={isOpenDividendModal} onOpenChange={setIsOpenDividendModal}>
            <DialogContent className="sm:max-w-[425px]">
              <DialogHeader>
                <DialogTitle>Temettü Ekle</DialogTitle>
                <DialogDescription>
                  Aldığınız temettüyü kaydedin. Pozisyonunuz değişmez; sadece
                  gelir olarak işlenir ve toplam getirinize eklenir.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleAddDividend} className="space-y-4 py-4">
                <div className="grid grid-cols-3 items-center gap-4">
                  <label className="text-sm font-semibold text-muted-foreground text-right">Hisse</label>
                  <Input
                    value={dividendTicker}
                    onChange={(e) => setDividendTicker(e.target.value.toUpperCase())}
                    placeholder="Örn: THYAO"
                    className="col-span-2 bg-secondary/50 uppercase"
                    required
                  />
                </div>
                <div className="grid grid-cols-3 items-center gap-4">
                  <label className="text-sm font-semibold text-muted-foreground text-right">Lot Başına</label>
                  <Input
                    type="text"
                    inputMode="decimal"
                    value={dividendPerShare}
                    onChange={(e) => setDividendPerShare(e.target.value)}
                    placeholder="Örn: 2,50"
                    className="col-span-2 bg-secondary/50"
                    required
                  />
                </div>
                <div className="grid grid-cols-3 items-center gap-4">
                  <label className="text-sm font-semibold text-muted-foreground text-right">Stopaj</label>
                  <Input
                    type="text"
                    inputMode="decimal"
                    value={dividendTax}
                    onChange={(e) => setDividendTax(e.target.value)}
                    placeholder="Opsiyonel"
                    className="col-span-2 bg-secondary/50"
                  />
                </div>
                <p className="text-[11px] text-muted-foreground text-center">
                  Lot adedi portföyünüzdeki mevcut pozisyondan alınır.
                </p>
                <DialogFooter className="pt-4 border-t border-border/50">
                  <Button type="submit" className="w-full cursor-pointer">Temettüyü Kaydet</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>

          {/* İşlem geçmişi */}
          <Dialog open={isOpenHistoryModal} onOpenChange={setIsOpenHistoryModal}>
            <DialogContent className="sm:max-w-[720px]">
              <DialogHeader>
                <DialogTitle>İşlem Geçmişi</DialogTitle>
                <DialogDescription>
                  Portföyünüzdeki tüm hareketler - alış, satış, temettü ve bedelsiz.
                </DialogDescription>
              </DialogHeader>
              <div className="max-h-[60vh] overflow-y-auto overflow-x-auto py-2">
                {transactions.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    Henüz kayıtlı hareket yok. Bundan sonraki alış, satış ve
                    temettüleriniz burada listelenecek.
                  </p>
                ) : (
                  <table className="w-full text-xs">
                    <thead className="text-muted-foreground border-b border-border/50">
                      <tr>
                        <th className="text-left py-2 font-semibold">Tarih</th>
                        <th className="text-left py-2 font-semibold">Tip</th>
                        <th className="text-left py-2 font-semibold">Hisse</th>
                        <th className="text-right py-2 font-semibold">Adet</th>
                        <th className="text-right py-2 font-semibold">Fiyat</th>
                        <th className="text-right py-2 font-semibold">Tutar</th>
                        <th className="text-right py-2 font-semibold">K/Z</th>
                      </tr>
                    </thead>
                    <tbody className="font-mono">
                      {transactions.map((t) => (
                        <tr key={t.id} className="border-b border-border/20">
                          <td className="py-2 whitespace-nowrap">
                            {new Date(t.executed_at).toLocaleDateString("tr-TR")}
                          </td>
                          <td className="py-2">
                            <span className={`px-1.5 py-0.5 rounded font-sans font-bold text-[10px] ${
                              t.transaction_type === "BUY" ? "bg-emerald-500/15 text-emerald-400"
                              : t.transaction_type === "SELL" ? "bg-rose-500/15 text-rose-400"
                              : t.transaction_type === "DIVIDEND" ? "bg-amber-500/15 text-amber-400"
                              : "bg-cyan-500/15 text-cyan-400"
                            }`}>
                              {TX_LABELS[t.transaction_type] || t.transaction_type}
                            </span>
                          </td>
                          <td className="py-2 font-bold">{t.ticker}</td>
                          <td className="py-2 text-right">{t.shares.toLocaleString("tr-TR")}</td>
                          <td className="py-2 text-right">
                            {t.transaction_type === "BONUS" ? "-" : `₺${t.price.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                          </td>
                          <td className="py-2 text-right">
                            {t.transaction_type === "BONUS" ? "-" : `₺${t.amount.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                          </td>
                          <td className={`py-2 text-right font-bold ${
                            t.realized_pnl == null ? "text-muted-foreground"
                            : t.realized_pnl >= 0 ? "text-emerald-400" : "text-rose-500"
                          }`}>
                            {t.realized_pnl == null ? "-"
                              : `${t.realized_pnl >= 0 ? "+" : ""}₺${t.realized_pnl.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Metrics Summary Row (Request 6!) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card glass={true}>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground font-semibold uppercase">PORTFÖY DEĞERİ</span>
              <Briefcase className="h-4 w-4 text-purple-400" />
            </div>
            <div className="mt-2 flex items-baseline space-x-2">
              <span className="text-3xl font-extrabold font-mono text-foreground">
                ₺{currentValue.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
            {dailyGain && (
              <p className={`text-xs font-bold mt-1 flex items-center gap-1 ${dailyGain.value >= 0 ? "text-emerald-400" : "text-rose-500"}`}>
                {dailyGain.value >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                Bugün: {dailyGain.value >= 0 ? "+" : ""}₺{dailyGain.value.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                {" "}({dailyGain.value >= 0 ? "+" : ""}{dailyGain.pct.toFixed(2)}%)
                {dailyGain.isPartial && <span className="text-muted-foreground font-normal">(kısmi)</span>}
              </p>
            )}
            <p className="text-xs text-muted-foreground mt-1">Toplam Maliyet: ₺{totalCost.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            {(cashBalance > 0 || viopMargin > 0) && (
              // Admin-managed balances (Yönetilen Portföyler'den eklenir) -
              // read-only here, just surfaced so a deposit/teminat an admin
              // enters actually shows up somewhere on this page instead of
              // silently only affecting the totals above with no visible
              // line item (previously this endpoint didn't even return
              // these fields, so they never showed up at all). Döviz Nakit
              // (USD) has its own self-service module below instead of
              // being shown here, since the user can add/withdraw it
              // themselves.
              <p className="text-xs text-muted-foreground mt-0.5">
                {cashBalance > 0 && <>Nakit: ₺{cashBalance.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</>}
                {cashBalance > 0 && viopMargin > 0 && " · "}
                {viopMargin > 0 && <>VİOP Teminatı: ₺{viopMargin.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</>}
              </p>
            )}
            <button
              onClick={handleToggleLiveEstimate}
              className="mt-2 flex items-center gap-1 text-xs font-semibold text-amber-400 hover:text-amber-300 transition-colors cursor-pointer"
            >
              <Zap className="h-3 w-3" />
              Tahmini Getiri
              <ChevronDown className={`h-3 w-3 transition-transform ${showLiveEstimate ? "rotate-180" : ""}`} />
            </button>
          </CardContent>
        </Card>

        <Card glass={true}>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground font-semibold uppercase">TOPLAM KÂR / ZARAR</span>
              <TrendingUp className="h-4 w-4 text-emerald-400" />
            </div>
            <div className="mt-2 flex items-baseline space-x-2">
              <span className={`text-3xl font-extrabold font-mono ${totalProfit >= 0 ? "text-emerald-400" : "text-rose-500"}`}>
                {totalProfit >= 0 ? "+" : ""}₺{totalProfit.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
              <span className={`text-sm font-semibold ${totalProfit >= 0 ? "text-emerald-400" : "text-rose-500"}`}>
                ({profitPercentage.toFixed(2)}%)
              </span>
            </div>
            <p className="text-xs text-emerald-500/80 mt-1 font-semibold">Tüm zamanların en yüksek seviyesinde</p>
            {liveEstimate?.estimated_daily_gain_value != null && (
              <p className="inline-flex items-center gap-1 text-xs font-bold mt-2 px-2 py-1 rounded-md bg-orange-500/10 border border-orange-500/25 text-orange-400">
                <Zap className="h-3 w-3 shrink-0" />
                Bugün (tahmini): {liveEstimate.estimated_daily_gain_value >= 0 ? "+" : ""}
                ₺{liveEstimate.estimated_daily_gain_value.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                {" "}({liveEstimate.estimated_change_pct >= 0 ? "+" : ""}{liveEstimate.estimated_change_pct.toFixed(2)}%)
              </p>
            )}
          </CardContent>
        </Card>

        <Card glass={true}>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground font-semibold uppercase">BETA / VOLATİLİTE</span>
              <Activity className="h-4 w-4 text-cyan-400" />
            </div>
            <div className="mt-2 flex items-baseline space-x-2">
              {analyticsLoading ? (
                <Loader2 className="h-5 w-5 text-muted-foreground animate-spin" />
              ) : (
                <>
                  <span className="text-3xl font-extrabold font-mono text-foreground">
                    {analytics?.beta != null ? analytics.beta.toFixed(2) : "—"}
                  </span>
                  <span className="text-xs text-muted-foreground font-medium">
                    Vol: {analytics?.volatility_pct != null ? `%${analytics.volatility_pct}` : "—"}
                  </span>
                </>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {analyticsLoading ? "Hesaplanıyor..." : analytics?.risk_metrics_note || "Son 6 aylık gerçek getiri verisiyle (XU100'e göre) hesaplandı"}
            </p>
          </CardContent>
        </Card>

        <Card glass={true} className="border-purple-500/15">
          <CardContent className="pt-6 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground font-semibold uppercase">PORTFÖY SAĞLIĞI</span>
              <Sparkles className="h-4 w-4 text-purple-400" />
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-2xl font-black text-foreground">
                {advancedMetrics.healthScore} <span className="text-xs text-muted-foreground font-bold">/100</span>
              </span>
              <span className="text-xs font-bold text-purple-400 font-mono">
                Sharpe: {analyticsLoading ? "…" : analytics?.sharpe != null ? analytics.sharpe.toFixed(2) : "—"}
              </span>
            </div>
            <div className="w-full bg-secondary/40 h-2.5 rounded-full overflow-hidden border border-border/30">
              <div 
                className="bg-gradient-to-r from-purple-500 to-indigo-500 h-full rounded-full transition-all duration-500" 
                style={{ width: `${advancedMetrics.healthScore}%` }}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Gerçekleşen (kapatılmış) performans - yukarıdaki kartların
          gösterdiği "şu an elimdekinin kârı"ndan AYRI bir şey: satılıp
          bitmiş işlerden kalan kâr/zarar ve cebe giren temettü. İkisi
          birbirine karıştırılmamalı, bu yüzden kendi şeridinde duruyor. */}
      {realized && (realized.sell_count > 0 || realized.dividend_count > 0) && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-border/50 bg-secondary/20 px-3 py-2.5">
          <div className="flex items-center gap-2 shrink-0">
            <History className="h-4 w-4 text-cyan-400" />
            <span className="text-xs font-bold uppercase text-muted-foreground">Gerçekleşen</span>
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-[11px] text-muted-foreground font-semibold">Satışlardan:</span>
            <span className={`text-sm font-extrabold font-mono ${realized.realized_pnl >= 0 ? "text-emerald-400" : "text-rose-500"}`}>
              {realized.realized_pnl >= 0 ? "+" : ""}₺{realized.realized_pnl.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <span className="text-[11px] text-muted-foreground">({realized.sell_count} satış)</span>
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-[11px] text-muted-foreground font-semibold">Temettü:</span>
            <span className="text-sm font-extrabold font-mono text-amber-400">
              ₺{realized.dividend_income.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-[11px] text-muted-foreground font-semibold">Toplam:</span>
            <span className={`text-sm font-extrabold font-mono ${realized.total_realized >= 0 ? "text-emerald-400" : "text-rose-500"}`}>
              {realized.total_realized >= 0 ? "+" : ""}₺{realized.total_realized.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
          <button
            onClick={() => setIsOpenHistoryModal(true)}
            className="text-[11px] font-bold text-cyan-400 hover:text-cyan-300 cursor-pointer ml-auto"
          >
            Tümünü gör →
          </button>
        </div>
      )}

      {/* Döviz Nakit (USD) - self-service, unlike Nakit/VİOP Teminatı above
          (still admin-only via Yönetilen Portföyler for now). Stored in raw
          dollars; the TL figure is the backend's LIVE conversion computed
          on every load, not a fixed snapshot from deposit time - it moves
          with USD/TRY on refresh. Gram altın is added the normal way
          through "Varlık Ekle" below (it has its own live price/P&L to
          track, unlike plain parked cash). */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/50 bg-secondary/20 px-3 py-2.5">
        <DollarSign className="h-4 w-4 text-sky-400 shrink-0" />
        <span className="text-xs font-bold uppercase text-muted-foreground shrink-0">Döviz Nakit (USD)</span>
        <span className="text-sm font-extrabold font-mono text-foreground mr-1">
          ${usdCashBalance.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          <span className="text-xs font-semibold text-muted-foreground ml-1">(₺{usdCashValueTry.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })})</span>
        </span>
        <Input
          value={usdCashAmount}
          onChange={e => setUsdCashAmount(e.target.value)}
          placeholder="Tutar ($) örn. 220"
          className="h-8 w-28 text-xs"
        />
        <Button
          type="button"
          onClick={() => adjustUsdCash(1)}
          disabled={usdCashBusy || !usdCashAmount}
          className="h-8 cursor-pointer bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 text-[11px] font-bold px-2.5"
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          Ekle
        </Button>
        <Button
          type="button"
          onClick={() => adjustUsdCash(-1)}
          disabled={usdCashBusy || !usdCashAmount}
          className="h-8 cursor-pointer bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 text-[11px] font-bold px-2.5"
        >
          <Minus className="h-3.5 w-3.5 mr-1" />
          Çıkar
        </Button>
      </div>

      {showLiveEstimate && (
        <Card glass={true} className="border-amber-500/20">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Zap className="h-5 w-5 text-amber-400" />
              Tahmini Portföy Getirisi
            </CardTitle>
            <CardDescription>
              Elinizdeki fonların son bilinen varlık dağılımı ile hisselerin canlı fiyat değişimi ağırlıklandırılarak
              hesaplanan tahmini gün-içi getiri. Gerçek bir NAV yeniden hesaplaması değildir.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {liveEstimateLoading ? (
              <div className="h-24 flex items-center justify-center">
                <Loader2 className="h-6 w-6 text-muted-foreground animate-spin" />
              </div>
            ) : !liveEstimate || liveEstimate.estimated_change_pct == null ? (
              <p className="text-sm text-muted-foreground">
                Şu an için tahmini getiri hesaplanamadı (kapsam yetersiz veya portföy boş).
              </p>
            ) : (
              <>
                <div className="flex items-baseline gap-3 mb-4">
                  <span className="text-3xl font-extrabold font-mono text-orange-400">
                    {liveEstimate.estimated_change_pct >= 0 ? "+" : ""}{liveEstimate.estimated_change_pct.toFixed(2)}%
                  </span>
                  <span className="text-xs text-muted-foreground font-medium">
                    kapsam %{liveEstimate.resolved_value_pct} · toplam değer ₺{liveEstimate.total_value.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                  {liveEstimate.holdings.map((h: any) => (
                    <div key={h.ticker} className="flex items-center justify-between text-xs py-1.5 px-2 rounded-md bg-secondary/30">
                      <span className="font-semibold text-foreground">{h.ticker}</span>
                      <span className="text-muted-foreground">₺{h.value.toLocaleString("tr-TR", { maximumFractionDigits: 0 })}</span>
                      <span className={h.change_pct == null ? "text-muted-foreground" : h.change_pct >= 0 ? "text-emerald-400 font-semibold" : "text-rose-500 font-semibold"}>
                        {h.change_pct == null ? "—" : `${h.change_pct >= 0 ? "+" : ""}${h.change_pct.toFixed(2)}%`}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Grid Layout: Assets table vs Distribution & Alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Assets List Table */}
        <div className="lg:col-span-2 space-y-8">
          <Card glass={true}>
            <CardHeader>
              <CardTitle className="text-lg">Portföy Değeri (Zaman İçinde)</CardTitle>
              <CardDescription>Her gün bir kez kaydedilen gerçek toplam portföy değeriniz</CardDescription>
            </CardHeader>
            <CardContent>
              {equityHistoryLoading ? (
                <div className="h-56 flex items-center justify-center">
                  <Loader2 className="h-6 w-6 text-muted-foreground animate-spin" />
                </div>
              ) : (
                <>
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={equityHistory}>
                        <defs>
                          <linearGradient id="portfolioEquityGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#a855f7" stopOpacity={0.4} />
                            <stop offset="95%" stopColor="#a855f7" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                        <XAxis dataKey="date" stroke="#64748b" fontSize={10} />
                        <YAxis stroke="#64748b" fontSize={10} domain={["auto", "auto"]} />
                        <Tooltip
                          contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8, fontSize: 11 }}
                          labelStyle={{ color: "#94a3b8" }}
                          formatter={(value: any) => [`₺${Number(value).toLocaleString("tr-TR", { maximumFractionDigits: 2 })}`, "Portföy Değeri"]}
                        />
                        <Area type="monotone" dataKey="total_value" stroke="#a855f7" fill="url(#portfolioEquityGradient)" strokeWidth={2} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                  {equityHistory.length <= 1 && (
                    <p className="text-xs text-muted-foreground mt-2">
                      Bu grafik, portföyünüzün gerçek günlük değeriyle gün geçtikçe dolacak - geçmişe dönük veri
                      tutulmadığı için geriye doğru doldurulamaz, bugünden itibaren birikmeye başlar.
                    </p>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          <Card glass={true}>
            <CardHeader>
              <CardTitle className="text-lg">Portföy Varlıkları</CardTitle>
              <CardDescription>BIP üzerinde kayıtlı aktif hisse senedi varlıklarınız</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead>
                    <tr className="border-b border-border/80 text-muted-foreground text-xs font-semibold bg-secondary/15 h-11">
                      <th className="px-3 md:px-6">Hisse</th>
                      <th className="px-3 md:px-6 text-right">Adet (Lot)</th>
                      <th className="px-3 md:px-6 text-right">Ort. Maliyet</th>
                      <th className="px-3 md:px-6 text-right">Güncel Fiyat</th>
                      <th className="px-3 md:px-6 text-right">Toplam Değer</th>
                      <th className="px-3 md:px-6 text-right">Getiri (Toplam / Günlük)</th>
                      <th className="px-3 md:px-6 text-center">İşlem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assetsList.length > 0 ? (
                      assetsList.map((item: any) => {
                        const costValue = item.shares * item.average_cost
                        const value = item.total_value || 0.0
                        const profit = item.total_profit || 0.0
                        const profitPct = item.profit_percentage || 0.0
                        return (
                          <tr key={item.ticker} className="border-b border-border/40 hover:bg-secondary/20 transition-colors h-14">
                            <td className="px-6 font-bold text-foreground">
                              <div className="flex items-center gap-2">
                                <TickerLogo ticker={item.ticker} size={18} />
                                <span className="bg-secondary px-2 py-1 rounded">
                                  {item.ticker}
                                </span>
                              </div>
                            </td>
                            <td className="px-6 text-right font-mono font-medium">{item.shares}</td>
                            <td className="px-6 text-right font-mono font-medium">₺{item.average_cost.toFixed(2)}</td>
                            <td className="px-6 text-right font-mono font-medium">
                              {/* Always the real, officially published price/NAV - the live fund
                                  estimate is shown as a separate, clearly distinct line below, never
                                  mixed into this figure. */}
                              <div className="flex flex-col items-end">
                                <span>₺{(item.current_price || item.average_cost).toFixed(2)}</span>
                                {item.daily_change_pct != null && item.daily_change_is_estimate && (
                                  <span className="inline-flex items-center gap-0.5 text-[11px] font-bold text-orange-400">
                                    <Zap className="h-3 w-3 shrink-0" />
                                    ~{item.daily_change_pct >= 0 ? "+" : ""}{item.daily_change_pct.toFixed(2)}% tahmini
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-6 text-right font-mono font-bold">
                              ₺{value.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </td>
                            <td className="px-6 text-right font-mono font-bold">
                              <div className="flex flex-col items-end gap-1">
                                {/* Toplam (cumulative since purchase) */}
                                <div className="flex flex-col items-end">
                                  <span className={profit >= 0 ? "text-emerald-400" : "text-rose-500"}>
                                    {profit >= 0 ? "+" : ""}₺{profit.toLocaleString("tr-TR", { maximumFractionDigits: 2 })}
                                  </span>
                                  <span className={`text-xs ${profit >= 0 ? "text-emerald-400" : "text-rose-500"}`}>
                                    Toplam {profit >= 0 ? "+" : ""}{profitPct.toFixed(1)}%
                                  </span>
                                </div>
                                {/* Günlük (today only) - real for a stock, tahmini for a fund.
                                    Estimated figures are rendered entirely in orange (both the
                                    TL amount and the %) rather than the usual green/red gain
                                    colors, so an estimate is never mistaken for a settled
                                    figure at a glance. The +/- sign still carries direction. */}
                                {item.daily_gain_value != null && (
                                  <div className="flex flex-col items-end border-t border-border/30 pt-1">
                                    <span className={`text-xs font-bold inline-flex items-center gap-0.5 ${
                                      item.daily_change_is_estimate
                                        ? "text-orange-400"
                                        : item.daily_gain_value >= 0 ? "text-cyan-400" : "text-rose-400"
                                    }`}>
                                      {item.daily_change_is_estimate && <Zap className="h-3 w-3 shrink-0" />}
                                      {item.daily_gain_value >= 0 ? "+" : ""}₺{item.daily_gain_value.toLocaleString("tr-TR", { maximumFractionDigits: 2 })}
                                    </span>
                                    <span className={`text-[11px] font-semibold ${
                                      item.daily_change_is_estimate
                                        ? "text-orange-400"
                                        : item.daily_gain_value >= 0 ? "text-cyan-400" : "text-rose-400"
                                    }`}>
                                      Günlük{item.daily_change_is_estimate ? " (tahmini)" : ""} {item.daily_change_pct >= 0 ? "+" : ""}{item.daily_change_pct.toFixed(2)}%
                                    </span>
                                  </div>
                                )}
                              </div>
                            </td>
                            <td className="px-6 text-center flex items-center justify-center h-14">
                              <button 
                                onClick={() => {
                                  setSelectedAsset(item)
                                  setSellShares("")
                                  setIsOpenSellModal(true)
                                }}
                                className="text-xs px-2 py-1 bg-amber-500/10 text-amber-400 border border-amber-500/20 hover:bg-amber-500/20 rounded mr-2 transition-all cursor-pointer font-semibold"
                              >
                                Sat
                              </button>
                              <button 
                                onClick={() => {
                                  setSelectedAsset(item)
                                  setEditShares(item.shares.toString())
                                  setEditCost(item.average_cost.toString())
                                  setIsOpenEditModal(true)
                                }}
                                className="text-xs px-2 py-1 bg-blue-500/10 text-blue-400 border border-blue-500/20 hover:bg-blue-500/20 rounded mr-2 transition-all cursor-pointer font-semibold"
                              >
                                Düzenle
                              </button>
                              <button 
                                onClick={() => handleDeleteAsset(item.id)}
                                className="text-muted-foreground hover:text-rose-500 transition-colors cursor-pointer"
                                title="Tamamen Sil"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </td>
                          </tr>
                        )
                      })
                    ) : (
                      <tr>
                        <td colSpan={7} className="text-center py-8 text-xs text-muted-foreground">
                          Portföyünüzde henüz hisse senedi bulunmamaktadır.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
          {/* Winners & Losers Dashboard Card (Request 6!) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
            {/* Winners Card */}
            <Card glass={true} className="border-emerald-500/15">
              <CardHeader className="py-3 pb-2">
                <CardTitle className="text-xs font-black uppercase text-emerald-400 tracking-wider flex items-center">
                  <TrendingUp className="h-4 w-4 mr-1.5 text-emerald-400" />
                  En Çok Kazandıranlar
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {advancedMetrics.winners.length > 0 ? (
                  advancedMetrics.winners.slice(0, 3).map((item: any) => (
                    <div key={item.ticker} className="flex items-center justify-between text-xs py-1.5 border-b border-border/20 last:border-0">
                      <span className="font-bold text-foreground bg-secondary/60 px-2 py-0.5 rounded">{item.ticker}</span>
                      <div className="text-right">
                        <span className="font-bold font-mono text-emerald-400 block">
                          +₺{item.total_profit.toLocaleString("tr-TR", { maximumFractionDigits: 1 })}
                        </span>
                        <span className="text-xs text-muted-foreground font-mono">
                          +{item.profit_percentage.toFixed(1)}%
                        </span>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-muted-foreground py-4 text-center">Henüz kârda varlık bulunmuyor.</p>
                )}
              </CardContent>
            </Card>

            {/* Losers Card */}
            <Card glass={true} className="border-rose-500/15">
              <CardHeader className="py-3 pb-2">
                <CardTitle className="text-xs font-black uppercase text-rose-400 tracking-wider flex items-center">
                  <Activity className="h-4 w-4 mr-1.5 text-rose-400" />
                  En Çok Kaybettirenler
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {advancedMetrics.losers.length > 0 ? (
                  advancedMetrics.losers.slice(0, 3).map((item: any) => (
                    <div key={item.ticker} className="flex items-center justify-between text-xs py-1.5 border-b border-border/20 last:border-0">
                      <span className="font-bold text-foreground bg-secondary/60 px-2 py-0.5 rounded">{item.ticker}</span>
                      <div className="text-right">
                        <span className="font-bold font-mono text-rose-500 block">
                          ₺{item.total_profit.toLocaleString("tr-TR", { maximumFractionDigits: 1 })}
                        </span>
                        <span className="text-xs text-muted-foreground font-mono">
                          {item.profit_percentage.toFixed(1)}%
                        </span>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-muted-foreground py-4 text-center">Zararda varlık bulunmuyor.</p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Right Side Column: Chart & Alerts list */}
        <div className="space-y-8">
          
          {/* Asset Weight Distribution (Request 6!) */}
          <Card glass={true}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-black flex items-center uppercase tracking-wider text-purple-400">
                  <PieIcon className="h-4.5 w-4.5 text-purple-400 mr-2" />
                  Dağılım Analizi
                </CardTitle>
                <div className="flex bg-secondary/40 p-0.5 rounded-lg border border-border/30">
                  <button 
                    onClick={() => setDistributionTab("hisse")}
                    className={`text-[11px] font-black px-2 py-1 rounded transition-all cursor-pointer ${
                      distributionTab === "hisse" ? "bg-primary text-primary-foreground shadow" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Hisse
                  </button>
                  <button
                    onClick={() => setDistributionTab("sektor")}
                    className={`text-[11px] font-black px-2 py-1 rounded transition-all cursor-pointer ${
                      distributionTab === "sektor" ? "bg-primary text-primary-foreground shadow" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Sektör
                  </button>
                  <button
                    onClick={() => setDistributionTab("tur")}
                    className={`text-[11px] font-black px-2 py-1 rounded transition-all cursor-pointer ${
                      distributionTab === "tur" ? "bg-primary text-primary-foreground shadow" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Tür
                  </button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col items-center">
              <div className="h-48 w-full">
                {distributionTab !== "hisse" && analyticsLoading ? (
                  <div className="h-full flex items-center justify-center">
                    <Loader2 className="h-6 w-6 text-muted-foreground animate-spin" />
                  </div>
                ) : distributionData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={distributionData}
                        cx="50%"
                        cy="50%"
                        innerRadius={45}
                        outerRadius={65}
                        paddingAngle={4}
                        dataKey="value"
                      >
                        {distributionData.map((entry: any, index: number) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value) => value !== undefined && value !== null ? `₺${Number(value).toLocaleString("tr-TR")}` : ""} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-xs text-muted-foreground">Dağılım verisi bulunamadı</div>
                )}
              </div>
              <div className="w-full space-y-2 mt-4 max-h-40 overflow-y-auto pr-1">
                {distributionData.map((entry: any) => {
                  const pct = currentValue > 0 ? ((entry.value / currentValue) * 100).toFixed(1) : "0.0"
                  return (
                    <div key={entry.name} className="flex items-center justify-between text-xs font-semibold">
                      <div className="flex items-center text-muted-foreground">
                        <span className="h-2.5 w-2.5 rounded-full mr-2" style={{ backgroundColor: entry.color }} />
                        <span className="truncate max-w-[120px]">{entry.name}</span>
                      </div>
                      <span className="font-mono text-foreground">{pct}%</span>
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>

          {/* Portfolio Stress Test */}
          <Card glass={true}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-black flex items-center uppercase tracking-wider text-rose-400">
                <Activity className="h-4.5 w-4.5 text-rose-400 mr-2" />
                Portföy Stres Testi
              </CardTitle>
              <CardDescription className="text-xs">Beta&apos;ya dayalı yaklaşık senaryo simülasyonu</CardDescription>
            </CardHeader>
            <CardContent>
              <PortfolioStressTest beta={analytics?.beta ?? null} currentValue={currentValue} />
            </CardContent>
          </Card>

          {/* Active Alerts List */}
          <Card glass={true}>
            <CardHeader>
              <CardTitle className="text-lg flex items-center">
                <Bell className="h-4 w-4 text-primary mr-2" />
                Alarmlarım
              </CardTitle>
              <CardDescription>Canlı BIST fiyat tetikleyicileriniz</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {alerts.length > 0 ? (
                alerts.map((alert: any) => (
                  <div key={alert.id} className={`flex items-center justify-between p-3 rounded-lg border text-xs transition-colors ${
                    alert.is_triggered 
                      ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-400" 
                      : "border-border bg-secondary/20 text-muted-foreground"
                  }`}>
                    <div className="space-y-1">
                      <div className="flex items-center space-x-2">
                        <span className="font-extrabold bg-secondary px-1.5 py-0.5 rounded text-foreground">
                          {alert.ticker}
                        </span>
                        <span className="font-semibold text-muted-foreground">({alert.alert_type === "price" ? "Fiyat" : alert.alert_type.toUpperCase()})</span>
                      </div>
                      <p className="font-mono font-bold text-foreground/90">
                        {alert.alert_type === "strategy_signal"
                          ? `Yön: ${alert.trigger_condition.direction || "ANY"}`
                          : `${alert.trigger_condition.operator ?? ""} ${alert.trigger_condition.value ?? ""}`}
                      </p>
                    </div>
                    <div className="flex items-center space-x-2">
                      <button 
                        onClick={() => handleToggleAlert(alert.id)}
                        className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                        disabled={alert.is_triggered}
                      >
                        {alert.is_triggered ? (
                          <span className="bg-emerald-500/10 text-emerald-400 px-1.5 py-0.5 rounded border border-emerald-500/15 text-xs font-bold">
                            Tetiklendi
                          </span>
                        ) : alert.is_active ? (
                          <ToggleRight className="h-6 w-6 text-primary" />
                        ) : (
                          <ToggleLeft className="h-6 w-6" />
                        )}
                      </button>
                      <button 
                        onClick={() => handleDeleteAlert(alert.id)}
                        className="text-muted-foreground hover:text-rose-500 transition-colors cursor-pointer"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-center text-xs text-muted-foreground py-4">Henüz kurulmuş bir alarm bulunmamaktadır.</p>
              )}
            </CardContent>
          </Card>

        </div>

      </div>
    </div>
  )
}
