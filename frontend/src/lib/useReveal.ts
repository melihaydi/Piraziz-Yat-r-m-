"use client"

import { useEffect } from "react"

/**
 * Kaydırma ile ortaya çıkma (scroll reveal) + imleç takipli aydınlatma.
 *
 * Tek bir yerde kurulur (AppChrome) ve tüm uygulamaya hizmet eder. Bileşen
 * başına hook çağırmak yerine merkezî olmasının iki sebebi var:
 *
 *  1. Performans. Bu uygulamada bir ızgarada 30+ kart olabiliyor; kart
 *     başına bir IntersectionObserver + bir pointermove dinleyicisi,
 *     kaydırma sırasında ölçülebilir bir maliyet. Tek gözlemci ve tek
 *     dinleyici o maliyeti sabit tutuyor.
 *
 *  2. Sayfalar bunu bilmek zorunda kalmasın. Bir sayfaya animasyon eklemek
 *     için import/hook gerekmiyor - öğeye `data-reveal` yazmak yetiyor.
 *
 * Erişilebilirlik notu: gizleme CSS'te `.reveal-ready` sınıfına bağlı ve o
 * sınıfı BURASI ekliyor. Yani JS çalışmazsa (hidrasyon hatası, script
 * bloklandı, eski tarayıcı) hiçbir şey gizlenmez ve sayfa normal görünür.
 * Tersi - CSS'in içeriği baştan gizleyip JS'in göstermesi - JS'in her
 * koşulda çalışmasına bahse girmek olurdu.
 */
export function useReveal(pathname?: string | null) {
  useEffect(() => {
    // Hareket duyarlılığı: kullanıcı azaltılmış hareket istiyorsa gözlemciyi
    // hiç kurmuyoruz. CSS de aynı sorguyla efekti kapatıyor ama gözlemciyi
    // kurmamak, gereksiz işi baştan yapmamak demek.
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    if (reduced || typeof IntersectionObserver === "undefined") return

    const root = document.documentElement
    root.classList.add("reveal-ready")

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          entry.target.classList.add("is-visible")
          // Tek yönlü: bir kez göründükten sonra izlemeyi bırak. Yukarı
          // kaydırınca içeriğin yeniden kaybolup belirmesi, uzun bir
          // sayfada okumayı sürekli kesintiye uğratır.
          io.unobserve(entry.target)
        }
      },
      {
        // Öğenin tamamını beklemek geç kalıyor; %8'i görününce başlat.
        threshold: 0.08,
        // Alttan 60px erken tetikleme: kullanıcı kaydırırken öğe görünür
        // alana girmeden animasyon başlasın, böylece "geç kalmış" hissi
        // vermesin. Üstten -40px, sayfanın en tepesindeki öğeler için
        // gereksiz tetiklemeyi engeller.
        rootMargin: "-40px 0px 60px 0px",
      }
    )

    // --- Güvenlik ağı ------------------------------------------------------
    // Bu mekanizmanın başarısızlık modu asimetrik: animasyonun oynamaması
    // fark edilmez, İÇERİĞİN GÖRÜNMEMESİ ise kullanıcının portföyünü
    // görememesi demek. IntersectionObserver güvenilir bir API ama tek
    // dayanak olmasına gerek yok.
    //
    // Süpürge yalnızca GÖRÜNÜR ALANDAKİ açılmamış öğeleri açar. Aşağıdakileri
    // de açsaydı kullanıcı oraya kaydırdığında her şey çoktan açılmış olurdu
    // ve efekt tamamen ölürdü.
    const sweep = () => {
      const vh = window.innerHeight || document.documentElement.clientHeight
      document.querySelectorAll("[data-reveal]:not(.is-visible)").forEach((el) => {
        const r = el.getBoundingClientRect()
        if (r.top < vh && r.bottom > 0) el.classList.add("is-visible")
      })
    }

    // Süpürge, gözlemlemenin ARDINDAN yeniden zamanlanır - tek seferlik
    // olamaz. Sebebi ölçüldü: bu uygulamada içeriğin neredeyse tamamı
    // asenkron geliyor, yani montajdan 2.5sn sonra çalışan tek bir süpürge
    // korumak istediği kartlar DOM'a girmeden önce çalışıp biterdi.
    let sweepTimer: ReturnType<typeof setTimeout> | null = null
    const observeAll = () => {
      document.querySelectorAll("[data-reveal]:not(.is-visible)").forEach((el) => io.observe(el))
      if (sweepTimer) clearTimeout(sweepTimer)
      sweepTimer = setTimeout(sweep, 2500)
    }
    observeAll()

    // Veri geldikçe DOM'a eklenen kartlar (bu uygulamada neredeyse her liste
    // asenkron doluyor) da gözlemlenmeli. Toplu işleniyor: bir fetch 30
    // satırı tek seferde eklediğinde 30 kez querySelectorAll çalışmasın.
    //
    // Toplayıcı olarak setTimeout kullanılıyor, requestAnimationFrame DEĞİL.
    // Sebebi ölçüldü: rAF gizli bir sekmede (document.hidden) hiç
    // çalışmıyor. Uygulama arka plan sekmesinde açılıp verisi orada
    // yüklenseydi, kartlar CSS ile gizlenmiş ama HİÇ gözlemlenmemiş olurdu -
    // ve gözlemlenmedikleri için sekme öne geldiğinde de kendiliğinden
    // görünür hale gelmezlerdi. Bir yatırım uygulamasında kalıcı olarak
    // görünmez portföy kartı, kazanılan animasyondan çok daha pahalı.
    // Burada rAF'ın kare sınırına da ihtiyaç yok: yaptığımız iş yalnızca
    // querySelectorAll + observe, düzen (layout) okuması içermiyor.
    let queued: ReturnType<typeof setTimeout> | null = null
    const mo = new MutationObserver(() => {
      if (queued) return
      queued = setTimeout(() => {
        queued = null
        observeAll()
      }, 0)
    })
    mo.observe(document.body, { childList: true, subtree: true })

    // Sekme arka plandayken hem rAF hem IntersectionObserver askıya alınır
    // (ölçüldü: document.hidden=true iken gözlemci hiç ateşlemiyor). Sekme
    // öne geldiğinde gözlemci normalde kendiliğinden ateşler; bu, o yolun
    // da tıkanması ihtimaline karşı ikinci bir kapı.
    const onVisible = () => { if (!document.hidden) sweep() }
    document.addEventListener("visibilitychange", onVisible)

    return () => {
      io.disconnect()
      mo.disconnect()
      if (queued) clearTimeout(queued)
      if (sweepTimer) clearTimeout(sweepTimer)
      document.removeEventListener("visibilitychange", onVisible)
      root.classList.remove("reveal-ready")
    }
  }, [pathname])
}

