"use client"

import React, { useEffect, useState, useMemo } from "react"
import { useParams, useRouter } from "next/navigation"
import dynamic from "next/dynamic"
import { ChevronLeft, Loader2, Calendar, Shield, Wallet, User, TrendingUp, AlertTriangle, Clock, Zap } from "lucide-react"
import { Button } from "@/components/ui/Button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card"
import { API_BASE_URL } from "@/lib/config"
import { authFetch } from "@/lib/auth"

// recharts (~324KB) bu sayfanın İLK yükünden çıkarıldı - diğer tüm
// sayfaların zaten kullandığı dynamic() deseni buraya da uygulandı.
// Burada ekstra önemli: /funds/[code] herkese açık (bkz. AuthGate'in
// PUBLIC_PATHS'i), arama motorundan gelen ziyaretçinin ilk gördüğü sayfa.
const chartLoading = () => (
  <div className="h-full flex items-center justify-center">
    <Loader2 className="h-5 w-5 text-muted-foreground animate-spin" />
  </div>
)
const FundPriceAreaChart = dynamic(() => import("@/components/charts/FundPriceAreaChart"), {
  ssr: false,
  loading: chartLoading,
})
const FundDistributionPieChart = dynamic(() => import("@/components/charts/FundDistributionPieChart"), {
  ssr: false,
  loading: chartLoading,
})

const COLORS = ["#3b82f6", "#10b981", "#fbbf24", "#a855f7", "#ec4899", "#f97316"]

