const express = require('express');
const router = express.Router();
const integrations = require('../utils/integrations');
const messengerConversations = require('../utils/messengerConversations');
const settings = require('../utils/settings');
const aiAssistant = require('../utils/aiAssistant');
const messenger = require('../utils/messenger');

// Meta, webhook'u kaydederken bu adrese GET isteği atıp doğrulama yapar.
router.get('/messenger', async (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const creds = await integrations.getProviderCredentials('messenger');
  const expectedToken = creds && creds.verifyToken;

  if (mode === 'subscribe' && token && expectedToken && token === expectedToken) {
    console.log('Messenger webhook doğrulandı');
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// Gelen Messenger mesajları buraya POST edilir
router.post('/messenger', async (req, res) => {
  try {
    const entry = req.body.entry && req.body.entry[0];
    const messagingEvent = entry && entry.messaging && entry.messaging[0];
    const message = messagingEvent && messagingEvent.message;

    if (message && !message.is_echo) {
      const psid = messagingEvent.sender.id;
      const text = message.text || '[metin olmayan içerik]';
      const convo = await messengerConversations.addMessage(psid, { direction: 'in', text });
      console.log(`Messenger mesajı alındı: ${psid} → "${text}"`);

      try {
        const currentSettings = await settings.loadSettings();
        if (currentSettings.aiAutoReplyEnabled && currentSettings.aiInstructions) {
          const reply = await aiAssistant.generateAutoReply(currentSettings.aiInstructions, convo.messages, text);
          await messenger.sendMessage(psid, reply);
          await messengerConversations.addMessage(psid, { direction: 'out', text: reply });
        }
      } catch (aiErr) {
        console.error('Messenger otomatik cevap hatası:', aiErr.message);
      }
    }
  } catch (err) {
    console.error('Messenger webhook işleme hatası:', err.message);
  }
  res.sendStatus(200);
});

module.exports = router;
