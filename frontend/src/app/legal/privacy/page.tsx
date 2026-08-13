import LegalPageShell from "@/components/legal/LegalPageShell"

export const metadata = { title: "Gizlilik Politikası ve KVKK Aydınlatma Metni - BIP Terminal" }

export default function PrivacyPage() {
  return (
    <LegalPageShell title="Gizlilik Politikası ve KVKK Aydınlatma Metni" updatedAt="10 Ağustos 2026">
      <p>
        Bu metin, 6698 sayılı Kişisel Verilerin Korunması Kanunu ("KVKK") uyarınca, veri sorumlusu
        sıfatıyla BIP Terminal tarafından işlenen kişisel verileriniz hakkında sizi bilgilendirmek
        amacıyla hazırlanmıştır.
      </p>

      <h2>1. Veri Sorumlusunun Kimliği</h2>
      <p>
        Veri sorumlusu, BIP Terminal platformunu işleten gerçek/tüzel kişidir. <em>[Taslak notu: KVKK
        m.10 uyarınca burada veri sorumlusunun tam unvanı, açık adresi ve varsa MERSİS numarası
        belirtilmelidir - bu bilgiler, hukuki inceleme sırasında işletmenin gerçek ticari/hukuki
        statüsüne (şahıs şirketi, limited şirket vb.) göre doldurulmalıdır.]</em> Başvurularınızı
        Ayarlar &gt; Yardım &amp; Destek üzerinden iletebilirsiniz.
      </p>

      <h2>2. İşlenen Kişisel Veriler</h2>
      <ul>
        <li><strong>Kimlik ve iletişim verileri:</strong> ad soyad, e-posta adresi</li>
        <li><strong>Hesap güvenliği verileri:</strong> şifre (geri döndürülemez şekilde hash'lenmiş
          olarak saklanır), iki faktörlü doğrulama durumu, oturum/IP kayıtları</li>
        <li><strong>Kullanım verileri:</strong> platform içinde oluşturduğunuz simüle portföyler,
          notlar, alarmlar, işlem geçmişi</li>
        <li><strong>Teknik veriler:</strong> tarayıcı/cihaz bilgisi, IP adresi (güvenlik amacıyla,
          audit log kapsamında)</li>
      </ul>

      <h2>3. İşleme Amaçları</h2>
      <ul>
        <li>Hesabınızı oluşturmak, giriş yapmanızı sağlamak ve güvenliğini korumak,</li>
        <li>Talep ettiğiniz platform özelliklerini (portföy takibi, alarm, strateji taraması vb.)
          sunmak,</li>
        <li>Şüpheli/yetkisiz erişimi tespit etmek ve önlemek (audit log),</li>
        <li>Yasal yükümlülüklerimizi yerine getirmek,</li>
        <li>Talep etmeniz halinde destek sağlamak.</li>
      </ul>

      <h2>4. Hukuki Sebep</h2>
      <p>
        Kişisel verileriniz, KVKK m.5/2 kapsamında bir sözleşmenin kurulması/ifası (hesabınızın
        çalışması için gerekli olması) ve meşru menfaat (güvenlik/audit) hukuki sebeplerine dayanılarak
        işlenmektedir.
      </p>

      <h2>5. Verilerin Aktarılması</h2>
      <p>
        Verileriniz, hizmetin sunulabilmesi için gerekli olan sunucu barındırma altyapısı dışında
        üçüncü taraflarla <strong>paylaşılmaz, satılmaz.</strong> Kanunen yetkili kamu kurumlarının
        talebi halinde, yalnızca yasal zorunluluk çerçevesinde paylaşım yapılabilir.
      </p>

      <h2>6. Saklama Süresi</h2>
      <p>
        Verileriniz, hesabınız aktif olduğu sürece ve hesap kapatıldıktan sonra yasal saklama
        yükümlülüklerimizin gerektirdiği süre boyunca saklanır.
      </p>

      <h2>7. KVKK Madde 11 Kapsamındaki Haklarınız</h2>
      <p>KVKK'nın 11. maddesi uyarınca şu haklara sahipsiniz:</p>
      <ul>
        <li>Kişisel verilerinizin işlenip işlenmediğini öğrenme,</li>
        <li>İşlenmişse buna ilişkin bilgi talep etme,</li>
        <li>İşlenme amacını ve amacına uygun kullanılıp kullanılmadığını öğrenme,</li>
        <li>Yurt içinde/dışında aktarıldığı üçüncü kişileri bilme,</li>
        <li>Eksik/yanlış işlenmişse düzeltilmesini isteme,</li>
        <li>Silinmesini/yok edilmesini isteme,</li>
        <li>İşlenen verilerin analiz edilmesi suretiyle aleyhinize bir sonucun ortaya çıkmasına
          itiraz etme,</li>
        <li>Kanuna aykırı işlenme nedeniyle uğradığınız zararın giderilmesini talep etme.</li>
      </ul>
      <p>
        Bu haklardan "verilerimi indir" ve "hesabımı sil" taleplerinizi doğrudan Ayarlar &gt; Gizlilik
        ve Veri bölümünden kendiniz gerçekleştirebilirsiniz. Diğer talepleriniz için Ayarlar &gt;
        Yardım &amp; Destek üzerinden bize ulaşabilirsiniz.
      </p>

      <h2>8. Çerezler</h2>
      <p>
        Platform, oturumunuzu sürdürmek için yalnızca zorunlu teknik verileri (giriş token'ı) tarayıcı
        yerel deposunda tutar; reklam/izleme amaçlı üçüncü taraf çerezi kullanılmamaktadır.
      </p>

      <h2>9. Veri Güvenliği</h2>
      <p>
        Şifreleriniz bcrypt ile geri döndürülemez şekilde saklanır, oturumlarınız JWT ile korunur,
        isteğe bağlı iki faktörlü doğrulama (2FA) sunulur, ve tüm önemli hesap işlemleri denetim
        kaydına (audit log) alınır.
      </p>

      <h2>10. Şikayet Hakkı</h2>
      <p>
        KVKK m.11 kapsamındaki talebinizi öncelikle bize iletmenizi rica ederiz. Talebinizin
        reddedilmesi, yetersiz bulunması veya süresinde cevap verilmemesi hâlinde, cevabın öğrenildiği
        tarihten itibaren 30 gün ve her hâlde başvuru tarihinden itibaren 60 gün içinde Kişisel
        Verileri Koruma Kurulu'na şikâyette bulunma hakkınız saklıdır.
      </p>
    </LegalPageShell>
  )
}
