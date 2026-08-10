"use client"

import React, { useEffect, useState } from "react"
import { ShieldCheck, Loader2, ShieldAlert, LifeBuoy, Briefcase, Trash2, Pencil, Plus } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card"
import { Button } from "@/components/ui/Button"
import { Input } from "@/components/ui/Input"
import { authFetch } from "@/lib/auth"

interface AdminUser {
  id: number
  email: string
  full_name: string | null
  is_active: boolean
  role: string
  is_superuser: boolean
  totp_enabled: boolean
  created_at: string
}

interface ManagedAsset {
  id: number
  portfolio_id: number
  ticker: string
  shares: number
  average_cost: number
}

interface ManagedPortfolio {
  user_id: number
  user_email: string
  user_name: string | null
  portfolio_id: number
  portfolio_name: string
  assets: ManagedAsset[]
}

interface SupportTicket {
  id: number
  user_id: number
  user_email: string
  subject: string
  message: string
  status: "open" | "closed"
  admin_reply: string | null
  created_at: string
}

const ROLE_OPTIONS = [
  { value: "free", label: "Ücretsiz" },
  { value: "starter", label: "Starter" },
  { value: "pro", label: "Pro" },
  { value: "premium", label: "Premium" },
  { value: "institutional", label: "Kurumsal" },
]

