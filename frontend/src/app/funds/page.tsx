"use client"

import React, { useState, useEffect, useMemo } from "react"
import { Search, Sparkles, Filter, RefreshCw, Loader2, Star, Coins, ArrowUpDown } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card"
import { Button } from "@/components/ui/Button"
import { Input } from "@/components/ui/Input"
import TradingViewChart from "@/components/TradingViewChart"
import { API_BASE_URL } from "@/lib/config"

export default function FundsPage() {
  const [funds, setFunds] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState("")
  const [selectedCategory, setSelectedCategory] = useState("Tümü")
  const [sortField, setSortField] = useState<string>("daily_return")
  const [sortAsc, setSortAsc] = useState<boolean>(false)

  // Favorites state
  const [favorites, setFavorites] = useState<string[]>([])
  const [showOnlyFavorites, setShowOnlyFavorites] = useState(false)

  // Split-view selected fund - defaults to a "?code=" URL param if the header
  // search sent us here (see the matching /screener?ticker= fix - this page
  // was already reachable via /funds?code=CODE but never actually read the
  // param, so it silently ignored it and showed whatever fund was default).
  const [selectedCode, setSelectedCode] = useState(() => {
    if (typeof window !== "undefined") {
      const param = new URLSearchParams(window.location.search).get("code")
      if (param) return param.toUpperCase()
    }
    return "PHE"
  })
  const [chartData, setChartData] = useState<any[]>([])
  const [chartLoading, setChartLoading] = useState(false)

  // Load favorites from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem("favorites_funds")
    if (saved) {
      setFavorites(JSON.parse(saved))
    }
  }, [])

  // Toggle favorite helper
  const toggleFavorite = (code: string) => {
    let updated = [...favorites]
    if (updated.includes(code)) {
      updated = updated.filter(c => c !== code)
    } else {
      updated.push(code)
    }
    setFavorites(updated)
    localStorage.setItem("favorites_funds", JSON.stringify(updated))
  }

  // Listen to select-fund custom events from header search (Request 16!)
  useEffect(() => {
    const handleSelectFund = (e: Event) => {
      const code = (e as CustomEvent).detail
      if (code) {
        setSelectedCode(code.toUpperCase())
        const detailEl = document.getElementById("fund-detail-pane")
        if (detailEl) {
          detailEl.scrollIntoView({ behavior: "smooth" })
        }
      }
    }
    window.addEventListener("select-fund", handleSelectFund)
    return () => window.removeEventListener("select-fund", handleSelectFund)
  }, [])

  // If we arrived here via a "?code=" URL param (header search, from a page
  // other than /funds), scroll the detail pane into view once on mount.
  useEffect(() => {
    const param = new URLSearchParams(window.location.search).get("code")
    if (param) {
      const detailEl = document.getElementById("fund-detail-pane")
      if (detailEl) detailEl.scrollIntoView({ behavior: "smooth" })
    }
  }, [])

  // Fetch live TEFAS fund data on mount + auto-refresh
  useEffect(() => {
    // BUG FIX: this effect has an empty dependency array (runs once), but the
    // old code checked the `loading` *state* inside fetchFunds - that reads
    // the stale value captured when the effect was created (always `true`,
    // since it never re-runs), not the latest value. That meant EVERY 10s
    // poll re-triggered "set selected fund to the first item in the list",
    // silently yanking the user back to whatever fund happens to be first
    // regardless of what they'd actually selected - which is exactly why the
    // fund detail pane's price/daily-change/chart appeared to "randomly bug
        // out" every ~10 seconds. Use a plain flag instead so this only ever
    // fires once, on the true first successful load (same fix already
    // applied to the analogous bug on the Hisseler/screener page).
    let hasSetInitialFund = false
    // Respect an explicit "?code=" URL param - don't let the first load
    // silently override it with the first fund in the list.
    const urlHadCode = !!new URLSearchParams(window.location.search).get("code")

    const fetchFunds = () => {
      fetch(`${API_BASE_URL}/api/v1/funds/`)
        .then(res => res.json())
        .then(data => {
          if (Array.isArray(data)) {
            setFunds(data)
            if (data.length > 0 && !hasSetInitialFund) {
              hasSetInitialFund = true
              if (!urlHadCode) {
                setSelectedCode(data[0].code)
              }
            }
          }
          setLoading(false)
        })
        .catch(err => {
          console.error("Failed to load TEFAS funds:", err)
          setLoading(false)
        })
    }

    fetchFunds()
    const interval = setInterval(fetchFunds, 10000)
    return () => clearInterval(interval)
  }, [])

  // Fetch fund candles when selectedCode changes
  useEffect(() => {
    setChartLoading(true)
    fetch(`${API_BASE_URL}/api/v1/funds/chart/${selectedCode}?count=30`)
      .then(res => {
        if (!res.ok) {
          console.warn("No chart data from server");
          return [];
        }
        return res.json()
      })
      .then(data => {
        if (Array.isArray(data)) {
          setChartData(data)
        }
        setChartLoading(false)
      })
      .catch(err => {
        console.error("Failed to load fund chart:", err)
        setChartLoading(false)
      })
  }, [selectedCode])

  // Get details of selected fund
  const selectedFundDetails = useMemo(() => {
    return funds.find(f => f.code === selectedCode) || null
  }, [funds, selectedCode])

  // Dynamic Categories extraction
  const categoriesList = useMemo(() => {
    const cats = new Set<string>()
    cats.add("Tümü")
    funds.forEach(f => {
      if (f.category) cats.add(f.category)
    })
    return Array.from(cats)
  }, [funds])

  // Sorting
  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortAsc(!sortAsc)
    } else {
      setSortField(field)
      setSortAsc(false)
    }
  }

  // Filter & Sort
  const sortedAndFilteredFunds = useMemo(() => {
    let result = funds.filter(fund => {
      const matchesSearch = fund.code.toLowerCase().includes(searchTerm.toLowerCase()) || 
                            fund.name.toLowerCase().includes(searchTerm.toLowerCase())
      
      const matchesCategory = selectedCategory === "Tümü" || fund.category === selectedCategory
      const matchesFavorites = !showOnlyFavorites || favorites.includes(fund.code)

      return matchesSearch && matchesCategory && matchesFavorites
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
  }, [funds, searchTerm, selectedCategory, sortField, sortAsc, favorites, showOnlyFavorites])

  const handleReset = () => {
    setSearchTerm("")
    setSelectedCategory("Tümü")
    setSortField("daily_return")
    setSortAsc(false)
    setShowOnlyFavorites(false)
  }

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Title */}
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight flex items-center">
          <Coins className="h-7 w-7 text-emerald-400 mr-3 animate-pulse" />
          TEFAS Fon Takip Terminali
        </h1>
        <p className="text-muted-foreground mt-1">
          Yapay zekâ ve canlı BİST entegrasyonuyla TEFAS yatırım fonlarını süzün, grafiklerini ve getirilerini izleyin.
        </p>
      </div>

      {/* Main Split Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        
        {/* Left Side: Fund Filter and List (7 cols) */}
        <div className="lg:col-span-7 space-y-6">
          
          {/* Filters Card */}
          <Card glass={true}>
            <CardHeader className="py-4">
              <CardTitle className="text-sm flex items-center">
                <Filter className="h-4 w-4 mr-2 text-primary" />
                Fon Tarama Kriterleri
              </CardTitle>
            </CardHeader>
            <CardContent className="pb-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Search */}
                <div className="space-y-1">
                  <label className="text-[10px] text-muted-foreground font-bold uppercase">Fon Kodu/Adı</label>
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      placeholder="MAC, TCD, AFT..."
                      className="pl-8 h-8 text-xs bg-secondary/30"
                    />
                  </div>
                </div>

                {/* Category */}
                <div className="space-y-1">
                  <label className="text-[10px] text-muted-foreground font-bold uppercase">Fon Türü (Kategori)</label>
                  <select
                    value={selectedCategory}
                    onChange={(e) => setSelectedCategory(e.target.value)}
                    className="w-full h-8 rounded-md border border-input bg-secondary/30 px-2 text-xs focus-visible:outline-none"
                  >
                    {categoriesList.map(cat => (
                      <option key={cat} value={cat} className="bg-zinc-900 text-foreground">
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Action row */}
              <div className="flex items-center justify-between mt-4 pt-3 border-t border-border/40">
                <Button 
                  variant={showOnlyFavorites ? "default" : "outline"} 
                  size="sm" 
                  onClick={() => setShowOnlyFavorites(!showOnlyFavorites)} 
                  className="text-xs h-7 px-2.5 cursor-pointer flex items-center"
                >
                  <Star className={`h-3.5 w-3.5 mr-1 ${showOnlyFavorites ? "fill-current" : ""}`} />
                  Favori Fonlarım
                </Button>
                
                <div className="flex items-center space-x-3">
                  <Button variant="ghost" size="sm" onClick={handleReset} className="text-xs h-7 px-2 cursor-pointer flex items-center text-muted-foreground hover:text-foreground">
                    <RefreshCw className="h-3 w-3 mr-1" />
                    Temizle
                  </Button>
                  <span className="text-[10px] font-bold text-muted-foreground uppercase">
                    {sortedAndFilteredFunds.length} Fon Listeleniyor
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* List Table Card */}
          <Card glass={true}>
            <CardContent className="p-0">
              <div className="overflow-x-auto max-h-[500px]">
                {loading ? (
                  <div className="flex flex-col items-center justify-center py-20 space-y-3">
                    <Loader2 className="h-8 w-8 text-primary animate-spin" />
                    <span className="text-xs text-muted-foreground">TEFAS Verileri Alınıyor...</span>
                  </div>
                ) : (
                  <table className="w-full text-xs text-left border-collapse">
                    <thead>
                      <tr className="border-b border-border/80 text-muted-foreground font-bold bg-secondary/15 h-9 sticky top-0 backdrop-blur z-10">
                        <th className="px-4 text-center w-8">Fav</th>
                        <th className="px-4 cursor-pointer hover:text-foreground" onClick={() => handleSort("code")}>
                          Kod <ArrowUpDown className="inline h-3 w-3 ml-0.5" />
                        </th>
                        <th className="px-4 cursor-pointer hover:text-foreground" onClick={() => handleSort("name")}>
                          Fon Adı <ArrowUpDown className="inline h-3 w-3 ml-0.5" />
                        </th>
                        <th className="px-4 cursor-pointer hover:text-foreground" onClick={() => handleSort("category")}>
                          Kategori <ArrowUpDown className="inline h-3 w-3 ml-0.5" />
                        </th>
                        <th className="px-4 text-right cursor-pointer hover:text-foreground" onClick={() => handleSort("price")}>
                          Fiyat <ArrowUpDown className="inline h-3 w-3 ml-0.5" />
                        </th>
                        <th className="px-4 text-right cursor-pointer hover:text-foreground" onClick={() => handleSort("daily_return")}>
                          Günlük % <ArrowUpDown className="inline h-3 w-3 ml-0.5" />
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedAndFilteredFunds.length > 0 ? (
                        sortedAndFilteredFunds.map(fund => {
                          const isFav = favorites.includes(fund.code)
                          const isSelected = selectedCode === fund.code
                          return (
                            <tr
                              key={fund.code}
                              onClick={() => setSelectedCode(fund.code)}
                              className={`border-b border-border/30 hover:bg-secondary/20 transition-colors h-11 cursor-pointer ${
                                isSelected ? "bg-primary/10 border-primary/20 hover:bg-primary/15" : ""
                              }`}
                            >
                              <td className="px-4 text-center" onClick={(e) => {
                                e.stopPropagation()
                                toggleFavorite(fund.code)
                              }}>
                                <button className="text-muted-foreground hover:text-amber-400 transition-colors">
                                  <Star className={`h-4 w-4 ${isFav ? "text-amber-400 fill-amber-400" : ""}`} />
                                </button>
                              </td>
                              <td className="px-4 font-bold text-foreground">
                                <span className={`px-2 py-0.5 rounded text-[10px] ${
                                  isSelected ? "bg-primary text-primary-foreground" : "bg-secondary"
                                }`}>
                                  {fund.code}
                                </span>
                              </td>
                              <td className="px-4 font-medium text-foreground/95 truncate max-w-[150px]">{fund.name}</td>
                              <td className="px-4 text-muted-foreground">{fund.category}</td>
                              <td className="px-4 text-right font-mono font-bold">₺{fund.price.toFixed(4)}</td>
                              <td className="px-4 text-right font-mono font-semibold">
                                <span className={fund.daily_return >= 0 ? "text-emerald-400" : "text-rose-500"}>
                                  {fund.daily_return >= 0 ? "+" : ""}{fund.daily_return.toFixed(2)}%
                                </span>
                              </td>
                            </tr>
                          )
                        })
                      ) : (
                        <tr className="h-20">
                          <td colSpan={6} className="text-center text-muted-foreground text-xs">
                            Fon bulunamadı.
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

        {/* Right Side: Fund Details View & Chart (5 cols) */}
        <div id="fund-detail-pane" className="lg:col-span-5 space-y-6">
          {selectedFundDetails ? (
            <Card glass={true} className="border-primary/20">
              <CardHeader className="pb-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2.5">
                    <span className="bg-emerald-500 text-emerald-950 font-black px-2 py-0.5 rounded text-sm shadow">
                      {selectedCode}
                    </span>
                    <div>
                      <CardTitle className="text-sm font-black line-clamp-1">{selectedFundDetails.name}</CardTitle>
                      <CardDescription className="text-[10px] mt-0.5">{selectedFundDetails.category} Kategorisi</CardDescription>
                    </div>
                  </div>
                  <button 
                    onClick={() => toggleFavorite(selectedCode)}
                    className="text-muted-foreground hover:text-amber-400 transition-colors p-1"
                  >
                    <Star className={`h-5 w-5 ${favorites.includes(selectedCode) ? "text-amber-400 fill-amber-400" : ""}`} />
                  </button>
                </div>

                <div className="flex items-baseline justify-between mt-3 pt-3 border-t border-border/40">
                  <span className="text-2xl font-black font-mono text-foreground">₺{selectedFundDetails.price.toFixed(4)}</span>
                  <span className={`text-xs font-bold font-mono ${selectedFundDetails.daily_return >= 0 ? "text-emerald-400" : "text-rose-500"}`}>
                    {selectedFundDetails.daily_return >= 0 ? "+" : ""}{selectedFundDetails.daily_return.toFixed(2)}% Bugün
                  </span>
                </div>
              </CardHeader>

              <CardContent className="space-y-4">
                {/* Chart */}
                <div className="relative border border-border/40 rounded-xl overflow-hidden bg-zinc-900/60 p-1">
                  {chartLoading && (
                    <div className="absolute inset-0 bg-zinc-950/70 backdrop-blur-sm flex items-center justify-center z-10">
                      <Loader2 className="h-6 w-6 text-primary animate-spin" />
                    </div>
                  )}
                  <TradingViewChart data={chartData} />
                </div>

                {/* Returns Table */}
                <div className="space-y-2">
                  <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">Tarihsel Getiri Performansı</span>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="bg-secondary/20 p-2.5 border border-border/30 rounded-lg flex items-center justify-between">
                      <span className="text-muted-foreground">Son 1 Hafta</span>
                      <span className={`font-bold font-mono ${selectedFundDetails.weekly_return >= 0 ? "text-emerald-400" : "text-rose-500"}`}>
                        {selectedFundDetails.weekly_return >= 0 ? "+" : ""}{selectedFundDetails.weekly_return.toFixed(2)}%
                      </span>
                    </div>
                    <div className="bg-secondary/20 p-2.5 border border-border/30 rounded-lg flex items-center justify-between">
                      <span className="text-muted-foreground">Son 1 Ay</span>
                      <span className={`font-bold font-mono ${selectedFundDetails.monthly_return >= 0 ? "text-emerald-400" : "text-rose-500"}`}>
                        {selectedFundDetails.monthly_return >= 0 ? "+" : ""}{selectedFundDetails.monthly_return.toFixed(2)}%
                      </span>
                    </div>
                  </div>
                </div>

                <div className="pt-3 border-t border-border/30 flex flex-col space-y-2">
                  <Button 
                    variant="default" 
                    size="sm" 
                    onClick={() => window.location.href = `/funds/${selectedCode.toLowerCase()}`}
                    className="w-full text-xs font-black cursor-pointer bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-black border-0 shadow-md shadow-emerald-500/10"
                  >
                    Detaylı Analiz & Varlık Kırılımı (Premium)
                  </Button>
                  <div className="text-[9px] text-muted-foreground text-center">
                    * Veriler TEFAS üzerinden anlık endeks değişim çarpanlarına göre simüle edilmiştir.
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card glass={true} className="p-8 text-center text-muted-foreground text-xs">
              Detayları ve fon fiyat grafiğini incelemek için soldan bir fon seçin.
            </Card>
          )}
        </div>

      </div>
    </div>
  )
}
