"use client"

import type { CanvasRenderingTarget2D } from "fancy-canvas"
import type {
  IChartApi,
  ISeriesApi,
  ISeriesPrimitive,
  IPrimitivePaneView,
  IPrimitivePaneRenderer,
  SeriesType,
  Time,
  MouseEventParams,
} from "lightweight-charts"

// Drawing tools for the BIST chart (lightweight-charts has no built-in
// drawing UI - see TradingViewChart.tsx's header comment for why BIST
// symbols can't use TradingView's own full-featured chart widget instead).
// This is a from-scratch implementation on top of lightweight-charts v5's
// primitive/plugin API: each drawing is a plain object of {time, price}
// points (never raw pixels), converted to screen coordinates fresh on every
// draw call via the series/time-scale - that's what makes a drawing
// correctly reposition itself across pan, zoom, resize, and timeframe
// changes for free, instead of drifting like a pixel-cached overlay would.

export type DrawingTool = "none" | "trendline" | "ray" | "horizontal" | "rectangle" | "fib" | "text"

export interface Drawing {
  id: string
  tool: Exclude<DrawingTool, "none">
  points: { time: Time; price: number }[]
  text?: string
  color: string
}

const TOOL_COLOR = "#e8b923"
const TOOL_COLOR_FILL = "rgba(232, 185, 35, 0.08)"

function toXY(chart: IChartApi, series: ISeriesApi<SeriesType>, p: { time: Time; price: number }) {
  const x = chart.timeScale().timeToCoordinate(p.time)
  const y = series.priceToCoordinate(p.price)
  return { x, y }
}

class DrawingRenderer implements IPrimitivePaneRenderer {
  constructor(
    private chart: IChartApi,
    private series: ISeriesApi<SeriesType>,
    private drawing: Drawing,
    private selected: boolean
  ) {}

  draw(target: CanvasRenderingTarget2D): void {
    const { chart, series, drawing, selected } = this
    const pts = drawing.points.map(p => toXY(chart, series, p))
    if (pts.some(p => p.x === null || p.y === null)) return
    const xy = pts as { x: number; y: number }[]

    target.useBitmapCoordinateSpace(scope => {
      const ctx = scope.context
      const hr = scope.horizontalPixelRatio
      const vr = scope.verticalPixelRatio
      ctx.save()
      ctx.strokeStyle = drawing.color
      ctx.lineWidth = (selected ? 2.5 : 1.5) * hr
      ctx.fillStyle = TOOL_COLOR_FILL

      const line = (x1: number, y1: number, x2: number, y2: number) => {
        ctx.beginPath()
        ctx.moveTo(x1 * hr, y1 * vr)
        ctx.lineTo(x2 * hr, y2 * vr)
        ctx.stroke()
      }

      if (drawing.tool === "trendline" && xy.length >= 2) {
        line(xy[0].x, xy[0].y, xy[1].x, xy[1].y)
      } else if (drawing.tool === "ray" && xy.length >= 2) {
        // Extend the second point out to the right edge of the visible pane.
        const paneWidth = scope.bitmapSize.width / hr
        const dx = xy[1].x - xy[0].x
        const dy = xy[1].y - xy[0].y
        if (Math.abs(dx) > 0.001) {
          const t = (paneWidth - xy[0].x) / dx
          line(xy[0].x, xy[0].y, paneWidth, xy[0].y + dy * t)
        } else {
          line(xy[0].x, xy[0].y, xy[1].x, xy[1].y)
        }
      } else if (drawing.tool === "horizontal" && xy.length >= 1) {
        const paneWidth = scope.bitmapSize.width / hr
        line(0, xy[0].y, paneWidth, xy[0].y)
      } else if (drawing.tool === "rectangle" && xy.length >= 2) {
        const x = Math.min(xy[0].x, xy[1].x) * hr
        const y = Math.min(xy[0].y, xy[1].y) * vr
        const w = Math.abs(xy[1].x - xy[0].x) * hr
        const h = Math.abs(xy[1].y - xy[0].y) * vr
        ctx.fillRect(x, y, w, h)
        ctx.strokeRect(x, y, w, h)
      } else if (drawing.tool === "fib" && xy.length >= 2) {
        const levels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]
        const paneWidth = scope.bitmapSize.width / hr
        const x0 = Math.min(xy[0].x, xy[1].x)
        const y0 = xy[0].y
        const y1 = xy[1].y
        ctx.font = `${11 * vr}px sans-serif`
        levels.forEach(level => {
          const y = y0 + (y1 - y0) * level
          ctx.globalAlpha = 0.7
          line(x0, y, paneWidth, y)
          ctx.globalAlpha = 1
          ctx.fillStyle = drawing.color
          ctx.fillText(`${(level * 100).toFixed(1)}%`, (x0 + 4) * hr, (y - 4) * vr)
          ctx.fillStyle = TOOL_COLOR_FILL
        })
      } else if (drawing.tool === "text" && xy.length >= 1 && drawing.text) {
        ctx.font = `${13 * vr}px sans-serif`
        ctx.fillStyle = drawing.color
        ctx.fillText(drawing.text, xy[0].x * hr, xy[0].y * vr)
      }

      // Selection handles - small filled circles at each anchor point.
      if (selected) {
        ctx.fillStyle = drawing.color
        xy.forEach(p => {
          ctx.beginPath()
          ctx.arc(p.x * hr, p.y * vr, 4 * hr, 0, Math.PI * 2)
          ctx.fill()
        })
      }
      ctx.restore()
    })
  }
}

