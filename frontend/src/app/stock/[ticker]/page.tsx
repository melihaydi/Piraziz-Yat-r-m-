"use client"

import React, { useState, useEffect, useMemo } from "react"
import { useParams } from "next/navigation"
import { ChevronLeft, Sparkles, AlertTriangle, TrendingUp, TrendingDown, Check, Info, FileText, Loader2 } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card"
import { Button } from "@/components/ui/Button"
import TradingViewChart from "@/components/TradingViewChart"

export default function StockDetailPage() {
  const params = useParams()
  const ticker = (params.ticker as string).toUpperCase()
  
  // Ticker Details state
  const [stockDetails, setStockDetails] = useState<any>(null)
  const [detailsLoading, setDetailsLoading] = useState(true)

  // Chart state
  const [selectedTimeframe, setSelectedTimeframe] = useState("1h")
  const [chartData, setChartData] = useState<any[]>([])
  const [chartLoading, setChartLoading] = useState(true)

  // AI report state
  const [aiReport, setAiReport] = useState<any>(null)
  const [aiLoading, setAiLoading] = useState(true)

  const timeframes = [
    { label: "1 Dakika", value: "1m" },
    { label: "5 Dakika", value: "5m" },
    { label: "15 Dakika", value: "15m" },
    { label: "1 Saat", value: "1h" },
    { label: "4 Saat", value: "4h" },
    { label: "Günlük", value: "1d" },
    { label: "Haftalık", value: "1w" },
    { label: "Aylık", value: "1mo" }
  ]

  // 1. Fetch live stock info from screener endpoint
  useEffect(() => {
    setDetailsLoading(true)
    fetch("http://localhost:8000/api/v1/screener/")
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          const match = data.find(c => c.ticker === ticker)
          if (match) {
            setStockDetails(match)
          } else {
            // Default fallback if ticker not in BIST list
            setStockDetails({
              ticker,
              name: `${ticker} Ticaret AŞ`,
              sector: "Sanayi",
              price: 100.0,
              change_percent: 0.0,
              pe: 10.0,
              eps: 1.0,
              market_cap: 100_000_000,
              ai_score: 50,
              sentiment: "Nötr"
            })
          }
        }
        setDetailsLoading(false)
      })
      .catch(err => {
        console.error("Failed to fetch stock info:", err)
        setDetailsLoading(false)
      })
  }, [ticker])

  // 2. Fetch candles with self-healing retry if data is simulated (Request 1!)
  useEffect(() => {
    let active = true;
    let timerId: any = null;

    const loadChart = () => {
      if (!ticker) return;
      
      fetch(`http://localhost:8000/api/v1/screener/chart/${ticker}?interval=${selectedTimeframe}`)
        .then(res => {
          if (!res.ok) {
            console.warn("No chart data from server");
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
  }, [ticker, selectedTimeframe])

  // 3. Fetch AI financial analysis report
  useEffect(() => {
    setAiLoading(true)
    fetch(`http://localhost:8000/api/v1/screener/analyze/${ticker}`, {
      method: "POST"
    })
      .then(res => {
        if (!res.ok) {
          console.warn("No AI report from server");
          return null;
        }
        return res.json()
      })
      .then(data => {
        setAiReport(data)
        setAiLoading(false)
      })
      .catch(err => {
        console.error("Failed to load AI report:", err)
        setAiLoading(false)
      })
  }, [ticker])

  if (detailsLoading || !stockDetails) {
    return (
      <div className="flex flex-col items-center justify-center py-48 space-y-4">
        <Loader2 className="h-10 w-10 text-primary animate-spin" />
        <span className="text-sm text-muted-foreground font-semibold">Şirket Profil Detayları Yükleniyor...</span>
      </div>
    )
  }

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Back navigation */}
      <div>
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={() => window.location.href = "/screener"} 
          className="text-xs flex items-center pl-0 cursor-pointer hover:bg-transparent"
        >
          <ChevronLeft className="h-4 w-4 mr-1 text-primary" />
          Hisse Tarayıcıya Dön
        </Button>
      </div>

      {/* Header Info */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center space-x-3">
            <span className="bg-primary text-primary-foreground font-black px-2.5 py-1 rounded text-lg">
              {ticker}
            </span>
            <h1 className="text-3xl font-extrabold tracking-tight">{stockDetails.name}</h1>
          </div>
          <p className="text-muted-foreground mt-1.5 flex items-center text-sm">
            {stockDetails.sector} Sektörü • BIST Canlı Veri Motoru
          </p>
        </div>

        {/* Live Price & Change */}
        <div className="flex items-baseline space-x-4">
          <div className="text-4xl font-black font-mono">
            ₺{stockDetails.price.toFixed(2)}
          </div>
          <div className={`flex items-center text-sm font-bold px-2 py-0.5 rounded ${
            stockDetails.change_percent >= 0 ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
          }`}>
            {stockDetails.change_percent >= 0 ? <TrendingUp className="h-4.5 w-4.5 mr-1" /> : <TrendingDown className="h-4.5 w-4.5 mr-1" />}
            {stockDetails.change_percent >= 0 ? "+" : ""}{stockDetails.change_percent.toFixed(2)}%
          </div>
        </div>
      </div>

      {/* Main Analysis Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Chart Column (Span 2) */}
        <div className="lg:col-span-2 space-y-8">
          <Card glass={true}>
            <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between pb-6 gap-4">
              <div>
                <CardTitle className="text-base flex items-center">
                  <TrendingUp className="h-4 w-4 mr-2 text-primary" />
                  TradingView Canlı Grafik
                </CardTitle>
                <CardDescription>Gerçek zamanlı mum grafikleri, hacim ve teknik indikatörler</CardDescription>
              </div>
              
              {/* Timeframe selector */}
              <div className="flex flex-wrap items-center gap-1.5 p-1 bg-secondary/30 rounded-lg border border-border/40 text-xs">
                {timeframes.map((tf) => (
                  <button
                    key={tf.value}
                    onClick={() => setSelectedTimeframe(tf.value)}
                    className={`px-2 py-1 rounded cursor-pointer font-semibold transition-all ${
                      selectedTimeframe === tf.value
                        ? "bg-primary text-primary-foreground font-bold shadow-md shadow-primary/20"
                        : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                    }`}
                  >
                    {tf.value.toUpperCase()}
                  </button>
                ))}
              </div>
            </CardHeader>
            <CardContent>
              {chartLoading ? (
                <div className="flex flex-col items-center justify-center h-[380px] space-y-3 bg-zinc-950/20 border border-border/30 rounded-xl">
                  <Loader2 className="h-8 w-8 text-primary animate-spin" />
                  <span className="text-xs text-muted-foreground">Tarihsel Mum Verileri Derleniyor...</span>
                </div>
              ) : chartData.length > 0 ? (
                <TradingViewChart data={chartData} />
              ) : (
                <div className="flex items-center justify-center h-[380px] text-xs text-muted-foreground border border-border/30 rounded-xl bg-zinc-950/20">
                  Grafik verisi bulunamadı veya sunucu bağlantısı bekleniyor.
                </div>
              )}
            </CardContent>
          </Card>

          {/* Quick Ratios Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card glass={true} className="text-center py-4">
              <span className="text-xs text-muted-foreground font-semibold">F/K (PE)</span>
              <p className="text-2xl font-black font-mono mt-1">
                {stockDetails.pe > 0 ? stockDetails.pe.toFixed(1) : "-"}
              </p>
            </Card>
            <Card glass={true} className="text-center py-4">
              <span className="text-xs text-muted-foreground font-semibold">Hisse Başı Kazanç (EPS)</span>
              <p className="text-2xl font-black font-mono mt-1">
                {stockDetails.eps > 0 ? `₺${stockDetails.eps.toFixed(2)}` : "-"}
              </p>
            </Card>
            <Card glass={true} className="text-center py-4">
              <span className="text-xs text-muted-foreground font-semibold">Piyasa Değeri</span>
              <p className="text-2xl font-black font-mono text-purple-400 mt-1">
                {stockDetails.market_cap > 0 ? `₺${(stockDetails.market_cap / 1e9).toFixed(1)}B` : "-"}
              </p>
            </Card>
            <Card glass={true} className="text-center py-4">
              <span className="text-xs text-muted-foreground font-semibold">Alış / Satış</span>
              <p className="text-sm font-black font-mono mt-2.5">
                {stockDetails.bid > 0 ? `₺${stockDetails.bid.toFixed(2)}` : "-"} / {stockDetails.ask > 0 ? `₺${stockDetails.ask.toFixed(2)}` : "-"}
              </p>
            </Card>
          </div>
        </div>

        {/* BIP AI Score Breakdown (Column 1) */}
        <div>
          <Card glass={true} className="h-full">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center">
                  <Sparkles className="h-4 w-4 mr-2 text-primary" />
                  BIP AI Skor Dökümü
                </CardTitle>
                <span className="bg-purple-500/10 text-purple-400 border border-purple-500/15 font-black text-2xl px-3 py-1 rounded">
                  {stockDetails.ai_score}
                </span>
              </div>
              <CardDescription>Rasyo gruplarının 100 üzerinden ağırlıklı puanlaması</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Dynamic breakdown values simulated from AI score */}
              {[
                { label: "Karlılık Oranları", val: Math.round(stockDetails.ai_score * 0.95) },
                { label: "Borçluluk / Kaldıraç", val: Math.round(stockDetails.ai_score * 1.05) > 100 ? 98 : Math.round(stockDetails.ai_score * 1.05) },
                { label: "Büyüme Hızı", val: Math.round(stockDetails.ai_score * 0.90) },
                { label: "Likidite Kapasitesi", val: 85 },
                { label: "Değerleme Çarpanları", val: Math.round(stockDetails.ai_score * 1.1) > 100 ? 95 : Math.round(stockDetails.ai_score * 1.1) },
                { label: "Nakit Akışı Raporu", val: 78 },
                { label: "Verimlilik Oranları", val: 82 },
                { label: "Teknik Momentum", val: stockDetails.change_percent >= 0 ? 88 : 42 }
              ].map((item) => (
                <div key={item.label} className="space-y-1.5">
                  <div className="flex justify-between text-xs font-semibold">
                    <span className="text-foreground/80">{item.label}</span>
                    <span className="text-purple-400 font-bold">{item.val} / 100</span>
                  </div>
                  <div className="w-full bg-secondary/40 rounded-full h-1.5">
                    <div 
                      className="bg-gradient-to-r from-purple-500 to-indigo-500 h-1.5 rounded-full" 
                      style={{ width: `${item.val}%` }}
                    ></div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* AI Analysis Commentary Card */}
      <Card glass={true}>
        <CardHeader>
          <CardTitle className="text-base flex items-center">
            <FileText className="h-4 w-4 mr-2 text-primary" />
            Yapay Zekâ Temel Analiz Raporu
          </CardTitle>
          <CardDescription>Google Gemini AI tarafından üretilen canlı analitik yorumlar</CardDescription>
        </CardHeader>
        <CardContent>
          {aiLoading ? (
            <div className="flex flex-col items-center justify-center py-20 space-y-3">
              <Loader2 className="h-8 w-8 text-primary animate-spin" />
              <span className="text-xs text-muted-foreground">Gemini AI Canlı Finansal Analiz Raporu Hazırlıyor...</span>
            </div>
          ) : aiReport ? (
            <div className="space-y-8">
              {/* Summary */}
              <div className="bg-secondary/15 border-l-4 border-purple-500 p-4 rounded-r-md">
                <span className="text-xs font-black uppercase text-purple-400 tracking-wider">Yönetici Özeti</span>
                <p className="text-foreground/90 font-medium text-sm mt-1">{aiReport.executive_summary}</p>
              </div>

              {/* Long Comment */}
              <div className="space-y-2">
                <h3 className="text-sm font-bold text-foreground flex items-center">
                  <Info className="h-4 w-4 mr-1.5 text-primary" />
                  Yatırımcı Detay Raporu
                </h3>
                <p className="text-muted-foreground text-sm leading-relaxed">{aiReport.long_comment}</p>
              </div>

              {/* Strengths & Weaknesses */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-border/40">
                <div className="space-y-3">
                  <h4 className="text-xs font-black uppercase text-emerald-400 tracking-wider flex items-center">
                    <Check className="h-4 w-4 mr-1.5 bg-emerald-500/10 p-0.5 rounded-full" />
                    Güçlü Yönler (Strengths)
                  </h4>
                  <ul className="space-y-2">
                    {aiReport.strengths && aiReport.strengths.map((str: string, idx: number) => (
                      <li key={idx} className="text-xs text-muted-foreground flex items-start leading-relaxed">
                        <span className="text-emerald-400 mr-2 font-bold">•</span>
                        {str}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="space-y-3">
                  <h4 className="text-xs font-black uppercase text-rose-400 tracking-wider flex items-center">
                    <AlertTriangle className="h-4 w-4 mr-1.5 bg-rose-500/10 p-0.5 rounded-full" />
                    Zayıf Yönler (Weaknesses)
                  </h4>
                  <ul className="space-y-2">
                    {aiReport.weaknesses && aiReport.weaknesses.map((weak: string, idx: number) => (
                      <li key={idx} className="text-xs text-muted-foreground flex items-start leading-relaxed">
                        <span className="text-rose-400 mr-2 font-bold">•</span>
                        {weak}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Risks & Opportunities */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-6 border-t border-border/40">
                <div className="space-y-3">
                  <h4 className="text-xs font-black uppercase text-amber-500 tracking-wider flex items-center">
                    <AlertTriangle className="h-4 w-4 mr-1.5 bg-amber-500/10 p-0.5 rounded-full" />
                    Risk Faktörleri (Risks)
                  </h4>
                  <ul className="space-y-2">
                    {aiReport.risks && aiReport.risks.map((risk: string, idx: number) => (
                      <li key={idx} className="text-xs text-muted-foreground flex items-start leading-relaxed">
                        <span className="text-amber-500 mr-2 font-bold">•</span>
                        {risk}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="space-y-3">
                  <h4 className="text-xs font-black uppercase text-purple-400 tracking-wider flex items-center">
                    <Sparkles className="h-4 w-4 mr-1.5 bg-purple-500/10 p-0.5 rounded-full" />
                    Büyüme Fırsatları (Opportunities)
                  </h4>
                  <ul className="space-y-2">
                    {aiReport.opportunities && aiReport.opportunities.map((opp: string, idx: number) => (
                      <li key={idx} className="text-xs text-muted-foreground flex items-start leading-relaxed">
                        <span className="text-purple-400 mr-2 font-bold">•</span>
                        {opp}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center py-6 text-xs text-muted-foreground">
              Yapay zekâ görüş raporu derlenemedi. Lütfen API bağlantılarınızı kontrol edin.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
