"use client"

import { useEffect, useState } from "react"

/**
 * BIST cash market session: Mon-Fri, 09:30-18:15 Turkey local time - matches
 * the backend's own gate (see market_data.py's _is_bist_session_open and
 * strategy_engine.py's start_background_refresh loop, which already skip
 * their own work outside these hours). Computed via Intl with an explicit
 * Europe/Istanbul zone rather than the device's own timezone/clock, so a
 * visitor browsing from outside Turkey still sees the real Istanbul session
 * window, not their own local one.
 */
export function isBistSessionOpen(now: Date = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Istanbul",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now)

  const get = (type: string) => parts.find(p => p.type === type)?.value ?? ""
  const weekday = get("weekday")
  if (weekday === "Sat" || weekday === "Sun") return false

  const hour = Number(get("hour"))
  const minute = Number(get("minute"))
  const minutesSinceMidnight = hour * 60 + minute
  return minutesSinceMidnight >= 9 * 60 + 30 && minutesSinceMidnight <= 18 * 60 + 15
}

/**
 * React hook form of isBistSessionOpen() for callers that need it as a
 * value to pass into usePolling's `enabled` prop (rather than the
 * imperative pollWhileVisibleAndOpen, which owns its own interval). Rechecks
 * once a minute so a tab left open across the 09:30/18:15 boundary picks up
 * the change on its own.
 */
export function useBistSessionOpen(): boolean {
  const [open, setOpen] = useState(isBistSessionOpen)
  useEffect(() => {
    setOpen(isBistSessionOpen())
    const id = setInterval(() => setOpen(isBistSessionOpen()), 60000)
    return () => clearInterval(id)
  }, [])
  return open
}
