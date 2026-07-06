const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const store = require('./store');
const cloud = require('./cloud');
const notify = require('./notify');
const push = require('./push');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const SHOP_ROOT = path.join(__dirname, '..');

function readPasswordFile(fileNames) {
    for (const name of fileNames) {
        const filePath = path.join(SHOP_ROOT, name);
        try {
            if (!fs.existsSync(filePath)) continue;
            const fromFile = fs.readFileSync(filePath, 'utf8').trim();
            if (fromFile) return { password: fromFile, source: name };
        } catch {
            /* ignore */
        }
    }
    return null;
}

function loadCrmAccounts() {
    const accounts = [];

    const adminAuth = readPasswordFile(['crm-password.txt', 'password-crm.txt']);
    const adminPassword = adminAuth?.password
        || String(process.env.CRM_PASSWORD || '').trim()
        || 'emika2025';
    const adminSource = adminAuth?.source
        || (process.env.CRM_PASSWORD ? 'CRM_PASSWORD env' : 'default');

    accounts.push({
        id: 'admin',
        password: adminPassword,
        location: 'all',
        brand: 'emika',
        label: 'Все точки',
        source: adminSource
    });

    const eatAuth = readPasswordFile(['crm-password-eat-arena.txt']);
    const eatPassword = eatAuth?.password || String(process.env.CRM_PASSWORD_EAT_ARENA || '').trim();
    if (eatPassword) {
        accounts.push({
            id: 'eat-arena',
            password: eatPassword,
            location: 'eat-arena',
            brand: 'emika',
            label: 'Eat Arena',
            source: eatAuth?.source || 'CRM_PASSWORD_EAT_ARENA env'
        });
    }

    const poselokAuth = readPasswordFile(['crm-password-poselok.txt']);
    const poselokPassword = poselokAuth?.password || String(process.env.CRM_PASSWORD_POSELOK || '').trim();
    if (poselokPassword) {
        accounts.push({
            id: 'poselok',
            password: poselokPassword,
            location: 'poselok',
            brand: 'emika',
            label: 'Набережные Челны',
            source: poselokAuth?.source || 'CRM_PASSWORD_POSELOK env'
        });
    }

    const dymnyAuth = readPasswordFile(['crm-password-dymny-dvor.txt', 'crm-password-dymny.txt']);
    const dymnyPassword = dymnyAuth?.password || String(process.env.CRM_PASSWORD_DYMNY_DVOR || '').trim();
    if (dymnyPassword) {
        accounts.push({
            id: 'dymny-dvor',
            password: dymnyPassword,
            location: 'rumyantsevo',
            brand: 'dymny-dvor',
            label: 'Дымный Двор',
            source: dymnyAuth?.source || 'CRM_PASSWORD_DYMNY_DVOR env'
        });
    }

    return accounts;
}

const CRM_ACCOUNTS = loadCrmAccounts();
const REPO_ROOT = path.join(SHOP_ROOT, '..');
const CLOUD_ROOT = path.join(REPO_ROOT, 'cloud');

cloud.ensureCloudRoot(CLOUD_ROOT);

const SESSION_TTL_MS = 3 * 24 * 60 * 60 * 1000;

/** @type {Map<string, { exp: number, location: string, accountId: string, label: string, brand: string }>} */
const sessions = new Map();

function readBearerToken(req) {
    const header = req.headers.authorization || '';
    return header.startsWith('Bearer ') ? header.slice(7) : '';
}

function getSession(req) {
    const token = readBearerToken(req);
    if (!token) return null;
    const sess = sessions.get(token);
    if (!sess) return null;
    if (Date.now() > sess.exp) {
        sessions.delete(token);
        return null;
    }
    return sess;
}

function createToken(account) {
    const token = crypto.randomBytes(24).toString('hex');
    sessions.set(token, {
        exp: Date.now() + SESSION_TTL_MS,
        location: account.location,
        accountId: account.id,
        label: account.label,
        brand: account.brand || 'emika'
    });
    return token;
}

