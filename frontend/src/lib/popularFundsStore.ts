"use client"

import { authFetch } from "./auth"
import { pollWhileVisibleAndOpen } from "./usePolling"

/**
 * Single shared poller for "Popüler Fonlar - Anlık Getiri", used by both the
 * homepage and the /funds page. Each page previously ran its own independent
 * fetch-on-mount + interval, so navigating home -> funds -> home fired a
 * fresh request every time even though the data (and its own 15s cadence)
 * was identical - this module-level store is created once per app session
 * and outlives page navigation, so only the FIRST subscriber ever triggers
 * a fetch; every later mount just reads whatever's already in memory.
 */

type Listener = () => void

type OrderCutoff = { cutoff_time: string; same_day: boolean; minutes_remaining: number }
type Snapshot = { funds: any[]; loading: boolean; orderCutoff: OrderCutoff | null }

let funds: any[] = []
let loading = true
let started = false
// TEFAS emir kesme saati bilgisi - fon-spesifik değil, tüm popüler fonlar
// için tek bir ortak değer, bu yüzden funds array'inin dışında ayrı
// tutuluyor. null: henüz hiç veri gelmedi.
let orderCutoff: OrderCutoff | null = null
const listeners = new Set<Listener>()

// useSyncExternalStore requires getSnapshot to return a STABLE reference
// when nothing has changed - it compares with Object.is, and a fresh
// `{ funds, loading }` literal on every call looks like a change on every
// single render, which sends React into an infinite re-render loop (this
// shipped broken once already: the homepage and /funds page both hung).
// Cached here and only replaced when fetchOnce() actually gets new data.
let snapshot: Snapshot = { funds, loading, orderCutoff }

function notify() {
  snapshot = { funds, loading, orderCutoff }
  listeners.forEach(l => l())
}

function fetchOnce() {
  authFetch("/funds/popular/live-estimate")
    .then(res => res.json())
    .then(data => {
      if (Array.isArray(data.funds)) funds = data.funds
      if (data.order_cutoff) orderCutoff = data.order_cutoff
      loading = false
      notify()
    })
    .catch(err => {
      console.error("Failed to load popular funds live estimate:", err)
      loading = false
      notify()
    })
}

function ensureStarted() {
  if (started) return
  started = true
  pollWhileVisibleAndOpen(fetchOnce, 15000)
}

export function subscribePopularFunds(listener: Listener): () => void {
  ensureStarted()
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getPopularFundsSnapshot(): Snapshot {
  return snapshot
}
