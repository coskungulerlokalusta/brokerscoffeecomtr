// Her işletme (tenant) için, o an bağlı olan kasa/ekran istemcilerinin
// Server-Sent Events (SSE) bağlantılarını tutar. Menü değiştiğinde (ürün
// eklendi/silindi/fiyat değişti) tüm bağlı istemcilere anında haber verir —
// polling'in aksine saniyenin altında iletilir, sunucuya da az yük biner
// (sadece küçük bir "değişti" sinyali gönderiliyor, veri değil).

const clientsByTenant = new Map(); // tenantId -> Set<res>

export function addClient(tenantId, res) {
  if (!clientsByTenant.has(tenantId)) clientsByTenant.set(tenantId, new Set());
  clientsByTenant.get(tenantId).add(res);
}

export function removeClient(tenantId, res) {
  const set = clientsByTenant.get(tenantId);
  if (set) {
    set.delete(res);
    if (set.size === 0) clientsByTenant.delete(tenantId);
  }
}

export function broadcastMenuChanged(tenantId) {
  const set = clientsByTenant.get(tenantId);
  if (!set) return;
  for (const res of set) {
    try { res.write(`event: menu_changed\ndata: {}\n\n`); } catch (e) { /* bağlantı kopmuşsa sessiz geç */ }
  }
}

export function broadcastNewOrder(tenantId) {
  const set = clientsByTenant.get(tenantId);
  if (!set) return;
  for (const res of set) {
    try { res.write(`event: new_order\ndata: {}\n\n`); } catch (e) { /* bağlantı kopmuşsa sessiz geç */ }
  }
}
