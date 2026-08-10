"use client"

import React, { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, Briefcase, Loader2, ShieldAlert, Trash2, Pencil, Plus } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card"
import { Button } from "@/components/ui/Button"
import { Input } from "@/components/ui/Input"
import { authFetch } from "@/lib/auth"

interface AdminUser {
  id: number
  email: string
  full_name: string | null
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

export default function ManagedPortfoliosPage() {
  const router = useRouter()

  const [checkingAccess, setCheckingAccess] = useState(true)
  const [forbidden, setForbidden] = useState(false)

  const [users, setUsers] = useState<AdminUser[]>([])
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

  useEffect(() => {
    // Own access guard (this page is reached directly from the sidebar, not
    // nested under /admin's page-level check) - /auth/me already carries
    // is_superuser, and every /admin/managed-portfolios/* call is enforced
    // server-side regardless, this is just so a non-admin who lands here
    // (e.g. a stale bookmark) sees a clear message instead of empty forms.
    authFetch("/auth/me")
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (!data?.is_superuser) {
          setForbidden(true)
          return
        }
        return authFetch("/admin/users")
          .then(res => (res.ok ? res.json() : []))
          .then(setUsers)
      })
      .catch(() => setForbidden(true))
      .finally(() => setCheckingAccess(false))
  }, [])

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
        <ShieldAlert className="h-10 w-10 text-rose-500" />
        <span className="text-sm text-muted-foreground font-semibold">Bu sayfaya erişim yetkiniz yok.</span>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <button
        onClick={() => router.back()}
        className="inline-flex items-center gap-1.5 text-xs font-bold text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Geri
      </button>

      <div>
        <h1 className="text-3xl font-extrabold tracking-tight flex items-center gap-2">
          <Briefcase className="h-7 w-7 text-primary" />
          Yönetilen Portföyler
        </h1>
        <p className="text-muted-foreground mt-1">
          Bir kullanıcı seçip, o hesaba giriş yapmadan onun adına hisse/fon ekleyin - örneğin portföyünü
          sizin yönettiğiniz biri kendi hesabıyla kayıt olduysa, alım yaptığınız varlıkları buradan onun
          portföyüne işleyebilirsiniz.
        </p>
      </div>

      <Card glass={true}>
        <CardHeader>
          <CardTitle className="text-lg">Kullanıcı Seç</CardTitle>
          <CardDescription>Her işlem denetim kaydına (audit log) yazılır.</CardDescription>
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
    </div>
  )
}
