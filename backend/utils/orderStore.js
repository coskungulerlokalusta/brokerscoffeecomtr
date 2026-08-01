const { v4: uuidv4 } = require('uuid');
const kv = require('./kvStore');

const KEY = 'orders';

async function loadOrders() {
  return kv.getJSON(KEY, []);
}

async function saveOrders(orders) {
  return kv.setJSON(KEY, orders);
}

async function createOrder(data) {
  const orders = await loadOrders();
  const order = {
    id: uuidv4(),
    items: data.items,
    customerName: data.customerName,
    phone: data.phone,
    deliveryType: data.deliveryType,
    address: data.address || null,
    total: data.total,
    paymentStatus: 'bekliyor',
    orderStatus: 'yeni',
    createdAt: new Date().toISOString(),
  };
  orders.unshift(order);
  await saveOrders(orders);
  return order;
}

async function updateOrderStatus(id, orderStatus) {
  const orders = await loadOrders();
  const order = orders.find((o) => o.id === id);
  if (!order) return null;
  order.orderStatus = orderStatus;
  await saveOrders(orders);
  return order;
}

module.exports = { loadOrders, saveOrders, createOrder, updateOrderStatus };
