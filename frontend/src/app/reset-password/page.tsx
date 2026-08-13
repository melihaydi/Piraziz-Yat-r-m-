"use client"

import React, { Suspense, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Lock, Loader2, ArrowLeft, CheckCircle2, XCircle } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card"
import { Button } from "@/components/ui/Button"
import { Input } from "@/components/ui/Input"
import { resetPassword } from "@/lib/auth"

function ResetPasswordForm() {
  const token = useSearchParams().get("token") || ""
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [done, setDone] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    if (password.length < 8) {
      setError("Şifre en az 8 karakter olmalı.")
      return
    }
    if (password !== confirm) {
      setError("Şifreler eşleşmiyor.")
      return
    }
    setLoading(true)
    const result = await resetPassword(token, password)
    setLoading(false)
    if (!result.ok) {
      setError(result.error || "Bir hata oluştu.")
      return
    }
    setDone(true)
  }

  if (!token) {
    return (
      <div className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-xl text-center space-y-2">
        <XCircle className="h-6 w-6 text-rose-400 mx-auto" />
        <p className="text-xs text-rose-300/90 leading-relaxed">
          Geçersiz bağlantı. Lütfen e-postandaki sıfırlama bağlantısına tekrar tıkla veya yeni bir tane iste.
        </p>
      </div>
    )
  }

  if (done) {
    return (
      <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-center space-y-2">
        <CheckCircle2 className="h-6 w-6 text-emerald-400 mx-auto" />
        <p className="text-xs text-emerald-300/90 leading-relaxed">
          Şifren güncellendi. Artık yeni şifrenle giriş yapabilirsin.
        </p>
      </div>
    )
  }

  return (
    <>
      {error && (
        <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-400 text-xs font-semibold text-center">
          {error}
        </div>
      )}
      <form onSubmit={handleSubmit} className="space-y-3.5">
        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-wider font-extrabold text-muted-foreground">Yeni Şifre</label>
          <div className="relative">
            <Lock className="absolute left-3 top-2.5 h-4.5 w-4.5 text-muted-foreground" />
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="pl-10 bg-zinc-900/60 border-zinc-800"
              required
              autoFocus
            />
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-wider font-extrabold text-muted-foreground">Yeni Şifre (Tekrar)</label>
          <div className="relative">
            <Lock className="absolute left-3 top-2.5 h-4.5 w-4.5 text-muted-foreground" />
            <Input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="••••••••"
              className="pl-10 bg-zinc-900/60 border-zinc-800"
              required
            />
          </div>
        </div>
        <Button
          type="submit"
          disabled={loading}
          className="w-full mt-2 cursor-pointer bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-600 hover:to-indigo-700 text-foreground font-black text-sm py-2.5 flex items-center justify-center gap-1.5 border-0 shadow-lg shadow-purple-500/10"
        >
          {loading ? <Loader2 className="h-4.5 w-4.5 animate-spin" /> : "Şifreyi Güncelle"}
        </Button>
      </form>
    </>
  )
}

export default function ResetPasswordPage() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/80 backdrop-blur-xl p-4">
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl" />

      <div className="w-full max-w-md relative z-10">
        <Card glass={true} className="border-purple-500/20 bg-gradient-to-br from-zinc-950 via-zinc-900 to-purple-950/20 shadow-2xl">
          <CardHeader className="text-center pb-2">
            <div className="mx-auto h-12 w-12 rounded-2xl overflow-hidden mb-4">
              <img src="/logo.png" alt="BIP Terminal" className="h-full w-full object-cover" />
            </div>
            <CardTitle className="text-xl font-black tracking-tight text-foreground">
              Şifre Sıfırla
            </CardTitle>
            <CardDescription className="text-xs text-muted-foreground mt-1">
              Hesabın için yeni bir şifre belirle
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            <Suspense fallback={<Loader2 className="h-5 w-5 animate-spin text-purple-400 mx-auto" />}>
              <ResetPasswordForm />
            </Suspense>

            <div className="pt-4 border-t border-border/40 text-center">
              <Link
                href="/"
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-purple-400 transition-colors"
              >
                <ArrowLeft className="h-3.5 w-3.5" /> Girişe dön
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
