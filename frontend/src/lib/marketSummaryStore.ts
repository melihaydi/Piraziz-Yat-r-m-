"use client"

import { authFetch } from "./auth"
import { pollWhileVisibleAndOpen } from "./usePolling"

/**
 * GET /screener/market-summary için TEK paylaşımlı poll.
 *
 * Öncesinde bu uç nokta AYNI ANDA iki ayrı yerden pollanıyordu: Header'ın
 * endeks şeridi (her 5sn, ve Header her sayfada mount) + ana sayfanın kendi
 * piyasa özeti (her 2sn) - yani ana sayfada açık tek bir sekme dakikada
 * 12 + 30 = 42 istekle aynı cevabı iki kez çekiyordu. Uç noktanın kendi
 * limiti 120/dk olduğundan üç sekme açan bir kullanıcı limite takılıyordu
 * (ekran sessizce eskimiş veri gösteriyordu). Screener sayfasında da aynı
 * çift-poll vardı (5sn + 15sn).
 *
 * Store, AKTİF abonelerin istediği en KISA aralıkta pollar: ana sayfada
 * min(5sn, 2sn) = 2sn, screener'da min(5sn, 15sn) = 5sn, diğer sayfalarda
 * sadece Header olduğu için 5sn. Yani hiçbir tüketici eskisinden daha bayat
 * veri görmüyor, sadece mükerrer istek ortadan kalkıyor.
 */

type Listener = () => void

let data: any = null
let loading = true
const listeners = new Set<Listener>()
// Her abonenin istediği aralık - poll bunların EN KÜÇÜĞÜNDE dönüyor.
const desiredIntervals = new Map<Listener, number>()

let stopPolling: (() => void) | null = null
let activeInterval: number | null = null

// useSyncExternalStore, getSnapshot'ın değişmediğinde AYNI referansı
// döndürmesini şart koşuyor (Object.is ile karşılaştırıyor) - her çağrıda
// yeni bir nesne literali döndürmek sonsuz render döngüsü demek.
// popularFundsStore.ts'te bu bir kez canlıda kırıldığı için aynı desen
// burada da bilinçli olarak uygulanıyor.
let snapshot: { data: any; loading: boolean } = { data, loading }

function notify() {
  snapshot = { data, loading }
  listeners.forEach(l => l())
}

// Aynı anda uçuşta olan bir istek varken ikincisini başlatmıyoruz: Header
// ve sayfa aynı render turunda abone olduğu için ikisi de "henüz veri yok"
// görüp ayrı ayrı fetch tetikliyordu - tam da bu store'un ortadan
// kaldırmak için var olduğu mükerrer istek.
let inflight = false

function fetchOnce() {
  if (inflight) return
  inflight = true
  authFetch("/screener/market-summary")
    .then(res => (res.ok ? res.json() : null))
    .then(payload => {
      if (payload && payload.sentiment) data = payload
      loading = false
      inflight = false
      notify()
    })
    .catch(err => {
      console.error("Failed to load market summary:", err)
      loading = false
      inflight = false
      notify()
    })
}

function restartPolling() {
  const intervals = [...desiredIntervals.values()]
  const nextInterval = intervals.length > 0 ? Math.min(...intervals) : null

  if (nextInterval === activeInterval) return

  stopPolling?.()
  stopPolling = null
  activeInterval = nextInterval

  if (nextInterval !== null) {
    stopPolling = pollWhileVisibleAndOpen(fetchOnce, nextInterval)
  }
}

export function subscribeMarketSummary(listener: Listener, intervalMs: number): () => void {
  listeners.add(listener)
  desiredIntervals.set(listener, intervalMs)

  // İLK veri KOŞULSUZ çekiliyor - pollWhileVisibleAndOpen görünürlük
  // kapısına takıldığında ilk fetch'i de atlıyor (bkz. o dosyadaki
  // evaluate()), yani sekme "hidden" raporlarsa ekran sonsuza kadar
  // fallback değerlerde kalırdı. Store'a geçerken bu bir regresyon olarak
  // yakalandı: eski kod hem Header'da hem ana sayfada mount'ta koşulsuz
  // bir fetch yapıyordu, o garanti burada da korunuyor. Sadece TEKRARLAR
  // görünürlük/seans kapısına tabi.
  if (data === null) fetchOnce()

  restartPolling()
  return () => {
    listeners.delete(listener)
    desiredIntervals.delete(listener)
    restartPolling()
  }
}

export function getMarketSummarySnapshot(): { data: any; loading: boolean } {
  return snapshot
}
