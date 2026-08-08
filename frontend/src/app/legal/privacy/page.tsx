import LegalPageShell from "@/components/legal/LegalPageShell"

export const metadata = { title: "Gizlilik Politikası ve KVKK Aydınlatma Metni - Piraziz Yatırım" }

export default function PrivacyPage() {
  return (
    <LegalPageShell title="Gizlilik Politikası ve KVKK Aydınlatma Metni" updatedAt="8 Ağustos 2026">
      <p>
        Bu metin, 6698 sayılı Kişisel Verilerin Korunması Kanunu ("KVKK") uyarınca, veri sorumlusu
        sıfatıyla Piraziz Yatırım tarafından işlenen kişisel verileriniz hakkında sizi bilgilendirmek
        amacıyla hazırlanmıştır.
      </p>

      <h2>1. İşlenen Kişisel Veriler</h2>
      <ul>
        <li><strong>Kimlik ve iletişim verileri:</strong> ad soyad, e-posta adresi</li>
        <li><strong>Hesap güvenliği verileri:</strong> şifre (geri döndürülemez şekilde hash'lenmiş
          olarak saklanır), iki faktörlü doğrulama durumu, oturum/IP kayıtları</li>
        <li><strong>Kullanım verileri:</strong> platform içinde oluşturduğunuz simüle portföyler,
          notlar, alarmlar, işlem geçmişi</li>
        <li><strong>Teknik veriler:</strong> tarayıcı/cihaz bilgisi, IP adresi (güvenlik amacıyla,
          audit log kapsamında)</li>
      </ul>

      <h2>2. İşleme Amaçları</h2>
      <ul>
        <li>Hesabınızı oluşturmak, giriş yapmanızı sağlamak ve güvenliğini korumak,</li>
        <li>Talep ettiğiniz platform özelliklerini (portföy takibi, alarm, strateji taraması vb.)
          sunmak,</li>
        <li>Şüpheli/yetkisiz erişimi tespit etmek ve önlemek (audit log),</li>
        <li>Yasal yükümlülüklerimizi yerine getirmek,</li>
        <li>Talep etmeniz halinde destek sağlamak.</li>
      </ul>

      <h2>3. Hukuki Sebep</h2>
      <p>
        Kişisel verileriniz, KVKK m.5/2 kapsamında bir sözleşmenin kurulması/ifası (hesabınızın
        çalışması için gerekli olması) ve meşru menfaat (güvenlik/audit) hukuki sebeplerine dayanılarak
        işlenmektedir.
      </p>

      <h2>4. Verilerin Aktarılması</h2>
      <p>
        Verileriniz, hizmetin sunulabilmesi için gerekli olan sunucu barındırma altyapısı dışında
        üçüncü taraflarla <strong>paylaşılmaz, satılmaz.</strong> Kanunen yetkili kamu kurumlarının
        talebi halinde, yalnızca yasal zorunluluk çerçevesinde paylaşım yapılabilir.
      </p>

      <h2>5. Saklama Süresi</h2>
      <p>
        Verileriniz, hesabınız aktif olduğu sürece ve hesap kapatıldıktan sonra yasal saklama
        yükümlülüklerimizin gerektirdiği süre boyunca saklanır.
      </p>

      <h2>6. KVKK Madde 11 Kapsamındaki Haklarınız</h2>
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

      <h2>7. Çerezler</h2>
      <p>
        Platform, oturumunuzu sürdürmek için yalnızca zorunlu teknik verileri (giriş token'ı) tarayıcı
        yerel deposunda tutar; reklam/izleme amaçlı üçüncü taraf çerezi kullanılmamaktadır.
      </p>

      <h2>8. Veri Güvenliği</h2>
      <p>
        Şifreleriniz bcrypt ile geri döndürülemez şekilde saklanır, oturumlarınız JWT ile korunur,
        isteğe bağlı iki faktörlü doğrulama (2FA) sunulur, ve tüm önemli hesap işlemleri denetim
        kaydına (audit log) alınır.
      </p>
    </LegalPageShell>
  )
}
