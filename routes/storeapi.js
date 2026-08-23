import express from 'express';
import crypto from 'crypto';
import pool from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const [[row]] = await pool.query('SELECT store_api_key FROM tenants WHERE id = ?', [req.tenantId]);
  res.json({ apiKey: row?.store_api_key || null });
});

router.post('/generate', async (req, res) => {
  const key = crypto.randomBytes(24).toString('hex');
  await pool.query('UPDATE tenants SET store_api_key = ? WHERE id = ?', [key, req.tenantId]);
  res.json({ apiKey: key });
});

export default router;
