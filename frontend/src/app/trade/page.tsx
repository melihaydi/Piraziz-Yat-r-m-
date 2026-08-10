"use client"

import React, { useState } from "react"
import Link from "next/link"
import { Settings, BarChart3, Loader2, Maximize2, Minimize2, PanelLeftOpen, ArrowLeft, Lock } from "lucide-react"
import { useTrade } from "@/contexts/TradeContext"
import InstrumentTabs from "@/components/trade/InstrumentTabs"
import AccountSummaryBar from "@/components/trade/AccountSummaryBar"
import Watchlist from "@/components/trade/Watchlist"
import TradeChart from "@/components/trade/TradeChart"
import TradeBistChart from "@/components/trade/TradeBistChart"
import OrderPanel from "@/components/trade/OrderPanel"
import PositionsTable from "@/components/trade/PositionsTable"
import OrderBookPanel from "@/components/trade/OrderBookPanel"
import TradeHistoryTable from "@/components/trade/TradeHistoryTable"
import AccountSettingsModal from "@/components/trade/AccountSettingsModal"

// Underlyings TradingView's free embed widget actually CAN display (gold via
// TVC, USDTRY/EURTRY via FX_IDC) - anything else routed through Trade is a
// real BIST-exchange instrument (a BIST30 stock, or the XU030 index), which
// TradingView's widget product is not licensed to show at all (confirmed:
// their own support states some exchanges "are not allowed... in any
// timeframe in the widgets" even though visible on tradingview.com itself).
// That's what caused the "Bu sembol sadece TradingView'de bulunabilir" popup.
const TV_WIDGET_CAPABLE = new Set(["XAUUSD", "XAUTRYG", "USDTRY", "EURTRY"])

