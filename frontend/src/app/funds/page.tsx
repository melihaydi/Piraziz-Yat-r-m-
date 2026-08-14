"use client"

import React, { useState, useEffect, useMemo, useRef, useSyncExternalStore } from "react"
import { useRouter } from "next/navigation"
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer } from "recharts"
import { Search, Sparkles, Filter, RefreshCw, Loader2, Star, Coins, ArrowUpDown, Scale, X, Zap, ChevronDown, History } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card"
import { Button } from "@/components/ui/Button"
import { Input } from "@/components/ui/Input"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/Dialog"
import TradingViewChart from "@/components/TradingViewChart"
import { API_BASE_URL } from "@/lib/config"
import { authFetch } from "@/lib/auth"
import { pollWhileVisibleAndOpen } from "@/lib/usePolling"
import { subscribePopularFunds, getPopularFundsSnapshot } from "@/lib/popularFundsStore"

const COMPARE_COLORS = ["#a855f7", "#06b6d4", "#10b981", "#fbbf24", "#ec4899"]

function formatDateWithWeekday(isoDate: string): string {
  const d = new Date(isoDate)
  if (Number.isNaN(d.getTime())) return isoDate
  const datePart = d.toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric" })
  const weekday = d.toLocaleDateString("tr-TR", { weekday: "long" })
  return `${datePart} (${weekday})`
}

function buildComparisonChartData(funds: any[]) {
  const withCandles = funds.filter((f) => Array.isArray(f.candles) && f.candles.length > 0)
  if (withCandles.length === 0) return []
  const minLen = Math.min(...withCandles.map((f) => f.candles.length))
  if (minLen === 0) return []
  // Align on the most recent `minLen` candles of each fund (not the earliest)
  // so series with different history lengths still compare the SAME shared
  // trading-day window, then normalize each to % change from its own first
  // point in that window - funds trade at wildly different NAV scales
  // (e.g. ₺1.16 vs ₺7457) so raw price overlay would be meaningless.
  const trimmed = withCandles.map((f) => f.candles.slice(-minLen))
  const rows: any[] = []
  for (let i = 0; i < minLen; i++) {
    const row: any = { time: trimmed[0][i]?.time }
    withCandles.forEach((f, idx) => {
      const base = trimmed[idx][0]?.close
      const cur = trimmed[idx][i]?.close
      row[f.code] = base ? Number((((cur / base) - 1) * 100).toFixed(2)) : 0
    })
    rows.push(row)
  }
  return rows
}

