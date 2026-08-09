// Shared periyot listesi - BIST hisse grafiklerinin göründüğü her yerde
// (Hisse detay, Tarama, İşlem paneli) aynı 6 seçenek gösterilsin diye tek
// yerden tanımlanıyor. Fonlar bu listeyi kullanmıyor (fon mumları günlük,
// intraday periyot desteklenmiyor).
export interface ChartTimeframe {
  label: string
  value: string
}

export const CHART_TIMEFRAMES: ChartTimeframe[] = [
  { label: "5 Dakika", value: "5m" },
  { label: "15 Dakika", value: "15m" },
  { label: "1 Saat", value: "1h" },
  { label: "2 Saat", value: "2h" },
  { label: "Günlük", value: "1d" },
  { label: "Haftalık", value: "1w" },
]
