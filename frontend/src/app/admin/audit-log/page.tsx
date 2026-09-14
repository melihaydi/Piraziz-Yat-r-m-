"use client"

import React, { useEffect, useMemo, useState } from "react"
import { Loader2, ScrollText, ShieldAlert, Search } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card"
import { Input } from "@/components/ui/Input"
import { authFetch } from "@/lib/auth"

interface AuditRow {
  id: number
  user_id: number | null
  action: string
  resource_type: string | null
  resource_id: string | number | null
  details: Record<string, unknown> | null
  ip_address: string | null
  created_at: string | null
}

/**
 * Denetim kaydi ekrani.
 *
 * Backend /admin/audit-log ucu ve AuditLog modeli vardi ama HIC ARAYUZU
 * YOKTU: her kritik islem (rol degisikligi, 2FA sifirlama, emir, yonetilen
 * portfoy mudahalesi) kaydediliyor ama kimse goremiyordu. Okunamayan bir
 * denetim kaydinin varligi anlamsiz.
 */

// Backend'deki log_audit cagrilarinin tam listesi (grep ile cikarildi).
// Statik tutuluyor cunku filtre SUNUCU tarafinda calisiyor: yalnizca
// getirilen sayfada gorulen eylemleri listelemek, tabloda olan ama son 300
// kayda girmeyen bir eylemi filtrelenemez hale getirirdi.
const KNOWN_ACTIONS = [
  "login_success", "login_failed", "google_login", "google_signup",
  "password_reset", "recovery_code_used", "admin_password_reset_triggered",
  "admin_2fa_reset", "role_change", "account_deleted", "admin_account_deleted",
  "order_placed", "order_cancelled", "corporate_action_applied",
  "fund_composition_updated", "fund_composition_reset",
  "managed_portfolio_asset_added", "managed_portfolio_asset_removed",
  "managed_portfolio_asset_updated", "managed_portfolio_cash_adjusted",
  "managed_portfolio_usd_cash_adjusted", "managed_portfolio_viop_margin_adjusted",
] as const

const ACTION_LABEL: Record<string, string> = {
  login_success: "Giris basarili",
  login_failed: "Giris basarisiz",
  google_login: "Google girisi",
  google_signup: "Google ile kayit",
  password_reset: "Sifre sifirlandi",
  recovery_code_used: "Kurtarma kodu kullanildi",
  admin_password_reset_triggered: "Admin sifre sifirlama baslatti",
  admin_2fa_reset: "Admin 2FA sifirladi",
  role_change: "Rol degisikligi",
  account_deleted: "Hesap silindi",
  admin_account_deleted: "Admin hesap sildi",
  order_placed: "Emir verildi",
  order_cancelled: "Emir iptal edildi",
  corporate_action_applied: "Kurumsal islem uygulandi",
  fund_composition_updated: "Fon agirligi guncellendi",
  fund_composition_reset: "Fon agirligi varsayilana dondu",
  managed_portfolio_asset_added: "Yonetilen portfoye varlik eklendi",
  managed_portfolio_asset_removed: "Yonetilen portfoyden varlik silindi",
  managed_portfolio_asset_updated: "Yonetilen portfoy varligi guncellendi",
  managed_portfolio_cash_adjusted: "Yonetilen portfoy nakdi degisti",
  managed_portfolio_usd_cash_adjusted: "Yonetilen portfoy dovizi degisti",
  managed_portfolio_viop_margin_adjusted: "Yonetilen portfoy VIOP teminati degisti",
}

// Renk SINIFLANDIRMA tasiyor, sus degil: kirmizi = guvenlik kaybi ya da geri
// alinamaz silme, kehribar = yetki degisikligi veya baskasinin portfoyune
// mudahale. Geri kalan (giris, emir) notr.
const BEAR_ACTIONS = new Set([
  "login_failed", "account_deleted", "admin_account_deleted", "admin_2fa_reset",
])
const WARN_ACTIONS = new Set([
  "recovery_code_used", "role_change", "password_reset",
  "admin_password_reset_triggered", "corporate_action_applied",
  "fund_composition_updated", "fund_composition_reset",
  "managed_portfolio_asset_added", "managed_portfolio_asset_removed",
  "managed_portfolio_asset_updated", "managed_portfolio_cash_adjusted",
  "managed_portfolio_usd_cash_adjusted", "managed_portfolio_viop_margin_adjusted",
])

const toneClass = (action: string) => {
  if (BEAR_ACTIONS.has(action)) return "border-bear/40 bg-bear/10 text-bear"
  if (WARN_ACTIONS.has(action)) return "border-warn/40 bg-warn/10 val-warn"
  return "border-border/60 bg-secondary/40 text-muted-foreground"
}

// resource_id bazen sayisal bir kimlik (user 41), bazen bir kod (fund TLY).
// "#" yalnizca sayisal olana yakisiyor - "fund #TLY" yanlis okunuyor.
const fmtResourceId = (v: string | number | null) => {
  if (v == null || v === "") return ""
  const s = String(v)
  return /^\d+$/.test(s) ? `#${s}` : s
}

const fmtTime = (v: string | null) => {
  if (!v) return "—"
  const d = new Date(v)
  return isNaN(d.getTime()) ? "—" : d.toLocaleString("tr-TR")
}

