"use client"

import React, { useState, useEffect, useMemo, useCallback } from "react"
import { Search, Sparkles, Filter, RefreshCw, Loader2, ArrowUpDown, Star, Eye, EyeOff } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card"
import { Button } from "@/components/ui/Button"
import { Input } from "@/components/ui/Input"
import { Skeleton } from "@/components/ui/Skeleton"
import TradingViewChart from "@/components/TradingViewChart"
import { API_BASE_URL } from "@/lib/config"

// Memoized row: only re-renders when this specific stock's own data (or its
// favorite/selected state) actually changes, instead of every row re-rendering
// on every ~2s poll just because the parent's `companies` array reference changed.
const StockRow = React.memo(function StockRow({
  comp,
  isFav,
  isSelected,
  onSelect,
  onToggleFavorite,
}: {
  comp: any
  isFav: boolean
  isSelected: boolean
  onSelect: (ticker: string) => void
  onToggleFavorite: (ticker: string) => void
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
        <button className="text-muted-foreground hover:text-amber-400 transition-colors">
          <Star className={`h-4 w-4 ${isFav ? "text-amber-400 fill-amber-400" : ""}`} />
        </button>
      </td>
      <td className="px-4 font-bold text-foreground">
        <span className={`px-2 py-0.5 rounded text-[10px] border transition-all ${
          isSelected
            ? (isFav ? "bg-amber-500 text-black border-amber-400 font-black shadow-[0_0_12px_rgba(245,158,11,0.2)]" : "bg-primary text-primary-foreground border-primary")
            : (isFav ? "bg-amber-500/10 text-amber-400 border-amber-500/20 font-black shadow-[0_0_8px_rgba(245,158,11,0.08)]" : "bg-secondary text-muted-foreground border-transparent")
        }`}>
          {comp.ticker}
        </span>
      </td>
      <td className="px-4 text-muted-foreground truncate max-w-[120px]">{comp.sector}</td>
      <td className="px-4 text-right font-mono font-bold">₺{comp.price.toFixed(2)}</td>
      <td className="px-4 text-right font-mono font-semibold">
        <span className={comp.change_percent >= 0 ? "text-emerald-400" : "text-rose-500"}>
          {comp.change_percent >= 0 ? "+" : ""}{comp.change_percent.toFixed(2)}%
        </span>
      </td>
      <td className="px-4 text-center font-mono font-bold">
        <span className="bg-purple-500/10 text-purple-400 px-2 py-0.5 rounded border border-purple-500/15">
          {comp.ai_score}
        </span>
      </td>
    </tr>
  )
}, (prev, next) => {
  return (
    prev.isFav === next.isFav &&
    prev.isSelected === next.isSelected &&
    prev.comp.ticker === next.comp.ticker &&
    prev.comp.sector === next.comp.sector &&
    prev.comp.price === next.comp.price &&
    prev.comp.change_percent === next.comp.change_percent &&
    prev.comp.ai_score === next.comp.ai_score
  )
})

