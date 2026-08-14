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

let funds: any[] = []
let loading = true
let started = false
const listeners = new Set<Listener>()

function notify() {
  listeners.forEach(l => l())
}

function fetchOnce() {
  authFetch("/funds/popular/live-estimate")
    .then(res => res.json())
    .then(data => {
      if (Array.isArray(data.funds)) funds = data.funds
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

export function getPopularFundsSnapshot() {
  return { funds, loading }
}
