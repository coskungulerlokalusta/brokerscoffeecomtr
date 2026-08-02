// Instagram DM sohbetlerini saklar — admin panelde "Instagram Gelen Kutusu" için.
const kv = require('./kvStore');

const KEY = 'instagram_conversations';

async function loadConversations() {
  return kv.getJSON(KEY, {}); // { [igsid]: { name, messages: [{direction, text, timestamp}] } }
}

async function saveConversations(data) {
  return kv.setJSON(KEY, data);
}

async function addMessage(igsid, { direction, text, name }) {
  const data = await loadConversations();
  if (!data[igsid]) {
    data[igsid] = { name: name || igsid, messages: [] };
  }
  if (name && data[igsid].name === igsid) data[igsid].name = name;
  data[igsid].messages.push({ direction, text, timestamp: new Date().toISOString() });
  await saveConversations(data);
  return data[igsid];
}

async function listConversations() {
  const data = await loadConversations();
  return Object.keys(data).map((igsid) => {
    const convo = data[igsid];
    const last = convo.messages[convo.messages.length - 1];
    return {
      igsid,
      name: convo.name,
      lastMessage: last ? last.text : '',
      lastTimestamp: last ? last.timestamp : null,
      messageCount: convo.messages.length,
    };
  }).sort((a, b) => new Date(b.lastTimestamp || 0) - new Date(a.lastTimestamp || 0));
}

async function getConversation(igsid) {
  const data = await loadConversations();
  return data[igsid] || null;
}

module.exports = { addMessage, listConversations, getConversation };