export default function AdminPage() {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const [managedUserId, setManagedUserId] = useState<number | "">("")
  const [managedPortfolio, setManagedPortfolio] = useState<ManagedPortfolio | null>(null)
  const [managedLoading, setManagedLoading] = useState(false)
  const [managedError, setManagedError] = useState<string | null>(null)
  const [managedBusy, setManagedBusy] = useState(false)
  const [newAssetTicker, setNewAssetTicker] = useState("")
  const [newAssetShares, setNewAssetShares] = useState("")
  const [newAssetCost, setNewAssetCost] = useState("")
  const [editingAssetId, setEditingAssetId] = useState<number | null>(null)
  const [editShares, setEditShares] = useState("")
  const [editCost, setEditCost] = useState("")

  const [tickets, setTickets] = useState<SupportTicket[]>([])
  const [ticketsLoading, setTicketsLoading] = useState(true)
  const [replyDrafts, setReplyDrafts] = useState<Record<number, string>>({})
  const [ticketBusyId, setTicketBusyId] = useState<number | null>(null)

  const loadTickets = async () => {
    try {
      const res = await authFetch("/admin/support/tickets")
      if (res.ok) setTickets(await res.json())
    } catch (e) {
      // Non-fatal - the user table above still loads independently.
    } finally {
      setTicketsLoading(false)
    }
  }

  const replyToTicket = async (id: number, close: boolean) => {
    setTicketBusyId(id)
    try {
      const body: Record<string, string> = {}
      const reply = replyDrafts[id]?.trim()
      if (reply) body.admin_reply = reply
      if (close) body.status = "closed"
      const res = await authFetch(`/admin/support/tickets/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        const updated = await res.json()
        setTickets(prev => prev.map(t => (t.id === id ? updated : t)))
        setReplyDrafts(prev => ({ ...prev, [id]: "" }))
      }
    } finally {
      setTicketBusyId(null)
    }
  }

  const loadUsers = async () => {
    try {
      const res = await authFetch("/admin/users")
      if (res.status === 403) {
        setForbidden(true)
        return
      }
      if (res.ok) {
        setUsers(await res.json())
      }
    } catch (e) {
      setActionError("Sunucuya ulaşılamadı.")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadUsers()
    loadTickets()
  }, [])

  const changeRole = async (id: number, role: string) => {
    setBusyId(id)
    setActionError(null)
    try {
      const res = await authFetch(`/admin/users/${id}/role?role=${encodeURIComponent(role)}`, { method: "PUT" })
      if (res.ok) {
        const updated = await res.json()
        setUsers(prev => prev.map(u => (u.id === id ? updated : u)))
      } else {
        const body = await res.json().catch(() => null)
        setActionError(body?.detail || "Rol güncellenemedi.")
      }
    } catch (e) {
      setActionError("Sunucuya ulaşılamadı.")
    } finally {
      setBusyId(null)
    }
  }

  const reset2FA = async (id: number, email: string) => {
    if (!window.confirm(
      `${email} hesabının 2FA'sı kapatılacak.\n\nBunu yalnızca kullanıcının kimliğini başka bir yoldan ` +
      `doğruladıysanız yapın - bu işlem hesabın ikinci güvenlik katmanını kaldırır ve denetim kaydına işlenir.`
    )) return

    setBusyId(id)
    setActionError(null)
    try {
      const res = await authFetch(`/admin/users/${id}/reset-2fa`, { method: "POST" })
      if (res.ok) {
        const updated = await res.json()
        setUsers(prev => prev.map(u => (u.id === id ? updated : u)))
      } else {
        const body = await res.json().catch(() => null)
        setActionError(body?.detail || "2FA sıfırlanamadı.")
      }
    } catch (e) {
      setActionError("Sunucuya ulaşılamadı.")
    } finally {
      setBusyId(null)
    }
  }

  const toggleActive = async (id: number, nextActive: boolean) => {
    setBusyId(id)
    setActionError(null)
    try {
      const res = await authFetch(`/admin/users/${id}/active?is_active=${nextActive}`, { method: "PUT" })
      if (res.ok) {
        const updated = await res.json()
        setUsers(prev => prev.map(u => (u.id === id ? updated : u)))
      } else {
        const body = await res.json().catch(() => null)
        setActionError(body?.detail || "Hesap durumu güncellenemedi.")
      }
    } catch (e) {
      setActionError("Sunucuya ulaşılamadı.")
    } finally {
      setBusyId(null)
    }
  }

  const loadManagedPortfolio = async (userId: number) => {
    setManagedLoading(true)
    setManagedError(null)
    try {
      const res = await authFetch(`/admin/managed-portfolios/${userId}`)
      if (res.ok) {
        setManagedPortfolio(await res.json())
      } else {
        setManagedError("Portföy yüklenemedi.")
      }
    } catch (e) {
      setManagedError("Sunucuya ulaşılamadı.")
    } finally {
      setManagedLoading(false)
    }
  }

  const onManagedUserChange = (value: string) => {
    const id = value ? Number(value) : ""
    setManagedUserId(id)
    setManagedPortfolio(null)
    setNewAssetTicker("")
    setNewAssetShares("")
    setNewAssetCost("")
    if (id) loadManagedPortfolio(id)
  }

  const addManagedAsset = async () => {
    if (!managedUserId || !newAssetTicker.trim() || !newAssetShares || !newAssetCost) return
    setManagedBusy(true)
    setManagedError(null)
    try {
      const res = await authFetch(`/admin/managed-portfolios/${managedUserId}/assets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker: newAssetTicker.trim().toUpperCase(),
          shares: parseFloat(newAssetShares),
          average_cost: parseFloat(newAssetCost),
        }),
      })
      if (res.ok) {
        setNewAssetTicker("")
        setNewAssetShares("")
        setNewAssetCost("")
        await loadManagedPortfolio(managedUserId)
      } else {
        const body = await res.json().catch(() => null)
        setManagedError(body?.detail || "Varlık eklenemedi.")
      }
    } catch (e) {
      setManagedError("Sunucuya ulaşılamadı.")
    } finally {
      setManagedBusy(false)
    }
  }

  const startEditAsset = (asset: ManagedAsset) => {
    setEditingAssetId(asset.id)
    setEditShares(String(asset.shares))
    setEditCost(String(asset.average_cost))
  }

  const saveEditAsset = async (asset: ManagedAsset) => {
    if (!editShares || !editCost) return
    setManagedBusy(true)
    setManagedError(null)
    try {
      const res = await authFetch(`/admin/managed-portfolios/assets/${asset.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker: asset.ticker,
          shares: parseFloat(editShares),
          average_cost: parseFloat(editCost),
        }),
      })
      if (res.ok) {
        setEditingAssetId(null)
        if (managedUserId) await loadManagedPortfolio(managedUserId)
      } else {
        const body = await res.json().catch(() => null)
        setManagedError(body?.detail || "Varlık güncellenemedi.")
      }
    } catch (e) {
      setManagedError("Sunucuya ulaşılamadı.")
    } finally {
      setManagedBusy(false)
    }
  }

  const deleteManagedAsset = async (assetId: number) => {
    if (!window.confirm("Bu varlığı kullanıcının portföyünden kaldırmak istediğinize emin misiniz?")) return
    setManagedBusy(true)
    setManagedError(null)
    try {
      const res = await authFetch(`/admin/managed-portfolios/assets/${assetId}`, { method: "DELETE" })
      if (res.ok || res.status === 204) {
        if (managedUserId) await loadManagedPortfolio(managedUserId)
      } else {
        setManagedError("Varlık silinemedi.")
      }
    } catch (e) {
      setManagedError("Sunucuya ulaşılamadı.")
    } finally {
      setManagedBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-48 space-y-4">
        <Loader2 className="h-10 w-10 text-primary animate-spin" />
        <span className="text-sm text-muted-foreground font-semibold">Kullanıcılar Yükleniyor...</span>
      </div>
    )
  }

  if (forbidden) {
    return (
      <div className="flex flex-col items-center justify-center py-48 space-y-4 text-center">
        <ShieldAlert className="h-10 w-10 text-rose-500" />
        <span className="text-sm text-muted-foreground font-semibold">Bu sayfaya erişim yetkiniz yok.</span>
      </div>
    )
  }

  return (
    <div className="space-y-8 max-w-6xl mx-auto">
      {actionError && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-950/30 px-4 py-3 text-sm font-semibold text-rose-400 flex items-center justify-between gap-3">
          <span>{actionError}</span>
          <button onClick={() => setActionError(null)} className="text-rose-400/70 hover:text-rose-300 cursor-pointer shrink-0">✕</button>
        </div>
      )}

      <div>
        <h1 className="text-3xl font-extrabold tracking-tight flex items-center gap-2">
          <ShieldCheck className="h-7 w-7 text-red-400" />
          Yönetim Paneli
        </h1>
        <p className="text-muted-foreground mt-1">Kayıtlı kullanıcıların üyelik seviyesini ve hesap durumunu yönetin.</p>
      </div>

      <Card glass={true}>
        <CardHeader>
          <CardTitle className="text-lg">Kullanıcılar ({users.length})</CardTitle>
          <CardDescription>Gerçek bir ödeme entegrasyonu olmadığı için üyelik seviyesi burada manuel atanır.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="border-b border-border/80 text-muted-foreground text-xs font-semibold bg-secondary/15 h-11">
                  <th className="px-3 md:px-6">E-posta</th>
                  <th className="px-3 md:px-6">Ad Soyad</th>
                  <th className="px-3 md:px-6">Üyelik</th>
                  <th className="px-3 md:px-6 text-center">Durum</th>
                  <th className="px-3 md:px-6 text-center">2FA</th>
                  <th className="px-3 md:px-6">Kayıt Tarihi</th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id} className="border-b border-border/40 hover:bg-secondary/20 transition-colors h-14">
                    <td className="px-3 md:px-6 font-bold text-foreground">
                      <div className="flex items-center gap-2">
                        {u.email}
                        {u.is_superuser && (
                          <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20 uppercase">
                            Admin
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 md:px-6 text-muted-foreground">{u.full_name || "—"}</td>
                    <td className="px-3 md:px-6">
                      <select
                        value={u.role}
                        disabled={busyId === u.id}
                        onChange={e => changeRole(u.id, e.target.value)}
                        className="h-8 rounded-md border border-input bg-secondary/50 px-2 text-xs font-semibold focus-visible:outline-none disabled:opacity-50 cursor-pointer"
                      >
                        {ROLE_OPTIONS.map(r => (
                          <option key={r.value} value={r.value}>{r.label}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 md:px-6 text-center">
                      <button
                        onClick={() => toggleActive(u.id, !u.is_active)}
                        disabled={busyId === u.id}
                        className={`text-[10px] font-bold px-2 py-1 rounded border cursor-pointer disabled:opacity-50 ${
                          u.is_active
                            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20"
                            : "bg-rose-500/10 text-rose-400 border-rose-500/20 hover:bg-rose-500/20"
                        }`}
                      >
                        {u.is_active ? "Aktif" : "Pasif"}
                      </button>
                    </td>
                    <td className="px-3 md:px-6 text-center">
                      {u.totp_enabled ? (
                        // Only offered when 2FA is actually on - this is the
                        // recovery path for a user who lost both their
                        // authenticator device and their recovery codes.
                        <button
                          onClick={() => reset2FA(u.id, u.email)}
                          disabled={busyId === u.id}
                          title="Kullanıcının 2FA'sını sıfırla (hesap kurtarma)"
                          className="text-[10px] font-bold px-2 py-1 rounded border bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-rose-500/20 hover:text-rose-400 hover:border-rose-500/25 cursor-pointer disabled:opacity-50 transition-colors"
                        >
                          Açık — Sıfırla
                        </button>
                      ) : (
                        <span className="text-[10px] font-bold text-muted-foreground">Kapalı</span>
                      )}
                    </td>
                    <td className="px-3 md:px-6 text-muted-foreground text-xs font-mono">
                      {new Date(u.created_at).toLocaleDateString("tr-TR")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card glass={true}>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Briefcase className="h-5 w-5 text-primary" />
            Yönetilen Portföyler
          </CardTitle>
          <CardDescription>
            Bir kullanıcı seçip, o hesaba giriş yapmadan onun adına hisse/fon ekleyin - örneğin portföyünü
            sizin yönettiğiniz biri kendi hesabıyla kayıt olduysa, alım yaptığınız varlıkları buradan onun
            portföyüne işleyebilirsiniz.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {managedError && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-950/30 px-3 py-2 text-xs font-semibold text-rose-400 flex items-center justify-between gap-3">
              <span>{managedError}</span>
              <button onClick={() => setManagedError(null)} className="text-rose-400/70 hover:text-rose-300 cursor-pointer shrink-0">✕</button>
            </div>
          )}

          <select
            value={managedUserId}
            onChange={e => onManagedUserChange(e.target.value)}
            className="h-9 w-full max-w-sm rounded-md border border-input bg-secondary/50 px-3 text-xs font-semibold focus-visible:outline-none cursor-pointer"
          >
            <option value="">Kullanıcı seçin...</option>
            {users.map(u => (
              <option key={u.id} value={u.id}>{u.full_name ? `${u.full_name} (${u.email})` : u.email}</option>
            ))}
          </select>

          {managedLoading ? (
            <div className="py-6 flex justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          ) : managedPortfolio ? (
            <div className="space-y-3">
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead>
                    <tr className="border-b border-border/60 text-muted-foreground font-semibold h-9">
                      <th className="px-2">Sembol</th>
                      <th className="px-2 text-right">Adet</th>
                      <th className="px-2 text-right">Maliyet</th>
                      <th className="px-2 text-right">İşlemler</th>
                    </tr>
                  </thead>
                  <tbody>
                    {managedPortfolio.assets.length === 0 && (
                      <tr><td colSpan={4} className="text-center text-muted-foreground py-4">Bu kullanıcının portföyünde henüz varlık yok.</td></tr>
                    )}
                    {managedPortfolio.assets.map(asset => (
                      <tr key={asset.id} className="border-b border-border/20 h-11">
                        <td className="px-2 font-bold text-foreground">{asset.ticker}</td>
                        {editingAssetId === asset.id ? (
                          <>
                            <td className="px-2 text-right">
                              <input
                                type="number"
                                value={editShares}
                                onChange={e => setEditShares(e.target.value)}
                                className="w-20 h-7 rounded border border-input bg-zinc-900/60 px-1.5 text-right text-xs"
                              />
                            </td>
                            <td className="px-2 text-right">
                              <input
                                type="number"
                                value={editCost}
                                onChange={e => setEditCost(e.target.value)}
                                className="w-20 h-7 rounded border border-input bg-zinc-900/60 px-1.5 text-right text-xs"
                              />
                            </td>
                            <td className="px-2 text-right space-x-1.5">
                              <button
                                onClick={() => saveEditAsset(asset)}
                                disabled={managedBusy}
                                className="text-[10px] font-bold px-2 py-1 rounded border bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20 cursor-pointer disabled:opacity-50"
                              >
                                Kaydet
                              </button>
                              <button
                                onClick={() => setEditingAssetId(null)}
                                className="text-[10px] font-bold px-2 py-1 rounded border bg-secondary/40 text-muted-foreground border-border/40 hover:bg-secondary/60 cursor-pointer"
                              >
                                Vazgeç
                              </button>
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="px-2 text-right font-mono">{asset.shares}</td>
                            <td className="px-2 text-right font-mono">₺{asset.average_cost.toFixed(2)}</td>
                            <td className="px-2 text-right space-x-1.5">
                              <button
                                onClick={() => startEditAsset(asset)}
                                disabled={managedBusy}
                                title="Düzenle"
                                className="inline-flex items-center justify-center h-7 w-7 rounded border bg-secondary/40 text-muted-foreground border-border/40 hover:text-foreground hover:bg-secondary/60 cursor-pointer disabled:opacity-50"
                              >
                                <Pencil className="h-3 w-3" />
                              </button>
                              <button
                                onClick={() => deleteManagedAsset(asset.id)}
                                disabled={managedBusy}
                                title="Kaldır"
                                className="inline-flex items-center justify-center h-7 w-7 rounded border bg-secondary/40 text-muted-foreground border-border/40 hover:text-rose-400 hover:border-rose-500/30 cursor-pointer disabled:opacity-50"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap items-end gap-2 pt-2 border-t border-border/30">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-muted-foreground">Sembol</label>
                  <Input
                    value={newAssetTicker}
                    onChange={e => setNewAssetTicker(e.target.value)}
                    placeholder="THYAO"
                    className="h-8 w-24 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-muted-foreground">Adet</label>
                  <input
                    type="number"
                    value={newAssetShares}
                    onChange={e => setNewAssetShares(e.target.value)}
                    className="h-8 w-24 rounded-md border border-input bg-secondary/50 px-2 text-xs focus-visible:outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-muted-foreground">Maliyet (₺)</label>
                  <input
                    type="number"
                    value={newAssetCost}
                    onChange={e => setNewAssetCost(e.target.value)}
                    className="h-8 w-24 rounded-md border border-input bg-secondary/50 px-2 text-xs focus-visible:outline-none"
                  />
                </div>
                <Button
                  type="button"
                  onClick={addManagedAsset}
                  disabled={managedBusy || !newAssetTicker.trim() || !newAssetShares || !newAssetCost}
                  className="h-8 cursor-pointer bg-primary hover:bg-primary/90 text-primary-foreground text-[11px] font-bold px-3"
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Ekle
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground py-4 text-center">Varlık eklemek için yukarıdan bir kullanıcı seçin.</p>
          )}
        </CardContent>
      </Card>

      <Card glass={true}>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <LifeBuoy className="h-5 w-5 text-primary" />
            Destek Talepleri ({tickets.filter(t => t.status === "open").length} açık)
          </CardTitle>
          <CardDescription>Kullanıcıların gönderdiği destek talepleri - yanıt yazınca kullanıcıya e-posta gider.</CardDescription>
        </CardHeader>
        <CardContent>
          {ticketsLoading ? (
            <div className="py-10 flex justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : tickets.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Henüz destek talebi yok.</p>
          ) : (
            <div className="space-y-3">
              {tickets.map(t => (
                <div key={t.id} className="p-4 bg-secondary/20 rounded-lg border border-border/30 space-y-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <span className="text-sm font-bold text-foreground">{t.subject}</span>
                      <span className="text-xs text-muted-foreground ml-2">({t.user_email})</span>
                    </div>
                    <span className={`text-[9px] font-black px-1.5 py-0.5 rounded border uppercase shrink-0 ${
                      t.status === "open" ? "bg-amber-500/10 text-amber-400 border-amber-500/20" : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                    }`}>
                      {t.status === "open" ? "Açık" : "Kapalı"}
                    </span>
                  </div>
                  <p className="text-xs text-foreground/90">{t.message}</p>
                  {t.admin_reply && (
                    <div className="pt-2 border-t border-border/30">
                      <p className="text-[10px] font-bold text-primary">Verilen Yanıt</p>
                      <p className="text-xs text-foreground/90">{t.admin_reply}</p>
                    </div>
                  )}
                  {t.status === "open" && (
                    <div className="flex items-start gap-2 pt-1">
                      <textarea
                        value={replyDrafts[t.id] || ""}
                        onChange={(e) => setReplyDrafts(prev => ({ ...prev, [t.id]: e.target.value }))}
                        placeholder="Yanıt yaz..."
                        rows={2}
                        className="flex-1 text-xs rounded-md bg-zinc-900/60 border border-zinc-800 px-3 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
                      />
                      <div className="flex flex-col gap-1.5 shrink-0">
                        <Button
                          type="button"
                          onClick={() => replyToTicket(t.id, false)}
                          disabled={ticketBusyId === t.id || !replyDrafts[t.id]?.trim()}
                          className="cursor-pointer bg-primary hover:bg-primary/90 text-primary-foreground text-[11px] font-bold px-3 py-1.5 h-auto"
                        >
                          Yanıtla
                        </Button>
                        <Button
                          type="button"
                          onClick={() => replyToTicket(t.id, true)}
                          disabled={ticketBusyId === t.id}
                          className="cursor-pointer bg-secondary/60 hover:bg-secondary text-foreground border border-border/40 text-[11px] font-bold px-3 py-1.5 h-auto"
                        >
                          Kapat
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
