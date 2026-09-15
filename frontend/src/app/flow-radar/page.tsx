"use client"

import React, { useEffect, useState } from "react"
import { Loader2, Radar as RadarIcon, Info, ArrowUpRight, ArrowDownRight } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card"
import { TickerLogo } from "@/components/ui/TickerLogo"
import { authFetch } from "@/lib/auth"

interface FundRow { code: string; net_flow_try: number; last_date: string | null; resolved_pct: number }
interface Row { ticker: string; implied_flow_try: number }
interface RadarData {
  days: number
  covered_fund_count: number
  net_flow_total_try: number | null
  from_date: string | null
  to_date: string | null
  day_count: number
  funds: FundRow[]
  stocks: Row[]
  other: Row[]
}

/** Milyar/milyon kısaltması - ham rakamlar 10 haneli ve okunmuyor. */
const TL = (v: number) => {
  const abs = Math.abs(v)
  const sign = v < 0 ? "−" : "+"
  if (abs >= 1_000_000_000) return `${sign}₺${(abs / 1_000_000_000).toLocaleString("tr-TR", { maximumFractionDigits: 2 })} mlr`
  if (abs >= 1_000_000) return `${sign}₺${(abs / 1_000_000).toLocaleString("tr-TR", { maximumFractionDigits: 1 })} mn`
  return `${sign}₺${abs.toLocaleString("tr-TR", { maximumFractionDigits: 0 })}`
}

const RANGES = [
  { days: 1, label: "Gunluk" },
  { days: 7, label: "Haftalik" },
  { days: 30, label: "Aylik" },
]

const D = (v: string | null) => {
  if (!v) return "—"
  const d = new Date(v + "T00:00:00")
  return isNaN(d.getTime())
    ? v
    : d.toLocaleDateString("tr-TR", { day: "numeric", month: "long" })
}

/** "15 Eylul" ya da "9 Eylul – 15 Eylul" - tek gunluk aralikta tekrar etmesin. */
const rangeLabel = (d: RadarData) => {
  if (!d.to_date) return null
  if (!d.from_date || d.from_date === d.to_date) return D(d.to_date)
  return `${D(d.from_date)} – ${D(d.to_date)}`
}

