// Piraziz Yatırım - Web Push service worker. Only handles push display and
// notification clicks - no offline caching/asset interception, this is not
// a full PWA service worker, just the minimum surface Web Push requires.

self.addEventListener("push", (event) => {
  let payload = { title: "Piraziz Yatırım", body: "Yeni bir bildirim var.", url: "/" }
  try {
    if (event.data) payload = { ...payload, ...event.data.json() }
  } catch (e) {
    // Non-JSON payload - fall back to the default text above.
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url: payload.url || "/" },
    })
  )
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const targetUrl = event.notification.data?.url || "/"

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          client.navigate(targetUrl)
          return client.focus()
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl)
      }
    })
  )
})