function requireAuth(req, res, next) {
    const sess = getSession(req);
    if (!sess) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    req.crmSession = sess;
    next();
}

function sessionBrandScope(sess) {
    return sess?.brand === 'dymny-dvor' ? 'dymny-dvor' : 'emika';
}

function sessionLocationScope(sess) {
    return sess?.location === 'all' ? null : sess.location;
}

function orderInScope(order, sess) {
    if (store.resolveBrand(order) !== sessionBrandScope(sess)) return false;
    const scopeLocation = sessionLocationScope(sess);
    if (!scopeLocation) return true;
    return store.resolveLocation(order) === scopeLocation;
}

app.use(express.json({ limit: '1mb' }));

app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(204);
    }
    next();
});

app.get('/api/auth/check', (_req, res) => {
    res.json({
        ok: true,
        accounts: CRM_ACCOUNTS.map((a) => ({
            id: a.id,
            label: a.label,
            location: a.location
        }))
    });
});

app.post('/api/auth/login', (req, res) => {
    const password = String(req.body?.password || '').trim();
    if (!password) {
        return res.status(401).json({ error: 'Неверный пароль' });
    }

    const matches = CRM_ACCOUNTS.filter((a) => a.password === password);
    if (matches.length === 0) {
        return res.status(401).json({ error: 'Неверный пароль' });
    }
    if (matches.length > 1) {
        return res.status(401).json({
            error: 'Этот пароль подходит к нескольким точкам — задайте разный пароль для каждой'
        });
    }

    const account = matches[0];
    const token = createToken(account);
    res.json({
        token,
        account: account.id,
        location: account.location,
        brand: account.brand || 'emika',
        accountLabel: account.label,
        expiresInHours: SESSION_TTL_MS / (60 * 60 * 1000)
    });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
    res.json({
        account: req.crmSession.accountId,
        location: req.crmSession.location,
        brand: req.crmSession.brand || 'emika',
        accountLabel: req.crmSession.label
    });
});

app.get('/api/push/vapid-public-key', (_req, res) => {
    const publicKey = push.getPublicKey();
    res.json({ publicKey: publicKey || null, configured: push.isPushConfigured() });
});

app.post('/api/push/subscribe', requireAuth, (req, res) => {
    const result = push.upsertSubscription(req.body || {}, req.crmSession);
    if (!result.ok) return res.status(400).json({ error: 'Не удалось сохранить подписку' });
    res.json({ ok: true });
});

app.delete('/api/push/subscribe', requireAuth, (req, res) => {
    push.removeSubscription(req.body?.endpoint);
    res.json({ ok: true });
});

app.post('/api/promo/first-order/check', (req, res) => {
    const phone = String(req.body?.phone || '').trim();
    const email = String(req.body?.email || '').trim();

    if (!store.isValidPhone(phone)) {
        return res.json({
            eligible: false,
            reason: 'invalid_phone',
            message: 'Укажите корректный номер телефона'
        });
    }
    if (!store.isValidContact(email)) {
        return res.json({
            eligible: false,
            reason: 'invalid_email',
            message: 'Укажите e-mail или Telegram (@username)'
        });
    }

    const usage = store.hasUsedFirstOrderPromo({ phone, email });
    if (usage.used) {
        return res.json({
            eligible: false,
            reason: 'already_used',
            message: 'Акция «Первый заказ» уже была использована с этим телефоном или e-mail/TG.',
            orderNumber: usage.orderNumber || ''
        });
    }

    res.json({ eligible: true });
});

