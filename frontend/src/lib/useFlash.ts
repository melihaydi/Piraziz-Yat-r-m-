"use client"

import { useEffect, useRef, useState } from "react"

/**
 * Bir sayısal değer değiştiğinde kısa süreliğine bir "flash" class'ı
 * döner - .flash-up/.flash-down (metin rengi) veya .row-flash-up/
 * .row-flash-down (arka plan) zaten globals.css'te tanımlıydı ama HİÇBİR
 * yerde kullanılmıyordu (bkz. o dosyadaki yorum: "gerçek terminallerdeki
 * 'fiyat güncellendi' yanıp sönmesi" - tanımlanmış ama hiç bağlanmamış).
 *
 * İlk render'da flash TETİKLENMEZ (prevRef ilk değeri hemen alır) - yoksa
 * sayfa açılışında ekrandaki her fiyat aynı anda yanıp söner, "yeni veri
 * geldi" sinyali "her şey şimdi yüklendi" gürültüsüne dönerdi. Sadece
 * GERÇEKTEN değişen bir değer parlar.
 */
export function useFlash(value: number | null | undefined, variant: "text" | "row" = "text"): string {
  const prevRef = useRef<number | null | undefined>(value)
  const [flashClass, setFlashClass] = useState("")

  useEffect(() => {
    const prev = prevRef.current
    prevRef.current = value
    if (prev == null || value == null || value === prev) return

    const up = variant === "row" ? "row-flash-up" : "flash-up"
    const down = variant === "row" ? "row-flash-down" : "flash-down"
    setFlashClass(value > prev ? up : down)

    // Animasyon süresiyle eşleşiyor (globals.css: flash-up/down 0.9s,
    // row-flash-up/down 1.1s) - class'ı kaldırmazsak bir SONRAKİ değişiklik
    // aynı yöndeyse animasyon yeniden tetiklenmez (React aynı className'i
    // tekrar set etmiş olur, DOM'da fark yoktur).
    const duration = variant === "row" ? 1100 : 900
    const timer = setTimeout(() => setFlashClass(""), duration)
    return () => clearTimeout(timer)
  }, [value, variant])

  return flashClass
}
