"use client"

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react"
import { authFetch } from "@/lib/auth"
import { pollWhileVisible } from "@/lib/usePolling"

export type InstrumentType = "stock" | "viop"
export type Broker = "info_yatirim" | "midas"

// Kept in sync with backend/app/services/trade_service.py's
// DEFAULT_STARTING_BALANCE - used to auto-provision a trade account on
// first visit (see the bootstrap effect below) now that there's no broker-
// selection step asking the user to choose a starting balance.
const DEFAULT_STARTING_BALANCE = 325000.0

// Which account the polling/order/history calls below act on, persisted so
// a reload keeps the user on the same portfolio instead of silently
// snapping back to their default one.
const ACTIVE_ACCOUNT_STORAGE_KEY = "bip_trade_active_account_id"

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
  name: string
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

/** Lightweight per-account summary used by the account switcher - see
 * trade_service.account_summary_dict (no live valuation, so listing several
 * accounts doesn't cost a price fetch per position per account). */
export interface TradeAccountSummary {
  id: number
  name: string
  broker: Broker
  starting_balance: number
  created_at: string
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
  /** True once the backend has confirmed this account can't use Trade at
   * all (free tier - see deps.get_current_premium_user on trade.py's
   * router) - without this, a blocked user's account/watchlist fetches all
   * silently returned empty/failed and the page just spun forever instead
   * of explaining why nothing loaded. */
  accessDenied: boolean
  account: TradeAccountData | null
  accounts: TradeAccountSummary[]
  activeAccountId: number | null
  switchAccount: (accountId: number) => void
  createAdditionalAccount: (broker: Broker, startingBalance: number, name: string) => Promise<OrderResult>
  renameAccount: (accountId: number, name: string) => Promise<OrderResult>
  deleteAccount: (accountId: number) => Promise<OrderResult>
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
  const [accessDenied, setAccessDenied] = useState(false)
  // Mirrored into a ref so the bootstrap effect can check the just-set value
  // synchronously right after refreshAccounts() resolves, without waiting
  // for the next render (state updates are batched/async) - otherwise it'd
  // still fire the doomed create-account call this same bootstrap pass.
  const accessDeniedRef = useRef(false)
  const [account, setAccount] = useState<TradeAccountData | null>(null)
  const [accounts, setAccounts] = useState<TradeAccountSummary[]>([])
  const [activeAccountId, setActiveAccountId] = useState<number | null>(null)
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([])
  const [viopWatchlist, setViopWatchlist] = useState<WatchlistItem[]>([])
  const [activeTab, setActiveTab] = useState<InstrumentType>("stock")
  const [selectedSymbol, setSelectedSymbol] = useState<string>("AKBNK")
  const [history, setHistory] = useState<TradeHistoryItem[]>([])
  const [pendingOrders, setPendingOrders] = useState<PendingOrder[]>([])

  // Mirrored into a ref so callbacks that read it (refreshAccount, etc.)
  // don't need activeAccountId as a dependency - every one of those is
  // already keyed off account?.id/hasAccount elsewhere for polling
  // intervals, and adding this as a dep too would tear down and recreate
  // those intervals on every account switch instead of just re-fetching.
  const activeAccountIdRef = useRef<number | null>(null)
  activeAccountIdRef.current = activeAccountId

  // Tracks whether the user has manually picked a symbol yet, so the
  // watchlist's first-load doesn't clobber their selection on every poll
  // (same stale-closure pitfall fixed elsewhere in this app - handled here
  // with a ref instead of state so the fetch effect doesn't need it as a dep).
  const hasAutoSelected = useRef(false)

  const markAccessDenied = useCallback(() => {
    accessDeniedRef.current = true
    setAccessDenied(true)
  }, [])

  const withAccountParam = useCallback((path: string): string => {
    const id = activeAccountIdRef.current
    if (id == null) return path
    return path.includes("?") ? `${path}&account_id=${id}` : `${path}?account_id=${id}`
  }, [])

  const switchAccount = useCallback((accountId: number) => {
    setActiveAccountId(accountId)
    try {
      localStorage.setItem(ACTIVE_ACCOUNT_STORAGE_KEY, String(accountId))
    } catch (e) {
      // Private browsing / storage disabled - the switch still works for
      // this session, it just won't survive a reload.
    }
  }, [])

