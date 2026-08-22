"use client"

import React, { useState } from "react"
import { X, Loader2, Wallet, PlusCircle } from "lucide-react"
import { useTrade } from "@/contexts/TradeContext"
import { parseTLAmount } from "@/lib/utils"

const QUICK_AMOUNTS = [10000, 50000, 100000, 250000]

export default function DepositModal({ onClose }: { onClose: () => void }) {
  const { depositFunds } = useTrade()
  const [amount, setAmount] = useState("50000")
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null)

  const handleDeposit = async () => {
    const parsed = parseTLAmount(amount)
    if (!parsed || parsed <= 0) {
      setMessage({ type: "error", text: "Geçerli bir tutar girin." })
      return
    }
    setBusy(true)
    setMessage(null)
    const res = await depositFunds(parsed)
    setBusy(false)
    if (res.ok) {
      setMessage({ type: "ok", text: "Bakiye eklendi." })
      setTimeout(onClose, 700)
    } else {
      setMessage({ type: "error", text: res.error || "Bakiye eklenemedi." })
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-popover p-6 space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-black text-foreground flex items-center gap-2">
            <Wallet className="h-4 w-4 text-foreground" />
            Bakiye Ekle
          </span>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground cursor-pointer">
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Bu bir kağıt üzerinde (simüle) işlem hesabıdır - gerçek para hareketi olmaz, sadece deneme bakiyenize eklenir.
        </p>

        <div className="space-y-1.5">
          <label className="text-[10px] font-bold text-muted-foreground uppercase">Tutar</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-bold">₺</span>
            <input
              value={amount}
              onChange={e => setAmount(e.target.value)}
              className="w-full h-11 pl-7 pr-3 rounded-lg bg-background border border-border text-sm font-bold text-foreground focus:outline-none focus:border-primary/40"
            />
          </div>
        </div>

        <div className="grid grid-cols-4 gap-2">
          {QUICK_AMOUNTS.map(v => (
            <button
              key={v}
              onClick={() => setAmount(String(v))}
              className="h-8 rounded-lg text-[10px] font-bold border border-border text-muted-foreground hover:border-primary/30 hover:text-foreground transition-colors cursor-pointer"
            >
              {v >= 1000 ? `${v / 1000}B` : v}
            </button>
          ))}
        </div>

        {message && (
          <p className={`text-[11px] font-semibold ${message.type === "ok" ? "text-bull" : "text-bear"}`}>
            {message.text}
          </p>
        )}

        <button
          onClick={handleDeposit}
          disabled={busy}
          className="w-full h-11 rounded-lg font-black text-sm cursor-pointer flex items-center justify-center gap-2 bg-primary hover:bg-primary-hover text-background disabled:opacity-50 transition-colors"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlusCircle className="h-4 w-4" />}
          Bakiye Ekle
        </button>
      </div>
    </div>
  )
}
