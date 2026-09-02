"use client"

import React, { useState, useEffect, useMemo, useCallback, useSyncExternalStore } from "react"
import { useRouter } from "next/navigation"
import dynamic from "next/dynamic"
import {
  TrendingUp,
  TrendingDown,
  ArrowRight,
  Loader2,
  Calendar,
  Star,
  Zap,
  Newspaper,
  ExternalLink,
  Bot,
  Briefcase,
  ChevronDown,
  ArrowRightLeft,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card"
import { Skeleton } from "@/components/ui/Skeleton"
import { Badge } from "@/components/ui/Badge"
import { EmptyState } from "@/components/ui/EmptyState"
import { StatTile } from "@/components/ui/StatTile"
import EconomicCalendarWidget from "@/components/EconomicCalendarWidget"
import { API_BASE_URL } from "@/lib/config"
import { authFetch } from "@/lib/auth"
import { subscribeMarketSummary, getMarketSummarySnapshot } from "@/lib/marketSummaryStore"
import { useCurrentUser } from "@/lib/currentUserStore"
import { pollWhileVisibleAndOpen } from "@/lib/usePolling"
import { fetchWatchlist, migrateLegacyWatchlist } from "@/lib/watchlist"
import { subscribePopularFunds, getPopularFundsSnapshot } from "@/lib/popularFundsStore"

// Endeks grafiği tembel yükleniyor - gerekçe IndexAreaChart'ın kendi
// başlığında. ssr:false, çünkü recharts ölçüm için DOM'a ihtiyaç duyuyor.
const IndexAreaChart = dynamic(() => import("@/components/charts/IndexAreaChart"), {
  ssr: false,
  loading: () => (
    <div className="h-full flex items-center justify-center">
      <Loader2 className="h-6 w-6 text-muted-foreground animate-spin" />
    </div>
  ),
})

const tl = (n: number, digits = 2) =>
  `₺${n.toLocaleString("tr-TR", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`

// portfolio/page.tsx'teki aynı eşleme (hareket defteri tipleri) - "Son
// İşlemler" mini listesinde aynı Türkçe etiketler görünsün diye.
const TX_LABELS: Record<string, string> = {
  BUY: "ALIŞ",
  SELL: "SATIŞ",
  DIVIDEND: "TEMETTÜ",
  BONUS: "BEDELSİZ",
}

/**
 * Zaman dilimi kontrolü - iki gerçek veri kaynağından besleniyor, üçüncüsü
 * yok. Sunucudaki candle derinliğini SSH ile ölçtüm: XU100 için interval=1d
 * 300 bar (~1.2 yıl) dönüyor, interval=1mo 300 bar (~25 yıl) dönüyor.
 * 1A/3A/6A/1Y aynı günlük seriden dilimleniyor (tek istek); 5Y/Tümü aylık
 * seriden (yalnızca seçildiğinde, tembel çekiliyor). Gün-içi görünüm
 * (1G/1H) BİLEREK yok - XU100 için haftalık/saatlik candle güvenilirliğini
 * doğrulayamadım (bir denemede zaman aşımına uğradı); kırık bir grafik
 * göstermektense o sekmeleri hiç eklemedim.
 */
type Timeframe = "1A" | "3A" | "6A" | "1Y" | "5Y" | "TÜMÜ"
const TIMEFRAMES: { label: Timeframe; source: "daily" | "monthly"; bars: number }[] = [
  { label: "1A", source: "daily", bars: 22 },
  { label: "3A", source: "daily", bars: 65 },
  { label: "6A", source: "daily", bars: 130 },
  { label: "1Y", source: "daily", bars: 300 },
  { label: "5Y", source: "monthly", bars: 60 },
  { label: "TÜMÜ", source: "monthly", bars: 300 },
]

interface Candle {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

interface Signal {
  ticker: string
  name: string
  direction: string
  confidence: string
  entry: number | null
  stop_loss: number | null
  take_profit: number | null
  risk_reward: number | null
  captured_pnl_pct: number | null
  last_update: string
}

export default function Home() {
  const router = useRouter()
  // Piyasa özeti PAYLAŞILAN store'dan (marketSummaryStore.ts) - Header da
  // aynı uç noktayı kullanıyor ve önceden ikisi ayrı ayrı polluyordu
  // (2sn + 5sn, aynı cevap için dakikada 42 istek). Store artık tek poll
  // yapıp en kısa aralığı (burada 2sn) uyguluyor.
  const MARKET_SUMMARY_FALLBACK = {
    sentiment: { bullish: 52, neutral: 28, bearish: 20 },
    sectors: [],
    pulse: { score: 50, label: "NÖTR", sentiment: 50, trend: 50, momentum: 50, participation: 50, risk: 50 },
    index: { price: 10240.50, change_percent: 1.42 },
  }
  const marketSnapshot = useSyncExternalStore(
    useCallback((cb: () => void) => subscribeMarketSummary(cb, 2000), []),
    getMarketSummarySnapshot,
    getMarketSummarySnapshot,
  )
  const marketSummary = marketSnapshot.data ?? MARKET_SUMMARY_FALLBACK
  const loadingSummary = marketSnapshot.loading

  // --- Endeks grafiği ------------------------------------------------
  const [indexCandlesDaily, setIndexCandlesDaily] = useState<Candle[]>([])
  const [indexCandlesMonthly, setIndexCandlesMonthly] = useState<Candle[]>([])
  const [monthlyFetched, setMonthlyFetched] = useState(false)
  const [indexChartError, setIndexChartError] = useState(false)
  const [indexChartLoading, setIndexChartLoading] = useState(true)
  const [indexChartSimulated, setIndexChartSimulated] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState<string>("XU100")
  const [selectedTimeframe, setSelectedTimeframe] = useState<Timeframe>("1Y")

  const timeframeMeta = TIMEFRAMES.find(t => t.label === selectedTimeframe)!

  const loadDailyCandles = useCallback(() => {
    setIndexChartError(false)
    setIndexChartLoading(true)
    authFetch(`/screener/chart/${selectedIndex}?interval=1d`)
      .then(res => {
        if (!res.ok) throw new Error(`chart request failed: ${res.status}`)
        setIndexChartSimulated(res.headers.get("X-Chart-Simulated") === "true")
        return res.json()
      })
      .then(data => {
        if (!Array.isArray(data) || data.length === 0) throw new Error("empty chart payload")
        setIndexCandlesDaily(data)
      })
      .catch(err => {
        // Sahte bir yedek göstermek yerine hatayı yüzeye çıkar - bu dosyanın
        // daha önce yaşadığı gerçek bir prod olayının tekrarı olmasın diye
        // (bkz. aşağıdaki not): sabit ~10.200 seviyesinde uydurma bir
        // grafik, endeks gerçekte 14.132'deyken "canlı veri" gibi
        // gösteriliyordu ve besleme kesintisi "uygulama çalışmıyor" diye
        // rapor edilmişti - oysa sorun yalnızca grafikti.
        console.error("Failed to load index chart data:", err)
        setIndexCandlesDaily([])
        setIndexChartError(true)
      })
      .finally(() => setIndexChartLoading(false))
  }, [selectedIndex])

  const loadMonthlyCandles = useCallback(() => {
    authFetch(`/screener/chart/${selectedIndex}?interval=1mo`)
      .then(res => (res.ok ? res.json() : []))
      .then(data => {
        if (Array.isArray(data) && data.length > 0) setIndexCandlesMonthly(data)
      })
      .catch(err => console.error("Failed to load monthly index chart:", err))
      .finally(() => setMonthlyFetched(true))
  }, [selectedIndex])

  useEffect(() => {
    setMonthlyFetched(false)
    setIndexCandlesMonthly([])
    loadDailyCandles()
  }, [loadDailyCandles])

  useEffect(() => {
    if (timeframeMeta.source === "monthly" && !monthlyFetched) {
      loadMonthlyCandles()
    }
  }, [timeframeMeta.source, monthlyFetched, loadMonthlyCandles])

  const displayedCandles = useMemo(() => {
    const src = timeframeMeta.source === "monthly" ? indexCandlesMonthly : indexCandlesDaily
    return src.slice(-timeframeMeta.bars)
  }, [timeframeMeta, indexCandlesDaily, indexCandlesMonthly])

  const indexChartData = useMemo(() => {
    const showYear = timeframeMeta.label === "5Y" || timeframeMeta.label === "TÜMÜ"
    return displayedCandles.map(c => {
      const d = new Date(c.time * 1000)
      return {
        time: showYear
          ? d.toLocaleDateString("tr-TR", { month: "short", year: "2-digit" })
          : d.toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit" }),
        value: c.close,
      }
    })
  }, [displayedCandles, timeframeMeta])

  // Gerçek OHLC + Hacim + Önceki Kapanış - son iki candle'dan. Uydurma 52
  // haftalık yüksek/düşük YOK: bu veri ucuz bir şekilde mevcut değil, bir
  // sayı icat etmektense hiç göstermemeyi seçtim.
  const lastCandle = displayedCandles[displayedCandles.length - 1]
  const prevCandle = displayedCandles[displayedCandles.length - 2]

  const isMarketOpen = marketSummary?.market_status === "open" || marketSummary?.index?.change_percent != null

  // --- Favoriler + Yükselen/Düşen listesi (tek kaynak: /screener/) --------
  const [screenerStocks, setScreenerStocks] = useState<any[]>([])
  const [loadingScreener, setLoadingScreener] = useState(true)
  const [favStockTickers, setFavStockTickers] = useState<string[]>([])
  const [favFundCodes, setFavFundCodes] = useState<string[]>([])
  const [favoriteFunds, setFavoriteFunds] = useState<any[]>([])
  const [loadingFavoriteFunds, setLoadingFavoriteFunds] = useState(true)

  const { funds: popularFunds, loading: loadingPopularFunds } = useSyncExternalStore(
    subscribePopularFunds,
    getPopularFundsSnapshot,
    getPopularFundsSnapshot
  )
  // Fon Takip sayfasındaki aynı davranış: karta basınca dağılımı (holdings)
  // yerinde açar - popularFundsStore zaten her fon için gerçek holdings
  // dizisini taşıyor, ek istek gerekmiyor.
  const [expandedPopularCodes, setExpandedPopularCodes] = useState<Set<string>>(new Set())

  const [newsFeed, setNewsFeed] = useState<any[]>([])
  const [loadingNewsFeed, setLoadingNewsFeed] = useState(true)

  // Endeks giriş/çıkış - günde bir kez değiştiği için 2s/10s pollingine
  // dahil değil, sayfa açılışında bir kere çekiliyor (bkz. backend'in
  // index_tracker.py'si).
  const [indexChanges, setIndexChanges] = useState<any[]>([])
  const [loadingIndexChanges, setLoadingIndexChanges] = useState(true)

  // --- Portföyüm (küçük özet) ----------------------------------------
  // Gerçek veri: /portfolio/ (aktif portföyün toplam değeri/K-Z) ve
  // /portfolio/live-estimate (fonların canlı BİST fiyatıyla ağırlıklandırılmış
  // TAHMİNİ gün-içi getirisi - portfolio/page.tsx'teki aynı gerçek uç nokta,
  // "tahmini" etiketi de aynı sebeple korunuyor: bu bir NAV yeniden hesabı
  // değil). Burada portföy YOKSA otomatik oluşturulmuyor - o davranış
  // /portfolio sayfasına özel bir onboarding adımı, panodan sessizce
  // tetiklenmemeli.
  const [myPortfolio, setMyPortfolio] = useState<any>(null)
  const [loadingMyPortfolio, setLoadingMyPortfolio] = useState(true)
  const [myLiveEstimate, setMyLiveEstimate] = useState<any>(null)
  // Kartın altında kalan boş alanı doldurmak için: gerçek işlem geçmişinin
  // (portfolio/page.tsx'in "İşlem Geçmişi" modalında kullandığı AYNI uç
  // nokta) son birkaç satırı - "Az önce neler oldu" sorusuna gerçek veriyle
  // cevap veriyor, uydurma bir "aktivite" değil.
  const [recentTx, setRecentTx] = useState<any[]>([])

  useEffect(() => {
    const fetchPortfolio = () => {
      authFetch("/portfolio/")
        .then(res => (res.ok ? res.json() : []))
        .then(data => { if (Array.isArray(data)) setMyPortfolio(data[0] || null) })
        .catch(err => console.error("Failed to load portfolio summary:", err))
        .finally(() => setLoadingMyPortfolio(false))
    }
    const fetchLiveEstimate = () => {
      authFetch("/portfolio/live-estimate")
        .then(res => (res.ok ? res.json() : null))
        .then(data => { if (data) setMyLiveEstimate(data) })
        .catch(err => console.error("Failed to load portfolio live estimate:", err))
    }
    const fetchRecentTx = () => {
      authFetch("/portfolio/transactions?limit=3")
        .then(res => (res.ok ? res.json() : []))
        .then(data => { if (Array.isArray(data)) setRecentTx(data) })
        .catch(err => console.error("Failed to load recent transactions:", err))
    }
    fetchPortfolio()
    fetchLiveEstimate()
    fetchRecentTx()
    return pollWhileVisibleAndOpen(() => { fetchPortfolio(); fetchLiveEstimate(); fetchRecentTx() }, 15000)
  }, [])

  // --- Frantic Algoritmik Sinyaller (premium) -----------------------------
  const [role, setRole] = useState<string | null>(null)
  const [signals, setSignals] = useState<Signal[]>([])
  const [loadingSignals, setLoadingSignals] = useState(true)
  const isFreeTier = role === "free"

  // Paylaşılan /auth/me - bkz. currentUserStore.ts (Header/Sidebar ile aynı
  // tek istek). role null kalırken sinyal kartı hiç render edilmiyor (aşağıdaki
  // `role !== null` kapısı), o davranış korunuyor.
  const { user: currentUser, loading: userLoading } = useCurrentUser()
  useEffect(() => {
    if (userLoading) return
    setRole(currentUser?.role ?? "free")
  }, [currentUser, userLoading])

  useEffect(() => {
    if (role === null || isFreeTier) {
      setLoadingSignals(false)
      return
    }
    const fetchSignals = () => {
      authFetch(`/strategy/scan`)
        .then(res => (res.ok ? res.json() : null))
        .then(data => {
          if (data && Array.isArray(data.signals)) setSignals(data.signals)
        })
        .catch(err => console.error("Failed to load strategy signals:", err))
        .finally(() => setLoadingSignals(false))
    }
    fetchSignals()
    // Motor arka planda 3 dakikada bir yenileniyor (StrategyEngine.
    // REFRESH_INTERVAL_SECONDS) - burada daha sık sormanın bir faydası yok.
    return pollWhileVisibleAndOpen(fetchSignals, 60000)
  }, [role, isFreeTier])

  // En büyük pozisyonlar önde - portfolio/page.tsx'in "Portföy Varlıkları"
  // listesiyle aynı /portfolio/ yanıtındaki assets dizisi, ekstra istek yok.
  const portfolioAssets = useMemo(() => {
    const assets = myPortfolio?.assets || []
    return [...assets].sort((a: any, b: any) => (b.total_value || 0) - (a.total_value || 0))
  }, [myPortfolio])

  const signalsSummary = useMemo(() => {
    const scanned = signals.length
    const long = signals.filter(s => s.direction === "LONG").length
    const short = signals.filter(s => s.direction === "SHORT").length
    const activePct = scanned > 0 ? Math.round(((long + short) / scanned) * 100) : 0
    return { scanned, long, short, activePct }
  }, [signals])

  useEffect(() => {
    const fetchNewsFeed = () => {
      authFetch(`/news/`)
        .then(res => (res.ok ? res.json() : []))
        .then(data => { if (Array.isArray(data)) setNewsFeed(data.slice(0, 5)) })
        .catch(err => console.error("Failed to load news feed:", err))
        .finally(() => setLoadingNewsFeed(false))
    }

    const fetchIndexChanges = () => {
      authFetch(`/screener/index-changes?days=14`)
        .then(res => (res.ok ? res.json() : { events: [] }))
        .then(data => { if (Array.isArray(data.events)) setIndexChanges(data.events) })
        .catch(err => console.error("Failed to load index changes:", err))
        .finally(() => setLoadingIndexChanges(false))
    }

    // Tam hisse listesi artık iki tüketicisi olduğu için koşulsuz çekiliyor:
    // favori eşleştirme VE Yükselenler/Düşenler. İkincisi kullanıcının
    // favorisi olsun olmasın her zaman anlamlı olduğundan, eski "favori
    // yoksa isteği hiç atma" kısayolu burada artık geçerli değil.
    const fetchScreenerList = () => {
      authFetch(`/screener/`)
        .then(res => (res.ok ? res.json() : []))
        .then(data => { if (Array.isArray(data)) setScreenerStocks(data) })
        .catch(err => console.error("Failed to load screener list:", err))
        .finally(() => setLoadingScreener(false))
    }

    let favFundCodesLocal: string[] = []
    const loadFavoriteKeys = async () => {
      const tickers = await fetchWatchlist()
      setFavStockTickers(tickers)
      // Fon favorileri artık hesaba bağlı (sunucuda) - bkz. lib/watchlist.ts.
      // Cihazda kalmış eski localStorage listesi varsa önce hesaba taşınır.
      await migrateLegacyWatchlist("favorites_funds", "fund")
      favFundCodesLocal = await fetchWatchlist("fund")
      setFavFundCodes(favFundCodesLocal)
    }

    const loadFavoriteFunds = async () => {
      if (favFundCodesLocal.length === 0) {
        setFavoriteFunds([])
        setLoadingFavoriteFunds(false)
        return
      }
      try {
        const res = await fetch(`${API_BASE_URL}/api/v1/funds/`)
        const funds = await res.json()
        if (Array.isArray(funds)) {
          setFavoriteFunds(funds.filter((f: any) => favFundCodesLocal.includes(f.code)))
        }
      } catch (e) {
        console.error("Failed to load favorite funds:", e)
      } finally {
        setLoadingFavoriteFunds(false)
      }
    }

    // Piyasa özeti bu listede YOK - onu marketSummaryStore yürütüyor
    // (yukarıdaki useSyncExternalStore aboneliği), Header'la paylaşımlı.
    fetchNewsFeed()
    fetchIndexChanges()
    fetchScreenerList()
    loadFavoriteKeys().then(loadFavoriteFunds)

    const stopScreener = pollWhileVisibleAndOpen(fetchScreenerList, 10000)

    return () => {
      stopScreener()
    }
  }, [])

  const favoriteStocks = useMemo(
    () => screenerStocks.filter(s => favStockTickers.includes(s.ticker)),
    [screenerStocks, favStockTickers]
  )

  // En Çok Yükselenler/Düşenler - aynı /screener/ listesinden, ekstra istek
  // yok. "En Çok İşlem Gören" (hacim sıralı) BİLEREK YOK: ScreenerStockResponse
  // şemasında hacim alanı hiç bulunmuyor - onu uydurmaktansa üçüncü sütunu
  // hiç eklemedim.
  const { gainers, losers } = useMemo(() => {
    const withChange = screenerStocks.filter(s => typeof s.change_percent === "number")
    const sorted = [...withChange].sort((a, b) => b.change_percent - a.change_percent)
    return { gainers: sorted.slice(0, 5), losers: sorted.slice(-5).reverse() }
  }, [screenerStocks])

  const indexDetails = useMemo(() => {
    if (selectedIndex === "XU030") {
      return { title: "BIST 30 Endeksi (XU030)", price: marketSummary.xu030?.price || 11580.20, change: marketSummary.xu030?.change_percent || 1.68 }
    } else if (selectedIndex === "XBANK") {
      return { title: "BIST Bankacılık Endeksi (XBANK)", price: marketSummary.xbank?.price || 14250.00, change: marketSummary.xbank?.change_percent || 2.15 }
    }
    return { title: "BIST 100 Endeksi (XU100)", price: marketSummary.index?.price || 10240.50, change: marketSummary.index?.change_percent || 1.42 }
  }, [selectedIndex, marketSummary])

  const pulse = marketSummary.pulse || { score: 50, label: "NÖTR", sentiment: 50, trend: 50, momentum: 50, participation: 50, risk: 50 }

  return (
    <div className="space-y-4 max-w-[1600px] mx-auto">
      {/* Başlık */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 animate-rise">
        <div>
          <h1 className="t-display">Piyasa Özeti</h1>
          <p className="t-caption mt-1.5">Canlı piyasa verileri ve algoritmik sinyal terminali.</p>
        </div>
        <span className="bip-live text-xs bg-primary/10 border border-primary/20 px-3 py-1.5 rounded-full w-fit">
          <span className="live-dot h-1.5 w-1.5 rounded-full bg-primary" />
          Canlı Seans Aktif
        </span>
      </div>

      {/* Satır 1: Piyasa Genel Görünümü + Piyasa Nabzı + Favori Varlıklar */}
      <div className="grid grid-cols-1 xl:grid-cols-[2fr_1fr_1fr] gap-4">
        {/* Market Overview */}
        <Card className="bip-card">
          <CardHeader className="flex flex-row items-start justify-between pb-2.5 pt-4 px-4 gap-3">
            <div>
              <CardTitle className="t-section">{indexDetails.title}</CardTitle>
              <CardDescription className="text-xs mt-0.5">
                {isMarketOpen ? "Piyasa açık" : "Piyasa kapalı"} · Fiyat gelişimi
              </CardDescription>
            </div>
            <div className="text-right shrink-0">
              <div className="t-metric-index text-foreground">
                {indexDetails.price ? Number(indexDetails.price).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}
              </div>
              <span className={`text-sm font-bold font-mono flex items-center justify-end mt-0.5 ${(indexDetails.change ?? 0) >= 0 ? "val-up" : "val-down"}`}>
                {(indexDetails.change ?? 0) >= 0 ? <TrendingUp className="h-3.5 w-3.5 mr-0.5" /> : <TrendingDown className="h-3.5 w-3.5 mr-0.5" />}
                {indexDetails.change ? (indexDetails.change >= 0 ? "+" : "") + Number(indexDetails.change).toFixed(2) : "0.00"}% Bugün
              </span>
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              {/* Endeks seçimi */}
              <div className="flex items-center gap-1 p-1 bg-secondary/40 rounded-lg w-fit">
                {["XU100", "XU030", "XBANK"].map(idx => {
                  const isActive = selectedIndex === idx
                  return (
                    <button
                      key={idx}
                      onClick={() => setSelectedIndex(idx)}
                      className={`px-3 py-1.5 rounded-md text-xs font-bold transition-colors cursor-pointer ${
                        isActive ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {idx}
                    </button>
                  )
                })}
              </div>
              {/* Zaman dilimi kontrolü */}
              <div className="flex items-center gap-0.5 p-1 bg-secondary/40 rounded-lg w-fit">
                {TIMEFRAMES.map(tf => (
                  <button
                    key={tf.label}
                    onClick={() => setSelectedTimeframe(tf.label)}
                    className={`px-2.5 py-1.5 rounded-md text-[11px] font-bold transition-colors cursor-pointer ${
                      selectedTimeframe === tf.label ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {tf.label}
                  </button>
                ))}
              </div>
            </div>

            {indexChartSimulated && !indexChartLoading && (
              <div className="flex items-center gap-2 rounded-md border border-warn/30 bg-warn/10 px-3 py-2 mb-3">
                <span className="text-[11px] font-bold val-warn">Geçici veri</span>
                <span className="text-[11px] text-muted-foreground">Canlı fiyat akışı henüz bağlanmadı - gerçek piyasa verisi değildir.</span>
              </div>
            )}

            <div className="h-56 sm:h-48 w-full">
              {indexChartError ? (
                <div className="h-full w-full flex flex-col items-center justify-center gap-3 text-center px-4">
                  <p className="text-sm font-bold text-foreground">Endeks grafiği şu anda yüklenemedi</p>
                  <p className="text-xs text-muted-foreground max-w-sm">Piyasa veri bağlantısına ulaşılamıyor.</p>
                  <button onClick={loadDailyCandles} className="btn-base btn-secondary h-8 text-xs">Tekrar dene</button>
                </div>
              ) : indexChartLoading && indexChartData.length === 0 ? (
                <div className="h-full w-full flex items-center justify-center">
                  <p className="text-xs text-muted-foreground">Endeks grafiği yükleniyor...</p>
                </div>
              ) : (
                <IndexAreaChart data={indexChartData} />
              )}
            </div>

            {/* Gerçek OHLC + Hacim + Önceki Kapanış - son iki candle'dan */}
            {lastCandle && (
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mt-3 pt-3 border-t border-border/70">
                <div>
                  <div className="t-label">Açılış</div>
                  <div className="text-sm font-bold font-mono text-foreground mt-0.5">{tl(lastCandle.open)}</div>
                </div>
                <div>
                  <div className="t-label">En Yüksek</div>
                  <div className="text-sm font-bold font-mono val-up mt-0.5">{tl(lastCandle.high)}</div>
                </div>
                <div>
                  <div className="t-label">En Düşük</div>
                  <div className="text-sm font-bold font-mono val-down mt-0.5">{tl(lastCandle.low)}</div>
                </div>
                <div>
                  <div className="t-label">Hacim</div>
                  <div className="text-sm font-bold font-mono text-foreground mt-0.5">
                    {lastCandle.volume >= 1e9 ? `${(lastCandle.volume / 1e9).toFixed(2)}B` : `${(lastCandle.volume / 1e6).toFixed(1)}M`}
                  </div>
                </div>
                {prevCandle && (
                  <div>
                    <div className="t-label">Önceki Kapanış</div>
                    <div className="text-sm font-bold font-mono text-foreground mt-0.5">{tl(prevCandle.close)}</div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Portföyüm - küçük özet. Gerçek veri: /portfolio/ (toplam değer,
            toplam K/Z) ve /portfolio/live-estimate (fonların canlı BİST
            fiyatıyla ağırlıklandırılmış TAHMİNİ gün-içi getirisi - aynı
            gerçek uç nokta portfolio/page.tsx'te de kullanılıyor). */}
        <Card className="bip-card">
          <CardHeader className="pb-2.5 pt-4 px-4">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="t-section flex items-center gap-2">
                <Briefcase className="h-4 w-4 text-primary" />
                Portföyüm
              </CardTitle>
              <button onClick={() => router.push("/portfolio")} className="text-[11px] font-bold text-primary hover:text-primary-hover shrink-0 cursor-pointer">
                Detay
              </button>
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-4 pt-0">
            {loadingMyPortfolio ? (
              <Skeleton className="h-28 w-full rounded-lg" />
            ) : !myPortfolio ? (
              <EmptyState
                icon={Briefcase}
                title="Henüz portföyünüz yok"
                description="Varlık ekleyip takibe başlayın."
                className="py-6"
                action={
                  <button onClick={() => router.push("/portfolio")} className="btn-base btn-secondary h-8 text-xs">
                    Portföy Oluştur
                  </button>
                }
              />
            ) : (
              <div className="space-y-3">
                <div>
                  <div className="t-label">Toplam Değer</div>
                  <div className="t-metric text-foreground mt-0.5">{tl(myPortfolio.total_value || 0)}</div>
                  <div className={`text-xs font-bold font-mono mt-0.5 ${(myPortfolio.total_profit || 0) >= 0 ? "val-up" : "val-down"}`}>
                    {(myPortfolio.total_profit || 0) >= 0 ? "+" : ""}{tl(myPortfolio.total_profit || 0)} ({(myPortfolio.profit_percentage || 0).toFixed(2)}%)
                  </div>
                </div>
                {myLiveEstimate?.estimated_change_pct != null && (
                  <div className="rounded-lg bg-warn/[0.06] border border-warn/20 px-3 py-2">
                    <div className="flex items-center gap-1.5 t-label !text-warn">
                      <Zap className="h-3 w-3" />
                      Tahmini Bugün
                    </div>
                    <div className={`text-sm font-black font-mono mt-0.5 ${myLiveEstimate.estimated_change_pct >= 0 ? "val-up" : "val-down"}`}>
                      {myLiveEstimate.estimated_change_pct >= 0 ? "+" : ""}{myLiveEstimate.estimated_change_pct.toFixed(2)}%
                      {myLiveEstimate.estimated_daily_gain_value != null && (
                        <span className="text-xs font-bold ml-1.5">
                          ({myLiveEstimate.estimated_daily_gain_value >= 0 ? "+" : ""}{tl(myLiveEstimate.estimated_daily_gain_value)})
                        </span>
                      )}
                    </div>
                    {/* Tahmini bugünkü kazancın portföyün mevcut toplam
                        değerine eklenmiş hali - "kaç oldu" sorusunun
                        cevabı, sadece "ne kadar değişti" değil. */}
                    {myLiveEstimate.estimated_daily_gain_value != null && (
                      <div className="text-[10px] font-semibold text-muted-foreground mt-1">
                        Tahmini yeni toplam: <span className="text-foreground font-bold font-mono">{tl((myPortfolio.total_value || 0) + myLiveEstimate.estimated_daily_gain_value)}</span>
                      </div>
                    )}
                  </div>
                )}
                {portfolioAssets.length > 0 && (
                  <div>
                    <div className="t-label mb-1.5">Varlıklarım</div>
                    <div className="space-y-1">
                      {portfolioAssets.slice(0, 4).map((a: any) => {
                        // TEFAS fon kodları 3 karakterli (backend'in kendi
                        // kuralı, bkz. portfolio.py) - hisse kodları değil,
                        // bu yüzden hangi detay sayfasına gidileceğini
                        // (stok mu fon mu) buradan ayırt ediyoruz.
                        const isFundCode = a.ticker.length === 3
                        // Fonlarda daily_gain_value canlı TAHMİNİ, official_
                        // daily_gain_value ise TEFAS'ın resmen yayınladığı
                        // gerçek günlük getiri (bkz. backend/portfolio.py) -
                        // burada resmi olanı gösteriyoruz, "tahmini" etiketi
                        // olmadan bir rakam görünce gerçek sanılmasın diye.
                        const gain = a.official_daily_gain_value
                        return (
                          <div
                            key={a.ticker}
                            onClick={() => router.push(isFundCode ? `/funds?code=${a.ticker}` : `/stock/${a.ticker}`)}
                            className="flex items-center justify-between text-xs py-1 px-1.5 -mx-1.5 rounded cursor-pointer hover:bg-secondary/40"
                          >
                            <span className="font-bold text-foreground truncate">{a.ticker}</span>
                            <div className="text-right shrink-0">
                              <span className="font-mono text-foreground block">{tl(a.total_value || 0, 0)}</span>
                              {gain != null && (
                                <span className={`text-[10px] font-bold ${gain >= 0 ? "val-up" : "val-down"}`}>
                                  {gain >= 0 ? "+" : ""}{tl(gain, 0)}
                                </span>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
                {recentTx.length > 0 && (
                  <div>
                    <div className="t-label mb-1.5">Son İşlemler</div>
                    <div className="space-y-1.5">
                      {recentTx.map((t: any) => (
                        <div key={t.id} className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <Badge variant={t.transaction_type === "SELL" ? "danger" : "success"}>
                              {TX_LABELS[t.transaction_type] || t.transaction_type}
                            </Badge>
                            <span className="font-bold text-foreground truncate">{t.ticker}</span>
                          </div>
                          <span className="font-mono text-muted-foreground shrink-0">
                            {new Date(t.executed_at).toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit" })}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Favori Varlıklar */}
        <Card className="bip-card">
          <CardHeader className="flex flex-row items-center justify-between p-4 pb-2.5">
            <div>
              <CardTitle className="t-section flex items-center gap-2">
                <Star className="h-4 w-4 text-primary fill-primary" />
                Favori Varlıklar
              </CardTitle>
              <CardDescription className="text-xs mt-0.5">Hızlı erişim</CardDescription>
            </div>
            <button onClick={() => router.push("/screener")} className="text-[11px] font-bold text-primary hover:text-primary-hover shrink-0 cursor-pointer">
              Tümü
            </button>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            {(loadingScreener || loadingFavoriteFunds) ? (
              <div className="space-y-2 py-1">
                <Skeleton className="h-10 w-full rounded-lg" />
                <Skeleton className="h-10 w-full rounded-lg" />
              </div>
            ) : (favoriteStocks.length > 0 || favoriteFunds.length > 0) ? (
              <div className="space-y-1.5">
                {favoriteStocks.map(stock => (
                  <div
                    key={stock.ticker}
                    onClick={() => router.push(`/stock/${stock.ticker}`)}
                    className="p-2.5 rounded-lg flex items-center justify-between cursor-pointer hover:bg-secondary/50 transition-colors"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-bold text-xs text-foreground">{stock.ticker}</span>
                      <span className="text-xs text-muted-foreground truncate max-w-[100px]">{stock.name}</span>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="font-mono font-bold text-xs text-foreground block">{tl(stock.price)}</span>
                      <span className={`block text-[11px] font-semibold ${stock.change_percent >= 0 ? "val-up" : "val-down"}`}>
                        {stock.change_percent >= 0 ? "+" : ""}{stock.change_percent.toFixed(2)}%
                      </span>
                    </div>
                  </div>
                ))}
                {favoriteFunds.map(fund => (
                  <div
                    key={fund.code}
                    onClick={() => router.push(`/funds?code=${fund.code}`)}
                    className="p-2.5 rounded-lg flex items-center justify-between cursor-pointer hover:bg-secondary/50 transition-colors"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Badge variant="success">{fund.code}</Badge>
                      <span className="text-xs text-muted-foreground truncate max-w-[90px]">{fund.name}</span>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="font-mono font-bold text-xs text-foreground block">{tl(fund.price, 4)}</span>
                      <span className={`block text-[11px] font-semibold ${fund.daily_return >= 0 ? "val-up" : "val-down"}`}>
                        {fund.daily_return >= 0 ? "+" : ""}{fund.daily_return.toFixed(2)}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-center text-xs text-muted-foreground py-6">Favori varlığınız bulunmuyor.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Satır 2: Frantic Algoritmik Sinyaller + Sektör Performansı + Ekonomi Takvimi */}
      <div className="grid grid-cols-1 xl:grid-cols-[2fr_1fr_1fr] gap-4">
        {/* role !== null: rol bilinene kadar hiç render etme - aksi halde
            ücretsiz kullanıcıda kart bir an görünüp (role null iken) rol
            "free" olarak çözülünce kaybolurdu. Aynı "titremesin" kuralı
            Sidebar/Header'da da uygulanıyor. */}
        {role !== null && !isFreeTier && (
          <Card className="bip-card">
            <CardHeader className="p-4 pb-2.5">
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="t-section flex items-center gap-2">
                  <Bot className="h-4 w-4 text-primary" />
                  Frantic Algoritmik Sinyaller
                </CardTitle>
                <button onClick={() => router.push("/strategy")} className="inline-flex items-center gap-1 text-[11px] font-bold text-primary hover:text-primary-hover cursor-pointer shrink-0">
                  Tümü <ArrowRight className="h-3 w-3" />
                </button>
              </div>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              {loadingSignals ? (
                <Skeleton className="h-24 w-full rounded-lg" />
              ) : (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 mb-3 sm:mb-4 [&_.t-metric]:text-2xl">
                    <StatTile label="Taranan" value={String(signalsSummary.scanned)} />
                    <StatTile label="LONG" value={String(signalsSummary.long)} className="[&_.t-metric]:text-bull" />
                    <StatTile label="SHORT" value={String(signalsSummary.short)} className="[&_.t-metric]:text-bear" />
                    <StatTile label="Aktif Oran" value={`%${signalsSummary.activePct}`} />
                  </div>
                  {/* max-h + sticky başlık: 30'a kadar BIST30 sembolü tek
                      seferde kaydırmadan görünsün diye satırlar sıkı
                      (h-7), tablo kendi içinde kayıyor - sayfa değil.
                      Hepsi gösteriliyor, 8'e kırpma kaldırıldı.
                      Stop/Hedef/R:R mobilde gizli - 7 sütun 375px'te ya
                      taşıyordu ya da tabloyu kendi içinde yatay kaydırmaya
                      zorluyordu; "Tümü" zaten /strategy'e tüm sütunlarla
                      götürüyor, burada dört sütun (Sembol/Yön/Güven/Giriş)
                      karar vermek için yeterli. */}
                  <div className="bip-table-scroll max-h-72 overflow-y-auto">
                    <table className="bip-table [&_thead_tr]:sticky [&_thead_tr]:top-0 [&_tbody_td]:!py-1 [&_tbody_tr]:!h-7">
                      <thead>
                        <tr>
                          <th>Sembol</th>
                          <th>Yön</th>
                          <th className="hidden sm:table-cell">Güven</th>
                          <th className="num">Giriş</th>
                          <th className="num hidden sm:table-cell">Stop</th>
                          <th className="num hidden sm:table-cell">Hedef</th>
                          <th className="num hidden sm:table-cell">R:R</th>
                        </tr>
                      </thead>
                      <tbody>
                        {signals.filter(s => s.direction !== "NONE").map(s => (
                          <tr key={s.ticker} onClick={() => router.push(`/stock/${s.ticker}`)} className="cursor-pointer">
                            <td className="font-bold text-foreground">{s.ticker}</td>
                            <td><Badge variant={s.direction === "LONG" ? "success" : "danger"}>{s.direction}</Badge></td>
                            <td className="text-xs text-muted-foreground hidden sm:table-cell">{s.confidence}</td>
                            <td className="num">{s.entry != null ? s.entry.toFixed(2) : "—"}</td>
                            <td className="num hidden sm:table-cell">{s.stop_loss != null ? s.stop_loss.toFixed(2) : "—"}</td>
                            <td className="num hidden sm:table-cell">{s.take_profit != null ? s.take_profit.toFixed(2) : "—"}</td>
                            <td className="num hidden sm:table-cell">{s.risk_reward != null ? s.risk_reward.toFixed(2) : "—"}</td>
                          </tr>
                        ))}
                        {signals.filter(s => s.direction !== "NONE").length === 0 && (
                          <tr><td colSpan={7} className="text-center text-muted-foreground py-6">Şu an aktif sinyal yok.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        )}

        {/* Sektör Performansı - marketSummary.sectors gerçek, canlı
            kotasyonlardan hesaplanıyor (backend); önceden fetch ediliyor
            ama hiç gösterilmiyordu. */}
        <Card className="bip-card">
          <CardHeader className="p-4 pb-2.5">
            <CardTitle className="t-section">Sektör Performansı</CardTitle>
            <CardDescription className="text-xs">Günlük değişim</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2.5 p-4 pt-0">
            {loadingSummary ? (
              <div className="space-y-2.5">
                {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-4 w-full rounded" />)}
              </div>
            ) : marketSummary.sectors?.length > 0 ? (
              marketSummary.sectors.map((s: any) => {
                const pct = parseFloat(String(s.change).replace("%", "").replace(",", "."))
                const width = Math.min(100, Math.abs(pct) * 18)
                return (
                  <div key={s.name}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-muted-foreground font-semibold">{s.name}</span>
                      <span className={`font-mono font-bold ${s.up ? "val-up" : "val-down"}`}>{s.change}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-secondary/60 overflow-hidden">
                      <div className={`h-full rounded-full ${s.up ? "bg-bull" : "bg-bear"}`} style={{ width: `${width}%` }} />
                    </div>
                  </div>
                )
              })
            ) : (
              <p className="text-center text-xs text-muted-foreground py-6">Sektör verisi alınamadı.</p>
            )}
          </CardContent>
        </Card>

        <Card className="bip-card" data-reveal>
          <CardHeader className="p-4 pb-2.5">
            <CardTitle className="t-section flex items-center gap-2">
              <Calendar className="h-4 w-4 text-primary" />
              Ekonomi Takvimi
            </CardTitle>
            <CardDescription className="text-xs mt-0.5">Piyasa üzerinde etkili kritik makro açıklamalar</CardDescription>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <EconomicCalendarWidget height={280} />
          </CardContent>
        </Card>
      </div>

      {/* Endeks Giriş/Çıkış - BIST30/BIST100'ün bileşen listesindeki
          gün-be-gün gözlenen gerçek değişim (bkz. backend'in
          index_tracker.py'si). Değişiklik yoksa kart hiç gösterilmiyor -
          çoğu gün gerçekten hiçbir şey değişmiyor, boş bir kart
          göstermek yerine sessizce atlanıyor. */}
      {!loadingIndexChanges && indexChanges.length > 0 && (
        <Card className="bip-card" data-reveal>
          <CardHeader className="p-4 pb-2.5">
            <CardTitle className="t-section flex items-center gap-2">
              <ArrowRightLeft className="h-4 w-4 text-primary" />
              Endeks Giriş/Çıkış
            </CardTitle>
            <CardDescription className="text-xs">Son 14 günde BIST30/BIST100 bileşen listesindeki değişimler</CardDescription>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="flex flex-wrap gap-2">
              {indexChanges.map((e: any, i: number) => (
                <div
                  key={i}
                  className={`flex items-center gap-1.5 text-xs font-bold px-2.5 py-1.5 rounded-lg border ${
                    e.change_type === "ADDED"
                      ? "bg-bull/10 border-bull/25 text-bull"
                      : "bg-bear/10 border-bear/25 text-bear"
                  }`}
                >
                  <span>{e.ticker}</span>
                  <span className="text-[10px] font-black uppercase tracking-wide opacity-80">
                    {e.change_type === "ADDED" ? "girdi" : "çıktı"}
                  </span>
                  <span className="text-[10px] text-muted-foreground font-mono">{e.index_code}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Satır 3: Popüler Fonlar */}
      <Card className="bip-card" data-reveal>
        <CardHeader className="p-4 pb-2.5">
          <CardTitle className="t-section flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary" />
            Popüler Fonlar - Anlık Getiri
          </CardTitle>
          <CardDescription className="text-xs">
            TEFAS fonların NAV&apos;ını günde bir kez yayınlar - bu bölüm, her fonun son bilinen varlık dağılımını
            canlı BİST fiyat değişimiyle ağırlıklandırarak <strong>tahmini</strong> bir gün-içi getiri hesaplar.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          {loadingPopularFunds ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
              {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
            </div>
          ) : popularFunds.length === 0 ? (
            <p className="text-center text-xs text-muted-foreground py-6">Veri alınamadı.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 stagger">
              {popularFunds.map(f => {
                const isUp = f.estimated_change_pct >= 0
                const isExpanded = expandedPopularCodes.has(f.code)
                return (
                  <div key={f.code} className="rounded-xl bg-secondary/30 overflow-hidden lift press">
                    {/* Karta basınca /funds'a gitmek yerine (Fon Takip
                        sayfasındaki aynı davranış) dağılımı yerinde açar -
                        holdings verisi zaten popularFundsStore'da, ek istek
                        yok. /funds'a gitmek için koddaki rozete basılır. */}
                    <button
                      onClick={() => setExpandedPopularCodes(prev => {
                        const next = new Set(prev)
                        if (next.has(f.code)) next.delete(f.code)
                        else next.add(f.code)
                        return next
                      })}
                      className="w-full p-3 text-left cursor-pointer"
                    >
                      <div className="flex items-center justify-between">
                        <span
                          onClick={(e) => { e.stopPropagation(); router.push(`/funds?code=${f.code}`) }}
                          className="inline-block"
                        >
                          <Badge variant="success">{f.code}</Badge>
                        </span>
                        <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                      </div>
                      <div className="text-xs text-muted-foreground mt-1.5 truncate">{f.name}</div>
                      <div className="flex items-baseline justify-between mt-2">
                        <span className={`text-xl font-black font-mono ${isUp ? "val-up" : "val-down"}`}>
                          {isUp ? "+" : ""}{f.estimated_change_pct.toFixed(2)}%
                        </span>
                        <span className="text-[11px] text-muted-foreground">kapsam %{f.resolved_weight_pct.toFixed(0)}</span>
                      </div>
                    </button>
                    {isExpanded && (
                      <div className="border-t border-border/60 px-3 py-2 space-y-1.5 max-h-52 overflow-y-auto">
                        {f.holdings
                          .slice()
                          .sort((a: any, b: any) => b.weight - a.weight)
                          .map((h: any) => (
                            <div
                              key={h.ticker}
                              onClick={(e) => { e.stopPropagation(); router.push(`/stock/${h.ticker}`) }}
                              className="flex items-center justify-between text-xs gap-2 cursor-pointer hover:bg-secondary/40 rounded px-1 -mx-1 py-0.5"
                            >
                              <div className="flex items-baseline gap-1.5 min-w-0">
                                <span className="font-bold text-primary truncate">{h.ticker}</span>
                                <span className="text-muted-foreground/70 shrink-0">%{h.weight.toFixed(2)}</span>
                              </div>
                              {h.impact_pct != null ? (
                                <span className={`font-bold shrink-0 ${h.impact_pct >= 0 ? "val-up" : "val-down"}`}>
                                  {h.impact_pct >= 0 ? "+" : ""}{h.impact_pct.toFixed(2)}p
                                </span>
                              ) : (
                                <span className="text-muted-foreground/40 shrink-0">—</span>
                              )}
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Satır 4: Haber Akışı + Yükselenler + Düşenler */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="bip-card" data-reveal>
          <CardHeader className="flex flex-row items-center justify-between p-4 pb-2.5">
            <CardTitle className="t-section flex items-center gap-2">
              <Newspaper className="h-4 w-4 text-primary" />
              Haber Akışı
            </CardTitle>
            <button onClick={() => router.push("/news")} className="inline-flex items-center gap-1 text-[11px] font-bold text-primary hover:text-primary-hover cursor-pointer shrink-0">
              Tümü <ArrowRight className="h-3 w-3" />
            </button>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            {loadingNewsFeed ? (
              <div className="space-y-2">
                {[1, 2, 3].map(i => <Skeleton key={i} className="h-11 w-full rounded-lg" />)}
              </div>
            ) : newsFeed.length === 0 ? (
              <p className="text-center text-xs text-muted-foreground py-4">Şu an haber akışı alınamadı.</p>
            ) : (
              <div className="divide-y divide-border/60">
                {newsFeed.map((n, i) => (
                  <a key={`${n.link}-${i}`} href={n.link} target="_blank" rel="noopener noreferrer" className="flex items-start justify-between gap-3 py-2.5 hover:bg-secondary/40 rounded-lg transition-colors group px-1">
                    <div className="min-w-0">
                      <span className="text-[11px] font-bold text-primary uppercase tracking-wide">{n.source}</span>
                      <p className="text-xs font-semibold text-foreground leading-snug line-clamp-2 mt-0.5">{n.title}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span className="text-xs text-muted-foreground">{n.pub_date}</span>
                      <ExternalLink className="h-3 w-3 text-muted-foreground" />
                    </div>
                  </a>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="bip-card">
          <CardHeader className="p-4 pb-2.5">
            <CardTitle className="t-section">En Çok Yükselenler</CardTitle>
            <CardDescription className="text-xs">Günlük</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1.5 p-4 pt-0">
            {loadingScreener ? (
              <Skeleton className="h-32 w-full rounded-lg" />
            ) : gainers.length === 0 ? (
              <p className="text-center text-xs text-muted-foreground py-4">Veri alınamadı.</p>
            ) : gainers.map((s, i) => (
              <div key={s.ticker} onClick={() => router.push(`/stock/${s.ticker}`)} className="flex items-center justify-between py-3 sm:py-1.5 cursor-pointer hover:bg-secondary/40 rounded px-1.5 -mx-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-muted-foreground w-6 sm:w-4">{i + 1}</span>
                  <span className="text-sm font-bold text-foreground">{s.ticker}</span>
                </div>
                <div className="text-right">
                  <span className="font-mono font-bold text-sm text-foreground block">{tl(s.price)}</span>
                  <span className="val-up text-xs font-bold">+{s.change_percent.toFixed(2)}%</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="bip-card">
          <CardHeader className="p-4 pb-2.5">
            <CardTitle className="t-section">En Çok Düşenler</CardTitle>
            <CardDescription className="text-xs">Günlük</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1.5 p-4 pt-0">
            {loadingScreener ? (
              <Skeleton className="h-32 w-full rounded-lg" />
            ) : losers.length === 0 ? (
              <p className="text-center text-xs text-muted-foreground py-4">Veri alınamadı.</p>
            ) : losers.map((s, i) => (
              <div key={s.ticker} onClick={() => router.push(`/stock/${s.ticker}`)} className="flex items-center justify-between py-3 sm:py-1.5 cursor-pointer hover:bg-secondary/40 rounded px-1.5 -mx-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-muted-foreground w-6 sm:w-4">{i + 1}</span>
                  <span className="text-sm font-bold text-foreground">{s.ticker}</span>
                </div>
                <div className="text-right">
                  <span className="font-mono font-bold text-sm text-foreground block">{tl(s.price)}</span>
                  <span className="val-down text-xs font-bold">{s.change_percent.toFixed(2)}%</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
