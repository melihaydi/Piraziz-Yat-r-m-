/**
 * Company logos. Two sources, checked in order:
 *
 * 1. Self-hosted files in public/logos/{TICKER}.png - real logo images the
 *    user supplied directly for tickers Google's favicon service didn't
 *    cover well (smaller/less mainstream BIST names). Self-hosting these
 *    means zero external-network dependency for the ones we have on file.
 * 2. Google's public favicon service
 *    (https://www.google.com/s2/favicons?domain={domain}), a free, no-auth
 *    service backed by Google's own infrastructure that serves a site's real
 *    favicon. (Clearbit's free logo API - the more common choice for this -
 *    was tried first but no longer resolves at all as of this writing; this
 *    was verified by actually downloading and visually checking several of
 *    these before shipping, e.g. akbank.com correctly returns Akbank's red
 *    "A" mark.) There's no ticker->logo API for BIST specifically, so this
 *    maps each ticker to its listed company's real corporate domain.
 *
 * Deliberately conservative: only tickers with a locally-supplied file or a
 * confidently-known domain are listed. A wrong domain would show a real but
 * WRONG company's logo, which is worse than no logo at all - so if a ticker
 * isn't listed in either source, TickerLogo just renders nothing and
 * callers fall back to their existing ticker-code badge.
 */

// Tickers with a real logo file at public/logos/{TICKER}.png, supplied
// directly by the user on 2026-07-28 (extracted from the chat transcript's
// pasted images, verified visually against the real companies before use).
export const LOCAL_LOGO_TICKERS = new Set([
  "OYAKC", "FROTO", "PGSUS", "SAHOL", "TOASO", "KTLEV", "EREGL", "PASEU",
  "KCHOL", "ASTOR", "HEDEF", "HEKTS", "KONTR", "SASA", "ODINE", "GUNDG", "BALSU",
])
export const TICKER_LOGO_DOMAINS: Record<string, string> = {
  AKBNK: "akbank.com",
  ALARK: "alarko.com.tr",
  ASELS: "aselsan.com.tr",
  ASTOR: "astorenerji.com",
  BIMAS: "bim.com.tr",
  EKGYO: "emlakkonut.com.tr",
  ENKAI: "enka.com",
  EREGL: "erdemir.com.tr",
  FROTO: "fordotosan.com.tr",
  GARAN: "garantibbva.com.tr",
  HEKTS: "hektas.com.tr",
  IEYHO: "isiklarenerjiyapiholding.com.tr",
  ISCTR: "isbank.com.tr",
  KCHOL: "koc.com.tr",
  KOZAL: "kozaaltin.com.tr",
  MGROS: "migros.com.tr",
  ODAS: "odas.com.tr",
  OYAKC: "oyakcimento.com",
  PETKM: "petkim.com.tr",
  PGSUS: "flypgs.com",
  SAHOL: "sabanci.com",
  SASA: "sasa.com.tr",
  SISE: "sisecam.com.tr",
  TAVHL: "tavhavalimanlari.com.tr",
  TCELL: "turkcell.com.tr",
  THYAO: "turkishairlines.com",
  TOASO: "tofas.com.tr",
  TUPRS: "tupras.com.tr",
  YKBNK: "yapikredi.com.tr",
  TTKOM: "turktelekom.com.tr",
  // Added 2026-08-04 for the fund-holding tickers introduced this session -
  // each domain verified via web search before adding (same "wrong domain
  // is worse than no logo" bar as above). OZATD and ISKPL deliberately
  // left out: no confidently-identifiable official domain was found for
  // OZATD, and ISKPL has two distinct real companies of a near-identical
  // name with different domains - guessing either risks the wrong logo.
  TEHOL: "terayatirimteknoloji.com.tr",
  ANELE: "anelgroup.com",
  SELEC: "selcukecza.com.tr",
  PEKGY: "pekergyo.com",
  DSTKF: "destekfaktoring.com",
  ALKLC: "altinkilic.com",
  EUPWR: "europowerenerji.com.tr",
  TRHOL: "terafinansalyatirimlar.com",
  GESAN: "girisimelk.com.tr",
  TURSG: "turkiyesigorta.com.tr",
  TRALT: "turkaltinisletmeleri.com",
  TATEN: "tatlipinarenerji.com.tr",
  SKBNK: "sekerbank.com.tr",
  DAPGM: "dapgayrimenkulgelistirme.com.tr",
  BRSAN: "borusanmannesmann.com",
  MPARK: "medicalpark.com.tr",
  DCTTR: "dcttrading.com.tr",
  IZFAS: "izmirfirca.com.tr",
  ANSGR: "anadolusigorta.com.tr",
  BETAE: "betaenerji.com",
  MOPAS: "mopas.com.tr",
  AKSEN: "aksaenerji.com.tr",
  KORDS: "kordsa.com",
  SVGYO: "savurgyo.com.tr",
  MANAS: "manas.com.tr",
  TMPOL: "temapol.com.tr",
  LIDER: "liderfilo.com.tr",
}

export function logoUrlFor(ticker: string, size: number = 64): string | null {
  const t = ticker.toUpperCase()
  if (LOCAL_LOGO_TICKERS.has(t)) return `/logos/${t}.png`
  const domain = TICKER_LOGO_DOMAINS[t]
  if (!domain) return null
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=${size}`
}
