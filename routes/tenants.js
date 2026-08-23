import express from 'express';
import pool from '../db.js';

const router = express.Router();

// NOT: Buradaki eski, korumasız "/register" uç noktası kaldırıldı — herkesin
// kimlik doğrulamadan yeni şube açabilmesine izin veriyordu (güvenlik açığı).
// Yeni şube oluşturma artık sadece süper admin panelinden (routes/admin.js →
// POST /api/admin/tenants, requireSuperAdmin korumalı) yapılabiliyor.

export default router;
