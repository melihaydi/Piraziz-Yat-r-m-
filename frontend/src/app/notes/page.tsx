"use client"

import React, { useState, useEffect, useMemo } from "react"
import { useRouter } from "next/navigation"
import { Newsreader } from "next/font/google"
import {
  StickyNote, Plus, Pin, PinOff, Pencil, Trash2, Search,
  X, Loader2, ArrowUpRight,
} from "lucide-react"
import { Card, CardContent } from "@/components/ui/Card"
import { Button } from "@/components/ui/Button"
import { Input } from "@/components/ui/Input"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/Dialog"
import { TickerLogo } from "@/components/ui/TickerLogo"
import { authFetch } from "@/lib/auth"

// A dedicated editorial serif for note text only - the rest of the app is
// Inter (see layout.tsx), which reads great for data-dense tables but flat
// for something meant to feel like a personal notebook. Scoped to this page
// via its own className rather than touching the root font.
const notesFont = Newsreader({ subsets: ["latin"], style: ["normal", "italic"], weight: ["400", "500", "600"] })

interface Note {
  id: number
  title: string
  content: string
  ticker: string | null
  category: string
  color: string
  is_pinned: boolean
  created_at: string
  updated_at: string
}

const CATEGORIES = [
  { value: "Tümü", label: "Tümü" },
  { value: "hisse", label: "Hisse" },
  { value: "fon", label: "Fon" },
  { value: "genel", label: "Genel" },
]

const COLORS: Record<string, { dot: string; border: string; wash: string; text: string; label: string }> = {
  amber: { dot: "bg-amber-400", border: "border-amber-500/30", wash: "bg-amber-500/[0.06]", text: "text-amber-300", label: "Kehribar" },
  blue: { dot: "bg-blue-400", border: "border-blue-500/30", wash: "bg-blue-500/[0.06]", text: "text-blue-300", label: "Mavi" },
  emerald: { dot: "bg-emerald-400", border: "border-emerald-500/30", wash: "bg-emerald-500/[0.06]", text: "text-emerald-300", label: "Yeşil" },
  rose: { dot: "bg-rose-400", border: "border-rose-500/30", wash: "bg-rose-500/[0.06]", text: "text-rose-300", label: "Gül" },
  violet: { dot: "bg-violet-400", border: "border-violet-500/30", wash: "bg-violet-500/[0.06]", text: "text-violet-300", label: "Mor" },
  slate: { dot: "bg-slate-400", border: "border-slate-500/30", wash: "bg-slate-500/[0.06]", text: "text-slate-300", label: "Gri" },
}

const CATEGORY_LABEL: Record<string, string> = { hisse: "Hisse", fon: "Fon", genel: "Genel" }

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return "az önce"
  if (mins < 60) return `${mins} dk önce`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} sa önce`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} gün önce`
  return new Date(iso).toLocaleDateString("tr-TR")
}

interface FormState {
  title: string
  content: string
  ticker: string
  category: string
  color: string
}

const EMPTY_FORM: FormState = { title: "", content: "", ticker: "", category: "genel", color: "amber" }