app.post('/api/orders', (req, res) => {
    const body = req.body || {};
    const name = String(body.customer?.name || '').trim();
    const phone = String(body.customer?.phone || '').trim();
    const email = String(body.customer?.email || '').trim();

    if (!name || !phone) {
        return res.status(400).json({ error: 'Укажите имя и телефон' });
    }

    if (!store.isValidPhone(phone)) {
        return res.status(400).json({ error: 'Укажите корректный номер телефона (например +7 999 000 00 00)' });
    }

    if (!Array.isArray(body.items) || !body.items.length) {
        return res.status(400).json({ error: 'Корзина пуста' });
    }

    const items = body.items.map((item) => ({
        id: item.id,
        titleRu: item.titleRu,
        titleEn: item.titleEn,
        price: Number(item.price) || 0,
        qty: Number(item.qty) || 1,
        image: item.image || ''
    }));

    const brand = store.normalizeBrand(body.brand);
    const hasFirstOrderPromo = store.orderHasPromoFirstItems(items);

    if (hasFirstOrderPromo) {
        if (brand !== 'emika') {
            return res.status(400).json({ error: 'Акция «Первый заказ» доступна только в меню Emika' });
        }
        if (!store.isValidContact(email)) {
            return res.status(400).json({
                error: 'Для акции «Первый заказ» укажите e-mail или Telegram (@username)'
            });
        }
        const usage = store.hasUsedFirstOrderPromo({ phone, email });
        if (usage.used) {
            return res.status(400).json({
                error: 'Акция «Первый заказ» уже была использована с этим телефоном или e-mail/TG.'
            });
        }
    } else if (email && brand !== 'dymny-dvor' && !store.isValidContact(email)) {
        return res.status(400).json({ error: 'Укажите корректный e-mail или Telegram (@username)' });
    } else if (email && brand === 'dymny-dvor' && !store.isValidContact(email) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: 'Укажите корректный e-mail' });
    }

    const deliveryType = body.deliveryType === 'pickup' ? 'pickup' : 'delivery';
    const address = String(body.address || '').trim();

    if (deliveryType === 'delivery' && !address) {
        return res.status(400).json({ error: 'Укажите адрес доставки' });
    }

    const order = store.createOrder({
        brand,
        customer: { name, phone, email },
        deliveryType,
        location: body.location,
        address,
        addressExtra: body.addressExtra,
        comment: body.comment,
        paymentMethod: body.paymentMethod,
        pickupTimeMode: body.pickupTimeMode,
        pickupTimeAt: body.pickupTimeAt,
        promoCode: body.promoCode,
        items,
        total: Number(body.total) || 0
    });

    if (hasFirstOrderPromo) {
        store.markFirstOrderPromoUsed({
            phone,
            email,
            orderId: order.id,
            orderNumber: order.orderNumber
        });
    }

    notify.sendOrderNotification(order).catch((err) => {
        console.error('[order-notify]', err?.message || err);
    });

    push.notifyNewOrderPush(order).catch((err) => {
        console.error('[order-push]', err?.message || err);
    });

    res.status(201).json({
        id: order.id,
        orderNumber: order.orderNumber
    });
});

app.post('/api/orders/bulk', requireAuth, async (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const action = String(req.body?.action || '').trim();
    const sess = req.crmSession;

    if (!ids.length) {
        return res.status(400).json({ error: 'Выберите заказы' });
    }

    const allowed = ids.filter((id) => {
        const o = store.getOrder(id);
        return o && orderInScope(o, sess);
    });
    if (allowed.length !== ids.length) {
        return res.status(403).json({ error: 'Нет доступа к одному из заказов' });
    }

    if (action === 'delete') {
        const deleted = store.softDeleteOrders(ids);
        return res.json({ ok: true, deleted });
    }

    if (action === 'done') {
        const orders = store.bulkUpdateStatus(ids, 'done');
        return res.json({ ok: true, orders });
    }

    if (action === 'cooking') {
        const orders = store.bulkUpdateStatus(ids, 'cooking');
        const guestEmails = [];
        for (const order of orders) {
            try {
                const result = await notify.handleOrderCookingStarted(order);
                if (result) guestEmails.push(result);
            } catch (err) {
                guestEmails.push({ ok: false, error: err?.message || String(err) });
            }
        }
        return res.json({ ok: true, orders, guestEmails });
    }

    return res.status(400).json({ error: 'Неизвестное действие' });
});

