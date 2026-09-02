const express = require('express');
require('express-async-errors'); // async route hatalarını otomatik yakalar, sunucu çökmesini önler
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');

const productStore = require('./backend/utils/productStore');
const adminAuth = require('./backend/utils/adminAuth');
const customerAuth = require('./backend/utils/customerAuth');
const settings = require('./backend/utils/settings');
const { withEffectivePrices } = require('./backend/utils/discountGroups');
const kv = require('./backend/utils/kvStore');

const adminRoutes = require('./backend/routes/admin');
const orderRoutes = require('./backend/routes/orders');
const paymentRoutes = require('./backend/routes/payment');
const customerRoutes = require('./backend/routes/customer');
const adminProductRoutes = require('./backend/routes/adminProducts');
const rewardsRoutes = require('./backend/routes/rewards');
const siteContentRoutes = require('./backend/routes/siteContent');
const pushRoutes = require('./backend/routes/push');
const whatsappWebhookRoutes = require('./backend/routes/whatsappWebhook');
const instagramWebhookRoutes = require('./backend/routes/instagramWebhook');
const messengerWebhookRoutes = require('./backend/routes/messengerWebhook');
const imagesRoutes = require('./backend/routes/images');

const app = express();
const PORT = process.env.PORT || 3000;
app.set('trust proxy', 1); // Hostinger reverse proxy arkasında doğru IP/protokol algılama için

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // Paynet'in 3D geri dönüşü form-post olarak gelir
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/admin', adminRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/account', customerRoutes);
app.use('/api/admin/products', adminProductRoutes);
app.use('/api/rewards', rewardsRoutes);
app.use('/api/site-content', siteContentRoutes);
app.use('/api/push', pushRoutes);
app.use('/api/webhooks', whatsappWebhookRoutes);
app.use('/api/webhooks', instagramWebhookRoutes);
app.use('/api/webhooks', messengerWebhookRoutes);
app.use('/api/images', imagesRoutes);

// Herkese açık — checkout sayfasının ihtiyaç duyduğu, hassas olmayan ayarlar.
// Personel ve müşteri için ayrı yapılandırılmış (ödeme yöntemleri, adres zorunluluğu vb.) görünüm döner.
app.get('/api/settings/public', customerAuth.attachCustomerIfPresent, async (req, res) => {
  const s = await settings.loadSettings();
  const isStaff = !!(req.customer && req.customer.isStaff);
  const view = s.audienceSettings[isStaff ? 'staff' : 'customer'];
  res.json({
    showPaymentMethodSelector: view.showPaymentMethodSelector,
    paymentMethodsEnabled: view.paymentMethodsEnabled,
    showOrderPreferences: view.showOrderPreferences,
    requireAddress: view.requireAddress,
    showDeliveryInfo: view.showDeliveryInfo,
    hideCustomizationForCategories: view.hideCustomizationForCategories,
    extraShotPrice: s.extraShotPrice,
    deliveryFeeTiers: s.deliveryFeeTiers,
  });
});

// Tüm ürünleri getir (opsiyonel ?category= filtresi ile) — personel girişliyse indirimli fiyatlar da eklenir,
// ayrıca personel/müşteri için ayrı ayrı gizlenmiş kategoriler varsa onlar menüden çıkarılır
app.get('/api/products', customerAuth.attachCustomerIfPresent, async (req, res) => {
  const products = await productStore.loadProducts();
  const isStaff = !!(req.customer && req.customer.isStaff);
  const currentSettings = await settings.loadSettings();
  const view = currentSettings.audienceSettings[isStaff ? 'staff' : 'customer'];
  const hiddenCats = (view.hiddenCategories || []).map((c) => c.toLowerCase());
  const visible = products.filter((p) => {
    if (hiddenCats.includes((p.subcategory || p.category || '').toLowerCase())) return false;
    if (p.hiddenFor && p.hiddenFor[isStaff ? 'staff' : 'customer']) return false;
    return true;
  });
  const withPrices = visible.map((p) => withEffectivePrices(p, isStaff, isStaff ? currentSettings.staffDiscountByGroup : null));

  const { category } = req.query;
  if (category) {
    const filtered = withPrices.filter(
      (p) => (p.subcategory || p.category).toLowerCase() === category.toLowerCase()
    );
    return res.json(filtered);
  }
  res.json(withPrices);
});

