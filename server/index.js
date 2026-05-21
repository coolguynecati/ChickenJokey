const path = require('path');
const crypto = require('crypto');
const express = require('express');
const store = require('./store');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const CRM_PASSWORD = process.env.CRM_PASSWORD || 'emika2025';
const ROOT = path.join(__dirname, '..');

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

app.post('/api/auth/login', (req, res) => {
    const password = String(req.body?.password || '');
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

app.get('/api/orders', requireAuth, (req, res) => {
    let orders = store.readOrders();
    const status = String(req.query.status || '').trim();
    const q = String(req.query.q || '').trim().toLowerCase();

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
                o.comment
            ].join(' ').toLowerCase();
            return hay.includes(q);
        });
    }

    res.json({ orders });
});

app.get('/api/orders/:id', requireAuth, (req, res) => {
    const order = store.getOrder(req.params.id);
    if (!order) return res.status(404).json({ error: 'Заказ не найден' });
    res.json({ order });
});

app.patch('/api/orders/:id', requireAuth, (req, res) => {
    const order = store.updateOrder(req.params.id, {
        status: req.body?.status,
        managerNote: req.body?.managerNote
    });
    if (!order) return res.status(404).json({ error: 'Заказ не найден' });
    res.json({ order });
});

app.get('/api/health', (_req, res) => {
    res.json({ ok: true, orders: store.readOrders().length });
});

app.use(express.static(ROOT));

app.listen(PORT, () => {
    store.readOrders();
    console.log(`Emika server: http://localhost:${PORT}`);
    console.log(`CRM: http://localhost:${PORT}/crm.html`);
});