export default function NotesPage() {
  const router = useRouter()
  const [notes, setNotes] = useState<Note[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [category, setCategory] = useState("Tümü")

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  const loadNotes = async () => {
    try {
      const res = await authFetch("/notes/")
      if (res.ok) setNotes(await res.json())
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadNotes() }, [])

  const filtered = useMemo(() => {
    return notes.filter(n => {
      if (category !== "Tümü" && n.category !== category) return false
      if (!search.trim()) return true
      const q = search.trim().toLowerCase()
      return n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q) || (n.ticker || "").toLowerCase().includes(q)
    })
  }, [notes, search, category])

  const openNewNote = () => {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setDialogOpen(true)
  }

  const openEditNote = (n: Note) => {
    setEditingId(n.id)
    setForm({ title: n.title, content: n.content, ticker: n.ticker || "", category: n.category, color: n.color })
    setDialogOpen(true)
  }

  const saveNote = async () => {
    if (!form.title.trim()) return
    setSaving(true)
    try {
      const payload = {
        title: form.title.trim(),
        content: form.content,
        ticker: form.ticker.trim() || null,
        category: form.category,
        color: form.color,
      }
      const res = editingId
        ? await authFetch(`/notes/${editingId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
        : await authFetch("/notes/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
      if (res.ok) {
        setDialogOpen(false)
        await loadNotes()
      }
    } finally {
      setSaving(false)
    }
  }

  const deleteNote = async (id: number) => {
    setNotes(prev => prev.filter(n => n.id !== id))
    await authFetch(`/notes/${id}`, { method: "DELETE" })
  }

  const togglePin = async (id: number) => {
    setNotes(prev => prev.map(n => n.id === id ? { ...n, is_pinned: !n.is_pinned } : n))
    const res = await authFetch(`/notes/${id}/pin`, { method: "POST" })
    if (res.ok) {
      const updated = await res.json()
      setNotes(prev => {
        const next = prev.map(n => n.id === id ? updated : n)
        next.sort((a, b) => (Number(b.is_pinned) - Number(a.is_pinned)) || (new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()))
        return next
      })
    }
  }

  const goToTicker = (ticker: string, e: React.MouseEvent) => {
    e.stopPropagation()
    router.push(`/screener?ticker=${ticker}`)
  }

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight flex items-center">
            <StickyNote className="h-7 w-7 text-pink-400 mr-3" />
            Notlarım
          </h1>
          <p className="text-muted-foreground mt-1">
            Hisseler, fonlar veya aklınıza takılan her şey hakkında kişisel notlarınızı burada tutun.
          </p>
        </div>
        <Button onClick={openNewNote} className="bg-pink-500 hover:bg-pink-500/90 text-white shrink-0">
          <Plus className="h-4 w-4 mr-1.5" /> Yeni Not
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Notlarda ara..."
            className="w-full h-9 pl-9 pr-3 rounded-lg bg-secondary/40 border border-border text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-pink-500/40"
          />
        </div>
        <div className="flex items-center gap-1 rounded-lg bg-secondary/30 p-1 border border-border">
          {CATEGORIES.map(c => (
            <button
              key={c.value}
              onClick={() => setCategory(c.value)}
              className={`h-7 px-3 rounded-md text-xs font-bold transition-colors cursor-pointer ${
                category === c.value ? "bg-pink-500/15 text-pink-300 border border-pink-500/30" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-6 w-6 text-pink-400 animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <Card glass={true} className="border-dashed border-border/60">
          <CardContent className="py-16 flex flex-col items-center gap-3 text-center">
            <StickyNote className="h-8 w-8 text-muted-foreground" />
            <div>
              <p className="font-bold text-foreground">
                {notes.length === 0 ? "Henüz hiç notunuz yok" : "Aramanızla eşleşen not bulunamadı"}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {notes.length === 0 ? "İlk notunuzu eklemek için “Yeni Not” butonuna tıklayın." : "Farklı bir anahtar kelime veya kategori deneyin."}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="columns-1 sm:columns-2 xl:columns-3 gap-4 [column-fill:_balance]">
          {filtered.map(n => {
            const c = COLORS[n.color] || COLORS.amber
            return (
              <div
                key={n.id}
                onClick={() => openEditNote(n)}
                className={`break-inside-avoid mb-4 rounded-xl border ${c.border} ${c.wash} p-4 cursor-pointer group transition-all hover:shadow-lg hover:-translate-y-0.5`}
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className={`h-2 w-2 rounded-full ${c.dot} shrink-0`} />
                    <h3 className={`${notesFont.className} text-base font-semibold text-foreground truncate`}>{n.title}</h3>
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => { e.stopPropagation(); togglePin(n.id) }}
                      title={n.is_pinned ? "Sabitlemeyi kaldır" : "Sabitle"}
                      className="h-6 w-6 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-white/10 cursor-pointer"
                    >
                      {n.is_pinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); openEditNote(n) }}
                      title="Düzenle"
                      className="h-6 w-6 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-white/10 cursor-pointer"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteNote(n.id) }}
                      title="Sil"
                      className="h-6 w-6 flex items-center justify-center rounded-md text-muted-foreground hover:text-rose-400 hover:bg-rose-500/10 cursor-pointer"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>

                {n.is_pinned && (
                  <div className="mb-2">
                    <span className={`inline-flex items-center gap-1 text-[10px] font-bold ${c.text}`}>
                      <Pin className="h-2.5 w-2.5" /> Sabitlendi
                    </span>
                  </div>
                )}

                {n.content && (
                  <p className={`${notesFont.className} italic text-[15px] leading-relaxed text-foreground/85 whitespace-pre-wrap line-clamp-6`}>
                    {n.content}
                  </p>
                )}

                <div className="flex items-center justify-between gap-2 mt-3 pt-3 border-t border-border/40">
                  {n.ticker ? (
                    <button
                      onClick={(e) => goToTicker(n.ticker!, e)}
                      className="flex items-center gap-1.5 text-xs font-bold text-foreground hover:text-pink-300 transition-colors cursor-pointer"
                    >
                      <TickerLogo ticker={n.ticker} size={14} />
                      {n.ticker}
                      <ArrowUpRight className="h-3 w-3" />
                    </button>
                  ) : (
                    <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">{CATEGORY_LABEL[n.category] || n.category}</span>
                  )}
                  <span className="text-[10px] text-muted-foreground">{timeAgo(n.updated_at)}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <StickyNote className="h-4 w-4 text-pink-400" />
              {editingId ? "Notu Düzenle" : "Yeni Not"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <label className="text-xs font-bold text-muted-foreground mb-1.5 block">Başlık</label>
              <Input
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder="Örn. THYAO çeyrek sonuçları"
                autoFocus
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-bold text-muted-foreground mb-1.5 block">İlgili Sembol (opsiyonel)</label>
                <Input
                  value={form.ticker}
                  onChange={e => setForm(f => ({ ...f, ticker: e.target.value.toUpperCase() }))}
                  placeholder="THYAO, TMV..."
                  maxLength={20}
                />
              </div>
              <div>
                <label className="text-xs font-bold text-muted-foreground mb-1.5 block">Kategori</label>
                <select
                  value={form.category}
                  onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                  className="w-full h-9 px-3 rounded-md bg-secondary/40 border border-border text-sm text-foreground focus:outline-none focus:border-pink-500/40 cursor-pointer"
                >
                  <option value="genel">Genel</option>
                  <option value="hisse">Hisse</option>
                  <option value="fon">Fon</option>
                </select>
              </div>
            </div>

            <div>
              <label className="text-xs font-bold text-muted-foreground mb-1.5 block">Renk</label>
              <div className="flex items-center gap-2">
                {Object.entries(COLORS).map(([key, c]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setForm(f => ({ ...f, color: key }))}
                    title={c.label}
                    className={`h-7 w-7 rounded-full ${c.dot} flex items-center justify-center ring-offset-2 ring-offset-card cursor-pointer transition-all ${
                      form.color === key ? "ring-2 ring-foreground scale-110" : "opacity-60 hover:opacity-100"
                    }`}
                  />
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs font-bold text-muted-foreground mb-1.5 block">Not</label>
              <textarea
                value={form.content}
                onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
                placeholder="Aklınızdakileri buraya yazın..."
                rows={8}
                className={`${notesFont.className} italic w-full px-3 py-2.5 rounded-md bg-secondary/40 border border-border text-[15px] leading-relaxed text-foreground placeholder:text-muted-foreground placeholder:not-italic placeholder:font-sans placeholder:text-sm focus:outline-none focus:border-pink-500/40 resize-none`}
              />
            </div>

            <div className="flex items-center justify-between pt-2">
              {editingId ? (
                <Button
                  variant="ghost"
                  onClick={() => { deleteNote(editingId); setDialogOpen(false) }}
                  className="text-rose-400 hover:text-rose-300 hover:bg-rose-500/10"
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Sil
                </Button>
              ) : <div />}
              <div className="flex items-center gap-2">
                <Button variant="ghost" onClick={() => setDialogOpen(false)}>
                  <X className="h-3.5 w-3.5 mr-1.5" /> Vazgeç
                </Button>
                <Button
                  onClick={saveNote}
                  disabled={saving || !form.title.trim()}
                  className="bg-pink-500 hover:bg-pink-500/90 text-white"
                >
                  {saving ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : null}
                  Kaydet
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
