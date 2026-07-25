/**
 * Append-only audit log → Google Sheets.
 * Managers cannot edit this from CRM; only the service account writes rows.
 */
const crypto = require('crypto');
const store = require('./store');

const MSK_TZ = 'Europe/Moscow';
const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

const STATUS_LABELS = {
    new: 'Новый',
    confirmed: 'Подтверждён',
    cooking: 'Готовим',
    delivery: 'Отдан курьеру',
    done: 'В архиве (выполнен)',
    cancelled: 'Отменён'
};

const HEADER_ROW = [
    'Время (МСК)',
    'Событие',
    '№ заказа',
    'Бренд',
    'Имя',
    'Телефон',
    'Состав заказа',
    'Сумма',
    'Тип',
    'Статус',
    'Кто (кабинет)',
    'Детали'
];

let cachedToken = null;
let cachedTokenExp = 0;
let headerEnsured = false;

function isSheetsConfigured() {
    return Boolean(getSpreadsheetId() && getServiceAccount());
}

function getSpreadsheetId() {
    return String(process.env.GOOGLE_SHEETS_ID || '').trim();
}

function getSheetTab() {
    return String(process.env.GOOGLE_SHEETS_TAB || 'Журнал заказов').trim() || 'Журнал заказов';
}

function getServiceAccount() {
    const rawJson = String(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '').trim();
    if (rawJson) {
        try {
            const parsed = JSON.parse(rawJson);
            const email = String(parsed.client_email || '').trim();
            let key = String(parsed.private_key || '').trim();
            if (key.includes('\\n')) key = key.replace(/\\n/g, '\n');
            if (email && key) return { email, privateKey: key };
        } catch (err) {
            console.error('[sheets-audit] GOOGLE_SERVICE_ACCOUNT_JSON invalid:', err?.message || err);
        }
    }

    const email = String(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '').trim();
    let key = String(process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '').trim();
    if (key.includes('\\n')) key = key.replace(/\\n/g, '\n');
    if (email && key) return { email, privateKey: key };
    return null;
}

function shouldAuditBrand(brand) {
    const raw = String(process.env.GOOGLE_SHEETS_BRANDS || 'dymny-dvor').trim();
    if (!raw || raw === '*') return true;
    const allowed = new Set(raw.split(/[,;]+/).map((s) => s.trim()).filter(Boolean));
    return allowed.has(store.normalizeBrand(brand));
}

function formatMoscow(iso) {
    const d = iso ? new Date(iso) : new Date();
    if (Number.isNaN(d.getTime())) return String(iso || '');
    return new Intl.DateTimeFormat('ru-RU', {
        timeZone: MSK_TZ,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    }).format(d);
}

function formatItems(items) {
    if (!Array.isArray(items) || !items.length) return '';
    return items
        .map((it) => {
            const title = it.titleRu || it.titleEn || it.id || 'позиция';
            const qty = Number(it.qty) || 1;
            const price = Number(it.price) || 0;
            return `${title} ×${qty} (${price} ₽)`;
        })
        .join('; ');
}

function actorLabel(actor) {
    if (!actor) return 'система / сайт';
    if (typeof actor === 'string') return actor;
    return String(actor.label || actor.accountId || 'CRM').trim() || 'CRM';
}

function base64url(input) {
    return Buffer.from(input)
        .toString('base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
}

async function getAccessToken() {
    const now = Math.floor(Date.now() / 1000);
    if (cachedToken && cachedTokenExp > now + 60) return cachedToken;

    const sa = getServiceAccount();
    if (!sa) throw new Error('Google service account not configured');

    const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claim = base64url(JSON.stringify({
        iss: sa.email,
        scope: SHEETS_SCOPE,
        aud: TOKEN_URL,
        iat: now,
        exp: now + 3600
    }));
    const unsigned = `${header}.${claim}`;
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(unsigned);
    sign.end();
    const signature = sign.sign(sa.privateKey, 'base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
    const jwt = `${unsigned}.${signature}`;

    const res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion: jwt
        })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) {
        throw new Error(data.error_description || data.error || `token HTTP ${res.status}`);
    }

    cachedToken = data.access_token;
    cachedTokenExp = now + Number(data.expires_in || 3600);
    return cachedToken;
}

