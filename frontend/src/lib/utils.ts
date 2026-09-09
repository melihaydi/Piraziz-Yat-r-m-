import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// A native <input type="number"> forces a period as the decimal separator
// regardless of the OS/browser's Turkish locale, so this plain-text parser
// accepts BOTH conventions - used by every TL/share-count input across the
// app (portfolio, trade deposit/settings, admin managed portfolios,
// strategy calculator).
//
// Tek dayanak noktasi su: BINLIK GRUP HER ZAMAN TAM 3 HANEDIR. Ondalik
// kismin 3 haneden farkli olmasi, o ayracin kesinlikle ondalik oldugunu
// soyler - hicbir belirsizlik kalmaz.
//
// Onceki hali bu kurali yalnizca 1-2 haneye uyguluyordu, 3+ haneyi korukoru
// binlik sayip ayraci siliyordu. Sonuc: FON FIYATLARI 4 ONDALIKLI oldugu
// icin "7.7990" yazan kullanici 77990 elde ediyordu - 10.000x hata, hicbir
// uyari vermeden. Ayrica Ingiliz duzeni "1,500.75" de 1.50075'e donuyordu.
//
// Kurallar:
//   - Iki ayrac da varsa: SONDAKI ondalik, digeri gruplama
//       "1.500,50" -> 1500.5     "1,500.75" -> 1500.75
//   - Tek ayrac birden fazla kez geciyorsa: gruplama
//       "1.500.000" -> 1500000
//   - Tek ayrac bir kez geciyor ve kuyruk 3 HANE DEGILSE: ondalik
//       "12.5" -> 12.5    "7.7990" -> 7.799    "12,5" -> 12.5
//   - Tek ayrac bir kez geciyor ve kuyruk TAM 3 hane ise belirsiz; Turkce
//     konvansiyonu uygulanir: "," ondalik, "." binlik
//       "1,500" -> 1.5           "1.500" -> 1500
export function parseTLAmount(raw: string): number {
  // Bosluklu gruplama ("1 500,50") ve TL isareti de kabul edilsin.
  const trimmed = raw.trim().replace(/[\s ₺]/g, "")
  if (!trimmed) return NaN

  const lastComma = trimmed.lastIndexOf(",")
  const lastDot = trimmed.lastIndexOf(".")

  // Iki ayrac birden: sondaki ondalik, digeri gruplama.
  if (lastComma >= 0 && lastDot >= 0) {
    const decimalSep = lastComma > lastDot ? "," : "."
    const groupSep = decimalSep === "," ? "." : ","
    return parseFloat(trimmed.split(groupSep).join("").replace(decimalSep, "."))
  }

  const sep = lastComma >= 0 ? "," : lastDot >= 0 ? "." : ""
  if (!sep) return parseFloat(trimmed)

  const parts = trimmed.split(sep)
  // Birden fazla ayrac -> gruplama ("1.500.000")
  if (parts.length > 2) return parseFloat(parts.join(""))

  const tail = parts[1]
  // 3 haneden farkli bir kuyruk binlik grubu OLAMAZ -> ondalik.
  if (tail.length !== 3) return parseFloat(parts.join("."))

  // Tam 3 hane: belirsiz. Turkce konvansiyonu: "," ondalik, "." binlik.
  return sep === "," ? parseFloat(parts.join(".")) : parseFloat(parts.join(""))
}
