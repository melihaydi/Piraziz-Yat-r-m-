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
//
// v2 rewrite notes (first version felt "laggy"/unresponsive): the actual
// problem wasn't rendering speed, it was that clicking the first point of a
// 2-point tool gave zero visual feedback until the second click - no line
// followed the cursor, so it read as broken. This version tracks the live
// crosshair position and mutates a single always-attached "preview"
// primitive's point in place while a drawing is in progress, instead of
// creating/attaching a new primitive - lightweight-charts already repaints
// every primitive on each crosshair move (it has to, to redraw the
// crosshair itself), so mutating shared state and letting that natural
// repaint pick it up is both simpler and cheaper than manually forcing a
// redraw. Selection state is read the same way (a shared ref checked at
// draw time) instead of detaching/reattaching every primitive just to
// toggle a highlight.

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
const PREVIEW_COLOR = "#e8b92399"

function toXY(chart: IChartApi, series: ISeriesApi<SeriesType>, p: { time: Time; price: number }) {
  const x = chart.timeScale().timeToCoordinate(p.time)
  const y = series.priceToCoordinate(p.price)
  return { x, y }
}

class DrawingRenderer implements IPrimitivePaneRenderer {
  constructor(
    private chart: IChartApi,
    private series: ISeriesApi<SeriesType>,
    private getDrawing: () => Drawing | null,
    private isSelected: () => boolean,
    private dashed: boolean = false
  ) {}

  draw(target: CanvasRenderingTarget2D): void {
    const drawing = this.getDrawing()
    if (!drawing) return
    const { chart, series } = this
    const pts = drawing.points.map(p => toXY(chart, series, p))
    if (pts.some(p => p.x === null || p.y === null)) return
    const xy = pts as { x: number; y: number }[]
    const selected = this.isSelected()

    target.useBitmapCoordinateSpace(scope => {
      const ctx = scope.context
      const hr = scope.horizontalPixelRatio
      const vr = scope.verticalPixelRatio
      ctx.save()
      ctx.strokeStyle = drawing.color
      ctx.lineWidth = (selected ? 2.5 : 1.5) * hr
      ctx.fillStyle = TOOL_COLOR_FILL
      if (this.dashed) ctx.setLineDash([5 * hr, 4 * hr])

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

/** One primitive per drawing, attached once and left attached - selection
 * and (for the preview primitive) point updates are read live from a
 * closure each draw() call rather than by detaching/reattaching, which is
 * both cheaper and avoids the visual gap that caused the "laggy" feel. */
class DrawingPrimitive implements ISeriesPrimitive<Time> {
  private _paneViews: DrawingPaneView[]

  constructor(
    chart: IChartApi,
    series: ISeriesApi<SeriesType>,
    getDrawing: () => Drawing | null,
    isSelected: () => boolean,
    dashed = false
  ) {
    this._paneViews = [new DrawingPaneView(new DrawingRenderer(chart, series, getDrawing, isSelected, dashed))]
  }

  updateAllViews() {}

  paneViews() {
    return this._paneViews
  }
}

function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1
  const dy = y2 - y1
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return Math.hypot(px - x1, py - y1)
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))
  const projX = x1 + t * dx
  const projY = y1 + t * dy
  return Math.hypot(px - projX, py - projY)
}

/** Manages the full drawing lifecycle for one chart: click-to-place points
 * with a live rubber-band preview for the active tool, keeps each Drawing's
 * primitive attached to the series, and exposes select/delete for the
 * toolbar. All drawing state lives here in {time, price} terms - the
 * chart's own pan/zoom/timeframe changes never need to touch it, only the
 * renderer's coordinate lookup does, on every paint. */
export class DrawingManager {
  private chart: IChartApi
  private series: ISeriesApi<SeriesType>
  private drawings: Drawing[] = []
  private primitives = new Map<string, DrawingPrimitive>()
  private activeTool: DrawingTool = "none"
  private selectedId: string | null = null
  private onChange: (drawings: Drawing[]) => void
  private clickHandler: (p: MouseEventParams) => void
  private moveHandler: (p: MouseEventParams) => void
  private keyHandler: (e: KeyboardEvent) => void

  // In-progress drawing state: firstPoint is set on the tool's first click;
  // previewDrawing is a single mutable object whose second point tracks the
  // live cursor position until the drawing is finalized.
  private firstPoint: { time: Time; price: number } | null = null
  private previewDrawing: Drawing | null = null
  private previewPrimitive: DrawingPrimitive | null = null

  constructor(chart: IChartApi, series: ISeriesApi<SeriesType>, onChange: (drawings: Drawing[]) => void = () => {}) {
    this.chart = chart
    this.series = series
    this.onChange = onChange
    this.clickHandler = (param: MouseEventParams) => this.handleClick(param)
    this.moveHandler = (param: MouseEventParams) => this.handleMove(param)
    this.chart.subscribeClick(this.clickHandler)
    this.chart.subscribeCrosshairMove(this.moveHandler)
    this.keyHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") this.cancelPending()
    }
    window.addEventListener("keydown", this.keyHandler)
  }

