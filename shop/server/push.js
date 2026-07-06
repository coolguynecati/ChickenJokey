const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const webpush = require('web-push');
const store = require('./store');

const DATA_DIR = path.join(__dirname, '..', 'data');
const SUBS_FILE = path.join(DATA_DIR, 'push-subscriptions.json');

function ensureStore() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(SUBS_FILE)) fs.writeFileSync(SUBS_FILE, '[]', 'utf8');
}

function readSubs() {
    ensureStore();
    try {
        const data = JSON.parse(fs.readFileSync(SUBS_FILE, 'utf8'));
        return Array.isArray(data) ? data : [];
    } catch {
        return [];
    }
}

function writeSubs(subs) {
    ensureStore();
    fs.writeFileSync(SUBS_FILE, JSON.stringify(subs, null, 2), 'utf8');
}

function subKey(sub) {
    return String(sub?.endpoint || '');
}

function isPushConfigured() {
    const pub = String(process.env.VAPID_PUBLIC_KEY || '').trim();
    const priv = String(process.env.VAPID_PRIVATE_KEY || '').trim();
    return Boolean(pub && priv);
}

function configureWebPush() {
    if (!isPushConfigured()) return false;
    webpush.setVapidDetails(
        String(process.env.VAPID_SUBJECT || 'mailto:info@emikashotchicken.ru'),
        process.env.VAPID_PUBLIC_KEY,
        process.env.VAPID_PRIVATE_KEY
    );
    return true;
}

function getPublicKey() {
    return String(process.env.VAPID_PUBLIC_KEY || '').trim();
}

function upsertSubscription(payload, session) {
    const endpoint = subKey(payload);
    if (!endpoint || !payload?.keys?.p256dh || !payload?.keys?.auth) {
        return { ok: false, error: 'invalid_subscription' };
    }

    const subs = readSubs();
    const now = new Date().toISOString();
    const entry = {
        id: crypto.randomUUID(),
        endpoint,
        keys: {
            p256dh: String(payload.keys.p256dh),
            auth: String(payload.keys.auth)
        },
        location: session?.location || 'all',
        brand: session?.brand || 'emika',
        accountId: session?.accountId || '',
        accountLabel: session?.label || '',
        createdAt: now,
        updatedAt: now
    };

    const idx = subs.findIndex((s) => s.endpoint === endpoint);
    if (idx === -1) subs.unshift(entry);
    else {
        subs[idx] = { ...subs[idx], ...entry, id: subs[idx].id, createdAt: subs[idx].createdAt, updatedAt: now };
    }

    writeSubs(subs);
    return { ok: true };
}

function removeSubscription(endpoint) {
    const key = String(endpoint || '').trim();
    if (!key) return false;
    const subs = readSubs().filter((s) => s.endpoint !== key);
    writeSubs(subs);
    return true;
}

function subsForOrder(order) {
    const orderLoc = store.resolveLocation(order);
    const orderBrand = store.resolveBrand(order);
    return readSubs().filter((s) => {
        const subBrand = s.brand || 'emika';
        if (subBrand !== orderBrand) return false;
        if (s.location === 'all') return true;
        if (!s.location) return true;
        return s.location === orderLoc;
    });
}

async function sendPushToSub(sub, payload) {
    configureWebPush();
    await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: sub.keys },
        JSON.stringify(payload)
    );
}

async function notifyNewOrderPush(order) {
    if (!isPushConfigured()) return { ok: false, skipped: true, reason: 'not_configured' };

    const targets = subsForOrder(order);
    if (!targets.length) return { ok: false, skipped: true, reason: 'no_subscribers' };

    const venue = store.locationLabel(store.resolveLocation(order));
    const orderBrand = store.resolveBrand(order);
    const name = order.customer?.name || 'Гость';
    const phone = order.customer?.phone || '';
    const crmUrl = store.resolveBrand(order) === 'dymny-dvor' ? '/crm-dymny.html' : '/crm.html';
    const payload = {
        title: `Новый заказ ${order.orderNumber}`,
        body: `${name}${phone ? ` · ${phone}` : ''} — ${order.total} ₽ · ${venue}`,
        tag: `order-${orderBrand}-${order.id}`,
        url: crmUrl,
        orderId: order.id
    };

    const dead = [];
    let sent = 0;

    for (const sub of targets) {
        try {
            await sendPushToSub(sub, payload);
            sent += 1;
        } catch (err) {
            const code = err?.statusCode || err?.status;
            if (code === 404 || code === 410) dead.push(sub.endpoint);
            console.warn('[push] fail:', code, sub.endpoint?.slice(0, 48));
        }
    }

    if (dead.length) {
        const subs = readSubs().filter((s) => !dead.includes(s.endpoint));
        writeSubs(subs);
    }

    if (sent) console.log('[push] отправлено:', order.orderNumber, sent);
    return { ok: sent > 0, sent, dead: dead.length };
}

module.exports = {
    getPublicKey,
    isPushConfigured,
    upsertSubscription,
    removeSubscription,
    notifyNewOrderPush
};