  const refreshAccounts = useCallback(async (): Promise<TradeAccountSummary[]> => {
    try {
      const res = await authFetch("/trade/accounts")
      if (res.status === 403) markAccessDenied()
      if (!res.ok) return []
      const data = await res.json()
      if (!Array.isArray(data)) return []
      setAccounts(data)
      return data
    } catch (e) {
      console.error("Failed to load trade accounts:", e)
      return []
    }
  }, [markAccessDenied])

  const refreshAccount = useCallback(async (): Promise<TradeAccountData | null> => {
    try {
      const res = await authFetch(withAccountParam("/trade/account"))
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
  }, [withAccountParam])

  const refreshHistory = useCallback(async () => {
    try {
      const res = await authFetch(withAccountParam("/trade/history?limit=100"))
      if (!res.ok) return
      const data = await res.json()
      if (Array.isArray(data)) setHistory(data)
    } catch (e) {
      console.error("Failed to load trade history:", e)
    }
  }, [withAccountParam])

  const refreshPendingOrders = useCallback(async () => {
    try {
      const res = await authFetch(withAccountParam("/trade/pending-orders"))
      if (!res.ok) return
      const data = await res.json()
      if (Array.isArray(data)) setPendingOrders(data)
    } catch (e) {
      console.error("Failed to load pending orders:", e)
    }
  }, [withAccountParam])

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

  const createAdditionalAccount = useCallback(
    async (broker: Broker, startingBalance: number, name: string): Promise<OrderResult> => {
      try {
        const res = await authFetch("/trade/accounts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ broker, starting_balance: startingBalance, name }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          return { ok: false, error: err.detail || "Portföy oluşturulamadı." }
        }
        const data = await res.json()
        await refreshAccounts()
        switchAccount(data.id)
        return { ok: true }
      } catch (e) {
        return { ok: false, error: "Sunucuya ulaşılamadı." }
      }
    },
    [refreshAccounts, switchAccount]
  )

  const renameAccount = useCallback(
    async (accountId: number, name: string): Promise<OrderResult> => {
      try {
        const res = await authFetch(`/trade/accounts/${accountId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          return { ok: false, error: err.detail || "Portföy adı değiştirilemedi." }
        }
        await refreshAccounts()
        if (accountId === activeAccountIdRef.current) await refreshAccount()
        return { ok: true }
      } catch (e) {
        return { ok: false, error: "Sunucuya ulaşılamadı." }
      }
    },
    [refreshAccounts, refreshAccount]
  )

  const deleteAccount = useCallback(
    async (accountId: number): Promise<OrderResult> => {
      try {
        const res = await authFetch(`/trade/accounts/${accountId}`, { method: "DELETE" })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          return { ok: false, error: err.detail || "Portföy silinemedi." }
        }
        const remaining = await refreshAccounts()
        if (accountId === activeAccountIdRef.current && remaining.length > 0) {
          switchAccount(remaining[0].id)
        }
        return { ok: true }
      } catch (e) {
        return { ok: false, error: "Sunucuya ulaşılamadı." }
      }
    },
    [refreshAccounts, switchAccount]
  )

  // Initial load. There's no broker-selection step anymore - if the user
  // has no trade account yet, one is auto-provisioned silently instead of
  // asking them to pick a broker/balance first (both brokers run the exact
  // same simulation - see change_broker - so there was nothing functional
  // riding on that choice besides a cosmetic label). Also restores whichever
  // account was last active, falling back to the first one.
  useEffect(() => {
    let active = true
    const bootstrap = async () => {
      let list = await refreshAccounts()
      if (active && list.length === 0 && !accessDeniedRef.current) {
        await createAccount("midas", DEFAULT_STARTING_BALANCE)
        list = await refreshAccounts()
      }
      if (!active) return
      let storedId: number | null = null
      try {
        const raw = localStorage.getItem(ACTIVE_ACCOUNT_STORAGE_KEY)
        storedId = raw ? parseInt(raw, 10) : null
      } catch (e) {
        storedId = null
      }
      const resolvedId = list.some(a => a.id === storedId) ? storedId : (list[0]?.id ?? null)
      if (resolvedId != null) setActiveAccountId(resolvedId)
      setLoading(false)
    }
    bootstrap()
    return () => {
      active = false
    }
  }, [refreshAccounts, createAccount])

  // Once an account is selected (bootstrap resolved it, or the user
  // switched), (re)load its data immediately rather than waiting for the
  // next poll tick.
  useEffect(() => {
    if (activeAccountId == null) return
    refreshAccount()
    refreshHistory()
    refreshPendingOrders()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAccountId])

  // Poll BIST30 watchlist every 2s (matches the rest of the app's live-poll
  // rate) - the backend serves this from the already-connected TradingView
  // websocket cache, so this doesn't add real network/API load.
  //
  // Uses authFetch, not a bare fetch() - /trade/watchlist takes a `delay`
  // param whose own dependency (get_data_delay_minutes) requires a logged-in
  // user to know which membership tier's delay to apply. An unauthenticated
  // request here always 401'd, which is why stocks/VİOP silently never
  // appeared in the watchlist regardless of the premium-only gating above.
  useEffect(() => {
    let active = true
    const fetchWatchlist = () => {
      authFetch("/trade/watchlist")
        .then(res => (res.ok ? res.json() : []))
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
    const stop = pollWhileVisible(fetchWatchlist, 2000)
    return () => {
      active = false
      stop()
    }
  }, [])

  useEffect(() => {
    let active = true
    const fetchViop = () => {
      authFetch("/trade/viop-contracts")
        .then(res => (res.ok ? res.json() : []))
        .then(data => {
          if (active && Array.isArray(data)) setViopWatchlist(data)
        })
        .catch(err => console.error("Failed to load VİOP contracts:", err))
    }
    fetchViop()
    const stop = pollWhileVisible(fetchViop, 2000)
    return () => {
      active = false
      stop()
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
    return pollWhileVisible(refreshAccount, 3000)
  }, [hasAccount, refreshAccount])

  // Pending (resting LIMIT) orders - polled on the same cadence as the
  // account so the order-book panel and the chart's price lines reflect a
  // fill/cancel within a few seconds. Fills themselves are actually
  // triggered server-side as a side effect of the /trade/account poll (see
  // trade_service.serialize_account -> _check_pending_orders), this poll
  // just picks up the resulting state.
  useEffect(() => {
    if (!hasAccount) return
    return pollWhileVisible(refreshPendingOrders, 3000)
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
      const res = await authFetch(withAccountParam("/trade/account/broker"), {
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
  }, [withAccountParam])

  const resetAccount = useCallback(async (broker: Broker, startingBalance: number): Promise<OrderResult> => {
    try {
      const res = await authFetch(withAccountParam("/trade/account/reset"), {
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
  }, [withAccountParam, refreshHistory])

  const depositFunds = useCallback(async (amount: number): Promise<OrderResult> => {
    try {
      // No retry on a network-level failure here - if the drop happens after
      // the backend already committed the deposit but before the response
      // arrives, a silent retry would resubmit the same amount a second time.
      const res = await authFetch(withAccountParam("/trade/account/deposit"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount }),
      }, 0)
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
  }, [withAccountParam])

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
        // Same reasoning as depositFunds above - never silently resubmit an
        // order on a network-level failure, that could double-fill it.
        const res = await authFetch(withAccountParam("/trade/order"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            instrument_type: instrumentType, symbol, side, lot,
            order_type: orderType, limit_price: limitPrice, stop_price: stopPrice,
          }),
        }, 0)
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
    [withAccountParam, refreshHistory, refreshPendingOrders]
  )

  const cancelPendingOrder = useCallback(
    async (orderId: number): Promise<OrderResult> => {
      try {
        const res = await authFetch(withAccountParam(`/trade/pending-orders/${orderId}`), { method: "DELETE" })
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
    [withAccountParam, refreshPendingOrders]
  )

  const value: TradeContextValue = {
    loading,
    accessDenied,
    account,
    accounts,
    activeAccountId,
    switchAccount,
    createAdditionalAccount,
    renameAccount,
    deleteAccount,
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
