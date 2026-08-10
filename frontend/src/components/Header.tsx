"use client"

import React, { useState, useEffect, useMemo, useRef } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Bell, Menu, Search, TrendingUp, TrendingDown, Sparkles, ShieldCheck, User } from "lucide-react"
import { Input } from "@/components/ui/Input"
import { Button } from "@/components/ui/Button"
import { API_BASE_URL } from "@/lib/config"
import { authFetch } from "@/lib/auth"

// role -> display label/styling. Previously the header just hardcoded
// "Pro Üye" for every single user regardless of their real subscription
// tier - a free-tier user saw the same badge as a paying one.
const ROLE_DISPLAY: Record<string, { label: string; className: string }> = {
  free: { label: "Ücretsiz Üye", className: "text-muted-foreground" },
  starter: { label: "Starter Üye", className: "text-cyan-400" },
  pro: { label: "Pro Üye", className: "text-emerald-400" },
  premium: { label: "Premium Üye", className: "text-amber-400" },
  institutional: { label: "Kurumsal Üye", className: "text-blue-400" },
}

const HEADER_TICKERS_CACHE_KEY = "bip_header_tickers"

const DEFAULT_INDEX_DATA = [
  { name: "XU100", value: "10.240,50", change: "+1.42%", up: true },
  { name: "XU030", value: "11.580,20", change: "+1.68%", up: true },
  { name: "XBANK", value: "14.250,00", change: "+2.15%", up: true },
  { name: "USD/TRY", value: "33,245", change: "-0.08%", up: false },
  { name: "EUR/TRY", value: "36,180", change: "+0.12%", up: true },
  { name: "BTC/USDT", value: "66.250", change: "+1.15%", up: true },
]

// Read the last real ticker values from localStorage synchronously on first
// render, instead of always starting from the hardcoded placeholder array
// above - otherwise every page load flashed those stale numbers for the ~1-2s
// it takes the first /market-summary response to arrive.
function loadCachedIndexData(): any[] {
  if (typeof window === "undefined") return DEFAULT_INDEX_DATA
  try {
    const raw = localStorage.getItem(HEADER_TICKERS_CACHE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed) && parsed.length > 0) return parsed
    }
  } catch (e) {
    // fall through to default
  }
  return DEFAULT_INDEX_DATA
}

interface HeaderProps {
  onMenuClick?: () => void
}

