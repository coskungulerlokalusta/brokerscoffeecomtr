// "Yedikçe İndirim Kazan" tarzı, ay içinde sıfırlanan kademeli harcama kampanyası.
// Müşteri o ay ne kadar harcadığına göre kademeli indirim kazanır, kazandığı
// indirimi bir sonraki siparişinde kullanabilir. Her ay başında sıfırlanır.
const kv = require('./kvStore');
const orderStore = require('./orderStore');
const settings = require('./settings');

const CLAIMED_KEY = 'monthly_tier_claims'; // { [customerId]: { [yyyy-mm]: [threshold, threshold, ...] } }

function currentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

async function loadClaims() {
  return kv.getJSON(CLAIMED_KEY, {});
}

async function saveClaims(data) {
  return kv.setJSON(CLAIMED_KEY, data);
}

// Müşterinin bu ay (ödenmiş/mağazada öde siparişleri dahil, iptal hariç) toplam harcaması
async function getMonthlySpend(customerId) {
  if (!customerId) return 0;
  const monthKey = currentMonthKey();
  const orders = await orderStore.loadOrders();
  return orders
    .filter((o) => o.customerId === customerId && o.orderStatus !== 'iptal' && o.createdAt.startsWith(monthKey))
    .reduce((sum, o) => sum + Number(o.total), 0);
}

function tiersForAudience(currentSettings, isStaff) {
  const view = currentSettings.audienceSettings[isStaff ? 'staff' : 'customer'];
  return view.monthlySpendTiers || [];
}

// Müşterinin bu ay ulaştığı ama henüz kullanmadığı en yüksek kademeyi döner (varsa)
async function getUnclaimedTier(customerId, isStaff) {
  if (!customerId) return null;
  const currentSettings = await settings.loadSettings();
  const tiers = [...tiersForAudience(currentSettings, isStaff)].sort((a, b) => b.threshold - a.threshold);
  const spend = await getMonthlySpend(customerId);
  const monthKey = currentMonthKey();
  const claims = await loadClaims();
  const claimedThresholds = (claims[customerId] && claims[customerId][monthKey]) || [];

  for (const tier of tiers) {
    if (spend >= tier.threshold && !claimedThresholds.includes(tier.threshold)) {
      return tier;
    }
  }
  return null;
}

// Bir kademeyi "kullanıldı" olarak işaretler (siparişte indirim uygulandığında çağrılır)
async function claimTier(customerId, threshold) {
  const monthKey = currentMonthKey();
  const claims = await loadClaims();
  if (!claims[customerId]) claims[customerId] = {};
  if (!claims[customerId][monthKey]) claims[customerId][monthKey] = [];
  if (!claims[customerId][monthKey].includes(threshold)) {
    claims[customerId][monthKey].push(threshold);
  }
  await saveClaims(claims);
}

// Hesabım/Sadakat sayfasında ilerleme çubuğu için tüm bilgiyi tek seferde döner
async function getProgress(customerId, isStaff) {
  const currentSettings = await settings.loadSettings();
  const tiers = [...tiersForAudience(currentSettings, isStaff)].sort((a, b) => a.threshold - b.threshold);
  const spend = await getMonthlySpend(customerId);
  const monthKey = currentMonthKey();
  const claims = await loadClaims();
  const claimedThresholds = (claims[customerId] && claims[customerId][monthKey]) || [];

  const nextTier = tiers.find((t) => spend < t.threshold) || null;
  const unclaimedTier = await getUnclaimedTier(customerId, isStaff);

  return {
    spend,
    tiers: tiers.map((t) => ({ ...t, reached: spend >= t.threshold, claimed: claimedThresholds.includes(t.threshold) })),
    nextTier,
    unclaimedTier,
  };
}

module.exports = { getMonthlySpend, getUnclaimedTier, claimTier, getProgress };
