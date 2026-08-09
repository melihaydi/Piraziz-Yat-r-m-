import Link from "next/link"
import { Compass, Home } from "lucide-react"

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center py-24 px-4 text-center space-y-5">
      <div className="h-14 w-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
        <Compass className="h-7 w-7 text-primary" />
      </div>

      <div className="space-y-1.5 max-w-md">
        <h2 className="text-xl font-black tracking-tight text-foreground">Sayfa bulunamadı</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Aradığınız sayfa taşınmış veya hiç var olmamış olabilir. Adresi kontrol edin ya da ana
          sayfadan devam edin.
        </p>
      </div>

      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-xs font-bold px-4 py-2.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
      >
        <Home className="h-3.5 w-3.5" />
        Ana Sayfa
      </Link>
    </div>
  )
}