/**
 * `.spotlight` kartlarında imlecin konumunu CSS değişkeni olarak yazar.
 *
 * Yalnızca hassas işaretleyicide (fare/kalem) çalışır: dokunmatikte
 * "imlecin konumu" diye bir şey yok, parmağın altındaki aydınlanma da
 * parmağın kendisiyle örtülür - yani hesaplama tamamen boşa giderdi.
 */
export function useSpotlight() {
  useEffect(() => {
    if (!window.matchMedia("(pointer: fine)").matches) return

    let frame = 0
    let pending: { el: HTMLElement; x: number; y: number } | null = null

    const flush = () => {
      frame = 0
      if (!pending) return
      const { el, x, y } = pending
      pending = null
      const rect = el.getBoundingClientRect()
      el.style.setProperty("--mx", `${x - rect.left}px`)
      el.style.setProperty("--my", `${y - rect.top}px`)
    }

    const onMove = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null
      const card = target?.closest?.(".spotlight") as HTMLElement | null
      if (!card) return
      // Stil yazımı bir sonraki kareye erteleniyor. pointermove saniyede
      // 120+ kez tetiklenebiliyor; her seferinde getBoundingClientRect
      // çağırmak düzen hesabını (layout) zorlar ve kaydırmayı takar.
      pending = { el: card, x: e.clientX, y: e.clientY }
      if (!frame) frame = requestAnimationFrame(flush)
    }

    window.addEventListener("pointermove", onMove, { passive: true })
    return () => {
      window.removeEventListener("pointermove", onMove)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])
}
