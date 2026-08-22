"use client"

import React, { useState, useEffect, useMemo, useCallback } from "react"
import { useRouter } from "next/navigation"
import dynamic from "next/dynamic"
import { Search, Sparkles, Filter, RefreshCw, Loader2, ArrowUpDown, Star, Eye, EyeOff, Scale, X, FileSearch } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card"
import { Button } from "@/components/ui/Button"
import { Input } from "@/components/ui/Input"
import { Skeleton } from "@/components/ui/Skeleton"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/Dialog"
import TradingViewChart from "@/components/TradingViewChart"
import { TickerLogo } from "@/components/ui/TickerLogo"
import { authFetch } from "@/lib/auth"
import { CHART_TIMEFRAMES, MAX_SIMULATED_CHART_RETRIES } from "@/lib/chartTimeframes"
import { pollWhileVisibleAndOpen } from "@/lib/usePolling"

// AI Skoru'ndan dürüst bir yön etiketi - backend'in calculate_ai_score_details'i
// (score-details uç noktasının kaynağı) sonucu aynı eşiklerle Pozitif/Negatif/
// Nötr'e ayırıyor (score>=70 Pozitif, <45 Negatif). Burada tablo satırı başına
// score-details çağırmak 87 hisse için 87 istek demek olacağından, aynı eşiği
// listede zaten var olan ai_score alanına uyguluyoruz - ekstra istek yok.
function signalFromScore(score: number): "LONG" | "SHORT" | "NÖTR" {
  if (score >= 70) return "LONG"
  if (score < 45) return "SHORT"
  return "NÖTR"
}

import { COMPARE_COLORS } from "@/lib/chartColors"

// Karşılaştırma grafiği tembel yükleniyor - gerekçe bileşenin kendi
// başlığında. Grafik yalnızca kullanıcı hisse karşılaştırması açtığında
// çiziliyor, o yüzden recharts'ın sayfa açılışında inmesi gereksizdi.
const ComparisonLineChart = dynamic(() => import("@/components/charts/ComparisonLineChart"), {
  ssr: false,
  loading: () => (
    <div className="h-full flex items-center justify-center">
      <Loader2 className="h-6 w-6 text-muted-foreground animate-spin" />
    </div>
  ),
})

function buildStockComparisonChartData(stocks: any[]) {
  const withCandles = stocks.filter((s) => Array.isArray(s.candles) && s.candles.length > 0)
  if (withCandles.length === 0) return []
  const minLen = Math.min(...withCandles.map((s) => s.candles.length))
  if (minLen === 0) return []
  const trimmed = withCandles.map((s) => s.candles.slice(-minLen))
  const rows: any[] = []
  for (let i = 0; i < minLen; i++) {
    const row: any = { time: trimmed[0][i]?.time }
    withCandles.forEach((s, idx) => {
      const base = trimmed[idx][0]?.close
      const cur = trimmed[idx][i]?.close
      row[s.ticker] = base ? Number((((cur / base) - 1) * 100).toFixed(2)) : 0
    })
    rows.push(row)
  }
  return rows
}

// Memoized row: only re-renders when this specific stock's own data (or its
// favorite/selected state) actually changes, instead of every row re-rendering
// on every ~2s poll just because the parent's `companies` array reference changed.
const StockRow = React.memo(function StockRow({
  comp,
  isFav,
  isSelected,
  isCompared,
  compareDisabled,
  onSelect,
  onToggleFavorite,
  onToggleCompare,
}: {
  comp: any
  isFav: boolean
  isSelected: boolean
  isCompared: boolean
  compareDisabled: boolean
  onSelect: (ticker: string) => void
  onToggleFavorite: (ticker: string) => void
  onToggleCompare: (ticker: string) => void
}) {
  return (
    <tr
      onClick={() => onSelect(comp.ticker)}
      className={`border-b border-border/30 hover:bg-secondary/20 transition-colors h-11 cursor-pointer ${
        isSelected ? "bg-primary/10 border-primary/20 hover:bg-primary/15" : ""
      }`}
    >
      <td className="px-4 text-center" onClick={(e) => {
        e.stopPropagation()
        onToggleFavorite(comp.ticker)
      }}>
        <button className="text-muted-foreground hover:text-warn transition-colors">
          <Star className={`h-4 w-4 ${isFav ? "text-warn fill-warn" : ""}`} />
        </button>
      </td>
      <td className="px-4 text-center" onClick={(e) => {
        e.stopPropagation()
        if (isCompared || !compareDisabled) onToggleCompare(comp.ticker)
      }}>
        <button
          disabled={!isCompared && compareDisabled}
          title={isCompared ? "Karşılaştırmadan çıkar" : "Karşılaştırmaya ekle"}
          className={`h-6 w-6 rounded-md border flex items-center justify-center transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${
            isCompared
              ? "bg-primary border-primary text-primary-foreground shadow-[0_0_10px_hsl(var(--primary)/0.3)]"
              : "border-border text-muted-foreground hover:border-primary/50 hover:text-primary"
          }`}
        >
          <Scale className="h-3.5 w-3.5" />
        </button>
      </td>
      <td className="px-4 font-bold text-foreground">
        <div className="flex items-center gap-2">
          <TickerLogo ticker={comp.ticker} size={18} />
          <span className={`px-2 py-0.5 rounded text-[10px] border transition-all ${
            isSelected
              ? (isFav ? "bg-warn text-background border-warn font-black shadow-[0_0_12px_hsl(var(--warn)/0.2)]" : "bg-primary text-primary-foreground border-primary")
              : (isFav ? "bg-warn/10 text-warn border-warn/20 font-black shadow-[0_0_8px_hsl(var(--warn)/0.08)]" : "bg-secondary text-muted-foreground border-transparent")
          }`}>
            {comp.ticker}
          </span>
        </div>
      </td>
      <td className="px-4 text-muted-foreground truncate max-w-[140px] hidden lg:table-cell">{comp.name}</td>
      <td className="px-4 text-muted-foreground truncate max-w-[100px]">{comp.sector}</td>
      <td className="px-4 text-right font-mono font-bold">₺{comp.price.toFixed(2)}</td>
      <td className="px-4 text-right font-mono font-semibold">
        <span className={comp.change_percent >= 0 ? "val-up" : "val-down"}>
          {comp.change_percent >= 0 ? "+" : ""}{comp.change_percent.toFixed(2)}%
        </span>
      </td>
      <td className="px-4 text-center font-mono font-bold">
        <span className="bg-primary/10 text-primary px-2 py-0.5 rounded border border-primary/20 font-mono">
          {comp.ai_score}
        </span>
      </td>
      <td className="px-4 text-center">
        {(() => {
          const sig = signalFromScore(comp.ai_score)
          return (
            <span className={`text-[10px] font-black px-1.5 py-0.5 rounded border ${
              sig === "LONG" ? "bg-bull/10 text-bull border-bull/20" :
              sig === "SHORT" ? "bg-bear/10 text-bear border-bear/20" :
              "bg-secondary text-muted-foreground border-border"
            }`}>
              {sig}
            </span>
          )
        })()}
      </td>
    </tr>
  )
}, (prev, next) => {
  return (
    prev.isFav === next.isFav &&
    prev.isSelected === next.isSelected &&
    prev.isCompared === next.isCompared &&
    prev.compareDisabled === next.compareDisabled &&
    prev.comp.ticker === next.comp.ticker &&
    prev.comp.name === next.comp.name &&
    prev.comp.sector === next.comp.sector &&
    prev.comp.price === next.comp.price &&
    prev.comp.change_percent === next.comp.change_percent &&
    prev.comp.ai_score === next.comp.ai_score
  )
})

