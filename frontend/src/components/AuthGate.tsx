"use client"

import React, { useState, useEffect } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { User, Mail, Lock, LogIn, ArrowRight, CheckCircle2, Loader2, ShieldCheck } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card"
import { Button } from "@/components/ui/Button"
import { Input } from "@/components/ui/Input"
import { login, register, fetchCurrentUser, verifyTwoFactor, API_BASE_URL } from "@/lib/auth"
import { refreshCurrentUser } from "@/lib/currentUserStore"

interface AuthGateProps {
  children: React.ReactNode
}

// Routes that must render even for a logged-out visitor - password reset
// links and legal pages are handed out (or need to be readable) before
// anyone has a session.
const PUBLIC_PATHS = ["/forgot-password", "/reset-password", "/verify-email", "/scorecard"]
// /funds/PHE gibi fon detay sayfaları da herkese açık - fon kompozisyonu/
// fiyat verisi kişisel değil, ve sayfanın tek kimlik doğrulamalı kısmı
// ("Bugün Alırsan" canlı tahmin kartı) zaten kendi authFetch'inin 401'ini
// sessizce yutup göstermiyor (bkz. funds/[code]/page.tsx) - anonim ziyaretçi
// sayfanın geri kalanını (fiyat, grafik, holdings) tam görür.
// /funds/compare veya /funds gibi liste/karşılaştırma rotalarını KAPSAMAZ -
// sadece tek bir fon koduna denk gelen segment.
const isFundDetailPath = (path: string) => /^\/funds\/[a-zA-Z0-9]+$/.test(path)
const isPublicPath = (path: string | null) =>
  !!path && (PUBLIC_PATHS.includes(path) || path.startsWith("/legal/") || isFundDetailPath(path))

