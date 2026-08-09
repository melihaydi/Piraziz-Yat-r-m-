"use client"

import React, { useEffect, useRef, useState } from "react"
import {
  createChart,
  ColorType,
  IChartApi,
  ISeriesApi,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  PriceScaleMode,
  IPriceLine,
} from "lightweight-charts"
import { Eye, EyeOff, Scan, TrendingUp, Minus, ArrowUpRight, Square, GitBranch, Type, Trash2, MousePointer2, Download } from "lucide-react"
import { DrawingManager, DrawingTool, Drawing } from "@/lib/chartDrawingTools"

interface ChartDataPoint {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
  sma20?: number
  ema20?: number
  vwap?: number
  rsi?: number
  macd?: number
  macd_signal?: number
  macd_hist?: number
  bb_mid?: number
  bb_upper?: number
  bb_lower?: number
}

/** A resting LIMIT/STOP/STOP_LIMIT order to draw as a horizontal price line
 * on the chart (see Trade module's order book - OrderBookPanel.tsx). */
export interface PendingOrderLine {
  id: number
  side: "AL" | "SAT"
  limitPrice: number
  /** "LİMİT" or "STOP" - which trigger this line represents. */
  label: string
}

interface TradingViewChartProps {
  data: ChartDataPoint[]
  pendingOrders?: PendingOrderLine[]
  /** Used only to key drawing persistence (localStorage) per instrument -
   * switching symbols shouldn't show another stock's trend lines. Falls
   * back to a shared "default" bucket if omitted. */
  symbol?: string
}

const drawingsStorageKey = (symbol: string) => `bip_chart_drawings_${symbol}`

type ScaleMode = "linear" | "log" | "percent"

const CHART_BASE_OPTIONS = {
  layout: {
    background: { type: ColorType.Solid, color: "#18181b" },
    textColor: "#a1a1aa",
  },
  grid: {
    vertLines: { color: "#27272a" },
    horzLines: { color: "#27272a" },
  },
  crosshair: {
    mode: 0, // CrosshairMode.Normal
    vertLine: { color: "#52525b", labelBackgroundColor: "#3f3f46" },
    horzLine: { color: "#52525b", labelBackgroundColor: "#3f3f46" },
  },
}

// Single source of truth for indicator colors - shared between the series
// themselves, the toolbar toggle buttons (color dot) and the hover tooltip,
// so a line's color always matches its label everywhere on screen. This
// matters more now that up to 11 lines (SMA+EMA+VWAP+BB x3+RSI+bands x2+
// MACD x3) can be on screen at once - color is the only way to tell them apart.
const INDICATOR_COLORS = {
  sma: "#3b82f6",
  ema: "#eab308",
  vwap: "#a855f7",
  bb: "#ec4899",
  rsi: "#f97316",
  macd: "#60a5fa",
  macdSignal: "#fb7185",
}

