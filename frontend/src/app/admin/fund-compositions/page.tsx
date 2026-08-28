"use client"

import React, { useEffect, useMemo, useState } from "react"
import { PieChart, Loader2, ShieldAlert, Plus, Trash2, RotateCcw, Save, AlertTriangle, CheckCircle2, ArrowDownWideNarrow } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card"
import { Button } from "@/components/ui/Button"
import { Input } from "@/components/ui/Input"
import { TickerCombobox } from "@/components/ui/TickerCombobox"
import { authFetch } from "@/lib/auth"

interface FundHolding {
  name: string
  value: number
}

interface FundComposition {
  fund_code: string
  name: string
  fund_size: string | null
  assets_distribution: FundHolding[]
  as_of: string | null
  is_override: boolean
  total_weight_pct: number
}

// Aynı Türkçe ondalık ayracı sorunu (native number input virgülü reddeder) -
// admin/managed-portfolios/page.tsx ve portfolio/page.tsx'teki parseTLAmount
// ile aynı desen.
const parsePct = (raw: string): number => parseFloat(raw.trim().replace(",", "."))

/**
 * Ağırlığı en yüksek varlık en üstte. TEFAS'ın (ve kaydedilmiş
 * override'ların) döndürdüğü sıra keyfi olabiliyor, oysa dağılımı elle
 * ayarlarken önce büyük payları görmek gerekiyor - %0,3'lük bir kalemi
 * kovalarken %22'lik olanı listenin dibinde aramak zaman kaybı.
 *
 * Bilerek SADECE fon açılırken ve "Sırala" tuşuna basınca çalışıyor, her
 * tuş vuruşunda değil: canlı sıralama, kullanıcı bir değeri yazarken
 * satırı imlecinin altından kaydırıp yanlış kutuya yazmasına yol açardı.
 *
 * Henüz sayı girilmemiş (yeni eklenmiş, boş) satırlar en sona düşüyor -
 * yoksa "Satır Ekle" ile açılan boş satır listenin ortasında kaybolurdu.
 */
const sortByWeightDesc = (list: { name: string; value: string }[]) =>
  [...list].sort((a, b) => {
    const av = parsePct(a.value)
    const bv = parsePct(b.value)
    const aOk = Number.isFinite(av)
    const bOk = Number.isFinite(bv)
    if (!aOk && !bOk) return 0
    if (!aOk) return 1
    if (!bOk) return -1
    return bv - av
  })

