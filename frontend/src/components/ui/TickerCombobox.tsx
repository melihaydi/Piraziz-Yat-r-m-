"use client"

import React, { useMemo, useState } from "react"
import { Input } from "@/components/ui/Input"
import { TickerLogo } from "@/components/ui/TickerLogo"
import { useTickerDirectory, type TickerDirectoryEntry } from "@/lib/tickerDirectory"

interface TickerComboboxProps {
  value: string
  onChange: (value: string) => void
  // Bir öneriye tıklanınca (serbest yazmadan farklı olarak) ekstra bilgi
  // (fiyat, fon mu hisse mi) lazım olan çağıranlar için - opsiyonel.
  onSelect?: (entry: TickerDirectoryEntry) => void
  placeholder?: string
  className?: string
  inputClassName?: string
  required?: boolean
}

/**
 * Serbest metin ticker/fon kodu girişi + tıklanabilir öneri açılır listesi
 * (logo + kod + isim + güncel fiyat) - Header.tsx'in genel arama kutusuyla
 * AYNI paylaşılan veri kaynağını (useTickerDirectory) kullanıyor, sadece
 * tıklayınca navigasyon yerine `onChange`/`onSelect` çağırıyor.
 *
 * Bilinçli olarak yazmayı ENGELLEMİYOR - fon kompozisyon editöründeki
 * "Nakit"/"Ters Repo" gibi gerçek bir ticker olmayan kategori etiketleri de
 * geçerli bir girdi, o yüzden bu sadece bir öneri, bir kısıtlama değil.
 */
export function TickerCombobox({
  value, onChange, onSelect, placeholder, className = "", inputClassName = "", required,
}: TickerComboboxProps) {
  const directory = useTickerDirectory()
  const [showDropdown, setShowDropdown] = useState(false)

  const results = useMemo(() => {
    const q = value.trim().toLowerCase()
    if (!q) return []
    return directory
      .filter(e => e.code.toLowerCase().includes(q) || (e.name && e.name.toLowerCase().includes(q)))
      .slice(0, 6)
  }, [value, directory])

  const select = (entry: TickerDirectoryEntry) => {
    onChange(entry.code)
    onSelect?.(entry)
    setShowDropdown(false)
  }

  return (
    <div className={`relative ${className}`}>
      <Input
        value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={() => setShowDropdown(true)}
        onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
        placeholder={placeholder}
        className={inputClassName}
        required={required}
        autoComplete="off"
      />
      {showDropdown && results.length > 0 && (
        <div className="absolute top-full mt-1 left-0 right-0 min-w-[220px] bg-popover/95 backdrop-blur-md border border-border rounded-lg shadow-[var(--elev-3)] overflow-hidden z-50 text-xs animate-pop origin-top">
          {results.map(entry => (
            <button
              key={entry.code}
              type="button"
              // onMouseDown (click değil) - Input'un onBlur'u click'ten ÖNCE
              // ateşlenip dropdown'ı kapatarak tıklamayı iptal ederdi.
              onMouseDown={e => { e.preventDefault(); select(entry) }}
              className="w-full text-left px-3 py-2 hover:bg-secondary/60 flex items-center gap-2 cursor-pointer border-b border-border/30 last:border-b-0 transition-colors press"
            >
              <TickerLogo ticker={entry.code} size={20} />
              <div className="flex flex-col min-w-0 flex-1">
                <span className="font-bold text-foreground flex items-center gap-1">
                  {entry.code}
                  {entry.isFund && (
                    <span className="text-[8px] bg-secondary text-muted-foreground border border-border px-1 rounded">FON</span>
                  )}
                </span>
                <span className="text-[10px] text-muted-foreground truncate">{entry.name}</span>
              </div>
              {entry.price != null && (
                <span className="text-[10px] bg-primary/20 text-primary px-1.5 py-0.5 rounded font-bold shrink-0">
                  ₺{entry.price.toFixed(2)}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