function a1Tab(range) {
    const tab = getSheetTab().replace(/'/g, "''");
    return `'${tab}'!${range}`;
}

async function sheetsRequest(method, path, body) {
    const token = await getAccessToken();
    const id = getSpreadsheetId();
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}${path}`;
    const res = await fetch(url, {
        method,
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const msg = data.error?.message || data.error_description || `Sheets HTTP ${res.status}`;
        throw new Error(msg);
    }
    return data;
}

async function ensureHeaderRow() {
    if (headerEnsured) return;
    const meta = await sheetsRequest(
        'GET',
        `/values/${encodeURIComponent(a1Tab('A1:L1'))}`
    );
    const first = meta.values?.[0]?.[0];
    if (!first) {
        await sheetsRequest(
            'POST',
            `/values/${encodeURIComponent(a1Tab('A1'))}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
            { values: [HEADER_ROW] }
        );
    }
    headerEnsured = true;
}

async function appendRows(rows) {
    if (!isSheetsConfigured() || !rows.length) return { ok: false, skipped: true };
    await ensureHeaderRow();
    await sheetsRequest(
        'POST',
        `/values/${encodeURIComponent(a1Tab('A1'))}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
        { values: rows }
    );
    return { ok: true };
}

function buildRow({ at, event, order, actor, details }) {
    const brand = store.resolveBrand(order);
    return [
        formatMoscow(at || order?.createdAt || new Date().toISOString()),
        event,
        order?.orderNumber || '',
        store.brandLabel(brand),
        order?.customer?.name || '',
        order?.customer?.phone || '',
        formatItems(order?.items),
        order?.total != null ? String(order.total) : '',
        order?.deliveryType === 'pickup' ? 'Самовывоз' : 'Доставка',
        STATUS_LABELS[order?.status] || order?.status || '',
        actorLabel(actor),
        details || ''
    ];
}

async function logOrderCreated(order) {
    if (!order || !shouldAuditBrand(order.brand)) return { ok: false, skipped: true };
    try {
        return await appendRows([buildRow({
            at: order.createdAt,
            event: 'ЗАКАЗ СОЗДАН',
            order,
            actor: 'сайт',
            details: order.comment ? `Комментарий: ${order.comment}` : ''
        })]);
    } catch (err) {
        console.error('[sheets-audit] create', err?.message || err);
        return { ok: false, error: err?.message || String(err) };
    }
}

async function logStatusChange(order, previousStatus, actor) {
    if (!order || !shouldAuditBrand(order.brand)) return { ok: false, skipped: true };
    const next = order.status;
    if (!next || next === previousStatus) return { ok: false, skipped: true };

    let event = `СТАТУС → ${STATUS_LABELS[next] || next}`;
    if (next === 'done') event = 'В АРХИВ (выполнен)';
    if (next === 'cancelled') event = 'ОТМЕНЁН';
    if (next === 'delivery') event = 'ОТДАН КУРЬЕРУ';
    if (next === 'cooking') event = 'НАЧАЛИ ГОТОВИТЬ';
    if (next === 'confirmed') event = 'ПОДТВЕРЖДЁН';

    const details = [
        previousStatus ? `было: ${STATUS_LABELS[previousStatus] || previousStatus}` : '',
        order.cancelReason ? `причина: ${store.cancelReasonLabel(order.cancelReason) || order.cancelReason}` : '',
        order.managerNote ? `заметка: ${order.managerNote}` : ''
    ].filter(Boolean).join(' | ');

    try {
        return await appendRows([buildRow({
            at: order.updatedAt || new Date().toISOString(),
            event,
            order,
            actor,
            details
        })]);
    } catch (err) {
        console.error('[sheets-audit] status', err?.message || err);
        return { ok: false, error: err?.message || String(err) };
    }
}

async function logOrderDeleted(order, actor) {
    if (!order || !shouldAuditBrand(order.brand)) return { ok: false, skipped: true };
    try {
        return await appendRows([buildRow({
            at: order.deletedAt || new Date().toISOString(),
            event: 'УДАЛЁН',
            order,
            actor,
            details: 'Мягкое удаление в CRM (в журнале строка остаётся)'
        })]);
    } catch (err) {
        console.error('[sheets-audit] delete', err?.message || err);
        return { ok: false, error: err?.message || String(err) };
    }
}

module.exports = {
    isSheetsConfigured,
    logOrderCreated,
    logStatusChange,
    logOrderDeleted
};
