"use client"

import React, { Suspense, useEffect, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Loader2, ArrowLeft, CheckCircle2, XCircle } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card"
import { verifyEmail } from "@/lib/auth"

function VerifyEmailStatus() {
  const token = useSearchParams().get("token") || ""
  const [state, setState] = useState<"loading" | "ok" | "error">("loading")
  const [error, setError] = useState("")

  useEffect(() => {
    if (!token) {
      setState("error")
      setError("Geçersiz doğrulama bağlantısı.")
      return
    }
    verifyEmail(token).then((result) => {
      if (result.ok) {
        setState("ok")
      } else {
        setState("error")
        setError(result.error || "Bir hata oluştu.")
      }
    })
  }, [token])

  if (state === "loading") {
    return <Loader2 className="h-6 w-6 animate-spin text-purple-400 mx-auto" />
  }

  if (state === "ok") {
    return (
      <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-center space-y-2">
        <CheckCircle2 className="h-6 w-6 text-emerald-400 mx-auto" />
        <p className="text-xs text-emerald-300/90 leading-relaxed">
          E-posta adresin doğrulandı. Uygulamaya dönüp giriş yapabilirsin.
        </p>
      </div>
    )
  }

  return (
    <div className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-xl text-center space-y-2">
      <XCircle className="h-6 w-6 text-rose-400 mx-auto" />
      <p className="text-xs text-rose-300/90 leading-relaxed">{error}</p>
    </div>
  )
}

export default function VerifyEmailPage() {
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
              E-posta Doğrulama
            </CardTitle>
            <CardDescription className="text-xs text-muted-foreground mt-1">
              Bağlantın kontrol ediliyor
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            <Suspense fallback={<Loader2 className="h-5 w-5 animate-spin text-purple-400 mx-auto" />}>
              <VerifyEmailStatus />
            </Suspense>

            <div className="pt-4 border-t border-border/40 text-center">
              <Link
                href="/"
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-purple-400 transition-colors"
              >
                <ArrowLeft className="h-3.5 w-3.5" /> Uygulamaya dön
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
