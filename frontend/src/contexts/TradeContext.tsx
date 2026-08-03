"use client"

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react"
import { authFetch } from "@/lib/auth"
import { API_BASE_URL } from "@/lib/config"

export type InstrumentType = "stock" | "viop"
export type Broker = "info_yatirim" | "midas"

// Kept in sync with backend/app/services/trade_service.py's
// DEFAULT_STARTING_BALANCE - used to auto-provision a trade account on
// first visit (see the bootstrap effect below) now that there's no broker-
// selection step asking the user to choose a starting balance.
const DEFAULT_STARTING_BALANCE = 325000.0

export type PositionSide = "LONG" | "SHORT"

export interface TradePosition {
  id: number
  instrument_type: InstrumentType
  symbol: string
  position_side: PositionSide
  lot: number
  avg_cost: number
  current_price: number
  position_value: number
  pnl: number
  pnl_pct: number
}

export interface TradeAccountData {
  id: number
  broker: Broker
  starting_balance: number
  cash_balance: number
  locked_cash: number
  available_cash: number
  stock_position_value: number
  viop_position_value: number
  used_margin: number
  total_portfolio_value: number
  daily_pnl: number
  total_pnl: number
  unrealized_pnl: number
  realized_pnl: number
  return_pct: number
  positions: TradePosition[]
}

export interface WatchlistItem {
  symbol: string
  name: string
  price: number
  change_percent: number
  bid: number
  ask: number
  /** Only present for VİOP contract entries - the real underlying spot
   * symbol this contract proxies (see backend trade_service.VIOP_CONTRACTS). */
  underlying_symbol?: string
}

export interface TradeHistoryItem {
  id: number
  instrument_type: InstrumentType
  symbol: string
  side: "AL" | "SAT"
  lot: number
  price: number
  commission: number
  total: number
  realized_pnl: number | null
  executed_at: string
}

export type OrderType = "MARKET" | "LIMIT" | "STOP" | "STOP_LIMIT"

export interface PendingOrder {
  id: number
  instrument_type: InstrumentType
  symbol: string
  side: "AL" | "SAT"
  lot: number
  order_type: OrderType
  limit_price: number | null
  stop_price: number | null
  created_at: string
}

interface OrderResult {
  ok: boolean
  error?: string
}

interface TradeContextValue {
  loading: boolean
  account: TradeAccountData | null
  watchlist: WatchlistItem[]
  viopWatchlist: WatchlistItem[]
  activeTab: InstrumentType
  setActiveTab: (tab: InstrumentType) => void
  selectedSymbol: string
  setSelectedSymbol: (symbol: string) => void
  history: TradeHistoryItem[]
  pendingOrders: PendingOrder[]
  createAccount: (broker: Broker, startingBalance: number) => Promise<OrderResult>
  changeBroker: (broker: Broker) => Promise<OrderResult>
  resetAccount: (broker: Broker, startingBalance: number) => Promise<OrderResult>
  depositFunds: (amount: number) => Promise<OrderResult>
  placeOrder: (
    instrumentType: InstrumentType,
    symbol: string,
    side: "AL" | "SAT",
    lot: number,
    orderType?: OrderType,
    limitPrice?: number,
    stopPrice?: number
  ) => Promise<OrderResult>
  cancelPendingOrder: (orderId: number) => Promise<OrderResult>
  refreshAccount: () => Promise<TradeAccountData | null>
  refreshHistory: () => Promise<void>
}

const TradeContext = createContext<TradeContextValue | null>(null)

export function useTrade(): TradeContextValue {
  const ctx = useContext(TradeContext)
  if (!ctx) throw new Error("useTrade must be used within a TradeProvider")
  return ctx
}

