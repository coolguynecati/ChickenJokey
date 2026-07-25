const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
const EMAILS_FILE = path.join(DATA_DIR, 'emails.json');
const PROMO_FIRST_FILE = path.join(DATA_DIR, 'promo-first-customers.json');
const DELETED_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CANCEL_REASONS = new Set(['guest_cancelled', 'guest_no_pickup']);
let promoLedgerSynced = false;

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
    if (!fs.existsSync(PROMO_FIRST_FILE)) {
        fs.writeFileSync(PROMO_FIRST_FILE, '[]', 'utf8');
    }
    if (!promoLedgerSynced) {
        promoLedgerSynced = true;
        syncPromoFirstLedgerFromOrders();
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

function normalizePhone(value) {
    let digits = String(value || '').replace(/\D/g, '');
    if (digits.length === 11 && digits.startsWith('8')) digits = `7${digits.slice(1)}`;
    if (digits.length === 10) digits = `7${digits}`;
    return digits.length >= 11 && digits.startsWith('7') ? digits : '';
}

function isValidPhone(value) {
    return Boolean(normalizePhone(value));
}

/** Email or Telegram @handle for contact / promo tracking */
function normalizeContact(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (raw.startsWith('@')) return raw.toLowerCase();
    const lower = raw.toLowerCase();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lower)) return lower;
    return lower;
}

function isValidContact(value) {
    const raw = String(value || '').trim();
    if (!raw) return false;
    if (/^@[a-z0-9_]{4,32}$/i.test(raw)) return true;
    return isValidEmail(normalizeEmail(raw));
}

function readPromoFirstCustomers() {
    ensureStore();
    try {
        const raw = fs.readFileSync(PROMO_FIRST_FILE, 'utf8');
        const data = JSON.parse(raw);
        return Array.isArray(data) ? data : [];
    } catch {
        return [];
    }
}

function writePromoFirstCustomers(rows) {
    ensureStore();
    fs.writeFileSync(PROMO_FIRST_FILE, JSON.stringify(rows, null, 2), 'utf8');
}

function orderHasPromoFirstItems(items) {
    return (Array.isArray(items) ? items : []).some((item) => {
        const id = String(item?.id || '');
        return id.startsWith('promo-first::') || id === 'promo-first';
    });
}

function hasUsedFirstOrderPromo({ phone, email }) {
    const normalizedPhone = normalizePhone(phone);
    const normalizedContact = normalizeContact(email);

    for (const entry of readPromoFirstCustomers()) {
        if (normalizedPhone && entry.phone && entry.phone === normalizedPhone) {
            return { used: true, via: 'phone', orderNumber: entry.orderNumber || '' };
        }
        if (normalizedContact && entry.emailContact && entry.emailContact === normalizedContact) {
            return { used: true, via: 'email', orderNumber: entry.orderNumber || '' };
        }
    }

    for (const order of readOrders()) {
        if (order.status === 'cancelled' || order.deletedAt) continue;
        if (!orderHasPromoFirstItems(order.items)) continue;
        const orderPhone = normalizePhone(order.customer?.phone);
        const orderContact = normalizeContact(order.customer?.email);
        if (normalizedPhone && orderPhone && normalizedPhone === orderPhone) {
            return { used: true, via: 'phone', orderNumber: order.orderNumber || '' };
        }
        if (normalizedContact && orderContact && normalizedContact === orderContact) {
            return { used: true, via: 'email', orderNumber: order.orderNumber || '' };
        }
    }

    return { used: false };
}

function markFirstOrderPromoUsed({ phone, email, orderId, orderNumber }) {
    const normalizedPhone = normalizePhone(phone);
    const normalizedContact = normalizeContact(email);
    if (!normalizedPhone && !normalizedContact) return null;

    const rows = readPromoFirstCustomers();
    const duplicate = rows.some((entry) => {
        if (normalizedPhone && entry.phone === normalizedPhone) return true;
        if (normalizedContact && entry.emailContact === normalizedContact) return true;
        return false;
    });
    if (duplicate) return null;

    const record = {
        phone: normalizedPhone,
        emailContact: normalizedContact,
        usedAt: new Date().toISOString(),
        orderId: orderId || '',
        orderNumber: orderNumber || ''
    };
    rows.unshift(record);
    writePromoFirstCustomers(rows);
    return record;
}

