// Brokers Coffee - paylaşılan sepet mantığı (localStorage tabanlı)
const CART_KEY = 'brokers_coffee_cart';

function getCart() {
  try {
    return JSON.parse(localStorage.getItem(CART_KEY)) || [];
  } catch (e) {
    return [];
  }
}

function saveCart(cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  updateCartBadge();
}

function addToCart(item) {
  // item: { productId, name, size, price, qty, extras, intensity, extraShot, note }
  const cart = getCart();
  const existing = cart.find(
    (c) => c.productId === item.productId
      && c.size === item.size
      && JSON.stringify(c.extras || []) === JSON.stringify(item.extras || [])
      && (c.intensity || 'normal') === (item.intensity || 'normal')
      && !!c.extraShot === !!item.extraShot
      && (c.note || '') === (item.note || '')
  );
  if (existing) {
    existing.qty += item.qty || 1;
  } else {
    cart.push({ ...item, qty: item.qty || 1 });
  }
  saveCart(cart);
}

function removeFromCart(index) {
  const cart = getCart();
  cart.splice(index, 1);
  saveCart(cart);
}

function updateQty(index, qty) {
  const cart = getCart();
  if (cart[index]) {
    cart[index].qty = Math.max(1, qty);
    saveCart(cart);
  }
}

function cartTotal() {
  return getCart().reduce((sum, item) => sum + item.price * item.qty, 0);
}

function cartCount() {
  return getCart().reduce((sum, item) => sum + item.qty, 0);
}

function updateCartBadge() {
  const badge = document.querySelector('[data-cart-badge]');
  if (badge) {
    const count = cartCount();
    badge.textContent = count;
    badge.classList.toggle('hidden', count === 0);
  }
}

document.addEventListener('DOMContentLoaded', updateCartBadge);
