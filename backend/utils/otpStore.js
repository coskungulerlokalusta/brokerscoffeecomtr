// Telefon doğrulama kodlarını geçici olarak tutar (bellek içi, 5 dakika geçerli)
const codes = new Map();
const TTL_MS = 5 * 60 * 1000;

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function setCode(phone) {
  const code = generateCode();
  codes.set(phone, { code, expires: Date.now() + TTL_MS, attempts: 0 });
  return code;
}

function verifyCode(phone, code) {
  const entry = codes.get(phone);
  if (!entry) return false;
  if (entry.expires < Date.now()) {
    codes.delete(phone);
    return false;
  }
  entry.attempts += 1;
  if (entry.attempts > 5) {
    codes.delete(phone);
    return false;
  }
  if (entry.code !== code) return false;
  codes.delete(phone);
  return true;
}

module.exports = { setCode, verifyCode };
