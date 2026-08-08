"use client"

import React from "react"
import Link from "next/link"
import { ArrowLeft, AlertTriangle } from "lucide-react"
import { Card, CardContent } from "@/components/ui/Card"

export default function LegalPageShell({
  title,
  updatedAt,
  children,
}: {
  title: string
  updatedAt: string
  children: React.ReactNode
}) {
  return (
    <div className="flex-1 overflow-y-auto bg-gradient-to-b from-background to-[#0b0b0f] p-4 md:p-8">
      <div className="max-w-3xl mx-auto space-y-6">
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-purple-400 transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Uygulamaya dön
        </Link>

        <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 px-4 py-3 flex items-start gap-2.5">
          <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-300/90 leading-relaxed">
            Bu bir <strong>taslak</strong> metindir; Piraziz Yatırım ekibi tarafından hazırlanmıştır ancak
            bir avukat tarafından incelenip onaylanmamıştır. Gerçek kullanıcılara sunulmadan önce
            hukuki inceleme yapılmalıdır.
          </p>
        </div>

        <Card glass={true}>
          <CardContent className="p-6 md:p-8 space-y-5">
            <div>
              <h1 className="text-2xl font-black tracking-tight text-foreground">{title}</h1>
              <p className="text-xs text-muted-foreground mt-1">Son güncelleme: {updatedAt}</p>
            </div>
            <div className="prose-legal space-y-4 text-sm text-foreground/85 leading-relaxed [&_h2]:text-base [&_h2]:font-black [&_h2]:text-foreground [&_h2]:mt-6 [&_h2]:mb-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1 [&_li]:text-foreground/85">
              {children}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