class DrawingPaneView implements IPrimitivePaneView {
  constructor(private _renderer: DrawingRenderer) {}
  renderer() {
    return this._renderer
  }
}

/** One primitive per drawing - attached/detached from the series as the
 * drawings array changes, rather than one giant primitive that redraws
 * everything (keeps add/remove/select simple: each drawing owns its own
 * lifecycle). */
class DrawingPrimitive implements ISeriesPrimitive<Time> {
  private _paneViews: DrawingPaneView[]

  constructor(chart: IChartApi, series: ISeriesApi<SeriesType>, drawing: Drawing, selected: boolean) {
    this._paneViews = [new DrawingPaneView(new DrawingRenderer(chart, series, drawing, selected))]
  }

  updateAllViews() {}

  paneViews() {
    return this._paneViews
  }
}

/** Manages the full drawing lifecycle for one chart: click-to-place points
 * for the active tool, keeps each Drawing's primitive attached to the
 * series, and exposes select/delete for the toolbar. All drawing state
 * lives here in {time, price} terms - the chart's own pan/zoom/timeframe
 * changes never need to touch it, only the renderer's coordinate lookup
 * does, on every paint. */
export class DrawingManager {
  private chart: IChartApi
  private series: ISeriesApi<SeriesType>
  private drawings: Drawing[] = []
  private primitives = new Map<string, DrawingPrimitive>()
  private pendingPoints: { time: Time; price: number }[] = []
  private activeTool: DrawingTool = "none"
  private selectedId: string | null = null
  private onChange: (drawings: Drawing[]) => void
  private clickHandler: (p: MouseEventParams) => void

  constructor(chart: IChartApi, series: ISeriesApi<SeriesType>, onChange: (drawings: Drawing[]) => void = () => {}) {
    this.chart = chart
    this.series = series
    this.onChange = onChange
    this.clickHandler = (param: MouseEventParams) => this.handleClick(param)
    this.chart.subscribeClick(this.clickHandler)
  }

  private pointsNeeded(tool: DrawingTool): number {
    switch (tool) {
      case "horizontal":
      case "text":
        return 1
      default:
        return 2
    }
  }

  setActiveTool(tool: DrawingTool) {
    this.activeTool = tool
    this.pendingPoints = []
    this.selectedId = null
  }

  private handleClick(param: MouseEventParams) {
    if (!param.point || param.time === undefined) return
    const price = this.series.coordinateToPrice(param.point.y)
    if (price === null) return
    const point = { time: param.time, price }

    if (this.activeTool === "none") {
      // Select the nearest drawing within a small pixel radius, for delete.
      this.selectedId = this.hitTest(param.point.x, param.point.y)
      this.redrawAll()
      return
    }

    if (this.activeTool === "text") {
      const text = window.prompt("Not metni:")
      if (text) this.addDrawing("text", [point], text)
      this.activeTool = "none"
      return
    }

    this.pendingPoints.push(point)
    const needed = this.pointsNeeded(this.activeTool)
    if (this.pendingPoints.length >= needed) {
      this.addDrawing(this.activeTool as Exclude<DrawingTool, "none">, this.pendingPoints)
      this.pendingPoints = []
      this.activeTool = "none"
    }
  }

  private hitTest(x: number, y: number): string | null {
    const threshold = 8
    for (const d of this.drawings) {
      for (const p of d.points) {
        const xy = toXY(this.chart, this.series, p)
        if (xy.x === null || xy.y === null) continue
        const dist = Math.hypot(xy.x - x, xy.y - y)
        if (dist <= threshold) return d.id
      }
    }
    return null
  }

  private addDrawing(tool: Exclude<DrawingTool, "none">, points: { time: Time; price: number }[], text?: string) {
    const drawing: Drawing = { id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, tool, points, text, color: TOOL_COLOR }
    this.drawings.push(drawing)
    this.attach(drawing)
    this.onChange(this.drawings)
  }

  deleteSelected() {
    if (!this.selectedId) return
    this.deleteById(this.selectedId)
    this.selectedId = null
  }

  deleteById(id: string) {
    const primitive = this.primitives.get(id)
    if (primitive) {
      this.series.detachPrimitive(primitive)
      this.primitives.delete(id)
    }
    this.drawings = this.drawings.filter(d => d.id !== id)
    this.onChange(this.drawings)
  }

  clearAll() {
    for (const id of Array.from(this.primitives.keys())) this.deleteById(id)
  }

  /** Restores drawings (e.g. loaded from localStorage for this symbol)
   * without going through the click-placement flow. */
  loadDrawings(drawings: Drawing[]) {
    this.clearAll()
    this.drawings = drawings
    for (const d of drawings) this.attach(d)
    this.onChange(this.drawings)
  }

  getDrawings(): Drawing[] {
    return this.drawings
  }

  private attach(drawing: Drawing) {
    const primitive = new DrawingPrimitive(this.chart, this.series, drawing, drawing.id === this.selectedId)
    this.primitives.set(drawing.id, primitive)
    this.series.attachPrimitive(primitive)
  }

  private redrawAll() {
    // Re-attaching swaps in a fresh primitive carrying the current
    // selected-state flag, since a primitive's constructor args are
    // immutable once attached.
    for (const d of this.drawings) {
      const old = this.primitives.get(d.id)
      if (old) this.series.detachPrimitive(old)
      this.attach(d)
    }
  }

  destroy() {
    this.chart.unsubscribeClick(this.clickHandler)
    this.clearAll()
  }
}
