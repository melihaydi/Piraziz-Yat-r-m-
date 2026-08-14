"use client"

import React, { useState, useEffect, useMemo, useCallback, useSyncExternalStore } from "react"
import { useRouter } from "next/navigation"
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer
} from "recharts"
import {
  TrendingUp,
  TrendingDown,
  ArrowRight,
  Loader2,
  Calendar,
  Star,
  Activity,
  User,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  HelpCircle,
  Coins,
  Zap,
  Newspaper,
  ExternalLink
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card"
import { Button } from "@/components/ui/Button"
import { Skeleton } from "@/components/ui/Skeleton"
import EconomicCalendarWidget from "@/components/EconomicCalendarWidget"
import { API_BASE_URL } from "@/lib/config"
import { authFetch } from "@/lib/auth"
import { pollWhileVisibleAndOpen } from "@/lib/usePolling"
import { subscribePopularFunds, getPopularFundsSnapshot } from "@/lib/popularFundsStore"

// Fallback index chart points in case of connection limits

export default function Home() {
  const router = useRouter()
  const [marketSummary, setMarketSummary] = useState<any>({
    sentiment: { bullish: 58, neutral: 24, bearish: 18 },
    sectors: [
      { name: "Teknoloji", change: "+3.24%", up: true },
      { name: "Bankacılık", change: "+2.15%", up: true },
      { name: "Ulaştırma", change: "+1.95%", up: true },
      { name: "Metal Sanayi", change: "-0.45%", up: false }
    ],
    index: { price: 10240.50, change_percent: 1.42 }
  })
  
  const [loadingSummary, setLoadingSummary] = useState(true)
  const [indexChartData, setIndexChartData] = useState<any[]>([])
  const [indexChartError, setIndexChartError] = useState(false)
  const [indexChartLoading, setIndexChartLoading] = useState(true)
  const [selectedIndex, setSelectedIndex] = useState<string>("XU100")
  
  // Popüler Fonlar - Anlık Getiri (same live estimate as /funds page) - reads
  // from a shared module-level store (popularFundsStore.ts) instead of
  // fetching independently, so navigating home -> funds -> home doesn't fire
  // a fresh request each time; only the first page to mount this session does.
  const { funds: popularFunds, loading: loadingPopularFunds } = useSyncExternalStore(
    subscribePopularFunds,
    getPopularFundsSnapshot,
    getPopularFundsSnapshot
  )

  // A short economy-news strip under the funds card - just the newest few
  // headlines from the same /news feed the full Ekonomi Haberleri page uses.
  const [newsFeed, setNewsFeed] = useState<any[]>([])
  const [loadingNewsFeed, setLoadingNewsFeed] = useState(true)

  // Favorites States
  const [favoriteStocks, setFavoriteStocks] = useState<any[]>([])
  const [favoriteFunds, setFavoriteFunds] = useState<any[]>([])
  const [loadingFavorites, setLoadingFavorites] = useState(true)

  // Fetch index chart data dynamically when selectedIndex changes (Request 4!)
  const loadIndexChart = useCallback(() => {
    setIndexChartError(false)
    setIndexChartLoading(true)
    authFetch(`/screener/chart/${selectedIndex}?interval=1d`)
      .then(res => {
        if (!res.ok) throw new Error(`chart request failed: ${res.status}`)
        return res.json()
      })
      .then(data => {
        if (!Array.isArray(data) || data.length === 0) throw new Error("empty chart payload")
        const mapped = data.map(d => {
          const date = new Date(d.time * 1000)
          return {
            time: date.toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit" }),
            value: d.close
          }
        })
        setIndexChartData(mapped.slice(-15))
      })
      .catch(err => {
        // Surface the failure instead of silently falling back to the
        // hardcoded `marketData` sample. That fallback plotted invented
        // ~10,200-level values under a "BIST 100 Endeksi (XU100)" heading
        // while the real index was at 14,132 - fabricated prices presented
        // as live market data, with nothing telling the user the feed was
        // down. Confirmed live on 2026-08-13: a backend 500 on this
        // endpoint left every free-tier user staring at that fake chart,
        // which is how the outage got reported as "the app doesn't work"
        // rather than "the chart is stale".
        console.error("Failed to load index chart data:", err)
        setIndexChartData([])
        setIndexChartError(true)
      })
      .finally(() => setIndexChartLoading(false))
  }, [selectedIndex])

  useEffect(() => { loadIndexChart() }, [loadIndexChart])

  // Fetch all dashboard data
  useEffect(() => {
    // 1. Fetch market summary
    const fetchMarketSummary = () => {
      authFetch(`/screener/market-summary`)
        .then(res => res.json())
        .then(data => {
          if (data && data.sentiment) {
            setMarketSummary(data)
          }
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
        .then(data => {
          if (Array.isArray(data)) setNewsFeed(data.slice(0, 5))
        })
        .catch(err => console.error("Failed to load news feed:", err))
        .finally(() => setLoadingNewsFeed(false))
    }

    // 4. Fetch details for favorites (Request 12 & 16!)
    const loadFavorites = async () => {
      const favStocksStr = localStorage.getItem("favorites_stocks")
      const favFundsStr = localStorage.getItem("favorites_funds")
      
      const favStockTickers = favStocksStr ? JSON.parse(favStocksStr) : []
      const favFundCodes = favFundsStr ? JSON.parse(favFundsStr) : []

      if (favStockTickers.length > 0) {
        try {
          const res = await authFetch(`/screener/`)
          const stocks = await res.json()
          if (Array.isArray(stocks)) {
            const matched = stocks.filter(s => favStockTickers.includes(s.ticker))
            setFavoriteStocks(matched)
          }
        } catch (e) {
          console.error("Failed to load favorite stocks:", e)
        }
      } else {
        setFavoriteStocks([])
      }

      if (favFundCodes.length > 0) {
        try {
          const res = await fetch(`${API_BASE_URL}/api/v1/funds/`)
          const funds = await res.json()
          if (Array.isArray(funds)) {
            const matched = funds.filter(f => favFundCodes.includes(f.code))
            setFavoriteFunds(matched)
          }
        } catch (e) {
          console.error("Failed to load favorite funds:", e)
        }
      } else {
        setFavoriteFunds([])
      }
      setLoadingFavorites(false)
    }

    // Initial fetch
    fetchMarketSummary()
    fetchNewsFeed()
    loadFavorites()

    // Market summary and favorites (which re-reads the full stock/fund
    // lists) are both live BIST price data - pollWhileVisibleAndOpen adds a
    // second gate on top of tab-visibility: the backend doesn't refresh
    // this data outside the Mon-Fri 09:30-18:15 Istanbul cash session either
    // (see bistSession.ts), so polling through evenings/weekends was pure
    // waste against a 1GB host, for numbers that were never going to move.
    const stopMarket = pollWhileVisibleAndOpen(fetchMarketSummary, 2000)
    const stopFavorites = pollWhileVisibleAndOpen(loadFavorites, 10000)

    return () => {
      stopMarket()
      stopFavorites()
    }
  }, [])

  // Dynamic index details depending on selection (Request 4!)
  const indexDetails = useMemo(() => {
    if (selectedIndex === "XU030") {
      return {
        title: "BIST 30 Endeksi (XU030)",
        price: marketSummary.xu030?.price || 11580.20,
        change: marketSummary.xu030?.change_percent || 1.68
      }
    } else if (selectedIndex === "XBANK") {
      return {
        title: "BIST Bankacılık Endeksi (XBANK)",
        price: marketSummary.xbank?.price || 14250.00,
        change: marketSummary.xbank?.change_percent || 2.15
      }
    } else {
      return {
        title: "BIST 100 Endeksi (XU100)",
        price: marketSummary.index?.price || 10240.50,
        change: marketSummary.index?.change_percent || 1.42
      }
    }
  }, [selectedIndex, marketSummary])

  // Map sentiment to Recharts structure
  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Welcome & AI Summary Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">BIP Terminal</h1>
          <p className="text-muted-foreground mt-1">TradingView canlı verileri ve yapay zekâ destekli analiz terminali.</p>
        </div>
        <div className="flex items-center space-x-3">
          <span className="text-xs bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-semibold px-3 py-1.5 rounded-full flex items-center">
            <Activity className="h-3.5 w-3.5 mr-1.5 animate-pulse" />
            Canlı Seans Aktif
          </span>
        </div>
      </div>

      {/* Grid Layout for Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Left Side: Market Chart and Signals Card (2 cols) */}
        <div className="lg:col-span-2 space-y-8">
          
          {/* Market Chart Card */}
          <Card glass={true}>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <div>
                <CardTitle className="text-lg">{indexDetails.title}</CardTitle>
                <CardDescription>Günlük Fiyat Gelişimi ve Hacim Trendi</CardDescription>
              </div>
              <div className="text-right">
                <span className="text-2xl font-bold font-mono">
                  {indexDetails.price ? Number(indexDetails.price).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "10.240,50"}
                </span>
                <span className={`text-xs font-semibold flex items-center justify-end mt-0.5 ${
                  (indexDetails.change ?? 0) >= 0 ? "text-emerald-500" : "text-rose-500"
                }`}>
                  {(indexDetails.change ?? 0) >= 0 ? <TrendingUp className="h-3.5 w-3.5 mr-0.5" /> : <TrendingDown className="h-3.5 w-3.5 mr-0.5" />}
                  {indexDetails.change ? (indexDetails.change >= 0 ? "+" : "") + Number(indexDetails.change).toFixed(2) : "+1.42"}% Bugün
                </span>
              </div>
            </CardHeader>
            <CardContent>
              {/* Index Selector Pills Row (Request 4!) */}
              <div className="flex items-center space-x-2 p-1 bg-secondary/10 border border-border/20 rounded-xl w-fit mb-6">
                {["XU100", "XU030", "XBANK"].map((idx) => {
                  const isActive = selectedIndex === idx;
                  const idxVal = idx === "XU100" ? marketSummary.index : (idx === "XU030" ? marketSummary.xu030 : marketSummary.xbank);
                  const price = idxVal?.price || (idx === "XU100" ? 10240.50 : (idx === "XU030" ? 11580.20 : 14250.00));
                  const chg = idxVal?.change_percent || (idx === "XU100" ? 1.42 : (idx === "XU030" ? 1.68 : 2.15));
                  return (
                    <button
                      key={idx}
                      onClick={() => setSelectedIndex(idx)}
                      className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex flex-col items-start min-w-[95px] border ${
                        isActive 
                          ? "bg-primary text-primary-foreground border-primary/20 shadow-md shadow-primary/10" 
                          : "bg-transparent border-transparent hover:bg-secondary/40 text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <span className="font-extrabold">{idx}</span>
                      <span className={`text-xs font-mono mt-0.5 font-bold ${isActive ? "text-primary-foreground/90" : (chg >= 0 ? "text-emerald-400" : "text-rose-400")}`}>
                        {chg >= 0 ? "+" : ""}{chg.toFixed(2)}%
                      </span>
                    </button>
                  )
                })}
              </div>
              <div className="h-72 w-full">
                {indexChartError ? (
                  <div className="h-full w-full flex flex-col items-center justify-center gap-3 text-center px-4">
                    <p className="text-sm font-bold text-foreground">Endeks grafiği şu anda yüklenemedi</p>
                    <p className="text-xs text-muted-foreground max-w-sm">
                      Piyasa veri bağlantısına ulaşılamıyor. Sayfadaki diğer veriler etkilenmemiş olabilir.
                    </p>
                    <button
                      onClick={loadIndexChart}
                      className="mt-1 h-8 px-3 rounded-md border border-input bg-secondary/40 text-xs font-bold text-foreground hover:bg-secondary/60 cursor-pointer"
                    >
                      Tekrar dene
                    </button>
                  </div>
                ) : indexChartLoading && indexChartData.length === 0 ? (
                  <div className="h-full w-full flex items-center justify-center">
                    <p className="text-xs text-muted-foreground">Endeks grafiği yükleniyor...</p>
                  </div>
                ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={indexChartData}>
                    <defs>
                      <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.25}/>
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                    <XAxis dataKey="time" stroke="#71717a" fontSize={11} tickLine={false} />
                    <YAxis stroke="#71717a" fontSize={11} tickLine={false} domain={['dataMin - 100', 'dataMax + 100']} />
                    <Tooltip 
                      contentStyle={{ backgroundColor: "#18181b", borderColor: "#27272a", borderRadius: "8px" }}
                      labelStyle={{ color: "#a1a1aa" }}
                      itemStyle={{ color: "#fff" }}
                    />
                    <Area type="monotone" dataKey="value" stroke="#10b981" strokeWidth={2.5} fillOpacity={1} fill="url(#colorValue)" />
                  </AreaChart>
                </ResponsiveContainer>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Popüler Fonlar - Anlık Getiri (moved here from /funds page, same
              live-estimate endpoint and disclaimer text). */}
          <Card glass={true} className="border-amber-500/20">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center">
                <Zap className="h-5 w-5 mr-2 text-amber-400" />
                Popüler Fonlar - Anlık Getiri
              </CardTitle>
              <CardDescription className="text-xs">
                TEFAS fonların NAV&apos;ını günde bir kez yayınlar - bu bölüm, her fonun son bilinen varlık dağılımını o
                varlıkların canlı BİST fiyat değişimiyle ağırlıklandırarak <strong>tahmini</strong> bir gün-içi getiri
                hesaplar. Gerçek bir NAV yeniden hesaplaması değildir.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loadingPopularFunds ? (
                <div className="space-y-3 py-1">
                  <Skeleton className="h-16 w-full rounded-xl" />
                  <Skeleton className="h-16 w-full rounded-xl" />
                  <Skeleton className="h-16 w-full rounded-xl" />
                </div>
              ) : popularFunds.length === 0 ? (
                <p className="text-center text-xs text-muted-foreground py-6">Veri alınamadı.</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                  {popularFunds.map(f => {
                    const isUp = f.estimated_change_pct >= 0
                    return (
                      <div
                        key={f.code}
                        onClick={() => router.push(`/funds?code=${f.code}`)}
                        className="border border-border/40 rounded-xl bg-secondary/10 p-3 cursor-pointer hover:bg-secondary/20 transition-colors"
                      >
                        <div className="flex items-center justify-between">
                          <span className="bg-amber-500 text-amber-950 font-black px-2 py-0.5 rounded text-xs">
                            {f.code}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground mt-1.5 truncate">{f.name}</div>
                        <div className="flex items-baseline justify-between mt-2">
                          <span className={`text-xl font-black font-mono ${isUp ? "text-emerald-400" : "text-rose-500"}`}>
                            {isUp ? "+" : ""}{f.estimated_change_pct.toFixed(2)}%
                          </span>
                          <span className="text-[11px] text-muted-foreground">
                            kapsam %{f.resolved_weight_pct.toFixed(0)}
                          </span>
                        </div>
                        {f.fund_size && (
                          <div className="text-[11px] text-muted-foreground mt-1">Fon Büyüklüğü: {f.fund_size}</div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Ekonomi haberleri akışı - just the newest few headlines, sitting
              directly under the funds card. The full list lives at /news. */}
          <Card glass={true} className="border-purple-500/20">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="text-lg flex items-center">
                  <Newspaper className="h-5 w-5 mr-2 text-purple-400" />
                  Ekonomi Haberleri
                </CardTitle>
                <button
                  onClick={() => router.push("/news")}
                  className="inline-flex items-center gap-1 text-xs font-bold text-purple-400 hover:text-purple-300 transition-colors cursor-pointer shrink-0"
                >
                  Tümü
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              {loadingNewsFeed ? (
                <div className="space-y-2 py-1">
                  <Skeleton className="h-11 w-full rounded-lg" />
                  <Skeleton className="h-11 w-full rounded-lg" />
                  <Skeleton className="h-11 w-full rounded-lg" />
                </div>
              ) : newsFeed.length === 0 ? (
                <p className="text-center text-xs text-muted-foreground py-4">Şu an haber akışı alınamadı.</p>
              ) : (
                <div className="divide-y divide-border/40 -mx-2">
                  {newsFeed.map((n, i) => (
                    <a
                      key={`${n.link}-${i}`}
                      href={n.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-start justify-between gap-3 px-2 py-2.5 hover:bg-secondary/25 rounded-lg transition-colors group"
                    >
                      <div className="min-w-0">
                        <span className="text-xs font-bold text-purple-400 uppercase tracking-wide">{n.source}</span>
                        <p className="text-xs font-semibold text-foreground leading-snug line-clamp-2 mt-0.5 group-hover:text-purple-200 transition-colors">
                          {n.title}
                        </p>
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

        </div>

        {/* Right Side Widgets (1 col) */}
        <div className="space-y-8">
          
          {/* Favorites Widget (Request 12 & 16!) */}
          <Card glass={true}>
            <CardHeader>
              <CardTitle className="text-base flex items-center">
                <Star className="h-4.5 w-4.5 text-amber-400 mr-2 fill-amber-400" />
                Favori Varlıklar
              </CardTitle>
              <CardDescription>Hızlı erişim hisseleri ve fon takibi</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingFavorites ? (
                <div className="space-y-2 py-1">
                  <Skeleton className="h-10 w-full rounded-lg" />
                  <Skeleton className="h-10 w-full rounded-lg" />
                </div>
              ) : (favoriteStocks.length > 0 || favoriteFunds.length > 0) ? (
                <div className="space-y-3 text-xs">
                  {/* Stocks */}
                  {favoriteStocks.map(stock => (
                    <div 
                      key={stock.ticker} 
                      onClick={() => router.push(`/stock/${stock.ticker}`)}
                      className="p-2.5 bg-secondary/25 border border-border/30 rounded-lg flex items-center justify-between cursor-pointer hover:bg-secondary/45 transition-colors"
                    >
                      <div className="flex items-center space-x-2">
                        <span className="font-bold bg-secondary px-1.5 py-0.5 rounded text-foreground">{stock.ticker}</span>
                        <span className="text-muted-foreground truncate max-w-[120px]">{stock.name}</span>
                      </div>
                      <div className="text-right">
                        <span className="font-mono font-bold">₺{stock.price.toFixed(2)}</span>
                        <span className={`block text-xs font-semibold ${stock.change_percent >= 0 ? "text-emerald-400" : "text-rose-500"}`}>
                          {stock.change_percent >= 0 ? "+" : ""}{stock.change_percent.toFixed(2)}%
                        </span>
                      </div>
                    </div>
                  ))}

                  {/* Funds */}
                  {favoriteFunds.map(fund => (
                    <div 
                      key={fund.code} 
                      onClick={() => router.push(`/funds?code=${fund.code}`)}
                      className="p-2.5 bg-secondary/25 border border-border/30 rounded-lg flex items-center justify-between cursor-pointer hover:bg-secondary/45 transition-colors"
                    >
                      <div className="flex items-center space-x-2">
                        <span className="font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-1.5 py-0.5 rounded">{fund.code}</span>
                        <span className="text-muted-foreground truncate max-w-[120px]">{fund.name}</span>
                      </div>
                      <div className="text-right">
                        <span className="font-mono font-bold">₺{fund.price.toFixed(4)}</span>
                        <span className={`block text-xs font-semibold ${fund.daily_return >= 0 ? "text-emerald-400" : "text-rose-500"}`}>
                          {fund.daily_return >= 0 ? "+" : ""}{fund.daily_return.toFixed(2)}%
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-center text-xs text-muted-foreground py-4">
                  Favori varlığınız bulunmuyor.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Economy Calendar - real, live TradingView widget (previously a
              hardcoded 3-event array that never changed). Moved up (was
              below the sentiment gauge, now removed) and shrunk a bit -
              this card doesn't need to be as tall as the market chart. */}
          <Card glass={true} className="border-purple-500/15 hover:border-purple-500/30 transition-colors duration-300">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-black flex items-center uppercase tracking-wider text-purple-400">
                <Calendar className="h-4.5 w-4.5 text-purple-400 mr-2 animate-pulse" />
                Ekonomi Takvimi
              </CardTitle>
              <CardDescription className="text-xs mt-0.5">Piyasa üzerinde etkili kritik makro açıklamalar (canlı, TradingView)</CardDescription>
            </CardHeader>
            <CardContent>
              <EconomicCalendarWidget height={320} />
            </CardContent>
          </Card>

          {/* Index Performance - replaces the old sector-average leaderboard.
              Real live quotes for BIST's 5 headline indices (see
              /screener/market-summary), not sector averages computed from
              the tracked-ticker sample. */}
          <Card glass={true}>
            <CardHeader>
              <CardTitle className="text-base">Endeks Performansları</CardTitle>
              <CardDescription>BIST endekslerinin günlük değişimi</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {loadingSummary ? (
                <div className="space-y-3 py-1">
                  <Skeleton className="h-4.5 w-full rounded" />
                  <Skeleton className="h-4.5 w-full rounded" />
                  <Skeleton className="h-4.5 w-full rounded" />
                  <Skeleton className="h-4.5 w-full rounded" />
                  <Skeleton className="h-4.5 w-full rounded" />
                </div>
              ) : (
                [
                  { name: "XU100", label: "BIST 100", data: marketSummary.index },
                  { name: "XU030", label: "BIST 30", data: marketSummary.xu030 },
                  { name: "XUTUM", label: "BIST Tüm", data: marketSummary.xutum },
                  { name: "XU500", label: "BIST 500", data: marketSummary.xu500 },
                  { name: "XU050", label: "BIST 50", data: marketSummary.xu050 },
                ].map(idx => {
                  const chg = idx.data?.change_percent
                  const up = (chg ?? 0) >= 0
                  return (
                    <div key={idx.name} className="flex items-center justify-between text-sm py-1">
                      <div className="flex flex-col">
                        <span className="font-semibold text-foreground">{idx.name}</span>
                        <span className="text-xs text-muted-foreground">{idx.label}</span>
                      </div>
                      <div className="flex flex-col items-end">
                        <span className="font-mono text-xs text-muted-foreground">
                          {idx.data?.price != null ? idx.data.price.toLocaleString("tr-TR", { maximumFractionDigits: 2 }) : "—"}
                        </span>
                        <span className={`font-mono font-bold ${up ? "text-emerald-500" : "text-rose-500"}`}>
                          {chg != null ? `${up ? "+" : ""}${chg.toFixed(2)}%` : "—"}
                        </span>
                      </div>
                    </div>
                  )
                })
              )}
            </CardContent>
          </Card>

        </div>

      </div>
    </div>
  )
}
