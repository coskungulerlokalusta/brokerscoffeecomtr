const express = require('express');
const router = express.Router();
const integrations = require('../utils/integrations');
const instagramConversations = require('../utils/instagramConversations');

// Meta, webhook'u kaydederken bu adrese GET isteği atıp doğrulama yapar.
router.get('/instagram', async (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const creds = await integrations.getProviderCredentials('instagram');
  const expectedToken = creds && creds.verifyToken;

  if (mode === 'subscribe' && token && expectedToken && token === expectedToken) {
    console.log('Instagram webhook doğrulandı');
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// Gelen Instagram DM'leri buraya POST edilir (Messenger platformuyla aynı format:
// entry[].messaging[].sender.id + message.text)
router.post('/instagram', async (req, res) => {
  try {
    const entry = req.body.entry && req.body.entry[0];
    const messagingEvent = entry && entry.messaging && entry.messaging[0];
    const message = messagingEvent && messagingEvent.message;

    if (message && !message.is_echo) {
      const igsid = messagingEvent.sender.id;
      const text = message.text || '[metin olmayan içerik]';
      await instagramConversations.addMessage(igsid, { direction: 'in', text });
      console.log(`Instagram mesajı alındı: ${igsid} → "${text}"`);
    }
  } catch (err) {
    console.error('Instagram webhook işleme hatası:', err.message);
  }
  res.sendStatus(200);
});

module.exports = router;