// Kategori listesini getir — admin panelde belirlenen sıraya göre dizilir,
// personel/müşteriye özel gizlenmiş kategoriler çıkarılır
app.get('/api/categories', customerAuth.attachCustomerIfPresent, async (req, res) => {
  const products = await productStore.loadProducts();
  const isStaff = !!(req.customer && req.customer.isStaff);
  const currentSettings = await settings.loadSettings();
  const view = currentSettings.audienceSettings[isStaff ? 'staff' : 'customer'];
  const hiddenCats = (view.hiddenCategories || []).map((c) => c.toLowerCase());
  const cats = [...new Set(products.map((p) => p.subcategory || p.category))].filter(
    (c) => !hiddenCats.includes(c.toLowerCase())
  );
  const order = currentSettings.categoryOrder || [];
  cats.sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    if (ia === -1 && ib === -1) return 0;
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
  res.json(cats);
});

// Tek ürün getir
app.get('/api/products/:id', customerAuth.attachCustomerIfPresent, async (req, res) => {
  const products = await productStore.loadProducts();
  const product = products.find((p) => p.id === req.params.id);
  if (!product) return res.status(404).json({ error: 'Ürün bulunamadı' });
  const isStaff = !!(req.customer && req.customer.isStaff);
  const currentSettings = isStaff ? await settings.loadSettings() : null;
  res.json(withEffectivePrices(product, isStaff, currentSettings && currentSettings.staffDiscountByGroup));
});

// İlk çalıştırmada: MySQL boşsa, repo içindeki başlangıç verilerini (gerçek menü,
// admin kullanıcısı) bir kereliğine aktarır. Sonraki her deploy'da MySQL'deki
// gerçek veri korunur, bu tohumlama tekrar çalışmaz.
async function seedIfEmpty() {
  try {
    const existingProducts = await kv.getJSON('products', null);
    if (!existingProducts) {
      const seedPath = path.join(__dirname, 'data', 'products.json');
      if (fs.existsSync(seedPath)) {
        const seed = JSON.parse(fs.readFileSync(seedPath, 'utf-8'));
        await kv.setJSON('products', seed);
        console.log(`Başlangıç menüsü aktarıldı: ${seed.length} ürün`);
      }
    }

    const existingAdmins = await kv.getJSON('admin_users', null);
    if (!existingAdmins) {
      const seedPath = path.join(__dirname, 'data', 'admin-users.json');
      if (fs.existsSync(seedPath)) {
        const seed = JSON.parse(fs.readFileSync(seedPath, 'utf-8'));
        if (seed.length) {
          await kv.setJSON('admin_users', seed);
          console.log('Başlangıç admin kullanıcısı aktarıldı');
        }
      }
    }
  } catch (err) {
    console.error('Tohumlama sırasında hata (MySQL bağlantısını kontrol edin):', err.message);
  }
}

// Genel hata yakalayıcı — hiçbir hata sunucuyu çökertmesin, düzgün 500 dönsün
app.use((err, req, res, next) => {
  console.error('İstek hatası:', err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Sunucu hatası, lütfen tekrar deneyin.' });
});

// Son çare güvenlik ağı: beklenmeyen bir hata sunucuyu asla tamamen çökertmesin
process.on('unhandledRejection', (err) => {
  console.error('Yakalanmamış promise hatası:', err);
});
process.on('uncaughtException', (err) => {
  console.error('Yakalanmamış hata:', err);
});

seedIfEmpty().then(() => {
  app.listen(PORT, () => {
    console.log(`Brokers Coffee sunucusu ${PORT} portunda çalışıyor`);
  });

  // Zamanlanmış/yayılmış mesajları her dakika kontrol edip zamanı gelenleri gönderir
  const messageQueue = require('./backend/utils/messageQueue');
  setInterval(() => {
    messageQueue.processDue().catch((err) => console.error('Mesaj kuyruğu hatası:', err.message));
  }, 60 * 1000);
});
