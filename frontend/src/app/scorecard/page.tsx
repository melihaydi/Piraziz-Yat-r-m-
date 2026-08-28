"use client"

import React, { useEffect, useState } from "react"
import { Loader2, Trophy, TrendingDown, ShieldAlert, Info } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card"
import { API_BASE_URL } from "@/lib/auth"

interface ScorecardRow {
  ticker: string
  direction: "LONG" | "SHORT"
  outcome: "WIN" | "LOSS" | "EXPIRED"
  return_pct: number | null
  fired_at: string
  resolved_at: string | null
}

interface Scorecard {
  window_days: number
  total_signals: number
  win_rate: number | null
  avg_win_pct: number | null
  avg_loss_pct: number | null
  avg_return_pct: number | null
  best: ScorecardRow | null
  worst: ScorecardRow | null
  open_signals_count: number
}

// Kimlik doğrulama GEREKTİRMEYEN tek sayfa - bkz. backend/app/api/v1/endpoints/scorecard.py
// ve AuthGate.tsx'in PUBLIC_PATHS listesi. authFetch değil düz fetch
// kullanılıyor çünkü token yok/gerekmiyor.
export default function ScorecardPage() {
  const [data, setData] = useState<Scorecard | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    fetch(`${API_BASE_URL}/scorecard/`)
      .then(res => { if (!res.ok) throw new Error("failed"); return res.json() })
      .then(setData)
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-black flex items-center gap-2">
          <ShieldAlert className="h-6 w-6 text-primary" />
          Sinyal Karnesi
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Frantic Algoritmik Strateji&apos;nin BIST30&apos;da taradığı HER LONG/SHORT çağrısının gerçek sonucu -
          kazanan da kaybeden de aynı şekilde sayılıyor, seçilmiş bir vitrin değil.
        </p>
      </div>

      {loading ? (
        <div className="h-40 flex items-center justify-center">
          <Loader2 className="h-6 w-6 text-muted-foreground animate-spin" />
        </div>
      ) : error || !data ? (
        <div className="text-sm text-muted-foreground text-center py-10">Karne şu an yüklenemedi.</div>
      ) : data.total_signals === 0 ? (
        <Card glass={true}>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Son {data.window_days} günde sonuçlanmış bir sinyal yok. Açık sinyal sayısı: {data.open_signals_count}.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card glass={true}>
              <CardContent className="pt-6 text-center">
                <div className="text-2xl font-black">{data.total_signals}</div>
                <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mt-1">
                  Kapanmış Sinyal ({data.window_days}g)
                </div>
              </CardContent>
            </Card>
            <Card glass={true}>
              <CardContent className="pt-6 text-center">
                <div className="text-2xl font-black">{data.win_rate != null ? `%${data.win_rate}` : "—"}</div>
                <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mt-1">
                  Kazanma Oranı
                </div>
              </CardContent>
            </Card>
            <Card glass={true}>
              <CardContent className="pt-6 text-center">
                <div className={`text-2xl font-black ${(data.avg_return_pct ?? 0) >= 0 ? "text-bull" : "text-bear"}`}>
                  {data.avg_return_pct != null ? `${data.avg_return_pct >= 0 ? "+" : ""}${data.avg_return_pct}%` : "—"}
                </div>
                <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mt-1">
                  Ortalama Getiri
                </div>
              </CardContent>
            </Card>
            <Card glass={true}>
              <CardContent className="pt-6 text-center">
                <div className="text-2xl font-black">{data.open_signals_count}</div>
                <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mt-1">
                  Şu An Açık
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card glass={true}>
              <CardContent className="pt-6 text-center">
                <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Ortalama Kazanç</div>
                <div className="text-xl font-black text-bull mt-1">
                  {data.avg_win_pct != null ? `+${data.avg_win_pct}%` : "—"}
                </div>
              </CardContent>
            </Card>
            <Card glass={true}>
              <CardContent className="pt-6 text-center">
                <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Ortalama Kayıp</div>
                <div className="text-xl font-black text-bear mt-1">
                  {data.avg_loss_pct != null ? `${data.avg_loss_pct}%` : "—"}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {data.best && (
              <Card glass={true}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-black uppercase tracking-wider text-bull flex items-center">
                    <Trophy className="h-4 w-4 mr-1.5" />
                    En İyi Sinyal
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-black">{data.best.ticker}</div>
                      <div className="text-xs text-muted-foreground">{data.best.direction} · {data.best.outcome}</div>
                    </div>
                    <div className={`text-lg font-black ${(data.best.return_pct ?? 0) >= 0 ? "text-bull" : "text-bear"}`}>
                      {data.best.return_pct != null ? `${data.best.return_pct >= 0 ? "+" : ""}${data.best.return_pct}%` : "—"}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
            {data.worst && (
              <Card glass={true}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-black uppercase tracking-wider text-bear flex items-center">
                    <TrendingDown className="h-4 w-4 mr-1.5" />
                    En Kötü Sinyal
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-black">{data.worst.ticker}</div>
                      <div className="text-xs text-muted-foreground">{data.worst.direction} · {data.worst.outcome}</div>
                    </div>
                    <div className={`text-lg font-black ${(data.worst.return_pct ?? 0) >= 0 ? "text-bull" : "text-bear"}`}>
                      {data.worst.return_pct != null ? `${data.worst.return_pct >= 0 ? "+" : ""}${data.worst.return_pct}%` : "—"}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </>
      )}

      <div className="flex items-start gap-2 text-[11px] text-muted-foreground bg-secondary/30 border border-border/30 rounded-lg px-3 py-2.5">
        <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <p>
          Bu sayfa yatırım tavsiyesi değildir; geçmiş performans gelecekteki sonuçların garantisi değildir.
          Sonuçlar, sinyal fiyatının periyodik olarak stop/hedef seviyeleriyle karşılaştırılmasıyla belirlenir
          (tam bir tick-tick backtest değildir) ve açık pozisyonların giriş/stop/hedef detayları burada
          gösterilmez.
        </p>
      </div>
    </div>
  )
}