export default function Header({ onMenuClick }: HeaderProps) {
  const router = useRouter()
  const [indexData, setIndexData] = useState<any[]>(loadCachedIndexData)

  const [tickersList, setTickersList] = useState<any[]>([])
  const [fundsList, setFundsList] = useState<any[]>([])
  const [searchQuery, setSearchQuery] = useState("")
  const [showDropdown, setShowDropdown] = useState(false)

  // Profile states
  const [username, setUsername] = useState("Kullanıcı")
  const [profilePic, setProfilePic] = useState("")
  const [role, setRole] = useState("free")

  // Notification states (Request 10!)
  const [showNotifications, setShowNotifications] = useState(false)
  const [activeSignals, setActiveSignals] = useState<any[]>([])
  const [alertsList, setAlertsList] = useState<any[]>([])

  // Play synthesized audio tone
  const playBeep = () => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.3);
    } catch (e) {
      console.warn("Web Audio Play failed", e);
    }
  }

  // Request browser permission for HTML5 notifications
  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window) {
      if (Notification.permission === "default") {
        Notification.requestPermission();
      }
    }
  }, [])

  useEffect(() => {
    const checkSignalsAndAlarms = async () => {
      const token = localStorage.getItem("token")
      const headers: Record<string, string> = token ? { "Authorization": `Bearer ${token}` } : {}
      
      // 1. Fetch Signals
      try {
        const res = await fetch(`${API_BASE_URL}/api/v1/portfolio/signals`, { headers })
        const data = await res.json()
        if (data && Array.isArray(data.signals)) {
          const filtered = data.signals.filter((s: any) => s.signal.includes("AL") || s.signal.includes("SAT"))
          setActiveSignals(filtered)
        } else {
          setActiveSignals([])
        }
      } catch (e) {
        setActiveSignals([])
      }

      // 2. Scan & trigger custom alarms (Request 4!)
      try {
        const res = await fetch(`${API_BASE_URL}/api/v1/alert/check`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...headers
          }
        })
        if (res.ok) {
          const triggered = await res.json()
          if (Array.isArray(triggered) && triggered.length > 0) {
            setAlertsList(prev => [...triggered, ...prev])
            playBeep()
            triggered.forEach(alert => {
              if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
                new Notification(`BİP Alarm: ${alert.ticker}`, {
                  body: alert.trigger_condition.current_val_desc || `${alert.alert_type} koşulu tetiklendi.`,
                  icon: "/favicon.ico"
                })
              }
            })
          }
        }
      } catch (e) {
        console.error("Alert check failed:", e)
      }
    }
    
    checkSignalsAndAlarms()
    // Runs globally on every page for every logged-in user; the backend
    // now caches /portfolio/signals for 2 minutes (see portfolio.py), so
    // polling much faster than that just burns requests without fresher
    // data. 60s still catches new alarm triggers promptly.
    const interval = setInterval(checkSignalsAndAlarms, 60000)
    return () => clearInterval(interval)
  }, [])

  // Frantic Strateji signal history notifications - previously the only
  // way to know a new LONG/SHORT call fired during the day was to have
  // the Strategy page open and manually check the "Sinyal Geçmişi" tab.
  // Runs globally (here in Header, not the Strategy page) so it fires
  // regardless of which page is open. `seenKeysRef` is null until the
  // first poll completes - that first poll only records what's already
  // there without notifying, so opening the app doesn't re-notify for
  // every signal that already fired earlier today.
  const seenSignalHistoryKeysRef = useRef<Set<string> | null>(null)
  useEffect(() => {
    const checkStrategyHistory = async () => {
      const token = localStorage.getItem("token")
      if (!token) return
      try {
        const res = await fetch(`${API_BASE_URL}/api/v1/strategy/history`, {
          headers: { Authorization: `Bearer ${token}` }
        })
        if (!res.ok) return
        const data = await res.json()
        const history: any[] = Array.isArray(data.history) ? data.history : []
        const currentKeys = new Set(history.map(h => `${h.ticker}-${h.timestamp}`))

        if (seenSignalHistoryKeysRef.current === null) {
          seenSignalHistoryKeysRef.current = currentKeys
          return
        }

        const seen = seenSignalHistoryKeysRef.current
        const newEntries = history.filter(h => !seen.has(`${h.ticker}-${h.timestamp}`))
        if (newEntries.length > 0) {
          playBeep()
          newEntries.forEach(h => {
            if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
              new Notification(`Frantic Strateji: ${h.ticker} ${h.direction === "LONG" ? "AL" : "SAT"}`, {
                body: `${h.name} - Güven: ${h.confidence}, Fiyat: ₺${h.price}`,
                icon: "/favicon.ico"
              })
            }
          })
        }
        seenSignalHistoryKeysRef.current = currentKeys
      } catch (e) {
        console.error("Strategy history check failed:", e)
      }
    }

    checkStrategyHistory()
    // Matches StrategyEngine's own 180s scan cycle closely enough (60s)
    // that a new signal is announced within a minute of firing, without
    // polling meaningfully faster than the data actually changes.
    const strategyInterval = setInterval(checkStrategyHistory, 60000)
    return () => clearInterval(strategyInterval)
  }, [])

  // Profile picture is a real per-browser choice (a data URL, never sent to
  // the server), so it stays in localStorage - unlike the display name below.
  useEffect(() => {
    const loadPic = () => {
      const savedPic = localStorage.getItem("bip_profile_pic")
      if (savedPic) setProfilePic(savedPic)
    }
    loadPic()
    window.addEventListener("profile-updated", loadPic)
    return () => window.removeEventListener("profile-updated", loadPic)
  }, [])

  // Display name + subscription tier: both real server truth from /auth/me,
  // never localStorage - a name typed in Settings on one device previously
  // only ever got written to THAT browser's localStorage, so a fresh device/
  // browser always showed the generic "Kullanıcı" fallback even though the
  // backend had the real full_name all along. Re-fetched whenever a profile
  // change might have happened (profile-updated is dispatched by Settings
  // after any /auth/me PUT).
  useEffect(() => {
    const loadProfile = () => {
      authFetch("/auth/me")
        .then(res => (res.ok ? res.json() : null))
        .then(data => {
          if (!data) return
          if (data.role) setRole(data.role)
          const displayName = data.full_name?.trim() || data.email?.split("@")[0]
          if (displayName) setUsername(displayName)
        })
        .catch(() => {})
    }
    loadProfile()
    window.addEventListener("profile-updated", loadProfile)
    return () => window.removeEventListener("profile-updated", loadProfile)
  }, [])

  // 1. Fetch live market indexes
  useEffect(() => {
    const fetchIndexes = () => {
      authFetch(`/screener/market-summary`)
        .then(res => res.json())
        .then(data => {
          if (data) {
            const items = []
            if (data.index) {
              items.push({
                name: "XU100",
                value: Number(data.index.price).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
                change: (data.index.change_percent >= 0 ? "+" : "") + Number(data.index.change_percent).toFixed(2) + "%",
                up: data.index.change_percent >= 0
              })
            }
            if (data.xu030) {
              items.push({
                name: "XU030",
                value: Number(data.xu030.price).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
                change: (data.xu030.change_percent >= 0 ? "+" : "") + Number(data.xu030.change_percent).toFixed(2) + "%",
                up: data.xu030.change_percent >= 0
              })
            }
            if (data.xbank) {
              items.push({
                name: "XBANK",
                value: Number(data.xbank.price).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
                change: (data.xbank.change_percent >= 0 ? "+" : "") + Number(data.xbank.change_percent).toFixed(2) + "%",
                up: data.xbank.change_percent >= 0
              })
            }

            if (data.btcusdt) {
              items.push({
                name: "BTC/USDT",
                value: Number(data.btcusdt.price).toLocaleString("tr-TR", { minimumFractionDigits: 0, maximumFractionDigits: 0 }),
                change: (data.btcusdt.change_percent >= 0 ? "+" : "") + Number(data.btcusdt.change_percent).toFixed(2) + "%",
                up: data.btcusdt.change_percent >= 0
              })
            }
            // Gram Altın / Ons Altın / US100 removed from the ticker - these symbols
            // kept showing stale data regardless of source fixes, so per request they're
            // dropped from the header rather than shown wrong.
            if (items.length > 0) {
              setIndexData(items)
              try {
                localStorage.setItem(HEADER_TICKERS_CACHE_KEY, JSON.stringify(items))
              } catch (e) {
                // Storage full/unavailable - not critical, just skip persisting.
              }
            }
          }
        })
        .catch(err => console.error("Failed to load header ticker feed:", err))
    }

    fetchIndexes()
    // This is a persistent component (mounted for the whole app, not per
    // page), so its poll interval runs continuously everywhere, stacked on
    // top of whatever the current page itself is polling. 2s was excessive
    // for a ticker banner - re-rendering the header 30x/minute added
    // constant background CPU/network pressure that made route transitions
    // feel janky even though nothing was actually reloading. 5s still reads
    // as live for an index ticker.
    const interval = setInterval(fetchIndexes, 5000)
    return () => clearInterval(interval)
  }, [])

  // 2. Fetch all tickers (stocks) for search autocomplete
  useEffect(() => {
    authFetch(`/screener/`)
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          setTickersList(data)
        }
      })
      .catch(err => console.error("Failed to fetch tickers for search:", err))
  }, [])

  // 3. Fetch all TEFAS mutual funds for search autocomplete
  useEffect(() => {
    fetch(`${API_BASE_URL}/api/v1/funds/`)
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          setFundsList(data)
        }
      })
      .catch(err => console.error("Failed to fetch TEFAS funds for search:", err))
  }, [])

  // 4. Combine and filter searches
  const filteredResults = useMemo(() => {
    if (!searchQuery.trim()) return []
    const q = searchQuery.toLowerCase()
    
    // Filter stocks
    const matchedStocks = tickersList.filter(t => 
      t.ticker.toLowerCase().includes(q) || 
      (t.name && t.name.toLowerCase().includes(q))
    ).map(t => ({
      code: t.ticker,
      name: t.name,
      price: t.price,
      isFund: false
    }))

    // Filter funds
    const matchedFunds = fundsList.filter(f =>
      f.code.toLowerCase().includes(q) ||
      (f.name && f.name.toLowerCase().includes(q))
    ).map(f => ({
      code: f.code,
      name: f.name,
      price: f.price,
      isFund: true
    }))

    return [...matchedStocks, ...matchedFunds].slice(0, 5)
  }, [searchQuery, tickersList, fundsList])

  return (
    <header className="border-b border-border bg-card/60 backdrop-blur-md sticky top-0 z-20">
    <div className="h-16 flex items-center justify-between px-3 md:px-8 gap-2">
      {/* Mobile/tablet menu toggle - opens the off-canvas Sidebar drawer */}
      <button
        onClick={onMenuClick}
        className="lg:hidden shrink-0 text-muted-foreground hover:text-foreground cursor-pointer p-2 -ml-2"
        aria-label="Menüyü aç"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Ticker Feed Container (Bloomberg Terminal Marquee Style) */}
      <div className="relative flex-1 max-w-[450px] xl:max-w-[650px] overflow-hidden mx-4 hidden md:block bg-zinc-950/40 border border-border/30 rounded-lg py-1.5 px-3">
        {/* Fade masks */}
        <div className="absolute left-0 top-0 bottom-0 w-6 bg-gradient-to-r from-zinc-950/60 to-transparent z-10 pointer-events-none" />
        <div className="absolute right-0 top-0 bottom-0 w-6 bg-gradient-to-l from-zinc-950/60 to-transparent z-10 pointer-events-none" />

        <div className="ticker-wrap flex overflow-hidden whitespace-nowrap">
          <div className="animate-ticker flex space-x-8 items-center pr-8">
            {[...indexData, ...indexData].map((idx, i) => (
              <div key={`${idx.name}-${i}`} className="flex items-center space-x-2 text-[10px] font-bold">
                <span className="text-muted-foreground/95">{idx.name}</span>
                <span className="text-foreground font-mono font-medium">{idx.value}</span>
                <span className={idx.up ? "text-emerald-500 flex items-center" : "text-rose-500 flex items-center"}>
                  {idx.up ? <TrendingUp className="h-3 w-3 mr-0.5" /> : <TrendingDown className="h-3 w-3 mr-0.5" />}
                  {idx.change}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Action Area */}
      <div className="flex items-center space-x-2 md:space-x-4 min-w-0">
        {/* Search Autocomplete */}
        <div className="relative w-28 sm:w-44 md:w-64">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Ara..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value)
              setShowDropdown(true)
            }}
            onFocus={() => setShowDropdown(true)}
            onBlur={() => setTimeout(() => setShowDropdown(false), 250)}
            className="pl-9 bg-secondary/50 border-border/60 hover:bg-secondary/80 focus-visible:ring-primary focus-visible:ring-1 w-full"
          />
          
          {showDropdown && filteredResults.length > 0 && (
            <div className="absolute top-11 left-0 right-0 bg-zinc-900/95 backdrop-blur-md border border-border/80 rounded-lg shadow-xl overflow-hidden z-50 text-xs">
              {filteredResults.map((t) => (
                <button
                  key={t.code}
                  onClick={() => {
                    // Straight to the real detail page (/stock/[ticker] or
                    // /funds/[code]) either way - both routes exist and this
                    // is what "search for a stock/fund" should open, rather
                    // than the list/split-view pages with a query param.
                    router.push(t.isFund ? `/funds/${t.code}` : `/stock/${t.code}`)
                    setShowDropdown(false)
                    setSearchQuery("")
                  }}
                  className="w-full text-left px-4 py-2.5 hover:bg-secondary/60 flex items-center justify-between cursor-pointer border-b border-border/30 last:border-b-0 transition-colors"
                >
                  <div className="flex flex-col">
                    <span className="font-bold text-foreground flex items-center">
                      {t.code}
                      {t.isFund && (
                        <span className="ml-1 text-[8px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-1 rounded">
                          FON
                        </span>
                      )}
                    </span>
                    <span className="text-[10px] text-muted-foreground truncate max-w-[150px]">{t.name}</span>
                  </div>
                  <span className="text-[10px] bg-primary/20 text-primary px-1.5 py-0.5 rounded font-bold">
                    ₺{(t.price ?? 0).toFixed(2)}
                  </span>
                </button>
              ))}
            </div>
          )}

          {showDropdown && searchQuery && filteredResults.length === 0 && (
            <div className="absolute top-11 left-0 right-0 bg-zinc-900/95 backdrop-blur-md border border-border/80 rounded-lg shadow-xl p-3 text-center text-[10px] text-muted-foreground z-50">
              Sonuç bulunamadı.
            </div>
          )}
        </div>

        {/* Notifications (Glow animation from request 10!) */}
        <div className="relative">
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={() => setShowNotifications(!showNotifications)}
            className="relative cursor-pointer group"
          >
            <Bell className={`h-4.5 w-4.5 text-amber-400 group-hover:text-amber-300 ${(activeSignals.length + alertsList.length) > 0 ? "animate-bounce" : ""}`} style={{ animationDuration: '3s' }} />
            {(activeSignals.length + alertsList.length) > 0 && (
              <>
                <span className="absolute top-2.5 right-2.5 h-2 w-2 bg-rose-500 rounded-full ring-2 ring-card animate-ping" />
                <span className="absolute top-2.5 right-2.5 h-2 w-2 bg-rose-500 rounded-full ring-2 ring-card" />
              </>
            )}
          </Button>

          {showNotifications && (
            <div className="absolute right-0 top-12 w-[min(85vw,340px)] bg-zinc-950/95 backdrop-blur-md border border-border/85 rounded-xl shadow-xl overflow-hidden z-50 text-xs p-4 space-y-3">
              <div className="flex items-center justify-between border-b border-border/30 pb-2">
                <span className="font-extrabold text-foreground">Sinyaller & Alarmlar</span>
                <div className="flex items-center gap-2">
                  {(activeSignals.length + alertsList.length) > 0 && (
                    <span className="bg-rose-500/10 text-rose-400 font-mono font-bold px-1.5 py-0.5 rounded text-[10px]">
                      {activeSignals.length + alertsList.length} Aktif
                    </span>
                  )}
                  {alertsList.length > 0 && (
                    <button
                      onClick={() => setAlertsList([])}
                      className="text-[9px] font-bold text-muted-foreground hover:text-foreground cursor-pointer"
                    >
                      Alarmları Temizle
                    </button>
                  )}
                </div>
              </div>

              <div className="max-h-60 overflow-y-auto space-y-2 pr-1">
                {/* 1. Custom Triggered Alerts */}
                {alertsList.map((alert, idx) => (
                  <div
                    key={`alert-${idx}`}
                    className="p-2.5 rounded-lg border border-purple-500/20 bg-purple-950/10 text-left relative group"
                  >
                    <button
                      onClick={() => setAlertsList(prev => prev.filter((_, i) => i !== idx))}
                      className="absolute top-1.5 right-1.5 text-muted-foreground/60 hover:text-foreground cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
                      aria-label="Kapat"
                    >
                      ✕
                    </button>
                    <div className="flex items-center justify-between pr-3">
                      <span className="font-bold text-foreground">{alert.ticker}</span>
                      <span className="px-1.5 py-0.5 rounded text-[8px] font-black border uppercase bg-purple-500/10 text-purple-400 border-purple-500/20">
                        {alert.alert_type}
                      </span>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      {alert.trigger_condition.current_val_desc || "Alarm koşulu gerçekleşti."}
                    </p>
                  </div>
                ))}

                {/* 2. Signals */}
                {activeSignals.map((sig, idx) => (
                  <div 
                    key={`sig-${idx}`}
                    onClick={() => {
                      router.push(`/stock/${sig.ticker}`)
                      setShowNotifications(false)
                    }}
                    className={`p-2.5 rounded-lg border cursor-pointer transition-colors text-left ${
                      sig.signal.includes("AL") 
                        ? "bg-emerald-950/10 border-emerald-500/20 hover:bg-emerald-950/20" 
                        : "bg-rose-950/10 border-rose-500/20 hover:bg-rose-950/20"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-foreground">{sig.ticker}</span>
                      <span className={`px-1.5 py-0.5 rounded text-[8px] font-black border uppercase ${
                        sig.signal.includes("AL") ? "bg-green-500/10 text-green-400 border-green-500/20" : "bg-rose-500/10 text-rose-400 border-rose-500/20"
                      }`}>
                        {sig.signal}
                      </span>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1 truncate">{sig.description}</p>
                  </div>
                ))}

                {activeSignals.length === 0 && alertsList.length === 0 && (
                  <p className="text-center text-muted-foreground py-4 text-[10px]">Aktif sinyal veya bildirim bulunmuyor.</p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Live vs delayed data indicator - only premium/institutional get
            real-time BIST data everywhere (Tarama, Fonlar, Hisse Detay, Ana
            Sayfa, Trade); every other tier sees a 15-minute-delayed feed
            (see backend deps.get_data_delay_minutes). Shown here so it's
            never ambiguous which one is currently active. */}
        <span
          title={role === "premium" || role === "institutional"
            ? "Anlık, gecikmesiz BIST verisi görüntülüyorsunuz."
            : "Fiyatlar ve grafikler 15 dakika gecikmeli gösteriliyor. Anlık veri için Premium'a yükseltin."}
          className={`hidden md:flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-bold border ${
            role === "premium" || role === "institutional"
              ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/10"
              : "text-amber-400 border-amber-500/30 bg-amber-500/10"
          }`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${role === "premium" || role === "institutional" ? "bg-emerald-400" : "bg-amber-400"}`} />
          {role === "premium" || role === "institutional" ? "Canlı Veri" : "15 Dk Gecikmeli"}
        </span>

        {/* User Badge */}
        <Link
          href="/settings"
          className="flex items-center space-x-3 pl-2 border-l border-border cursor-pointer hover:opacity-85 transition-opacity"
        >
          <div className="flex flex-col text-right hidden sm:flex">
            <span className="text-xs font-bold text-foreground">{username}</span>
            <span className={`text-[10px] font-semibold flex items-center justify-end ${(ROLE_DISPLAY[role] || ROLE_DISPLAY.free).className}`}>
              {role === "free" ? (
                <ShieldCheck className="h-2.5 w-2.5 mr-0.5" />
              ) : (
                <Sparkles className="h-2.5 w-2.5 mr-0.5" />
              )}
              {(ROLE_DISPLAY[role] || ROLE_DISPLAY.free).label}
            </span>
          </div>
          <div className="h-9 w-9 rounded-full bg-secondary/60 border border-border/80 flex items-center justify-center text-lg shadow-md overflow-hidden shrink-0">
            {profilePic ? (
              <img src={profilePic} className="h-full w-full object-cover" alt="Profile" />
            ) : (
              <User className="h-4.5 w-4.5 text-muted-foreground" />
            )}
          </div>
        </Link>
      </div>
    </div>

      {/* Mobile ticker row - the marquee above is `hidden md:block`, so
          phones never saw the live index feed at all otherwise. */}
      <div className="md:hidden relative overflow-hidden border-t border-border/30 bg-zinc-950/40 py-1.5 px-3">
        <div className="absolute left-0 top-0 bottom-0 w-6 bg-gradient-to-r from-zinc-950/60 to-transparent z-10 pointer-events-none" />
        <div className="absolute right-0 top-0 bottom-0 w-6 bg-gradient-to-l from-zinc-950/60 to-transparent z-10 pointer-events-none" />
        <div className="ticker-wrap flex overflow-hidden whitespace-nowrap">
          <div className="animate-ticker flex space-x-6 items-center pr-6">
            {[...indexData, ...indexData].map((idx, i) => (
              <div key={`m-${idx.name}-${i}`} className="flex items-center space-x-1.5 text-[10px] font-bold">
                <span className="text-muted-foreground/95">{idx.name}</span>
                <span className="text-foreground font-mono font-medium">{idx.value}</span>
                <span className={idx.up ? "text-emerald-500 flex items-center" : "text-rose-500 flex items-center"}>
                  {idx.up ? <TrendingUp className="h-3 w-3 mr-0.5" /> : <TrendingDown className="h-3 w-3 mr-0.5" />}
                  {idx.change}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </header>
  )
}
