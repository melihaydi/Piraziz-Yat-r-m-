"use client"

import React, { useEffect, useMemo, useState } from "react"
import { ShieldCheck, Loader2, ShieldAlert, LifeBuoy, Search, KeyRound, UserX } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card"
import { Button } from "@/components/ui/Button"
import { Input } from "@/components/ui/Input"
import { Badge } from "@/components/ui/Badge"
import { EmptyState } from "@/components/ui/EmptyState"
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
  { value: "premium", label: "Premium" },
]

export default function AdminPage() {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionNotice, setActionNotice] = useState<string | null>(null)
  // Kullanıcı sayısı büyüdükçe düz liste taranamaz hale gelir - e-posta/isim
  // üzerinden basit bir client-side filtre, backend'de ayrı bir arama
  // endpoint'i gerektirmeden tabloyu kullanılabilir tutar.
  const [userSearch, setUserSearch] = useState("")
  // Silinen hesaplar satır olarak kalıyor (denetim izi için) ve zamanla
  // gerçek kullanıcıları boğuyor - backend bunları varsayılan olarak
  // filtreliyor, bu anahtar geri getiriyor.
  const [showDeleted, setShowDeleted] = useState(false)

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

  const loadUsers = async (includeDeleted: boolean) => {
    try {
      const res = await authFetch(`/admin/users${includeDeleted ? "?include_deleted=true" : ""}`)
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

  // Anahtar değiştiğinde listeyi yeniden çeker. setLoading burada tekrar
  // true yapılmıyor - tam sayfa yükleyicisi yalnızca ilk açılışta görünsün,
  // anahtara her basışta tablo yerinden oynamasın diye.
  useEffect(() => {
    loadUsers(showDeleted)
  }, [showDeleted])

  useEffect(() => {
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

  const triggerPasswordReset = async (id: number, email: string) => {
    if (!window.confirm(`${email} adresine şifre sıfırlama e-postası gönderilecek. Devam edilsin mi?`)) return
    setBusyId(id)
    setActionError(null)
    setActionNotice(null)
    try {
      const res = await authFetch(`/admin/users/${id}/reset-password`, { method: "POST" })
      const body = await res.json().catch(() => null)
      if (res.ok) {
        setActionNotice(body?.detail || "Şifre sıfırlama e-postası gönderildi.")
        setTimeout(() => setActionNotice(null), 5000)
      } else {
        setActionError(body?.detail || "Şifre sıfırlama e-postası gönderilemedi.")
      }
    } catch (e) {
      setActionError("Sunucuya ulaşılamadı.")
    } finally {
      setBusyId(null)
    }
  }

  const deleteUser = async (id: number, email: string) => {
    if (!window.confirm(
      `${email} hesabı silinecek.\n\nBu geri alınamaz: hesap pasif hale gelir, e-posta/isim anonimleştirilir ve ` +
      `kullanıcı bir daha giriş yapamaz. Portföy/işlem geçmişi denetim kaydı için saklanır.\n\nEmin misiniz?`
    )) return
    setBusyId(id)
    setActionError(null)
    setActionNotice(null)
    try {
      const res = await authFetch(`/admin/users/${id}`, { method: "DELETE" })
      const body = await res.json().catch(() => null)
      if (res.ok) {
        setUsers(prev => prev.filter(u => u.id !== id))
        setActionNotice(body?.detail || "Hesap silindi.")
        setTimeout(() => setActionNotice(null), 5000)
      } else {
        setActionError(body?.detail || "Hesap silinemedi.")
      }
    } catch (e) {
      setActionError("Sunucuya ulaşılamadı.")
    } finally {
      setBusyId(null)
    }
  }

  const filteredUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase()
    if (!q) return users
    return users.filter(u =>
      u.email.toLowerCase().includes(q) || (u.full_name || "").toLowerCase().includes(q)
    )
  }, [users, userSearch])

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
        <ShieldAlert className="h-10 w-10 text-bear" />
        <span className="text-sm text-muted-foreground font-semibold">Bu sayfaya erişim yetkiniz yok.</span>
      </div>
    )
  }

  return (
    <div className="space-y-8 max-w-6xl mx-auto">
      {actionError && (
        <div className="rounded-lg border border-bear/30 bg-bear/10 px-4 py-3 text-sm font-semibold text-bear flex items-center justify-between gap-3">
          <span>{actionError}</span>
          <button onClick={() => setActionError(null)} className="text-bear/70 hover:text-bear cursor-pointer shrink-0">✕</button>
        </div>
      )}

      {actionNotice && (
        <div className="rounded-lg border border-bull/30 bg-bull/10 px-4 py-3 text-sm font-semibold text-bull flex items-center justify-between gap-3">
          <span>{actionNotice}</span>
          <button onClick={() => setActionNotice(null)} className="text-bull/70 hover:text-bull cursor-pointer shrink-0">✕</button>
        </div>
      )}

      <div>
        <h1 className="text-3xl font-extrabold tracking-tight flex items-center gap-2">
          <ShieldCheck className="h-7 w-7 text-primary" />
          Yönetim Paneli
        </h1>
        <p className="t-caption mt-1.5">Kayıtlı kullanıcıların üyelik seviyesini ve hesap durumunu yönetin.</p>
      </div>

      <Card glass={true}>
        <CardHeader>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="t-section">
                Kullanıcılar ({filteredUsers.length}{filteredUsers.length !== users.length ? ` / ${users.length}` : ""})
              </CardTitle>
              <CardDescription>Gerçek bir ödeme entegrasyonu olmadığı için üyelik seviyesi burada manuel atanır.</CardDescription>
            </div>
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <button
                type="button"
                onClick={() => setShowDeleted(v => !v)}
                title="Silinen hesaplar denetim izi için saklanır, listede varsayılan olarak gizlenir"
                className={`h-9 px-3 rounded-md border text-[11px] font-bold cursor-pointer transition-colors shrink-0 ${
                  showDeleted
                    ? "border-primary/40 bg-primary/15 text-primary"
                    : "border-border/60 bg-secondary/30 text-muted-foreground hover:text-foreground"
                }`}
              >
                Silinmişler
              </button>
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={userSearch}
                  onChange={e => setUserSearch(e.target.value)}
                  placeholder="E-posta veya isim ara..."
                  className="pl-9 h-9 text-xs"
                />
              </div>
            </div>
          </div>
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
                  <th className="px-3 md:px-6 text-center">İşlemler</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.length === 0 && (
                  <tr><td colSpan={7}><EmptyState icon={Search} title="Aramayla eşleşen kullanıcı yok." /></td></tr>
                )}
                {filteredUsers.map(u => (
                  <tr key={u.id} className="border-b border-border/40 hover:bg-secondary/20 transition-colors h-14">
                    <td className="px-3 md:px-6 font-bold text-foreground">
                      <div className="flex items-center gap-2">
                        {u.email}
                        {u.is_superuser && <Badge variant="danger">Admin</Badge>}
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
                            ? "bg-bull/10 text-bull border-bull/20 hover:bg-bull/20"
                            : "bg-bear/10 text-bear border-bear/20 hover:bg-bear/20"
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
                          className="text-[10px] font-bold px-2 py-1 rounded border bg-bull/10 text-bull border-bull/20 hover:bg-bear/20 hover:text-bear hover:border-bear/25 cursor-pointer disabled:opacity-50 transition-colors"
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
                    <td className="px-3 md:px-6">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          onClick={() => triggerPasswordReset(u.id, u.email)}
                          disabled={busyId === u.id}
                          title="Şifre sıfırlama e-postası gönder"
                          className="inline-flex items-center justify-center h-7 w-7 rounded border bg-secondary/40 text-muted-foreground border-border/40 hover:text-warn hover:border-warn/30 cursor-pointer disabled:opacity-50 transition-colors"
                        >
                          <KeyRound className="h-3.5 w-3.5" />
                        </button>
                        {!u.is_superuser && (
                          <button
                            onClick={() => deleteUser(u.id, u.email)}
                            disabled={busyId === u.id}
                            title="Hesabı sil"
                            className="inline-flex items-center justify-center h-7 w-7 rounded border bg-secondary/40 text-muted-foreground border-border/40 hover:text-bear hover:border-bear/30 cursor-pointer disabled:opacity-50 transition-colors"
                          >
                            <UserX className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
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
          <CardTitle className="t-section flex items-center gap-2">
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
            <EmptyState icon={LifeBuoy} title="Henüz destek talebi yok." className="py-6" />
          ) : (
            <div className="space-y-3">
              {tickets.map(t => (
                <div key={t.id} className="p-4 bg-secondary/20 rounded-lg border border-border/30 space-y-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <span className="text-sm font-bold text-foreground">{t.subject}</span>
                      <span className="text-xs text-muted-foreground ml-2">({t.user_email})</span>
                    </div>
                    <Badge variant={t.status === "open" ? "warning" : "success"}>
                      {t.status === "open" ? "Açık" : "Kapalı"}
                    </Badge>
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
                        className="flex-1 text-xs rounded-md bg-secondary/60 border border-border px-3 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
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
