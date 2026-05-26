const path = require('path');
const crypto = require('crypto');
const express = require('express');
const store = require('./store');
const cloud = require('./cloud');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const CRM_PASSWORD = String(process.env.CRM_PASSWORD || 'emika2025').trim();
const SHOP_ROOT = path.join(__dirname, '..');
const REPO_ROOT = path.join(SHOP_ROOT, '..');
const CLOUD_ROOT = path.join(REPO_ROOT, 'cloud');

cloud.ensureCloudRoot(CLOUD_ROOT);

/** @type {Map<string, number>} token -> expiry timestamp */
const sessions = new Map();

function createToken() {
    const token = crypto.randomBytes(24).toString('hex');
    sessions.set(token, Date.now() + 12 * 60 * 60 * 1000);
    return token;
}

function isAuthed(req) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const exp = sessions.get(token);
    if (!exp) return false;
    if (Date.now() > exp) {
        sessions.delete(token);
        return false;
    }
    return true;
}

function requireAuth(req, res, next) {
    if (!isAuthed(req)) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
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

app.post('/api/auth/login', (req, res) => {
    const password = String(req.body?.password || '').trim();
    if (password !== CRM_PASSWORD) {
        return res.status(401).json({ error: 'Неверный пароль' });
    }
    const token = createToken();
    res.json({ token, expiresInHours: 12 });
});

app.post('/api/orders', (req, res) => {
    const body = req.body || {};
    const name = String(body.customer?.name || '').trim();
    const phone = String(body.customer?.phone || '').trim();

    if (!name || !phone) {
        return res.status(400).json({ error: 'Укажите имя и телефон' });
    }

    if (!Array.isArray(body.items) || !body.items.length) {
        return res.status(400).json({ error: 'Корзина пуста' });
    }

    const deliveryType = body.deliveryType === 'pickup' ? 'pickup' : 'delivery';
    const address = String(body.address || '').trim();

    if (deliveryType === 'delivery' && !address) {
        return res.status(400).json({ error: 'Укажите адрес доставки' });
    }

    const order = store.createOrder({
        customer: { name, phone, email: body.customer?.email },
        deliveryType,
        location: body.location,
        address,
        addressExtra: body.addressExtra,
        comment: body.comment,
        paymentMethod: body.paymentMethod,
        promoCode: body.promoCode,
        items: body.items.map((item) => ({
            id: item.id,
            titleRu: item.titleRu,
            titleEn: item.titleEn,
            price: Number(item.price) || 0,
            qty: Number(item.qty) || 1,
            image: item.image || ''
        })),
        total: Number(body.total) || 0
    });

    res.status(201).json({
        id: order.id,
        orderNumber: order.orderNumber
    });
});

app.post('/api/orders/bulk', requireAuth, (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const action = String(req.body?.action || '').trim();

    if (!ids.length) {
        return res.status(400).json({ error: 'Выберите заказы' });
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
        return res.json({ ok: true, orders });
    }

    return res.status(400).json({ error: 'Неизвестное действие' });
});

app.get('/api/orders', requireAuth, (req, res) => {
    let orders = store.readOrders();
    const view = String(req.query.view || 'active').trim();
    const location = String(req.query.location || 'all').trim();
    const status = String(req.query.status || '').trim();
    const q = String(req.query.q || '').trim().toLowerCase();

    if (view === 'active') {
        orders = orders.filter((o) => !o.deletedAt && o.status !== 'done');
    } else if (view === 'archive') {
        orders = orders.filter((o) => !o.deletedAt && o.status === 'done');
    } else if (view === 'deleted') {
        orders = orders.filter((o) => o.deletedAt);
    }

    if (location && location !== 'all') {
        orders = orders.filter((o) => store.resolveLocation(o) === location);
    }

    if (status && status !== 'all') {
        orders = orders.filter((o) => o.status === status);
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
    res.json({ order });
});

app.patch('/api/orders/:id', requireAuth, (req, res) => {
    if (req.params.id === 'bulk') {
        return res.status(404).json({ error: 'Заказ не найден' });
    }
    const order = store.updateOrder(req.params.id, {
        status: req.body?.status,
        managerNote: req.body?.managerNote,
        location: req.body?.location,
        cancelReason: req.body?.cancelReason
    });
    if (!order) return res.status(404).json({ error: 'Заказ не найден' });
    res.json({ order });
});

app.delete('/api/orders/:id', requireAuth, (req, res) => {
    if (req.params.id === 'bulk') {
        return res.status(404).json({ error: 'Заказ не найден' });
    }
    const ok = store.softDeleteOrder(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Заказ не найден' });
    res.json({ ok: true });
});

app.get('/api/health', (_req, res) => {
    res.json({ ok: true, orders: store.readOrders().length });
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
    res.sendFile(path.join(SHOP_ROOT, 'index.html'));
});

app.get(['/shop', '/shop/'], (_req, res) => res.redirect(301, '/'));
app.get('/shop/*', (req, res) => {
    const target = req.path.replace(/^\/shop/, '') || '/';
    res.redirect(301, target);
});

app.use('/images', express.static(path.join(REPO_ROOT, 'images')));
app.use('/cloud', express.static(CLOUD_ROOT, { index: false, dotfiles: 'deny' }));
app.use(express.static(SHOP_ROOT));

app.listen(PORT, () => {
    store.readOrders();
    const crmSource = process.env.CRM_PASSWORD ? 'Render Environment' : 'default (emika2025)';
    console.log(`Emika shop: http://localhost:${PORT}`);
    console.log(`CRM: http://localhost:${PORT}/crm.html`);
    console.log(`CRM password: ${crmSource}, length ${CRM_PASSWORD.length}`);
});
