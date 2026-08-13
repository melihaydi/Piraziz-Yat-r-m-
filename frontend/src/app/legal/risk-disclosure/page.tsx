import LegalPageShell from "@/components/legal/LegalPageShell"

export const metadata = { title: "Yatırım Risk Bildirim Formu - BIP Terminal" }

export default function RiskDisclosurePage() {
  return (
    <LegalPageShell title="Yatırım Risk Bildirim Formu" updatedAt="8 Ağustos 2026">
      <p>
        Bu Risk Bildirim Formu, BIP Terminal platformunun sunduğu piyasa verileri, analizler ve
        simüle işlem araçlarını kullanmadan önce okumanız gereken önemli bilgileri içerir.
      </p>

      <h2>1. Bu Bir Simülasyondur, Yatırım Tavsiyesi Değildir</h2>
      <p>
        Platform üzerindeki "alım-satım terminali" tamamen <strong>simüle edilmiş (kağıt üzerinde,
        paper trading)</strong> bir ortamdır. Gerçek para, gerçek borsa emri veya gerçek menkul kıymet
        mülkiyeti söz konusu değildir. Simülasyon ortamındaki performans, gerçek piyasa koşullarında
        elde edilebilecek sonuçları garanti etmez veya temsil etmez.
      </p>

      <h2>2. Analizler ve Sinyaller Tavsiye Değildir</h2>
      <p>
        Platformdaki hisse/fon skorları, teknik analiz sinyalleri ("Frantic Algoritmik Strateji" dahil),
        yapay zekâ destekli KAP/haber analizleri ve benzer tüm içerikler <strong>algoritmik/istatistiksel
        hesaplamalara dayanır ve hiçbir şekilde yatırım tavsiyesi, yönlendirmesi veya taahhüdü
        oluşturmaz.</strong> Sermaye Piyasası Kurulu düzenlemeleri uyarınca, yatırım tavsiyesi
        yalnızca yetkili yatırım kuruluşları tarafından, kişiye özel olarak sunulabilir.
      </p>

      <h2>3. Piyasa Riski</h2>
      <p>
        Gerçek dünyada sermaye piyasalarında işlem yapmak; fiyat dalgalanması, likidite riski, faiz
        oranı riski, kur riski ve ihraççıya özgü riskler dahil olmak üzere önemli kayıp riskleri
        taşır. Geçmiş performans gelecekteki sonuçların garantisi değildir.
      </p>

      <h2>4. Veri Gecikmesi ve Doğruluğu</h2>
      <p>
        Platformdaki fiyat/veri akışları üçüncü taraf sağlayıcılardan (TradingView, TEFAS, KAP vb.)
        alınmaktadır. Borsa seans saatleri dışında veya teknik aksaklıklarda veriler gecikmeli,
        eksik veya güncel olmayabilir. Kritik kararlar için verinin resmi kaynaktan teyit edilmesi
        önerilir.
      </p>

      <h2>5. Kendi Sorumluluğunuz</h2>
      <p>
        Gerçek hayatta herhangi bir yatırım kararı almadan önce, kendi mali durumunuzu, risk
        toleransınızı değerlendirmeli ve gerekirse SPK lisanslı, bağımsız bir yatırım danışmanına
        başvurmalısınız. BIP Terminal, platform kullanımından kaynaklanan hiçbir gerçek finansal
        karar veya sonuçtan sorumlu tutulamaz.
      </p>
    </LegalPageShell>
  )
}
