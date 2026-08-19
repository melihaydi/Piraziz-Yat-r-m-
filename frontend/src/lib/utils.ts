import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// A native <input type="number"> forces a period as the decimal separator
// regardless of the OS/browser's Turkish locale, so this plain-text parser
// accepts the Turkish convention instead - "." as a thousands separator
// (stripped), "," as the decimal point - used by every TL/share-count input
// across the app (portfolio, trade deposit/settings, admin managed
// portfolios, strategy calculator).
//
// A comma present means Turkish convention unambiguously - strip dots as
// thousands separators. With NO comma, a lone dot followed by 1-2 digits is
// treated as a decimal point instead of blindly stripped, since a real
// Turkish thousands grouping always has exactly 3 digits after the dot -
// otherwise a plain decimal typed out of habit (e.g. "12.5") silently
// became "125", a 10x error with nothing to catch it.
export function parseTLAmount(raw: string): number {
  const trimmed = raw.trim()
  if (!trimmed.includes(",")) {
    const dots = trimmed.match(/\./g)
    if (dots?.length === 1) {
      const decimals = trimmed.split(".")[1]?.length ?? 0
      if (decimals >= 1 && decimals <= 2) return parseFloat(trimmed)
    }
  }
  return parseFloat(trimmed.replace(/\./g, "").replace(",", "."))
}