export default function FundDetailPage() {
  const params = useParams()
  const router = useRouter()
  const code = (params.code as string)?.toUpperCase()

  const [fund, setFund] = useState<any>(null)
  const [candles, setCandles] = useState<any[]>([])
  const [chartIsSimulated, setChartIsSimulated] = useState(false)
  const [loading, setLoading] = useState(true)
  const [liveEstimate, setLiveEstimate] = useState<{
    estimated_change_pct: number | null
    resolved_weight_pct: number | null
    order_cutoff: { cutoff_time: string; same_day: boolean; minutes_remaining: number } | null
  } | null>(null)

  useEffect(() => {
    if (!code) return
    setLoading(true)

    let active = true
    let retryTimer: any = null
    let attempt = 0

    const fetchDetails = async () => {
      try {
        const detailsRes = await fetch(`${API_BASE_URL}/api/v1/funds/${code}`)
        if (detailsRes.ok) {
          const detailData = await detailsRes.json()
          if (active) setFund(detailData)
        }

        const chartRes = await fetch(`${API_BASE_URL}/api/v1/funds/chart/${code}?count=40`)
        if (chartRes.ok) {
          const isSimulated = chartRes.headers.get("X-Chart-Simulated") === "true"
          const chartData = await chartRes.json()
          if (active && Array.isArray(chartData)) {
            setCandles(chartData)
            // Bu bayrak daha önce SADECE yeniden deneme zamanlayıcısını
            // tetiklemek için okunuyordu; kullanıcıya hiç söylenmiyordu.
            // Yani gerçek TEFAS geçmişi henüz hazır değilken, uydurulmuş
            // (XU100'e beta ile bağlanmış) bir fiyat serisi gerçek bir fon
            // grafiğinden ayırt edilemeden gösteriliyordu. Finansal bir
            // üründe bu kabul edilemez - artık grafiğin üstünde açıkça
            // yazıyor.
            setChartIsSimulated(isSimulated)
          }

          // The backend builds the real historical NAV series from TEFAS in the
          // background on first request (it walks back ~40 business days), which
          // can take a little while. Until it's ready, the chart shows a rough
          // placeholder - retry a few times so the real chart swaps in automatically.
          if (isSimulated && attempt < 8) {
            attempt += 1
            retryTimer = setTimeout(() => {
              if (active) fetchDetails()
            }, 8000)
          }
        }
      } catch (e) {
        console.error("Failed to load fund details:", e)
      } finally {
        if (active) setLoading(false)
      }
    }

    fetchDetails()

    return () => {
      active = false
      if (retryTimer) clearTimeout(retryTimer)
    }
  }, [code])

  // Anlık tahmin + emir kesme saati - ayrı bir effect'te tutuluyor çünkü
  // authFetch (giriş gerektiriyor) kullanıyor, yukarıdaki fetchDetails ise
  // kimlik doğrulamasız genel fon bilgisini çekiyor; ikisi aynı retry/hata
  // döngüsüne bağlanırsa biri diğerini gereksiz yere geciktirebilir.
  useEffect(() => {
    if (!code) return
    let active = true
    authFetch(`/funds/${code}/live-estimate`)
      .then(res => (res.ok ? res.json() : null))
      .then(data => { if (active && data) setLiveEstimate(data) })
      .catch(() => {})
    return () => { active = false }
  }, [code])

  // Map candles to AreaChart data
  const chartData = useMemo(() => {
    return candles.map(c => ({
      date: c.time,
      price: c.close
    }))
  }, [candles])

  if (loading || !fund) {
    return (
      <div className="flex flex-col items-center justify-center py-48 space-y-4">
        <Loader2 className="h-10 w-10 text-primary animate-spin" />
        <span className="text-sm text-muted-foreground font-semibold">Fon Detayları Yükleniyor...</span>
      </div>
    )
  }

  // Risk rating color mappings
  const getRiskColor = (risk: number) => {
    if (risk <= 2) return "val-up"
    if (risk <= 4) return "val-warn"
    return "val-down"
  }

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Back navigation */}
      <div>
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={() => router.push("/funds")}
          className="text-xs flex items-center pl-0 cursor-pointer hover:bg-transparent"
        >
          <ChevronLeft className="h-4 w-4 mr-1 text-primary" />
          Fon Takip Listesine Dön
        </Button>
      </div>

      {/* Header Profile */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center space-x-3">
            <span className="bg-bull text-background font-black px-2.5 py-1 rounded text-lg">
              {code}
            </span>
            <h1 className="text-3xl font-extrabold tracking-tight">{fund.name}</h1>
          </div>
          <p className="text-muted-foreground mt-1.5 flex items-center text-sm">
            TEFAS Yatırım Fonu • {fund.category} Kategorisi
          </p>
        </div>

        {/* Live Return Display */}
        <div className="flex items-baseline space-x-4">
          <span className="text-3xl font-black font-mono text-foreground">₺{fund.price.toFixed(4)}</span>
          <span className={`text-sm font-bold font-mono ${fund.daily_return >= 0 ? "text-bull" : "text-bear"}`}>
            {fund.daily_return >= 0 ? "+" : ""}{fund.daily_return.toFixed(2)}% (Günlük)
          </span>
        </div>
      </div>

      {/* Bento Grid Info cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* Price Card */}
        <Card glass={true}>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground font-semibold uppercase">Fiyat</span>
              <Wallet className="h-4 w-4 text-bull" />
            </div>
            <div className="mt-2 flex items-baseline space-x-2">
              <span className="text-2xl font-extrabold font-mono text-foreground">₺{fund.price.toFixed(4)}</span>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">TEFAS Güncel Pay Değeri</p>
          </CardContent>
        </Card>

        {/* Risk Card */}
        <Card glass={true}>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground font-semibold uppercase">Risk Düzeyi</span>
              <Shield className="h-4 w-4 text-bear" />
            </div>
            <div className="mt-2 flex items-baseline space-x-2">
              <span className={`text-2xl font-extrabold font-mono ${getRiskColor(fund.risk_level)}`}>
                {fund.risk_level} / 7
              </span>
            </div>
            <div className="w-full bg-secondary/40 h-2 rounded-full overflow-hidden mt-1.5 border border-border/30">
              <div 
                className="bg-bear h-full rounded-full transition-all duration-500" 
                style={{ width: `${(fund.risk_level / 7) * 100}%` }}
              />
            </div>
          </CardContent>
        </Card>

        {/* Fund Size Card */}
        <Card glass={true}>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground font-semibold uppercase">Portföy Büyüklüğü</span>
              <TrendingUp className="h-4 w-4 text-primary" />
            </div>
            <div className="mt-2 flex items-baseline space-x-2">
              <span className="text-2xl font-extrabold font-mono text-foreground">
                {fund.fund_size}
              </span>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">Toplam Yönetilen Varlık</p>
          </CardContent>
        </Card>

        {/* Manager Card */}
        <Card glass={true}>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground font-semibold uppercase">Fon Yöneticisi</span>
              <User className="h-4 w-4 text-primary" />
            </div>
            <div className="mt-2 flex items-baseline space-x-2">
              <span className="text-sm font-black text-foreground truncate max-w-[200px] block">
                {fund.manager}
              </span>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1.5">Pusula Portföy Yönetimi</p>
          </CardContent>
        </Card>
      </div>

      {/* Grid: Charts & Returns */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Side: Historical Chart */}
        <div className="lg:col-span-2 space-y-6">
          <Card glass={true}>
            <CardHeader>
              <CardTitle className="text-lg">Fon Tarihsel Performansı</CardTitle>
              <CardDescription>Son 40 işlem gününün birikimli fiyat grafiği</CardDescription>
            </CardHeader>
            <CardContent>
              {chartIsSimulated && chartData.length > 0 && (
                <div className="mb-3 flex items-start gap-2 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2">
                  <AlertTriangle className="h-4 w-4 val-warn shrink-0 mt-0.5" />
                  <p className="text-[11px] leading-relaxed val-warn">
                    <strong className="font-bold">Bu grafik gerçek fiyat verisi değildir.</strong>{" "}
                    Fonun gerçek TEFAS fiyat geçmişi henüz yüklenmedi; aşağıdaki
                    eğri, endeks hareketinden türetilmiş geçici bir temsildir.
                    Yatırım kararı için kullanmayın - gerçek veri hazır olduğunda
                    otomatik olarak yerini alacaktır.
                  </p>
                </div>
              )}
              <div className="h-72 w-full">
                {chartData.length > 0 ? (
                  <FundPriceAreaChart data={chartData} />
                ) : (
                  <div className="h-full flex items-center justify-center text-xs text-muted-foreground">Tarihsel grafik verisi bulunamadı</div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Side: Return Breakdown & Varlık Dağılımı */}
        <div className="space-y-8">
          {/* Varlık Dağılımı */}
          <Card glass={true}>
            <CardHeader>
              <CardTitle className="text-sm font-black uppercase tracking-wider text-primary">Varlık Kırılımı</CardTitle>
              <CardDescription className="text-[10px]">Fonda bulunan aktif varlık dağılım oranları</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col items-center">
              <div className="h-44 w-full">
                {fund.assets_distribution && fund.assets_distribution.length > 0 ? (
                  <FundDistributionPieChart data={fund.assets_distribution} colors={COLORS} />
                ) : (
                  <div className="h-full flex items-center justify-center text-xs text-muted-foreground">Varlık kırılım verisi bulunamadı</div>
                )}
              </div>
              <div className="w-full space-y-2 mt-4 max-h-36 overflow-y-auto pr-1">
                {fund.assets_distribution && fund.assets_distribution.map((entry: any, index: number) => (
                  <div key={entry.name} className="flex items-center justify-between text-xs font-semibold">
                    <div className="flex items-center text-muted-foreground">
                      <span className="h-2.5 w-2.5 rounded-full mr-2" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
                      <span className="truncate max-w-[150px]">{entry.name}</span>
                    </div>
                    <span className="font-mono text-foreground">%{entry.value}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Bugün Alırsan: anlık tahmini getiri + TEFAS emir kesme saati.
              liveEstimate null iken hiç render edilmiyor (auth gerektiren
              ayrı bir fetch, henüz dönmemiş ya da fon için tahmin
              çözülemedi) - yarım/yanlış bir sayı göstermektense göstermemek
              tercih edildi. */}
          {liveEstimate && (
            <Card glass={true}>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-black uppercase tracking-wider text-primary flex items-center gap-2">
                  <Zap className="h-3.5 w-3.5" />
                  Bugün Alırsan
                </CardTitle>
                <CardDescription className="text-[10px]">
                  Son bilinen varlık dağılımının canlı BİST fiyatlarıyla ağırlıklandırılmış <strong>tahmini</strong> gün-içi
                  getirisi - gerçek bir NAV yeniden hesaplaması değildir.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {liveEstimate.estimated_change_pct != null ? (
                  <div className="flex items-baseline justify-between">
                    <span className="text-xs text-muted-foreground font-semibold">Tahmini Gün-İçi Getiri</span>
                    <span className={`text-xl font-black font-mono ${liveEstimate.estimated_change_pct >= 0 ? "text-bull" : "text-bear"}`}>
                      {liveEstimate.estimated_change_pct >= 0 ? "+" : ""}{liveEstimate.estimated_change_pct.toFixed(2)}%
                    </span>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">Bu fon için şu an tahmin hesaplanamıyor.</p>
                )}
                {liveEstimate.resolved_weight_pct != null && (
                  <p className="text-[10px] text-muted-foreground">
                    Varlıkların %{liveEstimate.resolved_weight_pct.toFixed(0)}&apos;i canlı fiyattan çözülebildi
                  </p>
                )}
                {/* Emir kesme saati: yatırım tavsiyesi değil, sadece "hangi
                    günün fiyatından işlem göreceğin" bilgisi - kesme
                    saatinden sonra verilen bir emir bugünkü (yukarıdaki)
                    tahminle DEĞİL, yarının kapanışıyla gerçekleşir. */}
                {liveEstimate.order_cutoff && (
                  <div className={`flex items-start gap-1.5 rounded-lg border px-2.5 py-2 text-[11px] font-semibold leading-relaxed ${
                    liveEstimate.order_cutoff.same_day
                      ? "border-bull/30 bg-bull/10 text-bull"
                      : "border-border/50 bg-secondary/30 text-muted-foreground"
                  }`}>
                    <Clock className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    <span>
                      {liveEstimate.order_cutoff.same_day
                        ? `Bugün ${liveEstimate.order_cutoff.cutoff_time}'a kadar verilen emir bugünün fiyatından işlem görür (${liveEstimate.order_cutoff.minutes_remaining} dk kaldı).`
                        : `Emir kesme saati (${liveEstimate.order_cutoff.cutoff_time}) geçti - şimdi verilen emir yarının fiyatından işlem görür, yukarıdaki tahmini getiriyi değil.`}
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Performance Returns List */}
          <Card glass={true}>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-black uppercase tracking-wider text-primary">Dönemsel Getiriler</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between text-xs font-semibold py-1.5 border-b border-border/20">
                <span className="text-muted-foreground">Günlük Getiri</span>
                <span className={fund.daily_return >= 0 ? "text-bull" : "text-bear"}>
                  {fund.daily_return >= 0 ? "+" : ""}{fund.daily_return.toFixed(2)}%
                </span>
              </div>
              <div className="flex items-center justify-between text-xs font-semibold py-1.5 border-b border-border/20">
                <span className="text-muted-foreground">Haftalık Getiri</span>
                <span className={fund.weekly_return >= 0 ? "text-bull" : "text-bear"}>
                  {fund.weekly_return >= 0 ? "+" : ""}{fund.weekly_return.toFixed(2)}%
                </span>
              </div>
              <div className="flex items-center justify-between text-xs font-semibold py-1.5">
                <span className="text-muted-foreground">Aylık Getiri</span>
                <span className={fund.monthly_return >= 0 ? "text-bull" : "text-bear"}>
                  {fund.monthly_return >= 0 ? "+" : ""}{fund.monthly_return.toFixed(2)}%
                </span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
