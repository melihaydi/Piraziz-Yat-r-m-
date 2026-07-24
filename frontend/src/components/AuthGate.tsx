"use client"

import React, { useState, useEffect } from "react"
import { Sparkles, User, Mail, Lock, LogIn, ArrowRight, CheckCircle2, Loader2 } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card"
import { Button } from "@/components/ui/Button"
import { Input } from "@/components/ui/Input"
import { login, register, fetchCurrentUser } from "@/lib/auth"

interface AuthGateProps {
  children: React.ReactNode
}

export default function AuthGate({ children }: AuthGateProps) {
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [checkingSession, setCheckingSession] = useState(true)
  const [isRegister, setIsRegister] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  // Form states
  const [fullName, setFullName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")

  // Validate any stored token against the backend on load, instead of
  // trusting a "bip_logged_in" flag that (previously) was set once and
  // never re-checked - a token can be missing/expired/revoked.
  useEffect(() => {
    const verifySession = async () => {
      const user = await fetchCurrentUser()
      if (user) {
        localStorage.setItem("bip_username", user.full_name || user.email)
        setIsLoggedIn(true)
      }
      setCheckingSession(false)
    }
    verifySession()

    const onExpired = () => setIsLoggedIn(false)
    window.addEventListener("bip:session-expired", onExpired)
    return () => window.removeEventListener("bip:session-expired", onExpired)
  }, [])

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")

    if (!email || !password || (isRegister && !fullName)) {
      setError("Lütfen tüm alanları doldurun.")
      return
    }

    setLoading(true)
    const result = isRegister
      ? await register(email, password, fullName)
      : await login(email, password)
    setLoading(false)

    if (!result.ok) {
      setError(result.error || "Bir hata oluştu.")
      return
    }

    localStorage.setItem("bip_username", fullName || email)
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/80 backdrop-blur-xl p-4">
      {/* Background radial glows */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl" />

      <div className="w-full max-w-md relative z-10">
        <Card glass={true} className="border-purple-500/20 bg-gradient-to-br from-zinc-950 via-zinc-900 to-purple-950/20 shadow-2xl">
          <CardHeader className="text-center pb-2">
            <div className="mx-auto h-12 w-12 rounded-2xl bg-purple-500/15 border border-purple-500/30 flex items-center justify-center mb-4">
              <Sparkles className="h-6 w-6 text-purple-400 animate-pulse" />
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
              </div>

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
