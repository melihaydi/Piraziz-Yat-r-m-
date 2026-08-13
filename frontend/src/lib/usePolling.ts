"use client"

import { useEffect, useRef } from "react"

/**
 * setInterval for data polling that pauses while the tab is hidden.
 *
 * Every polling loop in this app used to be a plain setInterval, which the
 * browser keeps firing when the tab is in the background or the phone is
 * locked. The cadences are aggressive by design (market data feels stale
 * fast) - the header's index ticker every 5s, the dashboard's market
 * summary every 2s, the screener list every 2s, the Trade module's
 * watchlist/VİOP/account/orders every 2-3s. A single user who parks a tab
 * and walks away therefore kept generating tens of requests per minute
 * indefinitely, against a 1GB single-CPU host that already swaps under
 * load. None of those responses were ever rendered.
 *
 * This keeps the same visible behaviour - and refetches immediately when
 * the user comes back, so returning to the tab shows fresh data rather than
 * waiting out the remaining interval - while producing zero traffic in
 * between.
 *
 * `callback` is held in a ref, so passing an inline arrow function does not
 * tear down and recreate the interval on every render.
 */
/**
 * Imperative sibling of usePolling, for the several places that set up
 * multiple polls inside one big useEffect (the dashboard, the funds list,
 * the strategy page). Same visibility semantics; returns a cleanup function
 * to call from the effect's teardown, so it drops into existing code
 * wherever a `const id = setInterval(fn, ms)` / `clearInterval(id)` pair
 * already lives, without restructuring the effect.
 */
export function pollWhileVisible(callback: () => void, intervalMs: number): () => void {
  let timerId: ReturnType<typeof setInterval> | null = null

  const stop = () => {
    if (timerId !== null) {
      clearInterval(timerId)
      timerId = null
    }
  }

  const start = () => {
    if (timerId !== null) return
    timerId = setInterval(callback, intervalMs)
  }

  const onVisibilityChange = () => {
    if (document.visibilityState === "visible") {
      callback()
      start()
    } else {
      stop()
    }
  }

  if (document.visibilityState === "visible") start()
  document.addEventListener("visibilitychange", onVisibilityChange)

  return () => {
    stop()
    document.removeEventListener("visibilitychange", onVisibilityChange)
  }
}

export function usePolling(callback: () => void, intervalMs: number, enabled: boolean = true) {
  const savedCallback = useRef(callback)

  useEffect(() => {
    savedCallback.current = callback
  }, [callback])

  useEffect(() => {
    if (!enabled) return

    let timerId: ReturnType<typeof setInterval> | null = null

    const stop = () => {
      if (timerId !== null) {
        clearInterval(timerId)
        timerId = null
      }
    }

    const start = () => {
      if (timerId !== null) return
      timerId = setInterval(() => savedCallback.current(), intervalMs)
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        // Fire once right away: whatever is on screen was last refreshed
        // before the tab was hidden, so it is by definition stale.
        savedCallback.current()
        start()
      } else {
        stop()
      }
    }

    if (document.visibilityState === "visible") start()
    document.addEventListener("visibilitychange", onVisibilityChange)

    return () => {
      stop()
      document.removeEventListener("visibilitychange", onVisibilityChange)
    }
  }, [intervalMs, enabled])
}