export default function ScreenerPage() {
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
  const [scoreDetails, setScoreDetails] = useState<any>(null)
  const [scoreLoading, setScoreLoading] = useState(false)

  // Load favorites from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem("favorites_stocks")
    if (saved) {
      setFavorites(JSON.parse(saved))
    }
  }, [])

  // Toggle favorite helper (stable reference via functional update, so memoized rows don't re-render unnecessarily)
  const toggleFavorite = useCallback((ticker: string) => {
    setFavorites(prev => {
      const updated = prev.includes(ticker) ? prev.filter(t => t !== ticker) : [...prev, ticker]
      localStorage.setItem("favorites_stocks", JSON.stringify(updated))
      return updated
    })
  }, [])

  // Stable select handler for memoized rows
  const handleSelectTicker = useCallback((ticker: string) => {
    setSelectedTicker(ticker)
  }, [])

  // Listen to select-stock custom events from header search (Request 11!)
  useEffect(() => {
    const handleSelectStock = (e: Event) => {
      const ticker = (e as CustomEvent).detail
      if (ticker) {
        setSelectedTicker(ticker.toUpperCase())
        // Auto scroll to detail view if on small screen
        const detailEl = document.getElementById("stock-detail-pane")
        if (detailEl) {
          detailEl.scrollIntoView({ behavior: "smooth" })
        }
      }
    }
    window.addEventListener("select-stock", handleSelectStock)
    return () => window.removeEventListener("select-stock", handleSelectStock)
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
      fetch(`${API_BASE_URL}/api/v1/screener/`)
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
    const interval = setInterval(fetchStocks, 2000)
    return () => clearInterval(interval)
  }, [])

  // Fetch chart data for selected ticker with self-healing retry if data is simulated (Request 1!)
  useEffect(() => {
    let active = true;
    let timerId: any = null;

    const loadChart = () => {
      if (!selectedTicker) return;
      
      fetch(`${API_BASE_URL}/api/v1/screener/chart/${selectedTicker}?interval=${selectedTimeframe}`)
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
          
          // Self-healing retry: if the chart was simulated (cache empty on backend startup), 
          // schedule a retry in 2.5 seconds to pull the real data once the websocket streams it!
          if (isSimulated) {
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
    loadChart();

    return () => {
      active = false;
      if (timerId) clearTimeout(timerId);
    };
  }, [selectedTicker, selectedTimeframe])

  useEffect(() => {
    if (!selectedTicker) return
    setScoreLoading(true)
    fetch(`${API_BASE_URL}/api/v1/screener/score-details/${selectedTicker}`)
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

  const timeframes = [
    { label: "1D", value: "1d" },
    { label: "1S", value: "1h" },
    { label: "15D", value: "15m" },
    { label: "5D", value: "5m" },
    { label: "1H", value: "1w" }
  ]

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Title */}
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">Hisse Tarama ve Grafik Terminali</h1>
        <p className="text-muted-foreground mt-1">
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
                      <option key={sector} value={sector} className="bg-zinc-900 text-foreground">
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
                        <th className="px-4 cursor-pointer hover:text-foreground" onClick={() => handleSort("ticker")}>
                          Kod <ArrowUpDown className="inline h-3 w-3 ml-0.5" />
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
                            onSelect={handleSelectTicker}
                            onToggleFavorite={toggleFavorite}
                          />
                        ))
                      ) : (
                        <tr className="h-20">
                          <td colSpan={6} className="text-center text-muted-foreground text-xs">
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
            <Card glass={true} className="border-primary/20">
              <CardHeader className="pb-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2.5">
                    <span className="bg-primary text-primary-foreground font-black px-2 py-0.5 rounded text-sm">
                      {selectedTicker}
                    </span>
                    <div>
                      <CardTitle className="text-sm font-black line-clamp-1">{selectedStockDetails.name}</CardTitle>
                      <CardDescription className="text-[10px] mt-0.5">{selectedStockDetails.sector}</CardDescription>
                    </div>
                  </div>
                  <button 
                    onClick={() => toggleFavorite(selectedTicker)}
                    className="text-muted-foreground hover:text-amber-400 transition-colors p-1"
                  >
                    <Star className={`h-5 w-5 ${favorites.includes(selectedTicker) ? "text-amber-400 fill-amber-400" : ""}`} />
                  </button>
                </div>

                {/* Price Display */}
                <div className="flex items-baseline justify-between mt-3 pt-3 border-t border-border/40">
                  <span className="text-2xl font-black font-mono text-foreground">₺{selectedStockDetails.price.toFixed(2)}</span>
                  <span className={`text-xs font-bold font-mono ${selectedStockDetails.change_percent >= 0 ? "text-emerald-400" : "text-rose-500"}`}>
                    {selectedStockDetails.change_percent >= 0 ? "+" : ""}{selectedStockDetails.change_percent.toFixed(2)}%
                  </span>
                </div>
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
                <div className="relative border border-border/40 rounded-xl overflow-hidden bg-zinc-900/60 p-1">
                  {chartLoading && (
                    <div className="absolute inset-0 bg-zinc-950/70 backdrop-blur-sm flex items-center justify-center z-10">
                      <Loader2 className="h-6 w-6 text-primary animate-spin" />
                    </div>
                  )}
                  <TradingViewChart data={chartData} />
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
                      selectedStockDetails.sentiment === "Pozitif" ? "text-emerald-400" :
                      selectedStockDetails.sentiment === "Negatif" ? "text-rose-500" :
                      "text-slate-400"
                    }`}>{selectedStockDetails.sentiment}</span>
                  </div>
                  <div className="bg-secondary/20 p-2 border border-border/30 rounded-lg">
                    <span className="block text-[9px] text-muted-foreground uppercase font-bold">AI Skoru</span>
                    <span className="font-bold text-purple-400 mt-0.5 block">{selectedStockDetails.ai_score}/100</span>
                  </div>
                </div>

                {/* AI Score Breakdown Panel */}
                {scoreDetails && (
                  <div className="bg-zinc-950/40 border border-border/30 rounded-xl p-3.5 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-black text-foreground uppercase tracking-wider flex items-center">
                        <Sparkles className="h-3.5 w-3.5 text-purple-400 mr-1.5 animate-pulse" />
                        AI Skoru Detay Analizi
                      </span>
                      <span className={`text-[9px] font-black px-1.5 py-0.5 rounded ${
                        scoreDetails.result === "Pozitif" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" :
                        scoreDetails.result === "Negatif" ? "bg-rose-500/10 text-rose-400 border border-rose-500/20" :
                        "bg-zinc-500/10 text-zinc-400 border border-zinc-500/20"
                      }`}>
                        {scoreDetails.result} ({scoreDetails.risk} Risk)
                      </span>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[10px] pt-0.5">
                      {scoreDetails.reasons && scoreDetails.reasons.map((r: any, idx: number) => (
                        <div key={idx} className="flex items-center justify-between bg-zinc-900/50 p-2 rounded-lg border border-border/20">
                          <span className="flex items-center text-muted-foreground">
                            <span className={`mr-1.5 font-bold ${r.icon === "✔" ? "text-emerald-400" : "text-rose-500"}`}>
                              {r.icon}
                            </span>
                            {r.text}
                          </span>
                          <span className={`font-bold font-mono ${r.value.startsWith("+") ? "text-emerald-400" : "text-rose-500"}`}>
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
    </div>
  )
}
