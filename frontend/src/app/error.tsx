"use client" // Error boundaries must be Client Components

import { useEffect } from "react"
import Link from "next/link"
import { AlertTriangle, RefreshCw, Home } from "lucide-react"

/**
 * Catches unexpected runtime errors anywhere under app/ and shows a real
 * fallback instead of a blank screen. Before this existed the app had no
 * error boundary at all, so any thrown render error left the user staring
 * at nothing with no way back.
 *
 * Note the retry prop is `unstable_retry` in this Next.js version, not the
 * `reset` name older docs/examples use.
 */
export default function Error({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string }
  unstable_retry: () => void
}) {
  useEffect(() => {
    // No error-reporting service is wired up (see backend main.py's
    // unhandled_exception_handler for the server-side equivalent), so the
    // browser console is where a frontend crash is actually inspectable.
    console.error("Sayfa hatası:", error)
  }, [error])

  return (
    <div className="flex flex-col items-center justify-center py-24 px-4 text-center space-y-5">
      <div className="h-14 w-14 rounded-2xl bg-bear/10 border border-bear/20 flex items-center justify-center">
        <AlertTriangle className="h-7 w-7 text-bear" />
      </div>

      <div className="space-y-1.5 max-w-md">
        <h2 className="text-xl font-black tracking-tight text-foreground">Bir şeyler ters gitti</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Bu sayfa yüklenirken beklenmedik bir hata oluştu. Tekrar deneyebilir veya ana sayfaya
          dönebilirsiniz. Sorun devam ederse Ayarlar &gt; Yardım &amp; Destek üzerinden bize bildirin.
        </p>
        {error.digest && (
          <p className="text-[10px] font-mono-code text-muted-foreground/60 pt-1">Hata kodu: {error.digest}</p>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => unstable_retry()}
          className="inline-flex items-center gap-1.5 text-xs font-bold px-4 py-2.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors cursor-pointer"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Tekrar Dene
        </button>
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-xs font-bold px-4 py-2.5 rounded-md border border-border/50 bg-secondary/40 text-foreground hover:bg-secondary transition-colors"
        >
          <Home className="h-3.5 w-3.5" />
          Ana Sayfa
        </Link>
      </div>
    </div>
  )
}
