/**
 * "Yönetilen Portföyler" hızlı erişim listesi - hem admin sayfası hem de
 * Sidebar bunu okur.
 *
 * Neden isim de saklanıyor: Sidebar'ın sabitlenmiş kişileri gösterebilmesi
 * için ada ihtiyacı var, ama adlar /admin/users'tan geliyor. İsmi burada
 * tutmak, Sidebar'ın HER sayfa açılışında admin listesini çekmesini
 * gereksiz kılıyor - kenar çubuğu için tek bir localStorage okuması yetiyor.
 *
 * Geriye dönük uyumluluk: bu anahtar eskiden düz bir `number[]` (yalnızca
 * id) tutuyordu. Eski biçim okunurken isimsiz kayda çevriliyor; admin
 * sayfası kullanıcı listesini yükleyince isimleri geri yazıyor.
 */
export interface PinnedManagedUser {
  id: number
  name: string
}

export const PINNED_USERS_KEY = "bip_managed_portfolio_pinned_users"

/** Sabitlenenler değiştiğinde Sidebar'ın anında güncellenmesi için -
 *  uygulamanın başka yerinde kullanılan "profile-updated" ile aynı desen. */
export const PINNED_MANAGED_USERS_EVENT = "pinned-managed-users-changed"

export function readPinnedManagedUsers(): PinnedManagedUser[] {
  try {
    const raw = localStorage.getItem(PINNED_USERS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((entry: unknown): PinnedManagedUser | null => {
        // Eski biçim: düz id listesi
        if (typeof entry === "number") return { id: entry, name: "" }
        if (entry && typeof entry === "object") {
          const e = entry as { id?: unknown; name?: unknown }
          if (typeof e.id === "number") {
            return { id: e.id, name: typeof e.name === "string" ? e.name : "" }
          }
        }
        return null
      })
      .filter((u): u is PinnedManagedUser => u !== null)
  } catch {
    // Depolama kapalı/bozuk - hızlı erişim listesi boş görünür, başka
    // hiçbir şey bozulmaz.
    return []
  }
}

export function writePinnedManagedUsers(list: PinnedManagedUser[]): void {
  try {
    localStorage.setItem(PINNED_USERS_KEY, JSON.stringify(list))
  } catch {
    // Kalıcı olmayacak ama ekrandaki değişiklik yine de çalışır.
  }
  try {
    window.dispatchEvent(new Event(PINNED_MANAGED_USERS_EVENT))
  } catch {
    // SSR/olay desteklenmiyorsa sessizce geç.
  }
}

/** Sabitlenmiş bir kişinin portföyünü doğrudan açan bağlantı. */
export function managedPortfolioHref(userId: number): string {
  return `/admin/managed-portfolios?user=${userId}`
}
