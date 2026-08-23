-- ============================================================
-- Durak POS — Çok Şubeli SaaS Veritabanı Şeması (MySQL)
-- Her tablo tenant_id (şube kimliği) taşır, veriler bu şekilde izole edilir.
-- ============================================================

CREATE TABLE IF NOT EXISTS tenants (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  slug VARCHAR(60) NOT NULL UNIQUE,          -- şube kodu, örn: "brokers-coffee"
  currency VARCHAR(5) DEFAULT '₺',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  name VARCHAR(120) NOT NULL,
  role ENUM('owner','manager','staff') DEFAULT 'staff',
  pin VARCHAR(10),                            -- kasa PIN girişi için
  email VARCHAR(160),                         -- panel/patron girişi için (opsiyonel)
  password_hash VARCHAR(255),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  INDEX idx_users_tenant (tenant_id)
);

CREATE TABLE IF NOT EXISTS categories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  group_name VARCHAR(80) NOT NULL,            -- üst kategori (İçecekler, Yiyecekler)
  name VARCHAR(80) NOT NULL,                  -- alt kategori (Sıcak Kahveler)
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  INDEX idx_categories_tenant (tenant_id)
);

CREATE TABLE IF NOT EXISTS products (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  category_id INT,
  name VARCHAR(160) NOT NULL,
  image_url TEXT,
  vat_rate DECIMAL(5,2) DEFAULT 10.00,
  active TINYINT(1) DEFAULT 1,
  stock INT DEFAULT NULL,                     -- NULL = sınırsız
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL,
  INDEX idx_products_tenant (tenant_id)
);

CREATE TABLE IF NOT EXISTS product_sizes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_id INT NOT NULL,
  label VARCHAR(40) NOT NULL,                 -- Küçük/Orta/Büyük/Adet
  price DECIMAL(10,2) NOT NULL,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  staff_id INT,
  customer_name VARCHAR(120),
  note TEXT,
  total DECIMAL(10,2) NOT NULL,
  vat_total DECIMAL(10,2) DEFAULT 0,
  pay_label VARCHAR(60),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (staff_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_orders_tenant (tenant_id),
  INDEX idx_orders_created (created_at)
);

CREATE TABLE IF NOT EXISTS order_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  product_name VARCHAR(160) NOT NULL,         -- satış anındaki adı (ürün silinse bile kaybolmaz)
  size_label VARCHAR(40),
  qty INT NOT NULL,
  unit_price DECIMAL(10,2) NOT NULL,
  discount_type ENUM('percent','amount'),
  discount_value DECIMAL(10,2),
  options TEXT,                               -- JSON string, örn: ["Az Şekerli"]
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);

