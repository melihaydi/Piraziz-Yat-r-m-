import { cn } from "@/lib/utils"

export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      // `skeleton` (globals.css) soldan sağa geçen bir ışıltı kullanıyor;
      // önceki `animate-pulse` tüm kutuyu aynı anda soldurup açtığı için
      // "yükleniyor" değil "donmuş" gibi okunuyordu. Işıltının yönü var,
      // nabzın yok - fark buradan çıkıyor.
      className={cn("skeleton rounded-md", className)}
      {...props}
    />
  )
}
