"use client"

import React, { useEffect, useState } from "react"
import {
  Loader2, ShieldAlert, Split, AlertTriangle, CheckCircle2,
  ExternalLink, Eye, Play, RefreshCw,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card"
import { Button } from "@/components/ui/Button"
import { TickerLogo } from "@/components/ui/TickerLogo"
import { authFetch } from "@/lib/auth"

interface ActionRow {
  ticker: string
  ratio: number
  ex_date: string
  description: string
  affected_count: number
  total_positions: number
}

interface PlanRow {
  user_id: number | null
  user_email: string | null
  asset_id: number
  portfolio_id: number
  current_shares: number
  current_average_cost: number
  new_shares: number
  new_average_cost: number
  applicable: boolean
  reason: string | null
}

interface Preview {
  ticker: string
  ratio: number
  ex_date: string
  description: string
  plans: PlanRow[]
}

interface Candidate {
  ticker: string
  title: string | null
  publish_date: string | null
  link: string
  suggested_ratio: number | null
  already_registered: boolean
}

const num = (v: number, digits = 4) =>
  v.toLocaleString("tr-TR", { minimumFractionDigits: 0, maximumFractionDigits: digits })

const fmtDate = (v: string | null) => {
  if (!v) return "—"
  const d = new Date(v)
  return isNaN(d.getTime()) ? v : d.toLocaleDateString("tr-TR")
}

export default function CorporateActionsPage() {
  const [actions, setActions] = useState<ActionRow[]>([])
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)

  const [preview, setPreview] = useState<Preview | null>(null)
  const [previewing, setPreviewing] = useState<string | null>(null)
  const [applying, setApplying] = useState(false)
  // Uygulamak geri alinamaz (lot ve ortalama maliyet degisiyor, deftere
  // BONUS hareketi yaziliyor) - bu yuzden tek tikla degil, ayri bir onay
  // adimiyla.
  const [confirming, setConfirming] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const [aRes, cRes] = await Promise.all([
        authFetch("/admin/corporate-actions"),
        authFetch("/admin/corporate-actions/kap-candidates?days=45"),
      ])
      if (aRes.status === 401 || aRes.status === 403) { setForbidden(true); return }
      if (aRes.ok) setActions((await aRes.json()).actions || [])
      // KAP adaylari ikincil - KAP tablosu bos ya da uc hata verse bile
      // bilinen islemler listesi gosterilmeye devam etsin.
      if (cRes.ok) setCandidates((await cRes.json()).candidates || [])
    } catch {
      setError("Veriler alinamadi.")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const fetchPreview = async (ticker: string) => {
    setPreviewing(ticker)
    try {
      const res = await authFetch(`/admin/corporate-actions/${ticker}/preview`)
      if (!res.ok) { setError("Onizleme alinamadi."); return }
      setPreview(await res.json())
    } catch {
      setError("Onizleme alinamadi.")
    } finally {
      setPreviewing(null)
    }
  }

  const openPreview = async (ticker: string) => {
    setPreview(null)
    setConfirming(false)
    setNotice(null)
    setError(null)
    await fetchPreview(ticker)
  }

  const apply = async () => {
    if (!preview) return
    setApplying(true)
    setError(null)
    try {
      const res = await authFetch(`/admin/corporate-actions/${preview.ticker}/apply`, { method: "POST" })
      if (!res.ok) {
        const d = await res.json().catch(() => null)
        setError(d?.detail || "Uygulanamadi.")
        return
      }
      const d = await res.json()
      setNotice(
        `${d.ticker}: ${d.applied_count} pozisyon guncellendi` +
        (d.skipped_count ? `, ${d.skipped_count} pozisyon atlandi (zaten uygulanmis ya da kapsam disi).` : ".")
      )
      setConfirming(false)
      // Uc'un dondugu planlar uygulamadan ONCEKI hesap (plan_adjustments
      // mutasyondan once calisiyor), yani "uygulanacak" diyorlar. Onlari
      // oldugu gibi ekrana basmak uygulanmis bir islemi hala bekliyormus
      // gibi gosterirdi - onizlemeyi sunucudan yeniden aliyoruz, boylece
      // satirlar "Zaten uygulanmis" gerekcesiyle donuyor.
      // ...ama basari mesaji ekranda kalmali, o yuzden openPreview degil
      // (o notice'i temizliyor).
      fetchPreview(preview.ticker)
      load()
    } catch {
      setError("Uygulanamadi.")
    } finally {
      setApplying(false)
    }
  }

  if (loading) {
    return <div className="p-6 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
  }

  if (forbidden) {
    return (
      <div className="p-6 max-w-lg mx-auto">
        <Card className="bip-card">
          <CardContent className="py-8 flex items-start gap-3">
            <ShieldAlert className="h-5 w-5 text-bear shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-bold text-foreground">Bu sayfaya erisim yetkiniz yok.</p>
              <p className="text-xs text-muted-foreground mt-1">Kurumsal islemler yalnizca yoneticilere aciktir.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  const newCandidates = candidates.filter(c => !c.already_registered)

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-5xl mx-auto">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="t-title flex items-center gap-2">
            <Split className="h-6 w-6 text-primary" />
            Kurumsal Islemler
          </h1>
          <p className="t-caption mt-1.5">
            Bedelsiz sermaye artirimi ve hisse bolunmesi. Oran uygulaninca lot artar, ortalama
            maliyet ayni oranda duser &mdash; toplam maliyet degismez.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} className="shrink-0">
          <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Yenile
        </Button>
      </div>

      {notice && (
        <div className="flex items-start gap-2 rounded-lg border border-bull/40 bg-bull/10 px-3 py-2.5">
          <CheckCircle2 className="h-4 w-4 text-bull shrink-0 mt-0.5" />
          <p className="text-xs text-foreground">{notice}</p>
        </div>
      )}
      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-bear/40 bg-bear/10 px-3 py-2.5">
          <AlertTriangle className="h-4 w-4 text-bear shrink-0 mt-0.5" />
          <p className="text-xs text-foreground">{error}</p>
        </div>
      )}

      <Card className="bip-card">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-bold">Tanimli Islemler</CardTitle>
          <CardDescription className="text-xs">
            Kodda tanimli (corporate_actions.py) islemler ve her birinin kac pozisyonu etkileyecegi
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {actions.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">Tanimli kurumsal islem yok.</p>
          ) : actions.map(a => (
            <div key={a.ticker} className="rounded-lg border border-border/50 bg-secondary/20 p-3 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <span className="inline-flex items-center gap-2">
                    <TickerLogo ticker={a.ticker} size={18} />
                    <span className="font-bold text-sm">{a.ticker}</span>
                    <span className="font-mono text-xs val-warn font-bold">{num(a.ratio)}x</span>
                    <span className="text-[10px] text-muted-foreground">
                      ex: {fmtDate(a.ex_date)}
                    </span>
                  </span>
                  <p className="text-[11px] text-muted-foreground mt-1">{a.description}</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  disabled={previewing === a.ticker}
                  onClick={() => openPreview(a.ticker)}
                >
                  {previewing === a.ticker
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <><Eye className="h-3.5 w-3.5 mr-1.5" /> Onizle</>}
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                {a.total_positions} pozisyon bulundu &middot;{" "}
                <span className={a.affected_count > 0 ? "val-warn font-bold" : ""}>
                  {a.affected_count} tanesi bekliyor
                </span>
                {a.affected_count === 0 && a.total_positions > 0 && " (hepsi uygulanmis)"}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>

      {preview && (
        <Card className="bip-card border-primary/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <TickerLogo ticker={preview.ticker} size={16} />
              {preview.ticker} &mdash; {num(preview.ratio)}x onizleme
            </CardTitle>
            <CardDescription className="text-xs">
              Bu tablo hicbir seyi degistirmedi. Asagidaki tuslar degistirir.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {preview.plans.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Bu hisseyi tasiyan pozisyon yok &mdash; uygulanacak bir sey bulunmuyor.
              </p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="text-muted-foreground border-b border-border/40">
                      <tr className="h-8">
                        <th className="px-2 text-left font-bold">Kullanici</th>
                        <th className="px-2 text-right font-bold whitespace-nowrap">Lot</th>
                        <th className="px-2 text-right font-bold whitespace-nowrap">Ort. Maliyet</th>
                        <th className="px-2 text-left font-bold">Durum</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.plans.map(p => (
                        <tr key={p.asset_id} className="border-b border-border/20">
                          <td className="px-2 py-2 text-muted-foreground truncate max-w-[14rem]">
                            {p.user_email || (p.user_id != null ? `#${p.user_id}` : `portfoy #${p.portfolio_id}`)}
                          </td>
                          <td className="px-2 py-2 text-right font-mono whitespace-nowrap">
                            {num(p.current_shares)}
                            {p.applicable && (
                              <span className="text-bull font-bold"> &rarr; {num(p.new_shares)}</span>
                            )}
                          </td>
                          <td className="px-2 py-2 text-right font-mono whitespace-nowrap">
                            {num(p.current_average_cost)}
                            {p.applicable && (
                              <span className="text-bear font-bold"> &rarr; {num(p.new_average_cost)}</span>
                            )}
                          </td>
                          <td className="px-2 py-2">
                            {p.applicable ? (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded border border-warn/40 bg-warn/10 val-warn whitespace-nowrap">
                                uygulanacak
                              </span>
                            ) : (
                              <span className="text-[10px] text-muted-foreground/80">
                                {p.reason || "atlanacak"}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {preview.plans.some(p => p.applicable) && (
                  confirming ? (
                    <div className="rounded-lg border border-bear/40 bg-bear/10 p-3 space-y-2.5">
                      <p className="text-xs text-foreground">
                        <span className="font-bold">Geri alinamaz.</span>{" "}
                        {preview.plans.filter(p => p.applicable).length} pozisyonun lot sayisi ve
                        ortalama maliyeti degisecek, her biri icin deftere BONUS hareketi yazilacak.
                        Devam edilsin mi?
                      </p>
                      <div className="flex gap-2">
                        <Button size="sm" variant="destructive" disabled={applying} onClick={apply}>
                          {applying
                            ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Uygulaniyor</>
                            : <><Play className="h-3.5 w-3.5 mr-1.5" /> Evet, uygula</>}
                        </Button>
                        <Button size="sm" variant="ghost" disabled={applying} onClick={() => setConfirming(false)}>
                          Vazgec
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button size="sm" onClick={() => setConfirming(true)}>
                      <Play className="h-3.5 w-3.5 mr-1.5" />
                      {preview.plans.filter(p => p.applicable).length} pozisyona uygula
                    </Button>
                  )
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      <Card className="bip-card">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-bold">KAP Adaylari</CardTitle>
          <CardDescription className="text-xs">
            Son 45 gunun KAP bildirimlerinde bedelsiz/bolunme gecen hisseler
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {/* Bu uyari KALDIRILMAMALI: oran serbest metinden regex'le
              tahmin ediliyor ve KAP metinleri standart degil. Yanlis oran
              uygulanmasi pozisyonu geri donusu zor sekilde bozar - o yuzden
              buradan hicbir sey uygulanamiyor, sadece "bak" diyor. */}
          <div className="flex items-start gap-2 rounded-lg border border-border/50 bg-secondary/20 px-3 py-2.5">
            <AlertTriangle className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Onerilen oran serbest metinden <span className="font-semibold text-foreground">tahmin</span>{" "}
              edildigi icin yanlis olabilir. Buradan hicbir sey uygulanamaz: dogrulandiktan sonra{" "}
              <code className="font-mono">corporate_actions.py</code>&apos;deki{" "}
              <code className="font-mono">CORPORATE_ACTIONS</code> listesine bir satir eklenmesi gerekiyor.
            </p>
          </div>

          {candidates.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">
              Bu aralikta bedelsiz/bolunme geçen KAP bildirimi yok.
            </p>
          ) : (
            <>
              {newCandidates.length === 0 && (
                <p className="text-xs text-muted-foreground py-1">
                  Yeni aday yok &mdash; bulunanlarin hepsi zaten tanimli.
                </p>
              )}
              {candidates.map(c => (
                <div
                  key={c.ticker}
                  className={`flex items-start justify-between gap-3 rounded-lg border p-2.5 ${
                    c.already_registered
                      ? "border-border/40 bg-secondary/10 opacity-60"
                      : "border-warn/40 bg-warn/5"
                  }`}
                >
                  <div className="min-w-0">
                    <span className="inline-flex items-center gap-2">
                      <TickerLogo ticker={c.ticker} size={16} />
                      <span className="font-bold text-xs">{c.ticker}</span>
                      {c.suggested_ratio != null && (
                        <span className="font-mono text-[11px] val-warn font-bold">
                          ~{num(c.suggested_ratio)}x
                        </span>
                      )}
                      {c.already_registered && (
                        <span className="text-[10px] text-muted-foreground">tanimli</span>
                      )}
                    </span>
                    <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2">
                      {c.title || "—"}
                    </p>
                    <p className="text-[10px] text-muted-foreground/70 mt-0.5">
                      {fmtDate(c.publish_date)}
                    </p>
                  </div>
                  <a
                    href={c.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline"
                  >
                    KAP <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              ))}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
