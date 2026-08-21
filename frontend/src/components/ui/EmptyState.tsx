import React from "react"
import { cn } from "@/lib/utils"

/**
 * "Henüz X yok" satırları uygulamada onlarca yerde tek satırlık düz metin
 * olarak tekrar ediyordu (bkz. tasarım incelemesi) - her biri farklı boyut/
 * boşluk kombinasyonuyla. Bu bileşen o boşluğu, isteğe bağlı bir ikonla ve
 * tutarlı bir dikey ritimle dolduruyor; içerik hâlâ çağıran tarafın.
 */

export interface EmptyStateProps {
  icon?: React.ComponentType<{ className?: string }>
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center text-center gap-2 py-12 px-4", className)}>
      {Icon && <Icon className="h-8 w-8 text-muted-foreground/50 mb-1" />}
      <p className="text-sm font-bold text-foreground">{title}</p>
      {description && <p className="t-caption max-w-sm">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
