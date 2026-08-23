// Durak POS — Multi-tenant SaaS Backend
// Hostinger'da "Deploy Web App" ile yüklenmek üzere hazırlanmıştır.
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import authRoutes from './routes/auth.js';
import menuRoutes from './routes/menu.js';
import orderRoutes from './routes/orders.js';
import reportRoutes from './routes/reports.js';
import tenantRoutes from './routes/tenants.js';
import adminRoutes from './routes/admin.js';
import contentRoutes from './routes/content.js';
import deliveryRoutes from './routes/delivery.js';
import staffRoutes from './routes/staff.js';
import posConfigRoutes from './routes/posconfig.js';
import billingRoutes from './routes/billing.js';
import printerRoutes from './routes/printers.js';
import storeApiRoutes from './routes/storeapi.js';
import taskRoutes from './routes/tasks.js';
import { runMigrations } from './runMigrations.js';
import { fixExistingImageCaching, fixLegacyR2Urls } from './imageStorage.js';
import { cleanupCancelledItemsGlobal } from './routes/orders.js';
import { runAutoDayCloseForAllTenants } from './dayCloseAuto.js';
import { checkAndSendTaskReminders } from './taskReminders.js';
import { seedDefaultPaymentMethods } from './seedPaymentMethods.js';
import { verifyAndCompletePayment } from './iyzicoPayment.js';
import { runAutoInvoicing } from './autoInvoicing.js';
import { checkOverduePayments } from './overduePayments.js';

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' })); // ürün fotoğrafları için biraz geniş
app.use(express.urlencoded({ extended: true })); // iyzico'nun ödeme callback'i form-encoded veri gönderiyor

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'durak-pos-backend' }));

// iyzico'nun ödeme sonrası yönlendirdiği geri bildirim adresi — kimlik
// doğrulaması GEREKTİRMEZ, çünkü bunu çağıran tarayıcı değil iyzico'nun
// kendisi. Güvenlik, ödemenin GERÇEKTEN başarılı olup olmadığını iyzico'ya
// SORARAK (token doğrulama) sağlanıyor — gelen veriye asla güvenilmiyor.
app.post('/billing/payment-callback', async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).send('Eksik bilgi.');
  const result = await verifyAndCompletePayment(token);
  const redirectUrl = result.ok
    ? `/panel?odeme=basarili`
    : `/panel?odeme=basarisiz&hata=${encodeURIComponent(result.error || '')}`;
  res.redirect(redirectUrl);
});

