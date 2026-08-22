"use client"

import React, { useEffect, useMemo, useState, useCallback } from "react"
import Link from "next/link"
import {
  Bot, Loader2, Search, RefreshCw, ChevronDown, ChevronUp, TrendingUp, TrendingDown,
  ArrowUpCircle, ArrowDownCircle, Info, ShieldAlert, ArrowUpDown
} from "lucide-react"
import { authFetch } from "@/lib/auth"
import { pollWhileVisible } from "@/lib/usePolling"
import { parseTLAmount } from "@/lib/utils"
import { TickerLogo } from "@/components/ui/TickerLogo"

type Direction = "LONG" | "SHORT" | "NONE"

interface Signal {
  ticker: string
  name: string
  direction: Direction
  price: number
  change_percent: number
  structure: string
  score: number
  confidence: "Yüksek" | "Orta" | "Düşük"
  reasons: string[]
  triggered_conditions: string[]
  entry: number | null
  stop_loss: number | null
  take_profit: number | null
  risk_reward: number | null
  risk_level: "Düşük" | "Orta" | "Yüksek"
  support_levels: number[]
  resistance_levels: number[]
  last_update: string
  stochastic_k: number | null
  stochastic_d: number | null
  ichimoku_position: string | null
  fibonacci_levels: { ratio: number; price: number }[]
  error: string | null
  // Live price + running %P&L vs entry, enriched at the API layer on every
  // request (see _enrich_with_live_pnl in strategy.py) - fresher than
  // `price` above, which only refreshes with the ~3-minute scan cycle.
  live_price: number | null
  captured_pnl_pct: number | null
}

interface BacktestTrade {
  direction: "LONG" | "SHORT"
  entry_date: string
  entry_price: number
  exit_date: string
  exit_price: number
  exit_reason: string
  return_pct: number
}

interface BacktestResult {
  ticker: string
  name: string
  total_trades: number
  win_rate: number | null
  total_return_pct: number | null
  avg_return_pct: number | null
  best_trade_pct: number | null
  worst_trade_pct: number | null
  last_trade: BacktestTrade | null
  recent_trades: BacktestTrade[]
  error: string | null
  // Ölçüm revizyonuyla gelen alanlar (bkz. strategy_engine.py, BacktestResult).
  // total_return_pct artık bileşik ve maliyet düşülmüş; eskiden yüzdelerin
  // düz toplamıydı ve hiçbir hesabın elde edemeyeceği bir rakamdı.
  max_drawdown_pct: number | null
  profit_factor: number | null
  exposure_pct: number | null
  gross_return_pct: number | null
  cost_drag_pct: number | null
  benchmark_return_pct: number | null
  excess_return_pct: number | null
  oos_trades: number | null
  oos_win_rate: number | null
  oos_return_pct: number | null
}

interface SignalHistoryEntry {
  ticker: string
  name: string
  direction: "LONG" | "SHORT"
  price: number
  score: number
  confidence: "Yüksek" | "Orta" | "Düşük"
  entry: number | null
  stop_loss: number | null
  take_profit: number | null
  timestamp: string
  // Same live enrichment as the current-signals list (see
  // _enrich_with_live_pnl in strategy.py) - now also applied to /history so
  // a past call shows how it's actually done since, not just its price at
  // the moment it fired.
  live_price: number | null
  captured_pnl_pct: number | null
}

type DirectionFilter = "ALL" | "LONG" | "SHORT"
type SortKey = "score" | "ticker" | "change_percent" | "risk_reward" | "captured_pnl_pct"
type BacktestSortKey = "excess_return_pct" | "total_return_pct" | "win_rate" | "ticker"
type HistorySortKey = "timestamp" | "captured_pnl_pct"

const fmt = (n: number | null, digits = 2) => (n === null || n === undefined ? "-" : n.toLocaleString("tr-TR", { minimumFractionDigits: digits, maximumFractionDigits: digits }))

function DirectionBadge({ direction }: { direction: Direction }) {
  if (direction === "LONG") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-bull/15 text-bull border border-bull/30">
        <ArrowUpCircle className="h-3 w-3" /> LONG
      </span>
    )
  }
  if (direction === "SHORT") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-bear/15 text-bear border border-bear/30">
        <ArrowDownCircle className="h-3 w-3" /> SHORT
      </span>
    )
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-secondary/60 text-muted-foreground border border-border">
      YOK
    </span>
  )
}

