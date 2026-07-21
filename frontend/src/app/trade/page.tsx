"use client"

import React, { useState } from "react"
import Link from "next/link"
import { Settings, BarChart3, Loader2, Maximize2, Minimize2, PanelLeftOpen } from "lucide-react"
import { useTrade } from "@/contexts/TradeContext"
import BrokerSelection from "@/components/trade/BrokerSelection"
import InstrumentTabs from "@/components/trade/InstrumentTabs"
import AccountSummaryBar from "@/components/trade/AccountSummaryBar"
import Watchlist from "@/components/trade/Watchlist"
import TradeChart from "@/components/trade/TradeChart"
import OrderPanel from "@/components/trade/OrderPanel"
import PositionsTable from "@/components/trade/PositionsTable"
import TradeHistoryTable from "@/components/trade/TradeHistoryTable"
import AccountSettingsModal from "@/components/trade/AccountSettingsModal"

export default function TradePage() {
  const { loading, account, activeTab, watchlist, viopWatchlist, selectedSymbol } = useTrade()
  const [showSettings, setShowSettings] = useState(false)
  const [watchlistCollapsed, setWatchlistCollapsed] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-4rem)]">
        <Loader2 className="h-8 w-8 text-cyan-400 animate-spin" />
      </div>
    )
  }

  if (!account) {
    return (
      <div className="p-8">
        <BrokerSelection />
      </div>
    )
  }

  const chartSymbol =
    activeTab === "viop"
      ? viopWatchlist.find(c => c.symbol === selectedSymbol)?.underlying_symbol || selectedSymbol
      : selectedSymbol
  const chartLabel = activeTab === "viop" ? selectedSymbol : undefined

  // Fullscreen here is a CSS-only overlay (fixed inset-0, above the app
  // shell/sidebar) rather than the browser Fullscreen API - this keeps it
  // instant and permission-free inside the Electron shell, and lets us hide
  // the positions/history tables so the watchlist+chart+order-panel trio
  // gets the entire viewport, matching a real trading terminal's "focus mode".
  const chartColSpan = watchlistCollapsed ? "xl:col-span-9" : "xl:col-span-6"

  return (
    <div className={isFullscreen ? "fixed inset-0 z-50 bg-slate-950 p-4 overflow-y-auto space-y-4" : "p-6 space-y-5"}>
      <>
        {/* Header row */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-black tracking-tight text-slate-100 flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-cyan-400 animate-pulse" />
              Trade
            </h1>
            <InstrumentTabs />
          </div>
          <div className="flex items-center gap-2">
            {!isFullscreen && (
              <Link
                href="/trade/performance"
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-slate-800 text-xs font-bold text-slate-300 hover:border-cyan-500/40 hover:text-cyan-300 transition-colors"
              >
                <BarChart3 className="h-3.5 w-3.5" />
                Performans
              </Link>
            )}
            <button
              onClick={() => setIsFullscreen(v => !v)}
              title={isFullscreen ? "Tam ekrandan çık" : "Tam ekran"}
              className="inline-flex items-center justify-center h-9 w-9 rounded-lg border border-slate-800 text-slate-400 hover:border-cyan-500/40 hover:text-cyan-300 transition-colors cursor-pointer"
            >
              {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>
            {!isFullscreen && (
              <button
                onClick={() => setShowSettings(true)}
                className="inline-flex items-center justify-center h-9 w-9 rounded-lg border border-slate-800 text-slate-400 hover:border-cyan-500/40 hover:text-cyan-300 transition-colors cursor-pointer"
              >
                <Settings className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        <AccountSummaryBar />

        {/* Main 3-column terminal layout */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
          {watchlistCollapsed ? (
            <div className="hidden xl:flex xl:col-span-1 items-start">
              <button
                onClick={() => setWatchlistCollapsed(false)}
                title="Listeyi aç"
                className="h-10 w-10 flex items-center justify-center rounded-lg border border-slate-800 bg-slate-950/60 text-slate-500 hover:text-cyan-300 hover:border-cyan-500/40 transition-colors cursor-pointer"
              >
                <PanelLeftOpen className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div className="xl:col-span-3 h-[600px]">
              <Watchlist onCollapse={() => setWatchlistCollapsed(true)} />
            </div>
          )}
          <div className={`${chartColSpan} h-[600px] rounded-xl overflow-hidden border border-slate-800`}>
            <TradeChart symbol={chartSymbol} displayLabel={chartLabel} />
          </div>
          <div className="xl:col-span-3 h-[600px]">
            <OrderPanel />
          </div>
        </div>

        {!isFullscreen && (
          <>
            <PositionsTable />
            <TradeHistoryTable />
          </>
        )}
      </>

      {showSettings && <AccountSettingsModal onClose={() => setShowSettings(false)} />}
    </div>
  )
}
