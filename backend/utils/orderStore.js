const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const ORDERS_FILE = path.join(__dirname, '..', '..', 'data', 'orders.json');

function loadOrders() {
  if (!fs.existsSync(ORDERS_FILE)) return [];
  return JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf-8'));
}

function saveOrders(orders) {
  fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2), 'utf-8');
}

function createOrder(data) {
  const orders = loadOrders();
  const order = {
    id: uuidv4(),
    items: data.items,
    customerName: data.customerName,
    phone: data.phone,
    deliveryType: data.deliveryType, // 'gel-al' | 'kurye'
    address: data.address || null,
    total: data.total,
    paymentStatus: 'bekliyor', // bekliyor | odendi | iade
    orderStatus: 'yeni', // yeni | hazirlaniyor | hazir | teslim-edildi | iptal
    createdAt: new Date().toISOString(),
  };
  orders.unshift(order);
  saveOrders(orders);
  return order;
}

function updateOrderStatus(id, orderStatus) {
  const orders = loadOrders();
  const order = orders.find((o) => o.id === id);
  if (!order) return null;
  order.orderStatus = orderStatus;
  saveOrders(orders);
  return order;
}

module.exports = { loadOrders, saveOrders, createOrder, updateOrderStatus };
