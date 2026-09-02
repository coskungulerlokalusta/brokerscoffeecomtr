const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const adminAuth = require('../utils/adminAuth');
const siteContent = require('../utils/siteContent');
const imageStore = require('../utils/imageStore');

// Belleğe al, MySQL'e yaz — yerel disk deploy'larda silinebiliyor
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

// Herkese açık: mevcut site görsellerini getir
router.get('/', async (req, res) => {
  res.json(await siteContent.load());
});

// Admin: Öne Çıkanlar bölümünün başlığını ve gösterilecek ürünleri güncelle
router.post('/featured', adminAuth.requireAuth, async (req, res) => {
  const { featuredTitle, featuredProductIds } = req.body;
  const data = await siteContent.setFeaturedConfig({ featuredTitle, featuredProductIds });
  res.json(data);
});

// Admin: bir görsel alanını güncelle (key: heroImg, aboutImg1, aboutImg2, locationImg1, locationImg2)
router.post('/:key', adminAuth.requireAuth, upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Resim dosyası gerekli' });
  try {
    const ext = path.extname(req.file.originalname).toLowerCase();
    const imageUrl = await imageStore.saveImage(req.file.buffer, ext);
    const data = await siteContent.setImage(req.params.key, imageUrl);
    res.json(data);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
