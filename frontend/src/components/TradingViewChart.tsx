"use client"

import React, { useEffect, useRef, useState } from "react"
import { 
  createChart, 
  ColorType, 
  IChartApi, 
  ISeriesApi,
  CandlestickSeries,
  LineSeries,
  HistogramSeries
} from "lightweight-charts"
import { Eye, EyeOff } from "lucide-react"

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

export default function TradingViewChart({ data }: TradingViewChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const rsiContainerRef = useRef<HTMLDivElement>(null)
  const macdContainerRef = useRef<HTMLDivElement>(null)
  
  // Toggles for indicators
  const [showSMA, setShowSMA] = useState(true)
  const [showEMA, setShowEMA] = useState(false)
  const [showVWAP, setShowVWAP] = useState(true)
  const [showBB, setShowBB] = useState(false)
  
  const [showRSI, setShowRSI] = useState(false)
  const [showMACD, setShowMACD] = useState(false)

  useEffect(() => {
    if (!chartContainerRef.current || !data || data.length === 0) return

    // 1. Create Main Price Chart
    const mainChart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "#18181b" },
        textColor: "#a1a1aa",
      },
      grid: {
        vertLines: { color: "#27272a" },
        horzLines: { color: "#27272a" },
      },
      rightPriceScale: {
        borderColor: "#3f3f46",
      },
      timeScale: {
        borderColor: "#3f3f46",
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        mode: 0, // CrosshairMode.Normal
      },
      width: chartContainerRef.current.clientWidth,
      height: 380,
    })

    // Candlesticks Series using definition
    const candleSeries = mainChart.addSeries(CandlestickSeries, {
      upColor: "#10b981",
      downColor: "#f43f5e",
      borderDownColor: "#f43f5e",
      borderUpColor: "#10b981",
      wickDownColor: "#f43f5e",
      wickUpColor: "#10b981",
    })
    
    // Volume Series hidden as requested
    /*
    const volumeSeries = mainChart.addSeries(HistogramSeries, {
      color: "#4f46e5",
      priceFormat: {
        type: "volume",
      },
      priceScaleId: "", // Overlay on the main chart
    })
    */
    
    const formattedCandles = data.map(d => ({
      time: d.time,
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
    }))

    /*
    const formattedVolume = data.map(d => ({
      time: d.time,
      value: d.volume,
      color: d.close >= d.open ? "rgba(16, 185, 129, 0.25)" : "rgba(244, 63, 94, 0.25)",
    }))
    */

    candleSeries.setData(formattedCandles as any)
    // volumeSeries.setData(formattedVolume as any)

    // Indicators on Main Chart
    let smaSeries: any = null
    let emaSeries: any = null
    let vwapSeries: any = null
    let bbUpperSeries: any = null
    let bbLowerSeries: any = null
    let bbMidSeries: any = null

    if (showSMA) {
      smaSeries = mainChart.addSeries(LineSeries, { color: "#3b82f6", lineWidth: 2, title: "SMA 20" })
      const smaData = data
        .map(d => ({ time: d.time, value: d.sma20 }))
        .filter((d): d is { time: number; value: number } => d.value !== undefined && d.value !== null)
      smaSeries.setData(smaData as any)
    }

    if (showEMA) {
      emaSeries = mainChart.addSeries(LineSeries, { color: "#eab308", lineWidth: 2, title: "EMA 20" })
      const emaData = data
        .map(d => ({ time: d.time, value: d.ema20 }))
        .filter((d): d is { time: number; value: number } => d.value !== undefined && d.value !== null)
      emaSeries.setData(emaData as any)
    }

    if (showVWAP) {
      vwapSeries = mainChart.addSeries(LineSeries, { color: "#a855f7", lineWidth: 2, title: "VWAP" })
      const vwapData = data
        .map(d => ({ time: d.time, value: d.vwap }))
        .filter((d): d is { time: number; value: number } => d.value !== undefined && d.value !== null)
      vwapSeries.setData(vwapData as any)
    }

    if (showBB) {
      bbUpperSeries = mainChart.addSeries(LineSeries, { color: "#ec4899", lineWidth: 1, lineStyle: 2, title: "BB Upper" })
      bbLowerSeries = mainChart.addSeries(LineSeries, { color: "#ec4899", lineWidth: 1, lineStyle: 2, title: "BB Lower" })
      bbMidSeries = mainChart.addSeries(LineSeries, { color: "#ec4899", lineWidth: 1, title: "BB Mid" })

      bbUpperSeries.setData(data.map(d => ({ time: d.time, value: d.bb_upper })).filter((d: any) => d.value) as any)
      bbLowerSeries.setData(data.map(d => ({ time: d.time, value: d.bb_lower })).filter((d: any) => d.value) as any)
      bbMidSeries.setData(data.map(d => ({ time: d.time, value: d.bb_mid })).filter((d: any) => d.value) as any)
    }

    // 2. RSI Sub-Chart
    let rsiChart: IChartApi | null = null
    if (showRSI && rsiContainerRef.current) {
      rsiChart = createChart(rsiContainerRef.current, {
        layout: {
          background: { type: ColorType.Solid, color: "#18181b" },
          textColor: "#a1a1aa",
        },
        grid: {
          vertLines: { color: "#27272a" },
          horzLines: { color: "#27272a" },
        },
        rightPriceScale: {
          borderColor: "#3f3f46",
        },
        timeScale: {
          visible: false, // Hide time scale for secondary chart
        },
        width: rsiContainerRef.current.clientWidth,
        height: 100,
      })

      const rsiSeries = rsiChart.addSeries(LineSeries, { color: "#f97316", lineWidth: 2, title: "RSI (14)" })
      const rsiData = data
        .map(d => ({ time: d.time, value: d.rsi }))
        .filter((d): d is { time: number; value: number } => d.value !== undefined && d.value !== null)
      rsiSeries.setData(rsiData as any)
      
      // Upper & Lower bounds guide lines (70 / 30)
      const rsi70 = rsiChart.addSeries(LineSeries, { color: "rgba(244, 63, 94, 0.4)", lineWidth: 1, lineStyle: 3 })
      const rsi30 = rsiChart.addSeries(LineSeries, { color: "rgba(16, 185, 129, 0.4)", lineWidth: 1, lineStyle: 3 })
      rsi70.setData(data.map(d => ({ time: d.time, value: 70 })) as any)
      rsi30.setData(data.map(d => ({ time: d.time, value: 30 })) as any)
    }

    // 3. MACD Sub-Chart
    let macdChart: IChartApi | null = null
    if (showMACD && macdContainerRef.current) {
      macdChart = createChart(macdContainerRef.current, {
        layout: {
          background: { type: ColorType.Solid, color: "#18181b" },
          textColor: "#a1a1aa",
        },
        grid: {
          vertLines: { color: "#27272a" },
          horzLines: { color: "#27272a" },
        },
        rightPriceScale: {
          borderColor: "#3f3f46",
        },
        timeScale: {
          borderColor: "#3f3f46",
        },
        width: macdContainerRef.current.clientWidth,
        height: 120,
      })

      const macdLine = macdChart.addSeries(LineSeries, { color: "#60a5fa", lineWidth: 1, title: "MACD" })
      const signalLine = macdChart.addSeries(LineSeries, { color: "#fb7185", lineWidth: 1, title: "Signal" })
      const histSeries = macdChart.addSeries(HistogramSeries, { title: "Hist" })

      macdLine.setData(data.map(d => ({ time: d.time, value: d.macd })).filter((d: any) => d.value) as any)
      signalLine.setData(data.map(d => ({ time: d.time, value: d.macd_signal })).filter((d: any) => d.value) as any)
      
      const histData = data
        .map(d => ({
          time: d.time,
          value: d.macd_hist ?? 0,
          color: (d.macd_hist ?? 0) >= 0 ? "rgba(16, 185, 129, 0.4)" : "rgba(244, 63, 94, 0.4)",
        }))
      histSeries.setData(histData as any)
    }

    // Synchronize zoom & pan crosshairs between main, RSI and MACD charts
    const charts = [mainChart, rsiChart, macdChart].filter((c): c is IChartApi => c !== null)
    const handlers: { chart: IChartApi; handler: any }[] = []

    charts.forEach((chart, index) => {
      const handler = (range: any) => {
        if (!range) return
        charts.forEach((otherChart, otherIndex) => {
          if (index !== otherIndex && otherChart) {
            try {
              otherChart.timeScale().setVisibleLogicalRange(range)
            } catch (e) {}
          }
        })
      }
      try {
        chart.timeScale().subscribeVisibleLogicalRangeChange(handler)
        handlers.push({ chart, handler })
      } catch (e) {}
    })

    // Resize handlers
    const resizeObserver = new ResizeObserver(entries => {
      if (entries.length === 0) return
      const { width } = entries[0].contentRect
      try {
        mainChart.resize(width, 380)
        if (rsiChart) rsiChart.resize(width, 100)
        if (macdChart) macdChart.resize(width, 120)
      } catch (e) {}
    })

    if (chartContainerRef.current) {
      resizeObserver.observe(chartContainerRef.current)
    }

    // Cleanup
    return () => {
      try {
        resizeObserver.disconnect()
      } catch (e) {}
      
      handlers.forEach(({ chart, handler }) => {
        try {
          chart.timeScale().unsubscribeVisibleLogicalRangeChange(handler)
        } catch (e) {}
      })

      try {
        mainChart.remove()
      } catch (e) {}
      
      if (rsiChart) {
        try {
          rsiChart.remove()
        } catch (e) {}
      }
      if (macdChart) {
        try {
          macdChart.remove()
        } catch (e) {}
      }
    }
  }, [data, showSMA, showEMA, showVWAP, showBB, showRSI, showMACD])

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
      </div>
    </div>
  )
}
