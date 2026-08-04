"use client"

import React, { useEffect, useState, useCallback, useMemo } from "react"
import { Newspaper, RefreshCw, Sparkles, ExternalLink, Gift, ChevronDown, ChevronUp, Loader2, Info } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card"
import { Button } from "@/components/ui/Button"
import EconomicCalendarWidget from "@/components/EconomicCalendarWidget"
import { authFetch } from "@/lib/auth"

interface NewsItem {
  title: string
  link: string
  summary: string
  source: string
  pub_date: string
}

interface KapItem {
  id: string
  ticker: string
  title: string
  summary: string
  importance: "high" | "medium" | "low"
  affected_financial_lines: string[]
  short_term_impact: string
  long_term_impact: string
  sentiment: "Pozitif" | "Negatif" | "Nötr"
  score: number
  time: string
  is_dividend: boolean
}

function SentimentBadge({ sentiment }: { sentiment: string }) {
  const cls =
    sentiment === "Pozitif" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/25" :
    sentiment === "Negatif" ? "bg-rose-500/10 text-rose-400 border-rose-500/25" :
    "bg-zinc-800/60 text-muted-foreground border-border/50"
  return <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${cls}`}>{sentiment}</span>
}

function ImportanceBadge({ importance }: { importance: string }) {
  const label = importance === "high" ? "Yüksek Önem" : importance === "low" ? "Düşük Önem" : "Orta Önem"
  const cls =
    importance === "high" ? "bg-amber-500/10 text-amber-400 border-amber-500/25" :
    "bg-secondary/60 text-muted-foreground border-border/50"
  return <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${cls}`}>{label}</span>
}

// Module-level (not component state) so it survives this page unmounting -
// Next.js tears down the page component every time the user navigates away
// and back, which used to mean a fresh loading spinner and re-fetch each
// time. These persist for the lifetime of the SPA session (reset only by an
// actual page reload), so a revisit renders the last-known list instantly;
// fetchNews/fetchKap below still run in the background on every mount and
// interval tick to pick up anything genuinely new, they just no longer
// force a blank loading state to show it.
let cachedNews: NewsItem[] | null = null
let cachedKap: KapItem[] | null = null
let cachedKapIsSample = false

