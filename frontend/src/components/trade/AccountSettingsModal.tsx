"use client"

import React, { useState } from "react"
import { X, Loader2 } from "lucide-react"
import { useTrade, Broker } from "@/contexts/TradeContext"

const BROKERS: { id: Broker; name: string }[] = [
  { id: "info_yatirim", name: "İnfo Yatırım" },
  { id: "midas", name: "Midas" },
]

export default function AccountSettingsModal({ onClose }: { onClose: () => void }) {
  const { account, changeBroker, resetAccount } = useTrade()
  const [broker, setBroker] = useState<Broker>(account?.broker || "info_yatirim")
  const [resetBalance, setResetBalance] = useState("325000")
  const [mode, setMode] = useState<"broker" | "reset">("broker")
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")

  const handleBrokerSave = async () => {
    setBusy(true)
    const res = await changeBroker(broker)
    setBusy(false)
    setMessage(res.ok ? "Broker güncellendi." : res.error || "Bir hata oluştu.")
  }

  const handleReset = async () => {
    const parsed = parseFloat(resetBalance.replace(/\./g, "").replace(",", "."))
    if (!parsed || parsed <= 0) {
      setMessage("Geçerli bir bakiye girin.")
      return
    }
    setBusy(true)
    const res = await resetAccount(broker, parsed)
    setBusy(false)
    setMessage(res.ok ? "Hesap sıfırlandı." : res.error || "Bir hata oluştu.")
    if (res.ok) setTimeout(onClose, 800)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-800 bg-slate-900 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-black text-slate-100">Trade Hesap Ayarları</span>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 cursor-pointer">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex gap-1 bg-slate-950 border border-slate-800 rounded-lg p-1">
          <button
            onClick={() => setMode("broker")}
            className={`flex-1 h-8 rounded-md text-xs font-bold cursor-pointer ${mode === "broker" ? "bg-cyan-500 text-slate-950" : "text-slate-400"}`}
          >
            Broker Değiştir
          </button>
          <button
            onClick={() => setMode("reset")}
            className={`flex-1 h-8 rounded-md text-xs font-bold cursor-pointer ${mode === "reset" ? "bg-rose-500 text-slate-950" : "text-slate-400"}`}
          >
            Hesabı Sıfırla
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {BROKERS.map(b => (
            <button
              key={b.id}
              onClick={() => setBroker(b.id)}
              className={`h-10 rounded-lg text-xs font-bold border cursor-pointer transition-colors ${
                broker === b.id ? "border-cyan-500 bg-cyan-500/10 text-cyan-300" : "border-slate-800 text-slate-400 hover:border-slate-700"
              }`}
            >
              {b.name}
            </button>
          ))}
        </div>

        {mode === "reset" && (
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-slate-500 uppercase">Yeni Başlangıç Bakiyesi</label>
            <input
              value={resetBalance}
              onChange={e => setResetBalance(e.target.value)}
              className="w-full h-10 px-3 rounded-lg bg-slate-950 border border-slate-800 text-sm font-mono font-bold text-slate-100 focus:outline-none focus:border-cyan-500/50"
            />
            <p className="text-[10px] text-rose-400/80">
              Bu işlem tüm açık pozisyonlarınızı ve işlem geçmişinizi kalıcı olarak siler.
            </p>
          </div>
        )}

        {message && <p className="text-[11px] font-semibold text-slate-300">{message}</p>}

        <button
          onClick={mode === "broker" ? handleBrokerSave : handleReset}
          disabled={busy}
          className={`w-full h-10 rounded-lg font-black text-sm cursor-pointer flex items-center justify-center gap-2 ${
            mode === "broker" ? "bg-cyan-500 hover:bg-cyan-400 text-slate-950" : "bg-rose-500 hover:bg-rose-400 text-slate-950"
          } disabled:opacity-50`}
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {mode === "broker" ? "Kaydet" : "Hesabı Sıfırla"}
        </button>
      </div>
    </div>
  )
}