  private needsTwoPoints(tool: DrawingTool): boolean {
    return tool !== "horizontal" && tool !== "text" && tool !== "none"
  }

  setActiveTool(tool: DrawingTool) {
    this.cancelPending()
    this.activeTool = tool
    this.selectedId = null
  }

  private cancelPending() {
    if (this.previewPrimitive) {
      try { this.series.detachPrimitive(this.previewPrimitive) } catch (e) {}
      this.previewPrimitive = null
    }
    this.firstPoint = null
    this.previewDrawing = null
  }

  private handleMove(param: MouseEventParams) {
    if (!this.firstPoint || !this.previewDrawing) return
    if (!param.point || param.time === undefined) return
    const price = this.series.coordinateToPrice(param.point.y)
    if (price === null) return
    // Mutate in place - the already-attached preview primitive reads this
    // same object on its next natural repaint (which this crosshair move
    // itself triggers), so no re-attach/redraw call is needed here.
    this.previewDrawing.points[1] = { time: param.time, price }
  }

  private handleClick(param: MouseEventParams) {
    if (!param.point || param.time === undefined) return
    const price = this.series.coordinateToPrice(param.point.y)
    if (price === null) return
    const point = { time: param.time, price }

    if (this.activeTool === "none") {
      const hit = this.hitTest(param.point.x, param.point.y)
      if (hit !== this.selectedId) {
        this.selectedId = hit
        // Selection is read live via isSelected() closures on each
        // primitive - no need to touch the series at all here, the next
        // natural repaint (this click's own crosshair update) reflects it.
      }
      return
    }

    if (this.activeTool === "text") {
      const text = window.prompt("Not metni:")
      if (text) this.addDrawing("text", [point], text)
      this.activeTool = "none"
      return
    }

    if (!this.needsTwoPoints(this.activeTool)) {
      this.addDrawing(this.activeTool as Exclude<DrawingTool, "none">, [point])
      this.activeTool = "none"
      return
    }

    if (!this.firstPoint) {
      // First click: start the live preview, anchored at this point with
      // the second point initially the same (a zero-length line) until the
      // cursor moves.
      this.firstPoint = point
      const tool = this.activeTool as Exclude<DrawingTool, "none">
      this.previewDrawing = { id: "__preview__", tool, points: [point, { ...point }], color: PREVIEW_COLOR }
      this.previewPrimitive = new DrawingPrimitive(
        this.chart, this.series,
        () => this.previewDrawing,
        () => false,
        true
      )
      this.series.attachPrimitive(this.previewPrimitive)
    } else {
      // Second click: finalize using the preview's current (live-updated)
      // second point rather than this click's point directly, so a fast
      // double-click that didn't generate an intermediate move event still
      // uses a sensible second point.
      const finalPoints = [this.firstPoint, this.previewDrawing?.points[1] ?? point]
      const tool = this.activeTool as Exclude<DrawingTool, "none">
      this.cancelPending()
      this.addDrawing(tool, finalPoints)
      this.activeTool = "none"
    }
  }

  private hitTest(x: number, y: number): string | null {
    const threshold = 6
    for (const d of this.drawings) {
      const xy = d.points.map(p => toXY(this.chart, this.series, p))
      if (xy.some(p => p.x === null || p.y === null)) continue
      const pts = xy as { x: number; y: number }[]

      if (d.tool === "horizontal") {
        if (Math.abs(pts[0].y - y) <= threshold) return d.id
      } else if (d.tool === "trendline" || d.tool === "ray") {
        const p2 = d.tool === "ray" ? { x: this.chart.timeScale().width(), y: pts[0].y + (pts[1].y - pts[0].y) } : pts[1]
        if (distToSegment(x, y, pts[0].x, pts[0].y, p2.x, p2.y) <= threshold) return d.id
      } else if (d.tool === "rectangle") {
        const minX = Math.min(pts[0].x, pts[1].x), maxX = Math.max(pts[0].x, pts[1].x)
        const minY = Math.min(pts[0].y, pts[1].y), maxY = Math.max(pts[0].y, pts[1].y)
        if (x >= minX - threshold && x <= maxX + threshold && y >= minY - threshold && y <= maxY + threshold) return d.id
      } else {
        // fib / text - point-proximity to the anchor is close enough.
        if (pts.some(p => Math.hypot(p.x - x, p.y - y) <= threshold + 4)) return d.id
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
    const primitive = new DrawingPrimitive(
      this.chart, this.series,
      () => this.drawings.find(x => x.id === drawing.id) ?? null,
      () => this.selectedId === drawing.id
    )
    this.primitives.set(drawing.id, primitive)
    this.series.attachPrimitive(primitive)
  }

  destroy() {
    this.chart.unsubscribeClick(this.clickHandler)
    this.chart.unsubscribeCrosshairMove(this.moveHandler)
    window.removeEventListener("keydown", this.keyHandler)
    this.cancelPending()
    this.clearAll()
  }
}