app.get('/api/orders', requireAuth, (req, res) => {
    let orders = store.readOrders();
    const view = String(req.query.view || 'active').trim();
    let location = String(req.query.location || 'all').trim();
    const status = String(req.query.status || '').trim();
    const q = String(req.query.q || '').trim().toLowerCase();
    const scope = sessionLocationScope(req.crmSession);
    const brandScope = sessionBrandScope(req.crmSession);

    if (scope) location = scope;

    if (view === 'active') {
        orders = orders.filter((o) => !o.deletedAt && o.status !== 'done');
    } else if (view === 'archive') {
        orders = orders.filter((o) => !o.deletedAt && o.status === 'done');
    } else if (view === 'deleted') {
        orders = orders.filter((o) => o.deletedAt);
    }

    orders = orders.filter((o) => store.resolveBrand(o) === brandScope);

    if (scope) {
        orders = orders.filter((o) => orderInScope(o, req.crmSession));
    } else if (location && location !== 'all') {
        orders = orders.filter((o) => store.resolveLocation(o) === location);
    }

    if (status && status !== 'all') {
        if (status === 'preparing') {
            orders = orders.filter((o) => o.status === 'confirmed' || o.status === 'cooking');
        } else {
            orders = orders.filter((o) => o.status === status);
        }
    }

    if (q) {
        orders = orders.filter((o) => {
            const hay = [
                o.orderNumber,
                o.customer?.name,
                o.customer?.phone,
                o.address,
                o.comment,
                store.locationLabel(store.resolveLocation(o)),
                store.cancelReasonLabel(o.cancelReason)
            ].join(' ').toLowerCase();
            return hay.includes(q);
        });
    }

    res.json({ orders });
});

app.get('/api/orders/:id', requireAuth, (req, res) => {
    if (req.params.id === 'bulk') {
        return res.status(404).json({ error: 'Заказ не найден' });
    }
    const order = store.getOrder(req.params.id);
    if (!order) return res.status(404).json({ error: 'Заказ не найден' });
    const scope = sessionLocationScope(req.crmSession);
    if (!orderInScope(order, req.crmSession)) {
        return res.status(403).json({ error: 'Нет доступа к этому заказу' });
    }
    res.json({ order });
});

