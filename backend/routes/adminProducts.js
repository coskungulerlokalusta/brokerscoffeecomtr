const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const adminAuth = require('../utils/adminAuth');
const productStore = require('../utils/productStore');

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'public', 'uploads', 'products');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, crypto.randomUUID() + ext);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (!allowed.includes(ext)) return cb(new Error('Sadece jpg, png, webp resim dosyaları kabul edilir'));
    cb(null, true);
  },
});

// Tüm ürünleri listele (admin görünümü)
router.get('/', adminAuth.requireAuth, (req, res) => {
  res.json(productStore.loadProducts());
});

// Yeni ürün oluştur (resim opsiyonel)
router.post('/', adminAuth.requireAuth, upload.single('image'), (req, res) => {
  try {
    const { name, category, subcategory, description, sizes } = req.body;
    if (!name || !category) return res.status(400).json({ error: 'Ürün adı ve kategori gerekli' });

    let parsedSizes;
    try {
      parsedSizes = JSON.parse(sizes || '[]');
    } catch {
      return res.status(400).json({ error: 'Fiyat/boyut bilgisi hatalı' });
    }
    if (!parsedSizes.length) return res.status(400).json({ error: 'En az bir fiyat girilmeli' });

    const image = req.file ? `/uploads/products/${req.file.filename}` : null;
    const product = productStore.createProduct({ name, category, subcategory, sizes: parsedSizes, description, image });
    res.status(201).json(product);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Ürün güncelle (resim opsiyonel — gönderilirse eskisinin yerine geçer)
router.put('/:id', adminAuth.requireAuth, upload.single('image'), (req, res) => {
  try {
    const { name, category, subcategory, description, sizes } = req.body;
    const updates = {};
    if (name) updates.name = name;
    if (category) updates.category = category;
    if (subcategory !== undefined) updates.subcategory = subcategory || null;
    if (description !== undefined) updates.description = description;
    if (sizes) {
      try {
        updates.sizes = JSON.parse(sizes);
      } catch {
        return res.status(400).json({ error: 'Fiyat/boyut bilgisi hatalı' });
      }
    }
    if (req.file) updates.image = `/uploads/products/${req.file.filename}`;

    const product = productStore.updateProduct(req.params.id, updates);
    if (!product) return res.status(404).json({ error: 'Ürün bulunamadı' });
    res.json(product);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Ürün sil
router.delete('/:id', adminAuth.requireAuth, (req, res) => {
  const ok = productStore.deleteProduct(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Ürün bulunamadı' });
  res.json({ ok: true });
});

module.exports = router;