function ConfidenceBar({ score, confidence }: { score: number; confidence: string }) {
  const color = confidence === "Yüksek" ? "bg-bull" : confidence === "Orta" ? "bg-warn" : "bg-muted-foreground/40"
  return (
    <div className="flex items-center gap-2 min-w-[90px]">
      <div className="flex-1 h-1.5 rounded-full bg-secondary overflow-hidden">
        <div className={`h-full ${color} transition-all duration-300`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-[10px] font-bold text-muted-foreground w-7 text-right">{score}</span>
    </div>
  )
}

function PositionSizeCalculator({ entry, stopLoss }: { entry: number | null; stopLoss: number | null }) {
  const [accountSize, setAccountSize] = useState("100000")
  const [riskPct, setRiskPct] = useState("1")

  if (!entry || !stopLoss) {
    return <p className="text-[11px] text-muted-foreground">Giriş/stop seviyesi olmadığı için hesaplanamıyor.</p>
  }

  const acc = parseTLAmount(accountSize) || 0
  const risk = parseFloat(riskPct.replace(",", ".")) || 0
  const riskAmount = acc * (risk / 100)
  const perShareRisk = Math.abs(entry - stopLoss)
  const lot = perShareRisk > 0 ? Math.floor(riskAmount / perShareRisk) : 0
  const positionValue = lot * entry

  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-muted-foreground">Hesap (₺)</span>
          <input
            type="text"
            inputMode="decimal"
            value={accountSize}
            onChange={e => setAccountSize(e.target.value)}
            className="w-28 h-7 px-2 rounded bg-secondary/40 border border-border text-[11px] text-foreground focus:outline-none focus:border-primary/40"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-muted-foreground">Risk %</span>
          <input
            type="text"
            inputMode="decimal"
            value={riskPct}
            onChange={e => setRiskPct(e.target.value)}
            className="w-16 h-7 px-2 rounded bg-secondary/40 border border-border text-[11px] text-foreground focus:outline-none focus:border-primary/40"
          />
        </div>
      </div>
      <div className="flex items-center gap-4 text-[11px] flex-wrap">
        <span>Önerilen lot: <b className="text-foreground font-mono text-xs">{lot}</b></span>
        <span className="text-muted-foreground">Pozisyon değeri: ₺{positionValue.toLocaleString("tr-TR", { maximumFractionDigits: 0 })}</span>
        <span className="text-muted-foreground">Risk tutarı: ₺{riskAmount.toLocaleString("tr-TR", { maximumFractionDigits: 0 })}</span>
      </div>
    </div>
  )
}

