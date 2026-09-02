// WhatsApp sohbetlerini (gelen + giden mesajlar) saklar — admin panelde "Gelen Kutusu" için.
const kv = require('./kvStore');

const KEY = 'whatsapp_conversations';

async function loadConversations() {
  return kv.getJSON(KEY, {}); // { [phone]: { name, messages: [{direction, text, timestamp}] } }
}

async function saveConversations(data) {
  return kv.setJSON(KEY, data);
}

async function addMessage(phone, { direction, text, name }) {
  const data = await loadConversations();
  if (!data[phone]) {
    data[phone] = { name: name || phone, messages: [] };
  }
  if (name && !data[phone].name) data[phone].name = name;
  data[phone].messages.push({ direction, text, timestamp: new Date().toISOString() });
  await saveConversations(data);
  return data[phone];
}

async function listConversations() {
  const data = await loadConversations();
  return Object.keys(data).map((phone) => {
    const convo = data[phone];
    const last = convo.messages[convo.messages.length - 1];
    return {
      phone,
      name: convo.name,
      lastMessage: last ? last.text : '',
      lastTimestamp: last ? last.timestamp : null,
      messageCount: convo.messages.length,
    };
  }).sort((a, b) => new Date(b.lastTimestamp || 0) - new Date(a.lastTimestamp || 0));
}

async function getConversation(phone) {
  const data = await loadConversations();
  return data[phone] || null;
}

module.exports = { addMessage, listConversations, getConversation };
