/**
 * Company logos via Google's public favicon service
 * (https://www.google.com/s2/favicons?domain={domain}), a free, no-auth
 * service backed by Google's own infrastructure that serves a site's real
 * favicon. (Clearbit's free logo API - the more common choice for this -
 * was tried first but no longer resolves at all as of this writing; this
 * was verified by actually downloading and visually checking several
 * of these before shipping, e.g. akbank.com correctly returns Akbank's
 * red "A" mark, turkishairlines.com the THY logo.) There's no ticker->logo
 * API for BIST specifically, so this maps each ticker to its listed
 * company's real corporate domain.
 *
 * Deliberately conservative: only tickers whose domain is confidently known
 * are listed here. A wrong domain would show a real but WRONG company's
 * logo (Clearbit doesn't validate the mapping), which is worse than no logo
 * at all - so if a ticker isn't listed, TickerLogo just renders nothing and
 * callers fall back to their existing ticker-code badge, rather than
 * guessing at a domain.
 */
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
}

export function logoUrlFor(ticker: string, size: number = 64): string | null {
  const domain = TICKER_LOGO_DOMAINS[ticker.toUpperCase()]
  if (!domain) return null
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=${size}`
}
