"use client"

import React, { useEffect, useMemo, useState } from "react"
import { Loader2, DoorOpen, Info, AlertTriangle } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card"
import { TickerLogo } from "@/components/ui/TickerLogo"
import { authFetch } from "@/lib/auth"

interface Row {
  ticker: string
  fund_held_try: number
  median_daily_turnover_try: number | null
  days_of_volume: number | null
  fund_count: number
  funds: string[]
}

interface ExitDoorData {
  rows: Row[]
  covered_fund_count: number
  covered_funds: { code: string; fund_size_try: number; size_source: string }[]
  funds_without_size: string[]
  funds_with_stale_size: string[]
  volume_window_days: number
  ready: boolean
}

interface Asset { ticker: string; total_value?: number | null }
interface Portfolio { id: number; assets?: Asset[] | null }

/** Milyar/milyon kısaltması - ham rakamlar 10 haneli ve okunmuyor. */
const TL = (v: number) => {
  const abs = Math.abs(v)
  if (abs >= 1_000_000_000) return `₺${(abs / 1_000_000_000).toLocaleString("tr-TR", { maximumFractionDigits: 2 })} mlr`
  if (abs >= 1_000_000) return `₺${(abs / 1_000_000).toLocaleString("tr-TR", { maximumFractionDigits: 1 })} mn`
  return `₺${abs.toLocaleString("tr-TR", { maximumFractionDigits: 0 })}`
}

// Eşikler SINIFLANDIRMA taşıyor, süs değil. Bir hissede fonların tuttuğu
// pay günlük hacmin 20 katıysa, çıkış haftalar sürer - bu farklı bir
// durum, sadece "biraz daha fazla" değil.
const CROWDED_DAYS = 20
const WATCH_DAYS = 5

const tone = (d: number | null) => {
  if (d == null) return { cls: "text-muted-foreground", bar: "bg-muted-foreground/20", label: "bilinmiyor" }
  if (d >= CROWDED_DAYS) return { cls: "text-bear", bar: "bg-bear/15", label: "dar kapı" }
  if (d >= WATCH_DAYS) return { cls: "val-warn", bar: "bg-warn/15", label: "izle" }
  return { cls: "text-bull", bar: "bg-bull/10", label: "rahat" }
}

const days = (d: number | null) =>
  d == null ? "—" : `${d.toLocaleString("tr-TR", { maximumFractionDigits: 1 })} gün`

