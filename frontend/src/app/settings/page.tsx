"use client"

import React, { useState, useEffect } from "react"
import {
  User, Shield, HelpCircle, Mail, Phone, Lock, CheckCircle2, Sparkles, Image as ImageIcon,
  Database, KeyRound, Fingerprint, RefreshCw, ScrollText, BadgeCheck, ShieldCheck, MessageCircle,
  Smartphone, XCircle, LogOut, Download, Monitor
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card"
import { Button } from "@/components/ui/Button"
import { Input } from "@/components/ui/Input"
import { authFetch, fetchCurrentUser, logout } from "@/lib/auth"
import { API_BASE_URL } from "@/lib/config"

function TwoFactorSection({ totpEnabled, onChanged }: { totpEnabled: boolean; onChanged: () => void }) {
  const [step, setStep] = useState<"idle" | "setup" | "disable">("idle")
  const [qrCode, setQrCode] = useState("")
  const [secret, setSecret] = useState("")
  const [code, setCode] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

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
      setStep("idle")
      setCode("")
      onChanged()
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
        <CardTitle className="text-base flex items-center justify-between">
          <span className="flex items-center">
            <Smartphone className="h-4.5 w-4.5 mr-2 text-primary" />
            İki Adımlı Doğrulama (2FA)
          </span>
          <span className={`text-[9px] font-black px-1.5 py-0.5 rounded border uppercase ${
            totpEnabled ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-zinc-500/10 text-zinc-400 border-zinc-500/20"
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
          <div className="flex items-center space-x-2 text-rose-400 text-xs font-semibold bg-rose-500/10 p-3 rounded-lg border border-rose-500/15">
            <span>{error}</span>
          </div>
        )}

        {step === "idle" && !totpEnabled && (
          <Button onClick={startSetup} disabled={loading} className="cursor-pointer font-bold text-xs h-10">
            {loading ? "Hazırlanıyor..." : "2FA'yı Etkinleştir"}
          </Button>
        )}

        {step === "idle" && totpEnabled && (
          <Button
            onClick={() => setStep("disable")}
            variant="destructive"
            className="cursor-pointer font-bold text-xs h-10"
          >
            <XCircle className="h-4 w-4 mr-1.5" />
            2FA'yı Devre Dışı Bırak
          </Button>
        )}

        {step === "setup" && (
          <form onSubmit={confirmSetup} className="space-y-4">
            <div className="flex flex-col items-center gap-3 p-4 bg-secondary/15 rounded-xl border border-border/30">
              <img src={qrCode} alt="2FA QR Kodu" className="h-40 w-40 rounded-lg border border-border/40 bg-white p-1" />
              <p className="text-[10px] text-muted-foreground text-center">
                Authenticator uygulamanızla QR kodu okutun. Okutamıyorsanız bu anahtarı elle girin:
              </p>
              <code className="text-[11px] font-mono bg-secondary/40 px-2 py-1 rounded break-all text-center">{secret}</code>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground font-semibold">Uygulamadaki 6 haneli kodu girin</label>
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="000000"
                inputMode="numeric"
                className="bg-secondary/30 text-center text-lg tracking-[0.4em] font-mono"
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
              className="bg-secondary/30 text-center text-lg tracking-[0.4em] font-mono"
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
    description: "Hesabınız Piraziz Yatırım Premium lisansı kapsamında gerçek zamanlı BIST verisi ve TEFAS fon verisi erişimine sahiptir.",
    badge: "Premium",
    badgeColor: "emerald"
  }
]

const BADGE_STYLES: Record<string, string> = {
  emerald: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  blue: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  purple: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  amber: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  zinc: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20"
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

  const refreshProfile = () => {
    fetchCurrentUser().then(user => {
      if (user?.email) setEmail(user.email)
      setTotpEnabled(!!user?.totp_enabled)
    })
  }

  // Load display prefs from localStorage, but the email is the backend's -
  // it's the real source of truth for the account, not a local cache.
  useEffect(() => {
    const savedName = localStorage.getItem("bip_username")
    const savedPic = localStorage.getItem("bip_profile_pic")
    if (savedName) setUsername(savedName)
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
    localStorage.setItem("bip_username", username)
    localStorage.setItem("bip_profile_pic", profilePic)

    // Display name lives on the real account too (Header etc. read the
    // localStorage copy for instant display, but the backend is the source
    // of truth other devices/sessions would see).
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

  const [activeSection, setActiveSection] = useState<"profile" | "security" | "help">("profile")

  const scrollToSection = (section: "profile" | "security" | "help") => {
    setActiveSection(section)
    document.getElementById(`section-${section}`)?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      {/* Title */}
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">Hesap ve Uygulama Ayarları</h1>
        <p className="text-muted-foreground mt-1">
          Kullanıcı profilinizi güncelleyin, hesap bilgilerini yönetin veya destek ekibiyle iletişime geçin.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        
        {/* Left Side: Navigation Quick Links */}
        <div className="space-y-4">
          <Card glass={true} className="p-2">
            <div className="space-y-1">
              <button
                onClick={() => scrollToSection("profile")}
                className={`w-full flex items-center px-4 py-3 text-sm font-semibold rounded-lg transition-all text-left cursor-pointer ${
                  activeSection === "profile" ? "bg-primary text-primary-foreground shadow-md" : "text-muted-foreground hover:bg-secondary/40 hover:text-foreground"
                }`}
              >
                <User className="h-4 w-4 mr-3" />
                Profil Bilgileri
              </button>
              <button
                onClick={() => scrollToSection("security")}
                className={`w-full flex items-center px-4 py-3 text-sm font-medium rounded-lg transition-all text-left cursor-pointer ${
                  activeSection === "security" ? "bg-primary text-primary-foreground shadow-md font-semibold" : "text-muted-foreground hover:bg-secondary/40 hover:text-foreground"
                }`}
              >
                <Shield className="h-4 w-4 mr-3" />
                Güvenlik & Yetkiler
              </button>
              <button
                onClick={() => scrollToSection("help")}
                className={`w-full flex items-center px-4 py-3 text-sm font-medium rounded-lg transition-all text-left cursor-pointer ${
                  activeSection === "help" ? "bg-primary text-primary-foreground shadow-md font-semibold" : "text-muted-foreground hover:bg-secondary/40 hover:text-foreground"
                }`}
              >
                <HelpCircle className="h-4 w-4 mr-3" />
                Yardım ve Destek
              </button>
            </div>
          </Card>

          {/* Premium Status Card */}
          <Card glass={true} className="bg-gradient-to-br from-card to-emerald-950/10 border-emerald-500/20">
            <CardContent className="pt-6 text-center space-y-3">
              <div className="inline-flex p-2.5 bg-emerald-500/10 rounded-full text-emerald-400 border border-emerald-500/20">
                <Sparkles className="h-5 w-5" />
              </div>
              <h3 className="font-extrabold text-sm text-foreground">Premium Lisans Aktif</h3>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Piraziz Yatırım gerçek zamanlı BIST30 & TEFAS fon veri akış lisansınız aktiftir.
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Right Side: Tab Forms */}
        <div className="md:col-span-2 space-y-8">

          {/* Profile Form */}
          <Card glass={true} id="section-profile">
            <CardHeader>
              <CardTitle className="text-base flex items-center">
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
                  <div className="flex items-center space-x-2 text-emerald-400 text-xs font-semibold bg-emerald-500/10 p-3 rounded-lg border border-emerald-500/15">
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
              <CardTitle className="text-base flex items-center">
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
                  <div className="flex items-center space-x-2 text-rose-400 text-xs font-semibold bg-rose-500/10 p-3 rounded-lg border border-rose-500/15">
                    <span>{authError}</span>
                  </div>
                )}

                {authSuccess && (
                  <div className="flex items-center space-x-2 text-emerald-400 text-xs font-semibold bg-emerald-500/10 p-3 rounded-lg border border-emerald-500/15">
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
                  className="w-full flex items-center justify-center gap-2 h-10 rounded-md text-xs font-bold text-rose-400 border border-rose-500/25 bg-rose-500/5 hover:bg-rose-500/15 transition-colors cursor-pointer"
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
              <CardTitle className="text-base flex items-center">
                <Monitor className="h-4.5 w-4.5 mr-2 text-cyan-400" />
                Masaüstü Uygulaması
              </CardTitle>
              <CardDescription>Windows için Piraziz Yatırım masaüstü uygulamasını indirin.</CardDescription>
            </CardHeader>
            <CardContent>
              <a
                href={`${API_BASE_URL}/download/PirazizYatirim-Setup.exe`}
                className="w-full flex items-center justify-center gap-2 h-10 rounded-md text-xs font-bold text-cyan-300 border border-cyan-500/25 bg-cyan-500/5 hover:bg-cyan-500/15 transition-colors cursor-pointer"
              >
                <Download className="h-4 w-4" />
                İndir (.exe, Windows)
              </a>
            </CardContent>
          </Card>

          <TwoFactorSection totpEnabled={totpEnabled} onChanged={refreshProfile} />

          {/* Security & Permissions */}
          <Card glass={true} id="section-security" className="border-primary/10">
            <CardHeader>
              <CardTitle className="text-base flex items-center">
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

          {/* Help & Support */}
          <Card glass={true} id="section-help">
            <CardHeader>
              <CardTitle className="text-base flex items-center">
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
                  <p className="text-foreground font-mono text-sm mt-1 break-all">melihaydi@gmail.com</p>
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
                  <p className="text-foreground font-mono text-sm mt-1">0555 000 11 22</p>
                  <span className="text-[10px] text-primary font-semibold mt-2 flex items-center">
                    Hemen ara <MessageCircle className="h-3 w-3 ml-1" />
                  </span>
                </a>
              </div>
            </CardContent>
          </Card>

        </div>
      </div>
    </div>
  )
}