export default function ScreenerPage() {
  const router = useRouter()
  const [companies, setCompanies] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState("")
  const [selectedSector, setSelectedSector] = useState("Tümü")
  const [maxPE, setMaxPE] = useState<number | "">("")
  const [minAIScore, setMinAIScore] = useState<number | "">("")
  const [sortField, setSortField] = useState<string>("ai_score")
  const [sortAsc, setSortAsc] = useState<boolean>(false)

  // Favorites state
  const [favorites, setFavorites] = useState<string[]>([])
  const [showOnlyFavorites, setShowOnlyFavorites] = useState(false)

  // Split-view selected stock - defaults to a "?ticker=" URL param if the
  // header search sent us here (Header.tsx navigates to /screener?ticker=CODE
  // for stocks when clicked from any page other than /screener itself, since
  // there's no separate /stock/[ticker] route - previously it linked to one
  // that didn't exist, which 404'd and looked like "the price doesn't show").
  const [selectedTicker, setSelectedTicker] = useState(() => {
    if (typeof window !== "undefined") {
      const param = new URLSearchParams(window.location.search).get("ticker")
      if (param) return param.toUpperCase()
    }
    return "THYAO"
  })
  const [selectedTimeframe, setSelectedTimeframe] = useState("1h")
  const [chartData, setChartData] = useState<any[]>([])
  const [chartLoading, setChartLoading] = useState(false)
  const [chartSimulated, setChartSimulated] = useState(false)
  const [scoreDetails, setScoreDetails] = useState<any>(null)
  const [scoreLoading, setScoreLoading] = useState(false)

  // Seçili hissenin GERÇEK günlük Açılış/En Yüksek/En Düşük/Önceki Kapanış
  // bilgisi - grafiğin kendi seçili periyodundan (5dk/1sa/haftalık olabilir)
  // BAĞIMSIZ, hep "1d" periyoduyla ayrıca çekiliyor. Aksi halde ör. periyot
  // "1sa" iken son iki mumun kapanışını "bugün açılış/dün kapanış" diye
  // göstermek yanlış olurdu - bir saat önceki fiyat, dünün kapanışı değildir.
  const [dailyCandles, setDailyCandles] = useState<any[]>([])
  const [marketSummary, setMarketSummary] = useState<any>({})
  const [loadingSummary, setLoadingSummary] = useState(true)

  // Stock comparison state (2-5 stocks, matches the backend's GET /screener/compare cap)
  const [compareCodes, setCompareCodes] = useState<string[]>([])
  const [compareOpen, setCompareOpen] = useState(false)
  const [compareLoading, setCompareLoading] = useState(false)
  const [compareError, setCompareError] = useState<string | null>(null)
  const [compareResult, setCompareResult] = useState<any[]>([])

  const toggleCompare = useCallback((ticker: string) => {
    setCompareCodes((prev) => {
      if (prev.includes(ticker)) return prev.filter((c) => c !== ticker)
      if (prev.length >= 5) return prev
      return [...prev, ticker]
    })
  }, [])

  const runCompare = async () => {
    if (compareCodes.length < 2) return
    setCompareOpen(true)
    setCompareLoading(true)
    setCompareError(null)
    try {
      const res = await authFetch(`/screener/compare?tickers=${compareCodes.join(",")}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setCompareError(body.detail || "Karşılaştırma başarısız oldu.")
        setCompareResult([])
        return
      }
      const data = await res.json()
      setCompareResult(data.stocks || [])
    } catch (err) {
      console.error("Failed to compare stocks:", err)
      setCompareError("Karşılaştırma sırasında bir hata oluştu.")
    } finally {
      setCompareLoading(false)
    }
  }

  const compareChartData = useMemo(() => buildStockComparisonChartData(compareResult), [compareResult])

  // Favoriler artık hesaba bağlı (sunucuda). Önceden yalnızca
  // localStorage'daydı: tarayıcı verisi temizlenince kayboluyor, aynı
  // hesapla girilen exe/web/Android'de üç ayrı liste oluşuyor ve sunucu
  // listeyi göremediği için üstüne bildirim/özet gibi hiçbir şey
  // kurulamıyordu.
  useEffect(() => {
    let active = true

    const load = async () => {
      // Cihazda kalmış eski liste varsa bir kereliğine hesaba taşınır,
      // sonra yerelden silinir. Göç yalnızca ekler (sunucudaki listeyi
      // ezmez), bu yüzden iki cihazdan da çalıştırılması güvenli.
      try {
        const legacy = localStorage.getItem("favorites_stocks")
        if (legacy) {
          const tickers = JSON.parse(legacy)
          if (Array.isArray(tickers) && tickers.length > 0) {
            const res = await authFetch("/watchlist/migrate", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ tickers }),
            })
            if (res.ok) localStorage.removeItem("favorites_stocks")
          } else {
            localStorage.removeItem("favorites_stocks")
          }
        }
      } catch {
        // Bozuk/okunamayan yerel veri göçü engellemesin - sunucudaki
        // liste yine de yüklenmeli.
      }

      try {
        const res = await authFetch("/watchlist/")
        if (res.ok && active) {
          const items = await res.json()
          setFavorites(items.map((i: any) => i.ticker))
        }
      } catch (e) {
        console.error("İzleme listesi yüklenemedi:", e)
      }
    }

    load()
    return () => { active = false }
  }, [])

  // Toggle favorite helper (stable reference via functional update, so memoized rows don't re-render unnecessarily)
  const toggleFavorite = useCallback((ticker: string) => {
    setFavorites(prev => {
      const isRemoving = prev.includes(ticker)
      // İyimser güncelleme: yıldız anında dolsun/boşalsın, sunucu isteği
      // arkada tamamlansın. Başarısız olursa geri alınıyor.
      authFetch(
        isRemoving ? `/watchlist/${ticker}` : "/watchlist/",
        isRemoving
          ? { method: "DELETE" }
          : {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ticker }),
            },
      ).then(res => {
        if (!res.ok) {
          setFavorites(current =>
            isRemoving ? [...current, ticker] : current.filter(t => t !== ticker),
          )
        }
      }).catch(() => {
        setFavorites(current =>
          isRemoving ? [...current, ticker] : current.filter(t => t !== ticker),
        )
      })

      return isRemoving ? prev.filter(t => t !== ticker) : [...prev, ticker]
    })
  }, [])

  // Stable select handler for memoized rows
  const handleSelectTicker = useCallback((ticker: string) => {
    setSelectedTicker(ticker)
  }, [])


  // If we arrived here via a "?ticker=" URL param (header search, from a page
  // other than /screener), scroll the detail pane into view once on mount.
  useEffect(() => {
    const param = new URLSearchParams(window.location.search).get("ticker")
    if (param) {
      const detailEl = document.getElementById("stock-detail-pane")
      if (detailEl) detailEl.scrollIntoView({ behavior: "smooth" })
    }
  }, [])

  // Fetch live BIST screener data on mount + auto-refresh
  useEffect(() => {
    // `loading` state is captured once when this effect mounts (deps: []), so checking
    // it inside fetchStocks would always read the same stale value forever. That bug
    // caused selectedTicker to be silently reset to data[0].ticker (AKBNK) on every
    // single poll tick - barely noticeable at a 10s interval, but very disruptive once
    // the poll interval was sped up to 2s. Use a ref instead so the "set default ticker"
    // logic only ever runs once, on the true first successful load.
    let hasSetInitialTicker = false
    // Respect an explicit "?ticker=" URL param (see selectedTicker's lazy
    // initializer above) - don't let the first poll silently override it.
    const urlHadTicker = !!new URLSearchParams(window.location.search).get("ticker")

    const fetchStocks = () => {
      authFetch(`/screener/`)
        .then(res => res.json())
        .then(data => {
          if (Array.isArray(data)) {
            setCompanies(data)
            // Set selected ticker to first item if available (only on first load,
            // and only if the user didn't arrive with an explicit ?ticker= param)
            if (data.length > 0 && !hasSetInitialTicker) {
              hasSetInitialTicker = true
              if (!urlHadTicker) {
                setSelectedTicker(data[0].ticker)
              }
            }
          }
          setLoading(false)
        })
        .catch(err => {
          console.error("Failed to load BIST screener:", err)
          setLoading(false)
        })
    }

    fetchStocks()
    // Backend reads from an in-memory TradingView WebSocket cache, so polling
    // every 2s doesn't add real network/API load, just keeps the table fresh.
    // pollWhileVisibleAndOpen also skips this outside the BIST session
    // (Mon-Fri 09:30-18:15 Istanbul time, see bistSession.ts) - prices don't
    // move then either.
    const stopStocks = pollWhileVisibleAndOpen(fetchStocks, 2000)
    return stopStocks
  }, [])

  // Fetch chart data for selected ticker with self-healing retry if data is simulated (Request 1!)
  useEffect(() => {
    let active = true;
    let timerId: any = null;
    // Capped for the same reason as the stock detail page's copy of this
    // loop: uncapped, a symbol that never resolved kept re-requesting every
    // 2.5s for the lifetime of the tab.
    let attemptsLeft = MAX_SIMULATED_CHART_RETRIES;

    const loadChart = () => {
      if (!selectedTicker) return;

      authFetch(`/screener/chart/${selectedTicker}?interval=${selectedTimeframe}`)
        .then(res => {
          if (!res.ok) {
            console.warn("Chart data not available from server");
            return { data: [], isSimulated: false };
          }
          const isSimulated = res.headers.get("X-Chart-Simulated") === "true";
          return res.json().then(data => ({ data, isSimulated }));
        })
        .then(({ data, isSimulated }) => {
          if (!active) return;
          if (Array.isArray(data)) {
            setChartData(data)
          }
          setChartLoading(false)
          setChartSimulated(isSimulated)

          // Self-healing retry: if the chart was simulated (cache empty on backend startup),
          // schedule a retry in 2.5 seconds to pull the real data once the websocket streams it!
          if (isSimulated && attemptsLeft > 0) {
            attemptsLeft -= 1;
            timerId = setTimeout(() => {
              if (active) loadChart();
            }, 2500);
          }
        })
        .catch(err => {
          if (!active) return;
          console.error("Failed to load chart data:", err)
          setChartLoading(false)
        })
    };

    setChartLoading(true)
    setChartSimulated(false)
    loadChart();

    return () => {
      active = false;
      if (timerId) clearTimeout(timerId);
    };
  }, [selectedTicker, selectedTimeframe])

  // Grafik periyodundan bağımsız, sabit günlük mumlar - yalnızca OHLC şeridi
  // için (bkz. yukarıdaki dailyCandles yorumu).
  useEffect(() => {
    if (!selectedTicker) return
    let active = true
    authFetch(`/screener/chart/${selectedTicker}?interval=1d`)
      .then(res => (res.ok ? res.json() : []))
      .then(data => { if (active && Array.isArray(data)) setDailyCandles(data) })
      .catch(err => console.error("Failed to load daily OHLC candles:", err))
    return () => { active = false }
  }, [selectedTicker])

  // Sektör Performansı + En Çok Yükselenler/Düşenler kartları için - Header
  // ve ana sayfayla AYNI uç nokta, sektör yüzdeleri her yerde tutarlı olsun.
  useEffect(() => {
    const fetchMarketSummary = () => {
      authFetch(`/screener/market-summary`)
        .then(res => res.json())
        .then(data => {
          if (data && data.sectors) setMarketSummary(data)
          setLoadingSummary(false)
        })
        .catch(err => {
          console.error("Failed to load market summary:", err)
          setLoadingSummary(false)
        })
    }
    fetchMarketSummary()
    return pollWhileVisibleAndOpen(fetchMarketSummary, 15000)
  }, [])

  useEffect(() => {
    if (!selectedTicker) return
    setScoreLoading(true)
    authFetch(`/screener/score-details/${selectedTicker}`)
      .then(res => res.json())
      .then(data => {
        setScoreDetails(data)
        setScoreLoading(false)
      })
      .catch(err => {
        console.error("Failed to load score details:", err)
        setScoreLoading(false)
      })
  }, [selectedTicker])

  // Get details of selected stock
  const selectedStockDetails = useMemo(() => {
    return companies.find(c => c.ticker === selectedTicker) || null
  }, [companies, selectedTicker])

  // AI Skoru kategorileri - backend'in calculate_ai_score_details'i 12 ayrı
  // teknik kontrolü DÜZ bir liste olarak döndürüyor (EMA20/EMA50/SMA20/
  // SMA50/Trend(EMA200)/RSI/MACD/ADX/ATR/Direnç/Destek/Momentum), fundamental
  // bir "Kalite"/"Değerleme"/"Sentiment" ayrımı yok. Bu üçü gerçek olmayan
  // sayı uydurmak yerine, var olan 12 kontrolü metinlerine göre üç dürüst
  // kategoriye topluyor - her kategorinin puanı, o kategoriye giren gerçek
  // kontrollerin backend'den gelen gerçek puan katkılarının toplamı.
  const categorizeReason = (text: string): "trend" | "momentum" | "risk" => {
    if (text.includes("RSI") || text.includes("MACD") || text.includes("Momentum")) return "momentum"
    if (text.includes("Volatilite") || text.includes("Dirence") || text.includes("Desteğe")) return "risk"
    return "trend" // EMA/SMA/Trend güçlü-zayıf/Trend kararlı (ADX)
  }

  const scoreCategories = useMemo(() => {
    const totals = { trend: 0, momentum: 0, risk: 0 }
    if (scoreDetails?.reasons) {
      for (const r of scoreDetails.reasons) {
        const n = parseInt(String(r.value).replace("+", ""), 10)
        if (!Number.isNaN(n)) totals[categorizeReason(r.text)] += n
      }
    }
    return totals
  }, [scoreDetails])

  // Bugünkü Açılış/En Yüksek/En Düşük/Önceki Kapanış - dailyCandles'ın son
  // mumu bugünü, ondan önceki mum dünü temsil ediyor.
  const ohlc = useMemo(() => {
    if (dailyCandles.length === 0) return null
    const today = dailyCandles[dailyCandles.length - 1]
    const prev = dailyCandles.length > 1 ? dailyCandles[dailyCandles.length - 2] : null
    return {
      open: today.open,
      high: today.high,
      low: today.low,
      prevClose: prev ? prev.close : null,
    }
  }, [dailyCandles])

  // Seçili hissenin gerçek RSI/MACD/VWAP/SMA20/EMA20 anlık değerleri - grafiğin
  // kendi mum verisinden (backend her mumda bu göstergeleri zaten hesaplayıp
  // döndürüyor, bkz. screener.py /chart), uydurma bir "teknik gösterge" değil.
  const liveIndicators = useMemo(() => {
    if (chartData.length === 0) return null
    const last = chartData[chartData.length - 1]
    return {
      rsi: last.rsi,
      macd: last.macd,
      macdSignal: last.macd_signal,
      vwap: last.vwap,
      sma20: last.sma20,
      ema20: last.ema20,
    }
  }, [chartData])

  // En Çok Yükselenler/Düşenler - ana sayfayla aynı yöntem, aynı ekranda
  // zaten yüklü olan `companies` listesinden, ekstra istek yok.
  const { gainers, losers } = useMemo(() => {
    const withChange = companies.filter((s) => typeof s.change_percent === "number")
    const sorted = [...withChange].sort((a, b) => b.change_percent - a.change_percent)
    return { gainers: sorted.slice(0, 5), losers: sorted.slice(-5).reverse() }
  }, [companies])

  // Dynamic Sector list extraction
  const sectorsList = useMemo(() => {
    const sectors = new Set<string>()
    sectors.add("Tümü")
    companies.forEach(c => {
      if (c.sector) sectors.add(c.sector)
    })
    return Array.from(sectors)
  }, [companies])

  // Sorting handler
  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortAsc(!sortAsc)
    } else {
      setSortField(field)
      setSortAsc(false)
    }
  }

  // Filter & Sort computation
  const sortedAndFilteredCompanies = useMemo(() => {
    let result = companies.filter((comp) => {
      const matchesSearch = comp.ticker.toLowerCase().includes(searchTerm.toLowerCase()) || 
                            comp.name.toLowerCase().includes(searchTerm.toLowerCase())
      
      const matchesSector = selectedSector === "Tümü" || comp.sector === selectedSector
      const matchesPE = maxPE === "" || (comp.pe > 0 && comp.pe <= Number(maxPE))
      const matchesAIScore = minAIScore === "" || comp.ai_score >= Number(minAIScore)
      const matchesFavorites = !showOnlyFavorites || favorites.includes(comp.ticker)

      return matchesSearch && matchesSector && matchesPE && matchesAIScore && matchesFavorites
    })

    // Apply sort
    result.sort((a, b) => {
      let valA = a[sortField] ?? 0
      let valB = b[sortField] ?? 0

      if (typeof valA === "string") valA = valA.toLowerCase()
      if (typeof valB === "string") valB = valB.toLowerCase()

      if (valA < valB) return sortAsc ? -1 : 1
      if (valA > valB) return sortAsc ? 1 : -1
      return 0
    })

    return result
  }, [companies, searchTerm, selectedSector, maxPE, minAIScore, sortField, sortAsc, favorites, showOnlyFavorites])

  const handleReset = () => {
    setSearchTerm("")
    setSelectedSector("Tümü")
    setMaxPE("")
    setMinAIScore("")
    setSortField("ai_score")
    setSortAsc(false)
    setShowOnlyFavorites(false)
  }

  const timeframes = CHART_TIMEFRAMES

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Title */}
      <div className="animate-rise">
        <h1 className="t-display">Hisse Tarama ve Grafik Terminali</h1>
        <p className="t-caption mt-1.5">
          TradingView canlı verileriyle hisseleri tarayın, anlık grafiklerini inceleyin ve favorilerinizi yönetin.
        </p>
      </div>

      {/* Main Split Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        
        {/* Left Side: Filter bar and list table (7 cols) */}
        <div className="lg:col-span-7 space-y-6">
          
          {/* Filters Card */}
          <Card glass={true}>
            <CardHeader className="py-4">
              <CardTitle className="text-sm flex items-center">
                <Filter className="h-4 w-4 mr-2 text-primary" />
                Tarama Kriterleri
              </CardTitle>
            </CardHeader>
            <CardContent className="pb-4">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                {/* Search */}
                <div className="space-y-1">
                  <label className="text-[10px] text-muted-foreground font-bold uppercase">Hisse Kodu/Adı</label>
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      placeholder="THYAO..."
                      className="pl-8 h-8 text-xs bg-secondary/30"
                    />
                  </div>
                </div>

                {/* Sector */}
                <div className="space-y-1">
                  <label className="text-[10px] text-muted-foreground font-bold uppercase">Sektör</label>
                  <select
                    value={selectedSector}
                    onChange={(e) => setSelectedSector(e.target.value)}
                    className="w-full h-8 rounded-md border border-input bg-secondary/30 px-2 text-xs focus-visible:outline-none"
                  >
                    {sectorsList.map((sector) => (
                      <option key={sector} value={sector} className="bg-popover text-foreground">
                        {sector}
                      </option>
                    ))}
                  </select>
                </div>

                {/* PE Ratio */}
                <div className="space-y-1">
                  <label className="text-[10px] text-muted-foreground font-bold uppercase">Maks F/K (PE)</label>
                  <Input
                    type="number"
                    value={maxPE}
                    onChange={(e) => setMaxPE(e.target.value === "" ? "" : Number(e.target.value))}
                    placeholder="15"
                    className="h-8 text-xs bg-secondary/30"
                  />
                </div>

                {/* Min AI Score */}
                <div className="space-y-1">
                  <label className="text-[10px] text-muted-foreground font-bold uppercase">Min AI Skoru</label>
                  <Input
                    type="number"
                    value={minAIScore}
                    onChange={(e) => setMinAIScore(e.target.value === "" ? "" : Number(e.target.value))}
                    placeholder="70"
                    className="h-8 text-xs bg-secondary/30"
                  />
                </div>
              </div>

              {/* Reset & Toggle Favorites Row */}
              <div className="flex items-center justify-between mt-4 pt-3 border-t border-border/40">
                <div className="flex items-center space-x-2">
                  <Button
                    variant={showOnlyFavorites ? "default" : "outline"}
                    size="sm"
                    onClick={() => setShowOnlyFavorites(!showOnlyFavorites)}
                    className="text-xs h-7 px-2.5 cursor-pointer flex items-center"
                  >
                    <Star className={`h-3.5 w-3.5 mr-1 ${showOnlyFavorites ? "fill-current" : ""}`} />
                    Favorilerim
                  </Button>
                </div>

                <div className="flex items-center space-x-3">
                  <Button variant="ghost" size="sm" onClick={handleReset} className="text-xs h-7 px-2 cursor-pointer flex items-center text-muted-foreground hover:text-foreground">
                    <RefreshCw className="h-3 w-3 mr-1" />
                    Temizle
                  </Button>
                  <span className="text-[10px] font-bold text-muted-foreground uppercase">
                    {sortedAndFilteredCompanies.length} Hisse
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Results Table */}
          <Card glass={true}>
            <CardContent className="p-0">
              <div className="overflow-x-auto max-h-[500px]">
                {loading ? (
                  <div className="space-y-3 p-4">
                    <Skeleton className="h-9 w-full rounded" />
                    <Skeleton className="h-9 w-full rounded" />
                    <Skeleton className="h-9 w-full rounded" />
                    <Skeleton className="h-9 w-full rounded" />
                    <Skeleton className="h-9 w-full rounded" />
                  </div>
                ) : (
                  <table className="w-full text-xs text-left border-collapse">
                    <thead>
                      <tr className="border-b border-border/80 text-muted-foreground font-bold bg-secondary/15 h-9 sticky top-0 backdrop-blur z-10">
                        <th className="px-4 text-center w-8">Fav</th>
                        <th className="px-4 text-center w-8">Kıyasla</th>
                        <th className="px-4 cursor-pointer hover:text-foreground" onClick={() => handleSort("ticker")}>
                          Kod <ArrowUpDown className="inline h-3 w-3 ml-0.5" />
                        </th>
                        <th className="px-4 cursor-pointer hover:text-foreground hidden lg:table-cell" onClick={() => handleSort("name")}>
                          Şirket <ArrowUpDown className="inline h-3 w-3 ml-0.5" />
                        </th>
                        <th className="px-4 cursor-pointer hover:text-foreground" onClick={() => handleSort("sector")}>
                          Sektör <ArrowUpDown className="inline h-3 w-3 ml-0.5" />
                        </th>
                        <th className="px-4 text-right cursor-pointer hover:text-foreground" onClick={() => handleSort("price")}>
                          Fiyat <ArrowUpDown className="inline h-3 w-3 ml-0.5" />
                        </th>
                        <th className="px-4 text-right cursor-pointer hover:text-foreground" onClick={() => handleSort("change_percent")}>
                          Değişim <ArrowUpDown className="inline h-3 w-3 ml-0.5" />
                        </th>
                        <th className="px-4 text-center cursor-pointer hover:text-foreground" onClick={() => handleSort("ai_score")}>
                          AI Skoru <ArrowUpDown className="inline h-3 w-3 ml-0.5" />
                        </th>
                        <th className="px-4 text-center">Sinyal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedAndFilteredCompanies.length > 0 ? (
                        sortedAndFilteredCompanies.map((comp) => (
                          <StockRow
                            key={comp.ticker}
                            comp={comp}
                            isFav={favorites.includes(comp.ticker)}
                            isSelected={selectedTicker === comp.ticker}
                            isCompared={compareCodes.includes(comp.ticker)}
                            compareDisabled={compareCodes.length >= 5}
                            onSelect={handleSelectTicker}
                            onToggleFavorite={toggleFavorite}
                            onToggleCompare={toggleCompare}
                          />
                        ))
                      ) : (
                        <tr className="h-20">
                          <td colSpan={9} className="text-center text-muted-foreground text-xs">
                            Şirket bulunamadı.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Side: Stock Detail View & Interactive Chart (5 cols) */}
        <div id="stock-detail-pane" className="lg:col-span-5 space-y-6">
          {selectedStockDetails ? (
            // key: hisse değişince panel yeniden kurulur ve `animate-pop`
            // yeniden oynar - listeden başka bir satıra tıklandığında sağdaki
            // panelin GÜNCELLENDİĞİNİ gösteren tek ipucu bu.
            <Card key={selectedStockDetails.ticker} glass={true} className="border-primary/20 animate-pop">
              <CardHeader className="pb-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center space-x-2.5 min-w-0">
                    <TickerLogo ticker={selectedTicker} size={28} />
                    <div className="min-w-0">
                      <CardTitle className="text-sm font-black line-clamp-1">{selectedStockDetails.name}</CardTitle>
                      <CardDescription className="text-[10px] mt-0.5">{selectedTicker} · {selectedStockDetails.sector}</CardDescription>
                    </div>
                  </div>
                  {/* AI Skoru - listedeki aynı ai_score alanı, sadece burada
                      daha belirgin. Etiket signalFromScore ile aynı eşiği
                      kullanıyor (>=70 BULLISH, <45 BEARISH, aksi NÖTR). */}
                  <div className="text-right shrink-0">
                    <div className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider">AI Skoru</div>
                    <div className="text-xl font-black font-mono text-primary leading-tight">
                      {selectedStockDetails.ai_score}<span className="text-xs text-muted-foreground">/100</span>
                    </div>
                    <div className={`text-[10px] font-black tracking-wide ${
                      signalFromScore(selectedStockDetails.ai_score) === "LONG" ? "text-bull" :
                      signalFromScore(selectedStockDetails.ai_score) === "SHORT" ? "text-bear" : "text-muted-foreground"
                    }`}>
                      {signalFromScore(selectedStockDetails.ai_score) === "LONG" ? "BULLISH" :
                       signalFromScore(selectedStockDetails.ai_score) === "SHORT" ? "BEARISH" : "NÖTR"}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1 mt-2.5">
                  <button
                    onClick={() => router.push(`/stock/${selectedTicker}`)}
                    title="Detaylı Şirket Analizi"
                    className="flex items-center gap-1 text-[10px] font-bold px-2 py-1.5 rounded-lg border border-primary/25 bg-primary/10 text-primary hover:bg-primary/20 transition-colors cursor-pointer"
                  >
                    <FileSearch className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Detaylı Analiz</span>
                  </button>
                  <button
                    onClick={() => toggleFavorite(selectedTicker)}
                    className="text-muted-foreground hover:text-warn transition-colors p-1 ml-auto"
                  >
                    <Star className={`h-5 w-5 ${favorites.includes(selectedTicker) ? "text-warn fill-warn" : ""}`} />
                  </button>
                </div>

                {/* Price Display */}
                <div className="flex items-baseline justify-between mt-3 pt-3 border-t border-border/40">
                  <span className="text-2xl font-black font-mono text-foreground">₺{selectedStockDetails.price.toFixed(2)}</span>
                  <span className={`text-xs font-bold font-mono ${selectedStockDetails.change_percent >= 0 ? "val-up" : "val-down"}`}>
                    {selectedStockDetails.change_percent >= 0 ? "+" : ""}{selectedStockDetails.change_percent.toFixed(2)}%
                  </span>
                </div>

                {/* OHLC şeridi - grafiğin seçili periyodundan bağımsız,
                    hep gerçek günlük mumlardan (bkz. dailyCandles/ohlc). */}
                {ohlc && (
                  <div className="grid grid-cols-4 gap-2 mt-2.5 text-center">
                    {[
                      { label: "Açılış", val: ohlc.open },
                      { label: "En Yüksek", val: ohlc.high },
                      { label: "En Düşük", val: ohlc.low },
                      { label: "Önceki Kapanış", val: ohlc.prevClose },
                    ].map(s => (
                      <div key={s.label}>
                        <div className="text-[8px] font-bold text-muted-foreground uppercase tracking-wide">{s.label}</div>
                        <div className="text-[11px] font-mono font-bold text-foreground mt-0.5">
                          {s.val != null ? `₺${Number(s.val).toFixed(2)}` : "-"}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardHeader>
              
              <CardContent className="space-y-4">
                
                {/* Timeframe Selectors */}
                <div className="flex items-center space-x-1.5 bg-secondary/40 p-1 rounded-lg border border-border/45">
                  {timeframes.map(tf => (
                    <button
                      key={tf.value}
                      onClick={() => setSelectedTimeframe(tf.value)}
                      className={`flex-1 text-[10px] font-black py-1.5 rounded transition-all cursor-pointer ${
                        selectedTimeframe === tf.value 
                          ? "bg-primary text-primary-foreground shadow" 
                          : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                      }`}
                    >
                      {tf.label}
                    </button>
                  ))}
                </div>

                {/* Chart Area */}
                {/* Same placeholder-bar labelling as the stock detail page -
                    simulated candles must not read as real prices. */}
                {chartSimulated && !chartLoading && (
                  <div className="flex items-center gap-2 rounded-md border border-warn/30 bg-warn/10 px-3 py-2">
                    <span className="text-[11px] font-bold val-warn">Geçici veri</span>
                    <span className="text-[11px] text-muted-foreground">
                      Canlı fiyat akışı henüz bağlanmadı - gerçek piyasa verisi değildir.
                    </span>
                  </div>
                )}
                <div className="relative border border-border rounded-xl overflow-hidden bg-secondary/40 p-1">
                  {chartLoading && (
                    <div className="absolute inset-0 bg-background/70 backdrop-blur-sm flex items-center justify-center z-10">
                      <Loader2 className="h-6 w-6 text-primary animate-spin" />
                    </div>
                  )}
                  <TradingViewChart data={chartData} symbol={selectedTicker} />
                </div>

                {/* Simple Technical Info details */}
                <div className="grid grid-cols-3 gap-2.5 text-center text-xs">
                  <div className="bg-secondary/20 p-2 border border-border/30 rounded-lg">
                    <span className="block text-[9px] text-muted-foreground uppercase font-bold">F/K (PE)</span>
                    <span className="font-mono font-bold text-foreground mt-0.5 block">{selectedStockDetails.pe > 0 ? selectedStockDetails.pe.toFixed(1) : "-"}</span>
                  </div>
                  <div className="bg-secondary/20 p-2 border border-border/30 rounded-lg">
                    <span className="block text-[9px] text-muted-foreground uppercase font-bold">AI Duygu</span>
                    <span className={`font-bold mt-0.5 block ${
                      selectedStockDetails.sentiment === "Pozitif" ? "val-up" :
                      selectedStockDetails.sentiment === "Negatif" ? "val-down" :
                      "text-muted-foreground"
                    }`}>{selectedStockDetails.sentiment}</span>
                  </div>
                  <div className="bg-secondary/20 p-2 border border-border/30 rounded-lg">
                    <span className="block text-[9px] text-muted-foreground uppercase font-bold">Piyasa Değeri</span>
                    <span className="font-bold text-foreground mt-0.5 block font-mono">
                      {selectedStockDetails.market_cap > 0
                        ? `₺${(selectedStockDetails.market_cap / 1_000_000_000).toFixed(2)}B`
                        : "-"}
                    </span>
                  </div>
                </div>

                {/* Teknik Göstergeler - grafiğin son mumundan gerçek RSI/MACD/
                    VWAP/SMA20/EMA20 (bkz. liveIndicators) - backend her mumda
                    bu değerleri zaten hesaplıyor, sadece daha önce hiçbir yerde
                    gösterilmiyordu. */}
                {liveIndicators && (
                  <div>
                    <div className="t-label mb-1.5">Teknik Göstergeler</div>
                    <div className="grid grid-cols-3 gap-2 text-center text-xs">
                      {[
                        { label: "RSI (14)", val: liveIndicators.rsi, tone: liveIndicators.rsi != null ? (liveIndicators.rsi >= 70 ? "val-down" : liveIndicators.rsi <= 30 ? "val-up" : "text-foreground") : "text-foreground" },
                        { label: "MACD", val: liveIndicators.macd, tone: liveIndicators.macd != null && liveIndicators.macdSignal != null ? (liveIndicators.macd >= liveIndicators.macdSignal ? "val-up" : "val-down") : "text-foreground" },
                        { label: "VWAP", val: liveIndicators.vwap, tone: "text-foreground" },
                        { label: "SMA 20", val: liveIndicators.sma20, tone: "text-foreground" },
                        { label: "EMA 20", val: liveIndicators.ema20, tone: "text-foreground" },
                        { label: "MACD Sinyal", val: liveIndicators.macdSignal, tone: "text-foreground" },
                      ].map(ind => (
                        <div key={ind.label} className="bg-secondary/20 p-2 border border-border/30 rounded-lg">
                          <span className="block text-[9px] text-muted-foreground uppercase font-bold">{ind.label}</span>
                          <span className={`font-mono font-bold mt-0.5 block ${ind.tone}`}>
                            {ind.val != null ? Number(ind.val).toFixed(2) : "-"}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* AI Score Breakdown Panel */}
                {scoreDetails && (
                  <div className="bg-secondary/25 border border-border rounded-xl p-3.5 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-black text-foreground uppercase tracking-wider flex items-center">
                        <Sparkles className="h-3.5 w-3.5 text-primary mr-1.5 animate-pulse" />
                        AI Skoru Detay Analizi
                      </span>
                      <span className={`text-[9px] font-black px-1.5 py-0.5 rounded ${
                        scoreDetails.result === "Pozitif" ? "bg-bull/10 text-bull border border-bull/20" :
                        scoreDetails.result === "Negatif" ? "bg-bear/10 text-bear border border-bear/20" :
                        "bg-secondary text-muted-foreground border border-border"
                      }`}>
                        {scoreDetails.result} ({scoreDetails.risk} Risk)
                      </span>
                    </div>

                    {/* Kategori özeti - 12 gerçek kontrolün üç dürüst grupta
                        toplamı (bkz. categorizeReason). Aşağıdaki tam liste
                        her birinin ayrı ayrı hangi kontrolden geldiğini
                        gösteriyor. */}
                    <div className="grid grid-cols-3 gap-2 pb-1">
                      {[
                        { key: "trend", label: "Trend" },
                        { key: "momentum", label: "Momentum" },
                        { key: "risk", label: "Risk" },
                      ].map(c => {
                        const val = scoreCategories[c.key as keyof typeof scoreCategories]
                        return (
                          <div key={c.key} className="text-center rounded-lg bg-secondary/40 py-2">
                            <div className="t-label !text-[9px]">{c.label}</div>
                            <div className={`text-sm font-black font-mono mt-0.5 ${val > 0 ? "val-up" : val < 0 ? "val-down" : "text-muted-foreground"}`}>
                              {val > 0 ? "+" : ""}{val}
                            </div>
                          </div>
                        )
                      })}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[10px] pt-0.5">
                      {scoreDetails.reasons && scoreDetails.reasons.map((r: any, idx: number) => (
                        <div key={idx} className="flex items-center justify-between bg-secondary/40 p-2 rounded-lg border border-border/60">
                          <span className="flex items-center text-muted-foreground">
                            <span className={`mr-1.5 font-bold ${r.icon === "✔" ? "val-up" : "val-down"}`}>
                              {r.icon}
                            </span>
                            {r.text}
                          </span>
                          <span className={`font-bold font-mono ${r.value.startsWith("+") ? "val-up" : "val-down"}`}>
                            {r.value}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="text-[10px] text-muted-foreground leading-relaxed italic text-center">
                  * Not: RSI ve MACD indikatörlerini grafik üzerindeki göz simgelerine basarak dilediğiniz an açıp kapatabilirsiniz.
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card glass={true} className="p-8 text-center text-muted-foreground text-xs">
              Detayları ve grafiği görüntülemek için soldaki listeden bir hisse seçin.
            </Card>
          )}
        </div>

      </div>

      {/* Alt özet şeridi - ana sayfayla aynı 3 kart, aynı veri/yöntem:
          Sektör Performansı (market-summary), En Çok Yükselenler/Düşenler
          (companies listesinden client-side sıralama). "En Çok İşlem
          Görenler" bilerek YOK - ScreenerStockResponse şemasında gerçek bir
          hacim alanı yok, uydurmaktansa hiç eklenmedi (bkz. app/page.tsx'teki
          aynı karar). */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
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

        <Card className="bip-card">
          <CardHeader className="p-4 pb-2.5">
            <CardTitle className="t-section">En Çok Yükselenler</CardTitle>
            <CardDescription className="text-xs">Günlük</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1.5 p-4 pt-0">
            {loading ? (
              <Skeleton className="h-32 w-full rounded-lg" />
            ) : gainers.length === 0 ? (
              <p className="text-center text-xs text-muted-foreground py-4">Veri alınamadı.</p>
            ) : gainers.map((s, i) => (
              <div key={s.ticker} onClick={() => handleSelectTicker(s.ticker)} className="flex items-center justify-between py-1.5 cursor-pointer hover:bg-secondary/40 rounded px-1.5 -mx-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-muted-foreground w-3">{i + 1}</span>
                  <span className="text-xs font-bold text-foreground">{s.ticker}</span>
                </div>
                <div className="text-right">
                  <span className="font-mono font-bold text-xs text-foreground block">₺{s.price.toFixed(2)}</span>
                  <span className="val-up text-[11px] font-bold">+{s.change_percent.toFixed(2)}%</span>
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
            {loading ? (
              <Skeleton className="h-32 w-full rounded-lg" />
            ) : losers.length === 0 ? (
              <p className="text-center text-xs text-muted-foreground py-4">Veri alınamadı.</p>
            ) : losers.map((s, i) => (
              <div key={s.ticker} onClick={() => handleSelectTicker(s.ticker)} className="flex items-center justify-between py-1.5 cursor-pointer hover:bg-secondary/40 rounded px-1.5 -mx-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-muted-foreground w-3">{i + 1}</span>
                  <span className="text-xs font-bold text-foreground">{s.ticker}</span>
                </div>
                <div className="text-right">
                  <span className="font-mono font-bold text-xs text-foreground block">₺{s.price.toFixed(2)}</span>
                  <span className="val-down text-[11px] font-bold">{s.change_percent.toFixed(2)}%</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Stock Comparison Dialog */}
      <Dialog open={compareOpen} onOpenChange={setCompareOpen}>
        <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center">
              <Scale className="h-4 w-4 mr-2 text-primary" />
              Hisse Karşılaştırma
            </DialogTitle>
            <DialogDescription>
              Seçilen hisselerin getiri, volatilite ve normalize edilmiş performans karşılaştırması.
            </DialogDescription>
          </DialogHeader>

          {compareLoading ? (
            <div className="flex flex-col items-center justify-center py-16 space-y-3">
              <Loader2 className="h-8 w-8 text-primary animate-spin" />
              <span className="text-xs text-muted-foreground">Karşılaştırma hesaplanıyor...</span>
            </div>
          ) : compareError ? (
            <div className="py-10 text-center text-xs val-down">{compareError}</div>
          ) : (
            <div className="space-y-6">
              <div className="h-64 w-full">
                {compareChartData.length > 0 ? (
                  <ComparisonLineChart data={compareChartData} seriesKeys={compareResult.map((s: any) => s.ticker)} />
                ) : (
                  <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
                    Ortak tarih aralığında grafik verisi bulunamadı.
                  </div>
                )}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead>
                    <tr className="border-b border-border/60 text-muted-foreground font-bold h-9">
                      <th className="px-3">Hisse</th>
                      <th className="px-3">Sektör</th>
                      <th className="px-3 text-right">Fiyat</th>
                      <th className="px-3 text-right">1 Ay</th>
                      <th className="px-3 text-right">3 Ay</th>
                      <th className="px-3 text-right">1 Yıl</th>
                      <th className="px-3 text-right">Volatilite (Yıllık)</th>
                      <th className="px-3 text-center w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {compareResult.map((s, idx) => (
                      <tr key={s.ticker} className="border-b border-border/30 h-11">
                        <td className="px-3">
                          <div className="flex items-center gap-1.5">
                            <TickerLogo ticker={s.ticker} size={16} />
                            <span
                              className="px-2 py-0.5 rounded text-[10px] font-bold text-black"
                              style={{ backgroundColor: COMPARE_COLORS[idx % COMPARE_COLORS.length] }}
                            >
                              {s.ticker}
                            </span>
                          </div>
                        </td>
                        <td className="px-3 text-muted-foreground">{s.sector}</td>
                        <td className="px-3 text-right font-mono font-semibold">₺{Number(s.price).toFixed(2)}</td>
                        {["return_1m_pct", "return_3m_pct", "return_1y_pct"].map((key) => (
                          <td key={key} className="px-3 text-right font-mono font-semibold">
                            {s[key] != null ? (
                              <span className={s[key] >= 0 ? "val-up" : "val-down"}>
                                {s[key] >= 0 ? "+" : ""}{s[key]}%
                              </span>
                            ) : "—"}
                          </td>
                        ))}
                        <td className="px-3 text-right font-mono">
                          {s.volatility_pct != null ? `%${s.volatility_pct}` : "—"}
                        </td>
                        <td className="px-3 text-center">
                          <button
                            onClick={() => setCompareCodes((prev) => prev.filter((c) => c !== s.ticker))}
                            className="text-muted-foreground hover:text-bear transition-colors cursor-pointer"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Floating comparison tray - replaces the old checkbox-column +
          buried filter-row button combo. Appears once at least one stock is
          marked for comparison (via the Scale icon-toggle in each row) and
          floats above the page content instead of competing for space among
          the filter controls. */}
      {compareCodes.length > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 w-full max-w-2xl px-4">
          <div className="bg-popover/95 backdrop-blur-xl border border-primary/30 rounded-2xl shadow-[var(--elev-3)] px-4 py-3 flex items-center gap-3">
            <div className="flex items-center gap-2 flex-wrap flex-1 min-w-0">
              <Scale className="h-4 w-4 text-primary shrink-0" />
              {compareCodes.map((ticker) => (
                <div
                  key={ticker}
                  className="flex items-center gap-1.5 bg-secondary/50 border border-border/50 rounded-lg pl-1.5 pr-1 py-1"
                >
                  <TickerLogo ticker={ticker} size={16} />
                  <span className="text-[11px] font-bold text-foreground">{ticker}</span>
                  <button
                    onClick={() => toggleCompare(ticker)}
                    className="text-muted-foreground hover:text-bear transition-colors cursor-pointer p-0.5"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
              {compareCodes.length < 2 && (
                <span className="text-[10px] text-muted-foreground">En az 2 hisse seçin</span>
              )}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setCompareCodes([])}
                className="text-xs h-8 px-2 cursor-pointer text-muted-foreground hover:text-foreground"
              >
                Temizle
              </Button>
              <Button
                size="sm"
                disabled={compareCodes.length < 2}
                onClick={runCompare}
                className="text-xs h-8 px-3.5 cursor-pointer bg-primary hover:bg-primary-hover text-primary-foreground font-bold disabled:opacity-40"
              >
                Karşılaştır
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