function fmtChartNum(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—"
  return value.toLocaleString("tr-TR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

function toLineData(data: ChartDataPoint[], key: keyof ChartDataPoint) {
  return data
    .map(d => ({ time: d.time, value: d[key] as number | undefined }))
    .filter((d): d is { time: number; value: number } => d.value !== undefined && d.value !== null)
}

export default function TradingViewChart({ data, pendingOrders, symbol = "default" }: TradingViewChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const rsiContainerRef = useRef<HTMLDivElement>(null)
  const macdContainerRef = useRef<HTMLDivElement>(null)

  const mainChartRef = useRef<IChartApi | null>(null)
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null)
  const priceLinesRef = useRef<IPriceLine[]>([])
  const smaSeriesRef = useRef<ISeriesApi<"Line"> | null>(null)
  const emaSeriesRef = useRef<ISeriesApi<"Line"> | null>(null)
  const vwapSeriesRef = useRef<ISeriesApi<"Line"> | null>(null)
  const bbSeriesRef = useRef<ISeriesApi<"Line">[] | null>(null)
  const drawingManagerRef = useRef<DrawingManager | null>(null)
  const symbolRef = useRef(symbol)
  symbolRef.current = symbol

  const [activeTool, setActiveTool] = useState<DrawingTool>("none")
  const activeToolRef = useRef<DrawingTool>("none")
  const [drawingCount, setDrawingCount] = useState(0)

  // Toggles for indicators - all start OFF; the chart should only ever show
  // an indicator the user explicitly turned on, never pre-enabled ones.
  const [showSMA, setShowSMA] = useState(false)
  const [showEMA, setShowEMA] = useState(false)
  const [showVWAP, setShowVWAP] = useState(false)
  const [showBB, setShowBB] = useState(false)

  const [showRSI, setShowRSI] = useState(false)
  const [showMACD, setShowMACD] = useState(false)

  const [scaleMode, setScaleMode] = useState<ScaleMode>("linear")
  const [hoverData, setHoverData] = useState<ChartDataPoint | null>(null)

  // Main chart + candlestick series - only rebuilt when the data itself
  // changes (new symbol/timeframe), not on indicator toggles. Previously
  // this whole chart was torn down and recreated on every single toggle
  // (dependency array included showSMA/showEMA/showVWAP/showBB/showRSI/
  // showMACD), which was wasted work for anything that isn't the main
  // candlestick series.
  useEffect(() => {
    if (!chartContainerRef.current || !data || data.length === 0) return

    const mainChart = createChart(chartContainerRef.current, {
      ...CHART_BASE_OPTIONS,
      rightPriceScale: {
        borderColor: "#3f3f46",
        mode: PriceScaleMode.Normal,
      },
      timeScale: {
        borderColor: "#3f3f46",
        timeVisible: true,
        secondsVisible: false,
      },
      width: chartContainerRef.current.clientWidth,
      height: 380,
    })

    const candleSeries = mainChart.addSeries(CandlestickSeries, {
      upColor: "#10b981",
      downColor: "#f43f5e",
      borderDownColor: "#f43f5e",
      borderUpColor: "#10b981",
      wickDownColor: "#f43f5e",
      wickUpColor: "#10b981",
    })

    candleSeries.setData(
      data.map(d => ({ time: d.time, open: d.open, high: d.high, low: d.low, close: d.close })) as any
    )

    mainChartRef.current = mainChart
    candleSeriesRef.current = candleSeries

    const manager = new DrawingManager(mainChart, candleSeries, (drawings: Drawing[]) => {
      setDrawingCount(drawings.length)
      try {
        localStorage.setItem(drawingsStorageKey(symbolRef.current), JSON.stringify(drawings))
      } catch (e) {}
    })
    try {
      const saved = localStorage.getItem(drawingsStorageKey(symbol))
      if (saved) manager.loadDrawings(JSON.parse(saved))
    } catch (e) {}
    drawingManagerRef.current = manager

    const resizeObserver = new ResizeObserver(entries => {
      if (entries.length === 0) return
      const { width } = entries[0].contentRect
      try {
        mainChart.resize(width, 380)
      } catch (e) {}
    })
    resizeObserver.observe(chartContainerRef.current)

    return () => {
      resizeObserver.disconnect()
      try {
        drawingManagerRef.current?.destroy()
      } catch (e) {}
      drawingManagerRef.current = null
      try {
        mainChart.remove()
      } catch (e) {}
      mainChartRef.current = null
      candleSeriesRef.current = null
      priceLinesRef.current = []
      smaSeriesRef.current = null
      emaSeriesRef.current = null
      vwapSeriesRef.current = null
      bbSeriesRef.current = null
    }
  }, [data, symbol])

  // Pending LIMIT orders drawn as horizontal price lines on the candle
  // series - a buy limit in emerald, a sell limit in rose, matching the
  // AL/SAT color convention used everywhere else in the order panel/history.
  useEffect(() => {
    const series = candleSeriesRef.current
    if (!series) return
    priceLinesRef.current.forEach(line => {
      try { series.removePriceLine(line) } catch (e) {}
    })
    priceLinesRef.current = (pendingOrders || []).map(order =>
      series.createPriceLine({
        price: order.limitPrice,
        color: order.side === "AL" ? "#10b981" : "#f43f5e",
        lineWidth: 2,
        lineStyle: 2,
        axisLabelVisible: true,
        title: `${order.side === "AL" ? "AL" : "SAT"} ${order.label}`,
      })
    )
    return () => {
      priceLinesRef.current.forEach(line => {
        try { series.removePriceLine(line) } catch (e) {}
      })
      priceLinesRef.current = []
    }
  }, [pendingOrders, data])

  // Each overlay indicator adds/removes just its own series against the
  // already-created main chart instead of forcing a full chart rebuild.
  useEffect(() => {
    const chart = mainChartRef.current
    if (!chart) return
    if (showSMA) {
      const s = chart.addSeries(LineSeries, { color: INDICATOR_COLORS.sma, lineWidth: 2, title: "SMA 20" })
      s.setData(toLineData(data, "sma20") as any)
      smaSeriesRef.current = s
    }
    return () => {
      if (smaSeriesRef.current) {
        try { chart.removeSeries(smaSeriesRef.current) } catch (e) {}
        smaSeriesRef.current = null
      }
    }
  }, [showSMA, data])

  useEffect(() => {
    const chart = mainChartRef.current
    if (!chart) return
    if (showEMA) {
      const s = chart.addSeries(LineSeries, { color: INDICATOR_COLORS.ema, lineWidth: 2, title: "EMA 20" })
      s.setData(toLineData(data, "ema20") as any)
      emaSeriesRef.current = s
    }
    return () => {
      if (emaSeriesRef.current) {
        try { chart.removeSeries(emaSeriesRef.current) } catch (e) {}
        emaSeriesRef.current = null
      }
    }
  }, [showEMA, data])

  useEffect(() => {
    const chart = mainChartRef.current
    if (!chart) return
    if (showVWAP) {
      const s = chart.addSeries(LineSeries, { color: INDICATOR_COLORS.vwap, lineWidth: 2, title: "VWAP" })
      s.setData(toLineData(data, "vwap") as any)
      vwapSeriesRef.current = s
    }
    return () => {
      if (vwapSeriesRef.current) {
        try { chart.removeSeries(vwapSeriesRef.current) } catch (e) {}
        vwapSeriesRef.current = null
      }
    }
  }, [showVWAP, data])

  useEffect(() => {
    const chart = mainChartRef.current
    if (!chart) return
    if (showBB) {
      const upper = chart.addSeries(LineSeries, { color: "rgba(236, 72, 153, 0.55)", lineWidth: 1, lineStyle: 2, title: "BB Upper" })
      const lower = chart.addSeries(LineSeries, { color: "rgba(236, 72, 153, 0.55)", lineWidth: 1, lineStyle: 2, title: "BB Lower" })
      const mid = chart.addSeries(LineSeries, { color: INDICATOR_COLORS.bb, lineWidth: 1, title: "BB Mid" })
      upper.setData(toLineData(data, "bb_upper") as any)
      lower.setData(toLineData(data, "bb_lower") as any)
      mid.setData(toLineData(data, "bb_mid") as any)
      bbSeriesRef.current = [upper, lower, mid]
    }
    return () => {
      if (bbSeriesRef.current) {
        bbSeriesRef.current.forEach(s => {
          try { chart.removeSeries(s) } catch (e) {}
        })
        bbSeriesRef.current = null
      }
    }
  }, [showBB, data])

  // Hover tooltip - shows OHLCV plus every currently-active indicator's
  // value at the crosshair's bar (or the latest bar when the mouse isn't
  // over the chart), so a user can read exact numbers instead of eyeballing
  // where a line sits. Declared after the chart-creation effect above so
  // mainChartRef.current is already populated when this one runs.
  useEffect(() => {
    const chart = mainChartRef.current
    if (!chart || !data || data.length === 0) return

    const handler = (param: any) => {
      if (!param || !param.time) {
        setHoverData(data[data.length - 1] ?? null)
        return
      }
      const point = data.find(d => d.time === param.time)
      setHoverData(point ?? data[data.length - 1] ?? null)
    }
    chart.subscribeCrosshairMove(handler)
    setHoverData(data[data.length - 1] ?? null)

    return () => {
      try { chart.unsubscribeCrosshairMove(handler) } catch (e) {}
    }
  }, [data])

  // Scale mode (Linear / Log / %) - real lightweight-charts price scale
  // modes, applied to the already-created chart without rebuilding it.
  useEffect(() => {
    const chart = mainChartRef.current
    if (!chart) return
    const modeMap: Record<ScaleMode, PriceScaleMode> = {
      linear: PriceScaleMode.Normal,
      log: PriceScaleMode.Logarithmic,
      percent: PriceScaleMode.Percentage,
    }
    chart.priceScale("right").applyOptions({ mode: modeMap[scaleMode] })
  }, [scaleMode, data])

  // RSI Sub-Chart - its own small chart, only (re)built while visible.
  useEffect(() => {
    if (!showRSI || !rsiContainerRef.current || !data || data.length === 0) return

    const rsiChart = createChart(rsiContainerRef.current, {
      ...CHART_BASE_OPTIONS,
      rightPriceScale: { borderColor: "#3f3f46" },
      timeScale: { visible: false },
      width: rsiContainerRef.current.clientWidth,
      height: 100,
    })

    const rsiSeries = rsiChart.addSeries(LineSeries, { color: INDICATOR_COLORS.rsi, lineWidth: 2, title: "RSI (14)" })
    rsiSeries.setData(toLineData(data, "rsi") as any)

    const rsi70 = rsiChart.addSeries(LineSeries, { color: "rgba(244, 63, 94, 0.4)", lineWidth: 1, lineStyle: 3 })
    const rsi30 = rsiChart.addSeries(LineSeries, { color: "rgba(16, 185, 129, 0.4)", lineWidth: 1, lineStyle: 3 })
    rsi70.setData(data.map(d => ({ time: d.time, value: 70 })) as any)
    rsi30.setData(data.map(d => ({ time: d.time, value: 30 })) as any)

    const resizeObserver = new ResizeObserver(entries => {
      if (entries.length === 0) return
      const { width } = entries[0].contentRect
      try { rsiChart.resize(width, 100) } catch (e) {}
    })
    resizeObserver.observe(rsiContainerRef.current)

    let unsubscribe: (() => void) | null = null
    if (mainChartRef.current) {
      const mainChart = mainChartRef.current
      const handler = (range: any) => {
        if (!range) return
        try { rsiChart.timeScale().setVisibleLogicalRange(range) } catch (e) {}
      }
      mainChart.timeScale().subscribeVisibleLogicalRangeChange(handler)
      unsubscribe = () => {
        try { mainChart.timeScale().unsubscribeVisibleLogicalRangeChange(handler) } catch (e) {}
      }
    }

    return () => {
      resizeObserver.disconnect()
      unsubscribe?.()
      try { rsiChart.remove() } catch (e) {}
    }
  }, [showRSI, data])

  // MACD Sub-Chart - same pattern as RSI.
  useEffect(() => {
    if (!showMACD || !macdContainerRef.current || !data || data.length === 0) return

    const macdChart = createChart(macdContainerRef.current, {
      ...CHART_BASE_OPTIONS,
      rightPriceScale: { borderColor: "#3f3f46" },
      timeScale: { borderColor: "#3f3f46" },
      width: macdContainerRef.current.clientWidth,
      height: 120,
    })

    const macdLine = macdChart.addSeries(LineSeries, { color: INDICATOR_COLORS.macd, lineWidth: 1, title: "MACD" })
    const signalLine = macdChart.addSeries(LineSeries, { color: INDICATOR_COLORS.macdSignal, lineWidth: 1, title: "Signal" })
    const histSeries = macdChart.addSeries(HistogramSeries, { title: "Hist" })

    macdLine.setData(toLineData(data, "macd") as any)
    signalLine.setData(toLineData(data, "macd_signal") as any)
    histSeries.setData(
      data.map(d => ({
        time: d.time,
        value: d.macd_hist ?? 0,
        color: (d.macd_hist ?? 0) >= 0 ? "rgba(16, 185, 129, 0.4)" : "rgba(244, 63, 94, 0.4)",
      })) as any
    )

    const resizeObserver = new ResizeObserver(entries => {
      if (entries.length === 0) return
      const { width } = entries[0].contentRect
      try { macdChart.resize(width, 120) } catch (e) {}
    })
    resizeObserver.observe(macdContainerRef.current)

    let unsubscribe: (() => void) | null = null
    if (mainChartRef.current) {
      const mainChart = mainChartRef.current
      const handler = (range: any) => {
        if (!range) return
        try { macdChart.timeScale().setVisibleLogicalRange(range) } catch (e) {}
      }
      mainChart.timeScale().subscribeVisibleLogicalRangeChange(handler)
      unsubscribe = () => {
        try { mainChart.timeScale().unsubscribeVisibleLogicalRangeChange(handler) } catch (e) {}
      }
    }

    return () => {
      resizeObserver.disconnect()
      unsubscribe?.()
      try { macdChart.remove() } catch (e) {}
    }
  }, [showMACD, data])

  const handleFitContent = () => {
    try {
      mainChartRef.current?.timeScale().fitContent()
    } catch (e) {}
  }

  const handleDownloadChart = () => {
    try {
      const chart = mainChartRef.current
      if (!chart) return
      const canvas = chart.takeScreenshot()
      const link = document.createElement("a")
      link.href = canvas.toDataURL("image/png")
      link.download = `${symbol}_grafik_${new Date().toISOString().slice(0, 10)}.png`
      link.click()
    } catch (e) {}
  }

  const selectTool = (tool: DrawingTool) => {
    const next = activeToolRef.current === tool ? "none" : tool
    activeToolRef.current = next
    setActiveTool(next)
    drawingManagerRef.current?.setActiveTool(next)
  }

  const handleClearAll = () => {
    drawingManagerRef.current?.clearAll()
  }

  // Delete/Backspace removes whichever drawing was last clicked-to-select
  // (see DrawingManager.hitTest - clicking near an anchor point with no
  // tool active selects it). Scoped to when this chart's container has
  // focus-within isn't tracked here, so it's global while this chart is
  // mounted - acceptable since only one chart is ever shown at a time in
  // this app's layouts.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Delete" || e.key === "Backspace") {
        const target = e.target as HTMLElement | null
        if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return
        drawingManagerRef.current?.deleteSelected()
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [])

  const drawingTools: { tool: DrawingTool; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { tool: "trendline", label: "Trend Çizgisi", icon: TrendingUp },
    { tool: "ray", label: "Işın", icon: ArrowUpRight },
    { tool: "horizontal", label: "Yatay Çizgi", icon: Minus },
    { tool: "rectangle", label: "Dikdörtgen", icon: Square },
    { tool: "fib", label: "Fibonacci Retracement", icon: GitBranch },
    { tool: "text", label: "Metin", icon: Type },
  ]

  const indicatorDot = (color: string) => (
    <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: color }} />
  )

  return (
    <div className="space-y-4">
      {/* Chart Control Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-secondary/25 border border-border/40 rounded-lg text-xs font-semibold">
        <div className="flex items-center space-x-3">
          <button
            onClick={() => setShowSMA(!showSMA)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded transition-all cursor-pointer ${showSMA ? "bg-blue-500/20 text-blue-400 border border-blue-500/30" : "bg-zinc-900/60 text-muted-foreground border border-border/45 hover:text-foreground"}`}
          >
            {indicatorDot(INDICATOR_COLORS.sma)}
            SMA 20
          </button>
          <button
            onClick={() => setShowEMA(!showEMA)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded transition-all cursor-pointer ${showEMA ? "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30" : "bg-zinc-900/60 text-muted-foreground border border-border/45 hover:text-foreground"}`}
          >
            {indicatorDot(INDICATOR_COLORS.ema)}
            EMA 20
          </button>
          <button
            onClick={() => setShowVWAP(!showVWAP)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded transition-all cursor-pointer ${showVWAP ? "bg-purple-500/20 text-purple-400 border border-purple-500/30" : "bg-zinc-900/60 text-muted-foreground border border-border/45 hover:text-foreground"}`}
          >
            {indicatorDot(INDICATOR_COLORS.vwap)}
            VWAP
          </button>
          <button
            onClick={() => setShowBB(!showBB)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded transition-all cursor-pointer ${showBB ? "bg-pink-500/20 text-pink-400 border border-pink-500/30" : "bg-zinc-900/60 text-muted-foreground border border-border/45 hover:text-foreground"}`}
          >
            {indicatorDot(INDICATOR_COLORS.bb)}
            Bollinger Bands
          </button>
        </div>

        <div className="flex items-center space-x-3 border-l border-border/40 pl-3">
          <button
            onClick={() => setShowRSI(!showRSI)}
            className="flex items-center space-x-1.5 text-muted-foreground hover:text-foreground cursor-pointer"
          >
            {showRSI ? <Eye className="h-4 w-4 text-orange-400" /> : <EyeOff className="h-4 w-4" />}
            <span>RSI</span>
          </button>
          <button
            onClick={() => setShowMACD(!showMACD)}
            className="flex items-center space-x-1.5 text-muted-foreground hover:text-foreground cursor-pointer"
          >
            {showMACD ? <Eye className="h-4 w-4 text-blue-400" /> : <EyeOff className="h-4 w-4" />}
            <span>MACD</span>
          </button>
        </div>
      </div>

      {/* Drawing Tools Bar - lightweight-charts has no built-in drawing UI
          (see chartDrawingTools.ts's header for why), so this is a
          from-scratch trend line / ray / horizontal line / rectangle /
          fibonacci / text toolset built directly on its primitive API. */}
      <div className="flex flex-wrap items-center gap-1.5 p-2 bg-secondary/25 border border-border/40 rounded-lg text-xs font-semibold">
        <button
          onClick={() => selectTool("none")}
          title="Seç / Sürükle"
          className={`p-2 rounded transition-all cursor-pointer ${activeTool === "none" ? "bg-primary/20 text-primary border border-primary/30" : "bg-zinc-900/60 text-muted-foreground border border-border/45 hover:text-foreground"}`}
        >
          <MousePointer2 className="h-3.5 w-3.5" />
        </button>
        {drawingTools.map(({ tool, label, icon: Icon }) => (
          <button
            key={tool}
            onClick={() => selectTool(tool)}
            title={label}
            className={`p-2 rounded transition-all cursor-pointer ${activeTool === tool ? "bg-primary/20 text-primary border border-primary/30" : "bg-zinc-900/60 text-muted-foreground border border-border/45 hover:text-foreground"}`}
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        ))}
        <div className="w-px h-5 bg-border/50 mx-1" />
        <button
          onClick={handleClearAll}
          title="Tüm çizimleri temizle"
          disabled={drawingCount === 0}
          className="p-2 rounded bg-zinc-900/60 text-muted-foreground border border-border/45 hover:text-rose-400 hover:border-rose-500/30 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
        {activeTool !== "none" && (
          <span className="text-[11px] text-primary font-bold ml-1">Grafiğe tıklayarak çizin</span>
        )}
      </div>

      {/* Synchronized Multi-Pane Charts */}
      <div className="border border-border/50 rounded-xl overflow-hidden bg-zinc-900/40 p-4 space-y-2">
        {/* Main Price Pane - wrapped in its own relative container so the
            hover tooltip can overlay it without lightweight-charts (which
            takes ownership of chartContainerRef's children) ever seeing it. */}
        <div className="w-full relative">
          <div
            ref={chartContainerRef}
            className="w-full"
            style={{ cursor: activeTool !== "none" ? "crosshair" : undefined }}
          />

          {hoverData && (showSMA || showEMA || showVWAP || showBB) && (
            <div className="pointer-events-none absolute top-2 left-2 z-10 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border/50 bg-zinc-950/85 backdrop-blur-sm px-2.5 py-1.5 text-[10px] font-bold font-mono leading-tight">
              {showSMA && (
                <span className="flex items-center gap-1">{indicatorDot(INDICATOR_COLORS.sma)} SMA {fmtChartNum(hoverData.sma20)}</span>
              )}
              {showEMA && (
                <span className="flex items-center gap-1">{indicatorDot(INDICATOR_COLORS.ema)} EMA {fmtChartNum(hoverData.ema20)}</span>
              )}
              {showVWAP && (
                <span className="flex items-center gap-1">{indicatorDot(INDICATOR_COLORS.vwap)} VWAP {fmtChartNum(hoverData.vwap)}</span>
              )}
              {showBB && (
                <span className="flex items-center gap-1">{indicatorDot(INDICATOR_COLORS.bb)} BB {fmtChartNum(hoverData.bb_lower)}–{fmtChartNum(hoverData.bb_upper)}</span>
              )}
            </div>
          )}
        </div>

        {/* RSI Indicator Pane */}
        {showRSI && (
          <div className="space-y-1">
            <div className="text-[10px] text-orange-400 font-bold uppercase tracking-wider pl-1">Göreceli Güç Endeksi (RSI 14)</div>
            <div ref={rsiContainerRef} className="w-full" />
          </div>
        )}

        {/* MACD Indicator Pane */}
        {showMACD && (
          <div className="space-y-1">
            <div className="text-[10px] text-blue-400 font-bold uppercase tracking-wider pl-1">MACD Kesişimi (12, 26, 9)</div>
            <div ref={macdContainerRef} className="w-full" />
          </div>
        )}

        {/* Scale mode + fit-to-view - mirrors the real TradingView terminal's
            bottom bar (%, Log, "Grafiği ortala"), without the drawing
            toolbar/volume that go beyond what was asked for right now. */}
        <div className="flex items-center justify-end gap-2 pt-1">
          <div className="flex items-center bg-zinc-950/60 border border-border/40 rounded-lg p-0.5 text-[10px] font-bold">
            <button
              onClick={() => setScaleMode("linear")}
              className={`px-2 py-1 rounded transition-colors cursor-pointer ${scaleMode === "linear" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              Linear
            </button>
            <button
              onClick={() => setScaleMode("percent")}
              className={`px-2 py-1 rounded transition-colors cursor-pointer ${scaleMode === "percent" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              %
            </button>
            <button
              onClick={() => setScaleMode("log")}
              className={`px-2 py-1 rounded transition-colors cursor-pointer ${scaleMode === "log" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              Log
            </button>
          </div>
          <button
            onClick={handleFitContent}
            title="Grafiği ortala"
            className="flex items-center space-x-1 px-2 py-1.5 rounded-lg bg-zinc-950/60 border border-border/40 text-[10px] font-bold text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          >
            <Scan className="h-3.5 w-3.5" />
            <span>Ortala</span>
          </button>
          <button
            onClick={handleDownloadChart}
            title="Grafiği PNG olarak indir"
            className="flex items-center space-x-1 px-2 py-1.5 rounded-lg bg-zinc-950/60 border border-border/40 text-[10px] font-bold text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          >
            <Download className="h-3.5 w-3.5" />
            <span>İndir</span>
          </button>
        </div>
      </div>
    </div>
  )
}
