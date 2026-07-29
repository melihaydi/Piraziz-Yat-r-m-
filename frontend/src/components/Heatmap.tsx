"use client"

import React, { useMemo, useState } from "react"

interface HeatmapDatum {
  name: string
  value: number
  changePercent: number
}

interface Rect extends HeatmapDatum {
  x: number
  y: number
  w: number
  h: number
}

/**
 * Squarified treemap layout (Bruls, Huizing, van Wijk) - lays out
 * rectangles proportional to `value` while keeping aspect ratios close to
 * 1, so boxes read as roughly comparable tiles instead of the long thin
 * slivers a plain row/column slice-and-dice produces when sizes vary a lot
 * (BIST stock market caps vary by 100x+ between the biggest and smallest).
 */
function squarify(items: HeatmapDatum[], width: number, height: number): Rect[] {
  const total = items.reduce((s, i) => s + i.value, 0)
  if (total <= 0 || width <= 0 || height <= 0) return []
  const scale = (width * height) / total
  const sorted = [...items].sort((a, b) => b.value - a.value).map(i => ({ ...i, area: i.value * scale }))

  const rects: Rect[] = []

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
      if (horizontal) {
        const itemW = sum > 0 ? (item.area / sum) * w : 0
        rects.push({ ...item, x: x + offset, y, w: itemW, h })
        offset += itemW
      } else {
        const itemH = sum > 0 ? (item.area / sum) * h : 0
        rects.push({ ...item, x, y: y + offset, w, h: itemH })
        offset += itemH
      }
    })
  }

  const recurse = (items: typeof sorted, x: number, y: number, w: number, h: number) => {
    if (items.length === 0) return
    if (items.length === 1) {
      rects.push({ ...items[0], x, y, w, h })
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

// Color intensity scales with |change%|, capped at 5% so a single extreme
// mover doesn't wash out the rest of the map.
function colorFor(changePercent: number): string {
  const capped = Math.max(-5, Math.min(5, changePercent))
  const t = Math.abs(capped) / 5
  if (changePercent >= 0) {
    const l = 42 - t * 16
    return `hsl(152, 60%, ${l}%)`
  }
  const l = 42 - t * 14
  return `hsl(350, 65%, ${l}%)`
}

export default function Heatmap({ data, height = 320 }: { data: HeatmapDatum[]; height?: number }) {
  const width = 1000 // viewBox units, scales via SVG's own responsiveness
  const [hovered, setHovered] = useState<string | null>(null)
  const rects = useMemo(() => squarify(data, width, height), [data, height])

  return (
    <div className="w-full" style={{ height }}>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full" preserveAspectRatio="none">
        {rects.map(r => {
          const isHovered = hovered === r.name
          const showLabel = r.w > 70 && r.h > 32
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
                rx={4}
              />
              {showLabel && (
                <>
                  <text
                    x={r.x + 10}
                    y={r.y + 22}
                    fill="#fff"
                    fontSize={13}
                    fontWeight={800}
                    style={{ pointerEvents: "none" }}
                  >
                    {r.name}
                  </text>
                  <text
                    x={r.x + 10}
                    y={r.y + 40}
                    fill="rgba(255,255,255,0.85)"
                    fontSize={11}
                    fontWeight={700}
                    style={{ pointerEvents: "none" }}
                  >
                    {r.changePercent >= 0 ? "+" : ""}{r.changePercent.toFixed(2)}%
                  </text>
                </>
              )}
              {isHovered && (
                <title>{`${r.name}: ${r.changePercent >= 0 ? "+" : ""}${r.changePercent.toFixed(2)}% (₺${(r.value / 1e9).toFixed(1)}Mr piyasa değeri)`}</title>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}
