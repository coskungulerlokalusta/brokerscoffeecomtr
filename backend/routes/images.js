const express = require('express');
const router = express.Router();
const imageStore = require('../utils/imageStore');

router.get('/:id', async (req, res) => {
  const image = await imageStore.getImage(req.params.id);
  if (!image) return res.status(404).send('Resim bulunamadı');
  res.set('Content-Type', image.mime);
  res.set('Cache-Control', 'public, max-age=31536000'); // resimler değişmez, uzun süre önbelleklenebilir
  res.send(image.buffer);
});

module.exports = router;
