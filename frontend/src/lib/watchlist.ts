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
 * Bu modül tek doğruluk kaynağını sunucu yapar. Fon favorileri (`favorites_funds`)
 * bilinçli olarak kapsam dışı: onlar her yerde tutarlı biçimde localStorage
 * kullanıyor, yani orada bölünme yok.
 */

/** Sunucudaki izleme listesini döndürür. Hata durumunda boş liste - favori
 *  listesi ikincil bir özellik, yüklenememesi sayfayı çökertmemeli. */
export async function fetchWatchlist(): Promise<string[]> {
  try {
    const res = await authFetch("/watchlist/")
    if (!res.ok) return []
    const items = await res.json()
    if (!Array.isArray(items)) return []
    return items.map((i: { ticker?: string }) => i?.ticker).filter((t): t is string => !!t)
  } catch {
    return []
  }
}

/**
 * Bir hisseyi izleme listesine ekler veya çıkarır.
 * Çağıran taraf iyimser güncelleme yapıp `false` dönerse geri alsın diye
 * başarı durumunu döndürür (fırlatmaz).
 */
export async function setWatchlistEntry(ticker: string, add: boolean): Promise<boolean> {
  try {
    const res = await authFetch(
      add ? "/watchlist/" : `/watchlist/${ticker}`,
      add
        ? {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ticker }),
          }
        : { method: "DELETE" },
    )
    return res.ok
  } catch {
    return false
  }
}
