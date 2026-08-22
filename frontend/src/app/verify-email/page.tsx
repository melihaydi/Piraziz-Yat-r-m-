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
    return <Loader2 className="h-6 w-6 animate-spin text-primary mx-auto" />
  }

  if (state === "ok") {
    return (
      <div className="p-4 bg-bull/10 border border-bull/20 rounded-xl text-center space-y-2">
        <CheckCircle2 className="h-6 w-6 text-bull mx-auto" />
        <p className="text-xs text-bull/90 leading-relaxed">
          E-posta adresin doğrulandı. Uygulamaya dönüp giriş yapabilirsin.
        </p>
      </div>
    )
  }

  return (
    <div className="p-4 bg-bear/10 border border-bear/20 rounded-xl text-center space-y-2">
      <XCircle className="h-6 w-6 text-bear mx-auto" />
      <p className="text-xs text-bear/90 leading-relaxed">{error}</p>
    </div>
  )
}

export default function VerifyEmailPage() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-xl p-4">
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/10 rounded-full blur-3xl" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-white/5 rounded-full blur-3xl" />

      <div className="w-full max-w-md relative z-10">
        <Card glass={true} className="border-primary/20 bg-gradient-to-br from-background via-card to-primary/20 shadow-2xl">
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
            <Suspense fallback={<Loader2 className="h-5 w-5 animate-spin text-primary mx-auto" />}>
              <VerifyEmailStatus />
            </Suspense>

            <div className="pt-4 border-t border-border/40 text-center">
              <Link
                href="/"
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
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
