const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', '..', 'data', 'site-content.json');

const KEYS = ['heroImg', 'aboutImg1', 'aboutImg2', 'locationImg1', 'locationImg2'];

function load() {
  if (!fs.existsSync(FILE)) return {};
  return JSON.parse(fs.readFileSync(FILE, 'utf-8'));
}

function save(data) {
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2), 'utf-8');
}

function setImage(key, imagePath) {
  if (!KEYS.includes(key)) throw new Error('Bilinmeyen görsel alanı: ' + key);
  const data = load();
  data[key] = imagePath;
  save(data);
  return data;
}

module.exports = { load, save, setImage, KEYS };