export default function FlowRadarPage() {
  const [data, setData] = useState<RadarData | null>(null)
  const [days, setDays] = useState(7)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let alive = true
    setLoading(true)
    authFetch(`/funds/flow-radar?days=${days}`)
      .then(res => { if (!res.ok) throw new Error("failed"); return res.json() })
      .then(d => { if (alive) { setData(d); setError(false) } })
      .catch(() => { if (alive) setError(true) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [days])

  // Cubuk genisligi en buyuk MUTLAK degere gore - boylece buyuk bir cikis da
  // buyuk bir giris kadar belirgin gorunuyor.
  const maxAbs = Math.max(1, ...(data?.stocks || []).map(s => Math.abs(s.implied_flow_try)))

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="t-title flex items-center gap-2">
          <RadarIcon className="h-6 w-6 text-primary" />
          Fon Akis Radari
        </h1>
        <p className="t-caption mt-1.5">
          Fonlara giren paranin hangi hisseye gittigi. TEFAS fon akislarini yayinliyor ama o
          paranin nereye dagildigini gostermiyor &mdash; bunun icin fonun icini bilmek gerekiyor.
        </p>
      </div>

      {/* Bu uyari KALDIRILMAMALI: rakam ima edilen baskidir, kanitlanmis alim
          degil. Varsayim, fonun yeni parayi mevcut agirliklarina gore
          dagittigi. Yazilmazsa kesin veri sanilir. */}
      <div className="flex items-start gap-2 rounded-lg border border-border/50 bg-secondary/20 px-3 py-2.5">
        <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Bu rakamlar <span className="font-semibold text-foreground">ima edilen</span> alim
          baskisidir, kanitlanmis alim degildir. Hesap, fonun yeni parayi mevcut agirliklarina
          gore dagittigini varsayar; fon parayi nakitte bekletebilir ya da kompozisyon disi bir
          varlik alabilir. Yatirim tavsiyesi degildir.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {RANGES.map(r => (
          <button
            key={r.days}
            onClick={() => setDays(r.days)}
            className={`press h-8 px-3 rounded-md text-xs font-bold cursor-pointer transition-colors ${
              days === r.days
                ? "bg-primary text-primary-foreground"
                : "bg-secondary/40 text-muted-foreground hover:text-foreground"
            }`}
          >
            {r.label}
          </button>
        ))}
        {/* Hangi gunleri kapsadigi yaziliyor: TEFAS hafta sonu yayin
            yapmadigi icin "Haftalik" secimi cogu zaman 5 gun demek, ve
            verinin bayatlayip bayatlamadigini ancak tarih gosterirse
            anlasilir. */}
        {data && !loading && data.to_date && (
          <span className="ml-1 text-[11px] text-muted-foreground">
            {rangeLabel(data)}
            {data.day_count > 1 ? ` · ${data.day_count} veri gunu` : ""}
          </span>
        )}
      </div>

      {loading ? (
        <div className="py-16 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : error ? (
        <p className="text-sm text-muted-foreground py-8">Veri alinamadi.</p>
      ) : !data || data.covered_fund_count === 0 ? (
        <Card className="bip-card">
          <CardContent className="py-8">
            <p className="text-sm text-muted-foreground">
              Bu aralikta kayitli fon akisi yok. Akis gecmisi 10 Eylul 2026&apos;da birikmeye
              basladi &mdash; geriye donuk veri bulunmuyor, seri her gun uzuyor.
              {data?.to_date && (
                <> Elimizdeki en taze kayit: <span className="font-semibold text-foreground">{D(data.to_date)}</span>.</>
              )}
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card className="bip-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-bold">Fonlara Net Akis</CardTitle>
              <CardDescription className="text-xs">
                {data.covered_fund_count} fon &middot; yalnizca kompozisyonu bilinenler
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {data.funds.map(f => (
                <div key={f.code} className="flex items-center justify-between gap-3 text-sm">
                  <span className="inline-flex items-center gap-1.5 min-w-0">
                    <TickerLogo ticker={f.code} size={16} />
                    <span className="font-bold">{f.code}</span>
                    <span className="text-[10px] text-muted-foreground/70">
                      kapsam %{f.resolved_pct.toFixed(0)}
                    </span>
                  </span>
                  <span className={`font-mono font-bold ${f.net_flow_try >= 0 ? "text-bull" : "text-bear"}`}>
                    {TL(f.net_flow_try)}
                  </span>
                </div>
              ))}
              {data.net_flow_total_try != null && (
                <div className="flex items-center justify-between gap-3 text-sm pt-2 border-t border-border/40">
                  <span className="font-bold text-muted-foreground">TOPLAM</span>
                  <span className={`font-mono font-black ${data.net_flow_total_try >= 0 ? "text-bull" : "text-bear"}`}>
                    {TL(data.net_flow_total_try)}
                  </span>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="bip-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-bold">Bu Paranin Gittigi Hisseler</CardTitle>
              <CardDescription className="text-xs">
                Fon akisi &times; hissenin fondaki agirligi, tum fonlar toplanarak
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {data.stocks.map(s => {
                const up = s.implied_flow_try >= 0
                const pct = (Math.abs(s.implied_flow_try) / maxAbs) * 100
                return (
                  <div key={s.ticker} className="relative rounded-md overflow-hidden">
                    <div
                      className={`absolute inset-y-0 left-0 ${up ? "bg-bull/10" : "bg-bear/10"}`}
                      style={{ width: `${pct}%` }}
                      aria-hidden
                    />
                    <div className="relative flex items-center justify-between gap-3 px-2.5 py-2 text-sm">
                      <span className="inline-flex items-center gap-2 min-w-0">
                        <TickerLogo ticker={s.ticker} size={16} />
                        <span className="font-bold truncate">{s.ticker}</span>
                      </span>
                      <span className={`font-mono font-bold inline-flex items-center gap-1 shrink-0 ${up ? "text-bull" : "text-bear"}`}>
                        {up ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
                        {TL(s.implied_flow_try)}
                      </span>
                    </div>
                  </div>
                )
              })}
            </CardContent>
          </Card>

          {data.other.length > 0 && (
            <Card className="bip-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-bold">Hisse Disi Kalemler</CardTitle>
                <CardDescription className="text-xs">
                  Turev (VIOP), sabit getiri ve kompozisyonu acilamayan fonlar &mdash; hisseye
                  giden para rakamini sisirmemesi icin ayri gosteriliyor
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {data.other.map(o => (
                  <div key={o.ticker} className="flex items-center justify-between gap-3 text-sm px-0.5">
                    <span className="font-bold text-muted-foreground">{o.ticker}</span>
                    <span className={`font-mono font-semibold ${o.implied_flow_try >= 0 ? "text-bull/80" : "text-bear/80"}`}>
                      {TL(o.implied_flow_try)}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
