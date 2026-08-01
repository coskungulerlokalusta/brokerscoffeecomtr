// Genel amaçlı, kalıcı key-value depo. Her mevcut JSON dosyası burada bir "anahtar"a karşılık gelir.
const { getPool, ensureSchema } = require('./db');

async function getJSON(key, defaultValue) {
  await ensureSchema();
  const db = getPool();
  const [rows] = await db.query('SELECT value FROM kv_store WHERE store_key = ?', [key]);
  if (!rows.length) return defaultValue;
  try {
    return JSON.parse(rows[0].value);
  } catch {
    return defaultValue;
  }
}

async function setJSON(key, value) {
  await ensureSchema();
  const db = getPool();
  const json = JSON.stringify(value);
  await db.query(
    'INSERT INTO kv_store (store_key, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = ?',
    [key, json, json]
  );
  return value;
}

module.exports = { getJSON, setJSON };
