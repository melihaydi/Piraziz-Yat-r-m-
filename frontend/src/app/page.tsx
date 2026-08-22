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
  Layers,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card"
import { Skeleton } from "@/components/ui/Skeleton"
import { Badge } from "@/components/ui/Badge"
import { ScoreGauge } from "@/components/ui/ScoreGauge"
import { StatTile } from "@/components/ui/StatTile"
import EconomicCalendarWidget from "@/components/EconomicCalendarWidget"
import { API_BASE_URL } from "@/lib/config"
import { authFetch } from "@/lib/auth"
import { pollWhileVisibleAndOpen } from "@/lib/usePolling"
import { fetchWatchlist } from "@/lib/watchlist"
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
  const [marketSummary, setMarketSummary] = useState<any>({
    sentiment: { bullish: 52, neutral: 28, bearish: 20 },
    sectors: [],
    pulse: { score: 50, label: "NÖTR", sentiment: 50, trend: 50, momentum: 50, participation: 50, risk: 50 },
    index: { price: 10240.50, change_percent: 1.42 },
  })
  const [loadingSummary, setLoadingSummary] = useState(true)

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

  const [newsFeed, setNewsFeed] = useState<any[]>([])
  const [loadingNewsFeed, setLoadingNewsFeed] = useState(true)

  // --- Frantic Algoritmik Sinyaller (premium) -----------------------------
  const [role, setRole] = useState<string | null>(null)
  const [signals, setSignals] = useState<Signal[]>([])
  const [loadingSignals, setLoadingSignals] = useState(true)
  const isFreeTier = role === "free"

  useEffect(() => {
    authFetch("/auth/me")
      .then(res => (res.ok ? res.json() : null))
      .then(data => { if (data?.role) setRole(data.role) })
      .catch(() => setRole("free"))
  }, [])

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

  const signalsSummary = useMemo(() => {
    const scanned = signals.length
    const long = signals.filter(s => s.direction === "LONG").length
    const short = signals.filter(s => s.direction === "SHORT").length
    const activePct = scanned > 0 ? Math.round(((long + short) / scanned) * 100) : 0
    return { scanned, long, short, activePct }
  }, [signals])

  useEffect(() => {
    const fetchMarketSummary = () => {
      authFetch(`/screener/market-summary`)
        .then(res => res.json())
        .then(data => {
          if (data && data.sentiment) setMarketSummary(data)
          setLoadingSummary(false)
        })
        .catch(err => {
          console.error("Failed to load market summary:", err)
          setLoadingSummary(false)
        })
    }

    const fetchNewsFeed = () => {
      authFetch(`/news/`)
        .then(res => (res.ok ? res.json() : []))
        .then(data => { if (Array.isArray(data)) setNewsFeed(data.slice(0, 5)) })
        .catch(err => console.error("Failed to load news feed:", err))
        .finally(() => setLoadingNewsFeed(false))
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
      const favFundsStr = localStorage.getItem("favorites_funds")
      try {
        const parsed = favFundsStr ? JSON.parse(favFundsStr) : []
        if (Array.isArray(parsed)) favFundCodesLocal = parsed
      } catch {
        // Bozuk yerel veri favori kartını çökertmesin.
      }
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

    fetchMarketSummary()
    fetchNewsFeed()
    fetchScreenerList()
    loadFavoriteKeys().then(loadFavoriteFunds)

    const stopMarket = pollWhileVisibleAndOpen(fetchMarketSummary, 2000)
    const stopScreener = pollWhileVisibleAndOpen(fetchScreenerList, 10000)

    return () => {
      stopMarket()
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
    <div className="space-y-6 max-w-[1600px] mx-auto">
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
      <div className="grid grid-cols-1 xl:grid-cols-[2fr_1fr_1fr] gap-6">
        {/* Market Overview */}
        <Card className="bip-card">
          <CardHeader className="flex flex-row items-start justify-between pb-3 gap-3">
            <div>
              <CardTitle className="t-section">{indexDetails.title}</CardTitle>
              <CardDescription className="text-xs mt-0.5">
                {isMarketOpen ? "Piyasa açık" : "Piyasa kapalı"} · Fiyat gelişimi
              </CardDescription>
            </div>
            <div className="text-right shrink-0">
              <div className="t-metric-lg text-foreground">
                {indexDetails.price ? Number(indexDetails.price).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}
              </div>
              <span className={`text-sm font-bold font-mono flex items-center justify-end mt-0.5 ${(indexDetails.change ?? 0) >= 0 ? "val-up" : "val-down"}`}>
                {(indexDetails.change ?? 0) >= 0 ? <TrendingUp className="h-3.5 w-3.5 mr-0.5" /> : <TrendingDown className="h-3.5 w-3.5 mr-0.5" />}
                {indexDetails.change ? (indexDetails.change >= 0 ? "+" : "") + Number(indexDetails.change).toFixed(2) : "0.00"}% Bugün
              </span>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
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

            <div className="h-64 w-full">
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
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-5 pt-4 border-t border-border/70">
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

        {/* Piyasa Nabzı - gerçek canlı kotasyon genişliğinden (breadth)
            hesaplanan bir bileşim skoru (bkz. ScoringService.
            calculate_market_pulse). "AI" DENMİYOR bilerek - bir dil modeli
            çıktısı değil, şeffaf bir istatistik. */}
        <Card className="bip-card">
          <CardHeader className="pb-3">
            <CardTitle className="t-section flex items-center gap-2">
              <Layers className="h-4 w-4 text-primary" />
              Piyasa Nabzı
            </CardTitle>
            <CardDescription className="text-xs">Canlı kotasyon genişliğinden hesaplanan piyasa sağlığı</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-4">
            {loadingSummary ? (
              <Skeleton className="h-32 w-32 rounded-full" />
            ) : (
              <ScoreGauge score={pulse.score} label={pulse.label} size={132} />
            )}
            <div className="w-full space-y-2">
              {[
                { key: "trend", label: "Trend" },
                { key: "momentum", label: "Momentum" },
                { key: "participation", label: "Katılım" },
                { key: "risk", label: "Risk", invert: true },
                { key: "sentiment", label: "Sentiment" },
              ].map(row => {
                const val = pulse[row.key] ?? 50
                // Risk için yüksek değer olumsuz - renk yönü tersine çevriliyor.
                const good = row.invert ? val < 40 : val >= 60
                const bad = row.invert ? val > 60 : val <= 40
                return (
                  <div key={row.key} className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground font-semibold">{row.label}</span>
                    <span className={`font-mono font-bold ${good ? "val-up" : bad ? "val-down" : "text-foreground"}`}>
                      {Math.round(val)}
                    </span>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>

        {/* Favori Varlıklar */}
        <Card className="bip-card">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
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
          <CardContent>
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
      <div className="grid grid-cols-1 xl:grid-cols-[2fr_1fr_1fr] gap-6">
        {/* role !== null: rol bilinene kadar hiç render etme - aksi halde
            ücretsiz kullanıcıda kart bir an görünüp (role null iken) rol
            "free" olarak çözülünce kaybolurdu. Aynı "titremesin" kuralı
            Sidebar/Header'da da uygulanıyor. */}
        {role !== null && !isFreeTier && (
          <Card className="bip-card">
            <CardHeader className="pb-3">
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
            <CardContent>
              {loadingSignals ? (
                <Skeleton className="h-24 w-full rounded-lg" />
              ) : (
                <>
                  <div className="grid grid-cols-4 gap-3 mb-4">
                    <StatTile label="Taranan" value={String(signalsSummary.scanned)} />
                    <StatTile label="LONG" value={String(signalsSummary.long)} className="[&_.t-metric]:text-bull" />
                    <StatTile label="SHORT" value={String(signalsSummary.short)} className="[&_.t-metric]:text-bear" />
                    <StatTile label="Aktif Oran" value={`%${signalsSummary.activePct}`} />
                  </div>
                  <div className="bip-table-scroll">
                    <table className="bip-table">
                      <thead>
                        <tr>
                          <th>Sembol</th>
                          <th>Yön</th>
                          <th>Güven</th>
                          <th className="num">Giriş</th>
                          <th className="num">Stop</th>
                          <th className="num">Hedef</th>
                          <th className="num">R:R</th>
                        </tr>
                      </thead>
                      <tbody>
                        {signals.filter(s => s.direction !== "NONE").slice(0, 8).map(s => (
                          <tr key={s.ticker} onClick={() => router.push(`/stock/${s.ticker}`)} className="cursor-pointer">
                            <td className="font-bold text-foreground">{s.ticker}</td>
                            <td><Badge variant={s.direction === "LONG" ? "success" : "danger"}>{s.direction}</Badge></td>
                            <td className="text-xs text-muted-foreground">{s.confidence}</td>
                            <td className="num">{s.entry != null ? s.entry.toFixed(2) : "—"}</td>
                            <td className="num">{s.stop_loss != null ? s.stop_loss.toFixed(2) : "—"}</td>
                            <td className="num">{s.take_profit != null ? s.take_profit.toFixed(2) : "—"}</td>
                            <td className="num">{s.risk_reward != null ? s.risk_reward.toFixed(2) : "—"}</td>
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
          <CardHeader className="pb-3">
            <CardTitle className="t-section">Sektör Performansı</CardTitle>
            <CardDescription className="text-xs">Günlük değişim</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2.5">
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
          <CardHeader className="pb-3">
            <CardTitle className="t-section flex items-center gap-2">
              <Calendar className="h-4 w-4 text-primary" />
              Ekonomi Takvimi
            </CardTitle>
            <CardDescription className="text-xs mt-0.5">Piyasa üzerinde etkili kritik makro açıklamalar</CardDescription>
          </CardHeader>
          <CardContent>
            <EconomicCalendarWidget height={280} />
          </CardContent>
        </Card>
      </div>

      {/* Satır 3: Popüler Fonlar */}
      <Card className="bip-card" data-reveal>
        <CardHeader className="pb-3">
          <CardTitle className="t-section flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary" />
            Popüler Fonlar - Anlık Getiri
          </CardTitle>
          <CardDescription className="text-xs">
            TEFAS fonların NAV&apos;ını günde bir kez yayınlar - bu bölüm, her fonun son bilinen varlık dağılımını
            canlı BİST fiyat değişimiyle ağırlıklandırarak <strong>tahmini</strong> bir gün-içi getiri hesaplar.
          </CardDescription>
        </CardHeader>
        <CardContent>
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
                return (
                  <div
                    key={f.code}
                    onClick={() => router.push(`/funds?code=${f.code}`)}
                    className="rounded-xl bg-secondary/30 p-3 cursor-pointer hover:bg-secondary/50 transition-colors lift press"
                  >
                    <Badge variant="success">{f.code}</Badge>
                    <div className="text-xs text-muted-foreground mt-1.5 truncate">{f.name}</div>
                    <div className="flex items-baseline justify-between mt-2">
                      <span className={`text-xl font-black font-mono ${isUp ? "val-up" : "val-down"}`}>
                        {isUp ? "+" : ""}{f.estimated_change_pct.toFixed(2)}%
                      </span>
                      <span className="text-[11px] text-muted-foreground">kapsam %{f.resolved_weight_pct.toFixed(0)}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Satır 4: Haber Akışı + Yükselenler + Düşenler */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="bip-card" data-reveal>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="t-section flex items-center gap-2">
              <Newspaper className="h-4 w-4 text-primary" />
              Haber Akışı
            </CardTitle>
            <button onClick={() => router.push("/news")} className="inline-flex items-center gap-1 text-[11px] font-bold text-primary hover:text-primary-hover cursor-pointer shrink-0">
              Tümü <ArrowRight className="h-3 w-3" />
            </button>
          </CardHeader>
          <CardContent className="pt-0">
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
          <CardHeader className="pb-3">
            <CardTitle className="t-section">En Çok Yükselenler</CardTitle>
            <CardDescription className="text-xs">Günlük</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {loadingScreener ? (
              <Skeleton className="h-32 w-full rounded-lg" />
            ) : gainers.length === 0 ? (
              <p className="text-center text-xs text-muted-foreground py-4">Veri alınamadı.</p>
            ) : gainers.map((s, i) => (
              <div key={s.ticker} onClick={() => router.push(`/stock/${s.ticker}`)} className="flex items-center justify-between py-1.5 cursor-pointer hover:bg-secondary/40 rounded px-1.5 -mx-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-muted-foreground w-3">{i + 1}</span>
                  <span className="text-xs font-bold text-foreground">{s.ticker}</span>
                </div>
                <div className="text-right">
                  <span className="font-mono font-bold text-xs text-foreground block">{tl(s.price)}</span>
                  <span className="val-up text-[11px] font-bold">+{s.change_percent.toFixed(2)}%</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="bip-card">
          <CardHeader className="pb-3">
            <CardTitle className="t-section">En Çok Düşenler</CardTitle>
            <CardDescription className="text-xs">Günlük</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {loadingScreener ? (
              <Skeleton className="h-32 w-full rounded-lg" />
            ) : losers.length === 0 ? (
              <p className="text-center text-xs text-muted-foreground py-4">Veri alınamadı.</p>
            ) : losers.map((s, i) => (
              <div key={s.ticker} onClick={() => router.push(`/stock/${s.ticker}`)} className="flex items-center justify-between py-1.5 cursor-pointer hover:bg-secondary/40 rounded px-1.5 -mx-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-muted-foreground w-3">{i + 1}</span>
                  <span className="text-xs font-bold text-foreground">{s.ticker}</span>
                </div>
                <div className="text-right">
                  <span className="font-mono font-bold text-xs text-foreground block">{tl(s.price)}</span>
                  <span className="val-down text-[11px] font-bold">{s.change_percent.toFixed(2)}%</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