app.patch('/api/orders/:id', requireAuth, async (req, res) => {
    if (req.params.id === 'bulk') {
        return res.status(404).json({ error: 'Заказ не найден' });
    }
    const existing = store.getOrder(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Заказ не найден' });
    if (!orderInScope(existing, req.crmSession)) {
        return res.status(403).json({ error: 'Нет доступа к этому заказу' });
    }
    const previousStatus = existing.status;
    const order = store.updateOrder(req.params.id, {
        status: req.body?.status,
        managerNote: req.body?.managerNote,
        location: req.body?.location,
        cancelReason: req.body?.cancelReason
    });
    if (!order) return res.status(404).json({ error: 'Заказ не найден' });

    let guestEmail = null;
    try {
        guestEmail = await notify.handleOrderCookingStarted(order, previousStatus);
    } catch (err) {
        guestEmail = { ok: false, error: err?.message || String(err) };
    }

    res.json({ order, guestEmail });
});

app.delete('/api/orders/:id', requireAuth, (req, res) => {
    if (req.params.id === 'bulk') {
        return res.status(404).json({ error: 'Заказ не найден' });
    }
    const existing = store.getOrder(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Заказ не найден' });
    if (!orderInScope(existing, req.crmSession)) {
        return res.status(403).json({ error: 'Нет доступа к этому заказу' });
    }
    const ok = store.softDeleteOrder(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Заказ не найден' });
    res.json({ ok: true });
});

app.get('/api/health', (_req, res) => {
    res.json({
        ok: true,
        orders: store.readOrders().length,
        orderNotify: notify.isSmtpConfigured(),
        pushNotify: push.isPushConfigured()
    });
});

app.get('/api/cloud', (req, res) => {
    const folderPath = String(req.query.path || '').trim();
    const data = cloud.scanFolder(CLOUD_ROOT, folderPath);
    if (!data) {
        return res.status(404).json({ error: 'Папка не найдена' });
    }
    res.json(data);
});

app.get('/', (_req, res) => {
    res.sendFile(path.join(REPO_ROOT, 'index.html'));
});

app.use((req, res, next) => {
    const p = req.path;
    if (p === '/shop' || p === '/shop/') {
        return res.redirect(301, '/');
    }
    if (p.startsWith('/shop/')) {
        return res.redirect(301, p.slice(5) || '/');
    }
    next();
});

app.get('/crm-dymny.html', (_req, res) => {
    const filePath = path.join(SHOP_ROOT, 'crm-dymny.html');
    if (fs.existsSync(filePath)) return res.sendFile(filePath);
    res.redirect(302, '/crm.html?cabinet=dymny-dvor');
});

app.get('/crm-dymny', (_req, res) => {
    res.redirect(301, '/crm-dymny.html');
});

app.get('/contacts.html', (_req, res) => {
    const rootFile = path.join(REPO_ROOT, 'contacts.html');
    const shopFile = path.join(SHOP_ROOT, 'contacts.html');
    if (fs.existsSync(rootFile)) return res.sendFile(rootFile);
    if (fs.existsSync(shopFile)) return res.sendFile(shopFile);
    res.status(404).send('Not found');
});

app.get('/contacts', (_req, res) => {
    res.redirect(301, '/contacts.html');
});

app.get('/media', (_req, res) => {
    res.sendFile(path.join(REPO_ROOT, 'media.html'));
});

app.get('/media/', (_req, res) => {
    res.sendFile(path.join(REPO_ROOT, 'media.html'));
});

app.get('/media.html', (_req, res) => {
    res.redirect(302, '/media');
});

app.get('/franchise', (_req, res) => {
    res.redirect(302, '/franchise/');
});

function resolveImagesDir() {
    const shopImages = path.join(SHOP_ROOT, 'images');
    const repoImages = path.join(REPO_ROOT, 'images');
    if (fs.existsSync(shopImages)) return shopImages;
    if (fs.existsSync(repoImages)) return repoImages;
    return repoImages;
}

app.get('/neworder.mp3', (_req, res) => {
    const filePath = path.join(SHOP_ROOT, 'neworder.mp3');
    if (!fs.existsSync(filePath)) return res.sendStatus(404);
    res.type('audio/mpeg');
    res.sendFile(filePath);
});

app.use('/images', express.static(resolveImagesDir()));
// Локально: index.html иногда ссылается на shop/… при открытии как файл
app.use('/shop', express.static(SHOP_ROOT));
const mediaDir = path.join(REPO_ROOT, 'media');
app.use('/media', express.static(mediaDir, { index: false }));
app.use('/media-files', express.static(mediaDir, { index: false }));
app.use('/franchise', express.static(path.join(REPO_ROOT, 'franchise')));
app.use('/cloud', express.static(CLOUD_ROOT, { index: false, dotfiles: 'deny' }));
app.use(express.static(SHOP_ROOT, { index: false }));

app.listen(PORT, () => {
    store.readOrders();
    const publicUrl = process.env.RENDER_EXTERNAL_URL || '';
    console.log(`Emika shop listening on port ${PORT}`);
    if (publicUrl) console.log(`Public URL: ${publicUrl}`);
    console.log('CRM path: /crm.html');
    console.log('CRM Dymny: /crm-dymny.html');
    console.log(`CRM accounts: ${CRM_ACCOUNTS.map((a) => a.id).join(', ')}`);
});
