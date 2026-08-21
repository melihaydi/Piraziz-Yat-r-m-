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

export type BadgeVariant = "neutral" | "primary" | "success" | "warning" | "danger" | "info"

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  neutral: "bg-secondary/60 text-muted-foreground border-border/60",
  primary: "bg-primary/10 text-primary border-primary/20",
  success: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  warning: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  danger: "bg-rose-500/10 text-rose-400 border-rose-500/20",
  info: "bg-cyan-500/10 text-cyan-300 border-cyan-500/20",
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
