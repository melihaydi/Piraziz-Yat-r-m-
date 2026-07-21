"use client"

import React, { useState, useEffect, useMemo } from "react"
import { Bell, Search, TrendingUp, TrendingDown, Sparkles } from "lucide-react"
import { Input } from "@/components/ui/Input"
import { Button } from "@/components/ui/Button"

export default function Header() {
  const [indexData, setIndexData] = useState<any[]>([
    { name: "XU100", value: "10.240,50", change: "+1.42%", up: true },
    { name: "XU030", value: "11.580,20", change: "+1.68%", up: true },
    { name: "USD/TRY", value: "33,245", change: "-0.08%", up: false },
  ])

  const [tickersList, setTickersList] = useState<any[]>([])
  const [fundsList, setFundsList] = useState<any[]>([])
  const [searchQuery, setSearchQuery] = useState("")
  const [showDropdown, setShowDropdown] = useState(false)

  // Profile states
  const [username, setUsername] = useState("Ömer Faruk")
  const [avatarEmoji, setAvatarEmoji] = useState("💼")
  const [profilePic, setProfilePic] = useState("")

  // Notification states (Request 10!)
  const [showNotifications, setShowNotifications] = useState(false)
  const [activeSignals, setActiveSignals] = useState<any[]>([])

  useEffect(() => {
    const checkSignals = async () => {
      try {
        const token = localStorage.getItem("token")
        const res = await fetch("http://localhost:8000/api/v1/portfolio/signals", {
          headers: token ? { "Authorization": `Bearer ${token}` } : {}
        })
        const data = await res.json()
        if (data && Array.isArray(data.signals)) {
          const filtered = data.signals.filter((s: any) => s.signal === "AL" || s.signal === "SAT")
          setActiveSignals(filtered)
        } else {
          setActiveSignals([])
        }
      } catch (e) {
        setActiveSignals([])
      }
    }
    checkSignals()
    const interval = setInterval(checkSignals, 20000)
    return () => clearInterval(interval)
  }, [])

  // Load profile from localStorage and handle updates
  useEffect(() => {
    const loadProfile = () => {
      const savedName = localStorage.getItem("bip_username")
      const savedEmoji = localStorage.getItem("bip_avatar_emoji")
      const savedPic = localStorage.getItem("bip_profile_pic")
      if (savedName) setUsername(savedName)
      if (savedEmoji) setAvatarEmoji(savedEmoji)
      if (savedPic) setProfilePic(savedPic)
    }
    loadProfile()
    window.addEventListener("profile-updated", loadProfile)
    return () => window.removeEventListener("profile-updated", loadProfile)
  }, [])

  // 1. Fetch live market indexes
  useEffect(() => {
    const fetchIndexes = () => {
      fetch("http://localhost:8000/api/v1/screener/market-summary")
        .then(res => res.json())
        .then(data => {
          if (data && data.index && data.xu030 && data.usdtry) {
            setIndexData([
              {
                name: "XU100",
                value: Number(data.index.price).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
                change: (data.index.change_percent >= 0 ? "+" : "") + Number(data.index.change_percent).toFixed(2) + "%",
                up: data.index.change_percent >= 0
              },
              {
                name: "XU030",
                value: Number(data.xu030.price).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
                change: (data.xu030.change_percent >= 0 ? "+" : "") + Number(data.xu030.change_percent).toFixed(2) + "%",
                up: data.xu030.change_percent >= 0
              },
              {
                name: "USD/TRY",
                value: Number(data.usdtry.price).toLocaleString("tr-TR", { minimumFractionDigits: 3, maximumFractionDigits: 3 }),
                change: (data.usdtry.change_percent >= 0 ? "+" : "") + Number(data.usdtry.change_percent).toFixed(2) + "%",
                up: data.usdtry.change_percent >= 0
              }
            ])
          }
        })
        .catch(err => console.error("Failed to load header ticker feed:", err))
    }

    fetchIndexes()
    const interval = setInterval(fetchIndexes, 10000)
    return () => clearInterval(interval)
  }, [])

  // 2. Fetch all tickers (stocks) for search autocomplete
  useEffect(() => {
    fetch("http://localhost:8000/api/v1/screener/")
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
    fetch("http://localhost:8000/api/v1/funds/")
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
    <header className="h-16 border-b border-border bg-card/60 backdrop-blur-md flex items-center justify-between px-8 sticky top-0 z-40">
      {/* Ticker Feed */}
      <div className="flex items-center space-x-6">
        {indexData.map((idx) => (
          <div key={idx.name} className="flex items-center space-x-2 text-xs font-semibold">
            <span className="text-muted-foreground">{idx.name}</span>
            <span className="text-foreground font-mono">{idx.value}</span>
            <span className={idx.up ? "text-emerald-500 flex items-center" : "text-rose-500 flex items-center"}>
              {idx.up ? <TrendingUp className="h-3 w-3 mr-0.5" /> : <TrendingDown className="h-3 w-3 mr-0.5" />}
              {idx.change}
            </span>
          </div>
        ))}
      </div>

      {/* Action Area */}
      <div className="flex items-center space-x-4">
        {/* Search Autocomplete */}
        <div className="relative w-64">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder="Hisse veya fon ara..." 
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
                    if (t.isFund) {
                      if (window.location.pathname === "/funds") {
                        window.dispatchEvent(new CustomEvent("select-fund", { detail: t.code }))
                      } else {
                        window.location.href = `/funds?code=${t.code}`
                      }
                    } else {
                      if (window.location.pathname === "/screener") {
                        window.dispatchEvent(new CustomEvent("select-stock", { detail: t.code }))
                      } else {
                        window.location.href = `/stock/${t.code}`
                      }
                    }
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
            <Bell className={`h-4.5 w-4.5 text-amber-400 group-hover:text-amber-300 ${activeSignals.length > 0 ? "animate-bounce" : ""}`} style={{ animationDuration: '3s' }} />
            {activeSignals.length > 0 && (
              <>
                <span className="absolute top-2.5 right-2.5 h-2 w-2 bg-rose-500 rounded-full ring-2 ring-card animate-ping" />
                <span className="absolute top-2.5 right-2.5 h-2 w-2 bg-rose-500 rounded-full ring-2 ring-card" />
              </>
            )}
          </Button>

          {showNotifications && (
            <div className="absolute right-0 top-12 w-85 bg-zinc-950/95 backdrop-blur-md border border-border/85 rounded-xl shadow-xl overflow-hidden z-50 text-xs p-4 space-y-3">
              <div className="flex items-center justify-between border-b border-border/30 pb-2">
                <span className="font-extrabold text-foreground">Sinyal Bildirimleri</span>
                {activeSignals.length > 0 && (
                  <span className="bg-rose-500/10 text-rose-400 font-mono font-bold px-1.5 py-0.5 rounded text-[10px]">
                    {activeSignals.length} Aktif
                  </span>
                )}
              </div>
              
              <div className="max-h-60 overflow-y-auto space-y-2">
                {activeSignals.length > 0 ? (
                  activeSignals.map((sig, idx) => (
                    <div 
                      key={idx}
                      onClick={() => {
                        window.location.href = `/stock/${sig.ticker}`
                        setShowNotifications(false)
                      }}
                      className={`p-2.5 rounded-lg border cursor-pointer transition-colors text-left ${
                        sig.signal === "AL" 
                          ? "bg-emerald-950/10 border-emerald-500/20 hover:bg-emerald-950/20" 
                          : "bg-rose-950/10 border-rose-500/20 hover:bg-rose-950/20"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-foreground">{sig.ticker}</span>
                        <span className={`px-1.5 py-0.5 rounded text-[8px] font-black border uppercase ${
                          sig.signal === "AL" ? "bg-green-500/10 text-green-400 border-green-500/20" : "bg-rose-500/10 text-rose-400 border-rose-500/20"
                        }`}>
                          {sig.signal}
                        </span>
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-1 truncate">{sig.description}</p>
                    </div>
                  ))
                ) : (
                  <p className="text-center text-muted-foreground py-4 text-[10px]">Aktif sinyal veya bildirim bulunmuyor.</p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* User Badge */}
        <div 
          onClick={() => window.location.href = "/settings"} 
          className="flex items-center space-x-3 pl-2 border-l border-border cursor-pointer hover:opacity-85 transition-opacity"
        >
          <div className="flex flex-col text-right hidden sm:flex">
            <span className="text-xs font-bold text-foreground">{username}</span>
            <span className="text-[10px] text-emerald-400 font-semibold flex items-center justify-end">
              <Sparkles className="h-2.5 w-2.5 mr-0.5" />
              Pro Üye
            </span>
          </div>
          <div className="h-9 w-9 rounded-full bg-secondary/60 border border-border/80 flex items-center justify-center text-lg shadow-md overflow-hidden shrink-0">
            {profilePic ? (
              <img src={profilePic} className="h-full w-full object-cover" alt="Profile" />
            ) : (
              avatarEmoji
            )}
          </div>
        </div>
      </div>
    </header>
  )
}
