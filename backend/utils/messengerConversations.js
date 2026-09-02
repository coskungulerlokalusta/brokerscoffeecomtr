// Messenger DM sohbetlerini saklar — admin panelde "Messenger Gelen Kutusu" için.
const kv = require('./kvStore');

const KEY = 'messenger_conversations';

async function loadConversations() {
  return kv.getJSON(KEY, {}); // { [psid]: { name, messages: [{direction, text, timestamp}] } }
}

async function saveConversations(data) {
  return kv.setJSON(KEY, data);
}

async function addMessage(psid, { direction, text, name }) {
  const data = await loadConversations();
  if (!data[psid]) {
    data[psid] = { name: name || psid, messages: [] };
  }
  if (name && data[psid].name === psid) data[psid].name = name;
  data[psid].messages.push({ direction, text, timestamp: new Date().toISOString() });
  await saveConversations(data);
  return data[psid];
}

async function listConversations() {
  const data = await loadConversations();
  return Object.keys(data).map((psid) => {
    const convo = data[psid];
    const last = convo.messages[convo.messages.length - 1];
    return {
      psid,
      name: convo.name,
      lastMessage: last ? last.text : '',
      lastTimestamp: last ? last.timestamp : null,
      messageCount: convo.messages.length,
    };
  }).sort((a, b) => new Date(b.lastTimestamp || 0) - new Date(a.lastTimestamp || 0));
}

async function getConversation(psid) {
  const data = await loadConversations();
  return data[psid] || null;
}

module.exports = { addMessage, listConversations, getConversation };
