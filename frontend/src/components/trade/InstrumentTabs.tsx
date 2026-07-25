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
    <div className="inline-flex items-center gap-1 bg-[#1c1d26]/80 border border-slate-800 rounded-lg p-1">
      {tabs.map(tab => (
        <button
          key={tab.id}
          onClick={() => setActiveTab(tab.id)}
          className={`px-4 h-8 rounded-md text-xs font-bold transition-colors cursor-pointer ${
            activeTab === tab.id
              ? "bg-blue-500 text-slate-950"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
