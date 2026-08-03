"use client"

import React, { useState } from "react"
import { X, Loader2, Check, Pencil, Trash2, Plus } from "lucide-react"
import { useTrade, Broker } from "@/contexts/TradeContext"

const BROKERS: { id: Broker; name: string }[] = [
  { id: "info_yatirim", name: "İnfo Yatırım" },
  { id: "midas", name: "Midas" },
]

function PortfoliosPanel() {
  const { accounts, activeAccountId, switchAccount, createAdditionalAccount, renameAccount, deleteAccount } = useTrade()
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState("")
  const [newBroker, setNewBroker] = useState<Broker>("midas")
  const [newBalance, setNewBalance] = useState("325000")
  const [renamingId, setRenamingId] = useState<number | null>(null)
  const [renameValue, setRenameValue] = useState("")
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")

  const handleCreate = async () => {
    const parsed = parseFloat(newBalance.replace(/\./g, "").replace(",", ".")) || 0
    setBusy(true)
    const res = await createAdditionalAccount(newBroker, parsed, newName.trim() || `Portföy ${accounts.length + 1}`)
    setBusy(false)
    if (res.ok) {
      setCreating(false)
      setNewName("")
    } else {
      setMessage(res.error || "Portföy oluşturulamadı.")
    }
  }

  const handleRename = async (id: number) => {
    if (!renameValue.trim()) return
    setBusy(true)
    const res = await renameAccount(id, renameValue.trim())
    setBusy(false)
    if (res.ok) setRenamingId(null)
    else setMessage(res.error || "Yeniden adlandırılamadı.")
  }

  const handleDelete = async (id: number) => {
    setBusy(true)
    const res = await deleteAccount(id)
    setBusy(false)
    if (!res.ok) setMessage(res.error || "Silinemedi.")
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
        {accounts.map(a => (
          <div
            key={a.id}
            className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${
              a.id === activeAccountId ? "border-white/30 bg-[#232530]" : "border-slate-800"
            }`}
          >
            {renamingId === a.id ? (
              <>
                <input
                  autoFocus
                  value={renameValue}
                  onChange={e => setRenameValue(e.target.value)}
                  className="flex-1 h-8 px-2 rounded-md bg-[#101015] border border-slate-800 text-xs font-bold text-white focus:outline-none focus:border-white/30"
                />
                <button
                  onClick={() => handleRename(a.id)}
                  disabled={busy}
                  className="text-emerald-400 hover:text-emerald-300 cursor-pointer disabled:opacity-50"
                >
                  <Check className="h-3.5 w-3.5" />
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => switchAccount(a.id)}
                  className="flex-1 text-left cursor-pointer"
                >
                  <div className="text-xs font-bold text-white flex items-center gap-1.5">
                    {a.name}
                    {a.id === activeAccountId && (
                      <span className="text-[9px] font-black text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">AKTİF</span>
                    )}
                  </div>
                  <div className="text-[10px] text-slate-500">
                    {a.broker === "midas" ? "Midas" : "İnfo Yatırım"} · ₺{a.starting_balance.toLocaleString("tr-TR")}
                  </div>
                </button>
                <button
                  onClick={() => { setRenamingId(a.id); setRenameValue(a.name) }}
                  className="text-slate-500 hover:text-white cursor-pointer"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                {accounts.length > 1 && (
                  <button
                    onClick={() => handleDelete(a.id)}
                    disabled={busy}
                    className="text-slate-500 hover:text-rose-400 cursor-pointer disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </>
            )}
          </div>
        ))}
      </div>

      {creating ? (
        <div className="space-y-2 rounded-lg border border-slate-800 p-3">
          <input
            placeholder="Portföy adı (ör. Agresif Strateji)"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            className="w-full h-9 px-3 rounded-lg bg-[#101015] border border-slate-800 text-xs font-bold text-white focus:outline-none focus:border-white/30"
          />
          <div className="grid grid-cols-2 gap-2">
            {BROKERS.map(b => (
              <button
                key={b.id}
                onClick={() => setNewBroker(b.id)}
                className={`h-8 rounded-lg text-[11px] font-bold border cursor-pointer transition-colors ${
                  newBroker === b.id ? "border-white/30 bg-[#232530] text-white" : "border-slate-800 text-slate-400"
                }`}
              >
                {b.name}
              </button>
            ))}
          </div>
          <input
            placeholder="Başlangıç bakiyesi"
            value={newBalance}
            onChange={e => setNewBalance(e.target.value)}
            className="w-full h-9 px-3 rounded-lg bg-[#101015] border border-slate-800 text-xs font-bold text-white focus:outline-none focus:border-white/30"
          />
          <div className="flex gap-2">
            <button
              onClick={() => setCreating(false)}
              className="flex-1 h-8 rounded-lg text-[11px] font-bold text-slate-400 border border-slate-800 cursor-pointer"
            >
              Vazgeç
            </button>
            <button
              onClick={handleCreate}
              disabled={busy}
              className="flex-1 h-8 rounded-lg text-[11px] font-bold bg-white text-[#101015] cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5"
            >
              {busy && <Loader2 className="h-3 w-3 animate-spin" />}
              Oluştur
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setCreating(true)}
          className="w-full h-9 rounded-lg border border-dashed border-slate-700 text-[11px] font-bold text-slate-400 hover:border-white/30 hover:text-white transition-colors cursor-pointer flex items-center justify-center gap-1.5"
        >
          <Plus className="h-3.5 w-3.5" />
          Yeni Portföy
        </button>
      )}

      {message && <p className="text-[11px] font-semibold text-rose-400">{message}</p>}
    </div>
  )
}

export default function AccountSettingsModal({ onClose }: { onClose: () => void }) {
  const { account, changeBroker, resetAccount } = useTrade()
  const [broker, setBroker] = useState<Broker>(account?.broker || "info_yatirim")
  const [resetBalance, setResetBalance] = useState("325000")
  const [mode, setMode] = useState<"broker" | "reset" | "portfolios">("portfolios")
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#101015]/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-800 bg-[#1c1d26] p-6 space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-black text-white">Trade Hesap Ayarları</span>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 cursor-pointer">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid grid-cols-3 gap-1 bg-[#101015] border border-slate-800 rounded-lg p-1">
          <button
            onClick={() => setMode("portfolios")}
            className={`h-8 rounded-md text-[10px] font-bold cursor-pointer ${mode === "portfolios" ? "bg-white text-[#101015]" : "text-slate-400"}`}
          >
            Portföyler
          </button>
          <button
            onClick={() => setMode("broker")}
            className={`h-8 rounded-md text-[10px] font-bold cursor-pointer ${mode === "broker" ? "bg-white text-[#101015]" : "text-slate-400"}`}
          >
            Broker
          </button>
          <button
            onClick={() => setMode("reset")}
            className={`h-8 rounded-md text-[10px] font-bold cursor-pointer ${mode === "reset" ? "bg-rose-500 text-white" : "text-slate-400"}`}
          >
            Sıfırla
          </button>
        </div>

        {mode === "portfolios" && <PortfoliosPanel />}

        {mode === "broker" && (
          <>
            <div className="grid grid-cols-2 gap-2">
              {BROKERS.map(b => (
                <button
                  key={b.id}
                  onClick={() => setBroker(b.id)}
                  className={`h-10 rounded-lg text-xs font-bold border cursor-pointer transition-colors ${
                    broker === b.id ? "border-white/30 bg-[#232530] text-white" : "border-slate-800 text-slate-400 hover:border-slate-700"
                  }`}
                >
                  {b.name}
                </button>
              ))}
            </div>
            {message && <p className="text-[11px] font-semibold text-slate-300">{message}</p>}
            <button
              onClick={handleBrokerSave}
              disabled={busy}
              className="w-full h-10 rounded-lg font-black text-sm cursor-pointer flex items-center justify-center gap-2 bg-white hover:bg-slate-200 text-[#101015] disabled:opacity-50"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Kaydet
            </button>
          </>
        )}

        {mode === "reset" && (
          <>
            <div className="grid grid-cols-2 gap-2">
              {BROKERS.map(b => (
                <button
                  key={b.id}
                  onClick={() => setBroker(b.id)}
                  className={`h-10 rounded-lg text-xs font-bold border cursor-pointer transition-colors ${
                    broker === b.id ? "border-white/30 bg-[#232530] text-white" : "border-slate-800 text-slate-400 hover:border-slate-700"
                  }`}
                >
                  {b.name}
                </button>
              ))}
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-500 uppercase">Yeni Başlangıç Bakiyesi</label>
              <input
                value={resetBalance}
                onChange={e => setResetBalance(e.target.value)}
                className="w-full h-10 px-3 rounded-lg bg-[#101015] border border-slate-800 text-sm font-bold text-white focus:outline-none focus:border-white/30"
              />
              <p className="text-[10px] text-rose-400/80">
                Bu işlem, bu portföydeki tüm açık pozisyonları ve işlem geçmişini kalıcı olarak siler.
              </p>
            </div>
            {message && <p className="text-[11px] font-semibold text-slate-300">{message}</p>}
            <button
              onClick={handleReset}
              disabled={busy}
              className="w-full h-10 rounded-lg font-black text-sm cursor-pointer flex items-center justify-center gap-2 bg-rose-500 hover:bg-rose-400 text-white disabled:opacity-50"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Hesabı Sıfırla
            </button>
          </>
        )}
      </div>
    </div>
  )
}
