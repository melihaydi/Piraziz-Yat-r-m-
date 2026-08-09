"use client"

import React, { useState, useEffect } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { User, Mail, Lock, LogIn, ArrowRight, CheckCircle2, Loader2, ShieldCheck } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card"
import { Button } from "@/components/ui/Button"
import { Input } from "@/components/ui/Input"
import { login, register, fetchCurrentUser, verifyTwoFactor } from "@/lib/auth"

interface AuthGateProps {
  children: React.ReactNode
}

// Routes that must render even for a logged-out visitor - password reset
// links and legal pages are handed out (or need to be readable) before
// anyone has a session.
const PUBLIC_PATHS = ["/forgot-password", "/reset-password", "/verify-email"]
const isPublicPath = (path: string | null) =>
  !!path && (PUBLIC_PATHS.includes(path) || path.startsWith("/legal/"))

export default function AuthGate({ children }: AuthGateProps) {
  const pathname = usePathname()
  const publicRoute = isPublicPath(pathname)

  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [checkingSession, setCheckingSession] = useState(true)
  const [isRegister, setIsRegister] = useState(false)
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
      const user = await fetchCurrentUser()
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
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950">
        <Loader2 className="h-6 w-6 animate-spin text-purple-400" />
      </div>
    )
  }

  if (isLoggedIn) {
    return <>{children}</>
  }

  if (pendingTempToken) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/80 backdrop-blur-xl p-4">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl" />

        <div className="w-full max-w-md relative z-10">
          <Card glass={true} className="border-purple-500/20 bg-gradient-to-br from-zinc-950 via-zinc-900 to-purple-950/20 shadow-2xl">
            <CardHeader className="text-center pb-2">
              <div className="mx-auto h-12 w-12 rounded-2xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center mb-4">
                <ShieldCheck className="h-6 w-6 text-purple-400" />
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
                <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-400 text-xs font-semibold text-center">
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
                  className={`text-center font-mono bg-zinc-900/60 border-zinc-800 ${
                    useRecoveryCode ? "text-lg tracking-[0.15em]" : "text-2xl tracking-[0.5em]"
                  }`}
                />
                <Button
                  type="submit"
                  disabled={loading}
                  className="w-full cursor-pointer bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-600 hover:to-indigo-700 text-foreground font-black text-sm py-2.5 flex items-center justify-center gap-1.5 border-0 shadow-lg shadow-purple-500/10"
                >
                  {loading ? <Loader2 className="h-4.5 w-4.5 animate-spin" /> : "Doğrula ve Giriş Yap"}
                </Button>
              </form>

              <button
                onClick={() => { setUseRecoveryCode(v => !v); setTwoFACode(""); setError("") }}
                className="w-full text-center text-[11px] text-purple-400 hover:text-purple-300 transition-colors cursor-pointer"
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/80 backdrop-blur-xl p-4">
      {/* Background radial glows */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl" />

      <div className="w-full max-w-md relative z-10">
        <Card glass={true} className="border-purple-500/20 bg-gradient-to-br from-zinc-950 via-zinc-900 to-purple-950/20 shadow-2xl">
          <CardHeader className="text-center pb-2">
            <div className="mx-auto h-12 w-12 rounded-2xl overflow-hidden mb-4">
              <img src="/logo.png" alt="Piraziz Yatırım" className="h-full w-full object-cover" />
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
              <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-400 text-xs font-semibold text-center">
                {error}
              </div>
            )}

            <form onSubmit={handleAuth} className="space-y-3.5">
              {isRegister && (
                <div className="space-y-1">
                  <label className="text-[10px] uppercase tracking-wider font-extrabold text-muted-foreground">Ad Soyad</label>
                  <div className="relative">
                    <User className="absolute left-3 top-2.5 h-4.5 w-4.5 text-muted-foreground" />
                    <Input 
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Ör: Ömer Faruk"
                      className="pl-10 bg-zinc-900/60 border-zinc-800"
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
                    className="pl-10 bg-zinc-900/60 border-zinc-800"
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
                    className="pl-10 bg-zinc-900/60 border-zinc-800"
                    required
                  />
                </div>
                {!isRegister && (
                  <div className="text-right">
                    <Link
                      href="/forgot-password"
                      className="text-[11px] text-muted-foreground hover:text-purple-400 transition-colors"
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
                    className="mt-0.5 h-3.5 w-3.5 rounded border-zinc-700 bg-zinc-900/60 accent-purple-500 cursor-pointer shrink-0"
                  />
                  <span className="text-[11px] text-muted-foreground leading-snug">
                    <Link href="/legal/terms" className="text-purple-400 hover:text-purple-300 underline">
                      Kullanım Koşulları
                    </Link>
                    'nı ve{" "}
                    <Link href="/legal/privacy" className="text-purple-400 hover:text-purple-300 underline">
                      KVKK Aydınlatma Metni
                    </Link>
                    'ni okudum, kabul ediyorum.
                  </span>
                </label>
              )}

              <Button
                type="submit"
                disabled={loading}
                className="w-full mt-4 cursor-pointer bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-600 hover:to-indigo-700 text-foreground font-black text-sm py-2.5 flex items-center justify-center gap-1.5 border-0 shadow-lg shadow-purple-500/10"
              >
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

            <div className="pt-4 border-t border-border/40 text-center text-xs">
              <span className="text-muted-foreground">
                {isRegister ? "Zaten üye misiniz?" : "Hesabınız yok mu?"}
              </span>
              <button 
                onClick={() => {
                  setIsRegister(!isRegister)
                  setError("")
                }}
                className="ml-1 text-purple-400 hover:text-purple-300 font-extrabold transition-colors cursor-pointer"
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
