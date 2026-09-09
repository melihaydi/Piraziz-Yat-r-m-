/**
 * Rota gecislerinde ANINDA gorunen iskelet.
 *
 * Onceden hicbir rotada loading.tsx yoktu: Next App Router'da bu, yeni
 * sayfanin JS'i ve veri cagrilari tamamlanana kadar EKRANDA ESKI SAYFANIN
 * DURMASI demek. Kullanici tikliyor, hicbir sey olmuyor, sonra bir anda
 * yeni sayfa beliriyor - "sayfadan sayfaya gecis yavas" hissinin kaynagi
 * buydu; asil sure degil, geri bildirimin hic olmamasiydi.
 *
 * Bu dosya app/ kokunde oldugu icin ALT ROTALARIN HEPSI icin gecerli -
 * her rotaya ayri ayri kopyalamaya gerek yok.
 *
 * Bilerek sade: donen bir carkifelek degil, sayfa duzenini taklit eden
 * birkac blok. Iskelet, gelecek icerigin seklini onceden gosterdigi icin
 * carkifelekten daha az "bekliyorum" hissi veriyor ve icerik yerlesince
 * daha az zipliyor.
 */
export default function Loading() {
  return (
    <div className="p-6 space-y-6 animate-pulse" aria-busy="true" aria-live="polite">
      <span className="sr-only">Yükleniyor…</span>

      {/* Baslik satiri */}
      <div className="space-y-2">
        <div className="h-7 w-56 rounded-md bg-secondary/60" />
        <div className="h-4 w-80 rounded bg-secondary/40" />
      </div>

      {/* Ust kart seridi */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 rounded-xl border border-border/40 bg-secondary/25" />
        ))}
      </div>

      {/* Ana icerik blogu */}
      <div className="rounded-xl border border-border/40 bg-secondary/15 p-4 space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-9 rounded bg-secondary/35" />
        ))}
      </div>
    </div>
  )
}
