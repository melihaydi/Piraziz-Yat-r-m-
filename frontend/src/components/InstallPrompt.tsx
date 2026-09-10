"use client"

import React, { useEffect, useState } from "react"
import { X, Share, Plus, Download } from "lucide-react"

/**
 * "Uygulamayı yükle" ipucu.
 *
 * NEDEN GEREKLİ: uygulama PWA olarak kurulabilir durumda (manifest,
 * apple-mobile-web-app-capable, standalone) ama iOS Safari kurulum
 * ÖNERMİYOR - kullanıcının Paylaş > "Ana Ekrana Ekle" adımlarını kendisi
 * bilmesi gerekiyor. Bilmiyorsa uygulama hiç kurulmuyor; özellik teknik
 * olarak var ama pratikte kimse kullanmıyor.
 *
 * İki farklı platform, iki farklı yol:
 *  - Android/masaüstü Chrome: `beforeinstallprompt` GERÇEK bir kurulum
 *    diyaloğu açabiliyor -> tek tuş.
 *  - iOS Safari: böyle bir API YOK (Apple vermiyor) -> yalnızca adımları
 *    anlatabiliyoruz.
 *
 * Gösterilmediği durumlar:
 *  - Zaten kurulu (standalone modda açılmış)
 *  - Kullanıcı bir kez kapatmış (localStorage)
 *  - iOS ama Safari değil: Instagram/Twitter gibi uygulama-içi tarayıcılarda
 *    "Ana Ekrana Ekle" seçeneği YOK, anlatmak yanlış yönlendirme olurdu.
 */
const DISMISS_KEY = "bip_install_hint_dismissed"

export type Mode = "none" | "ios" | "prompt"

/** Kimin ne gorecegine karar veren SAF fonksiyon - test edilebilir olsun
 *  diye bilesenden ayri. "prompt" yalnizca bir ADAY: gercek kurulum
 *  diyalogu ancak tarayici `beforeinstallprompt` atarsa acilabiliyor. */
export function decideInstallMode(opts: {
  userAgent: string
  standalone: boolean
  dismissed: boolean
}): Mode {
  if (opts.dismissed) return "none"
  if (opts.standalone) return "none"          // zaten kurulu

  const ua = opts.userAgent
  if (/iphone|ipad|ipod/i.test(ua)) {
    // Uygulama-ici tarayicilarda "Ana Ekrana Ekle" YOK - anlatmak yanlis
    // yonlendirme olurdu.
    if (/(FBAN|FBAV|Instagram|Twitter|Line\/|MicroMessenger)/i.test(ua)) return "none"
    return "ios"
  }
  return "prompt"
}

export default function InstallPrompt() {
  const [mode, setMode] = useState<Mode>("none")
  const [deferred, setDeferred] = useState<any>(null)

  useEffect(() => {
    try {
      if (localStorage.getItem(DISMISS_KEY) === "1") return
    } catch {
      // Depolama kapaliysa ipucu yine gosterilir - zararsiz.
    }

    // Zaten kurulu mu? iOS kendi ozel bayragini kullaniyor, digerleri
    // display-mode medya sorgusunu.
    const nav = window.navigator as any
    const standalone =
      nav.standalone === true ||
      window.matchMedia?.("(display-mode: standalone)")?.matches === true
    if (standalone) return

    const decided = decideInstallMode({
      userAgent: navigator.userAgent,
      standalone,
      dismissed: false,   // yukarida zaten kontrol edildi
    })
    if (decided === "none") return
    if (decided === "ios") {
      setMode("ios")
      return
    }

    // "prompt": Android/masaustu Chrome. Butonu ancak tarayici gercekten
    // beforeinstallprompt atarsa gosteriyoruz - atmazsa (orn. zaten kurulu
    // ya da kriterler saglanmiyor) hicbir sey cikmiyor.
    const onPrompt = (e: Event) => {
      e.preventDefault()          // tarayicinin kendi cubugu yerine bizimki
      setDeferred(e)
      setMode("prompt")
    }
    window.addEventListener("beforeinstallprompt", onPrompt)
    return () => window.removeEventListener("beforeinstallprompt", onPrompt)
  }, [])

  const dismiss = () => {
    setMode("none")
    try { localStorage.setItem(DISMISS_KEY, "1") } catch {}
  }

  const install = async () => {
    if (!deferred) return
    deferred.prompt()
    try { await deferred.userChoice } catch {}
    dismiss()
  }

  if (mode === "none") return null

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 lg:hidden pb-[min(env(safe-area-inset-bottom),8px)]">
      <div className="mx-3 mb-16 rounded-xl border border-border bg-background/95 backdrop-blur-md shadow-[var(--elev-3)] p-3">
        <div className="flex items-start gap-3">
          <div className="h-9 w-9 rounded-lg overflow-hidden shrink-0 border border-border/50">
            <img src="/logo.png" alt="" className="h-full w-full object-cover" />
          </div>

          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-foreground leading-tight">
              BIP Terminal&apos;i telefonuna ekle
            </p>

            {mode === "ios" ? (
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                Safari&apos;de alttaki <Share className="inline h-3.5 w-3.5 -mt-0.5" /> düğmesine
                bas, sonra <span className="font-semibold text-foreground">
                <Plus className="inline h-3.5 w-3.5 -mt-0.5" /> Ana Ekrana Ekle</span> seçeneğini
                seç. Tam ekran, kendi ikonuyla açılır.
              </p>
            ) : (
              <button
                onClick={install}
                className="press mt-2 inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-bold cursor-pointer"
              >
                <Download className="h-3.5 w-3.5" /> Uygulamayı Yükle
              </button>
            )}
          </div>

          <button
            onClick={dismiss}
            aria-label="Kapat"
            className="text-muted-foreground/60 hover:text-foreground transition-colors cursor-pointer shrink-0"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
