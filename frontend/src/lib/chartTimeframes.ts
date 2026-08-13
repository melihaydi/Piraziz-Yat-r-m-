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

// How many times a chart view re-requests candles after the backend answers
// with SIMULATED data (X-Chart-Simulated: true - randomly generated bars it
// serves when its live cache is cold). The retry is meant to ride out a
// backend restart, which settles within seconds; 5 attempts x 2.5s covers
// that. It is capped because it previously wasn't: a symbol that never
// resolved kept the retry firing every 2.5s for as long as the tab stayed
// open, one unbounded request loop per open tab against a 1GB host.
export const MAX_SIMULATED_CHART_RETRIES = 5
