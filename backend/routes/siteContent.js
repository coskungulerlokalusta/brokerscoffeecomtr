const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const adminAuth = require('../utils/adminAuth');
const siteContent = require('../utils/siteContent');

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'public', 'uploads', 'site');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, crypto.randomUUID() + path.extname(file.originalname).toLowerCase()),
});
const upload = multer({
  storage,
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

// Admin: bir görsel alanını güncelle (key: heroImg, aboutImg1, aboutImg2, locationImg1, locationImg2)
router.post('/:key', adminAuth.requireAuth, upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Resim dosyası gerekli' });
  try {
    const data = await siteContent.setImage(req.params.key, `/uploads/site/${req.file.filename}`);
    res.json(data);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
