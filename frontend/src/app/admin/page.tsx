"use client"

import React, { useEffect, useState } from "react"
import { ShieldCheck, Loader2, ShieldAlert } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card"
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
                      <span className={`text-[10px] font-bold ${u.totp_enabled ? "text-emerald-400" : "text-muted-foreground"}`}>
                        {u.totp_enabled ? "Açık" : "Kapalı"}
                      </span>
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
    </div>
  )
}