app.use('/api/auth', authRoutes);
app.use('/api/menu', menuRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/tenants', tenantRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/public', contentRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/delivery', deliveryRoutes);
app.use('/api/staff-mgmt', staffRoutes);
app.use('/api/pos-config', posConfigRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/printers', printerRoutes);
app.use('/api/store-api-key', storeApiRoutes);

// durakpos.com'a tarayıcıdan girildiğinde önce tanıtım sayfası, "/panel" adresinde
// giriş ekranı ve yönetim paneli, "/patron" adresinde telefon PWA'sı,
// "/admin" adresinde ise platform sahibi (süper admin) paneli sunulur.
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/panel', (req, res) => res.sendFile(path.join(__dirname, 'public', 'panel.html')));
app.get('/patron', (req, res) => res.sendFile(path.join(__dirname, 'public', 'patron.html')));
app.get('/asistan', (req, res) => res.sendFile(path.join(__dirname, 'public', 'asistan.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/demo-talep', (req, res) => res.sendFile(path.join(__dirname, 'public', 'demo-talep.html')));
app.get('/qr/:slug', (req, res) => res.sendFile(path.join(__dirname, 'public', 'qr.html')));
app.get('/kasa', (req, res) => res.sendFile(path.join(__dirname, 'public', 'kasa.html')));
app.get('/ekran/:slug', (req, res) => res.sendFile(path.join(__dirname, 'public', 'ekran.html')));

// Footer/tanıtım alt sayfaları — POS Sistemleri, İşletme Çözümleri, Kurumsal, Yasal
const FOOTER_SLUGS = [
  'kafe','restoran','paket-servis','entegrasyonlar','qr-menu','mobil','kiosk-siparis',
  'personel-yonetimi','stok-takibi','muhasebe','sube-yonetimi','akilli-raporlar',
  'hakkimizda','kariyer','ortaklik',
  'gizlilik-politikasi','kullanim-sartlari','cerez-politikasi','kvkk','vergi-uyumlulugu'
];
FOOTER_SLUGS.forEach(slug => {
  app.get('/' + slug, (req, res) => res.sendFile(path.join(__dirname, 'public', slug + '.html')));
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Sunucu hatası', detail: err.message });
});

const PORT = process.env.PORT || 3000;
// Sunucu açılırken önce eksik tablo/sütun varsa otomatik ekliyoruz — bu geceki
// gibi "SQL çalıştırmayı unuttum" hatasını kalıcı olarak ortadan kaldırıyor.
// Ardından resim önbellek ayarlarını da (bir yükleme ekstra tık gerektirmesin
// diye) kendiliğinden düzeltiyoruz — zararsız, tekrar tekrar çalışsa da sorun
// çıkarmaz.
// ÖNEMLİ: Sunucu önce HEMEN dinlemeye başlıyor, migration/kontroller ARKA
// PLANDA devam ediyor — böylece Hostinger'ın "3 saniye içinde listen()
// çağrılmadı" uyarısı hiç oluşmuyor. Migration sayısı ilerde artsa bile
// (95 satırdan daha fazlası), sunucunun başlaması buna bağımlı kalmıyor.
app.listen(PORT, () => console.log(`Durak POS backend ${PORT} portunda çalışıyor`));

runMigrations()
  .catch(e => console.error('Migration çalıştırılamadı:', e.message))
  .then(() => fixExistingImageCaching().then(n => console.log(`Resim önbellek düzeltmesi: ${n} dosya kontrol edildi.`)).catch(e => console.error('Resim önbellek düzeltmesi atlandı:', e.message)))
  .then(() => fixLegacyR2Urls().then(n => console.log(`Eski r2.dev adresleri düzeltildi: ${n} ürün.`)).catch(e => console.error('r2.dev adres düzeltmesi atlandı:', e.message)))
  .then(() => seedDefaultPaymentMethods().then(n => console.log(`Varsayılan ödeme tipleri oluşturuldu: ${n} işletme.`)).catch(e => console.error('Ödeme tipi kurulumu atlandı:', e.message)))
  .then(() => cleanupCancelledItemsGlobal().then(n => console.log(`İptal edilen ürün temizliği: ${n} kayıt düzeltildi.`)).catch(e => console.error('İptal ürün temizliği atlandı:', e.message)))
  .then(() => runAutoDayCloseForAllTenants().then(n => console.log(`Otomatik gün sonu: ${n} işletme için kapanış yapıldı.`)).catch(e => console.error('Otomatik gün sonu atlandı:', e.message)))
  .finally(() => {
    // Sunucu günlerce yeniden başlamadan açık kalsa bile (Redeploy olmasa,
    // kimse giriş yapmasa da) her saat başı otomatik gün sonu kontrolü yapılır.
    setInterval(() => {
      runAutoDayCloseForAllTenants().catch(e => console.error('Saatlik otomatik gün sonu kontrolü başarısız:', e.message));
    }, 60 * 60 * 1000);
    // Görev hatırlatma bildirimleri — her 3 dakikada bir, saati gelmiş
    // görevleri kontrol edip personele push bildirimi gönderir.
    setInterval(() => {
      checkAndSendTaskReminders().catch(e => console.error('Görev hatırlatma kontrolü başarısız:', e.message));
    }, 3 * 60 * 1000);
    checkAndSendTaskReminders().catch(e => console.error('Görev hatırlatma kontrolü başarısız:', e.message));
    // Otomatik aylık faturalama — günde bir kere yeterli, kesim günü geldiyse
    // fatura oluşturur (aynı güne denk gelen açılışlarda mükerrer kesmez).
    setInterval(() => {
      runAutoInvoicing().then(r => { if(r.created>0) console.log(`Otomatik fatura: ${r.created} işletme için oluşturuldu, ${r.autoCharged} tanesi kayıtlı kartla otomatik tahsil edildi.`); }).catch(e => console.error('Otomatik faturalama başarısız:', e.message));
    }, 24 * 60 * 60 * 1000);
    runAutoInvoicing().then(r => { if(r.created>0) console.log(`Otomatik fatura: ${r.created} işletme için oluşturuldu, ${r.autoCharged} tanesi kayıtlı kartla otomatik tahsil edildi.`); }).catch(e => console.error('Otomatik faturalama başarısız:', e.message));
    // Ödemesi geciken faturalar — günde bir kere: yeni gecikenlere uyarı
    // gönderir, 3 günü dolanları otomatik askıya alır.
    setInterval(() => {
      checkOverduePayments().then(r => { if(r.remindersSent||r.suspended) console.log(`Gecikme kontrolü: ${r.remindersSent} uyarı, ${r.suspended} askıya alma.`); }).catch(e => console.error('Gecikme kontrolü başarısız:', e.message));
    }, 24 * 60 * 60 * 1000);
    checkOverduePayments().then(r => { if(r.remindersSent||r.suspended) console.log(`Gecikme kontrolü: ${r.remindersSent} uyarı, ${r.suspended} askıya alma.`); }).catch(e => console.error('Gecikme kontrolü başarısız:', e.message));
  });
