"use client"

import React, { useState } from "react"
import { Landmark, ArrowRight, Loader2, Wallet } from "lucide-react"
import { Button } from "@/components/ui/Button"
import { Input } from "@/components/ui/Input"
import { useTrade, Broker } from "@/contexts/TradeContext"

const BROKERS: { id: Broker; name: string; accent: string }[] = [
  { id: "info_yatirim", name: "İnfo Yatırım", accent: "from-cyan-500 to-blue-600" },
  { id: "midas", name: "Midas", accent: "from-sky-400 to-cyan-600" },
]

export default function BrokerSelection() {
  const { createAccount } = useTrade()
  const [step, setStep] = useState<"broker" | "balance">("broker")
  const [selectedBroker, setSelectedBroker] = useState<Broker | null>(null)
  const [balance, setBalance] = useState("325000")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")

  const handlePickBroker = (broker: Broker) => {
    setSelectedBroker(broker)
    setStep("balance")
  }

  const handleConfirm = async () => {
    if (!selectedBroker) return
    const parsed = parseFloat(balance.replace(/\./g, "").replace(",", "."))
    if (!parsed || parsed <= 0) {
      setError("Geçerli bir başlangıç bakiyesi girin.")
      return
    }
    setSubmitting(true)
    setError("")
    const result = await createAccount(selectedBroker, parsed)
    setSubmitting(false)
    if (!result.ok) {
      setError(result.error || "Hesap oluşturulamadı.")
    }
  }

  return (
    <div className="min-h-[calc(100vh-8rem)] flex items-center justify-center">
      <div className="w-full max-w-2xl">
        <div className="text-center mb-10">
          <div className="mx-auto h-14 w-14 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center mb-4">
            <Landmark className="h-7 w-7 text-cyan-400" />
          </div>
          <h1 className="text-2xl font-black tracking-tight text-slate-100">Trade Terminaline Hoş Geldiniz</h1>
          <p className="text-sm text-slate-400 mt-1.5">
            Devam etmek için bir aracı kurum seçin
          </p>
        </div>

        {step === "broker" ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {BROKERS.map(broker => (
              <button
                key={broker.id}
                onClick={() => handlePickBroker(broker.id)}
                className="group relative rounded-2xl border border-slate-800 bg-slate-900/60 hover:border-cyan-500/50 hover:bg-slate-900 transition-all p-8 text-left cursor-pointer overflow-hidden"
              >
                <div className={`absolute -top-10 -right-10 h-32 w-32 rounded-full bg-gradient-to-br ${broker.accent} opacity-10 group-hover:opacity-20 blur-2xl transition-opacity`} />
                <div className={`h-12 w-12 rounded-xl bg-gradient-to-br ${broker.accent} flex items-center justify-center font-black text-white text-lg mb-5 shadow-lg`}>
                  {broker.name.charAt(0)}
                </div>
                <div className="font-extrabold text-lg text-slate-100">{broker.name}</div>
                <div className="text-xs text-slate-500 mt-1">Bu kurum ile devam et</div>
                <div className="flex items-center text-cyan-400 text-xs font-bold mt-5 group-hover:translate-x-1 transition-transform">
                  Seç <ArrowRight className="h-3.5 w-3.5 ml-1" />
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-8 space-y-5">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center">
                <Wallet className="h-5 w-5 text-cyan-400" />
              </div>
              <div>
                <div className="text-sm font-bold text-slate-100">Başlangıç Bakiyesi</div>
                <div className="text-xs text-slate-500">Bu tutar daha sonra ayarlardan değiştirilebilir</div>
              </div>
            </div>

            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm font-bold">₺</span>
              <Input
                value={balance}
                onChange={e => setBalance(e.target.value)}
                className="pl-8 h-12 text-lg font-mono font-bold bg-slate-950 border-slate-800 text-slate-100"
              />
            </div>

            {error && <p className="text-xs text-rose-400 font-semibold">{error}</p>}

            <div className="flex items-center gap-3 pt-2">
              <Button
                variant="outline"
                onClick={() => setStep("broker")}
                className="border-slate-700 text-slate-300"
              >
                Geri
              </Button>
              <Button
                onClick={handleConfirm}
                disabled={submitting}
                className="flex-1 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white font-bold border-0"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Trade Terminalini Başlat
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
