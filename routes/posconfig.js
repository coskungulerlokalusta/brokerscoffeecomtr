import express from 'express';
import pool from '../db.js';
import { requireAuth, requireFeature } from '../middleware/auth.js';

const router = express.Router();
router.use(requireAuth);
router.use(requireFeature('pos_connection'));

router.get('/', async (req, res) => {
  const [[row]] = await pool.query('SELECT * FROM pos_terminal_config WHERE tenant_id = ?', [req.tenantId]);
  res.json(row || { device_name:'', marka: 'INGENICO', model: 'MOVE5000F', seri_no: '', sicil_no: '', pos_sifresi: '', ip: '', port: 7500, connection_type: 'ethernet' });
});

router.put('/', async (req, res) => {
  const { device_name, marka, model, seri_no, sicil_no, pos_sifresi, ip, port, connection_type } = req.body;
  try {
    await pool.query(
      `INSERT INTO pos_terminal_config (tenant_id, device_name, marka, model, seri_no, sicil_no, pos_sifresi, ip, port, connection_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE device_name=VALUES(device_name), marka=VALUES(marka), model=VALUES(model), seri_no=VALUES(seri_no),
         sicil_no=VALUES(sicil_no), pos_sifresi=VALUES(pos_sifresi), ip=VALUES(ip), port=VALUES(port),
         connection_type=VALUES(connection_type), updated_at=NOW()`,
      [req.tenantId, device_name, marka, model, seri_no, sicil_no, pos_sifresi, ip, port || 7500, connection_type || 'ethernet']
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Kaydedilemedi', detail: e.message });
  }
});

export default router;
