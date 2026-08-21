/**
 * Karşılaştırma grafiklerinin seri renkleri.
 *
 * Kasıtlı olarak recharts'a HİÇ dokunmayan ayrı bir modülde: hem /funds hem
 * /screener bu paleti grafiğin dışında da kullanıyor (alttaki istatistik
 * tablosundaki renk noktaları). Palet grafik bileşeninin içinde dursaydı, o
 * noktaları çizmek için sayfanın grafik modülünü import etmesi gerekirdi ve
 * recharts tembel yüklemenin bütün faydası kaybolurdu - 324 KB'lık parça
 * yeniden ilk yüke girerdi.
 *
 * Aynı dizi daha önce iki sayfada ayrı ayrı tanımlıydı.
 */
export const COMPARE_COLORS = ["#a855f7", "#06b6d4", "#10b981", "#fbbf24", "#ec4899"]
