"use client"

import React, { useEffect, useState } from "react"
import { Newspaper, RefreshCw, Sparkles } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card"
import { Button } from "@/components/ui/Button"
import EconomicCalendarWidget from "@/components/EconomicCalendarWidget"
import TradingViewNewsWidget from "@/components/TradingViewNewsWidget"

const MAX_BULLETIN_TICKERS = 3

export default function EconomyNewsPage() {
  const [favorites, setFavorites] = useState<string[]>([])
  // Bumping this key forces the TradingView widgets to fully remount (their
  // own embed script keeps them live internally, so there's no fetch to
  // "refresh" anymore - this just gives the Yenile button something useful
  // to do if a widget ever fails to load).
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    const saved = localStorage.getItem("favorites_stocks")
    if (saved) {
      setFavorites(JSON.parse(saved))
    }
  }, [])

  const bulletinTickers = favorites.slice(0, MAX_BULLETIN_TICKERS)

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
            TradingView'den canlı finansal piyasa haberleri ve makroekonomik duyurular.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setRefreshKey(k => k + 1)}
          className="cursor-pointer font-bold text-xs"
        >
          <RefreshCw className="h-4 w-4 mr-2" />
          Yenile
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

        {/* Main Column: Live TradingView news feed (Span 2) */}
        <div className="lg:col-span-2">
          <Card glass={true} className="border-primary/20 bg-gradient-to-br from-card via-card to-purple-950/5">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm uppercase tracking-wider text-muted-foreground font-black">
                Canlı Piyasa Haberleri
              </CardTitle>
              <CardDescription className="text-[10px]">TradingView üzerinden anlık akış</CardDescription>
            </CardHeader>
            <CardContent>
              <TradingViewNewsWidget key={`market-${refreshKey}`} height={620} />
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Economic Calendar + BİP AI Bülten (1 col) */}
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
                BİP AI Bülten
              </CardTitle>
              <CardDescription className="text-[10px] mt-0.5">
                Favori hisselerinize ait canlı TradingView haber akışı
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {bulletinTickers.length > 0 ? (
                bulletinTickers.map(ticker => (
                  <div key={ticker} className="space-y-1.5">
                    <span className="text-[10px] font-black text-foreground bg-secondary px-2 py-0.5 rounded">
                      {ticker}
                    </span>
                    <TradingViewNewsWidget key={`${ticker}-${refreshKey}`} symbol={ticker} height={240} />
                  </div>
                ))
              ) : (
                <p className="text-[10px] text-muted-foreground leading-relaxed py-4 text-center">
                  Favori hisselerinizle ilgili haber akışı için Hisseler sayfasında yıldız ikonuna basarak hisseleri favorilerinize ekleyebilirsiniz.
                </p>
              )}
            </CardContent>
          </Card>
        </div>

      </div>
    </div>
  )
}
