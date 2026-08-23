# DurakPOS — Sistem Dokümantasyonu

> Bu belge, sistemi ilk kez devralacak bir yazılımcının (veya gelecekte
> yardım eden bir yapay zekanın) hızlıca yön bulması için yazıldı. Kod
> içindeki yorumlar "ne" yapıldığını açıklar, bu belge "neden" öyle
> yapıldığını açıklar.

## 1. Genel Mimari

Çok kiracılı (multi-tenant) bir SaaS POS sistemi. Tek bir Node.js/Express
backend, tek bir MySQL veritabanı — her işletme (`tenant`) `tenant_id` ile
ayrılıyor, ayrı ayrı veritabanı/sunucu YOK.

```
Tarayıcı/Masaüstü Uygulaması
        │
        ▼
Hostinger Node.js (Express) — hbuilds/current/nodejs/
        │
        ▼
MySQL (Hostinger) ── Cloudflare R2 (görseller) ── Anthropic API (AI Asistan) ── Gemini API (görsel üretme)
```

### Arayüzler (hepsi `public/` altında, tek dosyalık HTML+JS)
| Dosya | Adres | Kim kullanır |
|---|---|---|
| `kasa.html` | `/kasa` | Kasiyer — satış, ödeme, yazdırma |
| `panel.html` | `/panel` | İşletme sahibi — menü, raporlar, ayarlar |
| `admin.html` | `/admin` | Süper admin (Coşkun) — tüm işletmeleri yönetir |
| `patron.html` | `/patron` | İşletme sahibi — mobil anlık takip |
| `ekran.html` | `/ekran/:slug` | Müşteri ekranı — slayt + canlı sepet |
| `qr.html` | `/qr/:slug` | Müşteri — QR menü, sipariş |
| `asistan.html` | `/asistan` | Bağımsız AI Asistan sohbeti |
| `gorevler.html` | `/gorevler` | Personel — günlük görev takibi (fotoğraflı) |

### Masaüstü Uygulaması (ayrı repo: `durakpos-isletmeuygulama`)
Electron ile sarmalanmış `kasa.html`. **Uzaktan `durakpos.com/kasa`'yı yükler**
(gömülü kopya sadece internet yoksa yedek). Yani backend'de kasa.html
değiştiğinde, masaüstü programını yeniden derlemeye GENELDE gerek yok —
program zaten güncel sayfayı çekiyor. İkinci monitör algılama, sessiz
yazdırma gibi native özellikler için ayrıca derlenip **GitHub Desktop ile
`desktop-updates/` klasörüne push edilerek** dağıtılıyor (bkz. §5).

## 2. Ortam Değişkenleri (Hostinger → Environment Variables)

| İsim | Ne için | Nereden alınır |
|---|---|---|
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | MySQL bağlantısı | Hostinger phpMyAdmin |
| `JWT_SECRET` | Giriş token'ları | Kendiniz belirlersiniz, rastgele uzun bir metin |
| `ANTHROPIC_API_KEY` | AI Asistan (metin) | console.anthropic.com |
| `GEMINI_API_KEY` | AI görsel üretme | aistudio.google.com (faturalandırma AÇIK olmalı, ücretsiz katmanda görsel üretme çalışmıyor) |
| `R2_ENDPOINT` | Görsel depolama | Cloudflare R2 → bucket → Settings |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | R2 kimlik bilgisi | Cloudflare R2 → Manage API Tokens |
| `R2_PUBLIC_URL` | Görsellerin genel adresi | **Kendi alan adınız olmalı (örn. img.durakpos.com), r2.dev KULLANMAYIN** — bkz. §6 |
| `R2_BUCKET_NAME` | Bucket adı | `durakpos-images` |

**Önemli:** Bir ortam değişkeni eklediğinizde/değiştirdiğinizde, uygulamayı
**Restart** etmeniz gerekir — sadece Redeploy yetmez, env değişkenleri
ancak süreç yeniden başlayınca okunur.

## 3. Veritabanı — Otomatik Migration

`schema.sql` dosyasındaki her `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE
... ADD COLUMN IF NOT EXISTS` satırı, **sunucu her açıldığında
(`runMigrations.js` aracılığıyla) otomatik çalıştırılıyor.** Yani:

- **phpMyAdmin'de elle SQL çalıştırmaya artık gerek yok.**
- Yeni bir sütun/tablo eklemek için: `schema.sql`'in SONUNA yeni bir
  `ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...;` satırı ekleyin, kodu
  deploy edin — sunucu açılışta kendisi uygular.
- **Tek istisna:** `INSERT INTO` satırları (ilk kurulum verisi) migration
  sırasında BİLİNÇLİ olarak atlanıyor — tekrar çalışırsa mükerrer kayıt
  oluştururdu.