export default function ExitDoorPage() {
  const [data, setData] = useState<ExitDoorData | null>(null)
  const [assets, setAssets] = useState<Asset[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    // Hesap arka planda hazirlaniyor (sunucuda ~35 sn surüyor, bkz.
    // crowding_risk.py) - uc hazir degilse `ready: false` donuyor.
    // Kullaniciyi bos ekranda birakmak yerine birkac kez tekrar soruyoruz.
    let alive = true
    let tries = 0
    let timer: ReturnType<typeof setTimeout> | null = null

    const load = () => {
      authFetch("/funds/exit-door")
        .then(res => { if (!res.ok) throw new Error("failed"); return res.json() })
        .then((d: ExitDoorData) => {
          if (!alive) return
          setData(d)
          setError(false)
          setLoading(false)
          if (d.ready === false && tries < 12) {
            tries += 1
            timer = setTimeout(load, 5000)
          }
        })
        .catch(() => { if (alive) { setError(true); setLoading(false) } })
    }
    load()
    return () => { alive = false; if (timer) clearTimeout(timer) }
  }, [])

  useEffect(() => {
    // Portföy ikincil: alınamazsa sayfa yine çalışır, sadece "senin
    // payın" kartı görünmez.
    let alive = true
    authFetch("/portfolio/")
      .then(res => (res.ok ? res.json() : []))
      .then((list: Portfolio[]) => {
        if (!alive || !Array.isArray(list) || list.length === 0) return
        // Portföy sayfasıyla AYNI seçili portföy - iki ekranın farklı
        // portföyü göstermesi kafa karıştırırdı.
        const stored = Number(localStorage.getItem("active_portfolio_id"))
        const active = list.find(p => p.id === stored) || list[0]
        setAssets(active?.assets || [])
      })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  // "Senin payın": portföyündeki hisselerin ne kadarı dar kapıda.
  const mine = useMemo(() => {
    if (!data || assets.length === 0) return null
    const byTicker = new Map(data.rows.map(r => [r.ticker, r]))
    let total = 0
    let crowded = 0
    const hits: { ticker: string; value: number; days: number }[] = []
    for (const a of assets) {
      const value = a.total_value || 0
      if (value <= 0) continue
      total += value
      const row = byTicker.get((a.ticker || "").toUpperCase())
      if (row?.days_of_volume != null && row.days_of_volume >= CROWDED_DAYS) {
        crowded += value
        hits.push({ ticker: row.ticker, value, days: row.days_of_volume })
      }
    }
    if (total <= 0) return null
    return {
      pct: (crowded / total) * 100,
      value: crowded,
      hits: hits.sort((a, b) => b.value - a.value),
    }
  }, [data, assets])

  const maxDays = Math.max(1, ...(data?.rows || []).map(r => r.days_of_volume || 0))

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="t-title flex items-center gap-2">
          <DoorOpen className="h-6 w-6 text-primary" />
          Çıkış Kapısı
        </h1>
        <p className="t-caption mt-1.5">
          Fon Akış Radarı paranın nereye <span className="font-semibold">girdiğini</span> gösteriyor.
          Burası tersini soruyor: bir hisseyi fonlar topluca tutuyorsa ve günlük hacim inceyse,
          satmaya karar verdiklerinde hepsi aynı dar kapıdan çıkmak zorunda kalır.
        </p>
      </div>

      {/* Bu iki uyarı KALDIRILMAMALI. Rakam yanlış okunmaya çok açık:
          (1) yalnızca kompozisyonunu bildiğimiz fonlar sayılıyor, yani
          gerçek kalabalık her zaman daha fazla; (2) "N günlük hacim" bir
          takvim değil, oran. Yazılmazsa kesin bir tahliye süresi sanılır. */}
      <div className="flex items-start gap-2 rounded-lg border border-border/50 bg-secondary/20 px-3 py-2.5">
        <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
        <div className="text-[11px] text-muted-foreground leading-relaxed space-y-1.5">
          <p>
            <span className="font-semibold text-foreground">Bu bir alt sınır.</span>{" "}
            Yalnızca kompozisyonunu bildiğimiz {data?.covered_fund_count ?? 0} fon sayılıyor;
            TEFAS&apos;ta çok daha fazlası var. O hisseyi tutan başka fonlar da olduğu için
            gerçek kalabalık buradaki rakamdan <span className="font-semibold text-foreground">her zaman daha
            fazladır</span>.
          </p>
          <p>
            <span className="font-semibold text-foreground">&quot;20 günlük hacim&quot;, 20 günde
            çıkarlar demek değil.</span>{" "}
            Piyasanın tamamı tek bir satıcı olamaz; günlük hacmin ancak bir kısmını
            kullanabilirler ve satış baskısı hacmi de fiyatı da bozar. Gerçek çıkış bundan
            uzun sürer. Rakam bir oran, takvim değil. Yatırım tavsiyesi değildir.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="py-16 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : error ? (
        <p className="text-sm text-muted-foreground py-8">Veri alınamadı.</p>
      ) : data && data.ready === false ? (
        <Card className="bip-card">
          <CardContent className="py-8 flex items-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin text-primary shrink-0" />
            <div>
              <p className="text-sm font-semibold text-foreground">Hesaplanıyor...</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Onlarca hissenin bir aylık hacim geçmişi taranıyor. Hazır olunca burada
                görünecek &mdash; sayfayı açık bırakman yeterli.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : !data || data.rows.length === 0 ? (
        <Card className="bip-card">
          <CardContent className="py-8">
            <p className="text-sm text-muted-foreground">
              Hesaplanacak veri yok. Bunun için hem fon büyüklüğünün hem de kompozisyonun
              bilinmesi gerekiyor.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {mine && (
            <Card className={`bip-card ${mine.pct >= 25 ? "border-bear/40" : ""}`}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-bold flex items-center gap-2">
                  {mine.pct >= 25 && <AlertTriangle className="h-4 w-4 text-bear" />}
                  Senin Payın
                </CardTitle>
                <CardDescription className="text-xs">
                  Portföyündeki pozisyonların ne kadarı dar kapıda ({CROWDED_DAYS}+ günlük hacim)
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-sm">
                  <span className={`font-mono font-black text-2xl ${mine.pct >= 25 ? "text-bear" : mine.pct >= 10 ? "val-warn" : "text-bull"}`}>
                    %{mine.pct.toLocaleString("tr-TR", { maximumFractionDigits: 1 })}
                  </span>
                  <span className="text-muted-foreground ml-2">({TL(mine.value)})</span>
                </p>
                {mine.hits.length > 0 ? (
                  <div className="space-y-1 pt-1">
                    {mine.hits.map(h => (
                      <div key={h.ticker} className="flex items-center justify-between gap-3 text-xs">
                        <span className="inline-flex items-center gap-1.5">
                          <TickerLogo ticker={h.ticker} size={14} />
                          <span className="font-bold">{h.ticker}</span>
                        </span>
                        <span className="text-muted-foreground font-mono">
                          {TL(h.value)} &middot; <span className="text-bear">{days(h.days)}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Portföyünde dar kapıda görünen hisse yok.
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          <Card className="bip-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-bold">En Dar Kapılar</CardTitle>
              <CardDescription className="text-xs">
                İzlenen fonların tuttuğu TL &divide; son {data.volume_window_days} günün medyan
                günlük hacmi &mdash; en dar olan başta
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {data.rows.map(r => {
                const t = tone(r.days_of_volume)
                const pct = ((r.days_of_volume || 0) / maxDays) * 100
                return (
                  <div key={r.ticker} className="relative rounded-md overflow-hidden">
                    <div className={`absolute inset-y-0 left-0 ${t.bar}`} style={{ width: `${pct}%` }} aria-hidden />
                    <div className="relative flex items-center justify-between gap-3 px-2.5 py-2">
                      <span className="inline-flex items-center gap-2 min-w-0">
                        <TickerLogo ticker={r.ticker} size={16} />
                        <span className="font-bold text-sm truncate">{r.ticker}</span>
                        <span className="text-[10px] text-muted-foreground/70 truncate">
                          {TL(r.fund_held_try)} &middot; {r.funds.join(", ")}
                        </span>
                      </span>
                      <span className="text-right shrink-0">
                        <span className={`font-mono font-bold text-sm ${t.cls}`}>{days(r.days_of_volume)}</span>
                        <span className="block text-[9px] text-muted-foreground/70 leading-none">{t.label}</span>
                      </span>
                    </div>
                  </div>
                )
              })}
            </CardContent>
          </Card>

          <div className="space-y-1 px-1">
            {data.funds_with_stale_size?.length > 0 && (
              /* Bayat büyüklük gizlenmemeli: canlı TEFAS rakamı yerine elle
                 tutulan yedekle hesaplanmış demek, tutar bugünkü değildir. */
              <p className="text-[11px] text-muted-foreground">
                Büyüklüğü canlı TEFAS yerine kayıtlı yedek değerden alınan fonlar
                (tutarlar bugünkü olmayabilir): {data.funds_with_stale_size.join(", ")}
              </p>
            )}
            {data.funds_without_size.length > 0 && (
              <p className="text-[11px] text-muted-foreground">
                Hesaba hiç katılamayan fonlar (büyüklüğü ya da kompozisyonu bilinmiyor):{" "}
                {data.funds_without_size.join(", ")}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  )
}
