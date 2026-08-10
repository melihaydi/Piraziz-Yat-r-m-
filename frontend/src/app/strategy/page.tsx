"use client"

import React, { useEffect, useMemo, useState, useCallback } from "react"
import {
  Bot, Loader2, Search, RefreshCw, ChevronDown, ChevronUp, TrendingUp, TrendingDown,
  ArrowUpCircle, ArrowDownCircle, Info, ShieldAlert, ArrowUpDown
} from "lucide-react"
import { authFetch } from "@/lib/auth"
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
type BacktestSortKey = "total_return_pct" | "win_rate" | "ticker"
type HistorySortKey = "timestamp" | "captured_pnl_pct"

const fmt = (n: number | null, digits = 2) => (n === null || n === undefined ? "-" : n.toLocaleString("tr-TR", { minimumFractionDigits: digits, maximumFractionDigits: digits }))

function DirectionBadge({ direction }: { direction: Direction }) {
  if (direction === "LONG") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
        <ArrowUpCircle className="h-3 w-3" /> LONG
      </span>
    )
  }
  if (direction === "SHORT") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-rose-500/15 text-rose-400 border border-rose-500/30">
        <ArrowDownCircle className="h-3 w-3" /> SHORT
      </span>
    )
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-zinc-800/60 text-muted-foreground border border-border/50">
      YOK
    </span>
  )
}

