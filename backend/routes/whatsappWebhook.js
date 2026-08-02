const express = require('express');
const router = express.Router();
const integrations = require('../utils/integrations');

// Meta, webhook'u kaydederken bu adrese GET isteği atıp doğrulama yapar.
// hub.verify_token, panelde kayıtlı "Doğrulama Anahtarı (Verify Token)" ile eşleşmeli.
router.get('/whatsapp', async (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const creds = await integrations.getProviderCredentials('whatsapp');
  const expectedToken = creds && creds.verifyToken;

  if (mode === 'subscribe' && token && expectedToken && token === expectedToken) {
    console.log('WhatsApp webhook doğrulandı');
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// Gelen mesajlar / durum güncellemeleri buraya POST edilir.
// Şimdilik sadece loglar — ileride otomatik sohbet/sipariş botu buraya bağlanacak.
router.post('/whatsapp', (req, res) => {
  try {
    const entry = req.body.entry && req.body.entry[0];
    const change = entry && entry.changes && entry.changes[0];
    const value = change && change.value;
    const message = value && value.messages && value.messages[0];

    if (message) {
      console.log(`WhatsApp mesajı alındı: ${message.from} → "${message.text ? message.text.body : '[metin değil]'}"`);
    }
  } catch (err) {
    console.error('WhatsApp webhook işleme hatası:', err.message);
  }
  // Meta 20 saniye içinde 200 bekliyor, aksi halde tekrar dener
  res.sendStatus(200);
});

module.exports = router;
