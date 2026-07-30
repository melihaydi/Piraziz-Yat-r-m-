"use client"

import React, { useMemo, useState } from "react"

interface HeatmapDatum {
  name: string
  value: number
  changePercent: number
  group?: string
}

type Sized = { value: number }
type Placed<T> = T & { x: number; y: number; w: number; h: number }

/**
 * Squarified treemap layout (Bruls, Huizing, van Wijk) - lays out
 * rectangles proportional to `value` while keeping aspect ratios close to
 * 1, so boxes read as roughly comparable tiles instead of the long thin
 * slivers a plain row/column slice-and-dice produces when sizes vary a lot
 * (BIST stock market caps vary by 100x+ between the biggest and smallest).
 * Generic so the same layout function lays out both the outer sector
 * regions and each sector's own inner stock tiles (see buildGroupedLayout).
 */
function squarify<T extends Sized>(items: T[], width: number, height: number): Placed<T>[] {
  const total = items.reduce((s, i) => s + i.value, 0)
  if (total <= 0 || width <= 0 || height <= 0) return []
  const scale = (width * height) / total
  const sorted = [...items].sort((a, b) => b.value - a.value).map(i => ({ ...i, area: i.value * scale }))

  const rects: Placed<T>[] = []

  const worst = (row: typeof sorted, length: number): number => {
    const sum = row.reduce((s, r) => s + r.area, 0)
    const rowMax = Math.max(...row.map(r => r.area))
    const rowMin = Math.min(...row.map(r => r.area))
    if (sum === 0 || rowMin === 0) return Infinity
    return Math.max((length * length * rowMax) / (sum * sum), (sum * sum) / (length * length * rowMin))
  }

  const layoutRow = (row: typeof sorted, x: number, y: number, w: number, h: number, horizontal: boolean) => {
    const sum = row.reduce((s, r) => s + r.area, 0)
    let offset = 0
    row.forEach(item => {
      const { area, ...rest } = item
      if (horizontal) {
        const itemW = sum > 0 ? (area / sum) * w : 0
        rects.push({ ...(rest as unknown as T), x: x + offset, y, w: itemW, h })
        offset += itemW
      } else {
        const itemH = sum > 0 ? (area / sum) * h : 0
        rects.push({ ...(rest as unknown as T), x, y: y + offset, w, h: itemH })
        offset += itemH
      }
    })
  }

  const recurse = (items: typeof sorted, x: number, y: number, w: number, h: number) => {
    if (items.length === 0) return
    if (items.length === 1) {
      const { area, ...rest } = items[0]
      rects.push({ ...(rest as unknown as T), x, y, w, h })
      return
    }
    const horizontal = w >= h
    const length = horizontal ? h : w
    let row: typeof sorted = []
    let i = 0
    while (i < items.length) {
      const testRow = [...row, items[i]]
      if (row.length === 0 || worst(testRow, length) <= worst(row, length)) {
        row = testRow
        i++
      } else {
        break
      }
    }
    const rowArea = row.reduce((s, r) => s + r.area, 0)
    const rowLength = horizontal ? (h > 0 ? rowArea / h : 0) : (w > 0 ? rowArea / w : 0)
    layoutRow(row, x, y, horizontal ? rowLength : w, horizontal ? h : rowLength, horizontal)
    if (horizontal) {
      recurse(items.slice(i), x + rowLength, y, Math.max(w - rowLength, 0), h)
    } else {
      recurse(items.slice(i), x, y + rowLength, w, Math.max(h - rowLength, 0))
    }
  }

  recurse(sorted, 0, 0, width, height)
  return rects
}

interface StockRect extends HeatmapDatum {
  x: number
  y: number
  w: number
  h: number
}

interface GroupBlock {
  group: string
  x: number
  y: number
  w: number
  h: number
  changePercent: number // value-weighted average, tints the sector header bar
  items: StockRect[]
}

const HEADER_H = 18 // sector header bar height, TradingView-style
const GUTTER = 3     // gap between sector blocks

/**
 * Two-level layout matching TradingView's own stock heatmap: an outer
 * treemap of sector blocks (sized by each sector's total market cap), each
 * containing its own inner treemap of that sector's individual stocks -
 * rather than one flat treemap of all stocks with no sector structure.
 */