export function TradeProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [account, setAccount] = useState<TradeAccountData | null>(null)
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([])
  const [viopWatchlist, setViopWatchlist] = useState<WatchlistItem[]>([])
  const [activeTab, setActiveTab] = useState<InstrumentType>("stock")
  const [selectedSymbol, setSelectedSymbol] = useState<string>("AKBNK")
  const [history, setHistory] = useState<TradeHistoryItem[]>([])
  const [pendingOrders, setPendingOrders] = useState<PendingOrder[]>([])

  // Tracks whether the user has manually picked a symbol yet, so the
  // watchlist's first-load doesn't clobber their selection on every poll
  // (same stale-closure pitfall fixed elsewhere in this app - handled here
  // with a ref instead of state so the fetch effect doesn't need it as a dep).
  const hasAutoSelected = useRef(false)

  const refreshAccount = useCallback(async (): Promise<TradeAccountData | null> => {
    try {
      const res = await authFetch("/trade/account")
      if (res.status === 404) {
        setAccount(null)
        return null
      }
      if (!res.ok) return null
      const data = await res.json()
      setAccount(data)
      return data
    } catch (e) {
      console.error("Failed to load trade account:", e)
      return null
    }
  }, [])

  const refreshHistory = useCallback(async () => {
    try {
      const res = await authFetch("/trade/history?limit=100")
      if (!res.ok) return
      const data = await res.json()
      if (Array.isArray(data)) setHistory(data)
    } catch (e) {
      console.error("Failed to load trade history:", e)
    }
  }, [])

  const refreshPendingOrders = useCallback(async () => {
    try {
      const res = await authFetch("/trade/pending-orders")
      if (!res.ok) return
      const data = await res.json()
      if (Array.isArray(data)) setPendingOrders(data)
    } catch (e) {
      console.error("Failed to load pending orders:", e)
    }
  }, [])

  const createAccount = useCallback(async (broker: Broker, startingBalance: number): Promise<OrderResult> => {
    try {
      const res = await authFetch("/trade/account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ broker, starting_balance: startingBalance }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        return { ok: false, error: err.detail || "Hesap oluşturulamadı." }
      }
      const data = await res.json()
      setAccount(data)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: "Sunucuya ulaşılamadı." }
    }
  }, [])

  // Initial load. There's no broker-selection step anymore - if the user
  // has no trade account yet, one is auto-provisioned silently instead of
  // asking them to pick a broker/balance first (both brokers run the exact
  // same simulation - see change_broker - so there was nothing functional
  // riding on that choice besides a cosmetic label).
  useEffect(() => {
    let active = true
    const bootstrap = async () => {
      const existing = await refreshAccount()
      if (active && !existing) {
        await createAccount("midas", DEFAULT_STARTING_BALANCE)
      }
      if (active) setLoading(false)
    }
    bootstrap()
    return () => {
      active = false
    }
  }, [refreshAccount, createAccount])

  // Poll BIST30 watchlist every 2s (matches the rest of the app's live-poll
  // rate) - the backend serves this from the already-connected TradingView
  // websocket cache, so this doesn't add real network/API load.
  useEffect(() => {
    let active = true
    const fetchWatchlist = () => {
      fetch(`${API_BASE_URL}/api/v1/trade/watchlist`)
        .then(res => res.json())
        .then(data => {
          if (!active || !Array.isArray(data)) return
          setWatchlist(data)
          if (!hasAutoSelected.current && data.length > 0) {
            hasAutoSelected.current = true
            setSelectedSymbol(data[0].symbol)
          }
        })
        .catch(err => console.error("Failed to load trade watchlist:", err))
    }
    fetchWatchlist()
    const interval = setInterval(fetchWatchlist, 2000)
    return () => {
      active = false
      clearInterval(interval)
    }
  }, [])

  useEffect(() => {
    let active = true
    const fetchViop = () => {
      fetch(`${API_BASE_URL}/api/v1/trade/viop-contracts`)
        .then(res => res.json())
        .then(data => {
          if (active && Array.isArray(data)) setViopWatchlist(data)
        })
        .catch(err => console.error("Failed to load VİOP contracts:", err))
    }
    fetchViop()
    const interval = setInterval(fetchViop, 2000)
    return () => {
      active = false
      clearInterval(interval)
    }
  }, [])

  // Poll the account (positions/P&L) every 3s once onboarded - slightly
  // slower than the watchlist since it recomputes P&L across all positions.
  // Depends on hasAccount (a boolean), not `account` itself - `account` gets
  // a new object reference on every one of these very polls, which used to
  // re-run this effect (tearing down + recreating the interval) on every
  // single tick instead of ever letting one run on its own cadence.
  const hasAccount = !!account
  useEffect(() => {
    if (!hasAccount) return
    const interval = setInterval(refreshAccount, 3000)
    return () => clearInterval(interval)
  }, [hasAccount, refreshAccount])

  useEffect(() => {
    if (account) refreshHistory()
  }, [account?.id, refreshHistory]) // eslint-disable-line react-hooks/exhaustive-deps

  // Pending (resting LIMIT) orders - polled on the same cadence as the
  // account so the order-book panel and the chart's price lines reflect a
  // fill/cancel within a few seconds. Fills themselves are actually
  // triggered server-side as a side effect of the /trade/account poll (see
  // trade_service.serialize_account -> _check_pending_orders), this poll
  // just picks up the resulting state.
  useEffect(() => {
    if (!hasAccount) return
    refreshPendingOrders()
    const interval = setInterval(refreshPendingOrders, 3000)
    return () => clearInterval(interval)
  }, [hasAccount, refreshPendingOrders])

  // Whenever the tab switches, default the selected symbol to something
  // valid for that tab so the chart/order panel don't stay on a symbol from
  // the other instrument universe.
  useEffect(() => {
    if (activeTab === "viop" && viopWatchlist.length > 0) {
      setSelectedSymbol(prev => (viopWatchlist.some(c => c.symbol === prev) ? prev : viopWatchlist[0].symbol))
    } else if (activeTab === "stock" && watchlist.length > 0) {
      setSelectedSymbol(prev => (watchlist.some(c => c.symbol === prev) ? prev : watchlist[0].symbol))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab])

  const changeBroker = useCallback(async (broker: Broker): Promise<OrderResult> => {
    try {
      const res = await authFetch("/trade/account/broker", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ broker }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        return { ok: false, error: err.detail || "Broker değiştirilemedi." }
      }
      const data = await res.json()
      setAccount(data)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: "Sunucuya ulaşılamadı." }
    }
  }, [])

  const resetAccount = useCallback(async (broker: Broker, startingBalance: number): Promise<OrderResult> => {
    try {
      const res = await authFetch("/trade/account/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ broker, starting_balance: startingBalance }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        return { ok: false, error: err.detail || "Hesap sıfırlanamadı." }
      }
      const data = await res.json()
      setAccount(data)
      await refreshHistory()
      return { ok: true }
    } catch (e) {
      return { ok: false, error: "Sunucuya ulaşılamadı." }
    }
  }, [refreshHistory])

  const depositFunds = useCallback(async (amount: number): Promise<OrderResult> => {
    try {
      const res = await authFetch("/trade/account/deposit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        return { ok: false, error: err.detail || "Bakiye eklenemedi." }
      }
      const data = await res.json()
      setAccount(data)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: "Sunucuya ulaşılamadı." }
    }
  }, [])

  const placeOrder = useCallback(
    async (
      instrumentType: InstrumentType,
      symbol: string,
      side: "AL" | "SAT",
      lot: number,
      orderType: OrderType = "MARKET",
      limitPrice?: number,
      stopPrice?: number
    ): Promise<OrderResult> => {
      try {
        const res = await authFetch("/trade/order", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            instrument_type: instrumentType, symbol, side, lot,
            order_type: orderType, limit_price: limitPrice, stop_price: stopPrice,
          }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          return { ok: false, error: err.detail || "Emir gerçekleştirilemedi." }
        }
        const data = await res.json()
        setAccount(data)
        await Promise.all([refreshHistory(), refreshPendingOrders()])
        return { ok: true }
      } catch (e) {
        return { ok: false, error: "Sunucuya ulaşılamadı." }
      }
    },
    [refreshHistory, refreshPendingOrders]
  )

  const cancelPendingOrder = useCallback(
    async (orderId: number): Promise<OrderResult> => {
      try {
        const res = await authFetch(`/trade/pending-orders/${orderId}`, { method: "DELETE" })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          return { ok: false, error: err.detail || "Emir iptal edilemedi." }
        }
        const data = await res.json()
        setAccount(data)
        await refreshPendingOrders()
        return { ok: true }
      } catch (e) {
        return { ok: false, error: "Sunucuya ulaşılamadı." }
      }
    },
    [refreshPendingOrders]
  )

  const value: TradeContextValue = {
    loading,
    account,
    watchlist,
    viopWatchlist,
    activeTab,
    setActiveTab,
    selectedSymbol,
    setSelectedSymbol,
    history,
    pendingOrders,
    createAccount,
    changeBroker,
    resetAccount,
    depositFunds,
    placeOrder,
    cancelPendingOrder,
    refreshAccount,
    refreshHistory,
  }

  return <TradeContext.Provider value={value}>{children}</TradeContext.Provider>
}
