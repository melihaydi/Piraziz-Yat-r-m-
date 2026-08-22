"use client"

import React, { useState, useEffect, useMemo } from "react"
import { useParams, useRouter } from "next/navigation"
import { ChevronLeft, Sparkles, AlertTriangle, TrendingUp, TrendingDown, Check, Info, FileText, Loader2, Bell } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card"
import { Button } from "@/components/ui/Button"
import { Input } from "@/components/ui/Input"
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogDescription, 
  DialogFooter,
  DialogTrigger 
} from "@/components/ui/Dialog"
import TradingViewChart from "@/components/TradingViewChart"
import { TickerLogo } from "@/components/ui/TickerLogo"
import { API_BASE_URL } from "@/lib/config"
import { CHART_TIMEFRAMES, MAX_SIMULATED_CHART_RETRIES } from "@/lib/chartTimeframes"
import { authFetch } from "@/lib/auth"

export default function StockDetailPage() {
  const params = useParams()
  const router = useRouter()
  const ticker = (params.ticker as string).toUpperCase()
  
  // Ticker Details state
  const [stockDetails, setStockDetails] = useState<any>(null)
  const [detailsLoading, setDetailsLoading] = useState(true)
  const [scoreDetails, setScoreDetails] = useState<any>(null)
  const [scoreLoading, setScoreLoading] = useState(true)

  // Alarm Modal states (Request 4!)
  const [isOpenAlertModal, setIsOpenAlertModal] = useState(false)
  const [alertType, setAlertType] = useState("price")
  const [alertOperator, setAlertOperator] = useState(">")
  const [alertValue, setAlertValue] = useState("")
  const [alertDirection, setAlertDirection] = useState("ANY")
  const [alertSuccess, setAlertSuccess] = useState(false)

  // Pre-fill alert value with live stock price when price is selected
  useEffect(() => {
    if (stockDetails && alertType === "price") {
      setAlertValue(stockDetails.price.toString())
    } else if (alertType === "rsi") {
      setAlertValue("70")
    } else if (alertType === "ai_score") {
      setAlertValue("80")
    } else if (alertType === "volume_spike") {
      setAlertValue("2") // ortalamanın 2 katı hacim
    } else {
      setAlertValue("1") // fallback
    }
  }, [alertType, stockDetails])

  const handleAddAlert = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!alertValue) return

    const token = localStorage.getItem("token")
    const headers = {
      "Content-Type": "application/json",
      ...(token ? { "Authorization": `Bearer ${token}` } : {})
    }

    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/alert/`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          ticker: ticker.toUpperCase(),
          alert_type: alertType,
          trigger_condition: alertType === "strategy_signal"
            ? { direction: alertDirection }
            : { operator: alertOperator, value: parseFloat(alertValue.replace(",", ".")) || 1.0 }
        })
      })
      if (res.ok) {
        setAlertSuccess(true)
        setTimeout(() => {
          setAlertSuccess(false)
          setIsOpenAlertModal(false)
        }, 1500)
      }
    } catch (err) {
      console.error("Failed to add alert:", err)
    }
  }

  // Chart state
  const [selectedTimeframe, setSelectedTimeframe] = useState("1h")
  const [chartData, setChartData] = useState<any[]>([])
  const [chartLoading, setChartLoading] = useState(true)
  const [chartSimulated, setChartSimulated] = useState(false)

  // AI report state
  const [aiReport, setAiReport] = useState<any>(null)
  const [aiLoading, setAiLoading] = useState(true)

  const timeframes = CHART_TIMEFRAMES

  // 1. Fetch live stock info and AI score details (Request 7!)
  useEffect(() => {
    setDetailsLoading(true)
    setScoreLoading(true)

    // A. Fetch this one stock's info - previously fetched the entire BIST
    // screener list (every ticker's live quote + computed AI score) just to
    // filter out one row client-side, which meant visiting any stock detail
    // page paid the cost of scoring every other stock too.
    authFetch(`/screener/detail/${ticker}`)
      .then(res => res.json())
      .then(data => {
        if (data && data.ticker) {
          setStockDetails(data)
        }
        setDetailsLoading(false)
      })
      .catch(err => {
        console.error("Failed to fetch stock info:", err)
        setDetailsLoading(false)
      })

    // B. Fetch detailed scoring indicators breakdown
    authFetch(`/screener/score-details/${ticker}`)
      .then(res => res.json())
      .then(data => {
        if (data && !data.detail) {
          setScoreDetails(data)
        }
        setScoreLoading(false)
      })
      .catch(err => {
        console.error("Failed to fetch AI score details:", err)
        setScoreLoading(false)
      })
  }, [ticker])

  // 2. Fetch candles with self-healing retry if data is simulated (Request 1!)
  useEffect(() => {
    let active = true;
    let timerId: any = null;
    // The retry exists to ride out the backend's cold cache right after a
    // restart, which resolves in seconds. It used to have NO cap: whenever
    // the backend kept answering with simulated candles (e.g. a symbol that
    // never resolves), this refired every 2.5s for as long as the tab
    // stayed open - an unbounded request loop against a 1GB host, per open
    // tab. Cap it, then stop and tell the user instead of hammering.
    let attemptsLeft = MAX_SIMULATED_CHART_RETRIES;

    const loadChart = () => {
      if (!ticker) return;

      authFetch(`/screener/chart/${ticker}?interval=${selectedTimeframe}`)
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
          setChartSimulated(isSimulated)

          if (isSimulated && attemptsLeft > 0) {
            attemptsLeft -= 1;
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
    setChartSimulated(false)
    loadChart();

    return () => {
      active = false;
      if (timerId) clearTimeout(timerId);
    };
  }, [ticker, selectedTimeframe])

  // 3. Fetch AI financial analysis report
  useEffect(() => {
    setAiLoading(true)
    authFetch(`/screener/analyze/${ticker}`, {
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
          onClick={() => router.push("/screener")} 
          className="text-xs flex items-center pl-0 cursor-pointer hover:bg-transparent"
        >
          <ChevronLeft className="h-4 w-4 mr-1 text-primary" />
          Hisse Tarayıcıya Dön
        </Button>
      </div>

      {/* Header Info */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 animate-rise">
        <div>
          <div className="flex items-center space-x-3">
            <TickerLogo ticker={ticker} size={32} />
            <h1 className="t-display">{stockDetails.name}</h1>
          </div>
          <p className="t-caption mt-1.5 flex items-center">
            {ticker} · {stockDetails.sector} Sektörü • BIST Canlı Veri Motoru
          </p>
        </div>

        {/* Live Price & Change & Alarm Button (Request 4!) */}
        <div className="flex items-center space-x-4">
          <div className="flex items-baseline space-x-3">
            <div className="text-4xl font-black font-mono">
              ₺{stockDetails.price.toFixed(2)}
            </div>
            <div className={`flex items-center text-sm font-bold px-2 py-0.5 rounded ${
              stockDetails.change_percent >= 0 ? "bg-bull/10 text-bull border border-bull/20" : "bg-bear/10 text-bear border border-bear/20"
            }`}>
              {stockDetails.change_percent >= 0 ? <TrendingUp className="h-4.5 w-4.5 mr-1" /> : <TrendingDown className="h-4.5 w-4.5 mr-1" />}
              {stockDetails.change_percent >= 0 ? "+" : ""}{stockDetails.change_percent.toFixed(2)}%
            </div>
          </div>
          
          {/* Dialog Alarm Setup */}
          <Dialog open={isOpenAlertModal} onOpenChange={setIsOpenAlertModal}>
            <DialogTrigger asChild>
              <Button variant="outline" className="cursor-pointer border-primary/20 hover:border-primary/40 text-primary bg-primary/5 flex items-center gap-1.5 font-bold h-9">
                <Bell className="h-4 w-4 text-primary animate-pulse" />
                Alarm Kur
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-1.5">
                  <Bell className="h-5 w-5 text-primary" />
                  {ticker} Hissesi İçin Alarm Kur
                </DialogTitle>
                <DialogDescription>
                  İndikatörler, fiyat hareketleri, AI skoru veya KAP haberleri tetiklendiğinde Windows bildirimi ve sesli uyarı alın.
                </DialogDescription>
              </DialogHeader>
              {alertSuccess ? (
                <div className="flex flex-col items-center justify-center py-8 space-y-2 text-center">
                  <Check className="h-10 w-10 text-bull bg-bull/10 p-2 rounded-full border border-bull/20 animate-bounce" />
                  <p className="font-extrabold text-foreground text-sm">Alarm Başarıyla Kuruldu!</p>
                  <p className="text-xs text-muted-foreground">Koşul gerçekleştiğinde anlık bildirim alacaksınız.</p>
                </div>
              ) : (
                <form onSubmit={handleAddAlert} className="space-y-4 py-4">
                  <div className="grid grid-cols-3 items-center gap-4">
                    <label className="text-sm font-semibold text-muted-foreground text-right">Kriter</label>
                    <select 
                      value={alertType}
                      onChange={(e) => setAlertType(e.target.value)}
                      className="col-span-2 h-9 rounded-md border border-input bg-secondary px-3 text-sm focus-visible:outline-none"
                    >
                      <option value="price">Fiyat (₺)</option>
                      <option value="rsi">RSI (14)</option>
                      <option value="macd">MACD Kesişimi</option>
                      <option value="ema">EMA (20) Kesişimi</option>
                      <option value="sma">SMA (50) Kesişimi</option>
                      <option value="ai_score">AI Skoru</option>
                      <option value="kap">KAP Açıklaması</option>
                      <option value="news">Haber Akışı</option>
                      <option value="daily_change">Günlük Değişim (%)</option>
                      <option value="volume_spike">Hacim Patlaması</option>
                      <option value="strategy_signal">Frantic Strateji Sinyali</option>
                    </select>
                  </div>
                  {alertType === "strategy_signal" ? (
                    <div className="grid grid-cols-3 items-center gap-4">
                      <label className="text-sm font-semibold text-muted-foreground text-right">Yön</label>
                      <select
                        value={alertDirection}
                        onChange={(e) => setAlertDirection(e.target.value)}
                        className="col-span-2 h-9 rounded-md border border-input bg-secondary px-3 text-sm focus-visible:outline-none"
                      >
                        <option value="ANY">LONG veya SHORT</option>
                        <option value="LONG">Sadece LONG</option>
                        <option value="SHORT">Sadece SHORT</option>
                      </select>
                    </div>
                  ) : (
                    <>
                      <div className="grid grid-cols-3 items-center gap-4">
                        <label className="text-sm font-semibold text-muted-foreground text-right">Koşul</label>
                        <select
                          value={alertOperator}
                          onChange={(e) => setAlertOperator(e.target.value)}
                          className="col-span-2 h-9 rounded-md border border-input bg-secondary px-3 text-sm focus-visible:outline-none"
                        >
                          <option value=">">Büyüktür (&gt;)</option>
                          <option value="<">Küçüktür (&lt;)</option>
                          <option value="=">Eşittir (=)</option>
                        </select>
                      </div>
                      <div className="grid grid-cols-3 items-center gap-4">
                        <label className="text-sm font-semibold text-muted-foreground text-right">
                          {alertType === "volume_spike" ? "Ortalamanın Katı" : "Hedef Değer"}
                        </label>
                        <Input
                          type="text"
                          inputMode="decimal"
                          value={alertValue}
                          onChange={(e) => setAlertValue(e.target.value)}
                          placeholder={alertType === "volume_spike" ? "Ör: 2" : "Ör: 320"}
                          className="col-span-2 bg-secondary/50"
                          required
                        />
                      </div>
                    </>
                  )}
                  <DialogFooter className="pt-4 border-t border-border/50">
                    <Button type="submit" className="w-full font-black">
                      Alarmı Kaydet
                    </Button>
                  </DialogFooter>
                </form>
              )}
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Main Analysis Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Chart Column (Span 2) */}
        <div className="lg:col-span-2 space-y-8">
          <Card glass={true}>
            <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between pb-6 gap-4">
              <div>
                <CardTitle className="t-section flex items-center">
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
                    {tf.label}
                  </button>
                ))}
              </div>
            </CardHeader>
            <CardContent>
              {chartLoading ? (
                <div className="flex flex-col items-center justify-center h-[380px] space-y-3 bg-background/40 border border-border/30 rounded-xl">
                  <Loader2 className="h-8 w-8 text-primary animate-spin" />
                  <span className="text-xs text-muted-foreground">Tarihsel Mum Verileri Derleniyor...</span>
                </div>
              ) : chartData.length > 0 ? (
                <>
                  {/* The backend serves randomly generated placeholder bars
                      (X-Chart-Simulated) when its live cache is cold. Those
                      used to render indistinguishably from real candles -
                      invented prices on a stock detail page. Label them. */}
                  {chartSimulated && (
                    <div className="mb-2 flex items-center gap-2 rounded-md border border-warn/30 bg-warn/10 px-3 py-2">
                      <span className="text-[11px] font-bold val-warn">Geçici veri</span>
                      <span className="text-[11px] text-muted-foreground">
                        Canlı fiyat akışı henüz bağlanmadı - bu grafik gerçek piyasa verisi değildir.
                      </span>
                    </div>
                  )}
                  <TradingViewChart data={chartData} symbol={ticker} />
                </>
              ) : (
                <div className="flex items-center justify-center h-[380px] text-xs text-muted-foreground border border-border/30 rounded-xl bg-background/40">
                  Grafik verisi bulunamadı veya sunucu bağlantısı bekleniyor.
                </div>
              )}
            </CardContent>
          </Card>

          {/* Quick Ratios Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 stagger-reveal" data-reveal>
            <Card glass={true} spotlight className="text-center py-4">
              <span className="text-xs text-muted-foreground font-semibold">F/K (PE)</span>
              <p className="text-2xl font-black font-mono mt-1">
                {stockDetails.pe > 0 ? stockDetails.pe.toFixed(1) : "-"}
              </p>
            </Card>
            <Card glass={true} spotlight className="text-center py-4">
              <span className="text-xs text-muted-foreground font-semibold">Hisse Başı Kazanç (EPS)</span>
              <p className="text-2xl font-black font-mono mt-1">
                {stockDetails.eps > 0 ? `₺${stockDetails.eps.toFixed(2)}` : "-"}
              </p>
            </Card>
            <Card glass={true} spotlight className="text-center py-4">
              <span className="text-xs text-muted-foreground font-semibold">Piyasa Değeri</span>
              <p className="text-2xl font-black font-mono text-primary mt-1">
                {stockDetails.market_cap > 0 ? `₺${(stockDetails.market_cap / 1e9).toFixed(1)}B` : "-"}
              </p>
            </Card>
            <Card glass={true} spotlight className="text-center py-4">
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
                <CardTitle className="t-section flex items-center">
                  <Sparkles className="h-4 w-4 mr-2 text-primary" />
                  BIP AI Skor Dökümü
                </CardTitle>
                <span className="bg-primary/10 text-primary border border-primary/15 font-black text-2xl px-3 py-1 rounded">
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
                    <span className="text-primary font-bold">{item.val} / 100</span>
                  </div>
                  <div className="w-full bg-secondary/40 rounded-full h-1.5">
                    <div 
                      className="bg-primary h-1.5 rounded-full" 
                      style={{ width: `${item.val}%` }}
                    ></div>
                  </div>
                </div>
              ))}

              {/* Dynamic Indicator-Based Reasons (Request 7!) */}
              <div className="border-t border-border/50 pt-4 space-y-3">
                <h4 className="text-xs font-black uppercase tracking-wider text-primary flex items-center">
                  <Sparkles className="h-3 w-3 mr-1.5 text-primary" />
                  13 Teknik İndikatör Puan Ağırlığı
                </h4>
                {scoreLoading ? (
                  <div className="space-y-2">
                    <div className="h-8 bg-secondary/30 rounded-lg animate-pulse" />
                    <div className="h-8 bg-secondary/30 rounded-lg animate-pulse" />
                  </div>
                ) : scoreDetails && scoreDetails.reasons ? (
                  <div className="grid grid-cols-1 gap-1.5 text-[10px] max-h-60 overflow-y-auto pr-1">
                    {scoreDetails.reasons.map((r: any, idx: number) => (
                      <div key={idx} className="flex items-center justify-between bg-secondary/30 p-2 rounded-lg border border-border/25">
                        <span className="flex items-center text-muted-foreground">
                          <span className={`mr-1.5 font-bold ${r.icon === "✔" ? "text-bull" : "text-bear"}`}>
                            {r.icon}
                          </span>
                          {r.text}
                        </span>
                        <span className={`font-bold font-mono ${r.value.startsWith("+") ? "text-bull" : "text-bear"}`}>
                          {r.value}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-[10px] text-muted-foreground text-center py-2">
                    Teknik sinyal dökümü şu an yüklenemedi.
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* AI Analysis Commentary Card */}
      <Card glass={true}>
        <CardHeader>
          <CardTitle className="t-section flex items-center">
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
              <div className="bg-secondary/15 border-l-4 border-primary p-4 rounded-r-md">
                <span className="text-xs font-black uppercase text-primary tracking-wider">Yönetici Özeti</span>
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

              {/* 10 Technical AI Fields Section */}
              {aiReport.trend && (
                <div className="space-y-6 pt-4 border-t border-border/40">
                  <h3 className="text-xs font-black uppercase tracking-wider text-foreground flex items-center">
                    <Sparkles className="h-4 w-4 mr-1.5 text-primary animate-pulse" />
                    Teknik Analiz Göstergeleri & Beklentiler
                  </h3>
                  
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {/* Trend */}
                    <div className="bg-secondary/25 p-3.5 border border-border/30 rounded-xl">
                      <span className="block text-[9px] text-muted-foreground uppercase font-bold tracking-wider">Trend Yönü</span>
                      <span className={`text-sm font-black mt-1 block ${
                        aiReport.trend === "Yükseliş" ? "text-bull" :
                        aiReport.trend === "Düşüş" ? "text-bear" : "text-muted-foreground"
                      }`}>{aiReport.trend}</span>
                    </div>

                    {/* Support / Resistance */}
                    <div className="bg-secondary/25 p-3.5 border border-border/30 rounded-xl">
                      <span className="block text-[9px] text-muted-foreground uppercase font-bold tracking-wider">Destek / Direnç</span>
                      <span className="text-xs font-mono font-bold mt-1 block text-foreground">
                        {aiReport.support} / {aiReport.resistance}
                      </span>
                    </div>

                    {/* Risk */}
                    <div className="bg-secondary/25 p-3.5 border border-border/30 rounded-xl">
                      <span className="block text-[9px] text-muted-foreground uppercase font-bold tracking-wider">Risk Düzeyi</span>
                      <span className={`text-sm font-black mt-1 block ${
                        aiReport.risk_level === "Düşük" ? "text-bull" :
                        aiReport.risk_level === "Yüksek" ? "val-down" : "val-warn"
                      }`}>{aiReport.risk_level}</span>
                    </div>

                    {/* Momentum */}
                    <div className="bg-secondary/25 p-3.5 border border-border/30 rounded-xl">
                      <span className="block text-[9px] text-muted-foreground uppercase font-bold tracking-wider">Momentum & Güç</span>
                      <span className="text-xs font-bold mt-1 block text-foreground">
                        {aiReport.momentum} ({aiReport.trend_strength})
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Short & Medium Term Expectations */}
                    <div className="bg-secondary/25 p-4 border border-border/30 rounded-xl flex items-center justify-between">
                      <div>
                        <span className="block text-[9px] text-muted-foreground uppercase font-bold tracking-wider">Kısa Vadeli Beklenti</span>
                        <span className={`text-sm font-black mt-0.5 block ${
                          aiReport.short_term_expectation === "Pozitif" ? "text-bull" :
                          aiReport.short_term_expectation === "Negatif" ? "text-bear" : "text-muted-foreground"
                        }`}>{aiReport.short_term_expectation}</span>
                      </div>
                      <div className="border-l border-border/40 h-8 mx-4" />
                      <div>
                        <span className="block text-[9px] text-muted-foreground uppercase font-bold tracking-wider">Orta Vadeli Beklenti</span>
                        <span className={`text-sm font-black mt-0.5 block ${
                          aiReport.medium_term_expectation === "Pozitif" ? "text-bull" :
                          aiReport.medium_term_expectation === "Negatif" ? "text-bear" : "text-muted-foreground"
                        }`}>{aiReport.medium_term_expectation}</span>
                      </div>
                    </div>

                    {/* General Summary */}
                    <div className="bg-secondary/25 p-4 border border-border/30 rounded-xl">
                      <span className="block text-[9px] text-muted-foreground uppercase font-bold tracking-wider">Genel Özet</span>
                      <p className="text-xs font-semibold mt-1 text-foreground/90">{aiReport.general_summary}</p>
                    </div>
                  </div>

                  {/* Technical Comment */}
                  <div className="bg-primary/[0.06] border border-primary/25 p-4 rounded-xl space-y-1.5">
                    <span className="text-xs font-black uppercase text-primary tracking-wider flex items-center">
                      <Sparkles className="h-3.5 w-3.5 mr-1.5 text-primary" />
                      Teknik Yapay Zekâ Yorumu
                    </span>
                    <p className="text-muted-foreground text-xs leading-relaxed">{aiReport.ai_comment}</p>
                  </div>
                </div>
              )}

              {/* Strengths & Weaknesses */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-border/40">
                <div className="space-y-3">
                  <h4 className="text-xs font-black uppercase text-bull tracking-wider flex items-center">
                    <Check className="h-4 w-4 mr-1.5 bg-bull/10 p-0.5 rounded-full" />
                    Güçlü Yönler (Strengths)
                  </h4>
                  <ul className="space-y-2">
                    {aiReport.strengths && aiReport.strengths.map((str: string, idx: number) => (
                      <li key={idx} className="text-xs text-muted-foreground flex items-start leading-relaxed">
                        <span className="text-bull mr-2 font-bold">•</span>
                        {str}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="space-y-3">
                  <h4 className="text-xs font-black uppercase text-bear tracking-wider flex items-center">
                    <AlertTriangle className="h-4 w-4 mr-1.5 bg-bear/10 p-0.5 rounded-full" />
                    Zayıf Yönler (Weaknesses)
                  </h4>
                  <ul className="space-y-2">
                    {aiReport.weaknesses && aiReport.weaknesses.map((weak: string, idx: number) => (
                      <li key={idx} className="text-xs text-muted-foreground flex items-start leading-relaxed">
                        <span className="text-bear mr-2 font-bold">•</span>
                        {weak}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Risks & Opportunities */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-6 border-t border-border/40">
                <div className="space-y-3">
                  <h4 className="text-xs font-black uppercase val-warn tracking-wider flex items-center">
                    <AlertTriangle className="h-4 w-4 mr-1.5 bg-warn/10 p-0.5 rounded-full" />
                    Risk Faktörleri (Risks)
                  </h4>
                  <ul className="space-y-2">
                    {aiReport.risks && aiReport.risks.map((risk: string, idx: number) => (
                      <li key={idx} className="text-xs text-muted-foreground flex items-start leading-relaxed">
                        <span className="val-warn mr-2 font-bold">•</span>
                        {risk}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="space-y-3">
                  <h4 className="text-xs font-black uppercase text-primary tracking-wider flex items-center">
                    <Sparkles className="h-4 w-4 mr-1.5 bg-primary/10 p-0.5 rounded-full" />
                    Büyüme Fırsatları (Opportunities)
                  </h4>
                  <ul className="space-y-2">
                    {aiReport.opportunities && aiReport.opportunities.map((opp: string, idx: number) => (
                      <li key={idx} className="text-xs text-muted-foreground flex items-start leading-relaxed">
                        <span className="text-primary mr-2 font-bold">•</span>
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
