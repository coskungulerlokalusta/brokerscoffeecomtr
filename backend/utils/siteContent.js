const kv = require('./kvStore');

const KEY = 'site_content';
const KEYS = ['heroImg', 'aboutImg1', 'aboutImg2', 'locationImg1', 'locationImg2'];

async function load() {
  return kv.getJSON(KEY, {});
}

async function save(data) {
  return kv.setJSON(KEY, data);
}

async function setImage(key, imagePath) {
  if (!KEYS.includes(key)) throw new Error('Bilinmeyen görsel alanı: ' + key);
  const data = await load();
  data[key] = imagePath;
  await save(data);
  return data;
}

module.exports = { load, save, setImage, KEYS };
