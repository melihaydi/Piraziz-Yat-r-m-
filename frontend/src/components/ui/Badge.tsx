import React from "react"
import { cn } from "@/lib/utils"

/**
 * Ölçüm: uygulamada aynı "küçük, büyük harfli, renkli, kenarlıklı etiket"
 * kalıbı 22 yerde elle tekrar ediliyordu (bkz. tasarım incelemesi) - her
 * biri kendi px/py/renk kombinasyonunu yeniden yazıyordu. Bu tek bileşen o
 * tekrarın yerine geçiyor; yeni bir görünüm icat etmiyor, zaten var olan
 * deseni (örn. admin/page.tsx'teki "Admin" ve destek talebi durumu
 * etiketleri) isimlendirip tek yere topluyor.
 */

/**
 * V2 semantik palet - dört varyant, hepsi bu.
 *
 *   success  LONG · BUY · BULLISH · LIVE · AKTİF · BAŞARILI
 *   danger   SHORT · SELL · BEARISH · STOP · ZARAR · KRİTİK
 *   warning  UYARI · YÜKSEK RİSK · ÖNEMLİ · MAKRO OLAY
 *   neutral  NÖTR · BEKLEMEDE · PASİF
 *
 * Eski "info" (camgöbeği) ve "primary" (mor) varyantları KALDIRILDI: V2'de
 * mavi bir UI vurgusu yok ve birincil renk zaten yeşil - "primary" ile
 * "success" iki ayrı şey olsaydı ikisi de zayıflardı. primary çağıran
 * yerler success'e eşleniyor.
 */
export type BadgeVariant = "neutral" | "success" | "warning" | "danger"

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  neutral: "bg-secondary/70 text-muted-foreground border-border",
  success: "bg-primary/10 text-primary border-primary/25",
  warning: "bg-warn/10 text-warn border-warn/25",
  danger: "bg-bear/10 text-bear border-bear/25",
}

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant
}

export function Badge({ variant = "neutral", className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-wide px-1.5 py-0.5 rounded border shrink-0",
        VARIANT_CLASSES[variant],
        className
      )}
      {...props}
    />
  )
}