-- ============================================================
-- SÜPER ADMİN (platform sahibi) — şubelerden tamamen ayrı, bağımsız hesaplar
-- ============================================================
CREATE TABLE IF NOT EXISTS admins (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(160) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Abonelik/ödeme takibi için şubelere plan ve iyzico bilgisi ekleniyor
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS plan VARCHAR(30) DEFAULT 'baslangic',
  ADD COLUMN IF NOT EXISTS subscription_status ENUM('trial','active','past_due','suspended') DEFAULT 'trial',
  ADD COLUMN IF NOT EXISTS iyzico_customer_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS features JSON,
  ADD COLUMN IF NOT EXISTS trial_ends_at DATETIME NULL;

-- ============================================================
-- WEB SİTESİ İÇERİK YÖNETİMİ (CMS) — landing sayfasının metin/fiyat/banner'ı
-- ============================================================
CREATE TABLE IF NOT EXISTS site_content (
  content_key VARCHAR(60) PRIMARY KEY,
  content_value LONGTEXT
);

CREATE TABLE IF NOT EXISTS blog_posts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  slug VARCHAR(200) NOT NULL UNIQUE,
  body LONGTEXT,
  published TINYINT(1) DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- İlk şube kaydı — "durakpos" slug'ı ile
-- ============================================================
INSERT INTO tenants (name, slug, currency) VALUES ('Kahve Durağı', 'durakpos', '₺');

-- İlk owner kullanıcı — şifreyi backend üzerinden bcrypt ile ayrıca
-- oluşturacağız, burada sadece kasa PIN girişi için hızlı bir kayıt açıyoruz.
-- (tenant_id = 1, çünkü yukarıdaki INSERT ile ilk kayıt bu oluyor)
INSERT INTO users (tenant_id, name, role, pin) VALUES (1, 'Coşkun Güler', 'owner', '1234');

CREATE TABLE IF NOT EXISTS demo_requests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  phone VARCHAR(30) NOT NULL,
  email VARCHAR(160),
  business_name VARCHAR(160) NOT NULL,
  status ENUM('yeni','arandı','kapatıldı') DEFAULT 'yeni',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- QR Menü — masalar (bölümler/masalar tanımlıysa müşteri masa seçmek zorunda,
-- hiç masa tanımlı değilse self-servis kabul edilir, masa seçimi istenmez)
CREATE TABLE IF NOT EXISTS tables (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  name VARCHAR(60) NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

-- QR menüden gelen siparişler — kasa onaylayana kadar "yeni" durumunda bekler
CREATE TABLE IF NOT EXISTS qr_orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  table_id INT NULL,
  items JSON NOT NULL,
  total DECIMAL(10,2) NOT NULL,
  customer_note VARCHAR(255),
  status ENUM('yeni','hazirlaniyor','tamamlandi','iptal') DEFAULT 'yeni',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (table_id) REFERENCES tables(id)
);

-- Bölümler/Masalar görsel tasarımcısı için masa konumu ve bölge (zone) desteği
ALTER TABLE tables
  ADD COLUMN IF NOT EXISTS x INT DEFAULT 60,
  ADD COLUMN IF NOT EXISTS y INT DEFAULT 60,
  ADD COLUMN IF NOT EXISTS seats INT DEFAULT 2,
  ADD COLUMN IF NOT EXISTS zone_id INT NULL;

CREATE TABLE IF NOT EXISTS zones (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  name VARCHAR(60) NOT NULL,
  x INT NOT NULL, y INT NOT NULL, width INT NOT NULL, height INT NOT NULL,
  color VARCHAR(20) DEFAULT '#EFE3D3',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

-- Bölge oluşturma artık dikdörtgen çizmek yerine masa seçerek yapılıyor —
-- x/y/width/height artık zorunlu değil (kullanılmıyor)
ALTER TABLE zones
  MODIFY x INT NULL,
  MODIFY y INT NULL,
  MODIFY width INT NULL,
  MODIFY height INT NULL;

-- Maliyet Hesaplama — hammadde/malzeme fiyatları ve ürün reçeteleri
CREATE TABLE IF NOT EXISTS ingredients (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  name VARCHAR(120) NOT NULL,
  unit VARCHAR(20) NOT NULL DEFAULT 'adet',
  unit_price DECIMAL(10,4) NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE TABLE IF NOT EXISTS product_ingredients (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_id INT NOT NULL,
  ingredient_id INT NOT NULL,
  quantity DECIMAL(10,4) NOT NULL,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  FOREIGN KEY (ingredient_id) REFERENCES ingredients(id) ON DELETE CASCADE
);

-- Müşteriye bakan ikinci ekran — boşta slayt gösterisi, sipariş girilirken canlı sepet
CREATE TABLE IF NOT EXISTS display_slides (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  image_url LONGTEXT NOT NULL,
  seconds INT NOT NULL DEFAULT 5,
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE TABLE IF NOT EXISTS live_cart (
  tenant_id INT PRIMARY KEY,
  items JSON NULL,
  total DECIMAL(10,2) DEFAULT 0,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

-- Kısmi ödeme desteği — bir sipariş birden fazla ödemeyle (örn. yarısı nakit,
-- yarısı kart) kapatılabilsin diye. "open" = hâlâ ödeme bekliyor, "closed" = tamamlandı.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS status ENUM('open','closed') DEFAULT 'closed';

CREATE TABLE IF NOT EXISTS order_payments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  pay_label VARCHAR(60) NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);

-- Paket Servis Entegrasyonları — her işletme kendi Yemeksepeti/Getir/Trendyol
-- mağaza bilgisini kendi panelinden girer, DurakPOS'un kendisi aracı firmayla
-- (API Merkezi/Posentegra gibi) tek bir entegratör anlaşması yapar.
CREATE TABLE IF NOT EXISTS delivery_integrations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  platform ENUM('yemeksepeti','getir','trendyol') NOT NULL,
  store_code VARCHAR(120) NOT NULL,
  status ENUM('bekliyor','bagli','hata') DEFAULT 'bekliyor',
  connected_at DATETIME NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_tenant_platform (tenant_id, platform),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

-- Paket servis platformlarından gelen siparişler — webhook ile buraya düşer
CREATE TABLE IF NOT EXISTS delivery_orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  platform ENUM('yemeksepeti','getir','trendyol') NOT NULL,
  platform_order_id VARCHAR(120),
  items JSON NOT NULL,
  total DECIMAL(10,2) NOT NULL,
  customer_name VARCHAR(160),
  customer_address TEXT,
  status ENUM('yeni','hazirlaniyor','yolda','tamamlandi','iptal') DEFAULT 'yeni',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

-- Rol bazlı yetkilendirme — her işletme kendi rollerini (Yönetici, Barista vb.)
-- tanımlayıp her role hangi işlemlere izin verildiğini işaretler
CREATE TABLE IF NOT EXISTS roles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  name VARCHAR(60) NOT NULL,
  permissions JSON NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS role_id INT NULL;

-- POS terminal (Ingenico vb.) bağlantı bilgileri — her işletme kendi panelinden
-- kendi cihaz bilgilerini girer, yerel köprü servisi (Bridge) buradan çeker
CREATE TABLE IF NOT EXISTS pos_terminal_config (
  tenant_id INT PRIMARY KEY,
  marka VARCHAR(60) DEFAULT 'INGENICO',
  model VARCHAR(60) DEFAULT 'MOVE5000F',
  seri_no VARCHAR(60),
  sicil_no VARCHAR(60),
  pos_sifresi VARCHAR(20),
  ip VARCHAR(60),
  port INT DEFAULT 7500,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

-- Abonelik faturaları — Kardo'daki "Kardo Faturaları" ekranına karşılık gelir.
-- Şimdilik siz elle oluşturup "Ödendi" işaretliyorsunuz, iyzico/Paynet bilgileri
-- gelince otomatik tahsilat + otomatik "ödendi" işaretleme eklenecek.
CREATE TABLE IF NOT EXISTS subscription_invoices (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  invoice_number VARCHAR(60) NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  due_date DATE NOT NULL,
  paid TINYINT(1) DEFAULT 0,
  paid_at DATETIME NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

-- Ödeme sağlayıcısı (iyzico/Paynet) ile gerçek entegrasyon için takip alanları
ALTER TABLE subscription_invoices ADD COLUMN IF NOT EXISTS payment_token VARCHAR(100) NULL;
ALTER TABLE subscription_invoices ADD COLUMN IF NOT EXISTS payment_status VARCHAR(30) NULL;
ALTER TABLE subscription_invoices ADD COLUMN IF NOT EXISTS payment_id VARCHAR(100) NULL;


CREATE TABLE IF NOT EXISTS platform_settings (
  id INT PRIMARY KEY DEFAULT 1,
  iyzico_api_key VARCHAR(255),
  iyzico_secret_key VARCHAR(255),
  iyzico_base_url VARCHAR(255) DEFAULT 'https://api.iyzipay.com',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Opsiyonel Özellikler (Kardo'daki "Opsiyonel Ürünler / Zorunlu Seçim Grupları")
-- Örn: "Şeker Oranı" başlığı altında Sade / Az Şekerli / Orta / Çok Şekerli seçenekleri.
-- Bir şablon birden fazla ürüne bağlanabilir (Türk Kahvesi, Çay vb.)
CREATE TABLE IF NOT EXISTS option_groups (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  name VARCHAR(100) NOT NULL,
  required TINYINT(1) DEFAULT 0,
  choices JSON NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS product_option_groups (
  product_id INT NOT NULL,
  option_group_id INT NOT NULL,
  PRIMARY KEY (product_id, option_group_id),
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  FOREIGN KEY (option_group_id) REFERENCES option_groups(id) ON DELETE CASCADE
);

-- POS cihazı formunu Kardo'daki gibi zenginleştirmek için ek alanlar
ALTER TABLE pos_terminal_config
  ADD COLUMN IF NOT EXISTS device_name VARCHAR(100),
  ADD COLUMN IF NOT EXISTS connection_type VARCHAR(30) DEFAULT 'ethernet';

-- ============================================================
-- MASA/BÖLGE + MUTFAK-BAR YAZICI YÖNLENDİRME
-- ============================================================

-- Siparişin hangi masaya ait olduğu (restoran/bar servis modeli için)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS table_id INT NULL;

-- Her kategori hangi istasyona (mutfak/bar) yazdırılacağını taşır —
-- örn. "Alkollü İçecekler" kategorisi -> bar, "Ana Yemekler" -> mutfak
ALTER TABLE categories ADD COLUMN IF NOT EXISTS print_station VARCHAR(30) NULL;

-- Her işletmenin istasyon başına (mutfak/bar) bir termal yazıcısı olabilir —
-- yerel ağdaki IP:Port'u burada tutulur, Bridge programı buraya bağlanıp yazdırır
CREATE TABLE IF NOT EXISTS printer_config (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  station VARCHAR(30) NOT NULL,
  printer_name VARCHAR(100),
  ip VARCHAR(60) NOT NULL,
  port INT DEFAULT 9100,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_tenant_station (tenant_id, station),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

-- Mutfağa/bara "gönderilen" sipariş kalemleri — Bridge programı bunları
-- periyodik olarak çekip termal yazıcıya basıp "yazdırıldı" işaretler
CREATE TABLE IF NOT EXISTS print_jobs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  order_id INT NOT NULL,
  station VARCHAR(30) NOT NULL,
  content TEXT NOT NULL,
  status ENUM('bekliyor','yazdirildi','hata') DEFAULT 'bekliyor',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  printed_at DATETIME NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);

-- ============================================================
-- HARİCİ WEB SİTESİ SİPARİŞ API'Sİ
-- ============================================================
-- Her işletme kendi web sitesini (örn. brokerscafe.com.tr) bu API anahtarıyla
-- DurakPOS'a bağlayabilir — sipariş verildiğinde otomatik olarak kasa ekranına düşer.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS store_api_key VARCHAR(64) NULL;

-- qr_orders tablosu zaten "gelen sipariş" kuyruğu olarak kullanılıyordu (QR menüden),
-- şimdi kaynağını da tutuyoruz ki panelde/kasada "Web Sitesi" mi "QR Menü" mü ayırt edilsin
ALTER TABLE qr_orders ADD COLUMN IF NOT EXISTS source VARCHAR(20) DEFAULT 'qr';
ALTER TABLE qr_orders ADD COLUMN IF NOT EXISTS customer_name VARCHAR(120) NULL;
ALTER TABLE qr_orders ADD COLUMN IF NOT EXISTS customer_phone VARCHAR(30) NULL;

-- ============================================================
-- MARKA (BİRDEN FAZLA ŞUBE) DESTEĞİ
-- ============================================================
-- Bir marka (örn. "Kahve Durağı") birden fazla şubeye (tenant) sahip olabilir.
-- Süper admin panelinden şubeler bir markaya bağlanır — sahip (owner) aynı
-- e-posta/şifreyle birden fazla şubesi arasında geçiş yapabilir.
CREATE TABLE IF NOT EXISTS brands (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS brand_id INT NULL;

-- ============================================================
-- GİDERLER (AI Asistan ve panel üzerinden kaydedilen harcamalar)
-- ============================================================
CREATE TABLE IF NOT EXISTS expenses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  description VARCHAR(255) NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  category VARCHAR(60) DEFAULT 'Genel',
  created_by VARCHAR(60) DEFAULT 'Panel',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

-- Günlük Kasa Kapanışı — o günün nakit/kart/gider dökümünü kayıt altına alır
CREATE TABLE IF NOT EXISTS day_closures (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  closure_date DATE NOT NULL,
  cash_total DECIMAL(10,2) DEFAULT 0,
  card_total DECIMAL(10,2) DEFAULT 0,
  other_total DECIMAL(10,2) DEFAULT 0,
  expense_total DECIMAL(10,2) DEFAULT 0,
  net_total DECIMAL(10,2) DEFAULT 0,
  closed_by VARCHAR(80),
  closed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

-- Denetim izi: bir adisyon kapandıktan sonra yeniden açılıp düzenlenirse bunu
-- kayıt altına alır — "Önceki Adisyonlar" listesinde lacivert renkle işaretlenir
ALTER TABLE orders ADD COLUMN IF NOT EXISTS reopened_count INT DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS last_reopened_by VARCHAR(80) NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS last_reopened_at DATETIME NULL;

-- İşletme türü — süper admin panelde şube eklerken/düzenlerken seçilir,
-- hangi özelliklerin varsayılan olarak önerileceğini belirler (zorunlu değil)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS business_type VARCHAR(30) NULL;

-- ============================================================
-- MARKET/BAKKAL MODÜLÜ: barkod + kilo bazlı satış + stok takibi
-- ============================================================
ALTER TABLE products ADD COLUMN IF NOT EXISTS barcode VARCHAR(50) NULL;
ALTER TABLE products ADD COLUMN IF NOT EXISTS sale_type ENUM('adet','kg') DEFAULT 'adet';
ALTER TABLE products ADD COLUMN IF NOT EXISTS stock_qty DECIMAL(10,3) NULL;
ALTER TABLE products ADD COLUMN IF NOT EXISTS low_stock_threshold DECIMAL(10,3) NULL;
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(tenant_id, barcode);

-- Bir açık siparişten ürün iptal edildiğinde (yanlış girildi, müşteri vazgeçti vb.)
-- kayıt altına alınır — "İptal Ürün Raporu" bu tablodan besleniyor
CREATE TABLE IF NOT EXISTS cancelled_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  order_id INT NULL,
  product_name VARCHAR(150) NOT NULL,
  qty DECIMAL(10,3) NOT NULL,
  unit_price DECIMAL(10,2) NOT NULL,
  reason VARCHAR(255) NULL,
  cancelled_by VARCHAR(80),
  cancelled_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

-- Ürünlerin panelde/kasada sürükle-bırakla belirlenen gösterim sırası
ALTER TABLE products ADD COLUMN IF NOT EXISTS sort_order INT DEFAULT 0;

-- NOT: Ürün resimleri artık Cloudflare R2'de saklanıyor (aşağıdaki
-- product_images tablosuna gerek kalmadı, R2'ye geçilmeden önce kullanılıyordu)

-- İşletmenin açılış saati — kasadaki "Raporlar" varsayılan olarak bu saatten
-- itibaren "bugün"ü gösterir (sabit 24 saat yerine, işletmenin gerçek gününe göre)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS opening_time TIME DEFAULT '00:00:00';

-- ============================================================
-- GÖREV TAKİP SİSTEMİ — patron olmadan personelin günlük/haftalık/
-- aylık rutinleri fotoğraflı olarak tamamlamasını sağlar
-- ============================================================

-- Kapanış saati de ekleniyor — "interval" tipi görevler (örn. her 3 saatte
-- bir) işletmenin açık olduğu saatler arasında hesaplanıyor
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS closing_time TIME DEFAULT '23:59:00';

-- Görev şablonu — patronun tanımladığı tekrarlayan görev
CREATE TABLE IF NOT EXISTS task_templates (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  title VARCHAR(200) NOT NULL,
  description TEXT NULL,
  recurrence_type ENUM('daily','interval','weekly','monthly') NOT NULL,
  time_of_day TIME NULL,           -- daily/weekly/monthly için: hangi saatte
  interval_hours DECIMAL(4,1) NULL, -- interval için: kaç saatte bir
  day_of_week TINYINT NULL,         -- weekly için: 0=Pazar..6=Cumartesi
  day_of_month TINYINT NULL,        -- monthly için: ayın kaçında
  requires_photo TINYINT(1) DEFAULT 1,
  assigned_to INT NULL,             -- NULL = tüm personel, dolu = belirli bir kişi (users.id)
  active TINYINT(1) DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

-- Bir görevin belirli bir tarihte/saatte tamamlanma kaydı
CREATE TABLE IF NOT EXISTS task_completions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  task_template_id INT NOT NULL,
  due_at DATETIME NOT NULL,         -- bu görevin hangi zamana ait olduğu
  completed_by VARCHAR(80) NULL,
  completed_at DATETIME NULL,
  photo_url TEXT NULL,
  note VARCHAR(255) NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_task_due (task_template_id, due_at),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (task_template_id) REFERENCES task_templates(id) ON DELETE CASCADE
);

-- Müşteri adı zorunluluğu — her işletme kendi panelinden açıp kapatabilir
-- (süper admin paketleme özelliklerinden farklı, işletmenin kendi tercihi)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS require_customer_name TINYINT(1) DEFAULT 0;

-- Günlük adisyon numarası — her iş günü 1'den başlar (kalıcı id'den ayrı,
-- sadece ekranda gösterim için)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS daily_number INT NULL;
-- Otomatik gün sonu tarafından, ödenmeden kapatılmış (bir sonraki güne
-- sarkmasın diye zorla kapatılmış) siparişleri işaretlemek için
ALTER TABLE orders ADD COLUMN IF NOT EXISTS auto_closed_unpaid TINYINT(1) DEFAULT 0;

-- Push bildirim jetonları — her cihaz/tarayıcı, giriş yaptığında kendi FCM
-- jetonunu buraya kaydeder, sunucu bildirim göndereceği zaman bunu kullanır
CREATE TABLE IF NOT EXISTS push_tokens (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  user_id INT NULL,
  app VARCHAR(30) NOT NULL, -- 'patron' | 'gorevler'
  token VARCHAR(255) NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_token (token),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

-- Bir görev için hangi zaman dilimine bildirim gönderildiğini takip eder —
-- aynı görev için tekrar tekrar bildirim gitmesin diye
CREATE TABLE IF NOT EXISTS task_notifications_sent (
  id INT AUTO_INCREMENT PRIMARY KEY,
  task_template_id INT NOT NULL,
  due_at DATETIME NOT NULL,
  sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_task_notif (task_template_id, due_at)
);

-- Süper admin push bildirim jetonları (normal işletme jetonlarından ayrı,
-- çünkü süper admin girişi bir işletmeye (tenant) bağlı değil)
CREATE TABLE IF NOT EXISTS admin_push_tokens (
  id INT AUTO_INCREMENT PRIMARY KEY,
  admin_id INT NOT NULL,
  token VARCHAR(255) NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_admin_token (token)
);

-- Garson (telefon) uygulamasından yazdırma isteği kuyruğa düşünce, hangi
-- terminalin (istasyonun) bunu yazdıracağını IP değil, sadece isim eşleşmesi
-- belirliyor — o yüzden ip artık zorunlu değil.
ALTER TABLE printer_config MODIFY ip VARCHAR(60) NULL;
-- Fiş kuyruğuna, yazdırılacak GERÇEK fiş HTML içeriğini de ekliyoruz — önceden
-- sadece mutfak/bar sipariş fişleri içindi, şimdi Garson'un tam fişi de kuyruğa girebiliyor.
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS content_html LONGTEXT NULL;
-- Garson uygulamasından gelen fişler belirli bir siparişe (order_id) bağlı
-- olmak zorunda değil (örn. sadece adisyon özeti) — artık isteğe bağlı.
ALTER TABLE print_jobs MODIFY order_id INT NULL;

-- Performans indeksleri — işletme/tarih bazlı sorgular (raporlar, adisyon
-- listeleri) veri arttıkça yavaşlamasın diye. "IF NOT EXISTS" bazı eski MySQL
-- sürümlerinde CREATE INDEX ile desteklenmiyor — onun yerine migration
-- sistemimizin zaten "tekrar çalışırsa yoksay" mantığına güveniyoruz.
CREATE INDEX idx_orders_tenant_created ON orders(tenant_id, created_at);
CREATE INDEX idx_orders_tenant_status ON orders(tenant_id, status);
CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_order_payments_order ON order_payments(order_id);
CREATE INDEX idx_order_payments_created ON order_payments(created_at);
CREATE INDEX idx_cancelled_items_tenant_date ON cancelled_items(tenant_id, cancelled_at);
CREATE INDEX idx_products_tenant_active ON products(tenant_id, active);

-- Personel indirimi — sadece bu özelliği açan işletmelerde kullanılıyor
-- (Market Modu, Masa Servisi gibi isteğe bağlı bir özellik). Web sitesi/
-- uygulama üzerinden "personel" olarak giriş yapan müşterilere, kategoriye
-- göre otomatik indirim uygulanmasını sağlar.
CREATE TABLE IF NOT EXISTS category_staff_discounts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  category_id INT NOT NULL,
  discount_percent DECIMAL(5,2) NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_tenant_category (tenant_id, category_id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
);

-- Personel mola takibi — "Molaya Çık" / "Moladan Geldim" butonlarıyla kaydedilir
CREATE TABLE IF NOT EXISTS staff_breaks (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  user_id INT NOT NULL,
  break_start DATETIME NOT NULL,
  break_end DATETIME NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX idx_staff_breaks_user ON staff_breaks(user_id, break_start);

-- Personel mola takibi — Görevlerim uygulamasından "Molaya Çık"/"Geldim"
-- butonlarıyla kaydediliyor, panelde kaç dakika mola yapıldığı raporlanabiliyor
CREATE TABLE IF NOT EXISTS staff_breaks (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  user_id INT NOT NULL,
  break_start DATETIME NOT NULL,
  break_end DATETIME NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX idx_staff_breaks_tenant_user ON staff_breaks(tenant_id, user_id);

-- Canlı sepet güncellemelerinde, ağ gecikmesi yüzünden ESKİ bir isteğin YENİ
-- bir isteğin üzerine geç gelip yazmasını kesin olarak engellemek için sıra
-- numarası — sunucu, gelen numara mevcut kayıtlıdan küçükse günceli yoksayar.
ALTER TABLE live_cart ADD COLUMN IF NOT EXISTS sequence BIGINT DEFAULT 0;

-- Ödeme tipleri artık panelden yönetilebiliyor (önceden Nakit/Kredi Kartı/
-- Yemek Kartı sabit kodluydu). Her işletme kendi ödeme yöntemlerini
-- ekleyip/kaldırabiliyor, bazılarının alt markaları (Yemek Kartı → Multinet,
-- Setcard gibi) olabiliyor.
CREATE TABLE IF NOT EXISTS payment_methods (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  name VARCHAR(60) NOT NULL,
  icon VARCHAR(10) DEFAULT '💳',
  sort_order INT DEFAULT 0,
  active TINYINT(1) DEFAULT 1,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS payment_method_subtypes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  payment_method_id INT NOT NULL,
  name VARCHAR(60) NOT NULL,
  sort_order INT DEFAULT 0,
  FOREIGN KEY (payment_method_id) REFERENCES payment_methods(id) ON DELETE CASCADE
);

-- Ödeme alındığında fişin otomatik yazdırılıp yazdırılmayacağı — panelden
-- açılıp kapatılabiliyor (varsayılan: açık)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS auto_print_receipt TINYINT(1) DEFAULT 1;

-- Ödeme sağlayıcısının (iyzico) zorunlu tuttuğu fatura/kimlik bilgileri —
-- işletme sahibinden panelden toplanıyor, ödeme başlatılırken kullanılıyor
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS billing_tckn VARCHAR(11) NULL;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS billing_address VARCHAR(255) NULL;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS billing_city VARCHAR(60) NULL;

-- Otomatik aylık faturalama — her işletmenin aylık ücreti ve fatura kesim
-- günü tanımlanıyor, sistem her ay o gün geldiğinde otomatik fatura kesiyor
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS monthly_price DECIMAL(10,2) NULL;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS billing_day INT DEFAULT 1;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS last_invoiced_period VARCHAR(7) NULL;

-- Ödemesi geciken faturalar için — 3 günlük bekleme süresi boyunca uyarı
-- bildirimi gönderildi mi, tekrar tekrar göndermemek için işaretleniyor
ALTER TABLE subscription_invoices ADD COLUMN IF NOT EXISTS overdue_reminder_sent TINYINT(1) DEFAULT 0;

-- Netgsm SMS entegrasyonu — ödeme günü geldiğinde ve hesap kapanmadan önce
-- otomatik SMS gönderebilmek için
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS netgsm_username VARCHAR(100) NULL;
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS netgsm_password VARCHAR(100) NULL;
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS netgsm_header VARCHAR(20) NULL;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS billing_phone VARCHAR(20) NULL;

-- Kayıtlı kart (tokenization) — otomatik tekrar çekim için. Gerçek kart
-- bilgisi (numara/CVC) HİÇBİR ZAMAN veritabanında saklanmıyor, sadece
-- iyzico'nun bize verdiği (kart bilgisi olmadan işe yaramayan) token'lar.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS iyzico_card_user_key VARCHAR(100) NULL;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS iyzico_card_token VARCHAR(100) NULL;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS card_last_four VARCHAR(4) NULL;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS card_registered_at DATETIME NULL;
-- Otomatik çekim denemesi başarısız olursa kaç kez denendiği (sonsuz döngü olmasın)
ALTER TABLE subscription_invoices ADD COLUMN IF NOT EXISTS auto_charge_attempts INT DEFAULT 0;

-- Google Sheets entegrasyonu — AI Asistan'ın, sohbette söylenenleri (maaş
-- ödemesi, gelen ürün, firma notu gibi) otomatik olarak bir Google E-Tablosuna
-- satır satır kaydedebilmesi için. Servis hesabı bilgisi platform genelinde
-- (tek seferlik kurulum), her işletme kendi tablosunun linkini giriyor.
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS google_service_account_email VARCHAR(255) NULL;
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS google_service_account_key TEXT NULL;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS google_sheet_id VARCHAR(100) NULL;

-- Google Sheets bilgileri artık PLATFORM GENELİNDE değil, HER İŞLETMENİN
-- KENDİ panelinden girdiği, kendine ait bilgiler
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS google_service_account_email VARCHAR(255) NULL;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS google_service_account_key TEXT NULL;
