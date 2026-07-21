"use client"

import React, { useEffect, useState } from "react"
import { Newspaper, Loader2, RefreshCw, ExternalLink, Calendar } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card"
import { Button } from "@/components/ui/Button"

export default function EconomyNewsPage() {
  const [news, setNews] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  const fetchNews = () => {
    setLoading(true)
    fetch("http://localhost:8000/api/v1/news/")
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          setNews(data)
        }
        setLoading(false)
      })
      .catch(err => {
        console.error("Failed to load news:", err)
        setLoading(false)
      })
  }

  useEffect(() => {
    fetchNews()
  }, [])

  // Bloomberg style: Top first item as a major hero feature
  const featuredArticle = news[0] || null
  const secondaryArticles = news.slice(1)

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/80 pb-6">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight flex items-center">
            <Newspaper className="h-7 w-7 text-primary mr-3 animate-pulse" />
            Bloomberg-Style Ekonomi Haberleri
          </h1>
          <p className="text-muted-foreground mt-1.5">
            Anlık finansal piyasa haberleri, makroekonomik duyurular ve şirket haberleri.
          </p>
        </div>
        <Button 
          variant="outline" 
          size="sm" 
          onClick={fetchNews} 
          disabled={loading} 
          className="cursor-pointer font-bold text-xs"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-2" />
          )}
          Yenile
        </Button>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-48 space-y-4">
          <Loader2 className="h-10 w-10 text-primary animate-spin" />
          <span className="text-sm text-muted-foreground font-semibold">Son Finans Haberleri Alınıyor...</span>
        </div>
      ) : news.length > 0 ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Main Column: Featured Hero & List (Span 2) */}
          <div className="lg:col-span-2 space-y-8">
            
            {/* Featured Hero Story */}
            {featuredArticle && (
              <Card glass={true} className="border-primary/20 bg-gradient-to-br from-card via-card to-purple-950/5 hover:border-primary/40 transition-all duration-300">
                <CardContent className="pt-6 space-y-4">
                  <div className="flex items-center justify-between text-xs text-primary font-bold">
                    <span>MANŞET HABER</span>
                    <span className="flex items-center text-muted-foreground font-normal">
                      <Calendar className="h-3 w-3 mr-1" />
                      {featuredArticle.pub_date}
                    </span>
                  </div>
                  <h2 className="text-2xl font-black text-foreground hover:text-primary transition-colors leading-tight">
                    <a href={featuredArticle.link} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2">
                      {featuredArticle.title}
                      <ExternalLink className="h-4 w-4 shrink-0 inline-block text-muted-foreground opacity-60" />
                    </a>
                  </h2>
                  <p className="text-muted-foreground text-sm leading-relaxed">
                    {featuredArticle.summary}
                  </p>
                  <div className="flex items-center justify-between text-xs font-bold pt-4 border-t border-border/40">
                    <span className="text-purple-400 uppercase tracking-wider">{featuredArticle.source}</span>
                    <a 
                      href={featuredArticle.link} 
                      target="_blank" 
                      rel="noopener noreferrer" 
                      className="text-primary hover:underline flex items-center"
                    >
                      Haberin Detayı <ArrowRight className="h-3 w-3 ml-1" />
                    </a>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* List of other secondary news */}
            <div className="space-y-6">
              <h3 className="text-lg font-extrabold border-b border-border/40 pb-2">Akışta Kalanlar</h3>
              {secondaryArticles.map((art, idx) => (
                <div 
                  key={idx} 
                  className="p-4 rounded-xl border border-border/30 bg-secondary/15 hover:bg-secondary/25 hover:border-border/60 transition-all duration-200 space-y-2"
                >
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                    <span className="font-bold text-purple-400 uppercase tracking-wider">{art.source}</span>
                    <span>{art.pub_date}</span>
                  </div>
                  <h4 className="font-extrabold text-sm text-foreground hover:text-primary transition-colors">
                    <a href={art.link} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between gap-3">
                      {art.title}
                      <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
                    </a>
                  </h4>
                  <p className="text-xs text-muted-foreground leading-relaxed">{art.summary}</p>
                </div>
              ))}
            </div>

          </div>

          {/* Right Column: News Bulletin Sidebar (1 col) */}
          <div className="space-y-8">
            <Card glass={true} className="border-zinc-800 bg-zinc-950/10">
              <CardHeader>
                <CardTitle className="text-base uppercase tracking-wider text-muted-foreground font-black">
                  Ekonomi Takvimi
                </CardTitle>
                <CardDescription>Piyasa üzerinde etkili olacak kritik açıklamalar</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 text-xs">
                {[
                  { time: "Bugün 14:00", event: "TCMB Haftalık Para ve Banka İstatistikleri", impact: "Orta" },
                  { time: "23 Temmuz 10:00", event: "TÜİK Tüketici Güven Endeksi (Haziran)", impact: "Yüksek" },
                  { time: "24 Temmuz 17:00", event: "ABD Üretim PMI Öncü Verisi", impact: "Yüksek" }
                ].map((ev, idx) => (
                  <div key={idx} className="p-3 bg-secondary/25 border border-border/35 rounded-lg space-y-1">
                    <div className="flex items-center justify-between font-bold text-muted-foreground text-[10px]">
                      <span>{ev.time}</span>
                      <span className={`px-1.5 py-0.5 rounded-[3px] text-[8px] font-black ${
                        ev.impact === "Yüksek" ? "bg-rose-500/10 text-rose-400 border border-rose-500/15" : "bg-slate-500/10 text-slate-400 border border-slate-500/15"
                      }`}>
                        Etki: {ev.impact}
                      </span>
                    </div>
                    <p className="font-extrabold text-foreground">{ev.event}</p>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card glass={true} className="bg-gradient-to-br from-card to-purple-950/5">
              <CardHeader>
                <CardTitle className="text-base uppercase tracking-wider text-purple-400 font-black">
                  BIP AI Bülten
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs leading-relaxed text-muted-foreground">
                BIP Yapay Zekâ bülteni, güvenilir finans kaynaklarını anlık tarayarak portföy hisselerinizi ilgilendiren haber akışlarını akıllı alarmlarınızla otomatik eşleştirir.
              </CardContent>
            </Card>
          </div>

        </div>
      ) : (
        <div className="text-center py-24 text-muted-foreground">Haber akışı bulunamadı.</div>
      )}
    </div>
  )
}

// Arrow component placeholder
function ArrowRight(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5 inline ml-1"
    >
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  )
}
