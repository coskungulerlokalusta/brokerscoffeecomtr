// Yüklenen resimleri MySQL'de saklar (yerel disk dosyaları deploy'larda silinebiliyor).
// Her resim kv_store'da base64 olarak tutulur, /api/images/:id üzerinden servis edilir.
const crypto = require('crypto');
const kv = require('./kvStore');

const KEY_PREFIX = 'image:';

const MIME_BY_EXT = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

// buffer: multer'ın memoryStorage ile verdiği dosya içeriği, ext: '.jpg' gibi
async function saveImage(buffer, ext) {
  const id = crypto.randomUUID() + ext;
  const mime = MIME_BY_EXT[ext] || 'application/octet-stream';
  await kv.setJSON(KEY_PREFIX + id, { mime, data: buffer.toString('base64') });
  return `/api/images/${id}`;
}

async function getImage(id) {
  const record = await kv.getJSON(KEY_PREFIX + id, null);
  if (!record) return null;
  return { mime: record.mime, buffer: Buffer.from(record.data, 'base64') };
}

module.exports = { saveImage, getImage };