function buildGroupedLayout(data: HeatmapDatum[], width: number, height: number): GroupBlock[] {
  const byGroup = new Map<string, HeatmapDatum[]>()
  for (const d of data) {
    const g = d.group || "Diğer"
    if (!byGroup.has(g)) byGroup.set(g, [])
    byGroup.get(g)!.push(d)
  }

  const groupTotals = Array.from(byGroup.entries()).map(([group, items]) => {
    const value = items.reduce((s, i) => s + i.value, 0)
    const changePercent = value > 0 ? items.reduce((s, i) => s + i.value * i.changePercent, 0) / value : 0
    return { group, value, changePercent, items }
  })

  const groupRects = squarify(groupTotals, width, height)

  return groupRects.map(g => {
    const innerX = g.x + GUTTER / 2
    const innerY = g.y + HEADER_H
    const innerW = Math.max(g.w - GUTTER, 0)
    const innerH = Math.max(g.h - HEADER_H - GUTTER / 2, 0)
    const items = squarify(g.items, innerW, innerH).map(r => ({
      ...r,
      x: r.x + innerX,
      y: r.y + innerY,
    }))
    return { group: g.group, x: g.x, y: g.y, w: g.w, h: g.h, changePercent: g.changePercent, items }
  })
}

// TradingView's own heatmap uses a punchier, more saturated red/green scale
// than a typical muted dashboard chart - intensity still scales with
// |change%|, capped at 3% (BIST daily moves rarely exceed that outside of
// specific news-driven names) so a single extreme mover doesn't wash out
// the rest of the map.
function colorFor(changePercent: number): string {
  const capped = Math.max(-3, Math.min(3, changePercent))
  const t = Math.abs(capped) / 3
  if (changePercent >= 0) {
    return `hsl(140, ${42 + t * 18}%, ${46 - t * 20}%)`
  }
  return `hsl(355, ${55 + t * 20}%, ${52 - t * 22}%)`
}

function headerColorFor(changePercent: number): string {
  const capped = Math.max(-3, Math.min(3, changePercent))
  const t = Math.abs(capped) / 3
  if (changePercent >= 0) return `hsl(140, ${35 + t * 15}%, ${20 - t * 6}%)`
  return `hsl(355, ${40 + t * 15}%, ${22 - t * 6}%)`
}

export default function Heatmap({ data, height = 320 }: { data: HeatmapDatum[]; height?: number }) {
  const width = 1000 // viewBox units, scales via SVG's own responsiveness
  const [hovered, setHovered] = useState<string | null>(null)
  const groups = useMemo(() => buildGroupedLayout(data, width, height), [data, height])

  return (
    <div className="w-full" style={{ height }}>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full" preserveAspectRatio="none">
        {groups.map(g => (
          <g key={g.group}>
            <rect
              x={g.x}
              y={g.y}
              width={Math.max(g.w, 0)}
              height={Math.max(HEADER_H, 0)}
              fill={headerColorFor(g.changePercent)}
              rx={3}
            />
            {g.w > 60 && (
              <text
                x={g.x + 6}
                y={g.y + 13}
                fill="rgba(255,255,255,0.75)"
                fontSize={10}
                fontWeight={700}
                style={{ pointerEvents: "none" }}
              >
                {g.group}
              </text>
            )}
            {g.items.map(r => {
              const isHovered = hovered === r.name
              const showLabel = r.w > 60 && r.h > 28
              return (
                <g
                  key={r.name}
                  onMouseEnter={() => setHovered(r.name)}
                  onMouseLeave={() => setHovered(null)}
                  style={{ cursor: "default" }}
                >
                  <rect
                    x={r.x + 1}
                    y={r.y + 1}
                    width={Math.max(r.w - 2, 0)}
                    height={Math.max(r.h - 2, 0)}
                    fill={colorFor(r.changePercent)}
                    stroke={isHovered ? "#fff" : "#101015"}
                    strokeWidth={isHovered ? 2 : 1}
                    rx={2}
                  />
                  {showLabel && (
                    <>
                      <text
                        x={r.x + 8}
                        y={r.y + 20}
                        fill="#fff"
                        fontSize={12}
                        fontWeight={800}
                        style={{ pointerEvents: "none" }}
                      >
                        {r.name}
                      </text>
                      {r.h > 42 && (
                        <text
                          x={r.x + 8}
                          y={r.y + 36}
                          fill="rgba(255,255,255,0.85)"
                          fontSize={10.5}
                          fontWeight={700}
                          style={{ pointerEvents: "none" }}
                        >
                          {r.changePercent >= 0 ? "+" : ""}{r.changePercent.toFixed(2)}%
                        </text>
                      )}
                    </>
                  )}
                  {isHovered && (
                    <title>{`${g.group} · ${r.name}: ${r.changePercent >= 0 ? "+" : ""}${r.changePercent.toFixed(2)}% (₺${(r.value / 1e9).toFixed(1)}Mr piyasa değeri)`}</title>
                  )}
                </g>
              )
            })}
          </g>
        ))}
      </svg>
    </div>
  )
}
