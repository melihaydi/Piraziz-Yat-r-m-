"use client"

import React, { useEffect, useMemo, useState } from "react"
import { Briefcase, Loader2, ShieldAlert, Trash2, Pencil, Plus, Star, Wallet, Minus, Landmark, DollarSign, Search } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card"
import { Button } from "@/components/ui/Button"
import { Input } from "@/components/ui/Input"
import { TickerCombobox } from "@/components/ui/TickerCombobox"
import { authFetch } from "@/lib/auth"
import { parseTLAmount } from "@/lib/utils"

// Quick-pick shortlist so picking a frequently-managed user doesn't mean
// scanning a full email dropdown every time - persisted per-browser (this
// is an admin convenience, not account data, so localStorage is enough).
// Seeded once with ugurcankk0@gmail.com per explicit request; after that
// first seed, admins manage their own pins via the star toggle below and
// this default never re-applies (so unpinning them later sticks).
const PINNED_USERS_KEY = "bip_managed_portfolio_pinned_users"
const PINNED_USERS_SEEDED_KEY = "bip_managed_portfolio_pinned_seeded"
const DEFAULT_PINNED_EMAIL = "ugurcankk0@gmail.com"

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
  cost_value: number
  current_price: number
  total_value: number
  total_profit: number
  profit_percentage: number
  daily_change_pct: number | null
  /** True when daily_change_pct is a fund's modeled intraday estimate
   * rather than a settled figure - rendered in orange to match how the
   * user's own portfolio page distinguishes the two. */
  daily_change_is_estimate: boolean
  daily_gain_value: number | null
}

interface ManagedPortfolio {
  user_id: number
  user_email: string
  user_name: string | null
  portfolio_id: number
  portfolio_name: string
  assets: ManagedAsset[]
  cash_balance: number
  viop_margin: number
  usd_cash_balance: number
  usd_cash_value_try: number
  total_cost: number
  total_value: number
  total_profit: number
  profit_percentage: number
}

