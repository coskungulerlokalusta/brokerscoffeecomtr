const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const adminAuth = require('../utils/adminAuth');
const customerAuth = require('../utils/customerAuth');
const settings = require('../utils/settings');
const appConfig = require('../utils/appConfig');
const imageStore = require('../utils/imageStore');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp'];
    if (!allowed.includes(path.extname(file.originalname).toLowerCase())) {
      return cb(new Error('Sadece jpg, png, webp kabul edilir'));
    }
    cb(null, true);
  },
});

// Herkese açık: uygulama içeriği — giriş yapan kişi personelse personele, değilse müşteriye ait içerik döner
router.get('/', customerAuth.attachCustomerIfPresent, async (req, res) => {
  const config = await appConfig.load();
  const isStaff = !!(req.customer && req.customer.isStaff);
  const out = appConfig.forAudience(config, isStaff);
  out.ordering = appConfig.orderingStatus(config);
  out.audience = isStaff ? 'staff' : 'customer';
  if (isStaff) {
    const s = await settings.loadSettings();
    out.staffBannerText = s.staffBannerText || '';
  }
  res.json(out);
});

// Admin: tüm içerik (hedef kitle ve pasif öğeler dahil)
router.get('/admin', adminAuth.requireAuth, async (req, res) => {
  const config = await appConfig.load();
  res.json({ config, ordering: appConfig.orderingStatus(config) });
});

router.put('/admin', adminAuth.requireAuth, async (req, res) => {
  const config = await appConfig.save(req.body || {});
  res.json({ config, ordering: appConfig.orderingStatus(config) });
});

router.post('/admin/upload', adminAuth.requireAuth, (req, res) => {
  upload.single('image')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'Resim dosyası gerekli' });
    const ext = path.extname(req.file.originalname).toLowerCase();
    const url = await imageStore.saveImage(req.file.buffer, ext);
    res.json({ url });
  });
});

module.exports = router;
