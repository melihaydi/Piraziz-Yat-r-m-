"use client"

import React from "react"
import { useTrade } from "@/contexts/TradeContext"

export default function InstrumentTabs() {
  const { activeTab, setActiveTab } = useTrade()

  const tabs: { id: "stock" | "viop"; label: string }[] = [
    { id: "stock", label: "BIST30" },
    { id: "viop", label: "VİOP" },
  ]

  return (
    <div className="inline-flex items-center gap-1 bg-popover/80 border border-border rounded-lg p-1">
      {tabs.map(tab => (
        <button
          key={tab.id}
          onClick={() => setActiveTab(tab.id)}
          className={`press px-4 h-8 rounded-md text-xs font-bold transition-colors cursor-pointer ${
            activeTab === tab.id
              ? "bg-primary text-background"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
