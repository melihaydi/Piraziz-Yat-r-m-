/**
 * Web Push subscribe/unsubscribe flow. No external push service account
 * needed (VAPID keys are backend-owned, see core/push.py) - this just
 * registers the service worker (public/sw.js), asks the browser for
 * notification permission, and hands the resulting subscription to the
 * backend.
 */

import { authFetch } from "./auth"

export function isPushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/")
  const rawData = atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}

export async function getPushSubscriptionStatus(): Promise<boolean> {
  if (!isPushSupported()) return false
  const registration = await navigator.serviceWorker.getRegistration()
  if (!registration) return false
  const sub = await registration.pushManager.getSubscription()
  return !!sub
}

export async function subscribeToPush(): Promise<{ ok: boolean; error?: string }> {
  if (!isPushSupported()) {
    return { ok: false, error: "Bu tarayıcı bildirimleri desteklemiyor." }
  }

  const permission = await Notification.requestPermission()
  if (permission !== "granted") {
    return { ok: false, error: "Bildirim izni verilmedi." }
  }

  try {
    const registration = await navigator.serviceWorker.register("/sw.js")
    await navigator.serviceWorker.ready

    const keyRes = await authFetch("/notifications/vapid-public-key")
    if (!keyRes.ok) return { ok: false, error: "Sunucuya ulaşılamadı." }
    const { public_key } = await keyRes.json()

    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(public_key) as BufferSource,
    })

    const json = subscription.toJSON()
    const res = await authFetch("/notifications/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
    })
    if (!res.ok) return { ok: false, error: "Abonelik kaydedilemedi." }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: "Bildirimler etkinleştirilemedi." }
  }
}

export async function unsubscribeFromPush(): Promise<{ ok: boolean }> {
  if (!isPushSupported()) return { ok: true }
  const registration = await navigator.serviceWorker.getRegistration()
  if (!registration) return { ok: true }
  const subscription = await registration.pushManager.getSubscription()
  if (!subscription) return { ok: true }

  const endpoint = subscription.endpoint
  await subscription.unsubscribe()
  await authFetch("/notifications/unsubscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint }),
  }).catch(() => {})
  return { ok: true }
}
