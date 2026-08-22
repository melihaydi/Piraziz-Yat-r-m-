"use client"

import React, { useState, useEffect, useRef } from "react"
import dynamic from "next/dynamic"
import { 
  Plus,
  Bell,
  TrendingUp,
  TrendingDown,
  Briefcase,
  Trash2,
  Pencil,
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
  Coins,
  FileText,
  AlertTriangle
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/Tabs"
import { authFetch } from "@/lib/auth"
import { pollWhileVisibleAndOpen } from "@/lib/usePolling"
import { parseTLAmount } from "@/lib/utils"
import { TickerLogo } from "@/components/ui/TickerLogo"

const COLORS = ["#a855f7", "#06b6d4", "#10b981", "#fbbf24", "#ec4899", "#f97316"]

// Grafikler tembel yükleniyor. Ölçüm: recharts derlenmiş hâlde 344 KB'lık
// ayrı bir parça ve statik import edildiğinde /portfolio'nun ilk yüküne
// dahil oluyordu - halbuki iki grafik de varsayılan sekmede DEĞİL, kullanıcı
// "Performans" veya "Analiz" sekmesine geçmedikçe hiç çizilmiyor. Böylece
// sayfayı açıp varlıklarına bakan (yani çoğu ziyaret) o parçayı hiç
// indirmiyor. ssr:false, çünkü recharts ölçüm için DOM'a ihtiyaç duyuyor ve
// sunucuda ön-render edilmesinin bir faydası yok.
const PortfolioEquityChart = dynamic(() => import("@/components/charts/PortfolioEquityChart"), {
  ssr: false,
  loading: () => (
    <div className="h-full flex items-center justify-center">
      <Loader2 className="h-6 w-6 text-muted-foreground animate-spin" />
    </div>
  ),
})

const PortfolioDistributionChart = dynamic(() => import("@/components/charts/PortfolioDistributionChart"), {
  ssr: false,
  loading: () => (
    <div className="h-full flex items-center justify-center">
      <Loader2 className="h-6 w-6 text-muted-foreground animate-spin" />
    </div>
  ),
})

// Hareket defteri tipleri (backend TRANSACTION_TYPES ile aynı).
const TX_LABELS: Record<string, string> = {
  BUY: "ALIŞ",
  SELL: "SATIŞ",
  DIVIDEND: "TEMETTÜ",
  BONUS: "BEDELSİZ",
}

/** ₺1.234,56 - varlık listesinde aynı biçimlendirme onlarca yerde
 *  tekrar ediyordu, tek yerden geçsin. */
const tl = (n: number, digits = 2) =>
  `₺${n.toLocaleString("tr-TR", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`

/** İşaretli tutar: kâr/zarar rakamlarında yön her zaman görünsün. */
const tlSigned = (n: number, digits = 2) => `${n >= 0 ? "+" : "-"}${tl(Math.abs(n), digits)}`

const pctSigned = (n: number, digits = 2) => `${n >= 0 ? "+" : ""}${n.toFixed(digits)}%`

/** Bir pozisyonun günlük değişim rengi. Tahmini rakamlar TAMAMEN turuncu
 *  veriliyor (hem tutar hem yüzde), yeşil/kırmızıdan ayrılsın diye - bir
 *  tahmin hiçbir zaman kesinleşmiş bir rakamla karıştırılmasın. Yön yine
 *  +/- işaretinden okunuyor. */
const dailyToneClass = (value: number, isEstimate: boolean) =>
  isEstimate ? "val-warn" : value >= 0 ? "val-up" : "val-down"

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
        className="w-full accent-primary cursor-pointer"
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
  // Seçili portföy, oturum boyunca korunur (localStorage: kullanıcı sayfayı
  // yenileyince tekrar ilk portföye düşmesin).
  const [activePortfolioId, setActivePortfolioId] = useState<number | null>(null)
  const [isOpenPortfolioModal, setIsOpenPortfolioModal] = useState(false)
  const [newPortfolioName, setNewPortfolioName] = useState("")
  const [alerts, setAlerts] = useState<any[]>([])
  const [analytics, setAnalytics] = useState<any>(null)
  const [analyticsLoading, setAnalyticsLoading] = useState(true)
  const [equityHistory, setEquityHistory] = useState<{ date: string; total_value: number }[]>([])
  const [benchmark, setBenchmark] = useState<{ date: string; index_change_pct: number }[]>([])
  const [performance, setPerformance] = useState<any>(null)
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
  // Portföyün bütününe bakan alarm tipleri - hisse kodu almazlar
  // (backend'deki _PORTFOLIO_ALERT_TYPES ile aynı liste).
  const isPortfolioAlert = alertType === "portfolio_change" || alertType === "position_loss"
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
  const [isOpenAnnualModal, setIsOpenAnnualModal] = useState(false)
  const [annual, setAnnual] = useState<any>(null)
  const [annualYear, setAnnualYear] = useState<number | null>(null)
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
  // Döviz nakit girişi eskiden sayfa gövdesinde, tam genişlikte açık bir
  // satırdı - nadiren kullanılan bir işlem için sürekli yer kaplıyordu.
  // Artık üstteki eylem çubuğundan açılan bir modal, "Varlık Ekle" ile aynı
  // desende.
  const [isOpenUsdCashModal, setIsOpenUsdCashModal] = useState(false)

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
        // Modal artık kendi kendine kapanıyor - başarılı işlemden sonra açık
        // kalması, bakiyenin güncellenip güncellenmediğini görmek için
        // kullanıcıyı kapatmaya zorluyordu.
        setIsOpenUsdCashModal(false)
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
        setBenchmark(data.benchmark || [])
        setPerformance(data.performance || null)
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

  // Yıllık kazanç özeti - sadece rapor açıldığında (ve yıl değiştikçe)
  // çekiliyor, sayfa yüklenirken değil: FIFO hesabı tüm defteri yürüdüğü
  // için her sayfa açılışında bedelini ödemeye değmez.
  const loadAnnual = async (year?: number | null) => {
    try {
      const qs = year ? `?year=${year}` : ""
      const res = await authFetch(`/portfolio/annual-summary${qs}`)
      if (res.ok) {
        const data = await res.json()
        setAnnual(data)
        setAnnualYear(data.year)
      }
    } catch (err) {
      console.error("Failed to load annual summary:", err)
    }
  }

  const loadData = () => {
    loadCore()
    loadAnalytics()
    loadEquityHistory()
    loadLedger()
  }

  // Seçili portföyü hatırla / geçersizse geri düş. Silinen bir portföyün
  // id'si localStorage'da kalmış olabilir - o durumda ilk portföye dönüyoruz,
  // yoksa sayfa boş görünürdü.
  useEffect(() => {
    if (portfolios.length === 0) return
    const stored = Number(localStorage.getItem("active_portfolio_id"))
    const valid = portfolios.some(p => p.id === stored)
    setActivePortfolioId(prev =>
      portfolios.some(p => p.id === prev) ? prev : (valid ? stored : portfolios[0].id),
    )
  }, [portfolios])

  const selectPortfolio = (id: number) => {
    setActivePortfolioId(id)
    localStorage.setItem("active_portfolio_id", String(id))
  }

  const handleCreatePortfolio = async (e: React.FormEvent) => {
    e.preventDefault()
    const name = newPortfolioName.trim()
    if (!name) return
    try {
      const res = await authFetch("/portfolio/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      })
      if (res.ok) {
        const created = await res.json()
        setNewPortfolioName("")
        setIsOpenPortfolioModal(false)
        selectPortfolio(created.id)
        loadData()
      } else {
        const body = await res.json().catch(() => null)
        flashActionError(body?.detail || "Portföy oluşturulamadı.")
      }
    } catch {
      flashActionError("Sunucuya ulaşılamadı.")
    }
  }

  const handleDeletePortfolio = async (id: number) => {
    try {
      const res = await authFetch(`/portfolio/${id}`, { method: "DELETE" }, 0)
      if (res.ok) {
        // Silinen portföy seçiliyse kalanların ilkine geç.
        const remaining = portfolios.filter(p => p.id !== id)
        if (remaining.length > 0) selectPortfolio(remaining[0].id)
        loadData()
      } else {
        const body = await res.json().catch(() => null)
        flashActionError(body?.detail || "Portföy silinemedi.")
      }
    } catch {
      flashActionError("Sunucuya ulaşılamadı.")
    }
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

  // Portföy eğrisi ile endeksi aynı grafikte karşılaştırılabilir kılmak
  // için ikisini de ilk günden itibaren YÜZDE değişime çeviriyoruz. Ham
  // değerler aynı eksene konamaz: XU100 ~10.000 seviyesinde, kullanıcının
  // portföyü belki ₺6.000 - yan yana çizilince portföy düz bir çizgi gibi
  // görünürdü. Asıl soru "kaç lira" değil, "endeksi yendim mi".
  const comparisonData = React.useMemo(() => {
    if (equityHistory.length < 2) return []
    const base = equityHistory[0].total_value
    if (!base) return []
    const indexByDate = new Map(benchmark.map(b => [b.date, b.index_change_pct]))
    // Portföy çizgisi HAM değer değişimini değil, para giriş/çıkışından
    // arındırılmış birikimli getiriyi (TWR) çizer. Önceden çizgi ham
    // değişimi gösterirken başlıktaki rakam TWR'ydi: para yatıran bir
    // kullanıcı aynı kartta "Portföy +%10" başlığıyla +%1000'de biten bir
    // eğriyi yan yana görüyordu. Karşılaştırmanın anlamlı olması için
    // endeksle aynı ölçekte olması gereken seri de zaten bu.
    const twrByDate = new Map<string, number>(
      (performance?.series || []).map((s: any) => [s.date, s.twr_pct]),
    )
    return equityHistory.map(h => ({
      date: h.date,
      total_value: h.total_value,
      portfolio_pct: twrByDate.has(h.date)
        ? twrByDate.get(h.date)!
        : Number(((h.total_value / base - 1) * 100).toFixed(2)),
      // Endeks kapanışı olmayan gün (tatil/eksik veri) null kalır -
      // Recharts bu noktada çizgiyi kesintiye uğratır, ki uydurulmuş bir
      // ara değer çizmekten dürüst olanı budur.
      index_pct: indexByDate.has(h.date) ? indexByDate.get(h.date)! : null,
    }))
  }, [equityHistory, benchmark, performance])

  // "Endeksi yendim mi" - son güne ait iki yüzdenin farkı.
  //
  // Portföy tarafında ham değişim DEĞİL, zaman-ağırlıklı getiri (TWR)
  // kullanılıyor: kullanıcı araya para yatırdıysa eğri yükselir ama bu
  // performans değildir, endeks ise para girişi almaz - ham değişimle
  // karşılaştırmak portföyü haksız yere üstün gösterirdi.
  const benchmarkVerdict = React.useMemo(() => {
    const withIndex = comparisonData.filter(d => d.index_pct != null)
    if (withIndex.length < 2) return null
    const last = withIndex[withIndex.length - 1]
    const portfolioPct = performance?.twr_pct ?? last.portfolio_pct
    return {
      portfolioPct,
      indexPct: last.index_pct as number,
      diff: Number((portfolioPct - (last.index_pct as number)).toFixed(2)),
      // Para giriş/çıkışı varsa kullanıcıya ham değişimin neden farklı
      // göründüğünü açıklamamız gerekiyor.
      hasFlows: Boolean(performance?.has_flows),
      simplePct: performance?.simple_change_pct ?? null,
      netFlow: performance?.net_flow ?? 0,
    }
  }, [comparisonData, performance])

  // Aktif portföy. Backend en başından beri kullanıcı başına birden fazla
  // portföy destekliyordu ama burası her zaman portfolios[0]'ı gösteriyordu:
  // ikinci portföy oluşsa bile arayüzde görünmez oluyordu (Trade modülünde
  // tam bir hesap değiştirici varken portföy tarafında yoktu).
  const activePortfolio =
    portfolios.find(p => p.id === activePortfolioId) || portfolios[0] || null

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
    // Portföy alarmlarının hissesi yoktur; diğerlerinde zorunlu.
    if (!alertCondition) return
    if (!isPortfolioAlert && !alertTicker) return

    // "> 310" / "< -5" gibi bir ifadeyi yapısal koşula çevirir. Eksi işareti
    // sayının parçası: portföy alarmlarının eşiği tipik olarak negatiftir
    // ("%5'ten fazla düşerse"), eskiden bu desen negatifi yakalamıyordu ve
    // "-5" sessizce 5 olarak okunurdu.
    const match = alertCondition.trim().match(/^([><=]+)\s*(-?[\d.,]+)/)
    const operator = match ? match[1] : ">"
    const rawValue = match ? match[2] : alertCondition
    const value = parseTLAmount(rawValue)
    if (!Number.isFinite(value)) {
      flashActionError("Koşul geçersiz - örn. > 310,50 veya < -5 yazın.")
      return
    }

    try {
      const res = await authFetch(`/alert/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker: isPortfolioAlert ? null : alertTicker.toUpperCase(),
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
          <h1 className="t-display">Portföy ve Alarm Sistemi</h1>
          <p className="t-caption mt-1.5">Maliyet hesaplaması, sektör dağılımları ve TradingView tetikleyici alarmlar.</p>
          {/* Portföy seçici - yalnızca birden fazla portföy varsa sekme
              olarak görünür; tek portföyü olan kullanıcı gereksiz bir
              arayüz elemanıyla karşılaşmasın. */}
          <div className="flex flex-wrap items-center gap-2 mt-3">
            {portfolios.length > 1 && portfolios.map(p => (
              <button
                key={p.id}
                onClick={() => selectPortfolio(p.id)}
                className={`px-2.5 py-1 rounded text-xs font-bold cursor-pointer transition-colors ${
                  p.id === activePortfolio?.id
                    ? "bg-primary/20 text-primary border border-primary/40"
                    : "bg-secondary/40 text-muted-foreground border border-border/40 hover:bg-secondary/70"
                }`}
              >
                {p.name}
              </button>
            ))}
            <button
              onClick={() => setIsOpenPortfolioModal(true)}
              className="px-2.5 py-1 rounded text-xs font-bold text-muted-foreground border border-dashed border-border/60 hover:text-foreground hover:border-border cursor-pointer"
            >
              + Portföy
            </button>
            {portfolios.length > 1 && activePortfolio && (
              <button
                onClick={() => handleDeletePortfolio(activePortfolio.id)}
                className="px-2.5 py-1 rounded text-xs font-bold text-rose-400/80 hover:text-rose-300 cursor-pointer"
                title={`"${activePortfolio.name}" portföyünü sil`}
              >
                Sil
              </button>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button
            variant="outline"
            className="cursor-pointer flex items-center"
            onClick={() => setIsOpenHistoryModal(true)}
          >
            <History className="h-4 w-4 mr-2 text-primary" />
            İşlem Geçmişi
          </Button>
          <Button
            variant="outline"
            className="cursor-pointer flex items-center"
            onClick={() => setIsOpenDividendModal(true)}
          >
            <Coins className="h-4 w-4 mr-2 text-primary" />
            Temettü Ekle
          </Button>
          <Button
            variant="outline"
            className="cursor-pointer flex items-center"
            onClick={() => { setIsOpenAnnualModal(true); loadAnnual(annualYear) }}
          >
            <FileText className="h-4 w-4 mr-2 text-emerald-400" />
            Yıllık Özet
          </Button>

          {/* Döviz Nakit (USD) - self-service, unlike Nakit/VİOP Teminatı
              (still admin-only via Yönetilen Portföyler). Stored in raw
              dollars; the TL figure is the backend's LIVE conversion computed
              on every load, not a fixed snapshot from deposit time - it moves
              with USD/TRY on refresh. Gram altın is added the normal way
              through "Varlık Ekle" (it has its own live price/P&L to track,
              unlike plain parked cash). */}
          <Dialog open={isOpenUsdCashModal} onOpenChange={setIsOpenUsdCashModal}>
            <DialogTrigger asChild>
              <Button variant="outline" className="cursor-pointer flex items-center">
                <DollarSign className="h-4 w-4 mr-2 text-sky-400" />
                Döviz Nakit
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
              <DialogHeader>
                <DialogTitle>Döviz Nakit (USD)</DialogTitle>
                <DialogDescription>
                  Hesabınızda duran dolar nakdi. TL karşılığı her yüklemede güncel USD/TRY ile hesaplanır,
                  yatırdığınız andaki kur sabitlenmez.
                </DialogDescription>
              </DialogHeader>

              <div className="py-4 space-y-4">
                <div className="rounded-lg border border-border/50 bg-secondary/20 px-4 py-3">
                  <span className="text-[11px] font-bold uppercase text-muted-foreground">Mevcut Bakiye</span>
                  <p className="t-metric text-foreground mt-0.5">
                    ${usdCashBalance.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                  <p className="text-xs font-semibold text-muted-foreground font-mono">
                    ≈ ₺{usdCashValueTry.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase text-muted-foreground">Tutar ($)</label>
                  <Input
                    value={usdCashAmount}
                    onChange={e => setUsdCashAmount(e.target.value)}
                    inputMode="decimal"
                    placeholder="örn. 220"
                    className="bg-secondary/50"
                  />
                </div>

                {/* Tek bir pozitif tutar yazılıp yön butonla seçiliyor - eksi
                    işareti unutmak yatırmayı çekmeye çeviremesin diye. */}
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    onClick={() => adjustUsdCash(1)}
                    disabled={usdCashBusy || !usdCashAmount}
                    className="cursor-pointer bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 font-bold"
                  >
                    <Plus className="h-4 w-4 mr-1.5" />
                    Ekle
                  </Button>
                  <Button
                    type="button"
                    onClick={() => adjustUsdCash(-1)}
                    disabled={usdCashBusy || !usdCashAmount}
                    className="cursor-pointer bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 font-bold"
                  >
                    <Minus className="h-4 w-4 mr-1.5" />
                    Çıkar
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
          {/* Create Alarm Dialog */}
          <Dialog open={isOpenAlertModal} onOpenChange={setIsOpenAlertModal}>
            <DialogTrigger asChild>
              <Button variant="outline" className="cursor-pointer flex items-center">
                <Bell className="h-4 w-4 mr-2 text-primary" />
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
                  <label className="text-sm font-semibold text-muted-foreground text-right">Kriter</label>
                  <select
                    value={alertType}
                    onChange={(e) => setAlertType(e.target.value)}
                    className="col-span-2 h-9 rounded-md border border-input bg-secondary px-3 text-sm focus-visible:outline-none"
                  >
                    <optgroup label="Hisse bazlı">
                      <option value="price">Fiyat</option>
                      <option value="rsi">RSI (14)</option>
                      <option value="macd">MACD Kesişimi</option>
                    </optgroup>
                    <optgroup label="Portföyün tamamı">
                      <option value="portfolio_change">Portföy değişimi (%)</option>
                      <option value="position_loss">Bir pozisyonun zararı (%)</option>
                    </optgroup>
                  </select>
                </div>
                {/* Portföy alarmlarının hissesi yoktur - alan gizleniyor,
                    yoksa kullanıcı zorunlu sanıp anlamsız bir kod yazıyor. */}
                {!isPortfolioAlert && (
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
                )}
                <div className="grid grid-cols-3 items-center gap-4">
                  <label className="text-sm font-semibold text-muted-foreground text-right">Koşul</label>
                  <Input
                    value={alertCondition}
                    onChange={(e) => setAlertCondition(e.target.value)}
                    placeholder={isPortfolioAlert ? "Ör: < -5 (yüzde)" : "Ör: > 310.50 veya < 120"}
                    className="col-span-2 bg-secondary/50"
                    required
                  />
                </div>
                {isPortfolioAlert && (
                  <p className="text-[11px] text-muted-foreground text-center leading-relaxed">
                    {alertType === "portfolio_change"
                      ? "Portföyünüzün toplam değeri, son kaydedilen günlük değere göre bu yüzdeyi aştığında bildirim alırsınız."
                      : "Herhangi bir pozisyonunuzun maliyetine göre zararı bu yüzdeyi aştığında bildirim alırsınız."}
                  </p>
                )}
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
                      className="h-7 px-2 rounded-md border border-input bg-secondary/40 text-xs font-bold text-muted-foreground hover:text-foreground hover:border-primary/40 cursor-pointer"
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

          {/* Yeni portföy */}
          <Dialog open={isOpenPortfolioModal} onOpenChange={setIsOpenPortfolioModal}>
            <DialogContent className="sm:max-w-[425px]">
              <DialogHeader>
                <DialogTitle>Yeni Portföy</DialogTitle>
                <DialogDescription>
                  Varlıklarınızı ayrı ayrı takip etmek için birden fazla portföy
                  oluşturabilirsiniz (örn. emeklilik, kısa vadeli).
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleCreatePortfolio} className="space-y-4 py-4">
                <div className="grid grid-cols-3 items-center gap-4">
                  <label className="text-sm font-semibold text-muted-foreground text-right">Portföy Adı</label>
                  <Input
                    value={newPortfolioName}
                    onChange={(e) => setNewPortfolioName(e.target.value)}
                    placeholder="Örn: Emeklilik"
                    className="col-span-2 bg-secondary/50"
                    required
                  />
                </div>
                <DialogFooter className="pt-4 border-t border-border/50">
                  <Button type="submit" className="w-full cursor-pointer">Oluştur</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>

          {/* Yıllık kazanç özeti */}
          <Dialog open={isOpenAnnualModal} onOpenChange={setIsOpenAnnualModal}>
            <DialogContent className="sm:max-w-[640px]">
              <DialogHeader>
                <DialogTitle>Yıllık Kazanç Özeti{annual?.year ? ` — ${annual.year}` : ""}</DialogTitle>
                <DialogDescription>
                  Bir takvim yılında kapatılan işlemlerden doğan kâr/zarar ve alınan temettü.
                </DialogDescription>
              </DialogHeader>

              {!annual ? (
                <div className="py-10 flex items-center justify-center">
                  <Loader2 className="h-6 w-6 text-muted-foreground animate-spin" />
                </div>
              ) : (
                <div className="space-y-4 py-2">
                  {annual.available_years?.length > 1 && (
                    <div className="flex flex-wrap gap-2">
                      {annual.available_years.map((y: number) => (
                        <button
                          key={y}
                          onClick={() => loadAnnual(y)}
                          className={`px-2.5 py-1 rounded text-xs font-bold cursor-pointer transition-colors ${
                            y === annual.year
                              ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                              : "bg-secondary/40 text-muted-foreground border border-border/40 hover:bg-secondary/70"
                          }`}
                        >
                          {y}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* İki maliyet yöntemi yan yana - hangisinin kullanılacağı
                      kullanıcının (ve mali müşavirinin) kararı, bizim değil. */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="rounded-lg border border-border/50 bg-secondary/20 p-3">
                      <p className="text-[11px] font-bold uppercase text-muted-foreground">Ortalama Maliyet</p>
                      <p className={`text-xl font-extrabold font-mono mt-1 ${
                        annual.average_cost.realized_pnl >= 0 ? "text-emerald-400" : "text-rose-500"
                      }`}>
                        {annual.average_cost.realized_pnl >= 0 ? "+" : ""}₺
                        {annual.average_cost.realized_pnl.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </p>
                      <p className="text-[10px] text-muted-foreground mt-1">
                        Uygulamanın pozisyon ekranıyla aynı yöntem
                      </p>
                    </div>
                    <div className="rounded-lg border border-border/50 bg-secondary/20 p-3">
                      <p className="text-[11px] font-bold uppercase text-muted-foreground">FIFO (İlk Giren İlk Çıkar)</p>
                      <p className={`text-xl font-extrabold font-mono mt-1 ${
                        annual.fifo.realized_pnl >= 0 ? "text-emerald-400" : "text-rose-500"
                      }`}>
                        {annual.fifo.realized_pnl >= 0 ? "+" : ""}₺
                        {annual.fifo.realized_pnl.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </p>
                      <p className="text-[10px] text-muted-foreground mt-1">
                        Vergi hesabında sıkça kullanılan yöntem
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-lg border border-border/50 bg-secondary/20 px-3 py-2.5 text-xs">
                    <span>
                      <span className="text-muted-foreground">Temettü geliri: </span>
                      <span className="font-mono font-extrabold val-warn">
                        ₺{annual.dividend_income.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </span>
                    <span className="text-muted-foreground">{annual.sell_count} satış · {annual.dividend_count} temettü</span>
                  </div>

                  {annual.has_incomplete_basis && (
                    <div className="flex items-start gap-2 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2">
                      <AlertTriangle className="h-4 w-4 val-warn shrink-0 mt-0.5" />
                      <p className="text-[11px] leading-relaxed val-warn">
                        Bazı satışların alış kaydı defterde yok (işlem geçmişi
                        tutulmaya başlamadan önce alınmış pozisyonlar). FIFO rakamı
                        bu satışları hariç tutuyor, yani eksik.
                      </p>
                    </div>
                  )}

                  {annual.by_ticker?.length > 0 && (
                    <div className="max-h-[35vh] overflow-y-auto">
                      <table className="w-full text-xs">
                        <thead className="text-muted-foreground border-b border-border/50">
                          <tr>
                            <th className="text-left py-2 font-semibold">Hisse</th>
                            <th className="text-right py-2 font-semibold">Satış K/Z</th>
                            <th className="text-right py-2 font-semibold">Temettü</th>
                            <th className="text-right py-2 font-semibold">Toplam</th>
                          </tr>
                        </thead>
                        <tbody className="font-mono">
                          {annual.by_ticker.map((r: any) => (
                            <tr key={r.ticker} className="border-b border-border/20">
                              <td className="py-2 font-bold font-sans">{r.ticker}</td>
                              <td className={`py-2 text-right ${r.realized_pnl >= 0 ? "text-emerald-400" : "text-rose-500"}`}>
                                {r.realized_pnl >= 0 ? "+" : ""}₺{r.realized_pnl.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </td>
                              <td className="py-2 text-right val-warn">
                                ₺{r.dividend_income.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </td>
                              <td className={`py-2 text-right font-bold ${r.total >= 0 ? "text-emerald-400" : "text-rose-500"}`}>
                                {r.total >= 0 ? "+" : ""}₺{r.total.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  <p className="text-[10px] leading-relaxed text-muted-foreground border-t border-border/40 pt-3">
                    Bu özet yalnızca sizin girdiğiniz işlemlere dayanan bir hesaplama
                    aracıdır; resmî bir vergi beyanı veya mali müşavirlik hizmeti değildir.
                    Beyan yükümlülüğünüz için mali müşavirinize danışın.
                  </p>
                </div>
              )}
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
                              t.transaction_type === "BUY" ? "bg-bull/15 val-up"
                              : t.transaction_type === "SELL" ? "bg-bear/15 val-down"
                              : t.transaction_type === "DIVIDEND" ? "bg-warn/15 val-warn"
                              : "bg-primary/15 text-primary"
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
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 stagger">
        <Card glass={true}>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <span className="t-label">PORTFÖY DEĞERİ</span>
              <Briefcase className="h-4 w-4 text-primary" />
            </div>
            <div className="mt-2 flex items-baseline space-x-2">
              <span className="t-metric font-mono text-foreground">
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
              className="mt-2 flex items-center gap-1 text-xs font-semibold text-primary hover:text-primary-hover transition-colors cursor-pointer"
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
              <span className="t-label">TOPLAM KÂR / ZARAR</span>
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
              <span className="t-label">BETA / VOLATİLİTE</span>
              <Activity className="h-4 w-4 text-primary" />
            </div>
            <div className="mt-2 flex items-baseline space-x-2">
              {analyticsLoading ? (
                <Loader2 className="h-5 w-5 text-muted-foreground animate-spin" />
              ) : (
                <>
                  <span className="t-metric font-mono text-foreground">
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

        <Card className="bip-card">
          <CardContent className="pt-6 space-y-2">
            <div className="flex items-center justify-between">
              <span className="t-label">PORTFÖY SAĞLIĞI</span>
              <Sparkles className="h-4 w-4 text-primary" />
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-2xl font-black text-foreground">
                {advancedMetrics.healthScore} <span className="text-xs text-muted-foreground font-bold">/100</span>
              </span>
              <span className="text-xs font-bold text-primary font-mono">
                Sharpe: {analyticsLoading ? "…" : analytics?.sharpe != null ? analytics.sharpe.toFixed(2) : "—"}
              </span>
            </div>
            <div className="w-full bg-secondary/40 h-2.5 rounded-full overflow-hidden border border-border/30">
              <div 
                className="bg-primary h-full rounded-full transition-all duration-500" 
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
            <History className="h-4 w-4 text-primary" />
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
            <span className="text-sm font-extrabold font-mono val-warn">
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
            className="text-[11px] font-bold text-primary hover:text-primary-hover cursor-pointer ml-auto"
          >
            Tümünü gör →
          </button>
        </div>
      )}

      {showLiveEstimate && (
        <Card className="bip-card">
          <CardHeader>
            <CardTitle className="t-section flex items-center gap-2">
              <Zap className="h-5 w-5 val-warn" />
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

      {/* Sekmeler: sayfa mobilde 5,2 ekran uzunluğundaydı ve 11 ayrı kart
          tek akışta sıralanıyordu. Bilgiyi konusuna göre ayırmak hem o
          yorucu kaydırmayı bitiriyor hem de kullanıcının aradığı şeye
          doğrudan gitmesini sağlıyor. Bölümlerin kendi içeriği değişmedi,
          yalnızca gruplandılar. */}
      {/* Varsayılan sekme Varlıklar: sayfaya girildiğinde ilk görülmesi
          gereken şey kullanıcının neye sahip olduğu. Portföy değeri grafiği
          zaman içindeki seyri anlatıyor, ama "elimde ne var" sorusu her
          zaman ondan önce geliyor. */}
      <Tabs defaultValue="varliklar" className="w-full">
        {/* Yapışkan: ölçümde sekme çubuğu mobilde y=1410'daydı, yani
            kullanıcı sekmelere ulaşmak için önce bütün özet kartlarını
            geçmek zorundaydı - sekmeye tıklamak için aşağı, içeriği görmek
            için yukarı kaydırmak gerekiyordu. Üstte kalınca gezinme her an
            elin altında. */}
        <TabsList className="sticky top-0 z-20 h-auto flex-wrap justify-start gap-1 bg-secondary/40 p-1 backdrop-blur-md supports-[backdrop-filter]:bg-secondary/60">
          {/* Varlıklar başta: hem varsayılan sekme hem de en soldaki olsun -
              aktif sekmenin ortada durması kafa karıştırıcıydı. "Genel"
              adı da değişti; o sekmede yalnızca zaman içindeki değer grafiği
              var, "Performans" ne bulacağını doğrudan söylüyor. */}
          <TabsTrigger value="varliklar" className="t-body">Varlıklar</TabsTrigger>
          <TabsTrigger value="genel" className="t-body">Performans</TabsTrigger>
          <TabsTrigger value="analiz" className="t-body">Analiz</TabsTrigger>
          <TabsTrigger value="alarmlar" className="t-body">Alarmlar</TabsTrigger>
        </TabsList>

        <TabsContent value="genel" className="mt-6 space-y-8">
          <Card glass={true}>
            <CardHeader>
              <CardTitle className="t-section">Portföy Değeri (Zaman İçinde)</CardTitle>
              <CardDescription>
                {benchmarkVerdict
                  ? "Portföyünüzün günlük değeri, XU100 endeksiyle karşılaştırmalı"
                  : "Her gün bir kez kaydedilen gerçek toplam portföy değeriniz"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {equityHistoryLoading ? (
                <div className="h-56 flex items-center justify-center">
                  <Loader2 className="h-6 w-6 text-muted-foreground animate-spin" />
                </div>
              ) : (
                <>
                  {benchmarkVerdict && (
                    <div className={`mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border px-3 py-2 ${
                      benchmarkVerdict.diff >= 0
                        ? "border-emerald-500/30 bg-emerald-500/10"
                        : "border-rose-500/30 bg-rose-500/10"
                    }`}>
                      <span className={`text-sm font-extrabold ${benchmarkVerdict.diff >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                        {benchmarkVerdict.diff >= 0 ? "Endeksin önündesiniz" : "Endeksin gerisindesiniz"}
                        {": "}
                        {benchmarkVerdict.diff >= 0 ? "+" : ""}{benchmarkVerdict.diff.toFixed(2)} puan
                      </span>
                      <span className="text-[11px] text-muted-foreground font-mono">
                        Portföy {benchmarkVerdict.portfolioPct >= 0 ? "+" : ""}{benchmarkVerdict.portfolioPct.toFixed(2)}%
                        {" · "}
                        XU100 {benchmarkVerdict.indexPct >= 0 ? "+" : ""}{benchmarkVerdict.indexPct.toFixed(2)}%
                      </span>
                      {benchmarkVerdict.hasFlows && benchmarkVerdict.simplePct != null && (
                        <span className="w-full text-[10px] text-muted-foreground leading-relaxed">
                          Portföy getirisi, para giriş/çıkışı ayıklanarak hesaplandı
                          (net {benchmarkVerdict.netFlow >= 0 ? "+" : ""}₺
                          {Math.abs(benchmarkVerdict.netFlow).toLocaleString("tr-TR", { maximumFractionDigits: 0 })}).
                          Hesabınızın ham değer değişimi %{benchmarkVerdict.simplePct.toFixed(2)} - aradaki fark
                          kazanç değil, koyduğunuz/çektiğiniz paradır.
                        </span>
                      )}
                    </div>
                  )}
                  <div className="h-56">
                    <PortfolioEquityChart
                      comparisonData={comparisonData}
                      equityHistory={equityHistory}
                      hasBenchmark={!!benchmarkVerdict}
                      hasFlows={!!benchmarkVerdict?.hasFlows}
                    />
                  </div>
                  {equityHistory.length <= 1 && (
                    <p className="text-xs text-muted-foreground mt-2">
                      Bu grafik, portföyünüzün gerçek günlük değeriyle gün geçtikçe dolacak - geçmişe dönük veri
                      tutulmadığı için geriye doğru doldurulamaz, bugünden itibaren birikmeye başlar.
                    </p>
                  )}
                  {benchmarkVerdict && (
                    <p className="text-[11px] text-muted-foreground mt-2">
                      Her iki eğri de ilk kayıt gününe göre yüzde değişimi gösterir - farklı
                      ölçekteki iki seriyi karşılaştırılabilir kılmanın tek yolu budur.
                      Portföyünüze bu dönemde para giriş/çıkışı olduysa eğri bundan da etkilenir.
                    </p>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="varliklar" className="mt-6 space-y-6">
          <Card glass={true}>
            <CardHeader>
              <div className="flex items-baseline justify-between gap-3">
                <div>
                  <CardTitle className="t-section">Portföy Varlıkları</CardTitle>
                  <CardDescription>Portföyünüzdeki açık hisse ve fon pozisyonları</CardDescription>
                </div>
                {assetsList.length > 0 && (
                  <span className="t-label shrink-0">{assetsList.length} pozisyon</span>
                )}
              </div>
            </CardHeader>

            <CardContent className="p-0">
              {assetsList.length === 0 ? (
                <p className="text-center py-14 t-caption">
                  Portföyünüzde henüz varlık bulunmuyor.
                </p>
              ) : (
                <>
                  {/* MOBİL - kart listesi.
                      Buradaki 7 sütunluk tablo telefonda yatay kaydırmaya
                      mahkûmdu: kullanıcı fiyatı görmek için sağa, işlem
                      butonlarına ulaşmak için daha da sağa kaydırıyordu.
                      Kart düzeninde okunması gereken üç rakam (değer, toplam
                      K/Z, günlük) alt alta ve kaydırmasız duruyor. */}
                  <ul className="md:hidden divide-y divide-border/40 stagger-list">
                    {assetsList.map((item: any) => {
                      const value = item.total_value || 0.0
                      const profit = item.total_profit || 0.0
                      const profitPct = item.profit_percentage || 0.0
                      const isEstimate = !!item.daily_change_is_estimate
                      return (
                        <li key={item.ticker} className="px-4 py-3.5">
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <TickerLogo ticker={item.ticker} size={26} />
                              <div className="min-w-0">
                                <div className="font-bold text-foreground truncate">{item.ticker}</div>
                                <div className="t-caption font-mono">
                                  {item.shares} × {tl(item.average_cost)}
                                </div>
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <div className="t-metric-sm text-foreground">{tl(value)}</div>
                              <div className={`text-xs font-bold font-mono ${profit >= 0 ? "text-emerald-400" : "text-rose-500"}`}>
                                {tlSigned(profit)} · {pctSigned(profitPct, 1)}
                              </div>
                            </div>
                          </div>

                          <div className="mt-2.5 flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 t-caption font-mono min-w-0">
                              <span>{tl(item.current_price || item.average_cost)}</span>
                              {item.daily_gain_value != null && (
                                <span className={`inline-flex items-center gap-0.5 font-bold ${dailyToneClass(item.daily_gain_value, isEstimate)}`}>
                                  {isEstimate && <Zap className="h-3 w-3 shrink-0" />}
                                  {tlSigned(item.daily_gain_value)} ({pctSigned(item.daily_change_pct)})
                                  {isEstimate && " tahmini"}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                onClick={() => { setSelectedAsset(item); setSellShares(""); setIsOpenSellModal(true) }}
                                className="press h-8 px-2.5 rounded-md text-xs font-bold bg-warn/10 val-warn border border-warn/20 cursor-pointer"
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
                                aria-label={`${item.ticker} pozisyonunu düzenle`}
                                className="press inline-flex items-center justify-center h-8 w-8 rounded-md bg-secondary/40 text-muted-foreground border border-border/40 cursor-pointer"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button
                                onClick={() => handleDeleteAsset(item.id)}
                                aria-label={`${item.ticker} pozisyonunu sil`}
                                className="press inline-flex items-center justify-center h-8 w-8 rounded-md bg-secondary/40 text-muted-foreground border border-border/40 cursor-pointer"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        </li>
                      )
                    })}
                  </ul>

                  {/* MASAÜSTÜ - tablo.
                      Sütun sayısı 7'den 6'ya indi: "Adet" ve "Ort. Maliyet"
                      tek hücrede birleşti (ikisi de aynı soruya, "ne kadara
                      aldım", cevap veriyor) ve kod artık gri bir hapın içinde
                      değil - logo zaten ayırt ediciyi taşıyor. */}
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full t-data text-left">
                      <thead>
                        <tr className="border-b border-border/60 text-muted-foreground bg-secondary/10 h-10">
                          <th className="px-5 font-semibold">Varlık</th>
                          <th className="px-5 font-semibold text-right">Pozisyon</th>
                          <th className="px-5 font-semibold text-right">Güncel Fiyat</th>
                          <th className="px-5 font-semibold text-right">Değer</th>
                          <th className="px-5 font-semibold text-right">Toplam K/Z</th>
                          <th className="px-5 font-semibold text-right">Bugün</th>
                          <th className="px-5 font-semibold text-right w-px whitespace-nowrap">İşlem</th>
                        </tr>
                      </thead>
                      <tbody className="stagger-list">
                        {assetsList.map((item: any) => {
                          const value = item.total_value || 0.0
                          const profit = item.total_profit || 0.0
                          const profitPct = item.profit_percentage || 0.0
                          const isEstimate = !!item.daily_change_is_estimate
                          return (
                            <tr key={item.ticker} className="border-b border-border/25 hover:bg-secondary/15 transition-colors">
                              <td className="px-5 py-3">
                                <div className="flex items-center gap-2.5">
                                  <TickerLogo ticker={item.ticker} size={22} />
                                  <span className="font-bold text-foreground">{item.ticker}</span>
                                </div>
                              </td>
                              <td className="px-5 py-3 text-right font-mono">
                                <div className="text-foreground">{item.shares}</div>
                                <div className="t-caption">{tl(item.average_cost)} maliyet</div>
                              </td>
                              <td className="px-5 py-3 text-right font-mono">
                                {/* Her zaman resmî fiyat/NAV - canlı fon tahmini
                                    asla bu rakamın içine karıştırılmıyor, ayrı
                                    "Bugün" sütununda duruyor. */}
                                {tl(item.current_price || item.average_cost)}
                              </td>
                              <td className="px-5 py-3 text-right font-mono font-bold text-foreground">
                                {tl(value)}
                              </td>
                              <td className="px-5 py-3 text-right font-mono">
                                <div className={`font-bold ${profit >= 0 ? "text-emerald-400" : "text-rose-500"}`}>
                                  {tlSigned(profit)}
                                </div>
                                <div className={`t-caption ${profit >= 0 ? "text-emerald-400/80" : "text-rose-500/80"}`}>
                                  {pctSigned(profitPct, 1)}
                                </div>
                              </td>
                              <td className="px-5 py-3 text-right font-mono">
                                {item.daily_gain_value == null ? (
                                  <span className="text-muted-foreground/40">—</span>
                                ) : (
                                  <>
                                    <div className={`font-bold inline-flex items-center gap-0.5 ${dailyToneClass(item.daily_gain_value, isEstimate)}`}>
                                      {isEstimate && <Zap className="h-3 w-3 shrink-0" />}
                                      {tlSigned(item.daily_gain_value)}
                                    </div>
                                    <div className={`t-caption ${dailyToneClass(item.daily_gain_value, isEstimate)}`}>
                                      {pctSigned(item.daily_change_pct)}{isEstimate ? " tahmini" : ""}
                                    </div>
                                  </>
                                )}
                              </td>
                              <td className="px-5 py-3">
                                <div className="flex items-center justify-end gap-1.5">
                                  <button
                                    onClick={() => { setSelectedAsset(item); setSellShares(""); setIsOpenSellModal(true) }}
                                    className="press h-7 px-2.5 rounded-md text-xs font-bold bg-warn/10 val-warn border border-warn/20 hover:bg-warn/20 transition-colors cursor-pointer"
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
                                    title="Düzenle"
                                    aria-label={`${item.ticker} pozisyonunu düzenle`}
                                    className="press inline-flex items-center justify-center h-7 w-7 rounded-md bg-secondary/40 text-muted-foreground border border-border/40 hover:text-foreground transition-colors cursor-pointer"
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                  </button>
                                  <button
                                    onClick={() => handleDeleteAsset(item.id)}
                                    title="Tamamen sil"
                                    aria-label={`${item.ticker} pozisyonunu sil`}
                                    className="press inline-flex items-center justify-center h-7 w-7 rounded-md bg-secondary/40 text-muted-foreground border border-border/40 hover:text-rose-400 hover:border-rose-500/30 transition-colors cursor-pointer"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Öne Çıkanlar - eskiden iki ayrı kart (her biri kendi kenarlığı,
              kendi büyük-harf başlığı, kendi boşluğu) yan yana duruyordu;
              toplam 6 satır veri için iki kutu fazlaydı ve telefonda alt
              alta düşüp sayfayı uzatıyordu. Tek kart, içeride ince bir
              ayraçla ikiye bölünmüş hâli aynı bilgiyi çok daha az çerçeveyle
              veriyor. */}
          {(advancedMetrics.winners.length > 0 || advancedMetrics.losers.length > 0) && (
            <Card glass={true}>
              <CardHeader>
                <CardTitle className="t-section">Öne Çıkanlar</CardTitle>
                <CardDescription>Toplam kâr/zarara en çok katkı veren pozisyonlar</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 md:divide-x divide-border/40 gap-y-6">
                  {[
                    { key: "winners", label: "Kazandıranlar", rows: advancedMetrics.winners, tone: "text-emerald-400", Icon: TrendingUp, empty: "Kârda pozisyon yok." },
                    { key: "losers", label: "Kaybettirenler", rows: advancedMetrics.losers, tone: "text-rose-500", Icon: TrendingDown, empty: "Zararda pozisyon yok." },
                  ].map(({ key, label, rows, tone, Icon, empty }, i) => (
                    <div key={key} className={i === 1 ? "md:pl-6" : "md:pr-6"}>
                      <div className={`flex items-center gap-1.5 mb-2.5 ${tone}`}>
                        <Icon className="h-4 w-4 shrink-0" />
                        <span className="t-label" style={{ color: "inherit" }}>{label}</span>
                      </div>
                      {rows.length === 0 ? (
                        <p className="t-caption py-3">{empty}</p>
                      ) : (
                        <ul className="divide-y divide-border/25">
                          {rows.slice(0, 3).map((item: any) => (
                            <li key={item.ticker} className="flex items-center justify-between gap-3 py-2">
                              <div className="flex items-center gap-2 min-w-0">
                                <TickerLogo ticker={item.ticker} size={20} />
                                <span className="font-bold text-foreground truncate">{item.ticker}</span>
                              </div>
                              <div className="text-right shrink-0 font-mono">
                                <div className={`font-bold ${tone}`}>{tlSigned(item.total_profit)}</div>
                                <div className="t-caption">{pctSigned(item.profit_percentage, 1)}</div>
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Analiz: dağılım + risk. İkisi de "portföyüm nasıl kurulmuş"
            sorusuna cevap veriyor, bu yüzden aynı sekmede ve yan yana. */}
        <TabsContent value="analiz" className="mt-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">

          {/* Asset Weight Distribution (Request 6!) */}
          <Card glass={true}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-black flex items-center uppercase tracking-wider text-primary">
                  <PieIcon className="h-4.5 w-4.5 text-primary mr-2" />
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
                  <PortfolioDistributionChart data={distributionData} />
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
          </div>
        </TabsContent>

        <TabsContent value="alarmlar" className="mt-6">
          {/* Active Alerts List */}
          <Card glass={true}>
            <CardHeader>
              <CardTitle className="t-section flex items-center">
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
        </TabsContent>
      </Tabs>
    </div>
  )
}
