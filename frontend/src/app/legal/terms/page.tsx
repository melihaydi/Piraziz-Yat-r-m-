import LegalPageShell from "@/components/legal/LegalPageShell"

export const metadata = { title: "Kullanım Koşulları - Piraziz Yatırım" }

export default function TermsPage() {
  return (
    <LegalPageShell title="Kullanım Koşulları" updatedAt="10 Ağustos 2026">
      <h2>1. Taraflar ve Kapsam</h2>
      <p>
        Bu Kullanım Koşulları ("Koşullar"), Piraziz Yatırım ("Platform", "Uygulama", "Biz") tarafından
        sunulan web, masaüstü ve mobil uygulamaların kullanımına ilişkin şartları düzenler. Uygulamayı
        kullanarak bu Koşulları kabul etmiş sayılırsınız.
      </p>

      <h2>2. Hizmetin Niteliği - Simülasyon Uyarısı</h2>
      <p>
        Piraziz Yatırım, <strong>gerçek para ve gerçek borsa emri içermeyen, tamamen simüle edilmiş bir
        kağıt üzerinde alım-satım (paper trading) ve piyasa takip platformudur.</strong> Uygulama
        üzerinden verilen emirler Borsa İstanbul'a veya herhangi bir gerçek işlem platformuna
        iletilmez, gerçek para transferi yapılmaz, gerçek menkul kıymet mülkiyeti oluşmaz. Uygulama
        bir yatırım kuruluşu, aracı kurum veya portföy yönetim şirketi değildir ve Sermaye Piyasası
        Kurulu ("SPK") tarafından yetkilendirilmiş bir yatırım hizmeti sunmamaktadır.
      </p>

      <h2>3. Hesap Oluşturma ve Yaş Şartı</h2>
      <ul>
        <li>Platformu kullanabilmek için 18 yaşını doldurmuş ve fiil ehliyetine sahip olmanız gerekir.</li>
        <li>Kayıt sırasında verdiğiniz bilgilerin doğru ve güncel olmasından siz sorumlusunuz.</li>
        <li>Hesap güvenliğinizden (şifre, iki faktörlü doğrulama) siz sorumlusunuz.</li>
        <li>Bir hesabı yalnızca kendiniz için oluşturabilirsiniz; başkası adına hesap açamazsınız.</li>
      </ul>

      <h2>4. Yatırım Tavsiyesi Değildir</h2>
      <p>
        Platformdaki tüm analizler, sinyaller, skorlar, yapay zekâ destekli değerlendirmeler ve
        istatistikler yalnızca bilgilendirme ve eğitim amaçlıdır; <strong>yatırım tavsiyesi, teşviki
        veya yönlendirmesi niteliği taşımaz.</strong> Detaylı bilgi için Risk Bildirim Formu'na bakınız.
      </p>

      <h2>5. Yasaklı Kullanımlar</h2>
      <ul>
        <li>Platformu otomatik botlarla/scraping ile aşırı yüklemek,</li>
        <li>Başka bir kullanıcının hesabına yetkisiz erişmeye çalışmak,</li>
        <li>Platform üzerinden elde edilen verileri ticari amaçla yeniden satmak,</li>
        <li>Uygulamanın güvenlik mekanizmalarını aşmaya çalışmak</li>
      </ul>
      <p>kesinlikle yasaktır ve hesabın askıya alınmasına/kapatılmasına yol açabilir.</p>

      <h2>6. Fikri Mülkiyet</h2>
      <p>
        Platformdaki tüm yazılım, tasarım, logo ve içerik Piraziz Yatırım'a veya ilgili lisans
        sahiplerine aittir. İzinsiz kopyalanamaz, dağıtılamaz.
      </p>

      <h2>7. Sorumluluğun Sınırlandırılması</h2>
      <p>
        Platform "olduğu gibi" sunulmaktadır. Piyasa verilerindeki gecikme/hata, sistem kesintileri
        veya üçüncü taraf veri sağlayıcılarından kaynaklanan sorunlardan doğabilecek zararlardan
        Piraziz Yatırım sorumlu tutulamaz.
      </p>

      <h2>8. Hesap Sonlandırma</h2>
      <p>
        Hesabınızı Ayarlar sayfasından dilediğiniz zaman kapatabilirsiniz. Bu Koşulların ihlali
        durumunda hesabınızı askıya alma/sonlandırma hakkımız saklıdır.
      </p>

      <h2>9. Mücbir Sebep</h2>
      <p>
        Doğal afet, savaş, siber saldırı, üçüncü taraf veri sağlayıcılarının (TradingView, TEFAS, KAP
        vb.) kesintisi, altyapı sağlayıcılarında yaşanan kesinti veya makul kontrolümüz dışındaki
        benzer olaylar nedeniyle hizmetin geçici olarak sunulamamasından sorumlu tutulamayız.
      </p>

      <h2>10. Bölünebilirlik</h2>
      <p>
        Bu Koşulların herhangi bir hükmünün yetkili bir mahkeme tarafından geçersiz veya uygulanamaz
        bulunması, kalan hükümlerin geçerliliğini etkilemez.
      </p>

      <h2>11. Uygulanacak Hukuk ve Yetkili Mahkeme</h2>
      <p>
        Bu Koşullar Türkiye Cumhuriyeti kanunlarına tabidir. Bu Koşullardan doğabilecek uyuşmazlıklarda
        İstanbul (Merkez) Mahkemeleri ve İcra Daireleri yetkilidir.
      </p>

      <h2>12. Değişiklikler</h2>
      <p>
        Bu Koşullar zaman zaman güncellenebilir. Önemli değişiklikler uygulama içinden duyurulur.
      </p>

      <h2>13. İletişim</h2>
      <p>Sorularınız için Ayarlar &gt; Yardım &amp; Destek üzerinden bize ulaşabilirsiniz.</p>
    </LegalPageShell>
  )
}