- **Yorum satırı yazarken dikkat:** `-- açıklama` satırının İÇİNDE
  noktalı virgül (`;`) KULLANMAYIN — SQL ayrıştırıcısını yanlış yerden
  böler. Onun yerine tire (`—`) kullanın.

## 4. Görsel Depolama (Cloudflare R2)

Resimler **veritabanında değil, R2'de** tutuluyor. Sebepleri:
1. Hostinger her Redeploy'da dosya sistemini sıfırlıyor — diske kaydetmek
   kalıcı değil.
2. Veritabanında (BLOB) tutmak, 1000+ işletme ölçeğinde MySQL'i ve
   bağlantı havuzunu (`connectionLimit: 10`) gereksiz yorar.
3. R2'nin trafiği (resmi gösterme) **hiç ücretlendirilmiyor** — sadece
   depolama (10GB'a kadar ücretsiz) sayılıyor.

`imageStorage.js` içindeki `saveBase64ImageIfNeeded()`, her ürün
kaydedildiğinde `data:image/...;base64,...` formatındaki resmi otomatik
R2'ye yükler, gerçek bir dosya URL'i döner. Panel açıldığında
(`GET /menu/products`) eski formatta kalmış resimler de **kendiliğinden**
(kullanıcı hiçbir şey yapmadan) R2'ye taşınır.

**KRİTİK — asla `pub-xxx.r2.dev` genel adresini kullanmayın.** Bu adres
Cloudflare'in kendi dokümantasyonunda "sadece geliştirme testi için"
olarak işaretli; birçok ülkede ISS'ler ve antivirüs yazılımları bu adres
kalıbını (phishing saldırılarında sık kullanıldığı için) engelliyor.
`R2_PUBLIC_URL` MUTLAKA kendi alan adınıza (Cloudflare Custom Domain ile)
bağlı olmalı.

## 5. Masaüstü Uygulaması Dağıtımı

**GitHub Releases KULLANMAYIN** — büyük `.exe` dosyaları GitHub'ın "Attach
binaries" arayüzünde tekrar tekrar takılma sorunu yaşadı (sebebi tam
netleştirilemedi). Bunun yerine:

1. `electron-builder` ile derle → `.exe`, `.exe.blockmap`, `latest.yml`
2. Bu 3 dosyayı **GitHub Desktop** ile `durakpos-isletmeuygulama` reposunun
   `desktop-updates/` klasörüne push et (düz git commit+push, Release değil)
3. `package.json`'daki `publish` ayarı `generic` provider ile
   `raw.githubusercontent.com/.../desktop-updates/` adresini gösteriyor —
   electron-updater dosyaları oradan okuyor, GitHub Release API'sine hiç
   uğramıyor.
4. Program her açılışta önbelleği temizleyip `durakpos.com/kasa`'yı
   sıfırdan çekiyor (`session.clearCache()`) — kod tarafındaki değişiklikler
   için genelde yeniden derlemeye bile gerek yok.

## 6. Bilinen Tuhaflıklar / Ders Çıkarılan Olaylar

- **Yazıcı zaman aşımı:** Electron'un `webContents.print()` geri çağrısı,
  yazıcı donanım sorunu olduğunda HİÇ tetiklenmeyebiliyor. `main.js`'de
  8 saniyelik bir `Promise.race` zaman aşımı var — yoksa ödeme ekranı
  sonsuza kadar "yükleniyor"da kalır.
- **Fiş kağıt boyutu:** Electron'un `print()` çağrısına `pageSize`
  belirtilmezse, Windows varsayılan (geniş) bir sayfa varsayıp termal
  fişi kırpabiliyor. 80mm için `pageSize: {width:80000, height:297000}`
  (mikron) veriliyor.
- **R2 + AWS SDK:** `forcePathStyle: true` ayarı olmadan bazı istekler
  sessizce başarısız olabiliyor (S3Client konfigürasyonunda gerekli).
- **Saat dilimi:** Sunucu UTC çalışıyor olabilir, işletmeler Türkiye
  saatinde (UTC+3). "Bugün" hesaplayan her yer (Patron uygulaması, Kasa
  Kapanışı) `opening_time`/`closing_time` (tenants tablosu) üzerinden,
  UTC değil işletme saatine göre hesaplanmalı.

## 7. Bilinen Eksikler (henüz yapılmadı)

- Otomatik test yok (`node --check` sadece söz dizimi hatasını yakalar,
  mantık hatasını yakalamaz)
- Ayrı bir test/staging ortamı yok — her değişiklik doğrudan canlıya gider
- İzleme/uyarı sistemi yok (öneri: ücretsiz UptimeRobot ile
  `/api/health` uç noktasını izlemek)
- Yedekleme stratejisi belirlenmedi
- iyzico ödeme entegrasyonu gerçek değil, yer tutucu
- KVKK/gizlilik politikası/kullanım şartları hiç yazılmadı
- POS terminal (Ingenico) entegrasyonu GMP3 dokümantasyonu bekleniyor
