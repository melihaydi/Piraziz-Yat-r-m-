"use client"

import { useEffect, useRef } from "react"
import { isBistSessionOpen } from "./bistSession"

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

/**
 * Same as pollWhileVisible, plus a second gate on the REPEATING part only:
 * BIST live price/fund data doesn't change outside the cash session
 * (Mon-Fri 09:30-18:15 Istanbul time, see bistSession.ts), so re-requesting
 * every few seconds all evening and every weekend was pure waste. But the
 * very first call always fires as soon as the tab is visible, session open
 * or not - without this, opening the app outside market hours (which is
 * most of the day) left every page that used only this for its data
 * showing an infinite loading skeleton, since fetchOnce() had literally
 * never run yet. Shipped broken once already for exactly that reason:
 * confirmed live, "Popüler Fonlar - Anlık Getiri" (and the screener,
 * dashboard, portfolio and funds lists, which all rely on this same
 * helper) never loaded at all outside 09:30-18:15. Re-checks the session
 * boundary once a minute (not just on visibility change) so a tab left
 * open across 09:30 or 18:15 starts/stops polling on its own.
 */
export function pollWhileVisibleAndOpen(callback: () => void, intervalMs: number): () => void {
  let timerId: ReturnType<typeof setInterval> | null = null
  let hasFetchedOnce = false

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

  const evaluate = () => {
    if (document.visibilityState !== "visible") {
      stop()
      return
    }
    if (!hasFetchedOnce) {
      hasFetchedOnce = true
      callback()
    }
    if (isBistSessionOpen()) {
      start()
    } else {
      stop()
    }
  }

  const onVisibilityChange = () => {
    // Returning to the tab always refreshes once, same as pollWhileVisible -
    // whatever's on screen was last fetched before the tab was hidden, so
    // it's stale by definition, session open or not.
    if (document.visibilityState === "visible") {
      hasFetchedOnce = false
    }
    evaluate()
  }

  evaluate()
  document.addEventListener("visibilitychange", onVisibilityChange)
  // Catches the session opening/closing while the tab stays visible the
  // whole time (e.g. left open overnight into the next trading day).
  const sessionCheckId = setInterval(evaluate, 60000)

  return () => {
    stop()
    document.removeEventListener("visibilitychange", onVisibilityChange)
    clearInterval(sessionCheckId)
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
