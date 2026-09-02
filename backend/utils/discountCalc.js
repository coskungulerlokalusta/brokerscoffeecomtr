// Sepetteki ürünleri gruplarına/özel personel fiyatlarına göre indirime tabi tutar.
// Hem kart ödemesi hem "mağazada öde" akışı tarafından ortak kullanılır.
const settings = require('./settings');
const productStore = require('./productStore');
const { getGroupForProduct, DEFAULT_GROUP_KEY } = require('./discountGroups');
const monthlyTiers = require('./monthlyTiers');

async function calculateDiscount(items, isStaff, options = {}) {
  const { customerId, useMonthlyTier } = options;
  const subtotal = items.reduce((sum, item) => sum + Number(item.price) * Number(item.qty), 0);
  let discountAmount = 0;
  let discountBreakdown = [];

  if (isStaff) {
    const currentSettings = await settings.loadSettings();
    const allProducts = await productStore.loadProducts();
    const groupTotals = {};

    for (const item of items) {
      const product = allProducts.find((p) => p.id === item.productId);
      const lineQty = Number(item.qty);
      const linePrice = Number(item.price);

      const matchedSize = product && product.sizes.find((s) => (s.label || '') === (item.size || ''));
      if (matchedSize && matchedSize.staffPrice !== undefined && matchedSize.staffPrice !== null && matchedSize.staffPrice !== '') {
        const staffPrice = Number(matchedSize.staffPrice);
        const amount = Math.max(0, (linePrice - staffPrice)) * lineQty;
        discountAmount += amount;
        if (amount > 0) discountBreakdown.push({ group: 'ozel', percent: null, amount: Math.round(amount * 100) / 100 });
        continue;
      }

      const group = product ? getGroupForProduct(product) : DEFAULT_GROUP_KEY;
      const lineTotal = linePrice * lineQty;
      groupTotals[group] = (groupTotals[group] || 0) + lineTotal;
    }

    Object.keys(groupTotals).forEach((group) => {
      const pct = currentSettings.staffDiscountByGroup[group] ?? 0;
      const amount = groupTotals[group] * (pct / 100);
      discountAmount += amount;
      if (amount > 0) discountBreakdown.push({ group, percent: pct, amount: Math.round(amount * 100) / 100 });
    });
  }

  let appliedTier = null;
  if (customerId && useMonthlyTier) {
    const tier = await monthlyTiers.getUnclaimedTier(customerId, isStaff);
    if (tier) {
      discountAmount += tier.discount;
      discountBreakdown.push({ group: 'aylik', percent: null, amount: tier.discount });
      appliedTier = tier;
    }
  }

  const total = Math.round((subtotal - discountAmount) * 100) / 100;
  return { subtotal, discountAmount: Math.round(discountAmount * 100) / 100, discountBreakdown, total: Math.max(0, total), appliedTier };
}

module.exports = { calculateDiscount };
