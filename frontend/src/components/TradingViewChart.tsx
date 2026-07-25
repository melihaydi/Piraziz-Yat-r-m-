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
} from "lightweight-charts"
import { Eye, EyeOff, Scan } from "lucide-react"

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

interface TradingViewChartProps {
  data: ChartDataPoint[]
}

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
  },
}

function toLineData(data: ChartDataPoint[], key: keyof ChartDataPoint) {
  return data
    .map(d => ({ time: d.time, value: d[key] as number | undefined }))
    .filter((d): d is { time: number; value: number } => d.value !== undefined && d.value !== null)
}

export default function TradingViewChart({ data }: TradingViewChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const rsiContainerRef = useRef<HTMLDivElement>(null)
  const macdContainerRef = useRef<HTMLDivElement>(null)

  const mainChartRef = useRef<IChartApi | null>(null)
  const smaSeriesRef = useRef<ISeriesApi<"Line"> | null>(null)
  const emaSeriesRef = useRef<ISeriesApi<"Line"> | null>(null)
  const vwapSeriesRef = useRef<ISeriesApi<"Line"> | null>(null)
  const bbSeriesRef = useRef<ISeriesApi<"Line">[] | null>(null)

  // Toggles for indicators
  const [showSMA, setShowSMA] = useState(true)
  const [showEMA, setShowEMA] = useState(false)
  const [showVWAP, setShowVWAP] = useState(true)
  const [showBB, setShowBB] = useState(false)

  const [showRSI, setShowRSI] = useState(false)
  const [showMACD, setShowMACD] = useState(false)

  const [scaleMode, setScaleMode] = useState<ScaleMode>("linear")

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
        mainChart.remove()
      } catch (e) {}
      mainChartRef.current = null
      smaSeriesRef.current = null
      emaSeriesRef.current = null
      vwapSeriesRef.current = null
      bbSeriesRef.current = null
    }
  }, [data])

  // Each overlay indicator adds/removes just its own series against the
  // already-created main chart instead of forcing a full chart rebuild.
  useEffect(() => {
    const chart = mainChartRef.current
    if (!chart) return
    if (showSMA) {
      const s = chart.addSeries(LineSeries, { color: "#3b82f6", lineWidth: 2, title: "SMA 20" })
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
      const s = chart.addSeries(LineSeries, { color: "#eab308", lineWidth: 2, title: "EMA 20" })
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
      const s = chart.addSeries(LineSeries, { color: "#a855f7", lineWidth: 2, title: "VWAP" })
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
      const upper = chart.addSeries(LineSeries, { color: "#ec4899", lineWidth: 1, lineStyle: 2, title: "BB Upper" })
      const lower = chart.addSeries(LineSeries, { color: "#ec4899", lineWidth: 1, lineStyle: 2, title: "BB Lower" })
      const mid = chart.addSeries(LineSeries, { color: "#ec4899", lineWidth: 1, title: "BB Mid" })
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

    const rsiSeries = rsiChart.addSeries(LineSeries, { color: "#f97316", lineWidth: 2, title: "RSI (14)" })
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

    const macdLine = macdChart.addSeries(LineSeries, { color: "#60a5fa", lineWidth: 1, title: "MACD" })
    const signalLine = macdChart.addSeries(LineSeries, { color: "#fb7185", lineWidth: 1, title: "Signal" })
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

  return (
    <div className="space-y-4">
      {/* Chart Control Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-secondary/25 border border-border/40 rounded-lg text-xs font-semibold">
        <div className="flex items-center space-x-3">
          <button
            onClick={() => setShowSMA(!showSMA)}
            className={`px-2.5 py-1.5 rounded transition-all cursor-pointer ${showSMA ? "bg-blue-500/20 text-blue-400 border border-blue-500/30" : "bg-zinc-900/60 text-muted-foreground border border-border/45"}`}
          >
            SMA 20
          </button>
          <button
            onClick={() => setShowEMA(!showEMA)}
            className={`px-2.5 py-1.5 rounded transition-all cursor-pointer ${showEMA ? "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30" : "bg-zinc-900/60 text-muted-foreground border border-border/45"}`}
          >
            EMA 20
          </button>
          <button
            onClick={() => setShowVWAP(!showVWAP)}
            className={`px-2.5 py-1.5 rounded transition-all cursor-pointer ${showVWAP ? "bg-purple-500/20 text-purple-400 border border-purple-500/30" : "bg-zinc-900/60 text-muted-foreground border border-border/45"}`}
          >
            VWAP
          </button>
          <button
            onClick={() => setShowBB(!showBB)}
            className={`px-2.5 py-1.5 rounded transition-all cursor-pointer ${showBB ? "bg-pink-500/20 text-pink-400 border border-pink-500/30" : "bg-zinc-900/60 text-muted-foreground border border-border/45"}`}
          >
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

      {/* Synchronized Multi-Pane Charts */}
      <div className="border border-border/50 rounded-xl overflow-hidden bg-zinc-900/40 p-4 space-y-2">
        {/* Main Price Pane */}
        <div ref={chartContainerRef} className="w-full relative" />

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
        </div>
      </div>
    </div>
  )
}
