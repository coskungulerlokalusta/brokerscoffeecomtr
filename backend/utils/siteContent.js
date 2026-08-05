const kv = require('./kvStore');

const KEY = 'site_content';
const KEYS = ['logo', 'heroImg', 'aboutImg1', 'aboutImg2', 'locationImg1', 'locationImg2'];

const FEATURED_DEFAULTS = { featuredTitle: 'Öne Çıkanlar', featuredProductIds: [] };

async function load() {
  const data = await kv.getJSON(KEY, {});
  return { ...FEATURED_DEFAULTS, ...data };
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

async function setFeaturedConfig({ featuredTitle, featuredProductIds }) {
  const data = await load();
  if (featuredTitle !== undefined) data.featuredTitle = featuredTitle;
  if (featuredProductIds !== undefined) data.featuredProductIds = featuredProductIds;
  await save(data);
  return data;
}

module.exports = { load, save, setImage, setFeaturedConfig, KEYS };