export default function EconomyNewsPage() {
  const [tab, setTab] = useState<"news" | "kap">("news")
  const [news, setNews] = useState<NewsItem[]>(cachedNews ?? [])
  const [newsLoading, setNewsLoading] = useState(cachedNews === null)
  const [kap, setKap] = useState<KapItem[]>(cachedKap ?? [])
  const [kapIsSample, setKapIsSample] = useState(cachedKapIsSample)
  const [kapLoading, setKapLoading] = useState(cachedKap === null)
  const [dividendOnly, setDividendOnly] = useState(false)
  const [expandedKap, setExpandedKap] = useState<string | null>(null)
  const [favorites, setFavorites] = useState<string[]>([])

  const fetchNews = useCallback(async () => {
    try {
      const res = await authFetch("/news/")
      if (res.ok) {
        const data = await res.json()
        cachedNews = data
        setNews(data)
      }
    } catch (e) {
      console.error("Failed to load news:", e)
    } finally {
      setNewsLoading(false)
    }
  }, [])

  const fetchKap = useCallback(async () => {
    // Only show the spinner on a genuinely first load (no cache yet) - a
    // background refresh (cache already populated) updates the list in
    // place without hiding it first.
    if (cachedKap === null) setKapLoading(true)
    try {
      const res = await authFetch("/screener/kap?limit=10")
      if (res.ok) {
        const data = await res.json()
        const items = data.items || []
        cachedKap = items
        cachedKapIsSample = !!data.is_sample
        setKap(items)
        setKapIsSample(!!data.is_sample)
      }
    } catch (e) {
      console.error("Failed to load KAP disclosures:", e)
    } finally {
      setKapLoading(false)
    }
  }, [])

  useEffect(() => {
    const saved = localStorage.getItem("favorites_stocks")
    if (saved) setFavorites(JSON.parse(saved))
  }, [])

  useEffect(() => {
    fetchNews()
    // Matches the backend's own 90s cache TTL (see NewsService) - polling
    // faster than that would just return the same cached response.
    const interval = setInterval(fetchNews, 90000)
    return () => clearInterval(interval)
  }, [fetchNews])

  useEffect(() => {
    // Runs every time the tab becomes "kap" (not just the first time) so a
    // revisit refreshes in the background - fetchKap only shows the
    // spinner when there's no cache yet, so this doesn't hide the
    // already-visible cached list while it does.
    if (tab === "kap") fetchKap()
  }, [tab, fetchKap])

  const favoriteNews = useMemo(() => {
    if (favorites.length === 0) return []
    return news.filter(n => favorites.some(f => n.title.includes(f))).slice(0, 8)
  }, [news, favorites])

  const filteredKap = useMemo(
    () => (dividendOnly ? kap.filter(k => k.is_dividend) : kap),
    [kap, dividendOnly]
  )

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/80 pb-6">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight flex items-center">
            <Newspaper className="h-7 w-7 text-primary mr-3 animate-pulse" />
            Ekonomi Haberleri
          </h1>
          <p className="text-muted-foreground mt-1.5">
            Anadolu Ajansı, Habertürk Ekonomi ve KAP bildirimlerinden gerçek zamanlı akış - KAP duyuruları yapay zekâ ile analiz edilir.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => (tab === "news" ? fetchNews() : fetchKap())}
          className="cursor-pointer font-bold text-xs"
        >
          <RefreshCw className="h-4 w-4 mr-2" />
          Yenile
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

        {/* Main Column */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center bg-secondary/40 border border-border rounded-lg p-0.5 text-[11px] font-bold w-fit">
            <button
              onClick={() => setTab("news")}
              className={`px-4 h-8 rounded-md transition-colors cursor-pointer ${tab === "news" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              Piyasa Haberleri
            </button>
            <button
              onClick={() => setTab("kap")}
              className={`px-4 h-8 rounded-md transition-colors cursor-pointer ${tab === "kap" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              KAP Bildirimleri
            </button>
          </div>

          {tab === "news" && (
            <Card glass={true} className="border-primary/20 bg-gradient-to-br from-card via-card to-purple-950/5">
              <CardContent className="p-0">
                {newsLoading ? (
                  <div className="flex items-center justify-center py-20">
                    <Loader2 className="h-6 w-6 text-primary animate-spin" />
                  </div>
                ) : news.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 py-16 text-muted-foreground">
                    <Info className="h-5 w-5" />
                    <span className="text-xs font-bold">Haber bulunamadı</span>
                  </div>
                ) : (
                  <div className="divide-y divide-border/40">
                    {news.map((n, i) => (
                      <a
                        key={`${n.link}-${i}`}
                        href={n.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex flex-col gap-1.5 px-5 py-4 hover:bg-secondary/20 transition-colors"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-[10px] font-bold text-primary uppercase tracking-wide">{n.source}</span>
                          <span className="text-[10px] text-muted-foreground shrink-0">{n.pub_date}</span>
                        </div>
                        <div className="text-sm font-bold text-foreground leading-snug flex items-center gap-1.5">
                          {n.title}
                          <ExternalLink className="h-3 w-3 text-muted-foreground shrink-0" />
                        </div>
                        {n.summary && (
                          <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">{n.summary}</p>
                        )}
                      </a>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {tab === "kap" && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Button
                  variant={dividendOnly ? "default" : "outline"}
                  size="sm"
                  onClick={() => setDividendOnly(v => !v)}
                  className="text-xs h-8 px-3 cursor-pointer flex items-center"
                >
                  <Gift className="h-3.5 w-3.5 mr-1.5" />
                  Sadece Temettü Bildirimleri
                </Button>
                <span className="text-[10px] text-muted-foreground">
                  KAP&apos;ta başlığında/özetinde &quot;temettü&quot; geçen bildirimler - tam bir temettü takvimi değil, yalnızca açıklanmış bildirimlerin listesi.
                </span>
              </div>

              {!kapLoading && kapIsSample && (
                <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-300/90 flex items-start gap-2">
                  <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span>
                    KAP&apos;ın canlı bildirim akışına şu anda ulaşılamıyor (kap.org.tr yanıt vermiyor) - aşağıdakiler
                    gerçek, güncel bildirimler değil, örnek/yer tutucu verilerdir.
                  </span>
                </div>
              )}

              <Card glass={true}>
                <CardContent className="p-0">
                  {kapLoading ? (
                    <div className="flex flex-col items-center justify-center gap-2 py-20">
                      <Loader2 className="h-6 w-6 text-primary animate-spin" />
                      <span className="text-[11px] text-muted-foreground">KAP bildirimleri yapay zekâ ile analiz ediliyor...</span>
                    </div>
                  ) : filteredKap.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 py-16 text-muted-foreground">
                      <Info className="h-5 w-5" />
                      <span className="text-xs font-bold">Bildirim bulunamadı</span>
                    </div>
                  ) : (
                    <div className="divide-y divide-border/40">
                      {filteredKap.map(k => {
                        const isExpanded = expandedKap === k.id
                        return (
                          <div key={k.id}>
                            <button
                              onClick={() => setExpandedKap(isExpanded ? null : k.id)}
                              className="w-full text-left flex flex-col gap-2 px-5 py-4 hover:bg-secondary/20 transition-colors cursor-pointer"
                            >
                              <div className="flex items-center justify-between gap-3">
                                <div className="flex items-center gap-2">
                                  <span className="text-[10px] font-black text-foreground bg-secondary px-2 py-0.5 rounded">{k.ticker}</span>
                                  <SentimentBadge sentiment={k.sentiment} />
                                  <ImportanceBadge importance={k.importance} />
                                  {k.is_dividend && (
                                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold border bg-purple-500/10 text-purple-400 border-purple-500/25 flex items-center gap-1">
                                      <Gift className="h-2.5 w-2.5" /> Temettü
                                    </span>
                                  )}
                                </div>
                                <span className="text-[10px] text-muted-foreground shrink-0 flex items-center gap-2">
                                  {k.time}
                                  {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                                </span>
                              </div>
                              <div className="text-sm font-bold text-foreground leading-snug">{k.title}</div>
                              <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">{k.summary}</p>
                            </button>
                            {isExpanded && (
                              <div className="px-5 pb-4 grid grid-cols-1 md:grid-cols-2 gap-4 bg-secondary/10">
                                <div>
                                  <div className="text-[10px] font-black text-muted-foreground uppercase mb-1.5">Kısa Vadeli Etki</div>
                                  <p className="text-[11px] text-foreground/90">{k.short_term_impact}</p>
                                  <div className="text-[10px] font-black text-muted-foreground uppercase mb-1.5 mt-3">Uzun Vadeli Etki</div>
                                  <p className="text-[11px] text-foreground/90">{k.long_term_impact}</p>
                                </div>
                                <div>
                                  <div className="text-[10px] font-black text-muted-foreground uppercase mb-1.5">Etkilenen Kalemler</div>
                                  <div className="flex flex-wrap gap-1.5 mb-2">
                                    {k.affected_financial_lines.map((line, i) => (
                                      <span key={i} className="px-2 py-0.5 rounded bg-secondary/60 text-[10px] font-semibold text-foreground/80">{line}</span>
                                    ))}
                                  </div>
                                  <div className="text-[10px] font-black text-muted-foreground uppercase mb-1.5">Etki Skoru</div>
                                  <div className="flex items-center gap-2">
                                    <div className="flex-1 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                                      <div className="h-full bg-primary transition-all duration-300" style={{ width: `${k.score}%` }} />
                                    </div>
                                    <span className="text-[10px] font-bold text-muted-foreground w-7 text-right">{k.score}</span>
                                  </div>
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
            </div>
          )}
        </div>

        {/* Right Column: Economic Calendar + Favorite-ticker News */}
        <div className="space-y-8">
          <Card glass={true} className="border-zinc-800 bg-zinc-950/10">
            <CardHeader>
              <CardTitle className="text-base uppercase tracking-wider text-muted-foreground font-black">
                Ekonomi Takvimi
              </CardTitle>
              <CardDescription>Piyasa üzerinde etkili olacak kritik açıklamalar (canlı, TradingView)</CardDescription>
            </CardHeader>
            <CardContent>
              <EconomicCalendarWidget />
            </CardContent>
          </Card>

          <Card glass={true} className="bg-gradient-to-br from-card to-purple-950/5 border-purple-500/20">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm uppercase tracking-wider text-purple-400 font-black flex items-center">
                <Sparkles className="h-4 w-4 text-purple-400 mr-1.5 animate-pulse" />
                Favori Hisse Haberleri
              </CardTitle>
              <CardDescription className="text-[10px] mt-0.5">
                Favori listenizdeki hisselerle ilgili gerçek haber/KAP akışı
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {favorites.length === 0 ? (
                <p className="text-[10px] text-muted-foreground leading-relaxed py-4 text-center">
                  Favori hisselerinizle ilgili haber akışı için Hisseler sayfasında yıldız ikonuna basarak hisseleri favorilerinize ekleyebilirsiniz.
                </p>
              ) : favoriteNews.length === 0 ? (
                <p className="text-[10px] text-muted-foreground leading-relaxed py-4 text-center">
                  Favori hisselerinizle ilgili güncel bir haber/bildirim bulunamadı.
                </p>
              ) : (
                favoriteNews.map((n, i) => (
                  <a
                    key={`${n.link}-${i}`}
                    href={n.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block space-y-1 pb-3 border-b border-border/20 last:border-0 last:pb-0"
                  >
                    <span className="text-[9px] font-bold text-primary uppercase">{n.source}</span>
                    <p className="text-[11px] font-bold text-foreground leading-snug line-clamp-2">{n.title}</p>
                    <span className="text-[9px] text-muted-foreground">{n.pub_date}</span>
                  </a>
                ))
              )}
            </CardContent>
          </Card>
        </div>

      </div>
    </div>
  )
}
