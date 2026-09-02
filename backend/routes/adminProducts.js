const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const adminAuth = require('../utils/adminAuth');
const productStore = require('../utils/productStore');
const imageStore = require('../utils/imageStore');

// Dosyayı diske değil belleğe alıyoruz — buradan MySQL'e (kv_store) yazacağız,
// böylece deploy'larda silinmeyecek (yerel disk kalıcı değil).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (!allowed.includes(ext)) return cb(new Error('Sadece jpg, png, webp resim dosyaları kabul edilir'));
    cb(null, true);
  },
});

async function storeUploadedImage(file) {
  if (!file) return null;
  const ext = path.extname(file.originalname).toLowerCase();
  return imageStore.saveImage(file.buffer, ext);
}

// Tüm ürünleri listele (admin görünümü)
router.get('/', adminAuth.requireAuth, async (req, res) => {
  res.json(await productStore.loadProducts());
});

// Yeni ürün oluştur (resim opsiyonel)
router.post('/', adminAuth.requireAuth, upload.single('image'), async (req, res) => {
  try {
    const { name, category, subcategory, description, sizes, hiddenFor } = req.body;
    if (!name || !category) return res.status(400).json({ error: 'Ürün adı ve kategori gerekli' });

    let parsedSizes;
    try {
      parsedSizes = JSON.parse(sizes || '[]');
    } catch {
      return res.status(400).json({ error: 'Fiyat/boyut bilgisi hatalı' });
    }
    if (!parsedSizes.length) return res.status(400).json({ error: 'En az bir fiyat girilmeli' });

    const image = await storeUploadedImage(req.file);
    let parsedHiddenFor = { customer: false, staff: false };
    try {
      if (hiddenFor) parsedHiddenFor = { ...parsedHiddenFor, ...JSON.parse(hiddenFor) };
    } catch {}
    const product = await productStore.createProduct({ name, category, subcategory, sizes: parsedSizes, description, image, hiddenFor: parsedHiddenFor });
    res.status(201).json(product);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Ürün güncelle (resim opsiyonel — gönderilirse eskisinin yerine geçer)
router.put('/:id', adminAuth.requireAuth, upload.single('image'), async (req, res) => {
  try {
    const { name, category, subcategory, description, sizes, hiddenFor } = req.body;
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
    if (hiddenFor !== undefined) {
      try {
        updates.hiddenFor = JSON.parse(hiddenFor);
      } catch {
        return res.status(400).json({ error: 'Görünürlük bilgisi hatalı' });
      }
    }
    if (req.file) updates.image = await storeUploadedImage(req.file);

    const product = await productStore.updateProduct(req.params.id, updates);
    if (!product) return res.status(404).json({ error: 'Ürün bulunamadı' });
    res.json(product);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Ürün sil
router.delete('/:id', adminAuth.requireAuth, async (req, res) => {
  const ok = await productStore.deleteProduct(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Ürün bulunamadı' });
  res.json({ ok: true });
});

// Toplu resim atama — seçilen ürünlerin hepsine aynı resmi uygular
router.post('/bulk-image', adminAuth.requireAuth, upload.single('image'), async (req, res) => {
  try {
    const { productIds } = req.body;
    const ids = JSON.parse(productIds || '[]');
    if (!ids.length) return res.status(400).json({ error: 'Ürün seçilmedi' });
    if (!req.file) return res.status(400).json({ error: 'Resim dosyası gerekli' });

    const image = await storeUploadedImage(req.file);
    let updated = 0;
    for (const id of ids) {
      const result = await productStore.updateProduct(id, { image });
      if (result) updated++;
    }
    res.json({ updated, image });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Toplu düzenleme — seçilen ürünlerin kategori/alt kategori/açıklamasını aynı anda değiştirir
router.post('/bulk-edit', adminAuth.requireAuth, async (req, res) => {
  const { productIds, category, subcategory, description } = req.body;
  if (!productIds || !productIds.length) return res.status(400).json({ error: 'Ürün seçilmedi' });

  const updates = {};
  if (category !== undefined && category !== '') updates.category = category;
  if (subcategory !== undefined && subcategory !== '') updates.subcategory = subcategory;
  if (description !== undefined && description !== '') updates.description = description;
  if (!Object.keys(updates).length) return res.status(400).json({ error: 'Değiştirilecek bir alan gerekli' });

  let updated = 0;
  for (const id of productIds) {
    const result = await productStore.updateProduct(id, updates);
    if (result) updated++;
  }
  res.json({ updated });
});

// Toplu fiyat güncelleme — yüzde artış/azalış, sabit tutar ekleme, ya da tüm boyutlara sabit fiyat
router.post('/bulk-price', adminAuth.requireAuth, async (req, res) => {
  const { productIds, mode, value } = req.body; // mode: 'percent' | 'amount' | 'set'
  if (!productIds || !productIds.length) return res.status(400).json({ error: 'Ürün seçilmedi' });
  const num = Number(value);
  if (isNaN(num)) return res.status(400).json({ error: 'Geçersiz değer' });

  const allProducts = await productStore.loadProducts();
  let updated = 0;

  for (const id of productIds) {
    const product = allProducts.find((p) => p.id === id);
    if (!product) continue;

    const newSizes = product.sizes.map((s) => {
      let newPrice = s.price;
      if (mode === 'percent') newPrice = s.price * (1 + num / 100);
      else if (mode === 'amount') newPrice = s.price + num;
      else if (mode === 'set') newPrice = num;
      return { ...s, price: Math.max(0, Math.round(newPrice * 100) / 100) };
    });

    await productStore.updateProduct(id, { sizes: newSizes });
    updated++;
  }
  res.json({ updated });
});

// Ürünleri sürükle-bırakla belirlenen yeni sıraya göre dizer (aynı kategori içinde)
router.post('/reorder', adminAuth.requireAuth, async (req, res) => {
  const { orderedIds } = req.body;
  if (!orderedIds || !orderedIds.length) return res.status(400).json({ error: 'Sıra listesi gerekli' });
  await productStore.reorderCategory(orderedIds);
  res.json({ ok: true });
});

module.exports = router;