export default function TradePage() {
  const { loading, accessDenied, account, activeTab, watchlist, viopWatchlist, selectedSymbol, pendingOrders } = useTrade()
  const [showSettings, setShowSettings] = useState(false)
  const [watchlistCollapsed, setWatchlistCollapsed] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)

  // Free tier can't use Trade at all (see deps.get_current_premium_user on
  // trade.py's router) - without this check the account/watchlist fetches
  // all silently 403'd and the page below spun on the loading state forever
  // with no explanation.
  if (accessDenied) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 min-h-screen bg-[#101015] text-center px-6">
        <Lock className="h-8 w-8 text-cyan-400" />
        <span className="text-sm font-bold text-white">Trade modülü Premium üyelik gerektirir</span>
        <span className="text-xs text-zinc-400 max-w-sm">
          Bu bölüm ücretsiz üyelikte kullanılamıyor. Üyeliğinizi yükseltmek için Ayarlar sayfasını ziyaret edin.
        </span>
        <Link href="/settings" className="mt-2 text-xs font-bold text-cyan-400 hover:text-cyan-300 underline underline-offset-2">
          Ayarlar&apos;a git
        </Link>
      </div>
    )
  }

  // No broker-selection step anymore - TradeContext auto-provisions an
  // account on first visit, so this covers both the initial load and that
  // brief auto-provisioning window with the same spinner.
  if (loading || !account) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#101015]">
        <Loader2 className="h-8 w-8 text-white animate-spin" />
      </div>
    )
  }

  const selectedInstrument = (activeTab === "viop" ? viopWatchlist : watchlist).find(i => i.symbol === selectedSymbol)
  const chartSymbol =
    activeTab === "viop"
      ? viopWatchlist.find(c => c.symbol === selectedSymbol)?.underlying_symbol || selectedSymbol
      : selectedSymbol
  const chartLabel = activeTab === "viop" ? selectedSymbol : undefined
  const isTvWidgetCapable = TV_WIDGET_CAPABLE.has(chartSymbol.toUpperCase())
  // Only the currently-charted instrument's own pending limit orders are
  // drawn - a VİOP contract's limit price is expressed in the same terms as
  // its underlying's price series (see trade_service's shared-quote
  // simplification), so plotting it on the underlying chart is correct.
  const chartPendingOrders = pendingOrders
    .filter(o => o.instrument_type === activeTab && o.symbol === selectedSymbol)
    .map(o => ({
      id: o.id,
      side: o.side,
      // STOP orders have no limit_price (they fill at the live market
      // price once triggered) - their trigger level is stop_price instead.
      limitPrice: o.order_type === "STOP" ? o.stop_price : o.limit_price,
      label: o.order_type === "STOP" ? "STOP" : o.order_type === "STOP_LIMIT" ? "STOP LİMİT" : "LİMİT",
    }))
    .filter((o): o is { id: number; side: "AL" | "SAT"; limitPrice: number; label: string } => o.limitPrice != null)

  // Fullscreen here is a CSS-only overlay (fixed inset-0) rather than the
  // browser Fullscreen API - instant and permission-free inside the Electron
  // shell, and hides the positions/history tables so the watchlist+chart+
  // order-panel trio gets the entire viewport, matching a real trading
  // terminal's "focus mode".
  const chartColSpan = watchlistCollapsed ? "xl:col-span-9" : "xl:col-span-6"

  return (
    <div className={isFullscreen ? "fixed inset-0 z-50 bg-[#101015] overflow-y-auto" : "min-h-screen bg-[#101015]"}>
      {/* Terminal chrome - replaces the app's global Header for this route,
       * so it carries its own brand mark + a way back to the main app. */}
      <div className="sticky top-0 z-20 bg-gradient-to-b from-[#16171E] to-[#101015] border-b border-slate-800/80">
        <div className="flex items-center justify-between flex-wrap gap-3 px-3 sm:px-6 py-3">
          <div className="flex items-center gap-4">
            {!isFullscreen && (
              <Link
                href="/"
                title="Ana uygulamaya dön"
                className="flex items-center gap-1.5 text-slate-500 hover:text-white transition-colors pr-3 border-r border-slate-800"
              >
                <ArrowLeft className="h-4 w-4" />
                <span className="text-[11px] font-bold hidden sm:inline">Piraziz</span>
              </Link>
            )}
            <h1 className="text-xl font-black tracking-tight text-white flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-white animate-pulse" />
              Trade
            </h1>
            <button
              onClick={() => setShowSettings(true)}
              title="Portföy değiştir"
              className="hidden sm:inline-flex items-center gap-1 text-[10px] font-bold text-slate-400 hover:text-white bg-[#1c1d26] border border-slate-800 rounded-full px-2.5 py-1 cursor-pointer transition-colors"
            >
              {account.name}
            </button>
            <InstrumentTabs />
          </div>
          <div className="flex items-center gap-2">
            {!isFullscreen && (
              <Link
                href="/trade/performance"
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-slate-800 text-xs font-bold text-slate-300 hover:border-white/30 hover:text-white transition-colors"
              >
                <BarChart3 className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Performans</span>
              </Link>
            )}
            <button
              onClick={() => setIsFullscreen(v => !v)}
              title={isFullscreen ? "Tam ekrandan çık" : "Tam ekran"}
              className="inline-flex items-center justify-center h-9 w-9 rounded-lg border border-slate-800 text-slate-400 hover:border-white/30 hover:text-white transition-colors cursor-pointer"
            >
              {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>
            {!isFullscreen && (
              <button
                onClick={() => setShowSettings(true)}
                className="inline-flex items-center justify-center h-9 w-9 rounded-lg border border-slate-800 text-slate-400 hover:border-white/30 hover:text-white transition-colors cursor-pointer"
              >
                <Settings className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="p-3 sm:p-6 space-y-5">
        <AccountSummaryBar />

        {/* Main 3-column terminal layout */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
          {watchlistCollapsed ? (
            <div className="hidden xl:flex xl:col-span-1 items-start">
              <button
                onClick={() => setWatchlistCollapsed(false)}
                title="Listeyi aç"
                className="h-10 w-10 flex items-center justify-center rounded-lg border border-slate-800 bg-[#16171E] text-slate-500 hover:text-white hover:border-white/30 transition-colors cursor-pointer"
              >
                <PanelLeftOpen className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div className="xl:col-span-3 h-[380px] xl:h-[600px]">
              <Watchlist onCollapse={() => setWatchlistCollapsed(true)} />
            </div>
          )}
          <div className={`${chartColSpan} h-[420px] xl:h-[600px] rounded-xl overflow-hidden border border-slate-800`}>
            {isTvWidgetCapable ? (
              <TradeChart symbol={chartSymbol} displayLabel={chartLabel} />
            ) : (
              <TradeBistChart
                symbol={chartSymbol}
                displayLabel={chartLabel}
                name={selectedInstrument?.name}
                price={selectedInstrument?.price}
                changePercent={selectedInstrument?.change_percent}
                pendingOrders={chartPendingOrders}
              />
            )}
          </div>
          <div className="xl:col-span-3 xl:h-[600px]">
            <OrderPanel />
          </div>
        </div>

        {!isFullscreen && (
          <>
            <PositionsTable />
            <OrderBookPanel />
            <TradeHistoryTable />
          </>
        )}
      </div>

      {showSettings && <AccountSettingsModal onClose={() => setShowSettings(false)} />}
    </div>
  )
}