export default function FundsPage() {
  const router = useRouter()
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

  // Clicking a fund card in the homepage's "Popüler Fonlar - Anlık Getiri"
  // section (or anywhere else linking here with ?code=) landed on whatever
  // scroll position the browser happened to restore for this route (Next.js
  // doesn't always reset scroll on a query-param-only navigation) - often
  // mid-page, past this section, near "Fon Tarama Kriterleri" - instead of
  // showing the very section the user came from. Explicitly scrolling this
  // section into view whenever the page was opened with a ?code= param
  // fixes that regardless of whatever the browser's own scroll restoration
  // decided to do.
  const popularFundsRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (typeof window === "undefined") return
    const hadCode = !!new URLSearchParams(window.location.search).get("code")
    if (hadCode) {
      popularFundsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
    }
  }, [])

  // "Popüler Fonlar - Anlık Getiri": TEFAS only publishes one NAV per fund
  // per day, so this is an ESTIMATE built from each fund's last known
  // holdings x their live BIST prices (see backend get_live_estimated_return).
  // Reads from a shared module-level store (popularFundsStore.ts), same one
  // the homepage uses - navigating home -> funds -> home no longer fires a
  // fresh request each time, only the first page to mount this session does.
  const { funds: popularFunds, loading: popularLoading } = useSyncExternalStore(
    subscribePopularFunds,
    getPopularFundsSnapshot,
    getPopularFundsSnapshot
  )
  // A Set (not a single value) so expanding PBR doesn't collapse TMV -
  // each card toggles independently.
  const [expandedPopularCodes, setExpandedPopularCodes] = useState<Set<string>>(new Set())

  // Tahmin doğruluğu (geçmiş): her gün akşam (TEFAS'ın kendi NAV
  // yenilemesinden sonra), o günün canlı tahmini ile TEFAS'ın yayınladığı
  // gerçek günlük getiri aynı satıra kaydediliyor - see
  // FundEstimateSnapshotService (backend). Sadece açıldığında yüklenir.
  const [estimateHistory, setEstimateHistory] = useState<any[]>([])
  const [estimateHistoryLoading, setEstimateHistoryLoading] = useState(false)
  const [showEstimateHistory, setShowEstimateHistory] = useState(false)

  const handleToggleEstimateHistory = () => {
    setShowEstimateHistory(prev => {
      const next = !prev
      if (next) {
        setEstimateHistoryLoading(true)
        fetch(`${API_BASE_URL}/api/v1/funds/popular/estimate-history?days=30`)
          .then(res => res.json())
          .then(data => setEstimateHistory(Array.isArray(data.snapshots) ? data.snapshots : []))
          .catch(err => console.error("Failed to load fund estimate history:", err))
          .finally(() => setEstimateHistoryLoading(false))
      }
      return next
    })
  }

  // A single headline number is much easier to read at a glance than a
  // column of raw "Fark" values the user has to mentally average - mean
  // absolute error across every row that actually has both an estimate and
  // a real TEFAS return to compare against.
  const estimateAccuracySummary = useMemo(() => {
    const withError = estimateHistory.filter((r: any) => r.error_pct != null)
    if (withError.length === 0) return null
    const meanAbsError = withError.reduce((sum: number, r: any) => sum + Math.abs(r.error_pct), 0) / withError.length
    const withinHalfPoint = withError.filter((r: any) => Math.abs(r.error_pct) <= 0.5).length
    return {
      meanAbsError,
      accuratePct: (withinHalfPoint / withError.length) * 100,
      sampleCount: withError.length,
    }
  }, [estimateHistory])

  // Same 3-tier scale used both for the summary badge and every row's "Fark"
  // cell, so the two always agree on what counts as accurate.
  function accuracyTier(absError: number): { label: string; className: string } {
    if (absError <= 0.5) return { label: "İsabetli", className: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" }
    if (absError <= 1.5) return { label: "Orta", className: "text-amber-400 bg-amber-500/10 border-amber-500/20" }
    return { label: "Sapmalı", className: "text-rose-400 bg-rose-500/10 border-rose-500/20" }
  }

  // Fund comparison state (2-5 funds, matches the backend's GET /funds/compare cap)
  const [compareCodes, setCompareCodes] = useState<string[]>([])
  const [compareOpen, setCompareOpen] = useState(false)
  const [compareLoading, setCompareLoading] = useState(false)
  const [compareError, setCompareError] = useState<string | null>(null)
  const [compareResult, setCompareResult] = useState<any[]>([])

  const toggleCompare = (code: string) => {
    setCompareCodes((prev) => {
      if (prev.includes(code)) return prev.filter((c) => c !== code)
      if (prev.length >= 5) return prev
      return [...prev, code]
    })
  }

  const runCompare = async () => {
    if (compareCodes.length < 2) return
    setCompareOpen(true)
    setCompareLoading(true)
    setCompareError(null)
    try {
      const res = await authFetch(`/funds/compare?codes=${compareCodes.join(",")}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setCompareError(body.detail || "Karşılaştırma başarısız oldu.")
        setCompareResult([])
        return
      }
      const data = await res.json()
      setCompareResult(data.funds || [])
    } catch (err) {
      console.error("Failed to compare funds:", err)
      setCompareError("Karşılaştırma sırasında bir hata oluştu.")
    } finally {
      setCompareLoading(false)
    }
  }

  const compareChartData = useMemo(() => buildComparisonChartData(compareResult), [compareResult])

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
    // pollWhileVisibleAndOpen - stops while the tab is hidden AND outside
    // the BIST session (see usePolling.ts / bistSession.ts): this list's
    // prices don't move outside 09:30-18:15 Mon-Fri Istanbul time either.
    return pollWhileVisibleAndOpen(fetchFunds, 10000)
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

      {/* Popüler Fonlar - Anlık Getiri */}
      <Card ref={popularFundsRef} glass={true} className="border-amber-500/20">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center">
            <Zap className="h-4 w-4 mr-2 text-amber-400" />
            Popüler Fonlar - Anlık Getiri
          </CardTitle>
          <CardDescription className="text-xs">
            TEFAS fonların NAV&apos;ını günde bir kez yayınlar - bu bölüm, her fonun son bilinen varlık dağılımını o
            varlıkların canlı BİST fiyat değişimiyle ağırlıklandırarak <strong>tahmini</strong> bir gün-içi getiri
            hesaplar. Gerçek bir NAV yeniden hesaplaması değildir.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {popularLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-6 w-6 text-amber-400 animate-spin" />
            </div>
          ) : popularFunds.length === 0 ? (
            <div className="py-6 text-center text-xs text-muted-foreground">Veri alınamadı.</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
              {popularFunds.map(f => {
                const isUp = f.estimated_change_pct >= 0
                const isExpanded = expandedPopularCodes.has(f.code)
                return (
                  <div key={f.code} className="border border-border/40 rounded-xl bg-secondary/10 overflow-hidden">
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
                        <span className="bg-amber-500 text-amber-950 font-black px-2 py-0.5 rounded text-xs">
                          {f.code}
                        </span>
                        <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${isExpanded ? "rotate-180" : ""}`} />
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
                    </button>
                    {isExpanded && (
                      <div className="border-t border-border/30 px-3 py-2 space-y-1.5 max-h-64 overflow-y-auto">
                        {/* Two clearly-separate numbers per holding, on purpose:
                            "Ağırlık" is the static disclosed weight (never
                            changes intraday), "Fona Etkisi" is how many points
                            of the fund's LIVE estimate this holding is
                            currently responsible for (weight/100 * its own
                            change% today) - conflating these two reads as one
                            number that means neither thing correctly. */}
                        {f.holdings
                          .slice()
                          .sort((a: any, b: any) => b.weight - a.weight)
                          .map((h: any) => (
                            <div key={h.ticker} className="flex items-center justify-between text-xs gap-2">
                              <div className="flex items-baseline gap-1.5 min-w-0">
                                <span className="font-bold text-foreground truncate">{h.ticker}</span>
                                <span className="text-muted-foreground/70 shrink-0">Ağırlık %{h.weight.toFixed(2)}</span>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                {h.change_pct != null && (
                                  <span className="text-muted-foreground/70">
                                    {h.change_pct >= 0 ? "+" : ""}{h.change_pct.toFixed(2)}%
                                  </span>
                                )}
                                {h.impact_pct != null ? (
                                  <span
                                    title="Fona Etkisi - bu varlığın fonun bugünkü tahmini getirisine kaç puan katkısı olduğu"
                                    className={`font-bold px-1.5 py-0.5 rounded border ${
                                      h.impact_pct >= 0
                                        ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                        : "bg-rose-500/10 text-rose-500 border-rose-500/20"
                                    }`}
                                  >
                                    {h.impact_pct >= 0 ? "+" : ""}{h.impact_pct.toFixed(2)}p
                                  </span>
                                ) : (
                                  <span className="text-muted-foreground/40">—</span>
                                )}
                              </div>
                            </div>
                          ))}
                        <div className="flex items-center gap-3 pt-1.5 mt-1 border-t border-border/20 text-xs text-muted-foreground/60">
                          <span>Ağırlık: fondaki sabit pay</span>
                          <span>·</span>
                          <span>p (puan): fona bugünkü etkisi</span>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Tahmin Doğruluğu (Geçmiş) */}
      <Card glass={true} className="border-border/40">
        <CardHeader className="pb-3">
          <button onClick={handleToggleEstimateHistory} className="w-full flex items-center justify-between cursor-pointer">
            <CardTitle className="text-sm flex items-center">
              <History className="h-4 w-4 mr-2 text-cyan-400" />
              Tahmin Doğruluğu (Geçmiş)
            </CardTitle>
            <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${showEstimateHistory ? "rotate-180" : ""}`} />
          </button>
          {showEstimateHistory && (
            <CardDescription className="text-xs">
              Her akşam kaydedilen o günün canlı tahmini, TEFAS&apos;ın ertesi sabah yayınladığı gerçek günlük getiriyle
              karşılaştırılır - tahminin ne kadar isabetli olduğunu görmek için.
            </CardDescription>
          )}
        </CardHeader>
        {showEstimateHistory && (
          <CardContent>
            {estimateHistoryLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 text-cyan-400 animate-spin" />
              </div>
            ) : estimateHistory.length === 0 ? (
              <div className="py-6 text-center text-xs text-muted-foreground">
                Henüz kayıt yok - ilk kayıt bugün akşam (TEFAS güncellemesinden sonra) oluşacak.
              </div>
            ) : (
              <>
                {/* Headline number first - "ortalama sapma X puan" is what
                    actually answers "bu tahmine ne kadar güvenebilirim",
                    the row-by-row table below is the detail, not the summary. */}
                {estimateAccuracySummary && (
                  <div className="flex items-center gap-4 mb-4 p-3 rounded-lg bg-secondary/15 border border-border/30">
                    <div>
                      <div className="text-[11px] text-muted-foreground uppercase font-bold">Ortalama Sapma</div>
                      <div className="text-lg font-black font-mono text-foreground">
                        ±{estimateAccuracySummary.meanAbsError.toFixed(2)} <span className="text-xs font-bold text-muted-foreground">puan</span>
                      </div>
                    </div>
                    <div className="h-8 w-px bg-border/40" />
                    <div>
                      <div className="text-[11px] text-muted-foreground uppercase font-bold">İsabet Oranı</div>
                      <div className="text-lg font-black font-mono text-emerald-400">
                        %{estimateAccuracySummary.accuratePct.toFixed(0)}
                      </div>
                    </div>
                    <div className="text-[11px] text-muted-foreground/70 ml-auto text-right leading-relaxed">
                      Son {estimateAccuracySummary.sampleCount} ölçümde,<br />±0.5 puan içinde kalan tahmin oranı
                    </div>
                  </div>
                )}
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-xs text-muted-foreground uppercase border-b border-border/40">
                        <th className="text-left py-2 pr-4">Tarih</th>
                        <th className="text-left py-2 pr-4">Fon</th>
                        <th className="text-right py-2 pr-4">Canlı Tahmin</th>
                        <th className="text-right py-2 pr-4">TEFAS Gerçek</th>
                        <th className="text-right py-2">Sapma</th>
                      </tr>
                    </thead>
                    <tbody>
                      {estimateHistory.map((row: any) => {
                        const tier = row.error_pct != null ? accuracyTier(Math.abs(row.error_pct)) : null
                        return (
                          <tr key={`${row.fund_code}-${row.date}`} className="border-b border-border/20">
                            <td className="py-1.5 pr-4 font-mono text-muted-foreground whitespace-nowrap">{formatDateWithWeekday(row.date)}</td>
                            <td className="py-1.5 pr-4 font-bold">{row.fund_code}</td>
                            <td className={`py-1.5 pr-4 text-right font-mono ${row.estimated_change_pct == null ? "text-muted-foreground" : row.estimated_change_pct >= 0 ? "text-emerald-400" : "text-rose-500"}`}>
                              {row.estimated_change_pct == null ? "—" : `${row.estimated_change_pct >= 0 ? "+" : ""}${row.estimated_change_pct.toFixed(2)}%`}
                            </td>
                            <td className={`py-1.5 pr-4 text-right font-mono ${row.actual_change_pct == null ? "text-muted-foreground" : row.actual_change_pct >= 0 ? "text-emerald-400" : "text-rose-500"}`}>
                              {row.actual_change_pct == null ? "—" : `${row.actual_change_pct >= 0 ? "+" : ""}${row.actual_change_pct.toFixed(2)}%`}
                            </td>
                            <td className="py-1.5 text-right">
                              {row.error_pct == null || !tier ? (
                                <span className="font-mono text-muted-foreground">—</span>
                              ) : (
                                <span className={`inline-flex items-center gap-1 font-mono font-bold px-1.5 py-0.5 rounded border text-xs ${tier.className}`}>
                                  {row.error_pct >= 0 ? "+" : ""}{row.error_pct.toFixed(2)} · {tier.label}
                                </span>
                              )}
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
        )}
      </Card>

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
                  <label className="text-xs text-muted-foreground font-bold uppercase">Fon Kodu/Adı</label>
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
                  <label className="text-xs text-muted-foreground font-bold uppercase">Fon Türü (Kategori)</label>
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
                <div className="flex items-center space-x-2">
                  <Button
                    variant={showOnlyFavorites ? "default" : "outline"}
                    size="sm"
                    onClick={() => setShowOnlyFavorites(!showOnlyFavorites)}
                    className="text-xs h-7 px-2.5 cursor-pointer flex items-center"
                  >
                    <Star className={`h-3.5 w-3.5 mr-1 ${showOnlyFavorites ? "fill-current" : ""}`} />
                    Favori Fonlarım
                  </Button>
                </div>

                <div className="flex items-center space-x-3">
                  <Button variant="ghost" size="sm" onClick={handleReset} className="text-xs h-7 px-2 cursor-pointer flex items-center text-muted-foreground hover:text-foreground">
                    <RefreshCw className="h-3 w-3 mr-1" />
                    Temizle
                  </Button>
                  <span className="text-xs font-bold text-muted-foreground uppercase">
                    {sortedAndFilteredFunds.length} Fon Listeleniyor
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* List Table Card */}
          <Card glass={true}>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
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
                        <th className="px-4 text-center w-8">Kıyasla</th>
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
                              <td className="px-4 text-center" onClick={(e) => {
                                e.stopPropagation()
                                const isCompared = compareCodes.includes(fund.code)
                                if (isCompared || compareCodes.length < 5) toggleCompare(fund.code)
                              }}>
                                <button
                                  disabled={!compareCodes.includes(fund.code) && compareCodes.length >= 5}
                                  title={compareCodes.includes(fund.code) ? "Karşılaştırmadan çıkar" : "Karşılaştırmaya ekle"}
                                  className={`h-6 w-6 rounded-md border flex items-center justify-center transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${
                                    compareCodes.includes(fund.code)
                                      ? "bg-cyan-500 border-cyan-400 text-black shadow-[0_0_10px_rgba(34,211,238,0.3)]"
                                      : "border-border/60 text-muted-foreground hover:border-cyan-500/50 hover:text-cyan-400"
                                  }`}
                                >
                                  <Scale className="h-3.5 w-3.5" />
                                </button>
                              </td>
                              <td className="px-4 font-bold text-foreground">
                                <span className={`px-2 py-0.5 rounded text-xs ${
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
                          <td colSpan={7} className="text-center text-muted-foreground text-xs">
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
                      <CardDescription className="text-xs mt-0.5">{selectedFundDetails.category} Kategorisi</CardDescription>
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
                  <TradingViewChart data={chartData} symbol={selectedCode} />
                </div>

                {/* Returns Table */}
                <div className="space-y-2">
                  <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider block">Tarihsel Getiri Performansı</span>
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
                    onClick={() => router.push(`/funds/${selectedCode.toLowerCase()}`)}
                    className="w-full text-xs font-black cursor-pointer bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-black border-0 shadow-md shadow-emerald-500/10"
                  >
                    Detaylı Analiz & Varlık Kırılımı (Premium)
                  </Button>
                  <div className="text-[11px] text-muted-foreground text-center">
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

      {/* Fund Comparison Dialog */}
      <Dialog open={compareOpen} onOpenChange={setCompareOpen}>
        <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center">
              <Scale className="h-4 w-4 mr-2 text-primary" />
              Fon Karşılaştırma
            </DialogTitle>
            <DialogDescription>
              Seçilen fonların getiri, volatilite ve normalize edilmiş performans karşılaştırması.
            </DialogDescription>
          </DialogHeader>

          {compareLoading ? (
            <div className="flex flex-col items-center justify-center py-16 space-y-3">
              <Loader2 className="h-8 w-8 text-primary animate-spin" />
              <span className="text-xs text-muted-foreground">Karşılaştırma hesaplanıyor...</span>
            </div>
          ) : compareError ? (
            <div className="py-10 text-center text-xs text-rose-400">{compareError}</div>
          ) : (
            <div className="space-y-6">
              {/* Normalized overlay chart */}
              <div className="h-64 w-full">
                {compareChartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={compareChartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.3} />
                      <XAxis
                        dataKey="time"
                        tickFormatter={(t) => new Date(t * 1000).toLocaleDateString("tr-TR", { month: "short", day: "numeric" })}
                        tick={{ fontSize: 10 }}
                        minTickGap={30}
                      />
                      <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}%`} width={45} />
                      <RechartsTooltip
                        labelFormatter={(t) => new Date(Number(t) * 1000).toLocaleDateString("tr-TR")}
                        formatter={(value: any, name: any) => [`${value}%`, name]}
                      />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      {compareResult.map((f, idx) => (
                        <Line
                          key={f.code}
                          type="monotone"
                          dataKey={f.code}
                          stroke={COMPARE_COLORS[idx % COMPARE_COLORS.length]}
                          dot={false}
                          strokeWidth={2}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
                    Ortak tarih aralığında grafik verisi bulunamadı.
                  </div>
                )}
              </div>

              {/* Stats table */}
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead>
                    <tr className="border-b border-border/60 text-muted-foreground font-bold h-9">
                      <th className="px-3">Fon</th>
                      <th className="px-3 text-right">Fiyat</th>
                      <th className="px-3 text-right">1 Ay</th>
                      <th className="px-3 text-right">3 Ay</th>
                      <th className="px-3 text-right">1 Yıl</th>
                      <th className="px-3 text-right">Volatilite (Yıllık)</th>
                      <th className="px-3 text-center w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {compareResult.map((f, idx) => (
                      <tr key={f.code} className="border-b border-border/30 h-11">
                        <td className="px-3">
                          <span
                            className="px-2 py-0.5 rounded text-xs font-bold text-black"
                            style={{ backgroundColor: COMPARE_COLORS[idx % COMPARE_COLORS.length] }}
                          >
                            {f.code}
                          </span>
                          {f.is_simulated && (
                            <span className="ml-1.5 text-[11px] text-amber-400 font-semibold">simüle</span>
                          )}
                        </td>
                        <td className="px-3 text-right font-mono font-semibold">₺{Number(f.price).toFixed(4)}</td>
                        {["return_1m_pct", "return_3m_pct", "return_1y_pct"].map((key) => (
                          <td key={key} className="px-3 text-right font-mono font-semibold">
                            {f[key] != null ? (
                              <span className={f[key] >= 0 ? "text-emerald-400" : "text-rose-500"}>
                                {f[key] >= 0 ? "+" : ""}{f[key]}%
                              </span>
                            ) : "—"}
                          </td>
                        ))}
                        <td className="px-3 text-right font-mono">
                          {f.volatility_pct != null ? `%${f.volatility_pct}` : "—"}
                        </td>
                        <td className="px-3 text-center">
                          <button
                            onClick={() => setCompareCodes((prev) => prev.filter((c) => c !== f.code))}
                            className="text-muted-foreground hover:text-rose-500 transition-colors cursor-pointer"
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

      {/* Floating comparison tray - same pattern as the Screener page's
          stock comparison (replaces the old checkbox-column + buried
          filter-row button combo). */}
      {compareCodes.length > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 w-full max-w-2xl px-4">
          <div className="bg-card/95 backdrop-blur-xl border border-cyan-500/30 rounded-2xl shadow-2xl shadow-cyan-500/10 px-4 py-3 flex items-center gap-3">
            <div className="flex items-center gap-2 flex-wrap flex-1 min-w-0">
              <Scale className="h-4 w-4 text-cyan-400 shrink-0" />
              {compareCodes.map((code) => (
                <div
                  key={code}
                  className="flex items-center gap-1.5 bg-secondary/50 border border-border/50 rounded-lg pl-2 pr-1 py-1"
                >
                  <span className="text-[11px] font-bold text-foreground">{code}</span>
                  <button
                    onClick={() => toggleCompare(code)}
                    className="text-muted-foreground hover:text-rose-500 transition-colors cursor-pointer p-0.5"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
              {compareCodes.length < 2 && (
                <span className="text-xs text-muted-foreground">En az 2 fon seçin</span>
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
                className="text-xs h-8 px-3.5 cursor-pointer bg-cyan-500 hover:bg-cyan-400 text-black font-bold disabled:opacity-40"
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
