"use client"

import { authFetch } from "./auth"

/**
 * Hisse favorileri (izleme listesi) için tek erişim noktası.
 *
 * Neden var: favoriler İKİ AYRI YERDE tutuluyordu ve biri diğerini siliyordu.
 *
 *   - /screener favorileri sunucuya taşıdı (`/watchlist/` uç noktası) ve
 *     göç bittikten sonra `localStorage.removeItem("favorites_stocks")`
 *     çağırıyor.
 *   - Ama /news, ana sayfadaki favoriler kartı ve Trade izleme listesi
 *     hâlâ o silinen localStorage anahtarını okuyordu.
 *
 * Kullanıcı açısından sonucu: /screener sayfasına bir kez uğradıktan sonra
 * ana sayfadaki "Favoriler" kartı ve haber filtresi BOŞALIYORDU - favoriler
 * sunucuda duruyor olmasına rağmen. Ters yönde de bozuktu: Trade izleme
 * listesinde yıldızlanan hisse yalnızca localStorage'a yazıldığı için
 * /screener'da hiç görünmüyordu, sonraki ziyarette göç edilip anahtar
 * siliniyordu.
 *
 * Bu modül tek doğruluk kaynağını sunucu yapar. Fon favorileri de (eskiden
 * `favorites_funds` anahtarıyla yalnızca localStorage'da tutuluyordu, bu
 * yüzden farklı bir cihaz/tarayıcıda oturum açınca kayboluyorlardı) aynı
 * `/watchlist/` uç noktasını `asset_type=fund` ile kullanır - hisse ve fon
 * kodları aynı tabloda tür ayrımıyla birlikte durur.
 */

export type WatchlistAssetType = "stock" | "fund"

/** Sunucudaki izleme listesini döndürür. Hata durumunda boş liste - favori
 *  listesi ikincil bir özellik, yüklenememesi sayfayı çökertmemeli. */
export async function fetchWatchlist(assetType: WatchlistAssetType = "stock"): Promise<string[]> {
  try {
    const res = await authFetch(`/watchlist/?asset_type=${assetType}`)
    if (!res.ok) return []
    const items = await res.json()
    if (!Array.isArray(items)) return []
    return items.map((i: { ticker?: string }) => i?.ticker).filter((t): t is string => !!t)
  } catch {
    return []
  }
}

/**
 * Bir hisseyi/fonu izleme listesine ekler veya çıkarır.
 * Çağıran taraf iyimser güncelleme yapıp `false` dönerse geri alsın diye
 * başarı durumunu döndürür (fırlatmaz).
 */
export async function setWatchlistEntry(
  ticker: string,
  add: boolean,
  assetType: WatchlistAssetType = "stock",
): Promise<boolean> {
  try {
    const res = await authFetch(
      add ? "/watchlist/" : `/watchlist/${ticker}?asset_type=${assetType}`,
      add
        ? {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ticker, asset_type: assetType }),
          }
        : { method: "DELETE" },
    )
    return res.ok
  } catch {
    return false
  }
}

/** Cihazda kalmış eski localStorage listesini (varsa) bir kerede hesaba
 *  taşır ve anahtarı temizler. Yalnızca EKLER, sunucudaki listeyi ezmez -
 *  bkz. backend'deki migrate_watchlist docstring'i. Göç başarısız olursa
 *  yerel anahtar bilerek silinmez, bir sonraki yüklemede tekrar denenir. */
export async function migrateLegacyWatchlist(
  localStorageKey: string,
  assetType: WatchlistAssetType,
): Promise<void> {
  try {
    const legacy = localStorage.getItem(localStorageKey)
    if (!legacy) return
    const tickers = JSON.parse(legacy)
    if (!Array.isArray(tickers) || tickers.length === 0) {
      localStorage.removeItem(localStorageKey)
      return
    }
    const res = await authFetch("/watchlist/migrate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tickers, asset_type: assetType }),
    })
    if (res.ok) localStorage.removeItem(localStorageKey)
  } catch {
    // Bozuk/okunamayan yerel veri göçü engellemesin - sunucudaki liste
    // yine de yüklenmeli.
  }
}