const LIMIT = 300

export default function AuditLogPage() {
  const [rows, setRows] = useState<AuditRow[]>([])
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)
  const [error, setError] = useState(false)
  const [query, setQuery] = useState("")
  const [actionFilter, setActionFilter] = useState("")

  useEffect(() => {
    let alive = true
    setLoading(true)
    // Eylem filtresi sunucuya gidiyor - tablonun tamamini kapsamasi icin.
    // Metin aramasi ise getirilen sayfada, istemcide: serbest metin icin
    // bir uc yok ve yazarken her tus vurusunda istek atmanin anlami yok.
    const url = `/admin/audit-log?limit=${LIMIT}` +
      (actionFilter ? `&action=${encodeURIComponent(actionFilter)}` : "")
    authFetch(url)
      .then(res => {
        if (res.status === 401 || res.status === 403) { setForbidden(true); return null }
        if (!res.ok) throw new Error("failed")
        return res.json()
      })
      .then(d => { if (alive && d) { setRows(d); setError(false) } })
      .catch(() => { if (alive) setError(true) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [actionFilter])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(r =>
      r.action.toLowerCase().includes(q) ||
      (ACTION_LABEL[r.action] || "").toLowerCase().includes(q) ||
      String(r.user_id ?? "").includes(q) ||
      String(r.resource_id ?? "").toLowerCase().includes(q) ||
      (r.resource_type || "").toLowerCase().includes(q) ||
      (r.ip_address || "").toLowerCase().includes(q) ||
      JSON.stringify(r.details ?? {}).toLowerCase().includes(q)
    )
  }, [rows, query])

  if (forbidden) {
    return (
      <div className="p-6 max-w-lg mx-auto">
        <Card className="bip-card">
          <CardContent className="py-8 flex items-start gap-3">
            <ShieldAlert className="h-5 w-5 text-bear shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-bold text-foreground">Bu sayfaya erisim yetkiniz yok.</p>
              <p className="text-xs text-muted-foreground mt-1">
                Denetim kaydi yalnizca yoneticilere aciktir.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-6xl mx-auto">
      <div>
        <h1 className="t-title flex items-center gap-2">
          <ScrollText className="h-6 w-6 text-primary" />
          Denetim Kaydi
        </h1>
        <p className="t-caption mt-1.5">
          Girisler, rol ve 2FA degisiklikleri, emirler ve yonetilen portfoy mudahaleleri
          &mdash; en yeni kayit basta.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Kullanici, IP, kaynak ya da detay icinde ara..."
            className="pl-9 h-9 text-xs"
          />
        </div>
        <select
          value={actionFilter}
          onChange={e => setActionFilter(e.target.value)}
          className="h-9 rounded-md border border-input bg-secondary/50 px-3 text-xs font-semibold focus-visible:outline-none cursor-pointer sm:w-80"
        >
          <option value="">Tum eylemler</option>
          {KNOWN_ACTIONS.map(a => (
            <option key={a} value={a}>{ACTION_LABEL[a] || a}</option>
          ))}
        </select>
      </div>

      <Card className="bip-card">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-bold">
            {loading ? "Yukleniyor" : `${filtered.length} kayit`}
          </CardTitle>
          <CardDescription className="text-xs">
            En yeni {LIMIT} kayit icinde
            {actionFilter ? ` (${ACTION_LABEL[actionFilter] || actionFilter})` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="py-12 flex justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          ) : error ? (
            <p className="text-sm text-muted-foreground px-4 py-8">Kayitlar alinamadi.</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground px-4 py-8">Eslesen kayit yok.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground border-b border-border/40">
                  <tr className="h-9">
                    <th className="px-3 text-left font-bold whitespace-nowrap">Zaman</th>
                    <th className="px-3 text-left font-bold whitespace-nowrap">Eylem</th>
                    <th className="px-3 text-left font-bold whitespace-nowrap">Kullanici</th>
                    <th className="px-3 text-left font-bold whitespace-nowrap">Kaynak</th>
                    <th className="px-3 text-left font-bold whitespace-nowrap">IP</th>
                    <th className="px-3 text-left font-bold">Detay</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(r => (
                    <tr key={r.id} className="border-b border-border/20 hover:bg-secondary/20 align-top">
                      <td className="px-3 py-2 font-mono whitespace-nowrap text-muted-foreground">
                        {fmtTime(r.created_at)}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`inline-block px-1.5 py-0.5 rounded border text-[10px] font-bold whitespace-nowrap ${toneClass(r.action)}`}>
                          {ACTION_LABEL[r.action] || r.action}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-mono text-muted-foreground whitespace-nowrap">
                        {r.user_id ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                        {r.resource_type ? `${r.resource_type} ${fmtResourceId(r.resource_id)}` : "—"}
                      </td>
                      <td className="px-3 py-2 font-mono text-muted-foreground/70 whitespace-nowrap">
                        {r.ip_address || "—"}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground/80 max-w-[22rem]">
                        {r.details && Object.keys(r.details).length > 0 ? (
                          <span className="font-mono text-[10px] break-all">
                            {JSON.stringify(r.details)}
                          </span>
                        ) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