const tl = (n: number) => `₺${n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default function ManagedPortfoliosPage() {
  const [checkingAccess, setCheckingAccess] = useState(true)
  const [forbidden, setForbidden] = useState(false)

  const [users, setUsers] = useState<AdminUser[]>([])
  // Kullanıcı sayısı büyüdükçe düz <select> içinde arama yapmak pratik
  // olmaktan çıkar - yıldızlı hızlı-erişim listesi dururken, e-posta/isim
  // filtreli bir arama kutusu seçim listesini daraltır.
  const [userQuery, setUserQuery] = useState("")
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
  const [cashAmount, setCashAmount] = useState("")
  const [cashBusy, setCashBusy] = useState(false)
  const [viopAmount, setViopAmount] = useState("")
  const [viopBusy, setViopBusy] = useState(false)
  const [usdCashAmount, setUsdCashAmount] = useState("")
  const [usdCashBusy, setUsdCashBusy] = useState(false)

  const [pinnedIds, setPinnedIds] = useState<number[]>([])

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
          .then((loadedUsers: AdminUser[]) => {
            setUsers(loadedUsers)

            let pinned: number[] = []
            try {
              const raw = localStorage.getItem(PINNED_USERS_KEY)
              pinned = raw ? JSON.parse(raw) : []
            } catch (e) {
              pinned = []
            }

            // One-time default seed so the requested user shows up as a
            // quick-pick immediately, without the admin having to find and
            // star them manually first. Only runs once ever (tracked by its
            // own key) so unpinning later doesn't get silently undone by a
            // page reload re-seeding it.
            let alreadySeeded = false
            try {
              alreadySeeded = localStorage.getItem(PINNED_USERS_SEEDED_KEY) === "1"
            } catch (e) {
              alreadySeeded = false
            }
            if (!alreadySeeded) {
              const defaultUser = loadedUsers.find(u => u.email.toLowerCase() === DEFAULT_PINNED_EMAIL)
              if (defaultUser && !pinned.includes(defaultUser.id)) {
                pinned = [...pinned, defaultUser.id]
              }
              try {
                localStorage.setItem(PINNED_USERS_SEEDED_KEY, "1")
                localStorage.setItem(PINNED_USERS_KEY, JSON.stringify(pinned))
              } catch (e) {
                // Storage unavailable - the seed just won't persist across reloads.
              }
            }
            setPinnedIds(pinned)
          })
      })
      .catch(() => setForbidden(true))
      .finally(() => setCheckingAccess(false))
  }, [])

  const filteredUsers = useMemo(() => {
    const q = userQuery.trim().toLowerCase()
    if (!q) return users
    return users.filter(u =>
      u.email.toLowerCase().includes(q) || (u.full_name || "").toLowerCase().includes(q)
    )
  }, [users, userQuery])

  const togglePinned = (userId: number) => {
    setPinnedIds(prev => {
      const next = prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]
      try {
        localStorage.setItem(PINNED_USERS_KEY, JSON.stringify(next))
      } catch (e) {
        // Not persisted this session, but the toggle still works visually.
      }
      return next
    })
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
    setCashAmount("")
    if (id) loadManagedPortfolio(id)
  }

  const addManagedAsset = async () => {
    if (!managedUserId || !newAssetTicker.trim() || !newAssetShares || !newAssetCost) return
    const shares = parseTLAmount(newAssetShares)
    const averageCost = parseTLAmount(newAssetCost)
    if (!Number.isFinite(shares) || !Number.isFinite(averageCost)) {
      setManagedError("Adet veya maliyet geçersiz - örn. 12,5 ya da 1.500,50 yazın.")
      return
    }
    setManagedBusy(true)
    setManagedError(null)
    try {
      const res = await authFetch(`/admin/managed-portfolios/${managedUserId}/assets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker: newAssetTicker.trim().toUpperCase(),
          shares,
          average_cost: averageCost,
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

  // sign: +1 for "Ekle" (deposit), -1 for "Çıkar" (withdraw) - the admin
  // always types a positive number, this decides its direction, so a typo
  // in the sign can't silently flip a deposit into a withdrawal.
  const adjustCash = async (sign: 1 | -1) => {
    const parsed = parseTLAmount(cashAmount)
    if (!managedUserId || !cashAmount || !Number.isFinite(parsed) || parsed <= 0) return
    setCashBusy(true)
    setManagedError(null)
    try {
      const res = await authFetch(`/admin/managed-portfolios/${managedUserId}/cash`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: sign * parsed }),
      })
      if (res.ok) {
        setCashAmount("")
        await loadManagedPortfolio(managedUserId)
      } else {
        const body = await res.json().catch(() => null)
        setManagedError(body?.detail || "Nakit güncellenemedi.")
      }
    } catch (e) {
      setManagedError("Sunucuya ulaşılamadı.")
    } finally {
      setCashBusy(false)
    }
  }

  // Same sign convention as adjustCash above.
  const adjustViopMargin = async (sign: 1 | -1) => {
    const parsed = parseTLAmount(viopAmount)
    if (!managedUserId || !viopAmount || !Number.isFinite(parsed) || parsed <= 0) return
    setViopBusy(true)
    setManagedError(null)
    try {
      const res = await authFetch(`/admin/managed-portfolios/${managedUserId}/viop-margin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: sign * parsed }),
      })
      if (res.ok) {
        setViopAmount("")
        await loadManagedPortfolio(managedUserId)
      } else {
        const body = await res.json().catch(() => null)
        setManagedError(body?.detail || "VİOP teminatı güncellenemedi.")
      }
    } catch (e) {
      setManagedError("Sunucuya ulaşılamadı.")
    } finally {
      setViopBusy(false)
    }
  }

  // Same sign convention as adjustCash above - amount is raw USD, not TL
  // (parseTLAmount is locale parsing only, not currency-specific).
  const adjustUsdCash = async (sign: 1 | -1) => {
    const parsed = parseTLAmount(usdCashAmount)
    if (!managedUserId || !usdCashAmount || !Number.isFinite(parsed) || parsed <= 0) return
    setUsdCashBusy(true)
    setManagedError(null)
    try {
      const res = await authFetch(`/admin/managed-portfolios/${managedUserId}/usd-cash`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: sign * parsed }),
      })
      if (res.ok) {
        setUsdCashAmount("")
        await loadManagedPortfolio(managedUserId)
      } else {
        const body = await res.json().catch(() => null)
        setManagedError(body?.detail || "Döviz nakti güncellenemedi.")
      }
    } catch (e) {
      setManagedError("Sunucuya ulaşılamadı.")
    } finally {
      setUsdCashBusy(false)
    }
  }

  const startEditAsset = (asset: ManagedAsset) => {
    setEditingAssetId(asset.id)
    setEditShares(String(asset.shares))
    setEditCost(String(asset.average_cost))
  }

  const saveEditAsset = async (asset: ManagedAsset) => {
    if (!editShares || !editCost) return
    const shares = parseTLAmount(editShares)
    const averageCost = parseTLAmount(editCost)
    if (!Number.isFinite(shares) || !Number.isFinite(averageCost)) {
      setManagedError("Adet veya maliyet geçersiz - örn. 12,5 ya da 1.500,50 yazın.")
      return
    }
    setManagedBusy(true)
    setManagedError(null)
    try {
      const res = await authFetch(`/admin/managed-portfolios/assets/${asset.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker: asset.ticker,
          shares,
          average_cost: averageCost,
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
        <ShieldAlert className="h-10 w-10 text-bear" />
        <span className="text-sm text-muted-foreground font-semibold">Bu sayfaya erişim yetkiniz yok.</span>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight flex items-center gap-2">
          <Briefcase className="h-7 w-7 text-primary" />
          Yönetilen Portföyler
        </h1>
        <p className="t-caption mt-1.5">
          Bir kullanıcı seçip, o hesaba giriş yapmadan onun adına hisse/fon ekleyin - örneğin portföyünü
          sizin yönettiğiniz biri kendi hesabıyla kayıt olduysa, alım yaptığınız varlıkları buradan onun
          portföyüne işleyebilirsiniz.
        </p>
      </div>

      <Card glass={true}>
        <CardHeader>
          <CardTitle className="t-section">Kullanıcı Seç</CardTitle>
          <CardDescription>Her işlem denetim kaydına (audit log) yazılır.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {managedError && (
            <div className="rounded-lg border border-bear/30 bg-bear/10 px-3 py-2 text-xs font-semibold text-bear flex items-center justify-between gap-3">
              <span>{managedError}</span>
              <button onClick={() => setManagedError(null)} className="text-bear/70 hover:text-bear cursor-pointer shrink-0">✕</button>
            </div>
          )}

          {/* Quick-pick chips for pinned (starred) users - shows just a name,
              never the email, so picking a frequently-managed user doesn't
              mean reading through everyone's address every time. Falls back
              to the part before "@" when there's no full_name on file. */}
          {pinnedIds.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {pinnedIds
                .map(id => users.find(u => u.id === id))
                .filter((u): u is AdminUser => !!u)
                .map(u => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => onManagedUserChange(String(u.id))}
                    className={`inline-flex items-center gap-1.5 h-8 pl-3 pr-2 rounded-full border text-xs font-bold cursor-pointer transition-colors ${
                      managedUserId === u.id
                        ? "border-primary/40 bg-primary/15 text-primary"
                        : "border-border/60 bg-secondary/30 text-foreground hover:bg-secondary/50"
                    }`}
                  >
                    <Star className="h-3 w-3 fill-current" />
                    {u.full_name || u.email.split("@")[0]}
                    <span
                      role="button"
                      tabIndex={-1}
                      onClick={e => { e.stopPropagation(); togglePinned(u.id) }}
                      title="Kayıtlılardan kaldır"
                      className="text-muted-foreground/60 hover:text-bear ml-0.5 cursor-pointer"
                    >
                      ✕
                    </span>
                  </button>
                ))}
            </div>
          )}

          <div className="relative w-full max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={userQuery}
              onChange={e => setUserQuery(e.target.value)}
              placeholder="E-posta veya isim ile ara..."
              className="pl-9 h-9 text-xs"
            />
          </div>

          <div className="flex items-center gap-2">
            <select
              value={managedUserId}
              onChange={e => onManagedUserChange(e.target.value)}
              className="h-9 w-full max-w-sm rounded-md border border-input bg-secondary/50 px-3 text-xs font-semibold focus-visible:outline-none cursor-pointer"
            >
              <option value="">
                {filteredUsers.length === 0 ? "Eşleşen kullanıcı yok" : "Kullanıcı seçin..."}
              </option>
              {filteredUsers.map(u => (
                <option key={u.id} value={u.id}>{u.full_name ? `${u.full_name} (${u.email})` : u.email}</option>
              ))}
            </select>
            {managedUserId !== "" && (
              <button
                type="button"
                onClick={() => togglePinned(managedUserId as number)}
                title={pinnedIds.includes(managedUserId as number) ? "Kayıtlılardan kaldır" : "Hızlı erişime ekle"}
                className={`inline-flex items-center justify-center h-9 w-9 rounded-md border cursor-pointer transition-colors shrink-0 ${
                  pinnedIds.includes(managedUserId as number)
                    ? "border-warn/30 bg-warn/10 text-warn"
                    : "border-border/60 bg-secondary/30 text-muted-foreground hover:text-foreground"
                }`}
              >
                <Star className={`h-4 w-4 ${pinnedIds.includes(managedUserId as number) ? "fill-current" : ""}`} />
              </button>
            )}
          </div>

          {managedLoading ? (
            <div className="py-6 flex justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          ) : managedPortfolio ? (
            <div className="space-y-3">
              {(managedPortfolio.assets.length > 0 || managedPortfolio.cash_balance > 0) && (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <div className="rounded-lg border border-border/50 bg-secondary/20 px-3 py-2">
                    <span className="text-[10px] font-bold uppercase text-muted-foreground">Toplam Pozisyon</span>
                    <p className="text-base font-extrabold font-mono text-foreground">{tl(managedPortfolio.total_value)}</p>
                  </div>
                  <div className="rounded-lg border border-border/50 bg-secondary/20 px-3 py-2">
                    <span className="text-[10px] font-bold uppercase text-muted-foreground">Toplam Maliyet</span>
                    <p className="text-base font-extrabold font-mono text-foreground">{tl(managedPortfolio.total_cost)}</p>
                  </div>
                  <div className="rounded-lg border border-border/50 bg-secondary/20 px-3 py-2">
                    <span className="text-[10px] font-bold uppercase text-muted-foreground">Kâr / Zarar</span>
                    <p className={`text-base font-extrabold font-mono ${managedPortfolio.total_profit >= 0 ? "text-bull" : "text-bear"}`}>
                      {managedPortfolio.total_profit >= 0 ? "+" : ""}{tl(managedPortfolio.total_profit)}
                    </p>
                  </div>
                  <div className="rounded-lg border border-border/50 bg-secondary/20 px-3 py-2">
                    <span className="text-[10px] font-bold uppercase text-muted-foreground">Getiri</span>
                    <p className={`text-base font-extrabold font-mono ${managedPortfolio.profit_percentage >= 0 ? "text-bull" : "text-bear"}`}>
                      {managedPortfolio.profit_percentage >= 0 ? "+" : ""}{managedPortfolio.profit_percentage.toFixed(2)}%
                    </p>
                  </div>
                </div>
              )}

              {/* Cash module - deliberately NOT another row in the assets
                  table below (see Portfolio.cash_balance's docstring: cash
                  has no ticker/price to look up, unlike every row in that
                  table). Ekle deposits, Çıkar withdraws/corrects; both take
                  the same positive amount typed above them. */}
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/50 bg-secondary/20 px-3 py-2.5">
                <Wallet className="h-4 w-4 text-foreground shrink-0" />
                <span className="text-[10px] font-bold uppercase text-muted-foreground shrink-0">Nakit</span>
                <span className="text-sm font-extrabold font-mono text-foreground mr-1">{tl(managedPortfolio.cash_balance)}</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={cashAmount}
                  onChange={e => setCashAmount(e.target.value)}
                  placeholder="Tutar (₺) örn. 1.500,50"
                  className="h-8 w-28 rounded-md border border-input bg-secondary/60 px-2 text-xs focus-visible:outline-none"
                />
                <Button
                  type="button"
                  onClick={() => adjustCash(1)}
                  disabled={cashBusy || !cashAmount}
                  title="Nakit ekle"
                  className="h-8 cursor-pointer bg-bull/15 hover:bg-bull/25 text-bull text-[11px] font-bold px-2.5"
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Ekle
                </Button>
                <Button
                  type="button"
                  onClick={() => adjustCash(-1)}
                  disabled={cashBusy || !cashAmount}
                  title="Nakit çıkar"
                  className="h-8 cursor-pointer bg-bear/10 hover:bg-bear/20 text-bear text-[11px] font-bold px-2.5"
                >
                  <Minus className="h-3.5 w-3.5 mr-1" />
                  Çıkar
                </Button>
              </div>

              {/* VİOP teminatı module - mirrors the cash module above
                  exactly (Portfolio.viop_margin's own docstring explains
                  why it's a separate balance rather than another cash
                  deposit or a priced asset row). */}
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/50 bg-secondary/20 px-3 py-2.5">
                <Landmark className="h-4 w-4 text-foreground shrink-0" />
                <span className="text-[10px] font-bold uppercase text-muted-foreground shrink-0">VİOP Teminatı</span>
                <span className="text-sm font-extrabold font-mono text-foreground mr-1">{tl(managedPortfolio.viop_margin)}</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={viopAmount}
                  onChange={e => setViopAmount(e.target.value)}
                  placeholder="Tutar (₺) örn. 1.500,50"
                  className="h-8 w-28 rounded-md border border-input bg-secondary/60 px-2 text-xs focus-visible:outline-none"
                />
                <Button
                  type="button"
                  onClick={() => adjustViopMargin(1)}
                  disabled={viopBusy || !viopAmount}
                  title="Teminat ekle"
                  className="h-8 cursor-pointer bg-bull/15 hover:bg-bull/25 text-bull text-[11px] font-bold px-2.5"
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Ekle
                </Button>
                <Button
                  type="button"
                  onClick={() => adjustViopMargin(-1)}
                  disabled={viopBusy || !viopAmount}
                  title="Teminat çıkar"
                  className="h-8 cursor-pointer bg-bear/10 hover:bg-bear/20 text-bear text-[11px] font-bold px-2.5"
                >
                  <Minus className="h-3.5 w-3.5 mr-1" />
                  Çıkar
                </Button>
              </div>

              {/* Döviz nakit (USD) module - stored in raw dollars (see
                  Portfolio.usd_cash_balance's docstring), the TL figure
                  shown next to it is the LIVE conversion computed by the
                  backend on every load, not a fixed snapshot from deposit
                  time - it'll change on refresh as USD/TRY moves. */}
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/50 bg-secondary/20 px-3 py-2.5">
                <DollarSign className="h-4 w-4 text-foreground shrink-0" />
                <span className="text-[10px] font-bold uppercase text-muted-foreground shrink-0">Döviz Nakit (USD)</span>
                <span className="text-sm font-extrabold font-mono text-foreground mr-1">
                  ${managedPortfolio.usd_cash_balance.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  <span className="text-[10px] font-semibold text-muted-foreground ml-1">({tl(managedPortfolio.usd_cash_value_try)})</span>
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={usdCashAmount}
                  onChange={e => setUsdCashAmount(e.target.value)}
                  placeholder="Tutar ($) örn. 220"
                  className="h-8 w-28 rounded-md border border-input bg-secondary/60 px-2 text-xs focus-visible:outline-none"
                />
                <Button
                  type="button"
                  onClick={() => adjustUsdCash(1)}
                  disabled={usdCashBusy || !usdCashAmount}
                  title="Döviz nakti ekle"
                  className="h-8 cursor-pointer bg-bull/15 hover:bg-bull/25 text-bull text-[11px] font-bold px-2.5"
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Ekle
                </Button>
                <Button
                  type="button"
                  onClick={() => adjustUsdCash(-1)}
                  disabled={usdCashBusy || !usdCashAmount}
                  title="Döviz nakti çıkar"
                  className="h-8 cursor-pointer bg-bear/10 hover:bg-bear/20 text-bear text-[11px] font-bold px-2.5"
                >
                  <Minus className="h-3.5 w-3.5 mr-1" />
                  Çıkar
                </Button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead>
                    <tr className="border-b border-border/60 text-muted-foreground font-semibold h-9">
                      <th className="px-2">Sembol</th>
                      <th className="px-2 text-right">Adet</th>
                      <th className="px-2 text-right">Ort. Maliyet</th>
                      <th className="px-2 text-right">Güncel Fiyat</th>
                      <th className="px-2 text-right">Pozisyon</th>
                      <th className="px-2 text-right">Kâr / Zarar</th>
                      <th className="px-2 text-right">İşlemler</th>
                    </tr>
                  </thead>
                  <tbody>
                    {managedPortfolio.assets.length === 0 && (
                      <tr><td colSpan={7} className="text-center text-muted-foreground py-4">Bu kullanıcının portföyünde henüz varlık yok.</td></tr>
                    )}
                    {managedPortfolio.assets.map(asset => (
                      <tr key={asset.id} className="border-b border-border/20 h-11">
                        <td className="px-2 font-bold text-foreground">{asset.ticker}</td>
                        {editingAssetId === asset.id ? (
                          <>
                            <td className="px-2 text-right">
                              <input
                                type="text"
                                inputMode="decimal"
                                value={editShares}
                                onChange={e => setEditShares(e.target.value)}
                                placeholder="12,5"
                                className="w-20 h-7 rounded border border-input bg-secondary/60 px-1.5 text-right text-xs"
                              />
                            </td>
                            <td className="px-2 text-right">
                              <input
                                type="text"
                                inputMode="decimal"
                                value={editCost}
                                onChange={e => setEditCost(e.target.value)}
                                placeholder="1.500,50"
                                className="w-20 h-7 rounded border border-input bg-secondary/60 px-1.5 text-right text-xs"
                              />
                            </td>
                            <td colSpan={3} className="px-2 text-right space-x-1.5">
                              <button
                                onClick={() => saveEditAsset(asset)}
                                disabled={managedBusy}
                                className="text-[10px] font-bold px-2 py-1 rounded border bg-bull/10 text-bull border-bull/20 hover:bg-bull/20 cursor-pointer disabled:opacity-50"
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
                            <td className="px-2 text-right font-mono">
                              <div className="flex flex-col items-end">
                                <span>₺{asset.current_price.toFixed(2)}</span>
                                {asset.daily_change_pct != null && (
                                  <span className={`text-[10px] font-bold ${
                                    asset.daily_change_is_estimate
                                      ? "text-warn"
                                      : asset.daily_change_pct >= 0 ? "text-bull" : "text-bear"
                                  }`}>
                                    {asset.daily_change_is_estimate ? "~" : ""}
                                    {asset.daily_change_pct >= 0 ? "+" : ""}{asset.daily_change_pct.toFixed(2)}%
                                    {asset.daily_change_is_estimate ? " tahmini" : ""}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-2 text-right font-mono font-bold">
                              <div className="flex flex-col items-end">
                                <span>{tl(asset.total_value)}</span>
                                <span className="text-[10px] font-normal text-muted-foreground">
                                  maliyet {tl(asset.cost_value)}
                                </span>
                              </div>
                            </td>
                            <td className="px-2 text-right font-mono font-bold">
                              <div className="flex flex-col items-end">
                                <span className={asset.total_profit >= 0 ? "text-bull" : "text-bear"}>
                                  {asset.total_profit >= 0 ? "+" : ""}{tl(asset.total_profit)}
                                </span>
                                <span className={`text-[10px] ${asset.total_profit >= 0 ? "text-bull" : "text-bear"}`}>
                                  {asset.profit_percentage >= 0 ? "+" : ""}{asset.profit_percentage.toFixed(2)}%
                                </span>
                                {asset.daily_gain_value != null && asset.daily_change_is_estimate && (
                                  <span className="text-[10px] font-bold text-warn">
                                    bugün ~{asset.daily_gain_value >= 0 ? "+" : ""}{tl(asset.daily_gain_value)}
                                  </span>
                                )}
                              </div>
                            </td>
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
                                className="inline-flex items-center justify-center h-7 w-7 rounded border bg-secondary/40 text-muted-foreground border-border/40 hover:text-bear hover:border-bear/30 cursor-pointer disabled:opacity-50"
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
                  <TickerCombobox
                    value={newAssetTicker}
                    onChange={setNewAssetTicker}
                    placeholder="THYAO"
                    className="w-24"
                    inputClassName="h-8 w-24 text-xs"
                  />
                </div>
                {/* Döviz/altın hızlı seçim - USDTRY/XAUTRYG gerçek ticker
                    kodları (market_data_service'te zaten canlı takip
                    ediliyor, bkz. SPECIAL_EXCHANGES) ama admin bunları ezbere
                    bilmesin diye kısayol. */}
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-muted-foreground opacity-0 select-none">.</label>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => setNewAssetTicker("USDTRY")}
                      className="h-8 px-2 rounded-md border border-input bg-secondary/40 text-[10px] font-bold text-muted-foreground hover:text-foreground hover:border-primary/40 cursor-pointer"
                    >
                      USD/TRY
                    </button>
                    <button
                      type="button"
                      onClick={() => setNewAssetTicker("XAUTRYG")}
                      className="h-8 px-2 rounded-md border border-input bg-secondary/40 text-[10px] font-bold text-muted-foreground hover:text-foreground hover:border-primary/40 cursor-pointer"
                    >
                      Gram Altın
                    </button>
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-muted-foreground">Adet</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={newAssetShares}
                    onChange={e => setNewAssetShares(e.target.value)}
                    placeholder="12,5"
                    className="h-8 w-24 rounded-md border border-input bg-secondary/50 px-2 text-xs focus-visible:outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-muted-foreground">Maliyet (₺)</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={newAssetCost}
                    onChange={e => setNewAssetCost(e.target.value)}
                    placeholder="1.500,50"
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