export default function AuthGate({ children }: AuthGateProps) {
  const pathname = usePathname()
  const publicRoute = isPublicPath(pathname)

  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [checkingSession, setCheckingSession] = useState(true)
  const [isRegister, setIsRegister] = useState(false)

  // Google ile Giris. Sunucuda GOOGLE_CLIENT_ID/SECRET ayarlanmamissa buton
  // HIC gosterilmiyor - yapilandirilmamis bir ozellik icin tiklanip hata
  // alinan bir buton koymamak icin.
  const [googleEnabled, setGoogleEnabled] = useState(false)
  useEffect(() => {
    fetch(`${API_BASE_URL}/auth/google/enabled`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => setGoogleEnabled(!!d?.enabled))
      .catch(() => setGoogleEnabled(false))
  }, [])

  // Google callback'i frontend'e TEK KULLANIMLIK bir kod ile donuyor;
  // gercek JWT bu kodun POST ile degisilmesiyle aliniyor. Token'i query
  // string'de tasimak onu tarayici gecmisine ve Referer basligina
  // dusururdu - bkz. backend services/google_oauth.py.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const gerr = params.get("google_error")
    if (gerr) {
      setError(gerr)
      window.history.replaceState({}, "", window.location.pathname)
      return
    }
    const gcode = params.get("google_code")
    if (!gcode) return
    // Kodu adres cubugundan HEMEN temizle - yenilemede tekrar denenmesin.
    window.history.replaceState({}, "", window.location.pathname)
    setLoading(true)
    fetch(`${API_BASE_URL}/auth/google/exchange`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: gcode }),
    })
      .then(async r => {
        const data = await r.json().catch(() => null)
        if (!r.ok) throw new Error(data?.detail || "Google girisi tamamlanamadi.")
        if (data.requires_2fa) {
          // 2FA Google girisinde de ATLANMIYOR - sifreyle giristeki AYNI
          // kod ekranina dusuyor (pendingTempToken dolunca o ekran aciliyor).
          setPendingTempToken(data.temp_token)
          return
        }
        localStorage.setItem("token", data.access_token)
        setIsLoggedIn(true)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  // Form states
  const [fullName, setFullName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [termsAccepted, setTermsAccepted] = useState(false)

  // 2FA step: set once login() reports requires2FA - the form switches to
  // asking for the authenticator code instead of email/password.
  const [pendingTempToken, setPendingTempToken] = useState<string | null>(null)
  const [twoFACode, setTwoFACode] = useState("")
  // Switches the second-step input between a 6-digit TOTP and an
  // alphanumeric recovery code. The backend accepts either at the same
  // endpoint, so this only changes input handling/wording.
  const [useRecoveryCode, setUseRecoveryCode] = useState(false)

  // Validate any stored token against the backend on load, instead of
  // trusting a "bip_logged_in" flag that (previously) was set once and
  // never re-checked - a token can be missing/expired/revoked. Skipped
  // entirely on a public route - no reason to pay for an /auth/me call
  // just to render a password-reset form.
  useEffect(() => {
    if (publicRoute) {
      setCheckingSession(false)
      return
    }
    const verifySession = async () => {
      // Paylaşılan store üzerinden (currentUserStore.ts): AuthGate uygulamanın
      // EN DIŞ katmanı olduğu için isteği ilk o tetikliyor, Header/Sidebar/
      // MobileTabBar ve ana sayfa aynı cevabı önbellekten okuyor - önceden
      // beşi de ayrı ayrı /auth/me çağırıyordu.
      const user = await refreshCurrentUser()
      if (user) {
        setIsLoggedIn(true)
      }
      setCheckingSession(false)
    }
    verifySession()

    const onExpired = () => setIsLoggedIn(false)
    window.addEventListener("bip:session-expired", onExpired)
    return () => window.removeEventListener("bip:session-expired", onExpired)
  }, [publicRoute])

  if (publicRoute) {
    return <>{children}</>
  }

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")

    if (!email || !password || (isRegister && !fullName)) {
      setError("Lütfen tüm alanları doldurun.")
      return
    }
    if (isRegister && !termsAccepted) {
      setError("Devam etmek için Kullanım Koşulları'nı ve KVKK Aydınlatma Metni'ni kabul etmelisiniz.")
      return
    }

    setLoading(true)
    const result = isRegister
      ? await register(email, password, fullName)
      : await login(email, password)
    setLoading(false)

    if (result.requires2FA && result.tempToken) {
      setPendingTempToken(result.tempToken)
      return
    }

    if (!result.ok) {
      setError(result.error || "Bir hata oluştu.")
      return
    }

    setIsLoggedIn(true)
    window.dispatchEvent(new Event("profile-updated"))
  }

  const handleVerify2FA = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    if (!pendingTempToken || twoFACode.length < 6) {
      setError(useRecoveryCode ? "Lütfen kurtarma kodunu girin." : "Lütfen 6 haneli kodu girin.")
      return
    }
    setLoading(true)
    const result = await verifyTwoFactor(pendingTempToken, twoFACode)
    setLoading(false)

    if (!result.ok) {
      setError(result.error || "Bir hata oluştu.")
      return
    }

    setIsLoggedIn(true)
    window.dispatchEvent(new Event("profile-updated"))
  }

  if (checkingSession) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-background animate-fade">
        <span className="text-sm font-black tracking-tight text-gradient-brand">BIP Terminal</span>
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      </div>
    )
  }

  if (isLoggedIn) {
    return <>{children}</>
  }

  if (pendingTempToken) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/85 backdrop-blur-xl p-4">
        {/* V2 atmosfer: birincil ışık emerald, ikincil ışık desatüre grafit -
           mor/mavi ikili değil, globals.css'teki body::before ile aynı dil. */}
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/10 rounded-full blur-3xl blob-a" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-white/5 rounded-full blur-3xl blob-b" />

        <div className="w-full max-w-md relative z-10">
          <Card className="animate-pop surface-modal border-border shadow-[var(--elev-3)]">
            <CardHeader className="text-center pb-2">
              <div className="mx-auto h-12 w-12 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-4">
                <ShieldCheck className="h-6 w-6 text-primary" />
              </div>
              <CardTitle className="text-xl font-black tracking-tight text-foreground">
                İki Adımlı Doğrulama
              </CardTitle>
              <CardDescription className="text-xs text-muted-foreground mt-1">
                {useRecoveryCode
                  ? "Kaydettiğiniz kurtarma kodlarından birini girin"
                  : "Authenticator uygulamanızdaki 6 haneli kodu girin"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {error && (
                <div className="p-3 bg-bear/10 border border-bear/20 rounded-xl text-bear text-xs font-semibold text-center">
                  {error}
                </div>
              )}
              <form onSubmit={handleVerify2FA} className="space-y-3.5">
                {/* Recovery codes contain letters, so the digits-only
                    filter used for TOTP would make them impossible to type -
                    the input has to change shape with the mode. */}
                <Input
                  value={twoFACode}
                  onChange={(e) =>
                    setTwoFACode(
                      useRecoveryCode
                        ? e.target.value.toUpperCase().slice(0, 11)
                        : e.target.value.replace(/\D/g, "").slice(0, 6)
                    )
                  }
                  placeholder={useRecoveryCode ? "ABCDE-FGHIJ" : "000000"}
                  inputMode={useRecoveryCode ? "text" : "numeric"}
                  autoFocus
                  className={`text-center font-mono-code bg-secondary/50 border-border ${
                    useRecoveryCode ? "text-lg tracking-[0.15em]" : "text-2xl tracking-[0.5em]"
                  }`}
                />
                {/* className override yok - Button'ın kendi "default" varyantı
                    zaten tek doğru V2 birincil buton (bg-primary tonal
                    gradyanı, Button.tsx). Burada özel bir mor/indigo gradyan
                    tutmanın bir anlamı yoktu. */}
                <Button type="submit" disabled={loading} className="w-full font-black text-sm py-2.5">
                  {loading ? <Loader2 className="h-4.5 w-4.5 animate-spin" /> : "Doğrula ve Giriş Yap"}
                </Button>
              </form>

              <button
                onClick={() => { setUseRecoveryCode(v => !v); setTwoFACode(""); setError("") }}
                className="w-full text-center text-[11px] text-primary hover:text-primary-hover transition-colors cursor-pointer"
              >
                {useRecoveryCode
                  ? "Authenticator kodu ile gir"
                  : "Telefonuma erişemiyorum, kurtarma kodu kullan"}
              </button>
              <button
                onClick={() => { setPendingTempToken(null); setTwoFACode(""); setError("") }}
                className="w-full text-center text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              >
                Geri dön
              </button>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/85 backdrop-blur-xl p-4">
      {/* Background radial glows - V2: emerald + desatüre grafit, mor/mavi yok. */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/10 rounded-full blur-3xl blob-a" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-white/5 rounded-full blur-3xl blob-b" />

      <div className="w-full max-w-md relative z-10">
        <Card className="animate-pop surface-modal border-border shadow-[var(--elev-3)]">
          <CardHeader className="text-center pb-2">
            <div className="mx-auto h-12 w-12 rounded-2xl overflow-hidden mb-4">
              <img src="/logo-icon.webp" alt="BIP Terminal" className="h-full w-full object-cover" />
            </div>
            <CardTitle className="text-2xl font-black tracking-tight text-foreground flex items-center justify-center gap-1.5">
              BİP Yatırım Terminali
            </CardTitle>
            <CardDescription className="text-xs text-muted-foreground mt-1">
              Yapay Zekâ Destekli BIST Analiz ve Takip Portalı
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            {error && (
              <div className="p-3 bg-bear/10 border border-bear/20 rounded-xl text-bear text-xs font-semibold text-center">
                {error}
              </div>
            )}

            <form onSubmit={handleAuth} className="space-y-3.5 stagger-list">
              {isRegister && (
                <div className="space-y-1">
                  <label className="text-[10px] uppercase tracking-wider font-extrabold text-muted-foreground">Ad Soyad</label>
                  <div className="relative">
                    <User className="absolute left-3 top-2.5 h-4.5 w-4.5 text-muted-foreground" />
                    <Input 
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Ör: Ömer Faruk"
                      className="pl-10 bg-secondary/50 border-border"
                      required
                    />
                  </div>
                </div>
              )}

              <div className="space-y-1">
                <label className="text-[10px] uppercase tracking-wider font-extrabold text-muted-foreground">E-posta</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-2.5 h-4.5 w-4.5 text-muted-foreground" />
                  <Input 
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="bip@yatirim.com"
                    className="pl-10 bg-secondary/50 border-border"
                    required
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] uppercase tracking-wider font-extrabold text-muted-foreground">Şifre</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-2.5 h-4.5 w-4.5 text-muted-foreground" />
                  <Input 
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="pl-10 bg-secondary/50 border-border"
                    required
                  />
                </div>
                {!isRegister && (
                  <div className="text-right">
                    <Link
                      href="/forgot-password"
                      className="text-[11px] text-muted-foreground hover:text-primary transition-colors"
                    >
                      Şifremi unuttum
                    </Link>
                  </div>
                )}
              </div>

              {isRegister && (
                <label className="flex items-start gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={termsAccepted}
                    onChange={(e) => setTermsAccepted(e.target.checked)}
                    className="mt-0.5 h-3.5 w-3.5 rounded border-border bg-secondary/50 accent-primary cursor-pointer shrink-0"
                  />
                  <span className="text-[11px] text-muted-foreground leading-snug">
                    <Link href="/legal/terms" className="text-primary hover:text-primary-hover underline">
                      Kullanım Koşulları
                    </Link>
                    'nı ve{" "}
                    <Link href="/legal/privacy" className="text-primary hover:text-primary-hover underline">
                      KVKK Aydınlatma Metni
                    </Link>
                    'ni okudum, kabul ediyorum.
                  </span>
                </label>
              )}

              {/* className override yok - Button.tsx'in "default" varyantı zaten
                  tek V2 birincil buton. */}
              <Button type="submit" disabled={loading} className="w-full mt-4 font-black text-sm py-2.5">
                {loading ? (
                  <Loader2 className="h-4.5 w-4.5 animate-spin" />
                ) : (
                  <>
                    {isRegister ? "Kayıt Ol ve Giriş Yap" : "Giriş Yap"}
                    <LogIn className="h-4 w-4" />
                  </>
                )}
              </Button>
            </form>

            {googleEnabled && (
              <div className="mt-4">
                <div className="relative my-3">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t border-border/40" />
                  </div>
                  <div className="relative flex justify-center">
                    <span className="bg-card px-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                      veya
                    </span>
                  </div>
                </div>
                <a
                  href={`${API_BASE_URL}/auth/google/login`}
                  className="press w-full flex items-center justify-center gap-2 h-10 rounded-md border border-border/60 bg-secondary/30 hover:bg-secondary/60 text-sm font-bold text-foreground transition-colors cursor-pointer"
                >
                  {/* Google'in resmi renkli "G" isareti */}
                  <svg className="h-4 w-4" viewBox="0 0 48 48" aria-hidden="true">
                    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
                    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
                    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
                  </svg>
                  Google ile devam et
                </a>
              </div>
            )}

            <div className="pt-4 border-t border-border/40 text-center text-xs">
              <span className="text-muted-foreground">
                {isRegister ? "Zaten üye misiniz?" : "Hesabınız yok mu?"}
              </span>
              <button 
                onClick={() => {
                  setIsRegister(!isRegister)
                  setError("")
                }}
                className="ml-1 text-primary hover:text-primary-hover font-extrabold transition-colors cursor-pointer"
              >
                {isRegister ? "Giriş Yapın" : "Kayıt Olun"}
              </button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
