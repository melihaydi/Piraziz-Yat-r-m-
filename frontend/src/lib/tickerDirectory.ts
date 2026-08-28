"use client"

import { useEffect, useState } from "react"
import { authFetch } from "./auth"
import { API_BASE_URL } from "./config"

/**
 * Tüm BIST hisseleri + TEFAS fonlarının tek, paylaşılan listesi -
 * autocomplete/arama gösteren HER yer (Header'daki genel arama, portföye/
 * yönetilen portföye varlık ekleme, fon kompozisyon editörü) aynı tek
 * fetch'i paylaşsın diye modül seviyesinde bir kere çekilip cache'leniyor.
 * Önceden Header.tsx kendi kopyasını çekiyordu - artık o da bu modülü
 * kullanıyor (bkz. useTickerDirectory).
 */
export interface TickerDirectoryEntry {
  code: string
  name: string
  price: number | null
  isFund: boolean
}

let cache: TickerDirectoryEntry[] | null = null
let inflight: Promise<TickerDirectoryEntry[]> | null = null
const listeners = new Set<() => void>()

function notify() {
  listeners.forEach(l => l())
}

async function fetchDirectory(): Promise<TickerDirectoryEntry[]> {
  const [stocksRes, fundsRes] = await Promise.all([
    authFetch("/screener/").catch(() => null),
    fetch(`${API_BASE_URL}/api/v1/funds/`).catch(() => null),
  ])
  const stocks = stocksRes && stocksRes.ok ? await stocksRes.json().catch(() => []) : []
  const funds = fundsRes && fundsRes.ok ? await fundsRes.json().catch(() => []) : []

  const list: TickerDirectoryEntry[] = [
    ...(Array.isArray(stocks) ? stocks : []).map((t: any) => ({
      code: t.ticker, name: t.name, price: t.price ?? null, isFund: false,
    })),
    ...(Array.isArray(funds) ? funds : []).map((f: any) => ({
      code: f.code, name: f.name, price: f.price ?? null, isFund: true,
    })),
  ]
  cache = list
  notify()
  return list
}

export function ensureTickerDirectoryLoaded(): Promise<TickerDirectoryEntry[]> {
  if (cache) return Promise.resolve(cache)
  if (!inflight) inflight = fetchDirectory().finally(() => { inflight = null })
  return inflight
}

export function useTickerDirectory(): TickerDirectoryEntry[] {
  const [, forceRerender] = useState(0)
  useEffect(() => {
    const listener = () => forceRerender(v => v + 1)
    listeners.add(listener)
    ensureTickerDirectoryLoaded()
    return () => { listeners.delete(listener) }
  }, [])
  return cache || []
}
