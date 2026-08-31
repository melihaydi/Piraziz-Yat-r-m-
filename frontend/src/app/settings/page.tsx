"use client"

import React, { useState, useEffect } from "react"
import {
  User, Shield, HelpCircle, Mail, Phone, Lock, CheckCircle2, Image as ImageIcon,
  Database, KeyRound, Fingerprint, RefreshCw, ScrollText, BadgeCheck, ShieldCheck, MessageCircle,
  Smartphone, XCircle, LogOut, Download, Monitor, Bell, BellOff
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card"
import { Button } from "@/components/ui/Button"
import { Input } from "@/components/ui/Input"
import { authFetch, fetchCurrentUser, getProfilePicKey, logout, resendVerification } from "@/lib/auth"
import { isPushSupported, getPushSubscriptionStatus, subscribeToPush, unsubscribeFromPush } from "@/lib/push"
import { API_BASE_URL } from "@/lib/config"
import PlanCard from "@/components/settings/PlanCard"

function TwoFactorSection({ totpEnabled, onChanged }: { totpEnabled: boolean; onChanged: () => void }) {
  const [step, setStep] = useState<"idle" | "setup" | "disable" | "codes" | "regenerate">("idle")
  const [qrCode, setQrCode] = useState("")
  const [secret, setSecret] = useState("")
  const [code, setCode] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  // Shown exactly once, right after 2FA is enabled or codes are
  // regenerated - the backend only stores hashes, so there is no way to
  // retrieve these again later.
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([])

  const downloadCodes = () => {
    const body =
      "BIP Terminal - 2FA Kurtarma Kodları\n" +
      "Her kod yalnızca bir kez kullanılabilir. Güvenli bir yerde saklayın.\n\n" +
      recoveryCodes.join("\n") + "\n"
    const url = URL.createObjectURL(new Blob([body], { type: "text/plain" }))
    const a = document.createElement("a")
    a.href = url
    a.download = "bip-terminal-kurtarma-kodlari.txt"
    a.click()
    URL.revokeObjectURL(url)
  }

  const startSetup = async () => {
    setError("")
    setLoading(true)
    try {
      const res = await authFetch("/auth/2fa/setup", { method: "POST" })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setError(err.detail || "Kurulum başlatılamadı.")
        setLoading(false)
        return
      }
      const data = await res.json()
      setQrCode(data.qr_code_base64)
      setSecret(data.secret)
      setStep("setup")
    } catch {
      setError("Sunucuya ulaşılamadı.")
    }
    setLoading(false)
  }

  const confirmSetup = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setLoading(true)
    try {
      const res = await authFetch("/auth/2fa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setError(err.detail || "Kod hatalı.")
        setLoading(false)
        return
      }
      const data = await res.json()
      setRecoveryCodes(data.recovery_codes || [])
      setStep("codes")
      setCode("")
      onChanged()
    } catch {
      setError("Sunucuya ulaşılamadı.")
    }
    setLoading(false)
  }

  const regenerateCodes = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setLoading(true)
    try {
      const res = await authFetch("/auth/2fa/recovery-codes/regenerate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setError(err.detail || "Kod hatalı.")
        setLoading(false)
        return
      }
      const data = await res.json()
      setRecoveryCodes(data.recovery_codes || [])
      setStep("codes")
      setCode("")
    } catch {
      setError("Sunucuya ulaşılamadı.")
    }
    setLoading(false)
  }

  const confirmDisable = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setLoading(true)
    try {
      const res = await authFetch("/auth/2fa/disable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setError(err.detail || "Kod hatalı.")
        setLoading(false)
        return
      }
      setStep("idle")
      setCode("")
      onChanged()
    } catch {
      setError("Sunucuya ulaşılamadı.")
    }
    setLoading(false)
  }

  return (
    <Card glass={true}>
      <CardHeader>
        <CardTitle className="t-section flex items-center justify-between">
          <span className="flex items-center">
            <Smartphone className="h-4.5 w-4.5 mr-2 text-primary" />
            İki Adımlı Doğrulama (2FA)
          </span>
          <span className={`text-[9px] font-black px-1.5 py-0.5 rounded border uppercase ${
            totpEnabled ? "bg-bull/10 text-bull border-bull/20" : "bg-secondary text-muted-foreground border-border"
          }`}>
            {totpEnabled ? "Aktif" : "Kapalı"}
          </span>
        </CardTitle>
        <CardDescription>
          Google Authenticator, Microsoft Authenticator gibi bir uygulamayla girişlerinizi ekstra bir kodla koruyun.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <div className="flex items-center space-x-2 text-bear text-xs font-semibold bg-bear/10 p-3 rounded-lg border border-bear/15">
            <span>{error}</span>
          </div>
        )}

        {step === "idle" && !totpEnabled && (
          <Button onClick={startSetup} disabled={loading} className="cursor-pointer font-bold text-xs h-10">
            {loading ? "Hazırlanıyor..." : "2FA'yı Etkinleştir"}
          </Button>
        )}

        {step === "idle" && totpEnabled && (
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => setStep("disable")}
              variant="destructive"
              className="cursor-pointer font-bold text-xs h-10"
            >
              <XCircle className="h-4 w-4 mr-1.5" />
              2FA'yı Devre Dışı Bırak
            </Button>
            <Button
              onClick={() => { setStep("regenerate"); setError("") }}
              variant="outline"
              className="cursor-pointer font-bold text-xs h-10"
            >
              <KeyRound className="h-4 w-4 mr-1.5" />
              Kurtarma Kodlarını Yenile
            </Button>
          </div>
        )}

        {step === "codes" && (
          <div className="space-y-3">
            <div className="p-3 rounded-lg border border-warn/25 bg-warn/5 text-[11px] text-warn/90 leading-relaxed">
              <strong>Bu kodları şimdi kaydedin.</strong> Bir daha gösterilmeyecek. Telefonunuzu
              kaybederseniz hesabınıza girmenin tek yolu bunlar. Her kod yalnızca bir kez kullanılabilir.
            </div>
            <div className="grid grid-cols-2 gap-2 p-3 bg-secondary/20 rounded-lg border border-border/30">
              {recoveryCodes.map((c) => (
                <code key={c} className="text-xs font-mono-code text-foreground text-center py-1">{c}</code>
              ))}
            </div>
            <div className="flex gap-2">
              <Button onClick={downloadCodes} className="cursor-pointer font-bold text-xs h-10">
                <Download className="h-4 w-4 mr-1.5" />
                Kodları İndir (.txt)
              </Button>
              <Button
                variant="outline"
                onClick={() => { setStep("idle"); setRecoveryCodes([]) }}
                className="cursor-pointer font-bold text-xs h-10"
              >
                Kaydettim, kapat
              </Button>
            </div>
          </div>
        )}

        {step === "regenerate" && (
          <form onSubmit={regenerateCodes} className="space-y-4">
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Yeni kodlar üretildiğinde eski kodlarınızın tamamı geçersiz olur. Onaylamak için
              authenticator uygulamanızdaki güncel kodu girin.
            </p>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="000000"
              inputMode="numeric"
              className="bg-secondary/30 text-center text-lg tracking-[0.4em] font-mono-code"
            />
            <div className="flex gap-2">
              <Button type="submit" disabled={loading || code.length < 6} className="flex-1 cursor-pointer font-bold text-xs h-10">
                {loading ? "Üretiliyor..." : "Yeni Kodlar Üret"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => { setStep("idle"); setCode(""); setError("") }}
                className="cursor-pointer font-bold text-xs h-10"
              >
                Vazgeç
              </Button>
            </div>
          </form>
        )}

        {step === "setup" && (
          <form onSubmit={confirmSetup} className="space-y-4">
            <div className="flex flex-col items-center gap-3 p-4 bg-secondary/15 rounded-xl border border-border/30">
              <img src={qrCode} alt="2FA QR Kodu" className="h-40 w-40 rounded-lg border border-border/40 bg-white p-1" />
              <p className="text-[10px] text-muted-foreground text-center">
                Authenticator uygulamanızla QR kodu okutun. Okutamıyorsanız bu anahtarı elle girin:
              </p>
              <code className="text-[11px] font-mono-code bg-secondary/40 px-2 py-1 rounded break-all text-center">{secret}</code>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground font-semibold">Uygulamadaki 6 haneli kodu girin</label>
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="000000"
                inputMode="numeric"
                className="bg-secondary/30 text-center text-lg tracking-[0.4em] font-mono-code"
              />
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={loading || code.length < 6} className="flex-1 cursor-pointer font-bold text-xs h-10">
                {loading ? "Doğrulanıyor..." : "Doğrula ve Etkinleştir"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => { setStep("idle"); setCode(""); setError("") }}
                className="cursor-pointer font-bold text-xs h-10"
              >
                Vazgeç
              </Button>
            </div>
          </form>
        )}

        {step === "disable" && (
          <form onSubmit={confirmDisable} className="space-y-4">
            <p className="text-[11px] text-muted-foreground">
              Devre dışı bırakmak için authenticator uygulamanızdaki güncel kodu girin.
            </p>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="000000"
              inputMode="numeric"
              className="bg-secondary/30 text-center text-lg tracking-[0.4em] font-mono-code"
            />
            <div className="flex gap-2">
              <Button type="submit" variant="destructive" disabled={loading || code.length < 6} className="flex-1 cursor-pointer font-bold text-xs h-10">
                {loading ? "İşleniyor..." : "Devre Dışı Bırak"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => { setStep("idle"); setCode(""); setError("") }}
                className="cursor-pointer font-bold text-xs h-10"
              >
                Vazgeç
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  )
}

