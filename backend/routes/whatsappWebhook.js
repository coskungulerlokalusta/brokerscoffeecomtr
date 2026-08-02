const express = require('express');
const router = express.Router();
const integrations = require('../utils/integrations');
const whatsappConversations = require('../utils/whatsappConversations');
const customerAuth = require('../utils/customerAuth');
const settings = require('../utils/settings');
const aiAssistant = require('../utils/aiAssistant');
const whatsapp = require('../utils/whatsapp');

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
router.post('/whatsapp', async (req, res) => {
  try {
    const entry = req.body.entry && req.body.entry[0];
    const change = entry && entry.changes && entry.changes[0];
    const value = change && change.value;
    const message = value && value.messages && value.messages[0];

    if (message) {
      const phone = message.from; // 90XXXXXXXXXX formatında
      const text = message.text ? message.text.body : '[metin olmayan içerik]';
      const contactName = value.contacts && value.contacts[0] && value.contacts[0].profile
        ? value.contacts[0].profile.name
        : null;

      // Kayıtlı bir üyeyse gerçek adını kullan
      let displayName = contactName;
      try {
        const customer = await customerAuth.findByPhone(phone);
        if (customer) displayName = customer.name;
      } catch (e) {}

      const convo = await whatsappConversations.addMessage(phone, { direction: 'in', text, name: displayName });
      console.log(`WhatsApp mesajı alındı: ${phone} → "${text}"`);

      // Otomatik AI cevabı (ayarlarda açıksa)
      try {
        const currentSettings = await settings.loadSettings();
        if (currentSettings.aiAutoReplyEnabled && currentSettings.aiInstructions) {
          const reply = await aiAssistant.generateAutoReply(currentSettings.aiInstructions, convo.messages, text);
          await whatsapp.sendTextMessage(phone, reply);
          await whatsappConversations.addMessage(phone, { direction: 'out', text: reply });
        }
      } catch (aiErr) {
        console.error('WhatsApp otomatik cevap hatası:', aiErr.message);
      }
    }
  } catch (err) {
    console.error('WhatsApp webhook işleme hatası:', err.message);
  }
  // Meta 20 saniye içinde 200 bekliyor, aksi halde tekrar dener
  res.sendStatus(200);
});

module.exports = router;