function ConfidenceBar({ score, confidence }: { score: number; confidence: string }) {
  const color = confidence === "Yüksek" ? "bg-emerald-500" : confidence === "Orta" ? "bg-amber-500" : "bg-zinc-600"
  return (
    <div className="flex items-center gap-2 min-w-[90px]">
      <div className="flex-1 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
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

  const acc = parseFloat(accountSize) || 0
  const risk = parseFloat(riskPct) || 0
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
            type="number"
            value={accountSize}
            onChange={e => setAccountSize(e.target.value)}
            className="w-28 h-7 px-2 rounded bg-secondary/40 border border-border text-[11px] text-foreground focus:outline-none focus:border-amber-500/40"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-muted-foreground">Risk %</span>
          <input
            type="number"
            step="0.1"
            value={riskPct}
            onChange={e => setRiskPct(e.target.value)}
            className="w-16 h-7 px-2 rounded bg-secondary/40 border border-border text-[11px] text-foreground focus:outline-none focus:border-amber-500/40"
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
  const [backtestSort, setBacktestSort] = useState<BacktestSortKey>("total_return_pct")
  const [expandedBt, setExpandedBt] = useState<string | null>(null)

  const fetchScan = useCallback(async (isManual = false) => {
    if (isManual) setRefreshing(true)
    try {
      const res = await authFetch("/strategy/scan")
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
    // computation itself.
    const interval = setInterval(() => fetchScan(), 30000)
    return () => clearInterval(interval)
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
    const interval = setInterval(fetchHistory, 30000)
    return () => clearInterval(interval)
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
    const interval = setInterval(fetchBacktest, 5000)
    return () => clearInterval(interval)
  }, [backtestComputing, fetchBacktest])

  const filteredBacktest = useMemo(() => {
    const q = backtestQuery.trim().toUpperCase()
    const list = backtestResults.filter(r => !q || r.ticker.includes(q) || r.name.toUpperCase().includes(q))
    return [...list].sort((a, b) => {
      switch (backtestSort) {
        case "ticker": return a.ticker.localeCompare(b.ticker)
        case "win_rate": return (b.win_rate ?? -1) - (a.win_rate ?? -1)
        default: return (b.total_return_pct ?? -999) - (a.total_return_pct ?? -999)
      }
    })
  }, [backtestResults, backtestQuery, backtestSort])

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-xl bg-amber-500/10 border border-amber-500/25 flex items-center justify-center shrink-0">
            <Bot className="h-5 w-5 text-amber-400" />
          </div>
          <div>
            <h1 className="text-xl font-black tracking-tight text-foreground">Frantic Algoritmik Strateji</h1>
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
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border text-xs font-bold text-muted-foreground hover:text-foreground hover:border-amber-500/40 transition-colors cursor-pointer disabled:opacity-50"
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
          className={`px-4 h-8 rounded-md transition-colors cursor-pointer ${tab === "live" ? "bg-amber-500 text-zinc-950" : "text-muted-foreground hover:text-foreground"}`}
        >
          Canlı Tarama
        </button>
        <button
          onClick={() => setTab("history")}
          className={`px-4 h-8 rounded-md transition-colors cursor-pointer ${tab === "history" ? "bg-amber-500 text-zinc-950" : "text-muted-foreground hover:text-foreground"}`}
        >
          Sinyal Geçmişi{history.length > 0 ? ` (${history.length})` : ""}
        </button>
        <button
          onClick={() => setTab("backtest")}
          className={`px-4 h-8 rounded-md transition-colors cursor-pointer ${tab === "backtest" ? "bg-amber-500 text-zinc-950" : "text-muted-foreground hover:text-foreground"}`}
        >
          Backtest
        </button>
      </div>

      {tab === "live" && (
      <>
      {/* Stat strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-xl border border-border bg-card p-3">
          <div className="text-[10px] font-bold text-muted-foreground uppercase">Taranan</div>
          <div className="text-lg font-black text-foreground">{signals.length || "-"}</div>
        </div>
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3">
          <div className="text-[10px] font-bold text-emerald-400/80 uppercase">LONG Sinyal</div>
          <div className="text-lg font-black text-emerald-400">{signals.filter(s => s.direction === "LONG").length}</div>
        </div>
        <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-3">
          <div className="text-[10px] font-bold text-rose-400/80 uppercase">SHORT Sinyal</div>
          <div className="text-lg font-black text-rose-400">{signals.filter(s => s.direction === "SHORT").length}</div>
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
            className="w-full h-9 pl-9 pr-3 rounded-lg bg-secondary/40 border border-border text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-amber-500/40"
          />
        </div>
        <div className="flex items-center bg-secondary/40 border border-border rounded-lg p-0.5 text-[11px] font-bold">
          {(["ALL", "LONG", "SHORT"] as DirectionFilter[]).map(d => (
            <button
              key={d}
              onClick={() => setDirectionFilter(d)}
              className={`px-3 h-8 rounded-md transition-colors cursor-pointer ${directionFilter === d ? "bg-amber-500 text-zinc-950" : "text-muted-foreground hover:text-foreground"}`}
            >
              {d === "ALL" ? "Tümü" : d}
            </button>
          ))}
        </div>
        <select
          value={sortKey}
          onChange={e => setSortKey(e.target.value as SortKey)}
          className="h-9 px-3 rounded-lg bg-secondary/40 border border-border text-xs text-foreground focus:outline-none focus:border-amber-500/40 cursor-pointer"
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
            <Loader2 className="h-6 w-6 text-amber-400 animate-spin" />
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
                  <th className="px-4">Sinyal</th>
                  <th className="px-4">Güven</th>
                  <th className="px-4 text-right">Giriş</th>
                  <th className="px-4 text-right">Stop</th>
                  <th className="px-4 text-right">Hedef</th>
                  <th className="px-4 text-right">R:R</th>
                  <th
                    className={`px-4 text-right cursor-pointer select-none hover:text-foreground transition-colors ${sortKey === "captured_pnl_pct" ? "text-amber-400" : ""}`}
                    onClick={() => setSortKey("captured_pnl_pct")}
                    title="Yüksekten düşüğe sırala"
                  >
                    <span className="inline-flex items-center gap-1">
                      Yakalanan K/Z
                      <ArrowUpDown className="h-3 w-3" />
                    </span>
                  </th>
                  <th className="px-4 text-right">Son Güncelleme</th>
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
                        className={`border-b border-border/60 h-12 cursor-pointer transition-colors ${isExpanded ? "bg-amber-500/5" : "hover:bg-secondary/30"}`}
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
                          <div className={`text-[10px] font-bold flex items-center justify-end gap-0.5 ${isUp ? "text-emerald-400" : "text-rose-500"}`}>
                            {isUp ? <TrendingUp className="h-2.5 w-2.5" /> : <TrendingDown className="h-2.5 w-2.5" />}
                            {isUp ? "+" : ""}{fmt(s.change_percent)}%
                          </div>
                        </td>
                        <td className="px-4"><DirectionBadge direction={s.direction} /></td>
                        <td className="px-4 text-[11px] text-muted-foreground max-w-[160px] truncate">{s.structure}</td>
                        <td className="px-4"><ConfidenceBar score={s.score} confidence={s.confidence} /></td>
                        <td className="px-4 text-right font-semibold text-foreground">{s.entry ? fmt(s.entry) : "-"}</td>
                        <td className="px-4 text-right font-semibold text-rose-400">{s.stop_loss ? fmt(s.stop_loss) : "-"}</td>
                        <td className="px-4 text-right font-semibold text-emerald-400">{s.take_profit ? fmt(s.take_profit) : "-"}</td>
                        <td className="px-4 text-right font-bold text-foreground">{s.risk_reward ? `${fmt(s.risk_reward, 1)}R` : "-"}</td>
                        <td className="px-4 text-right">
                          {s.captured_pnl_pct == null ? (
                            <span className="text-muted-foreground">-</span>
                          ) : (
                            <>
                              <div className={`font-bold ${s.captured_pnl_pct >= 0 ? "text-emerald-400" : "text-rose-500"}`}>
                                {s.captured_pnl_pct >= 0 ? "+" : ""}{fmt(s.captured_pnl_pct)}%
                              </div>
                              <div className="text-[10px] text-muted-foreground">₺{fmt(s.live_price)} anlık</div>
                            </>
                          )}
                        </td>
                        <td className="px-4 text-right text-[10px] text-muted-foreground">
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
                                        <span className="text-emerald-400 mt-0.5">✔</span>{c}
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
                                  <ShieldAlert className="h-3 w-3 text-amber-400" />
                                  <span className="text-[11px] font-bold text-foreground">Risk Seviyesi: {s.risk_level}</span>
                                </div>
                              </div>
                              <div>
                                <div className="text-[10px] font-black text-muted-foreground uppercase mb-1.5">Destek / Direnç Seviyeleri</div>
                                <div className="flex flex-wrap gap-1.5">
                                  {s.resistance_levels.map((lvl, i) => (
                                    <span key={`r${i}`} className="px-2 py-0.5 rounded bg-rose-500/10 text-rose-400 text-[10px] font-bold border border-rose-500/20">
                                      D: {fmt(lvl)}
                                    </span>
                                  ))}
                                  {s.support_levels.map((lvl, i) => (
                                    <span key={`s${i}`} className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 text-[10px] font-bold border border-emerald-500/20">
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
                                      s.ichimoku_position === "Bulut Üzerinde" ? "text-emerald-400" :
                                      s.ichimoku_position === "Bulut Altında" ? "text-rose-500" : "text-muted-foreground"
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
            className="w-full h-9 pl-9 pr-3 rounded-lg bg-secondary/40 border border-border text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-amber-500/40"
          />
        </div>
        <div className="flex items-center bg-secondary/40 border border-border rounded-lg p-0.5 text-[11px] font-bold">
          {(["ALL", "LONG", "SHORT"] as DirectionFilter[]).map(d => (
            <button
              key={d}
              onClick={() => setHistoryDirFilter(d)}
              className={`px-3 h-8 rounded-md transition-colors cursor-pointer ${historyDirFilter === d ? "bg-amber-500 text-zinc-950" : "text-muted-foreground hover:text-foreground"}`}
            >
              {d === "ALL" ? "Tümü" : d}
            </button>
          ))}
        </div>
        <button
          onClick={fetchHistory}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-border text-xs font-bold text-muted-foreground hover:text-foreground hover:border-amber-500/40 transition-colors cursor-pointer"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Yenile
        </button>
      </div>

      <div className="border border-border rounded-xl overflow-hidden bg-card">
        {historyLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 text-amber-400 animate-spin" />
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
                  <th className="px-4">Saat</th>
                  <th className="px-4">Sembol</th>
                  <th className="px-4">Yön</th>
                  <th className="px-4">Güven</th>
                  <th className="px-4 text-right">Fiyat</th>
                  <th className="px-4 text-right">Giriş</th>
                  <th className="px-4 text-right">Stop</th>
                  <th className="px-4 text-right">Hedef</th>
                  <th
                    className={`px-4 text-right cursor-pointer select-none hover:text-foreground transition-colors ${historySortKey === "captured_pnl_pct" ? "text-amber-400" : ""}`}
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
                    <td className="px-4 text-muted-foreground font-mono">{new Date(h.timestamp).toLocaleTimeString("tr-TR")}</td>
                    <td className="px-4">
                      <div className="flex items-center gap-1.5">
                        <TickerLogo ticker={h.ticker} size={16} />
                        <div className="font-black text-foreground">{h.ticker}</div>
                      </div>
                      <div className="text-[10px] text-muted-foreground truncate max-w-[140px]">{h.name}</div>
                    </td>
                    <td className="px-4"><DirectionBadge direction={h.direction} /></td>
                    <td className="px-4"><ConfidenceBar score={h.score} confidence={h.confidence} /></td>
                    <td className="px-4 text-right font-bold text-foreground">₺{fmt(h.price)}</td>
                    <td className="px-4 text-right font-semibold text-foreground">{h.entry ? fmt(h.entry) : "-"}</td>
                    <td className="px-4 text-right font-semibold text-rose-400">{h.stop_loss ? fmt(h.stop_loss) : "-"}</td>
                    <td className="px-4 text-right font-semibold text-emerald-400">{h.take_profit ? fmt(h.take_profit) : "-"}</td>
                    <td className="px-4 text-right">
                      {h.captured_pnl_pct == null ? (
                        <span className="text-muted-foreground">-</span>
                      ) : (
                        <>
                          <div className={`font-bold ${h.captured_pnl_pct >= 0 ? "text-emerald-400" : "text-rose-500"}`}>
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
      <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-300/90 flex items-start gap-2">
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
            className="w-full h-9 pl-9 pr-3 rounded-lg bg-secondary/40 border border-border text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-amber-500/40"
          />
        </div>
        <select
          value={backtestSort}
          onChange={e => setBacktestSort(e.target.value as BacktestSortKey)}
          className="h-9 px-3 rounded-lg bg-secondary/40 border border-border text-xs text-foreground focus:outline-none focus:border-amber-500/40 cursor-pointer"
        >
          <option value="total_return_pct">Sırala: Toplam Getiri</option>
          <option value="win_rate">Sırala: Başarı Oranı</option>
          <option value="ticker">Sırala: Sembol</option>
        </select>
        <button
          onClick={fetchBacktest}
          disabled={backtestLoading}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-border text-xs font-bold text-muted-foreground hover:text-foreground hover:border-amber-500/40 transition-colors cursor-pointer disabled:opacity-50"
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
            <Loader2 className="h-6 w-6 text-amber-400 animate-spin" />
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
                  <th className="px-4 text-right">İşlem Sayısı</th>
                  <th className="px-4 text-right">Başarı Oranı</th>
                  <th className="px-4 text-right">Toplam Getiri</th>
                  <th className="px-4 text-right">Ort. Getiri</th>
                  <th className="px-4 text-right">En İyi</th>
                  <th className="px-4 text-right">En Kötü</th>
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
                        className={`border-b border-border/60 h-12 cursor-pointer transition-colors ${isExpanded ? "bg-amber-500/5" : "hover:bg-secondary/30"}`}
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
                        <td className={`px-4 text-right font-bold ${(r.total_return_pct ?? 0) >= 0 ? "text-emerald-400" : "text-rose-500"}`}>
                          {r.total_return_pct != null ? `${r.total_return_pct >= 0 ? "+" : ""}${r.total_return_pct}%` : "-"}
                        </td>
                        <td className={`px-4 text-right font-semibold ${(r.avg_return_pct ?? 0) >= 0 ? "text-emerald-400" : "text-rose-500"}`}>
                          {r.avg_return_pct != null ? `${r.avg_return_pct >= 0 ? "+" : ""}${r.avg_return_pct}%` : "-"}
                        </td>
                        <td className="px-4 text-right font-semibold text-emerald-400">{r.best_trade_pct != null ? `+${r.best_trade_pct}%` : "-"}</td>
                        <td className="px-4 text-right font-semibold text-rose-500">{r.worst_trade_pct != null ? `${r.worst_trade_pct}%` : "-"}</td>
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
                                        <td className={`px-2 text-right font-bold ${t.return_pct >= 0 ? "text-emerald-400" : "text-rose-500"}`}>
                                          {t.return_pct >= 0 ? "+" : ""}{t.return_pct}%
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
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