export default function FundCompositionsPage() {
  const [checkingAccess, setCheckingAccess] = useState(true)
  const [forbidden, setForbidden] = useState(false)

  const [funds, setFunds] = useState<FundComposition[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedCode, setSelectedCode] = useState<string | null>(null)

  const [rows, setRows] = useState<{ name: string; value: string }[]>([])
  const [asOf, setAsOf] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const loadFunds = async () => {
    try {
      const res = await authFetch("/admin/fund-compositions")
      if (res.status === 403) {
        setForbidden(true)
        return
      }
      if (res.ok) {
        const data: FundComposition[] = await res.json()
        setFunds(data)
        if (!selectedCode && data.length > 0) {
          selectFund(data[0])
        }
      }
    } catch (e) {
      setError("Sunucuya ulaşılamadı.")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    authFetch("/auth/me")
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (!data?.is_superuser) {
          setForbidden(true)
          return
        }
        return loadFunds()
      })
      .catch(() => setForbidden(true))
      .finally(() => setCheckingAccess(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const selectFund = (f: FundComposition) => {
    setSelectedCode(f.fund_code)
    setRows(sortByWeightDesc(f.assets_distribution.map(h => ({ name: h.name, value: String(h.value).replace(".", ",") }))))
    setAsOf(f.as_of || "")
    setError(null)
  }

  const selected = funds.find(f => f.fund_code === selectedCode) || null

  const runningTotal = useMemo(() => {
    return rows.reduce((sum, r) => {
      const v = parsePct(r.value)
      return sum + (Number.isFinite(v) ? v : 0)
    }, 0)
  }, [rows])

  // Gerçek bir TEFAS kompozisyonu da her zaman tam %100 olmaz (nakit/tahvil
  // gibi sayılmayan kalan pay yüzünden) - bu yüzden kaydetmeyi ENGELLEMİYORUZ,
  // sadece belirgin bir sapmayı (>±3 puan) görsel olarak uyarıyoruz, ki bir
  // yazım hatası ("105" yazıp "10,5" demek istemek gibi) fark edilsin.
  const totalIsOff = Math.abs(runningTotal - 100) > 3

  const updateRow = (idx: number, field: "name" | "value", val: string) => {
    setRows(prev => prev.map((r, i) => (i === idx ? { ...r, [field]: field === "name" ? val.toUpperCase() : val } : r)))
  }

  const addRow = () => setRows(prev => [...prev, { name: "", value: "" }])
  const removeRow = (idx: number) => setRows(prev => prev.filter((_, i) => i !== idx))

  const save = async () => {
    if (!selectedCode) return
    const cleaned = rows
      .map(r => ({ name: r.name.trim(), value: parsePct(r.value) }))
      .filter(r => r.name)
    if (cleaned.length === 0) {
      setError("En az bir varlık girilmeli.")
      return
    }
    if (cleaned.some(r => !Number.isFinite(r.value) || r.value < 0)) {
      setError("Tüm ağırlıklar geçerli, negatif olmayan bir sayı olmalı - örn. 12,5")
      return
    }
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const res = await authFetch(`/admin/fund-compositions/${selectedCode}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assets_distribution: cleaned,
          as_of: asOf || null,
        }),
      })
      const body = await res.json().catch(() => null)
      if (res.ok) {
        setNotice("Kaydedildi - değişiklik anında etkin.")
        setTimeout(() => setNotice(null), 5000)
        await loadFunds()
      } else {
        setError(body?.detail || "Kaydedilemedi.")
      }
    } catch (e) {
      setError("Sunucuya ulaşılamadı.")
    } finally {
      setSaving(false)
    }
  }

  const resetToDefault = async () => {
    if (!selectedCode) return
    if (!window.confirm(`${selectedCode} için yapılan özel ayarlamalar silinecek ve varsayılan kompozisyona dönülecek. Emin misiniz?`)) return
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const res = await authFetch(`/admin/fund-compositions/${selectedCode}`, { method: "DELETE" })
      const body = await res.json().catch(() => null)
      if (res.ok) {
        setNotice("Varsayılana döndürüldü.")
        setTimeout(() => setNotice(null), 5000)
        await loadFunds()
        const refreshedRes = await authFetch(`/admin/fund-compositions/${selectedCode}`)
        if (refreshedRes.ok) selectFund(await refreshedRes.json())
      } else {
        setError(body?.detail || "Sıfırlanamadı.")
      }
    } catch (e) {
      setError("Sunucuya ulaşılamadı.")
    } finally {
      setSaving(false)
    }
  }

  if (checkingAccess) {
    return (
      <div className="flex flex-col items-center justify-center py-48 space-y-4">
        <Loader2 className="h-10 w-10 text-primary animate-spin" />
        <span className="text-sm text-muted-foreground font-semibold">Yükleniyor...</span>
      </div>
    )
  }

  if (forbidden) {
    return (
      <div className="flex flex-col items-center justify-center py-48 space-y-4 text-center">
        <ShieldAlert className="h-10 w-10 text-bear" />
        <span className="text-sm text-muted-foreground font-semibold">Bu sayfaya erişim yetkiniz yok.</span>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight flex items-center gap-2">
          <PieChart className="h-7 w-7 text-primary" />
          Fon Ağırlık Ayarlamaları
        </h1>
        <p className="t-caption mt-1.5">
          &quot;Popüler Fonlar - Anlık Getiri&quot; tahmininde kullanılan varlık ağırlıklarını buradan güncelleyin -
          kaydettiğiniz an devreye girer, kod değişikliği veya yeniden dağıtım gerekmez.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-bear/30 bg-bear/10 px-4 py-3 text-sm font-semibold text-bear flex items-center justify-between gap-3">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-bear/70 hover:text-bear cursor-pointer shrink-0">✕</button>
        </div>
      )}
      {notice && (
        <div className="rounded-lg border border-bull/30 bg-bull/10 px-4 py-3 text-sm font-semibold text-bull flex items-center justify-between gap-3">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="text-bull/70 hover:text-bull cursor-pointer shrink-0">✕</button>
        </div>
      )}

      {loading ? (
        <div className="py-24 flex justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          {/* Fon listesi */}
          <Card glass={true} className="lg:col-span-1 h-fit">
            <CardHeader>
              <CardTitle className="text-sm">Fonlar</CardTitle>
            </CardHeader>
            <CardContent className="p-2 space-y-1">
              {funds.map(f => (
                <button
                  key={f.fund_code}
                  onClick={() => selectFund(f)}
                  className={`w-full text-left px-3 py-2.5 rounded-lg text-xs transition-colors cursor-pointer ${
                    selectedCode === f.fund_code
                      ? "bg-primary/15 border border-primary/40 text-primary"
                      : "border border-transparent hover:bg-secondary/40 text-foreground"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-black">{f.fund_code}</span>
                    {f.is_override && (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-warn/10 text-warn border border-warn/20 uppercase shrink-0">
                        Özel
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-muted-foreground truncate mt-0.5">{f.name}</div>
                </button>
              ))}
            </CardContent>
          </Card>

          {/* Seçili fonun düzenleme formu */}
          <Card glass={true} className="lg:col-span-3">
            {!selected ? (
              <CardContent className="py-16 text-center text-sm text-muted-foreground">
                Düzenlemek için soldan bir fon seçin.
              </CardContent>
            ) : (
              <>
                <CardHeader>
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <div>
                      <CardTitle className="t-section flex items-center gap-2">
                        {selected.fund_code}
                        {selected.is_override ? (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-warn/10 text-warn border border-warn/20 uppercase">
                            Özel Ayarlanmış
                          </span>
                        ) : (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-secondary/60 text-muted-foreground border border-border/40 uppercase">
                            Varsayılan
                          </span>
                        )}
                      </CardTitle>
                      <CardDescription>{selected.name}{selected.fund_size ? ` · ${selected.fund_size}` : ""}</CardDescription>
                    </div>
                    <div
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border ${
                        totalIsOff
                          ? "bg-bear/10 text-bear border-bear/30"
                          : "bg-bull/10 text-bull border-bull/30"
                      }`}
                    >
                      {totalIsOff ? <AlertTriangle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                      Toplam: {runningTotal.toFixed(1)}%
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {totalIsOff && (
                    <p className="text-[11px] text-bear/90 bg-bear/5 border border-bear/20 rounded-lg px-3 py-2">
                      Toplam %100&apos;den belirgin şekilde sapmış - gerçek bir TEFAS kompozisyonu da tam %100 olmayabilir
                      (nakit/tahvil gibi sayılmayan pay yüzünden), ama büyük bir sapma genelde bir yazım hatasıdır.
                      Yine de kaydedebilirsiniz, engellenmiyor.
                    </p>
                  )}

                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">
                      Varlık / Ağırlık
                    </span>
                    {/* Fon açılırken liste zaten sıralı geliyor; bu tuş,
                        elle değer değiştirdikten sonra sırayı tazelemek
                        için - her tuş vuruşunda otomatik sıralamamamızın
                        sebebi sortByWeightDesc'in başındaki nota bakın. */}
                    <button
                      type="button"
                      onClick={() => setRows(prev => sortByWeightDesc(prev))}
                      disabled={rows.length < 2}
                      className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md border border-border/40 bg-secondary/30 text-[10px] font-bold text-muted-foreground hover:text-foreground hover:border-border disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
                    >
                      <ArrowDownWideNarrow className="h-3 w-3" />
                      Ağırlığa göre sırala
                    </button>
                  </div>

                  <div className="space-y-1.5">
                    {rows.map((r, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <TickerCombobox
                          value={r.name}
                          onChange={v => updateRow(idx, "name", v)}
                          placeholder="THYAO (ya da Nakit/Ters Repo gibi bir kategori)"
                          className="flex-1"
                          inputClassName="h-8 text-xs"
                        />
                        <div className="relative w-28 shrink-0">
                          <Input
                            type="text"
                            inputMode="decimal"
                            value={r.value}
                            onChange={e => updateRow(idx, "value", e.target.value)}
                            placeholder="12,5"
                            className="h-8 text-xs pr-6"
                          />
                          <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground pointer-events-none">%</span>
                        </div>
                        <button
                          onClick={() => removeRow(idx)}
                          title="Satırı kaldır"
                          className="h-8 w-8 shrink-0 inline-flex items-center justify-center rounded-md border border-border/40 bg-secondary/30 text-muted-foreground hover:text-bear hover:border-bear/30 cursor-pointer transition-colors"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                    <button
                      onClick={addRow}
                      className="w-full h-8 rounded-md border border-dashed border-border/50 text-[11px] font-bold text-muted-foreground hover:text-foreground hover:border-border cursor-pointer flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Satır Ekle
                    </button>
                  </div>

                  <div className="flex items-end gap-3 pt-2 border-t border-border/30">
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-muted-foreground">Referans Tarihi (opsiyonel)</label>
                      <input
                        type="date"
                        value={asOf}
                        onChange={e => setAsOf(e.target.value)}
                        className="h-8 rounded-md border border-input bg-secondary/50 px-2 text-xs focus-visible:outline-none"
                      />
                    </div>
                    <p className="text-[10px] text-muted-foreground/80 leading-snug pb-1.5 max-w-xs">
                      Ağırlıkların hangi tarih itibarıyla geçerli olduğu - gün içi fiyat sürüklenmesi düzeltmesi için kullanılır, boş bırakılabilir.
                    </p>
                  </div>

                  <div className="flex items-center gap-2 pt-2">
                    <Button
                      type="button"
                      onClick={save}
                      disabled={saving}
                      className="cursor-pointer bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-bold"
                    >
                      {saving ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
                      Kaydet
                    </Button>
                    {selected.is_override && (
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={resetToDefault}
                        disabled={saving}
                        className="cursor-pointer bg-bear hover:bg-bear/90 text-white hover:text-white text-xs font-bold"
                      >
                        <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                        Varsayılana Döndür
                      </Button>
                    )}
                  </div>
                </CardContent>
              </>
            )}
          </Card>
        </div>
      )}
    </div>
  )
}