// Content for the "Güvenlik & Yetkiler" section (Request: professional security/permissions overview)
const SECURITY_ITEMS = [
  {
    icon: ShieldCheck,
    title: "Veri Güvenliği",
    description: "Sunucu ile uygulama arasındaki tüm veri alışverişi şifreli bağlantı üzerinden yapılır; piyasa verileri ve hesap bilgileriniz üçüncü şahıslarla paylaşılmaz.",
    badge: "Aktif",
    badgeColor: "emerald"
  },
  {
    icon: KeyRound,
    title: "API Yetkileri",
    description: "Uygulama; TradingView (canlı fiyat akışı), Google Gemini (AI analiz) ve KAP (kamuyu aydınlatma) servislerine yalnızca salt-okunur veri çekme yetkisiyle bağlanır.",
    badge: "Salt Okunur",
    badgeColor: "blue"
  },
  {
    icon: Database,
    title: "Yerel Veri Depolama",
    description: "Profil bilgileriniz, favori hisse/fonlarınız ve arayüz tercihleriniz yalnızca bu cihazda (tarayıcı yerel deposunda) tutulur, sunucuya kopyalanmaz.",
    badge: "Yerel",
    badgeColor: "purple"
  },
  {
    icon: Lock,
    title: "Şifreleme Bilgisi",
    description: "Hesap şifreleriniz tek yönlü hash algoritmasıyla saklanır; oturumlarınız HS256 algoritmasıyla imzalanmış JWT belirteçleriyle doğrulanır.",
    badge: "HS256",
    badgeColor: "blue"
  },
  {
    icon: Fingerprint,
    title: "Oturum Güvenliği",
    description: "Giriş oturumlarınız 24 saat (1440 dakika) sonunda otomatik olarak sona erer ve yeniden kimlik doğrulama istenir.",
    badge: "24 Saat",
    badgeColor: "amber"
  },
  {
    icon: RefreshCw,
    title: "Güncelleme Kontrolü",
    description: "Uygulama sürümünüz ve piyasa veri motorunuz düzenli olarak kontrol edilir; kritik güncellemeler otomatik olarak bildirilir.",
    badge: "v0.1.0",
    badgeColor: "zinc"
  },
  {
    icon: ScrollText,
    title: "Loglama",
    description: "Yalnızca hata teşhisi ve alarm/sinyal tetiklemeleri için sınırlı sistem günlüğü tutulur; kişisel veya finansal verileriniz kaydedilmez ya da satılmaz.",
    badge: "Sınırlı",
    badgeColor: "zinc"
  },
  {
    icon: BadgeCheck,
    title: "Lisans Bilgisi",
    description: "Hesabınız BIP Terminal Premium lisansı kapsamında gerçek zamanlı BIST verisi ve TEFAS fon verisi erişimine sahiptir.",
    badge: "Premium",
    badgeColor: "emerald"
  }
]

