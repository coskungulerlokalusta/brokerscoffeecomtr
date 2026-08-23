import jwt from 'jsonwebtoken';
import pool from '../db.js';

// Her istek, token içindeki tenant_id'ye göre filtrelenir.
// Bu sayede bir şubenin verisi asla başka bir şubeye sızmaz.
export function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Giriş gerekli' });
  }
  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.tenantId = payload.tenantId;
    req.userId = payload.userId;
    req.role = payload.role;
    req.permissions = payload.permissions || {};
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Geçersiz veya süresi dolmuş oturum' });
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.role)) {
      return res.status(403).json({ error: 'Bu işlem için yetkiniz yok' });
    }
    next();
  };
}

export function requirePermission(key) {
  return (req, res, next) => {
    if (req.role === 'owner' || (req.permissions && req.permissions[key])) return next();
    return res.status(403).json({ error: 'Bu işlem için yetkiniz yok' });
  };
}

// Özellik anahtarı (ai_assistant, market_modu, masa_servisi, pos_connection, reports)
// işletmenin paketinde açık değilse, panelde gizlenmesi yetmez — burada da
// sunucu tarafında gerçekten engellenir. Özellikle AI Asistan ve görsel
// üretme gibi gerçek para maliyeti olan uç noktalar için kritik.
export function requireFeature(key) {
  return async (req, res, next) => {
    try {
      const [[tenant]] = await pool.query('SELECT features FROM tenants WHERE id = ?', [req.tenantId]);
      const feats = tenant && tenant.features ? (typeof tenant.features === 'string' ? JSON.parse(tenant.features) : tenant.features) : {};
      // Mevcut özellikler için "belirtilmemişse açık" (geriye dönük uyumluluk),
      // yeni eklenenler (market_modu, masa_servisi) için "belirtilmemişse kapalı"
      const defaultOff = ['market_modu', 'masa_servisi', 'ai_image_generation', 'personel_indirimi'].includes(key);
      const enabled = defaultOff ? feats[key] === true : feats[key] !== false;
      if (!enabled) {
        return res.status(402).json({ error: 'Bu özellik işletme paketinizde aktif değil. Etkinleştirmek için bizimle iletişime geçin.' });
      }
      next();
    } catch (e) {
      res.status(500).json({ error: 'Yetki kontrolü başarısız', detail: e.message });
    }
  };
}
