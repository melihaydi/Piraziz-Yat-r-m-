import Link from "next/link"

export default function Footer() {
  return (
    <footer className="border-t border-border/40 px-4 md:px-8 py-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-[11px] text-muted-foreground">
      <span>© {new Date().getFullYear()} Piraziz Yatırım. Tüm hakları saklıdır.</span>
      <div className="flex items-center gap-4">
        <Link href="/legal/terms" className="hover:text-foreground transition-colors">Kullanım Koşulları</Link>
        <Link href="/legal/privacy" className="hover:text-foreground transition-colors">Gizlilik / KVKK</Link>
        <Link href="/legal/risk-disclosure" className="hover:text-foreground transition-colors">Risk Bildirimi</Link>
      </div>
    </footer>
  )
}
