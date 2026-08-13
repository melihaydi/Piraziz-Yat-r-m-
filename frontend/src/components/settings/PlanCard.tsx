"use client"

import React, { useEffect, useState } from "react"
import { Sparkles, Loader2, CreditCard, X } from "lucide-react"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card"
import { Button } from "@/components/ui/Button"
import { Input } from "@/components/ui/Input"
import { authFetch } from "@/lib/auth"

interface Plan {
  role: string
  price_try: number
  period_days: number
}

const ROLE_LABEL: Record<string, string> = {
  free: "Ücretsiz",
  premium: "Premium",
}

const tl = (n: number) => `₺${n.toLocaleString("tr-TR", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`

/**
 * Real iyzico-backed checkout - replaces a previous hardcoded "Premium
 * Lisans Aktif" card that showed the same message to every user regardless
 * of their actual tier (dead UI from before any payment integration
 * existed). Self-contained (own state/fetches) rather than folded into
 * settings/page.tsx's already very large state block.
 */
export default function PlanCard({ currentRole, onUpgraded }: { currentRole: string; onUpgraded?: () => void }) {
  const [plans, setPlans] = useState<Plan[]>([])
  const [configured, setConfigured] = useState(true)
  const [checkoutRole, setCheckoutRole] = useState<string | null>(null)
  const [identityNumber, setIdentityNumber] = useState("")
  const [city, setCity] = useState("")
  const [address, setAddress] = useState("")
  const [gsmNumber, setGsmNumber] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")
  const [canceling, setCanceling] = useState(false)

  useEffect(() => {
    authFetch("/subscription/plans")
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (!data) return
        setPlans(data.plans || [])
        setConfigured(!!data.configured)
      })
      .catch(() => {})
  }, [])

  const startCheckout = (role: string) => {
    setCheckoutRole(role)
    setError("")
  }

  const submitCheckout = async () => {
    if (!checkoutRole) return
    setSubmitting(true)
    setError("")
    try {
      const res = await authFetch("/subscription/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: checkoutRole,
          identity_number: identityNumber.trim(),
          city: city.trim() || undefined,
          address: address.trim() || undefined,
          gsm_number: gsmNumber.trim() || undefined,
        }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        setError(body?.detail || "Ödeme başlatılamadı.")
        return
      }
      // Hand off to iyzico's hosted checkout page - it redirects back to
      // our own /settings?payment=... once the buyer finishes there.
      window.location.href = body.payment_page_url
    } catch (e) {
      setError("Sunucuya ulaşılamadı.")
    } finally {
      setSubmitting(false)
    }
  }

  const cancelPlan = async () => {
    if (!window.confirm("Üyeliğinizi iptal edip ücretsiz plana geçmek istediğinize emin misiniz?")) return
    setCanceling(true)
    try {
      const res = await authFetch("/subscription/cancel", { method: "POST" })
      if (res.ok) onUpgraded?.()
    } finally {
      setCanceling(false)
    }
  }

  return (
    <Card glass={true} className="bg-gradient-to-br from-card to-emerald-950/10 border-emerald-500/20">
      <CardHeader>
        <CardTitle className="text-base flex items-center">
          <Sparkles className="h-4.5 w-4.5 mr-2 text-emerald-400" />
          Üyelik Planı
        </CardTitle>
        <CardDescription>
          Şu anki planınız: <strong className="text-foreground">{ROLE_LABEL[currentRole] || currentRole}</strong>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!configured && (
          <p className="text-[11px] text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
            Ödeme sistemi şu anda devre dışı. Kısa süre sonra tekrar deneyin.
          </p>
        )}

        {currentRole !== "free" && (
          <Button
            type="button"
            variant="ghost"
            onClick={cancelPlan}
            disabled={canceling}
            className="w-full h-8 text-[11px] font-bold text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 cursor-pointer"
          >
            {canceling ? "İptal ediliyor..." : "Üyeliği İptal Et (Ücretsiz Plana Dön)"}
          </Button>
        )}

        <div className="grid grid-cols-1 sm:max-w-xs sm:mx-auto gap-2">
          {plans.map(plan => (
            <div key={plan.role} className="rounded-lg border border-border/50 bg-secondary/20 p-3 text-center space-y-1.5">
              <span className="text-[10px] font-bold uppercase text-muted-foreground">{ROLE_LABEL[plan.role] || plan.role}</span>
              <p className="text-lg font-extrabold text-foreground">{tl(plan.price_try)}<span className="text-[10px] font-medium text-muted-foreground">/ay</span></p>
              <Button
                type="button"
                onClick={() => startCheckout(plan.role)}
                disabled={!configured || currentRole === plan.role}
                className="w-full h-7 text-[10px] font-bold cursor-pointer"
              >
                {currentRole === plan.role ? "Aktif" : "Seç"}
              </Button>
            </div>
          ))}
        </div>

        {checkoutRole && (
          <div className="rounded-xl border border-emerald-500/25 bg-emerald-950/10 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-extrabold text-foreground flex items-center gap-1.5">
                <CreditCard className="h-3.5 w-3.5 text-emerald-400" />
                {ROLE_LABEL[checkoutRole]} - Ödeme Bilgileri
              </span>
              <button onClick={() => setCheckoutRole(null)} className="text-muted-foreground hover:text-foreground cursor-pointer">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              T.C. Kimlik Numaranız yalnızca ödeme sağlayıcısına (iyzico) iletilir, bizim sunucularımızda
              saklanmaz.
            </p>
            <Input
              placeholder="T.C. Kimlik No"
              value={identityNumber}
              onChange={e => setIdentityNumber(e.target.value)}
              maxLength={11}
              className="h-8 text-xs"
            />
            <div className="grid grid-cols-2 gap-2">
              <Input placeholder="Şehir (opsiyonel)" value={city} onChange={e => setCity(e.target.value)} className="h-8 text-xs" />
              <Input placeholder="Telefon (opsiyonel)" value={gsmNumber} onChange={e => setGsmNumber(e.target.value)} className="h-8 text-xs" />
            </div>
            <Input placeholder="Adres (opsiyonel)" value={address} onChange={e => setAddress(e.target.value)} className="h-8 text-xs" />
            {error && <p className="text-[11px] text-rose-400">{error}</p>}
            <Button
              type="button"
              onClick={submitCheckout}
              disabled={submitting || identityNumber.trim().length !== 11}
              className="w-full h-8 text-xs font-bold cursor-pointer"
            >
              {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Ödemeye Geç"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
