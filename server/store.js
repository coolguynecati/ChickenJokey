const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');

function ensureStore() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(ORDERS_FILE)) {
        fs.writeFileSync(ORDERS_FILE, '[]', 'utf8');
    }
}

function readOrders() {
    ensureStore();
    try {
        const raw = fs.readFileSync(ORDERS_FILE, 'utf8');
        const data = JSON.parse(raw);
        return Array.isArray(data) ? data : [];
    } catch {
        return [];
    }
}

function writeOrders(orders) {
    ensureStore();
    fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2), 'utf8');
}

function nextOrderNumber(orders) {
    const year = new Date().getFullYear();
    const prefix = `E${year}-`;
    const nums = orders
        .map((o) => o.orderNumber)
        .filter((n) => typeof n === 'string' && n.startsWith(prefix))
        .map((n) => Number(n.slice(prefix.length)) || 0);
    const next = (nums.length ? Math.max(...nums) : 0) + 1;
    return `${prefix}${String(next).padStart(4, '0')}`;
}

function createOrder(payload) {
    const orders = readOrders();
    const now = new Date().toISOString();
    const order = {
        id: crypto.randomUUID(),
        orderNumber: nextOrderNumber(orders),
        status: 'new',
        createdAt: now,
        updatedAt: now,
        customer: {
            name: String(payload.customer?.name || '').trim(),
            phone: String(payload.customer?.phone || '').trim(),
            email: String(payload.customer?.email || '').trim()
        },
        deliveryType: payload.deliveryType === 'pickup' ? 'pickup' : 'delivery',
        address: String(payload.address || '').trim(),
        addressExtra: String(payload.addressExtra || '').trim(),
        comment: String(payload.comment || '').trim(),
        paymentMethod: payload.paymentMethod === 'pickup' ? 'pickup' : 'sbp',
        promoCode: String(payload.promoCode || '').trim(),
        items: Array.isArray(payload.items) ? payload.items : [],
        total: Number(payload.total) || 0,
        managerNote: ''
    };

    orders.unshift(order);
    writeOrders(orders);
    return order;
}

function updateOrder(id, patch) {
    const orders = readOrders();
    const idx = orders.findIndex((o) => o.id === id);
    if (idx === -1) return null;

    const allowedStatus = new Set([
        'new', 'confirmed', 'cooking', 'delivery', 'done', 'cancelled'
    ]);

    if (patch.status && allowedStatus.has(patch.status)) {
        orders[idx].status = patch.status;
    }
    if (typeof patch.managerNote === 'string') {
        orders[idx].managerNote = patch.managerNote.trim();
    }

    orders[idx].updatedAt = new Date().toISOString();
    writeOrders(orders);
    return orders[idx];
}

function getOrder(id) {
    return readOrders().find((o) => o.id === id) || null;
}

module.exports = {
    readOrders,
    createOrder,
    updateOrder,
    getOrder
};