function syncPromoFirstLedgerFromOrders() {
    const rows = readPromoFirstCustomers();
    const keys = new Set(rows.map((e) => `${e.phone || ''}|${e.emailContact || ''}`));

    for (const order of readOrders()) {
        if (order.status === 'cancelled' || order.deletedAt) continue;
        if (!orderHasPromoFirstItems(order.items)) continue;

        const phone = normalizePhone(order.customer?.phone);
        const emailContact = normalizeContact(order.customer?.email);
        const key = `${phone}|${emailContact}`;
        if (!phone && !emailContact) continue;
        if (keys.has(key)) continue;

        rows.push({
            phone,
            emailContact,
            usedAt: order.createdAt || new Date().toISOString(),
            orderId: order.id || '',
            orderNumber: order.orderNumber || '',
            source: 'backfill'
        });
        keys.add(key);
    }

    if (rows.length) writePromoFirstCustomers(rows);
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

const BRANDS = new Set(['emika', 'dymny-dvor']);
const LOCATIONS = new Set(['eat-arena', 'poselok', 'rumyantsevo']);

function normalizeBrand(value) {
    const v = String(value || '').trim().toLowerCase();
    if (v === 'dymny-dvor' || v === 'dymny' || v === 'дымный' || v === 'дымный-двор') return 'dymny-dvor';
    return 'emika';
}

function resolveBrand(order) {
    if (order?.brand && BRANDS.has(order.brand)) return order.brand;
    return 'emika';
}

function normalizeLocation(value, brand) {
    const b = normalizeBrand(brand);
    const v = String(value || '').trim().toLowerCase();
    if (b === 'dymny-dvor') return 'rumyantsevo';
    if (v === 'rumyantsevo' || v.includes('румянцево')) return 'rumyantsevo';
    if (v === 'poselok' || v === 'chelny' || v === 'челны' || v === 'набережные челны') return 'poselok';
    return 'eat-arena';
}

function resolveLocation(order) {
    const brand = resolveBrand(order);
    if (brand === 'dymny-dvor') return 'rumyantsevo';
    if (order?.location && LOCATIONS.has(order.location)) return order.location;
    const hay = `${order?.address || ''} ${order?.comment || ''}`.toLowerCase();
    if (hay.includes('румянцево')) return 'rumyantsevo';
    if (hay.includes('челн') || hay.includes('chelny') || hay.includes('сююмбике') || hay.includes('syuyumbike') || hay.includes('гурмэхолл') || hay.includes('gurmehall') || hay.includes('омега') || hay.includes('omega')) {
        return 'poselok';
    }
    return 'eat-arena';
}

function locationLabel(location) {
    if (location === 'rumyantsevo') return 'Дымный Двор · Румянцево';
    if (location === 'poselok') return 'Набережные Челны';
    return 'Eat Arena';
}

function brandLabel(brand) {
    return resolveBrand({ brand }) === 'dymny-dvor' ? 'Дымный Двор' : "Emika's";
}

function nextOrderNumber(orders, brand) {
    const year = new Date().getFullYear();
    const b = normalizeBrand(brand);
    const prefix = b === 'dymny-dvor' ? `DD${year}-` : `E${year}-`;
    const nums = orders
        .map((o) => o.orderNumber)
        .filter((n) => typeof n === 'string' && n.startsWith(prefix))
        .map((n) => Number(n.slice(prefix.length)) || 0);
    const next = (nums.length ? Math.max(...nums) : 0) + 1;
    return `${prefix}${String(next).padStart(4, '0')}`;
}

function actorLabel(actor) {
    if (!actor) return '';
    if (typeof actor === 'string') return actor.trim();
    return String(actor.label || actor.accountId || '').trim();
}

function pushHistory(order, entry) {
    if (!Array.isArray(order.history)) order.history = [];
    order.history.push(entry);
}

function applyStatusSideEffects(order, status, now, actor) {
    const who = actorLabel(actor);
    if (status === 'confirmed' && !order.confirmedAt) {
        order.confirmedAt = now;
        if (who) order.confirmedBy = who;
    }
    if (status === 'cooking' && !order.cookingAt) {
        order.cookingAt = now;
        if (who) order.cookingBy = who;
    }
    if (status === 'delivery' && !order.deliveryAt) {
        order.deliveryAt = now;
        if (who) order.deliveryBy = who;
    }
    if (status === 'done') {
        order.archivedAt = now;
        if (who) order.archivedBy = who;
    }
    if (status === 'cancelled') {
        order.cancelledAt = now;
        if (who) order.cancelledBy = who;
    }
    pushHistory(order, {
        at: now,
        event: 'status',
        status,
        by: who || 'CRM'
    });
}

function findByClientOrderKey(key) {
    const k = String(key || '').trim();
    if (!k) return null;
    return readOrders().find((o) => String(o.clientOrderKey || '').trim() === k) || null;
}

function createOrder(payload) {
    const orders = readOrders();
    const now = new Date().toISOString();
    const items = Array.isArray(payload.items) ? payload.items : [];
    const brand = normalizeBrand(payload.brand);
    const payment = String(payload.paymentMethod || '').trim();
    const allowedPayments = new Set(['transfer', 'counter', 'card', 'cash', 'sbp']);
    const clientOrderKey = String(payload.clientOrderKey || payload.localOrderNumber || '').trim();
    if (clientOrderKey) {
        const existing = orders.find((o) => String(o.clientOrderKey || '').trim() === clientOrderKey);
        if (existing) return existing;
    }
    const order = {
        id: crypto.randomUUID(),
        orderNumber: nextOrderNumber(orders, brand),
        brand,
        clientOrderKey: clientOrderKey || undefined,
        status: 'new',
        createdAt: now,
        updatedAt: now,
        customer: {
            name: String(payload.customer?.name || '').trim(),
            phone: String(payload.customer?.phone || '').trim(),
            email: String(payload.customer?.email || '').trim()
        },
        deliveryType: payload.deliveryType === 'pickup' ? 'pickup' : 'delivery',
        location: normalizeLocation(payload.location, brand),
        address: String(payload.address || '').trim(),
        addressExtra: String(payload.addressExtra || '').trim(),
        comment: String(payload.comment || '').trim(),
        paymentMethod: allowedPayments.has(payment) ? payment : 'counter',
        pickupTimeMode: ['asap', 'hour', 'at'].includes(payload.pickupTimeMode)
            ? payload.pickupTimeMode
            : 'asap',
        pickupTimeAt: String(payload.pickupTimeAt || '').trim(),
        promoCode: String(payload.promoCode || '').trim(),
        items,
        total: Number(payload.total) || 0,
        firstOrderPromo: orderHasPromoFirstItems(items),
        managerNote: '',
        history: [{ at: now, event: 'created', status: 'new', by: 'сайт' }]
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

function updateOrder(id, patch, actor) {
    const orders = readOrders();
    const idx = orders.findIndex((o) => o.id === id);
    if (idx === -1) return null;

    const allowedStatus = new Set([
        'new', 'confirmed', 'cooking', 'delivery', 'done', 'cancelled'
    ]);

    if (patch.status && allowedStatus.has(patch.status)) {
        const prev = orders[idx].status;
        if (prev !== patch.status) {
            orders[idx].status = patch.status;
            const now = new Date().toISOString();
            applyStatusSideEffects(orders[idx], patch.status, now, actor);
            if (patch.status === 'cancelled' && patch.cancelReason && CANCEL_REASONS.has(patch.cancelReason)) {
                orders[idx].cancelReason = patch.cancelReason;
            }
        }
    }
    if (typeof patch.managerNote === 'string') {
        orders[idx].managerNote = patch.managerNote.trim();
    }
    if (patch.location) {
        orders[idx].location = normalizeLocation(patch.location, orders[idx].brand);
    }

    orders[idx].updatedAt = new Date().toISOString();
    writeOrders(orders);
    return orders[idx];
}

function markCookingEmailSent(id) {
    const orders = readOrders();
    const idx = orders.findIndex((o) => o.id === id);
    if (idx === -1) return null;
    orders[idx].cookingEmailSentAt = new Date().toISOString();
    orders[idx].updatedAt = orders[idx].cookingEmailSentAt;
    writeOrders(orders);
    return orders[idx];
}

function getOrder(id) {
    return readOrders().find((o) => o.id === id) || null;
}

function softDeleteOrder(id, actor) {
    const orders = readOrders();
    const idx = orders.findIndex((o) => o.id === id);
    if (idx === -1 || orders[idx].deletedAt) return null;
    const now = new Date().toISOString();
    const who = actorLabel(actor);
    orders[idx].deletedAt = now;
    orders[idx].updatedAt = now;
    if (who) orders[idx].deletedBy = who;
    pushHistory(orders[idx], { at: now, event: 'deleted', status: orders[idx].status, by: who || 'CRM' });
    writeOrders(orders);
    return orders[idx];
}

function softDeleteOrders(ids, actor) {
    const set = new Set(Array.isArray(ids) ? ids : []);
    const orders = readOrders();
    const now = new Date().toISOString();
    const who = actorLabel(actor);
    const deleted = [];
    orders.forEach((order, idx) => {
        if (!set.has(order.id) || order.deletedAt) return;
        orders[idx].deletedAt = now;
        orders[idx].updatedAt = now;
        if (who) orders[idx].deletedBy = who;
        pushHistory(orders[idx], { at: now, event: 'deleted', status: orders[idx].status, by: who || 'CRM' });
        deleted.push(orders[idx]);
    });
    if (deleted.length) writeOrders(orders);
    return deleted;
}

function bulkUpdateStatus(ids, status, actor) {
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
        const prev = orders[idx].status;
        if (prev === status) return;
        orders[idx].status = status;
        orders[idx].updatedAt = now;
        applyStatusSideEffects(orders[idx], status, now, actor);
        updated.push({ order: orders[idx], previousStatus: prev });
    });

    if (updated.length) writeOrders(orders);
    return updated;
}

module.exports = {
    readOrders,
    readEmails,
    createOrder,
    findByClientOrderKey,
    updateOrder,
    markCookingEmailSent,
    getOrder,
    softDeleteOrder,
    softDeleteOrders,
    bulkUpdateStatus,
    resolveBrand,
    normalizeBrand,
    brandLabel,
    resolveLocation,
    locationLabel,
    normalizeLocation,
    cancelReasonLabel,
    normalizePhone,
    isValidPhone,
    normalizeContact,
    isValidContact,
    orderHasPromoFirstItems,
    hasUsedFirstOrderPromo,
    markFirstOrderPromoUsed,
    readPromoFirstCustomers
};