export default function StrategyPage() {
  const [signals, setSignals] = useState<Signal[]>([])
  const [lastUpdate, setLastUpdate] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [query, setQuery] = useState("")
  const [directionFilter, setDirectionFilter] = useState<DirectionFilter>("ALL")
  const [sortKey, setSortKey] = useState<SortKey>("score")
  const [expanded, setExpanded] = useState<string | null>(null)

  const [tab, setTab] = useState<"live" | "history" | "backtest">("live")
  const [history, setHistory] = useState<SignalHistoryEntry[]>([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [historyQuery, setHistoryQuery] = useState("")
  const [historyDirFilter, setHistoryDirFilter] = useState<DirectionFilter>("ALL")
  const [historySortKey, setHistorySortKey] = useState<HistorySortKey>("timestamp")
  const [backtestResults, setBacktestResults] = useState<BacktestResult[]>([])
  const [backtestLastUpdate, setBacktestLastUpdate] = useState<string | null>(null)
  const [backtestLoading, setBacktestLoading] = useState(false)
  const [backtestComputing, setBacktestComputing] = useState(false)
  const [backtestLoaded, setBacktestLoaded] = useState(false)
  const [backtestQuery, setBacktestQuery] = useState("")
  const [backtestSort, setBacktestSort] = useState<BacktestSortKey>("excess_return_pct")
  const [expandedBt, setExpandedBt] = useState<string | null>(null)

  // Free tier can't use Frantic Algoritmik Strateji at all (see
  // deps.get_current_premium_user on strategy.py's router) - without this,
  // a blocked user's scan just came back empty and the page read as "no
  // signals right now" instead of explaining why.
  const [accessDenied, setAccessDenied] = useState(false)

  const fetchScan = useCallback(async (isManual = false) => {
    if (isManual) setRefreshing(true)
    try {
      const res = await authFetch("/strategy/scan")
      if (res.status === 403) setAccessDenied(true)
      if (res.ok) {
        const data = await res.json()
        setSignals(data.signals || [])
        setLastUpdate(data.last_update || null)
      }
    } catch (e) {
      console.error("Failed to load strategy scan:", e)
    } finally {
      setLoading(false)
      if (isManual) setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    fetchScan()
    // The backend only recomputes every 3 minutes (see StrategyEngine -
    // REFRESH_INTERVAL_SECONDS), so this just needs to be frequent enough
    // to pick up a finished background scan promptly, not to drive the
    // computation itself. pollWhileVisible - stops while the tab is hidden.
    return pollWhileVisible(() => fetchScan(), 30000)
  }, [fetchScan])

  const fetchHistory = useCallback(async () => {
    try {
      const res = await authFetch("/strategy/history")
      if (res.ok) {
        const data = await res.json()
        setHistory(data.history || [])
      }
    } catch (e) {
      console.error("Failed to load signal history:", e)
    } finally {
      setHistoryLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchHistory()
    return pollWhileVisible(fetchHistory, 30000)
  }, [fetchHistory])

  const filteredHistory = useMemo(() => {
    const q = historyQuery.trim().toUpperCase()
    let list = history.filter(h => !q || h.ticker.includes(q) || h.name.toUpperCase().includes(q))
    if (historyDirFilter !== "ALL") list = list.filter(h => h.direction === historyDirFilter)
    return [...list].sort((a, b) => {
      if (historySortKey === "captured_pnl_pct") {
        return (b.captured_pnl_pct ?? -Infinity) - (a.captured_pnl_pct ?? -Infinity)
      }
      return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    })
  }, [history, historyQuery, historyDirFilter, historySortKey])

  const filtered = useMemo(() => {
    const q = query.trim().toUpperCase()
    let list = signals.filter(s => !q || s.ticker.includes(q) || s.name.toUpperCase().includes(q))
    if (directionFilter !== "ALL") list = list.filter(s => s.direction === directionFilter)
    const sorted = [...list].sort((a, b) => {
      switch (sortKey) {
        case "ticker": return a.ticker.localeCompare(b.ticker)
        case "change_percent": return b.change_percent - a.change_percent
        case "risk_reward": return (b.risk_reward ?? -1) - (a.risk_reward ?? -1)
        case "captured_pnl_pct": return (b.captured_pnl_pct ?? -Infinity) - (a.captured_pnl_pct ?? -Infinity)
        default: return b.score - a.score
      }
    })
    return sorted
  }, [signals, query, directionFilter, sortKey])

  const activeCount = signals.filter(s => s.direction !== "NONE").length

  const fetchBacktest = useCallback(async () => {
    setBacktestLoading(true)
    try {
      // The backend never blocks this request: if there's no cached result
      // yet (first call after a cold start) it kicks the ~30-symbol x
      // ~2-year walk-forward computation off in the background and replies
      // immediately with computing=true - polled below until it flips to
      // false, instead of holding this HTTP request open for minutes.
      const res = await authFetch("/strategy/backtest")
      if (res.ok) {
        const data = await res.json()
        setBacktestResults(data.results || [])
        setBacktestLastUpdate(data.last_update || null)
        setBacktestComputing(!!data.computing)
        setBacktestLoaded(true)
      }
    } catch (e) {
      console.error("Failed to load backtest results:", e)
    } finally {
      setBacktestLoading(false)
    }
  }, [])

  useEffect(() => {
    if (tab === "backtest" && !backtestLoaded && !backtestLoading) {
      fetchBacktest()
    }
  }, [tab, backtestLoaded, backtestLoading, fetchBacktest])

  useEffect(() => {
    if (!backtestComputing) return
    // pollWhileVisible, duz setInterval DEGIL. Bu, usePolling.ts'in tam da
    // cozmek icin yazildigi durumun atlanmis tek cagri yeriydi: backtest
    // hesaplanirken kullanici baska sekmeye gecerse (hesaplama dakikalarca
    // surebiliyor) tarayici bu araligi atmaya devam ediyordu - hicbiri
    // ekrana cizilmeyen, 5 saniyede bir istek. Dosyadaki diger her poll
    // zaten bu yardimciyi kullaniyor.
    return pollWhileVisible(fetchBacktest, 5000)
  }, [backtestComputing, fetchBacktest])

  const filteredBacktest = useMemo(() => {
    const q = backtestQuery.trim().toUpperCase()
    const list = backtestResults.filter(r => !q || r.ticker.includes(q) || r.name.toUpperCase().includes(q))
    return [...list].sort((a, b) => {
      switch (backtestSort) {
        case "ticker": return a.ticker.localeCompare(b.ticker)
        case "win_rate": return (b.win_rate ?? -1) - (a.win_rate ?? -1)
        case "total_return_pct": return (b.total_return_pct ?? -999) - (a.total_return_pct ?? -999)
        // Varsayılan sıralama artık ham getiri değil, XU100'e göre fark:
        // yükselen bir piyasada pozitif getiri tek başına bir üstünlük
        // göstermiyor, listenin başına onu çıkarmak yanıltıcıydı.
        default: return (b.excess_return_pct ?? -9999) - (a.excess_return_pct ?? -9999)
      }
    })
  }, [backtestResults, backtestQuery, backtestSort])

  if (accessDenied) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-32 text-center">
        <ShieldAlert className="h-8 w-8 text-primary" />
        <span className="text-sm font-bold text-foreground">Frantic Algoritmik Strateji Premium üyelik gerektirir</span>
        <span className="text-xs text-muted-foreground max-w-sm">
          Bu bölüm ücretsiz üyelikte kullanılamıyor. Üyeliğinizi yükseltmek için Ayarlar sayfasını ziyaret edin.
        </span>
        <Link href="/settings" className="mt-2 text-xs font-bold text-primary hover:text-primary-hover underline underline-offset-2">
          Ayarlar&apos;a git
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex items-start justify-between flex-wrap gap-3 animate-rise">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-xl bg-primary/10 border border-primary/25 flex items-center justify-center shrink-0">
            <Bot className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-black tracking-tight text-foreground flex items-center gap-2">
              Frantic Algoritmik Strateji
              <span className="live-dot h-1.5 w-1.5 rounded-full bg-primary text-primary" />
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Piyasa yapısı, kırılım-retest dinamikleri, mum formasyonları ve momentum teyitlerini harmanlayan BIST30 tabanlı profesyonel sinyal motoru.

3. Kompakt & Vurucu (Dashboard / Menü Açıklaması İçin)
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {lastUpdate && (
            <span className="text-[10px] text-muted-foreground">
              Son tarama: {new Date(lastUpdate).toLocaleTimeString("tr-TR")}
            </span>
          )}
          <button
            onClick={() => fetchScan(true)}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border text-xs font-bold text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            Yenile
          </button>
        </div>
      </div>

      {/* Tab switch */}
      <div className="flex items-center bg-secondary/40 border border-border rounded-lg p-0.5 text-[11px] font-bold w-fit">
        <button
          onClick={() => setTab("live")}
          className={`px-4 h-8 rounded-md transition-colors cursor-pointer press ${tab === "live" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
        >
          Canlı Tarama
        </button>
        <button
          onClick={() => setTab("history")}
          className={`px-4 h-8 rounded-md transition-colors cursor-pointer press ${tab === "history" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
        >
          Sinyal Geçmişi{history.length > 0 ? ` (${history.length})` : ""}
        </button>
        <button
          onClick={() => setTab("backtest")}
          className={`px-4 h-8 rounded-md transition-colors cursor-pointer press ${tab === "backtest" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
        >
          Backtest
        </button>
      </div>

      {tab === "live" && (
      <>
      {/* Stat strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 stagger">
        <div className="rounded-xl border border-border bg-card p-3 lift">
          <div className="text-[10px] font-bold text-muted-foreground uppercase">Taranan</div>
          <div className="text-lg font-black text-foreground">{signals.length || "-"}</div>
        </div>
        <div className="rounded-xl border border-bull/20 bg-bull/5 p-3">
          <div className="text-[10px] font-bold text-bull/80 uppercase">LONG Sinyal</div>
          <div className="text-lg font-black text-bull">{signals.filter(s => s.direction === "LONG").length}</div>
        </div>
        <div className="rounded-xl border border-bear/20 bg-bear/5 p-3">
          <div className="text-[10px] font-bold text-bear/80 uppercase">SHORT Sinyal</div>
          <div className="text-lg font-black text-bear">{signals.filter(s => s.direction === "SHORT").length}</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-3">
          <div className="text-[10px] font-bold text-muted-foreground uppercase">Aktif Sinyal Oranı</div>
          <div className="text-lg font-black text-foreground">{signals.length ? Math.round((activeCount / signals.length) * 100) : 0}%</div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Sembol veya şirket ara..."
            className="w-full h-9 pl-9 pr-3 rounded-lg bg-secondary/40 border border-border text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/40"
          />
        </div>
        <div className="flex items-center bg-secondary/40 border border-border rounded-lg p-0.5 text-[11px] font-bold">
          {(["ALL", "LONG", "SHORT"] as DirectionFilter[]).map(d => (
            <button
              key={d}
              onClick={() => setDirectionFilter(d)}
              className={`px-3 h-8 rounded-md transition-colors cursor-pointer ${directionFilter === d ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              {d === "ALL" ? "Tümü" : d}
            </button>
          ))}
        </div>
        <select
          value={sortKey}
          onChange={e => setSortKey(e.target.value as SortKey)}
          className="h-9 px-3 rounded-lg bg-secondary/40 border border-border text-xs text-foreground focus:outline-none focus:border-primary/40 cursor-pointer"
        >
          <option value="score">Sırala: Skor</option>
          <option value="ticker">Sırala: Sembol</option>
          <option value="change_percent">Sırala: Değişim %</option>
          <option value="risk_reward">Sırala: Risk/Ödül</option>
          <option value="captured_pnl_pct">Sırala: Yakalanan K/Z</option>
        </select>
      </div>

      {/* Scanner table */}
      <div className="border border-border rounded-xl overflow-hidden bg-card">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 text-primary animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-muted-foreground">
            <Info className="h-5 w-5" />
            <span className="text-xs font-bold">Sonuç bulunamadı</span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="text-muted-foreground font-bold border-b border-border h-10 bg-secondary/20">
                  <th className="px-4">Sembol</th>
                  <th className="px-4 text-right">Fiyat</th>
                  <th className="px-4">Yön</th>
                  <th className="px-4 hidden md:table-cell">Sinyal</th>
                  <th className="px-4 hidden sm:table-cell">Güven</th>
                  <th className="px-4 text-right">Giriş</th>
                  <th className="px-4 text-right hidden sm:table-cell">Stop</th>
                  <th className="px-4 text-right hidden sm:table-cell">Hedef</th>
                  <th className="px-4 text-right hidden sm:table-cell">R:R</th>
                  <th
                    className={`px-4 text-right cursor-pointer select-none hover:text-foreground transition-colors ${sortKey === "captured_pnl_pct" ? "text-primary" : ""}`}
                    onClick={() => setSortKey("captured_pnl_pct")}
                    title="Yüksekten düşüğe sırala"
                  >
                    <span className="inline-flex items-center gap-1">
                      Yakalanan K/Z
                      <ArrowUpDown className="h-3 w-3" />
                    </span>
                  </th>
                  <th className="px-4 text-right hidden md:table-cell">Son Güncelleme</th>
                  <th className="px-4"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(s => {
                  const isUp = s.change_percent >= 0
                  const isExpanded = expanded === s.ticker
                  return (
                    <React.Fragment key={s.ticker}>
                      <tr
                        onClick={() => setExpanded(isExpanded ? null : s.ticker)}
                        className={`border-b border-border/60 h-12 cursor-pointer transition-colors ${isExpanded ? "bg-primary/5" : "hover:bg-secondary/30"}`}
                      >
                        <td className="px-4">
                          <div className="flex items-center gap-1.5">
                            <TickerLogo ticker={s.ticker} size={16} />
                            <div className="font-black text-foreground">{s.ticker}</div>
                          </div>
                          <div className="text-[10px] text-muted-foreground truncate max-w-[140px]">{s.name}</div>
                        </td>
                        <td className="px-4 text-right">
                          <div className="font-bold text-foreground">₺{fmt(s.price)}</div>
                          <div className={`text-[10px] font-bold flex items-center justify-end gap-0.5 ${isUp ? "text-bull" : "text-bear"}`}>
                            {isUp ? <TrendingUp className="h-2.5 w-2.5" /> : <TrendingDown className="h-2.5 w-2.5" />}
                            {isUp ? "+" : ""}{fmt(s.change_percent)}%
                          </div>
                        </td>
                        <td className="px-4"><DirectionBadge direction={s.direction} /></td>
                        <td className="px-4 text-[11px] text-muted-foreground max-w-[160px] truncate hidden md:table-cell">{s.structure}</td>
                        <td className="px-4 hidden sm:table-cell"><ConfidenceBar score={s.score} confidence={s.confidence} /></td>
                        <td className="px-4 text-right font-semibold text-foreground">{s.entry ? fmt(s.entry) : "-"}</td>
                        <td className="px-4 text-right font-semibold text-bear hidden sm:table-cell">{s.stop_loss ? fmt(s.stop_loss) : "-"}</td>
                        <td className="px-4 text-right font-semibold text-bull hidden sm:table-cell">{s.take_profit ? fmt(s.take_profit) : "-"}</td>
                        <td className="px-4 text-right font-bold text-foreground hidden sm:table-cell">{s.risk_reward ? `${fmt(s.risk_reward, 1)}R` : "-"}</td>
                        <td className="px-4 text-right">
                          {s.captured_pnl_pct == null ? (
                            <span className="text-muted-foreground">-</span>
                          ) : (
                            <>
                              <div className={`font-bold ${s.captured_pnl_pct >= 0 ? "text-bull" : "text-bear"}`}>
                                {s.captured_pnl_pct >= 0 ? "+" : ""}{fmt(s.captured_pnl_pct)}%
                              </div>
                              <div className="text-[10px] text-muted-foreground">₺{fmt(s.live_price)} anlık</div>
                            </>
                          )}
                        </td>
                        <td className="px-4 text-right text-[10px] text-muted-foreground hidden md:table-cell">
                          {new Date(s.last_update).toLocaleTimeString("tr-TR")}
                        </td>
                        <td className="px-4 text-center">
                          {isExpanded ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-secondary/10 border-b border-border/60">
                          <td colSpan={11} className="px-4 py-4">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                              <div>
                                <div className="text-[10px] font-black text-muted-foreground uppercase mb-1.5">Tetiklenen Koşullar</div>
                                {s.triggered_conditions.length === 0 ? (
                                  <p className="text-[11px] text-muted-foreground">Henüz koşul sağlanmadı.</p>
                                ) : (
                                  <ul className="space-y-1">
                                    {s.triggered_conditions.map((c, i) => (
                                      <li key={i} className="text-[11px] text-foreground flex items-start gap-1.5">
                                        <span className="text-bull mt-0.5">✔</span>{c}
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                              <div>
                                <div className="text-[10px] font-black text-muted-foreground uppercase mb-1.5">Analiz Notları</div>
                                <ul className="space-y-1">
                                  {s.reasons.map((r, i) => (
                                    <li key={i} className="text-[11px] text-muted-foreground flex items-start gap-1.5">
                                      <Info className="h-3 w-3 shrink-0 mt-0.5" />{r}
                                    </li>
                                  ))}
                                </ul>
                                <div className="flex items-center gap-1.5 mt-2">
                                  <ShieldAlert className="h-3 w-3 text-primary" />
                                  <span className="text-[11px] font-bold text-foreground">Risk Seviyesi: {s.risk_level}</span>
                                </div>
                              </div>
                              <div>
                                <div className="text-[10px] font-black text-muted-foreground uppercase mb-1.5">Destek / Direnç Seviyeleri</div>
                                <div className="flex flex-wrap gap-1.5">
                                  {s.resistance_levels.map((lvl, i) => (
                                    <span key={`r${i}`} className="px-2 py-0.5 rounded bg-bear/10 text-bear text-[10px] font-bold border border-bear/20">
                                      D: {fmt(lvl)}
                                    </span>
                                  ))}
                                  {s.support_levels.map((lvl, i) => (
                                    <span key={`s${i}`} className="px-2 py-0.5 rounded bg-bull/10 text-bull text-[10px] font-bold border border-bull/20">
                                      S: {fmt(lvl)}
                                    </span>
                                  ))}
                                  {s.resistance_levels.length === 0 && s.support_levels.length === 0 && (
                                    <span className="text-[11px] text-muted-foreground">Belirgin seviye bulunamadı.</span>
                                  )}
                                </div>
                              </div>
                            </div>
                            <div className="mt-4 pt-4 border-t border-border/40">
                              <div className="text-[10px] font-black text-muted-foreground uppercase mb-2">Ek Teknik İndikatörler</div>
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div>
                                  <div className="text-[10px] text-muted-foreground font-bold mb-1">Stochastic Osilatör</div>
                                  {s.stochastic_k != null && s.stochastic_d != null ? (
                                    <span className="text-[11px] font-mono text-foreground">
                                      %K: {fmt(s.stochastic_k, 1)} · %D: {fmt(s.stochastic_d, 1)}
                                    </span>
                                  ) : (
                                    <span className="text-[11px] text-muted-foreground">Yetersiz veri</span>
                                  )}
                                </div>
                                <div>
                                  <div className="text-[10px] text-muted-foreground font-bold mb-1">Ichimoku Bulutu</div>
                                  {s.ichimoku_position ? (
                                    <span className={`text-[11px] font-bold ${
                                      s.ichimoku_position === "Bulut Üzerinde" ? "text-bull" :
                                      s.ichimoku_position === "Bulut Altında" ? "text-bear" : "text-muted-foreground"
                                    }`}>
                                      {s.ichimoku_position}
                                    </span>
                                  ) : (
                                    <span className="text-[11px] text-muted-foreground">Yetersiz veri</span>
                                  )}
                                </div>
                                <div>
                                  <div className="text-[10px] text-muted-foreground font-bold mb-1">Fibonacci Düzeltme Seviyeleri</div>
                                  {s.fibonacci_levels.length > 0 ? (
                                    <div className="flex flex-wrap gap-1.5">
                                      {s.fibonacci_levels.map((lvl, i) => (
                                        <span key={i} className="px-1.5 py-0.5 rounded bg-secondary/60 text-[10px] font-mono font-bold text-foreground border border-border/40">
                                          %{(lvl.ratio * 100).toFixed(1)}: {fmt(lvl.price)}
                                        </span>
                                      ))}
                                    </div>
                                  ) : (
                                    <span className="text-[11px] text-muted-foreground">Yetersiz swing verisi</span>
                                  )}
                                </div>
                              </div>
                            </div>
                            <div className="mt-4 pt-4 border-t border-border/40">
                              <div className="text-[10px] font-black text-muted-foreground uppercase mb-2">Pozisyon Boyutu Hesaplayıcı</div>
                              <PositionSizeCalculator entry={s.entry} stopLoss={s.stop_loss} />
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-[10px] text-muted-foreground/70 leading-relaxed">
        Bu sayfadaki sinyaller otomatik teknik analiz sonucudur, yatırım tavsiyesi değildir. Piyasa yapısı (HH/HL/LH/LL), destek/direnç kırılımı + retest,
        mum formasyonu ve TradingView teknik puanlama (RSI/MACD/hareketli ortalamalar) birlikte değerlendirilerek üretilir; risk/ödül oranı yetersiz olan
        adaylar otomatik elenir.
      </p>
      </>
      )}

      {tab === "history" && (
      <>
      <div className="rounded-lg border border-border bg-secondary/10 px-3 py-2 text-[11px] text-muted-foreground flex items-start gap-2">
        <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
        <span>
          Tarayıcının bugün verdiği LONG/SHORT sinyallerinin kronolojik kaydı - bir sembol yeni bir yöne geçtiğinde bir kez eklenir (aynı sinyal aktif
          kaldığı sürece tekrar eklenmez). Gece yarısı sıfırlanır.
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={historyQuery}
            onChange={e => setHistoryQuery(e.target.value)}
            placeholder="Sembol veya şirket ara..."
            className="w-full h-9 pl-9 pr-3 rounded-lg bg-secondary/40 border border-border text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/40"
          />
        </div>
        <div className="flex items-center bg-secondary/40 border border-border rounded-lg p-0.5 text-[11px] font-bold">
          {(["ALL", "LONG", "SHORT"] as DirectionFilter[]).map(d => (
            <button
              key={d}
              onClick={() => setHistoryDirFilter(d)}
              className={`px-3 h-8 rounded-md transition-colors cursor-pointer ${historyDirFilter === d ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              {d === "ALL" ? "Tümü" : d}
            </button>
          ))}
        </div>
        <button
          onClick={fetchHistory}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-border text-xs font-bold text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors cursor-pointer"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Yenile
        </button>
      </div>

      <div className="border border-border rounded-xl overflow-hidden bg-card">
        {historyLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 text-primary animate-spin" />
          </div>
        ) : filteredHistory.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-muted-foreground">
            <Info className="h-5 w-5" />
            <span className="text-xs font-bold">Bugün henüz sinyal kaydı yok</span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="text-muted-foreground font-bold border-b border-border h-10 bg-secondary/20">
                  <th className="px-4 hidden md:table-cell">Saat</th>
                  <th className="px-4">Sembol</th>
                  <th className="px-4">Yön</th>
                  <th className="px-4 hidden sm:table-cell">Güven</th>
                  <th className="px-4 text-right hidden sm:table-cell">Fiyat</th>
                  <th className="px-4 text-right">Giriş</th>
                  <th className="px-4 text-right hidden sm:table-cell">Stop</th>
                  <th className="px-4 text-right hidden sm:table-cell">Hedef</th>
                  <th
                    className={`px-4 text-right cursor-pointer select-none hover:text-foreground transition-colors ${historySortKey === "captured_pnl_pct" ? "text-primary" : ""}`}
                    onClick={() => setHistorySortKey(prev => prev === "captured_pnl_pct" ? "timestamp" : "captured_pnl_pct")}
                    title="Yüksekten düşüğe sırala (tekrar tıkla: saate göre)"
                  >
                    <span className="inline-flex items-center gap-1">
                      Kâr/Zarar
                      <ArrowUpDown className="h-3 w-3" />
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredHistory.map((h, i) => (
                  <tr key={`${h.ticker}-${h.timestamp}-${i}`} className="border-b border-border/60 h-12 hover:bg-secondary/20 transition-colors">
                    <td className="px-4 text-muted-foreground font-mono hidden md:table-cell">{new Date(h.timestamp).toLocaleTimeString("tr-TR")}</td>
                    <td className="px-4">
                      <div className="flex items-center gap-1.5">
                        <TickerLogo ticker={h.ticker} size={16} />
                        <div className="font-black text-foreground">{h.ticker}</div>
                      </div>
                      <div className="text-[10px] text-muted-foreground truncate max-w-[140px]">{h.name}</div>
                    </td>
                    <td className="px-4"><DirectionBadge direction={h.direction} /></td>
                    <td className="px-4 hidden sm:table-cell"><ConfidenceBar score={h.score} confidence={h.confidence} /></td>
                    <td className="px-4 text-right font-bold text-foreground hidden sm:table-cell">₺{fmt(h.price)}</td>
                    <td className="px-4 text-right font-semibold text-foreground">{h.entry ? fmt(h.entry) : "-"}</td>
                    <td className="px-4 text-right font-semibold text-bear hidden sm:table-cell">{h.stop_loss ? fmt(h.stop_loss) : "-"}</td>
                    <td className="px-4 text-right font-semibold text-bull hidden sm:table-cell">{h.take_profit ? fmt(h.take_profit) : "-"}</td>
                    <td className="px-4 text-right">
                      {h.captured_pnl_pct == null ? (
                        <span className="text-muted-foreground">-</span>
                      ) : (
                        <>
                          <div className={`font-bold ${h.captured_pnl_pct >= 0 ? "text-bull" : "text-bear"}`}>
                            {h.captured_pnl_pct >= 0 ? "+" : ""}{fmt(h.captured_pnl_pct)}%
                          </div>
                          <div className="text-[10px] text-muted-foreground">₺{fmt(h.live_price)} anlık</div>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      </>
      )}

      {tab === "backtest" && (
      <>
      <div className="rounded-lg border border-warn/20 bg-warn/5 px-3 py-2 text-[11px] val-warn flex items-start gap-2">
        <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
        <span>
          Son ~2 yıllık günlük mumlar üzerinde, canlı tarayıcıyla aynı piyasa yapısı/kırılım/retest/mum mantığı geriye dönük (bar bar, yalnızca o ana kadarki
          veriyle) simüle edilir. Tek fark: TradingView'in canlı teknik puanı geçmiş bir tarih için alınamadığından, momentum teyidi burada yerel olarak
          hesaplanan RSI(14) ile yapılır. Sonuçlar geçmiş performanstır, gelecekteki getiriyi garanti etmez.
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={backtestQuery}
            onChange={e => setBacktestQuery(e.target.value)}
            placeholder="Sembol veya şirket ara..."
            className="w-full h-9 pl-9 pr-3 rounded-lg bg-secondary/40 border border-border text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/40"
          />
        </div>
        <select
          value={backtestSort}
          onChange={e => setBacktestSort(e.target.value as BacktestSortKey)}
          className="h-9 px-3 rounded-lg bg-secondary/40 border border-border text-xs text-foreground focus:outline-none focus:border-primary/40 cursor-pointer"
        >
          <option value="excess_return_pct">Sırala: XU100 Farkı</option>
          <option value="total_return_pct">Sırala: Net Getiri</option>
          <option value="win_rate">Sırala: Başarı Oranı</option>
          <option value="ticker">Sırala: Sembol</option>
        </select>
        <button
          onClick={fetchBacktest}
          disabled={backtestLoading}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-border text-xs font-bold text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors cursor-pointer disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${backtestLoading ? "animate-spin" : ""}`} />
          Yenile
        </button>
        {backtestLastUpdate && (
          <span className="text-[10px] text-muted-foreground">
            Son çalıştırma: {new Date(backtestLastUpdate).toLocaleString("tr-TR")}
          </span>
        )}
      </div>

      <div className="border border-border rounded-xl overflow-hidden bg-card">
        {(backtestLoading && !backtestLoaded) || backtestComputing ? (
          <div className="flex flex-col items-center justify-center gap-2 py-20 text-center px-6">
            <Loader2 className="h-6 w-6 text-primary animate-spin" />
            <span className="text-[11px] text-muted-foreground">
              30 sembol için ~2 yıllık geriye dönük simülasyon sunucuda çalışıyor - birkaç dakika sürebilir, sonuçlar hazır olunca otomatik görünecek...
            </span>
          </div>
        ) : filteredBacktest.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-muted-foreground">
            <Info className="h-5 w-5" />
            <span className="text-xs font-bold">Sonuç bulunamadı</span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="text-muted-foreground font-bold border-b border-border h-10 bg-secondary/20">
                  <th className="px-4">Sembol</th>
                  <th className="px-4 text-right">İşlem</th>
                  <th className="px-4 text-right">Başarı Oranı</th>
                  <th className="px-4 text-right" title="Bileşik, komisyon ve kayma düşülmüş">Net Getiri</th>
                  <th className="px-4 text-right" title="Net getiri eksi aynı dönemde XU100'ü alıp tutmak">XU100 Farkı</th>
                  <th className="px-4 text-right" title="Sermaye eğrisinin tepeden en derin düşüşü">Maks. Düşüş</th>
                  <th className="px-4 text-right" title="Brüt kâr / brüt zarar. 1'in altı: kayıplar kazançlardan büyük">PF</th>
                  <th className="px-4"></th>
                </tr>
              </thead>
              <tbody>
                {filteredBacktest.map(r => {
                  const isExpanded = expandedBt === r.ticker
                  return (
                    <React.Fragment key={r.ticker}>
                      <tr
                        onClick={() => setExpandedBt(isExpanded ? null : r.ticker)}
                        className={`border-b border-border/60 h-12 cursor-pointer transition-colors ${isExpanded ? "bg-primary/5" : "hover:bg-secondary/30"}`}
                      >
                        <td className="px-4">
                          <div className="flex items-center gap-1.5">
                            <TickerLogo ticker={r.ticker} size={16} />
                            <div className="font-black text-foreground">{r.ticker}</div>
                          </div>
                          <div className="text-[10px] text-muted-foreground truncate max-w-[140px]">{r.name}</div>
                        </td>
                        <td className="px-4 text-right font-semibold text-foreground">{r.total_trades}</td>
                        <td className="px-4 text-right font-semibold text-foreground">{r.win_rate != null ? `%${r.win_rate}` : "-"}</td>
                        <td className={`px-4 text-right font-bold ${(r.total_return_pct ?? 0) >= 0 ? "text-bull" : "text-bear"}`}>
                          {r.total_return_pct != null ? `${r.total_return_pct >= 0 ? "+" : ""}${r.total_return_pct}%` : "-"}
                        </td>
                        {/* Asıl karar veren sütun: stratejinin getirisi, aynı
                            dönemde hiçbir şey yapmamaya (XU100 al-tut) göre
                            nerede duruyor. Tek başına pozitif bir getiri,
                            yükselen bir piyasada bir üstünlük anlamına
                            gelmiyor. */}
                        <td className={`px-4 text-right font-bold ${(r.excess_return_pct ?? 0) >= 0 ? "text-bull" : "text-bear"}`}>
                          {r.excess_return_pct != null ? `${r.excess_return_pct >= 0 ? "+" : ""}${r.excess_return_pct} p` : "-"}
                        </td>
                        <td className="px-4 text-right font-semibold text-bear">
                          {r.max_drawdown_pct != null ? `−%${r.max_drawdown_pct}` : "-"}
                        </td>
                        <td className={`px-4 text-right font-semibold ${(r.profit_factor ?? 0) >= 1 ? "text-bull" : "text-bear"}`}>
                          {r.profit_factor != null ? r.profit_factor.toFixed(2) : "-"}
                        </td>
                        <td className="px-4 text-center">
                          {isExpanded ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-secondary/10 border-b border-border/60">
                          <td colSpan={8} className="px-4 py-4">
                            {r.error ? (
                              <p className="text-[11px] text-muted-foreground">{r.error}</p>
                            ) : r.recent_trades.length === 0 ? (
                              <p className="text-[11px] text-muted-foreground">Bu dönemde sinyal koşulları hiç sağlanmadı.</p>
                            ) : (
                              <div className="space-y-4">
                                {/* Özet satırında yer olmayan ama sonucu
                                    yorumlamak için gereken üç şey: maliyetin
                                    ne kadarını götürdüğü, sermayenin ne kadar
                                    süre riskte olduğu ve aynı kuralların hiç
                                    görülmemiş veride ne yaptığı. */}
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                  <div className="rounded-lg border border-border/40 bg-secondary/20 px-3 py-2">
                                    <div className="text-[10px] font-bold uppercase text-muted-foreground">Maliyet Öncesi</div>
                                    <div className="font-mono font-bold text-foreground">
                                      {r.gross_return_pct != null ? `${r.gross_return_pct >= 0 ? "+" : ""}${r.gross_return_pct}%` : "-"}
                                    </div>
                                    <div className="text-[10px] text-bear font-semibold">
                                      {r.cost_drag_pct != null ? `komisyon/kayma: −${r.cost_drag_pct} p` : ""}
                                    </div>
                                  </div>
                                  <div className="rounded-lg border border-border/40 bg-secondary/20 px-3 py-2">
                                    <div className="text-[10px] font-bold uppercase text-muted-foreground">XU100 Al-Tut</div>
                                    <div className="font-mono font-bold text-foreground">
                                      {r.benchmark_return_pct != null ? `${r.benchmark_return_pct >= 0 ? "+" : ""}${r.benchmark_return_pct}%` : "-"}
                                    </div>
                                    <div className="text-[10px] text-muted-foreground">aynı dönem</div>
                                  </div>
                                  <div className="rounded-lg border border-border/40 bg-secondary/20 px-3 py-2">
                                    <div className="text-[10px] font-bold uppercase text-muted-foreground">Pozisyonda</div>
                                    <div className="font-mono font-bold text-foreground">
                                      {r.exposure_pct != null ? `%${r.exposure_pct}` : "-"}
                                    </div>
                                    <div className="text-[10px] text-muted-foreground">geçen zaman</div>
                                  </div>
                                  <div className="rounded-lg border border-border/40 bg-secondary/20 px-3 py-2">
                                    <div className="text-[10px] font-bold uppercase text-muted-foreground">Görülmemiş Veri</div>
                                    <div className={`font-mono font-bold ${(r.oos_return_pct ?? 0) >= 0 ? "text-bull" : "text-bear"}`}>
                                      {r.oos_return_pct != null ? `${r.oos_return_pct >= 0 ? "+" : ""}${r.oos_return_pct}%` : "-"}
                                    </div>
                                    <div className="text-[10px] text-muted-foreground">
                                      {r.oos_trades != null ? `son %30, ${r.oos_trades} işlem` : ""}
                                    </div>
                                  </div>
                                </div>

                              <div className="overflow-x-auto">
                                <table className="w-full text-[11px] text-left">
                                  <thead>
                                    <tr className="text-muted-foreground font-bold h-8">
                                      <th className="px-2">Yön</th>
                                      <th className="px-2">Giriş</th>
                                      <th className="px-2">Çıkış</th>
                                      <th className="px-2 text-right">Giriş Fiyatı</th>
                                      <th className="px-2 text-right">Çıkış Fiyatı</th>
                                      <th className="px-2">Sonuç</th>
                                      <th className="px-2 text-right">Getiri</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {r.recent_trades.map((t, i) => (
                                      <tr key={i} className="border-t border-border/30 h-8">
                                        <td className="px-2"><DirectionBadge direction={t.direction} /></td>
                                        <td className="px-2 text-muted-foreground">{t.entry_date}</td>
                                        <td className="px-2 text-muted-foreground">{t.exit_date}</td>
                                        <td className="px-2 text-right font-mono">{fmt(t.entry_price)}</td>
                                        <td className="px-2 text-right font-mono">{fmt(t.exit_price)}</td>
                                        <td className="px-2 text-muted-foreground">{t.exit_reason}</td>
                                        <td className={`px-2 text-right font-bold ${t.return_pct >= 0 ? "text-bull" : "text-bear"}`}>
                                          {t.return_pct >= 0 ? "+" : ""}{t.return_pct}%
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      </>
      )}
    </div>
  )
}
