"use client"

import React, { useState, useEffect, useMemo } from "react"
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  PieChart, 
  Pie, 
  Cell 
} from "recharts"
import { 
  Sparkles, 
  TrendingUp, 
  TrendingDown, 
  Flame,
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
  Coins
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card"
import { Button } from "@/components/ui/Button"
import { Skeleton } from "@/components/ui/Skeleton"

// Fallback index chart points in case of connection limits
const marketData = [
  { time: "09:55", value: 10180 },
  { time: "10:30", value: 10210 },
  { time: "11:00", value: 10195 },
  { time: "12:00", value: 10220 },
  { time: "13:00", value: 10235 },
  { time: "14:00", value: 10215 },
  { time: "15:00", value: 10245 },
  { time: "16:00", value: 10260 },
  { time: "17:00", value: 10255 },
  { time: "18:00", value: 10240 },
]

export default function Home() {
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
  const [selectedIndex, setSelectedIndex] = useState<string>("XU100")
  
  // AI Signals States
  const [signals, setSignals] = useState<any[]>([])
  const [isFallbackSignals, setIsFallbackSignals] = useState(false)
  const [loadingSignals, setLoadingSignals] = useState(true)

  // Favorites States
  const [favoriteStocks, setFavoriteStocks] = useState<any[]>([])
  const [favoriteFunds, setFavoriteFunds] = useState<any[]>([])
  const [loadingFavorites, setLoadingFavorites] = useState(true)

  // Fetch index chart data dynamically when selectedIndex changes (Request 4!)
  useEffect(() => {
    fetch(`http://localhost:8000/api/v1/screener/chart/${selectedIndex}?interval=1d`)
      .then(res => {
        if (!res.ok) {
          console.warn("Index chart data not available from server");
          return [];
        }
        return res.json()
      })
      .then(data => {
        if (Array.isArray(data)) {
          const mapped = data.map(d => {
            const date = new Date(d.time * 1000)
            return {
              time: date.toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit" }),
              value: d.close
            }
          })
          setIndexChartData(mapped.slice(-15))
        }
      })
      .catch(err => console.error("Failed to load index chart data:", err))
  }, [selectedIndex])

  // Fetch all dashboard data
  useEffect(() => {
    // 1. Fetch market summary
    const fetchMarketSummary = () => {
      fetch("http://localhost:8000/api/v1/screener/market-summary")
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

    // 3. Fetch portfolio signals with auth bootstrapping (Request 2!)
    // Re-authenticates automatically if the stored token is missing, expired, or
    // otherwise invalid (401) - previously a stale token from an old session (or a
    // backend restart with a fresh DB) would silently break this panel forever,
    // since a *present* token was trusted without ever being validated.
    const authenticate = async (): Promise<string | null> => {
      const userEmail = localStorage.getItem("bip_user_email") || ""
      const userPass = localStorage.getItem("bip_user_password") || ""
      const userName = localStorage.getItem("bip_username") || ""

      if (!userEmail || !userPass) return null

      try {
        // Attempt registration (fine if it fails because the account already exists)
        await fetch("http://localhost:8000/api/v1/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: userEmail, password: userPass, full_name: userName })
        })

        // Login to get a fresh token
        const loginRes = await fetch("http://localhost:8000/api/v1/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ username: userEmail, password: userPass })
        })
        if (!loginRes.ok) return null
        const loginData = await loginRes.json()
        if (loginData.access_token) {
          localStorage.setItem("token", loginData.access_token)
          return loginData.access_token as string
        }
      } catch (e) {
        console.error("Auth bootstrapping failed:", e)
      }
      return null
    }

    const bootstrapAndLoad = async () => {
      let token = localStorage.getItem("token")
      if (!token) {
        token = await authenticate()
      }

      const fetchSignals = async (authToken: string | null) => {
        const res = await fetch("http://localhost:8000/api/v1/portfolio/signals", {
          headers: (authToken ? { "Authorization": `Bearer ${authToken}` } : {}) as Record<string, string>
        })
        return res
      }

      try {
        let res = await fetchSignals(token)

        // Token missing/expired/invalid - re-authenticate once and retry.
        if (res.status === 401) {
          localStorage.removeItem("token")
          const freshToken = await authenticate()
          if (freshToken) {
            res = await fetchSignals(freshToken)
          }
        }

        const data = await res.json()
        if (data && Array.isArray(data.signals)) {
          setSignals(data.signals)
          setIsFallbackSignals(data.is_fallback)
        }
      } catch (err) {
        console.error("Failed to fetch signals:", err)
      } finally {
        setLoadingSignals(false)
      }
    }

    // 4. Fetch details for favorites (Request 12 & 16!)
    const loadFavorites = async () => {
      const favStocksStr = localStorage.getItem("favorites_stocks")
      const favFundsStr = localStorage.getItem("favorites_funds")
      
      const favStockTickers = favStocksStr ? JSON.parse(favStocksStr) : []
      const favFundCodes = favFundsStr ? JSON.parse(favFundsStr) : []

      if (favStockTickers.length > 0) {
        try {
          const res = await fetch("http://localhost:8000/api/v1/screener/")
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
          const res = await fetch("http://localhost:8000/api/v1/funds/")
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
    bootstrapAndLoad()
    loadFavorites()

    // Market summary reads from an in-memory cache on the backend (no extra
    // network cost per call), so it can refresh close to real-time.
    const marketInterval = setInterval(fetchMarketSummary, 2000)
    // Favorites involve fetching the full stock/fund lists, so keep that on a
    // slower cadence to avoid unnecessary load.
    const favoritesInterval = setInterval(loadFavorites, 10000)

    return () => {
      clearInterval(marketInterval)
      clearInterval(favoritesInterval)
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
  const pieData = useMemo(() => [
    { name: "Pozitif", value: marketSummary.sentiment.bullish, color: "#10b981" },
    { name: "Nötr", value: marketSummary.sentiment.neutral, color: "#6b7280" },
    { name: "Negatif", value: marketSummary.sentiment.bearish, color: "#f43f5e" }
  ], [marketSummary.sentiment])

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Welcome & AI Summary Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Piraziz Yatırım Terminali</h1>
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
                      <span className={`text-[10px] font-mono mt-0.5 font-bold ${isActive ? "text-primary-foreground/90" : (chg >= 0 ? "text-emerald-400" : "text-rose-400")}`}>
                        {chg >= 0 ? "+" : ""}{chg.toFixed(2)}%
                      </span>
                    </button>
                  )
                })}
              </div>
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={indexChartData.length > 0 ? indexChartData : marketData}>
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
              </div>
            </CardContent>
          </Card>

          {/* Frantic Strateji - Piraziz AI live signal tracker (Request 2!) */}
          <Card glass={true} className="border-emerald-500/10 bg-gradient-to-br from-card via-card to-emerald-950/5">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-lg flex items-center">
                    <Sparkles className="h-5 w-5 mr-2 text-emerald-400 animate-pulse" />
                    Frantic Strateji
                  </CardTitle>
                  <CardDescription>
                    {isFallbackSignals
                      ? "Portföyünüzde hisse senedi bulunmadığı için popüler BIST 30 senetleri analiz ediliyor."
                      : "Portföyünüzdeki hisseler için canlı, çok indikatörlü sinyal takibi."
                    }
                  </CardDescription>
                </div>
                <span className="text-[10px] uppercase font-black bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2.5 py-1 rounded-full flex items-center shrink-0">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 mr-1.5 animate-pulse" />
                  Canlı Takip
                </span>
              </div>
            </CardHeader>
            <CardContent>
              {loadingSignals ? (
                <div className="space-y-3 py-1">
                  <Skeleton className="h-16 w-full rounded-xl" />
                  <Skeleton className="h-16 w-full rounded-xl" />
                  <Skeleton className="h-16 w-full rounded-xl" />
                </div>
              ) : signals.length > 0 ? (
                <div className="space-y-4">
                  {signals.map((sig, idx) => (
                    <div 
                      key={idx} 
                      className={`p-4 rounded-xl border flex flex-col md:flex-row md:items-center justify-between gap-3 transition-colors ${
                        sig.signal.includes("Güçlü AL") ? "bg-emerald-950/20 border-emerald-400/35 hover:bg-emerald-950/30" :
                        sig.signal.includes("AL") ? "bg-green-950/10 border-green-500/25 hover:bg-green-950/15" :
                        sig.signal.includes("Güçlü SAT") ? "bg-rose-950/20 border-rose-400/35 hover:bg-rose-950/30" :
                        sig.signal.includes("SAT") ? "bg-orange-950/10 border-orange-500/25 hover:bg-orange-950/15" :
                        "bg-secondary/15 border-border/30 hover:bg-secondary/25"
                      }`}
                    >
                      <div className="space-y-1.5 flex-1 min-w-0">
                        <div className="flex items-center space-x-2">
                          <span
                            onClick={() => window.location.href = `/stock/${sig.ticker}`}
                            className="text-xs font-black bg-secondary hover:bg-secondary/80 px-2.5 py-1 rounded text-foreground cursor-pointer transition-colors"
                          >
                            {sig.ticker}
                          </span>
                          <span className="text-xs font-mono font-bold">₺{sig.price.toFixed(2)}</span>
                          <span className="text-[10px] text-muted-foreground font-mono">SMA20: ₺{sig.sma20.toFixed(2)}</span>
                        </div>
                        <p className="text-xs text-muted-foreground leading-relaxed">
                          {sig.description}
                        </p>
                        {/* Live indicator score bar: how many of the 11 tracked
                            indicators currently lean bullish vs bearish */}
                        {typeof sig.buy_score === "number" && typeof sig.sell_score === "number" && (
                          <div className="flex items-center space-x-2 pt-0.5 max-w-xs">
                            <div className="flex-1 h-1.5 rounded-full bg-secondary/40 overflow-hidden flex">
                              <div
                                className="h-full bg-emerald-500"
                                style={{ width: `${(sig.buy_score / (sig.total_indicators || 11)) * 100}%` }}
                              />
                              <div
                                className="h-full bg-rose-500"
                                style={{ width: `${(sig.sell_score / (sig.total_indicators || 11)) * 100}%` }}
                              />
                            </div>
                            <span className="text-[9px] font-mono text-muted-foreground shrink-0">
                              {sig.buy_score} AL / {sig.sell_score} SAT
                            </span>
                          </div>
                        )}
                      </div>

                      <div className="flex items-center space-x-2 shrink-0">
                        <span className={`px-2.5 py-1 rounded text-[10px] font-black uppercase border ${
                          sig.signal === "Güçlü AL" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" :
                          sig.signal === "AL" ? "bg-green-500/10 text-green-400 border-green-500/20" :
                          sig.signal === "Güçlü SAT" ? "bg-rose-500/10 text-rose-400 border-rose-500/20" :
                          sig.signal === "SAT" ? "bg-orange-500/10 text-orange-400 border-orange-500/20" :
                          "bg-zinc-500/10 text-zinc-400 border-zinc-500/20"
                        }`}>
                          {sig.signal}
                        </span>
                        <span className="text-[10px] text-muted-foreground font-mono">
                          {sig.timestamp}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-center text-xs text-muted-foreground py-6">Aktif sinyal bulunmamaktadır.</p>
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
                      onClick={() => window.location.href = `/stock/${stock.ticker}`}
                      className="p-2.5 bg-secondary/25 border border-border/30 rounded-lg flex items-center justify-between cursor-pointer hover:bg-secondary/45 transition-colors"
                    >
                      <div className="flex items-center space-x-2">
                        <span className="font-bold bg-secondary px-1.5 py-0.5 rounded text-foreground">{stock.ticker}</span>
                        <span className="text-muted-foreground truncate max-w-[120px]">{stock.name}</span>
                      </div>
                      <div className="text-right">
                        <span className="font-mono font-bold">₺{stock.price.toFixed(2)}</span>
                        <span className={`block text-[10px] font-semibold ${stock.change_percent >= 0 ? "text-emerald-400" : "text-rose-500"}`}>
                          {stock.change_percent >= 0 ? "+" : ""}{stock.change_percent.toFixed(2)}%
                        </span>
                      </div>
                    </div>
                  ))}

                  {/* Funds */}
                  {favoriteFunds.map(fund => (
                    <div 
                      key={fund.code} 
                      onClick={() => window.location.href = `/funds?code=${fund.code}`}
                      className="p-2.5 bg-secondary/25 border border-border/30 rounded-lg flex items-center justify-between cursor-pointer hover:bg-secondary/45 transition-colors"
                    >
                      <div className="flex items-center space-x-2">
                        <span className="font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-1.5 py-0.5 rounded">{fund.code}</span>
                        <span className="text-muted-foreground truncate max-w-[120px]">{fund.name}</span>
                      </div>
                      <div className="text-right">
                        <span className="font-mono font-bold">₺{fund.price.toFixed(4)}</span>
                        <span className={`block text-[10px] font-semibold ${fund.daily_return >= 0 ? "text-emerald-400" : "text-rose-500"}`}>
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

          {/* AI Sentiment Gauge */}
          <Card glass={true}>
            <CardHeader>
              <CardTitle className="text-base flex items-center">
                <Flame className="h-4 w-4 text-emerald-400 mr-2" />
                Piyasa Duygu Analizi (Sentiment)
              </CardTitle>
              <CardDescription>BIST geneli canlı TradingView veri algısı</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col items-center">
              {loadingSummary ? (
                <div className="w-full flex flex-col items-center justify-center space-y-3 h-40">
                  <Skeleton className="h-28 w-28 rounded-full" />
                  <Skeleton className="h-4 w-20 rounded" />
                </div>
              ) : (
                <>
                  <div className="h-40 w-full flex items-center justify-center relative">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={pieData}
                          cx="50%"
                          cy="50%"
                          innerRadius={50}
                          outerRadius={70}
                          paddingAngle={4}
                          dataKey="value"
                        >
                          {pieData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="absolute flex flex-col items-center">
                      <span className="text-3xl font-extrabold text-emerald-400">%{marketSummary.sentiment.bullish}</span>
                      <span className="text-[10px] text-muted-foreground uppercase font-semibold">Boğa Eğilimi</span>
                    </div>
                  </div>
                  
                  {/* Legend */}
                  <div className="w-full flex items-center justify-between text-xs font-semibold px-2 mt-2">
                    <div className="flex items-center text-emerald-500">
                      <span className="h-2 w-2 rounded-full bg-emerald-500 mr-1.5" />
                      Boğa %{marketSummary.sentiment.bullish}
                    </div>
                    <div className="flex items-center text-slate-500">
                      <span className="h-2 w-2 rounded-full bg-slate-500 mr-1.5" />
                      Nötr %{marketSummary.sentiment.neutral}
                    </div>
                    <div className="flex items-center text-rose-500">
                      <span className="h-2 w-2 rounded-full bg-rose-500 mr-1.5" />
                      Ayı %{marketSummary.sentiment.bearish}
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Economy Calendar (Request 8!) */}
          <Card glass={true} className="border-purple-500/15 hover:border-purple-500/30 transition-colors duration-300">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-black flex items-center uppercase tracking-wider text-purple-400">
                <Calendar className="h-4.5 w-4.5 text-purple-400 mr-2 animate-pulse" />
                Ekonomi Takvimi
              </CardTitle>
              <CardDescription className="text-[10px] mt-0.5">Piyasa üzerinde etkili kritik makro açıklamalar</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3.5 text-xs font-semibold">
              {[
                { time: "Bugün 14:00", event: "TCMB Haftalık Para ve Banka İstatistikleri", impact: "Orta", desc: "Para arzı, yabancı rezervler ve yerleşiklerin döviz mevduatı verileri açıklanacak." },
                { time: "23 Temmuz 10:00", event: "TÜİK Tüketici Güven Endeksi (Haziran)", impact: "Yüksek", desc: "Tüketicilerin maddi durum ve genel ekonomiye yönelik eğilim endeksleri yayınlanacak." },
                { time: "24 Temmuz 17:00", event: "ABD Üretim PMI Öncü Verisi", impact: "Yüksek", desc: "Küresel piyasaların faiz indirim döngüsü beklentilerine yön verecek kritik aktivite verisi." }
              ].map((ev, idx) => (
                <div 
                  key={idx} 
                  className="p-3.5 bg-secondary/15 border border-border/30 rounded-xl space-y-2 hover:bg-purple-500/5 hover:border-purple-500/30 transition-all duration-300 transform hover:-translate-y-0.5 cursor-pointer shadow-sm hover:shadow-[0_4px_16px_rgba(168,85,247,0.06)] group"
                >
                  <div className="flex items-center justify-between font-bold text-muted-foreground text-[9px] uppercase tracking-wider">
                    <span>{ev.time}</span>
                    <span className={`px-2 py-0.5 rounded-[4px] text-[8px] font-black border ${
                      ev.impact === "Yüksek" ? "bg-rose-500/10 text-rose-400 border-rose-500/20 shadow-[0_0_8px_rgba(244,63,94,0.08)]" :
                      ev.impact === "Orta" ? "bg-amber-500/10 text-amber-400 border-amber-500/20 shadow-[0_0_8px_rgba(245,158,11,0.08)]" :
                      "bg-slate-500/10 text-slate-400 border-slate-500/20"
                    }`}>
                      Etki: {ev.impact}
                    </span>
                  </div>
                  <div>
                    <p className="font-extrabold text-foreground group-hover:text-purple-400 transition-colors leading-snug">{ev.event}</p>
                    <p className="text-[10px] text-muted-foreground/80 mt-1 font-normal leading-relaxed line-clamp-2">{ev.desc}</p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Sector Leaderboard */}
          <Card glass={true}>
            <CardHeader>
              <CardTitle className="text-base">Sektör Performansları</CardTitle>
              <CardDescription>BIST Sektör endekslerinin günlük değişimi</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {loadingSummary ? (
                <div className="space-y-3 py-1">
                  <Skeleton className="h-4.5 w-full rounded" />
                  <Skeleton className="h-4.5 w-full rounded" />
                  <Skeleton className="h-4.5 w-full rounded" />
                  <Skeleton className="h-4.5 w-full rounded" />
                </div>
              ) : marketSummary.sectors.length > 0 ? (
                marketSummary.sectors.map((sec: any) => (
                  <div key={sec.name} className="flex items-center justify-between text-sm py-1">
                    <span className="font-semibold text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
                      {sec.name}
                    </span>
                    <span className={`font-mono font-bold ${sec.up ? "text-emerald-500" : "text-rose-500"}`}>
                      {sec.change}
                    </span>
                  </div>
                ))
              ) : (
                <p className="text-xs text-muted-foreground text-center">Sektör verileri yüklenemedi.</p>
              )}
            </CardContent>
          </Card>

        </div>

      </div>
    </div>
  )
}
