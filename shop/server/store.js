const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
const EMAILS_FILE = path.join(DATA_DIR, 'emails.json');
const DELETED_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CANCEL_REASONS = new Set(['guest_cancelled', 'guest_no_pickup']);

function ensureStore() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(ORDERS_FILE)) {
        fs.writeFileSync(ORDERS_FILE, '[]', 'utf8');
    }
    if (!fs.existsSync(EMAILS_FILE)) {
        fs.writeFileSync(EMAILS_FILE, '[]', 'utf8');
    }
}

function purgeExpiredDeleted(orders) {
    const now = Date.now();
    const next = orders.filter((o) => {
        if (!o.deletedAt) return true;
        return now - new Date(o.deletedAt).getTime() < DELETED_TTL_MS;
    });
    if (next.length !== orders.length) writeOrders(next);
    return next;
}

function readOrders() {
    ensureStore();
    try {
        const raw = fs.readFileSync(ORDERS_FILE, 'utf8');
        const data = JSON.parse(raw);
        const orders = Array.isArray(data) ? data : [];
        return purgeExpiredDeleted(orders);
    } catch {
        return [];
    }
}

function cancelReasonLabel(reason) {
    if (reason === 'guest_cancelled') return 'Гость отменил';
    if (reason === 'guest_no_pickup') return 'Гость не забрал заказ';
    return '';
}

function writeOrders(orders) {
    ensureStore();
    fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2), 'utf8');
}

function readEmails() {
    ensureStore();
    try {
        const raw = fs.readFileSync(EMAILS_FILE, 'utf8');
        const data = JSON.parse(raw);
        return Array.isArray(data) ? data : [];
    } catch {
        return [];
    }
}

function writeEmails(emails) {
    ensureStore();
    fs.writeFileSync(EMAILS_FILE, JSON.stringify(emails, null, 2), 'utf8');
}

function normalizeEmail(value) {
    return String(value || '').trim().toLowerCase();
}

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function saveCustomerEmail(email, meta = {}) {
    const normalized = normalizeEmail(email);
    if (!normalized || !isValidEmail(normalized)) return null;

    const emails = readEmails();
    const now = new Date().toISOString();
    const existing = emails.find((entry) => normalizeEmail(entry.email) === normalized);

    if (existing) {
        existing.updatedAt = now;
        if (meta.orderId) existing.lastOrderId = meta.orderId;
        if (meta.orderNumber) existing.lastOrderNumber = meta.orderNumber;
        if (meta.name) existing.name = meta.name;
        if (meta.phone) existing.phone = meta.phone;
    } else {
        emails.unshift({
            email: normalized,
            name: String(meta.name || '').trim(),
            phone: String(meta.phone || '').trim(),
            firstOrderId: meta.orderId || '',
            firstOrderNumber: meta.orderNumber || '',
            lastOrderId: meta.orderId || '',
            lastOrderNumber: meta.orderNumber || '',
            source: 'checkout',
            createdAt: now,
            updatedAt: now
        });
    }

    writeEmails(emails);
    return normalized;
}

const LOCATIONS = new Set(['eat-arena', 'poselok']);

function normalizeLocation(value) {
    const v = String(value || '').trim().toLowerCase();
    if (v === 'poselok' || v === 'посёлок' || v === 'поселок') return 'poselok';
    return 'eat-arena';
}

function resolveLocation(order) {
    if (order?.location && LOCATIONS.has(order.location)) return order.location;
    const hay = `${order?.address || ''} ${order?.comment || ''}`.toLowerCase();
    if (hay.includes('развилка') || hay.includes('посёлок') || hay.includes('поселок') || hay.includes('5539')) {
        return 'poselok';
    }
    return 'eat-arena';
}

function locationLabel(location) {
    return location === 'poselok' ? 'Посёлок' : 'Eat Arena';
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
        location: normalizeLocation(payload.location),
        address: String(payload.address || '').trim(),
        addressExtra: String(payload.addressExtra || '').trim(),
        comment: String(payload.comment || '').trim(),
        paymentMethod: payload.paymentMethod === 'transfer' ? 'transfer' : 'counter',
        pickupTimeMode: ['asap', 'hour', 'at'].includes(payload.pickupTimeMode)
            ? payload.pickupTimeMode
            : 'asap',
        pickupTimeAt: String(payload.pickupTimeAt || '').trim(),
        promoCode: String(payload.promoCode || '').trim(),
        items: Array.isArray(payload.items) ? payload.items : [],
        total: Number(payload.total) || 0,
        managerNote: ''
    };

    orders.unshift(order);
    writeOrders(orders);
    saveCustomerEmail(order.customer?.email, {
        orderId: order.id,
        orderNumber: order.orderNumber,
        name: order.customer?.name,
        phone: order.customer?.phone
    });
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
        const now = new Date().toISOString();
        if (patch.status === 'cooking' && !orders[idx].cookingAt) {
            orders[idx].cookingAt = now;
        }
        if (patch.status === 'done') {
            orders[idx].archivedAt = now;
        }
        if (patch.status === 'cancelled') {
            orders[idx].cancelledAt = now;
            if (patch.cancelReason && CANCEL_REASONS.has(patch.cancelReason)) {
                orders[idx].cancelReason = patch.cancelReason;
            }
        }
    }
    if (typeof patch.managerNote === 'string') {
        orders[idx].managerNote = patch.managerNote.trim();
    }
    if (patch.location) {
        orders[idx].location = normalizeLocation(patch.location);
    }

    orders[idx].updatedAt = new Date().toISOString();
    writeOrders(orders);
    return orders[idx];
}

function getOrder(id) {
    return readOrders().find((o) => o.id === id) || null;
}

function softDeleteOrder(id) {
    const orders = readOrders();
    const idx = orders.findIndex((o) => o.id === id);
    if (idx === -1 || orders[idx].deletedAt) return false;
    const now = new Date().toISOString();
    orders[idx].deletedAt = now;
    orders[idx].updatedAt = now;
    writeOrders(orders);
    return true;
}

function softDeleteOrders(ids) {
    const set = new Set(Array.isArray(ids) ? ids : []);
    const orders = readOrders();
    const now = new Date().toISOString();
    let count = 0;
    orders.forEach((order, idx) => {
        if (!set.has(order.id) || order.deletedAt) return;
        orders[idx].deletedAt = now;
        orders[idx].updatedAt = now;
        count += 1;
    });
    if (count) writeOrders(orders);
    return count;
}

function bulkUpdateStatus(ids, status) {
    const set = new Set(Array.isArray(ids) ? ids : []);
    const allowedStatus = new Set([
        'new', 'confirmed', 'cooking', 'delivery', 'done', 'cancelled'
    ]);
    if (!allowedStatus.has(status)) return [];

    const orders = readOrders();
    const now = new Date().toISOString();
    const updated = [];

    orders.forEach((order, idx) => {
        if (!set.has(order.id)) return;
        orders[idx].status = status;
        orders[idx].updatedAt = now;
        if (status === 'cooking' && !orders[idx].cookingAt) orders[idx].cookingAt = now;
        if (status === 'done') orders[idx].archivedAt = now;
        updated.push(orders[idx]);
    });

    if (updated.length) writeOrders(orders);
    return updated;
}

module.exports = {
    readOrders,
    readEmails,
    createOrder,
    updateOrder,
    getOrder,
    softDeleteOrder,
    softDeleteOrders,
    bulkUpdateStatus,
    resolveLocation,
    locationLabel,
    normalizeLocation,
    cancelReasonLabel
};
