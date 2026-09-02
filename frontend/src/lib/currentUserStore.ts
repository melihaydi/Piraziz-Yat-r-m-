"use client"

import { useEffect, useState } from "react"
import { fetchCurrentUser } from "./auth"

/**
 * GET /auth/me için TEK paylaşımlı istek.
 *
 * Öncesinde her sayfa yüklemesinde BEŞ ayrı bileşen bu uç noktayı
 * bağımsızca çağırıyordu: AuthGate (oturum doğrulama), Header (isim +
 * üyelik rozeti), Sidebar (ücretsiz/admin menü kısıtları), MobileTabBar
 * (aynı kısıtlar) ve ana sayfa (rol). Hepsi AYNI cevabı alıyordu ve her
 * biri sunucuda ayrı bir DB sorgusu demekti - tarayıcı network log'unda
 * tek sayfa açılışında 6 kez /auth/me görülerek tespit edildi.
 *
 * Store bir kez çeker, sonucu paylaşır; "profile-updated" olayında (bkz.
 * Ayarlar ve AuthGate) önbelleği tazeler, böylece isim/rol değişikliği
 * eskisi gibi anında yansımaya devam eder.
 */

type Listener = () => void

let user: any = null
let loaded = false
let inflight: Promise<any> | null = null
const listeners = new Set<Listener>()

function notify() {
  listeners.forEach(l => l())
}

function load(force = false): Promise<any> {
  if (!force && loaded) return Promise.resolve(user)
  if (inflight) return inflight
  inflight = fetchCurrentUser()
    .then(u => {
      user = u
      loaded = true
      inflight = null
      notify()
      return u
    })
    .catch(() => {
      loaded = true
      inflight = null
      notify()
      return null
    })
  return inflight
}

export function getCurrentUserCached(): any {
  return user
}

/** Ayarlar sayfası profili güncelledikten sonra çağrılır - aslında
 * "profile-updated" olayı zaten aşağıda dinleniyor, bu sadece doğrudan
 * çağırmak isteyenler için. */
export function refreshCurrentUser(): Promise<any> {
  return load(true)
}

if (typeof window !== "undefined") {
  window.addEventListener("profile-updated", () => { load(true) })
}

/** user null olabilir (giriş yapılmamış ya da istek başarısız). `loading`,
 * ilk cevap gelene kadar true. */
export function useCurrentUser(): { user: any; loading: boolean } {
  const [, forceRerender] = useState(0)

  useEffect(() => {
    const listener = () => forceRerender(v => v + 1)
    listeners.add(listener)
    load()
    return () => { listeners.delete(listener) }
  }, [])

  return { user, loading: !loaded }
}