const BADGE_STYLES: Record<string, string> = {
  emerald: "bg-bull/10 text-bull border-bull/20",
  blue: "bg-secondary text-muted-foreground border-border",
  purple: "bg-secondary text-muted-foreground border-border",
  amber: "bg-secondary text-muted-foreground border-border",
  zinc: "bg-secondary text-muted-foreground border-border"
}

export default function SettingsPage() {
  const [username, setUsername] = useState("")
  const [profilePic, setProfilePic] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("••••••••")
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [authSuccess, setAuthSuccess] = useState(false)
  const [authError, setAuthError] = useState("")
  const [authSubmitting, setAuthSubmitting] = useState(false)
  const [totpEnabled, setTotpEnabled] = useState(false)
  const [isEmailVerified, setIsEmailVerified] = useState(true)
  const [emailDeliveryEnabled, setEmailDeliveryEnabled] = useState(false)
  const [resendState, setResendState] = useState<"idle" | "sending" | "sent">("idle")
  const [role, setRole] = useState("free")
  // Set by /subscription/callback's redirect (see subscription.py) after
  // the buyer returns from iyzico's hosted checkout page - "success" or
  // "failed", read once on mount, not tied to any other state here.
  const [paymentResult, setPaymentResult] = useState<"success" | "failed" | null>(null)

  useEffect(() => {
    if (typeof window === "undefined") return
    const value = new URLSearchParams(window.location.search).get("payment")
    if (value === "success" || value === "failed") {
      setPaymentResult(value)
      const url = new URL(window.location.href)
      url.searchParams.delete("payment")
      window.history.replaceState({}, "", url.toString())
    }
  }, [])

  const refreshProfile = () => {
    fetchCurrentUser().then(user => {
      if (!user) return
      if (user.email) setEmail(user.email)
      setUsername(user.full_name?.trim() || user.email?.split("@")[0] || "")
      setTotpEnabled(!!user.totp_enabled)
      setIsEmailVerified(!!user.is_email_verified)
      setEmailDeliveryEnabled(!!user.email_delivery_enabled)
      if (user.role) setRole(user.role)
    })
  }

  const handleResendVerification = async () => {
    setResendState("sending")
    await resendVerification(email)
    setResendState("sent")
  }

  const [pushSupported, setPushSupported] = useState(false)
  const [pushEnabled, setPushEnabled] = useState(false)
  const [pushLoading, setPushLoading] = useState(false)
  const [pushError, setPushError] = useState("")

  useEffect(() => {
    setPushSupported(isPushSupported())
    getPushSubscriptionStatus().then(setPushEnabled)
  }, [])

  const handleTogglePush = async () => {
    setPushError("")
    setPushLoading(true)
    if (pushEnabled) {
      await unsubscribeFromPush()
      setPushEnabled(false)
    } else {
      const result = await subscribeToPush()
      if (result.ok) {
        setPushEnabled(true)
      } else {
        setPushError(result.error || "Bir hata oluştu.")
      }
    }
    setPushLoading(false)
  }

  // Telegram sabah bülteni bağlantısı - bkz. backend/app/api/v1/endpoints/telegram.py.
  // `configured` false ise bu ortamda bot kurulmamış (TELEGRAM_BOT_USERNAME
  // ayarlanmamış) demek, kart hiç gösterilmiyor.
  const [telegramLink, setTelegramLink] = useState<{
    configured: boolean; linked: boolean; linked_at: string | null
    link_code: string; deep_link: string | null; daily_digest_enabled: boolean
  } | null>(null)
  const [telegramLoading, setTelegramLoading] = useState(false)

  const loadTelegramLink = async () => {
    try {
      const res = await authFetch("/telegram/link")
      if (res.ok) setTelegramLink(await res.json())
    } catch (err) {
      console.error("Failed to load Telegram link status:", err)
    }
  }

  useEffect(() => { loadTelegramLink() }, [])

  const handleRegenerateTelegramCode = async () => {
    setTelegramLoading(true)
    try {
      const res = await authFetch("/telegram/link/regenerate", { method: "POST" })
      if (res.ok) setTelegramLink(await res.json())
    } finally {
      setTelegramLoading(false)
    }
  }

  const handleToggleTelegramDigest = async () => {
    if (!telegramLink) return
    setTelegramLoading(true)
    try {
      const res = await authFetch("/telegram/digest-enabled", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !telegramLink.daily_digest_enabled }),
      })
      if (res.ok) setTelegramLink(await res.json())
    } finally {
      setTelegramLoading(false)
    }
  }

  interface SupportTicket {
    id: number
    subject: string
    message: string
    status: "open" | "closed"
    admin_reply: string | null
    created_at: string
  }
  const [tickets, setTickets] = useState<SupportTicket[]>([])
  const [ticketsLoading, setTicketsLoading] = useState(true)
  const [ticketSubject, setTicketSubject] = useState("")
  const [ticketMessage, setTicketMessage] = useState("")
  const [ticketSubmitting, setTicketSubmitting] = useState(false)
  const [ticketError, setTicketError] = useState("")

  const refreshTickets = () => {
    authFetch("/support/tickets").then(async (res) => {
      if (res.ok) setTickets(await res.json())
      setTicketsLoading(false)
    }).catch(() => setTicketsLoading(false))
  }

  useEffect(() => {
    refreshTickets()
  }, [])

  const handleSubmitTicket = async (e: React.FormEvent) => {
    e.preventDefault()
    setTicketError("")
    if (!ticketSubject || !ticketMessage) {
      setTicketError("Lütfen konu ve mesaj alanlarını doldurun.")
      return
    }
    setTicketSubmitting(true)
    try {
      const res = await authFetch("/support/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject: ticketSubject, message: ticketMessage }),
      })
      if (!res.ok) {
        setTicketError("Talep gönderilemedi.")
        setTicketSubmitting(false)
        return
      }
      setTicketSubject("")
      setTicketMessage("")
      refreshTickets()
    } catch {
      setTicketError("Sunucuya ulaşılamadı.")
    }
    setTicketSubmitting(false)
  }

  const [exportLoading, setExportLoading] = useState(false)
  const handleExportData = async () => {
    setExportLoading(true)
    try {
      const res = await authFetch("/auth/me/export")
      if (res.ok) {
        const data = await res.json()
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = `bip-terminal-verilerim-${new Date().toISOString().slice(0, 10)}.json`
        a.click()
        URL.revokeObjectURL(url)
      }
    } finally {
      setExportLoading(false)
    }
  }

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deletePassword, setDeletePassword] = useState("")
  const [deleteError, setDeleteError] = useState("")
  const [deleteLoading, setDeleteLoading] = useState(false)
  const handleDeleteAccount = async () => {
    setDeleteError("")
    setDeleteLoading(true)
    try {
      const res = await authFetch("/auth/me/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: deletePassword }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setDeleteError(err.detail || "Hesap silinemedi.")
        setDeleteLoading(false)
        return
      }
      logout()
    } catch {
      setDeleteError("Sunucuya ulaşılamadı.")
      setDeleteLoading(false)
    }
  }

  // The display name is real account data (full_name, from the backend) -
  // NOT a localStorage value, so it's consistent across devices/browsers
  // instead of falling back to "Kullanıcı" on any device that never typed
  // it in locally. Only the profile picture (a data URL never sent to the
  // server) stays in localStorage.
  useEffect(() => {
    // Keyed per logged-in user (getProfilePicKey) so switching accounts on
    // the same browser never shows the previous account's photo.
    const key = getProfilePicKey()
    const savedPic = key ? localStorage.getItem(key) : null
    if (savedPic) setProfilePic(savedPic)

    refreshProfile()
  }, [])

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onloadend = () => {
        const base64String = reader.result as string
        setProfilePic(base64String)
      }
      reader.readAsDataURL(file)
    }
  }

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault()
    const key = getProfilePicKey()
    if (key) localStorage.setItem(key, profilePic)

    // Display name is real account data - the backend (full_name) is the
    // only source of truth, Header/etc. all read it fresh from /auth/me.
    await authFetch("/auth/me", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, full_name: username }),
    }).catch(() => {})

    window.dispatchEvent(new Event("profile-updated"))

    setSaveSuccess(true)
    setTimeout(() => setSaveSuccess(false), 3000)
  }

  const handleUpdateAuth = async (e: React.FormEvent) => {
    e.preventDefault()
    setAuthError("")
    setAuthSubmitting(true)
    try {
      const res = await authFetch("/auth/me", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          // Only send a password if the user actually typed a new one -
          // the field shows a "••••••••" placeholder value otherwise.
          ...(password && password !== "••••••••" ? { password } : {}),
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setAuthError(err.detail || "Güncelleme başarısız oldu.")
        setAuthSubmitting(false)
        return
      }
      setPassword("••••••••")
      window.dispatchEvent(new Event("profile-updated"))
      setAuthSuccess(true)
      setTimeout(() => setAuthSuccess(false), 3000)
    } catch (err) {
      setAuthError("Sunucuya ulaşılamadı.")
    }
    setAuthSubmitting(false)
  }

  const [activeSection, setActiveSection] = useState<"profile" | "security" | "privacy" | "help">("profile")

  const scrollToSection = (section: "profile" | "security" | "privacy" | "help") => {
    setActiveSection(section)
    document.getElementById(`section-${section}`)?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      {/* Title */}
      <div className="animate-rise">
        <h1 className="t-display">Hesap ve Uygulama Ayarları</h1>
        <p className="t-caption mt-1.5">
          Kullanıcı profilinizi güncelleyin, hesap bilgilerini yönetin veya destek ekibiyle iletişime geçin.
        </p>
      </div>

      {/* Set once from ?payment=success|failed after iyzico's checkout
          redirects back here (see subscription.py's /callback) - the query
          param itself is stripped on mount so a page refresh doesn't keep
          re-showing it. */}
      {paymentResult && (
        <div className={`animate-pop rounded-xl border px-4 py-3 flex items-center gap-2.5 text-xs font-semibold ${
          paymentResult === "success"
            ? "border-bull/30 bg-bull/10 text-bull"
            : "border-bear/30 bg-bear/10 text-bear"
        }`}>
          {paymentResult === "success" ? (
            <>Ödemeniz alındı, üyeliğiniz güncellendi.</>
          ) : (
            <>Ödeme tamamlanamadı. Lütfen tekrar deneyin.</>
          )}
          <button onClick={() => setPaymentResult(null)} className="ml-auto opacity-70 hover:opacity-100 cursor-pointer">✕</button>
        </div>
      )}

      {/* Only shown when the user can actually do something about it. With
          no SMTP credentials configured server-side the resend button's
          mail silently no-ops, so the banner just nagged permanently with
          no way to clear it - hiding it there is the honest behavior. */}
      {!isEmailVerified && emailDeliveryEnabled && (
        <div className="animate-pop flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warn/25 bg-warn/5 px-4 py-3">
          <div className="flex items-center gap-2 text-warn">
            <Mail className="h-4 w-4 shrink-0" />
            <span className="text-sm font-semibold">
              E-posta adresiniz henüz doğrulanmadı.{" "}
              <span className="font-normal text-warn/80">Hesabınızı kurtarabilmek için doğrulamanız önerilir.</span>
            </span>
          </div>
          <Button
            type="button"
            onClick={handleResendVerification}
            disabled={resendState !== "idle"}
            className="cursor-pointer bg-warn/10 hover:bg-warn/20 text-warn border border-warn/25 text-xs font-bold px-3 py-1.5 h-auto"
          >
            {resendState === "sending" ? "Gönderiliyor..." : resendState === "sent" ? "Gönderildi" : "Doğrulama E-postasını Gönder"}
          </Button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        
        {/* Left Side: Navigation Quick Links */}
        <div className="space-y-4">
          <Card glass={true} className="p-2">
            <div className="space-y-1">
              <button
                onClick={() => scrollToSection("profile")}
                data-active={activeSection === "profile"}
                className={`nav-item press w-full flex items-center px-4 py-3 text-sm font-semibold rounded-lg transition-all text-left cursor-pointer ${
                  activeSection === "profile" ? "bg-primary text-primary-foreground shadow-md" : "text-muted-foreground hover:bg-secondary/40 hover:text-foreground"
                }`}
              >
                <User className="h-4 w-4 mr-3" />
                Profil Bilgileri
              </button>
              <button
                onClick={() => scrollToSection("security")}
                data-active={activeSection === "security"}
                className={`nav-item press w-full flex items-center px-4 py-3 text-sm font-medium rounded-lg transition-all text-left cursor-pointer ${
                  activeSection === "security" ? "bg-primary text-primary-foreground shadow-md font-semibold" : "text-muted-foreground hover:bg-secondary/40 hover:text-foreground"
                }`}
              >
                <Shield className="h-4 w-4 mr-3" />
                Güvenlik & Yetkiler
              </button>
              <button
                onClick={() => scrollToSection("privacy")}
                data-active={activeSection === "privacy"}
                className={`nav-item press w-full flex items-center px-4 py-3 text-sm font-medium rounded-lg transition-all text-left cursor-pointer ${
                  activeSection === "privacy" ? "bg-primary text-primary-foreground shadow-md font-semibold" : "text-muted-foreground hover:bg-secondary/40 hover:text-foreground"
                }`}
              >
                <Database className="h-4 w-4 mr-3" />
                Gizlilik ve Veri
              </button>
              <button
                onClick={() => scrollToSection("help")}
                data-active={activeSection === "help"}
                className={`nav-item press w-full flex items-center px-4 py-3 text-sm font-medium rounded-lg transition-all text-left cursor-pointer ${
                  activeSection === "help" ? "bg-primary text-primary-foreground shadow-md font-semibold" : "text-muted-foreground hover:bg-secondary/40 hover:text-foreground"
                }`}
              >
                <HelpCircle className="h-4 w-4 mr-3" />
                Yardım ve Destek
              </button>
            </div>
          </Card>

          <PlanCard currentRole={role} onUpgraded={refreshProfile} />
        </div>

        {/* Right Side: Tab Forms */}
        <div className="md:col-span-2 space-y-8">

          {/* Profile Form */}
          <Card glass={true} id="section-profile">
            <CardHeader>
              <CardTitle className="t-section flex items-center">
                <User className="h-4.5 w-4.5 mr-2 text-primary" />
                Profil Düzenleme
              </CardTitle>
              <CardDescription>Uygulama genelinde gösterilecek isminiz ve avatarınız.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSaveProfile} className="space-y-5">
                {/* Profile Picture Upload Section (Avatar image, Request 4!) -
                    optional, a generic icon shows when none is set (no more
                    emoji picker to choose between instead). */}
                <div className="flex items-center space-x-4 p-4 bg-secondary/15 rounded-xl border border-border/30">
                  <div className="relative h-16 w-16 rounded-full border border-border flex items-center justify-center bg-secondary/50 overflow-hidden shrink-0">
                    {profilePic ? (
                      <img src={profilePic} className="h-full w-full object-cover" alt="Profile" />
                    ) : (
                      <User className="h-7 w-7 text-muted-foreground" />
                    )}
                  </div>

                  <div className="space-y-1.5 flex-1">
                    <label className="text-xs text-muted-foreground font-semibold block">Profil Fotoğrafı Yükle</label>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleImageUpload}
                      className="text-xs text-muted-foreground file:mr-3 file:py-1 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-primary file:text-primary-foreground hover:file:opacity-90 file:cursor-pointer"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground font-semibold">Görünen Ad</label>
                  <Input
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Ömer Faruk"
                    className="bg-secondary/30"
                    required
                  />
                </div>

                {saveSuccess && (
                  <div className="flex items-center space-x-2 text-bull text-xs font-semibold bg-bull/10 p-3 rounded-lg border border-bull/15">
                    <CheckCircle2 className="h-4 w-4" />
                    <span>Profil ayarlarınız başarıyla kaydedildi!</span>
                  </div>
                )}

                <Button type="submit" className="w-full cursor-pointer font-bold text-xs h-10">Değişiklikleri Kaydet</Button>
              </form>
            </CardContent>
          </Card>

          {/* Account email/password update - a real call against the
              backend account (PUT /auth/me), not a local-only mock. */}
          <Card glass={true}>
            <CardHeader>
              <CardTitle className="t-section flex items-center">
                <Lock className="h-4.5 w-4.5 mr-2 text-primary" />
                Hesap Bilgileri
              </CardTitle>
              <CardDescription>E-posta adresinizi veya şifrenizi güncelleyin.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleUpdateAuth} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground font-semibold">E-posta Adresi</label>
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="bg-secondary/30"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground font-semibold">Yeni Şifre (değiştirmek istemiyorsanız boş bırakın)</label>
                  <Input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="bg-secondary/30"
                  />
                </div>

                {authError && (
                  <div className="flex items-center space-x-2 text-bear text-xs font-semibold bg-bear/10 p-3 rounded-lg border border-bear/15">
                    <span>{authError}</span>
                  </div>
                )}

                {authSuccess && (
                  <div className="flex items-center space-x-2 text-bull text-xs font-semibold bg-bull/10 p-3 rounded-lg border border-bull/15">
                    <CheckCircle2 className="h-4 w-4" />
                    <span>Hesap bilgileriniz güncellendi!</span>
                  </div>
                )}

                <Button type="submit" disabled={authSubmitting} className="w-full cursor-pointer font-bold text-xs h-10">
                  {authSubmitting ? "Güncelleniyor..." : "Bilgileri Güncelle"}
                </Button>
              </form>

              <div className="mt-6 pt-5 border-t border-border/40">
                <button
                  type="button"
                  onClick={logout}
                  className="w-full flex items-center justify-center gap-2 h-10 rounded-md text-xs font-bold text-bear border border-bear/25 bg-bear/5 hover:bg-bear/15 transition-colors cursor-pointer"
                >
                  <LogOut className="h-4 w-4" />
                  Çıkış Yap
                </button>
              </div>
            </CardContent>
          </Card>

          {/* Desktop app installer - a static file served directly by
              Caddy (see /download/* in the Caddyfile), not the backend
              API. Same domain as everything else, no separate host to
              maintain. */}
          <Card glass={true}>
            <CardHeader>
              <CardTitle className="t-section flex items-center">
                <Monitor className="h-4.5 w-4.5 mr-2 text-primary" />
                Masaüstü ve Mobil Uygulamalar
              </CardTitle>
              <CardDescription>Windows masaüstü uygulamasını veya Android APK'sını indirin.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <a
                href={`${API_BASE_URL}/download/BIPTerminal-Setup.exe`}
                className="w-full flex items-center justify-center gap-2 h-10 rounded-md text-xs font-bold text-primary border border-primary/25 bg-primary/5 hover:bg-primary/15 transition-colors cursor-pointer"
              >
                <Download className="h-4 w-4" />
                İndir (.exe, Windows)
              </a>
              <a
                href={`${API_BASE_URL}/download/BIPTerminal.apk`}
                className="w-full flex items-center justify-center gap-2 h-10 rounded-md text-xs font-bold text-bull border border-bull/25 bg-bull/5 hover:bg-bull/15 transition-colors cursor-pointer"
              >
                <Smartphone className="h-4 w-4" />
                İndir (.apk, Android)
              </a>
            </CardContent>
          </Card>

          <TwoFactorSection totpEnabled={totpEnabled} onChanged={refreshProfile} />

          {/* Security & Permissions */}
          <Card glass={true} id="section-security" className="border-primary/10">
            <CardHeader>
              <CardTitle className="t-section flex items-center">
                <Shield className="h-4.5 w-4.5 mr-2 text-primary" />
                Güvenlik & Yetkiler
              </CardTitle>
              <CardDescription>Verilerinizin nasıl korunduğu, hangi servislere hangi yetkiyle bağlanıldığı ve hesap güvenliğinize dair bilgiler.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {SECURITY_ITEMS.map((item) => {
                  const Icon = item.icon
                  return (
                    <div
                      key={item.title}
                      className="p-3.5 bg-secondary/20 rounded-lg border border-border/30 hover:border-border/60 transition-colors space-y-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center min-w-0">
                          <div className="p-1.5 rounded-md bg-primary/10 text-primary mr-2.5 shrink-0">
                            <Icon className="h-3.5 w-3.5" />
                          </div>
                          <span className="text-xs font-bold text-foreground truncate">{item.title}</span>
                        </div>
                        <span className={`text-[9px] font-black px-1.5 py-0.5 rounded border uppercase shrink-0 ${BADGE_STYLES[item.badgeColor]}`}>
                          {item.badge}
                        </span>
                      </div>
                      <p className="text-[10.5px] text-muted-foreground leading-relaxed">{item.description}</p>
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>

          {/* Notifications */}
          <Card glass={true}>
            <CardHeader>
              <CardTitle className="t-section flex items-center">
                <Bell className="h-4.5 w-4.5 mr-2 text-primary" />
                Bildirimler
              </CardTitle>
              <CardDescription>Fiyat/alarm bildirimleri e-posta ile gönderilir. Tarayıcı bildirimlerini de burada açabilirsiniz.</CardDescription>
            </CardHeader>
            <CardContent>
              {!pushSupported ? (
                <p className="text-xs text-muted-foreground">Bu tarayıcı/cihaz tarayıcı bildirimlerini desteklemiyor.</p>
              ) : (
                <div className="flex items-center justify-between gap-4 p-4 bg-secondary/20 rounded-lg border border-border/30">
                  <div className="flex items-center gap-3">
                    {pushEnabled ? <Bell className="h-4 w-4 text-primary" /> : <BellOff className="h-4 w-4 text-muted-foreground" />}
                    <div>
                      <p className="text-sm font-bold text-foreground">Tarayıcı Bildirimleri</p>
                      <p className="text-[11px] text-muted-foreground">
                        {pushEnabled ? "Etkin - alarmlarınız bu cihaza da bildirim olarak düşer." : "Kapalı"}
                      </p>
                      {pushError && <p className="text-[11px] text-bear font-semibold mt-1">{pushError}</p>}
                    </div>
                  </div>
                  <Button
                    type="button"
                    onClick={handleTogglePush}
                    disabled={pushLoading}
                    className={`cursor-pointer text-xs font-bold px-4 py-2 h-auto shrink-0 ${
                      pushEnabled
                        ? "bg-secondary/60 hover:bg-secondary text-foreground border border-border/40"
                        : "bg-primary hover:bg-primary/90 text-primary-foreground"
                    }`}
                  >
                    {pushLoading ? "..." : pushEnabled ? "Kapat" : "Aç"}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Telegram sabah bülteni - configured false ise bot bu ortamda
              kurulmamış demek, kart tamamen gizli (yarım/bozuk bir özellik
              göstermek yerine). */}
          {telegramLink?.configured && (
            <Card glass={true}>
              <CardHeader>
                <CardTitle className="t-section flex items-center">
                  <MessageCircle className="h-4.5 w-4.5 mr-2 text-primary" />
                  Telegram Sabah Bülteni
                </CardTitle>
                <CardDescription>
                  Her sabah (BIST açılışından önce) portföyünün dünkü değişimi, tuttuğun hisselerdeki KAP
                  bildirimleri ve fon emir kesme saati hatırlatması Telegram'a düşer.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {telegramLink.linked ? (
                  <div className="flex items-center justify-between gap-4 p-4 bg-secondary/20 rounded-lg border border-border/30">
                    <div className="flex items-center gap-3">
                      <CheckCircle2 className="h-4 w-4 text-bull" />
                      <div>
                        <p className="text-sm font-bold text-foreground">Bağlı</p>
                        <p className="text-[11px] text-muted-foreground">
                          {telegramLink.daily_digest_enabled ? "Sabah bülteni açık." : "Bağlantı var, bülten kapalı."}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <Button
                        type="button"
                        onClick={handleToggleTelegramDigest}
                        disabled={telegramLoading}
                        className="cursor-pointer text-xs font-bold px-4 py-2 h-auto bg-secondary/60 hover:bg-secondary text-foreground border border-border/40"
                      >
                        {telegramLoading ? "..." : telegramLink.daily_digest_enabled ? "Kapat" : "Aç"}
                      </Button>
                      <Button
                        type="button"
                        onClick={handleRegenerateTelegramCode}
                        disabled={telegramLoading}
                        className="cursor-pointer text-xs font-bold px-4 py-2 h-auto bg-secondary/60 hover:bg-secondary text-bear border border-border/40"
                      >
                        Bağlantıyı Kaldır
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="p-4 bg-secondary/20 rounded-lg border border-border/30 space-y-3">
                    <p className="text-xs text-muted-foreground">
                      Aşağıdaki butona basıp Telegram&apos;da botla sohbeti başlat - kod otomatik gönderilecek.
                    </p>
                    <div className="flex items-center gap-2">
                      {telegramLink.deep_link && (
                        <a href={telegramLink.deep_link} target="_blank" rel="noopener noreferrer">
                          <Button type="button" className="cursor-pointer text-xs font-bold px-4 py-2 h-auto bg-primary hover:bg-primary/90 text-primary-foreground">
                            Telegram&apos;da Bağla
                          </Button>
                        </a>
                      )}
                      <span className="text-[11px] text-muted-foreground font-mono">
                        ya da elle: /start {telegramLink.link_code}
                      </span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Privacy & Data Rights (KVKK m.11) */}
          <Card glass={true} id="section-privacy">
            <CardHeader>
              <CardTitle className="t-section flex items-center">
                <Database className="h-4.5 w-4.5 mr-2 text-primary" />
                Gizlilik ve Veri
              </CardTitle>
              <CardDescription>
                KVKK madde 11 kapsamında verilerinize erişim ve hesabınızı silme haklarınız. Detaylar için{" "}
                <a href="/legal/privacy" target="_blank" rel="noopener noreferrer" className="text-primary underline">
                  Gizlilik Politikası
                </a>.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between gap-4 p-4 bg-secondary/20 rounded-lg border border-border/30">
                <div>
                  <p className="text-sm font-bold text-foreground">Verilerimi İndir</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Hesabınıza ait tüm verileri (profil, işlem geçmişi, portföyler, notlar, alarmlar) JSON olarak indirin.
                  </p>
                </div>
                <Button
                  type="button"
                  onClick={handleExportData}
                  disabled={exportLoading}
                  className="cursor-pointer bg-secondary/60 hover:bg-secondary text-foreground border border-border/40 text-xs font-bold px-4 py-2 h-auto shrink-0"
                >
                  {exportLoading ? "Hazırlanıyor..." : "İndir"}
                </Button>
              </div>

              <div className="p-4 bg-bear/5 rounded-lg border border-bear/20 space-y-3">
                <div>
                  <p className="text-sm font-bold text-bear">Hesabımı Sil</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Hesabınız devre dışı bırakılır ve kişisel verileriniz (e-posta, isim) anonimleştirilir. Bu işlem geri alınamaz.
                  </p>
                </div>
                {!showDeleteConfirm ? (
                  <Button
                    type="button"
                    onClick={() => setShowDeleteConfirm(true)}
                    className="cursor-pointer bg-bear/10 hover:bg-bear/20 text-bear border border-bear/25 text-xs font-bold px-4 py-2 h-auto"
                  >
                    Hesabımı Sil
                  </Button>
                ) : (
                  <div className="space-y-2.5">
                    {deleteError && (
                      <p className="text-[11px] text-bear font-semibold">{deleteError}</p>
                    )}
                    <Input
                      type="password"
                      value={deletePassword}
                      onChange={(e) => setDeletePassword(e.target.value)}
                      placeholder="Şifrenizi girerek onaylayın"
                      className="bg-secondary/60 border-border max-w-xs"
                    />
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        onClick={handleDeleteAccount}
                        disabled={deleteLoading || !deletePassword}
                        className="cursor-pointer bg-bear hover:bg-bear/90 text-white text-xs font-bold px-4 py-2 h-auto"
                      >
                        {deleteLoading ? "Siliniyor..." : "Kalıcı Olarak Sil"}
                      </Button>
                      <button
                        type="button"
                        onClick={() => { setShowDeleteConfirm(false); setDeletePassword(""); setDeleteError("") }}
                        className="text-xs text-muted-foreground hover:text-foreground cursor-pointer"
                      >
                        Vazgeç
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Help & Support */}
          <Card glass={true} id="section-help">
            <CardHeader>
              <CardTitle className="t-section flex items-center">
                <HelpCircle className="h-4.5 w-4.5 mr-2 text-primary" />
                Yardım & Destek
              </CardTitle>
              <CardDescription>Sorularınız veya teknik problemleriniz için bizimle doğrudan iletişime geçin.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <a
                  href="mailto:melihaydi@gmail.com"
                  className="group flex flex-col p-4 bg-gradient-to-br from-secondary/25 to-secondary/5 rounded-xl border border-border/40 hover:border-primary/40 transition-all"
                >
                  <div className="inline-flex p-2.5 rounded-lg bg-primary/10 text-primary w-fit mb-3 group-hover:bg-primary/20 transition-colors">
                    <Mail className="h-4.5 w-4.5" />
                  </div>
                  <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">E-posta Desteği</p>
                  <p className="text-foreground font-mono-code text-sm mt-1 break-all">melihaydi@gmail.com</p>
                  <span className="text-[10px] text-primary font-semibold mt-2 flex items-center">
                    E-posta gönder <MessageCircle className="h-3 w-3 ml-1" />
                  </span>
                </a>

                <a
                  href="tel:+905550001122"
                  className="group flex flex-col p-4 bg-gradient-to-br from-secondary/25 to-secondary/5 rounded-xl border border-border/40 hover:border-primary/40 transition-all"
                >
                  <div className="inline-flex p-2.5 rounded-lg bg-primary/10 text-primary w-fit mb-3 group-hover:bg-primary/20 transition-colors">
                    <Phone className="h-4.5 w-4.5" />
                  </div>
                  <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Telefon Desteği</p>
                  <p className="text-foreground font-mono-code text-sm mt-1">0555 000 11 22</p>
                  <span className="text-[10px] text-primary font-semibold mt-2 flex items-center">
                    Hemen ara <MessageCircle className="h-3 w-3 ml-1" />
                  </span>
                </a>
              </div>

              <div className="mt-6 pt-6 border-t border-border/40 space-y-4">
                <div>
                  <p className="text-sm font-bold text-foreground">Destek Talebi Oluştur</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Talebiniz kaydedilir ve yanıt geldiğinde e-posta ile bilgilendirilirsiniz.</p>
                </div>
                {ticketError && (
                  <p className="text-[11px] text-bear font-semibold">{ticketError}</p>
                )}
                <form onSubmit={handleSubmitTicket} className="space-y-2.5">
                  <Input
                    value={ticketSubject}
                    onChange={(e) => setTicketSubject(e.target.value)}
                    placeholder="Konu"
                    className="bg-secondary/60 border-border"
                  />
                  <textarea
                    value={ticketMessage}
                    onChange={(e) => setTicketMessage(e.target.value)}
                    placeholder="Mesajınız..."
                    rows={3}
                    className="w-full text-sm rounded-md bg-secondary/60 border border-border px-3 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
                  />
                  <Button
                    type="submit"
                    disabled={ticketSubmitting}
                    className="cursor-pointer bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-bold px-4 py-2 h-auto"
                  >
                    {ticketSubmitting ? "Gönderiliyor..." : "Talebi Gönder"}
                  </Button>
                </form>

                {!ticketsLoading && tickets.length > 0 && (
                  <div className="space-y-2 pt-2">
                    <p className="text-[10px] font-black text-muted-foreground uppercase tracking-wider">Taleplerim</p>
                    {tickets.map((t) => (
                      <div key={t.id} className="p-3 bg-secondary/20 rounded-lg border border-border/30 space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-bold text-foreground">{t.subject}</span>
                          <span className={`text-[9px] font-black px-1.5 py-0.5 rounded border uppercase shrink-0 ${
                            t.status === "open" ? "bg-warn/10 text-warn border-warn/20" : "bg-bull/10 text-bull border-bull/20"
                          }`}>
                            {t.status === "open" ? "Açık" : "Kapalı"}
                          </span>
                        </div>
                        <p className="text-[11px] text-muted-foreground">{t.message}</p>
                        {t.admin_reply && (
                          <div className="mt-1.5 pt-1.5 border-t border-border/30">
                            <p className="text-[10px] font-bold text-primary">Yanıt</p>
                            <p className="text-[11px] text-foreground/90">{t.admin_reply}</p>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

        </div>
      </div>
    </div>
  )
}
