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

/** Liste henuz yok ve bir istek havadaysa true - arama kutusu "sonuc yok"
 *  yerine "yukleniyor" diyebilsin diye (bkz. Header). */
export function isTickerDirectoryLoading(): boolean {
  return cache === null && inflight !== null
}

export function ensureTickerDirectoryLoaded(): Promise<TickerDirectoryEntry[]> {
  if (cache) return Promise.resolve(cache)
  if (!inflight) inflight = fetchDirectory().finally(() => { inflight = null; notify() })
  return inflight
}

/**
 * `enabled=false` ile cagirilirsa listeye ABONE olur ama CEKMEZ.
 *
 * Neden: bu liste /screener/ (~26 KB, sogukken ~2 sn) ve /funds/ (~9 KB)
 * cagrilarinin toplami ve YALNIZCA arama kutusunu besliyor. Header her
 * sayfada oldugu icin, kullanici arama yapsa da yapmasa da her acilista
 * ikisi birden cekiliyordu. Artik arama kutusu ilk kez kullanildiginda
 * yukleniyor; modul seviyesindeki `cache` sayesinde bu bir kez oluyor ve
 * sonra her yer ayni veriyi paylasiyor.
 */
export function useTickerDirectory(enabled: boolean = true): TickerDirectoryEntry[] {
  const [, forceRerender] = useState(0)
  useEffect(() => {
    const listener = () => forceRerender(v => v + 1)
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }, [])
  useEffect(() => {
    if (enabled) ensureTickerDirectoryLoaded()
  }, [enabled])
  return cache || []
}
