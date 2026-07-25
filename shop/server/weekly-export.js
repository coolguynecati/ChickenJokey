/**
 * Weekly Excel export of Dymny Dvor orders → email.
 * Independent of CRM UI; managers cannot alter the mailed file.
 */
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const store = require('./store');
const notify = require('./notify');

const MSK_TZ = 'Europe/Moscow';
const DATA_DIR = path.join(__dirname, '..', 'data');
const STATE_FILE = path.join(DATA_DIR, 'weekly-export-state.json');
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const STATUS_LABELS = {
    new: 'Новый',
    confirmed: 'Подтверждён',
    cooking: 'Готовим',
    delivery: 'Отдан курьеру',
    done: 'В архиве',
    cancelled: 'Отменён'
};

function formatMoscow(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
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

function formatHistory(history) {
    if (!Array.isArray(history) || !history.length) return '';
    return history
        .map((h) => {
            const when = formatMoscow(h.at);
            const ev = h.event === 'created'
                ? 'создан'
                : h.event === 'deleted'
                    ? 'удалён'
                    : (STATUS_LABELS[h.status] || h.status || h.event);
            const by = h.by ? ` [${h.by}]` : '';
            return `${when}: ${ev}${by}`;
        })
        .join(' → ');
}

function getExportRecipients() {
    const fromEnv = String(process.env.WEEKLY_EXPORT_EMAIL || '').trim();
    if (fromEnv) {
        return [...new Set(fromEnv.split(/[,;]+/).map((s) => s.trim()).filter(Boolean))];
    }
    return ['narek@dimniy-dvor.ru'];
}

function getExportBrand() {
    return store.normalizeBrand(process.env.WEEKLY_EXPORT_BRAND || 'dymny-dvor');
}

function isWeeklyExportEnabled() {
    if (process.env.WEEKLY_EXPORT_DISABLED === 'true') return false;
    return notify.isSmtpConfigured();
}

function readState() {
    try {
        if (!fs.existsSync(STATE_FILE)) return {};
        return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) || {};
    } catch {
        return {};
    }
}

function writeState(state) {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

/** Moscow calendar parts */
function moscowParts(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: MSK_TZ,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    }).formatToParts(date);
    const get = (type) => parts.find((p) => p.type === type)?.value;
    const weekdayMap = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 0 };
    return {
        year: Number(get('year')),
        month: Number(get('month')),
        day: Number(get('day')),
        hour: Number(get('hour')),
        minute: Number(get('minute')),
        weekday: weekdayMap[get('weekday')] ?? -1
    };
}

/** ISO week key in Moscow, e.g. 2026-W30 */
function moscowWeekKey(date = new Date()) {
    const p = moscowParts(date);
    // Use UTC noon trick on Moscow Y-M-D for stable week number
    const utc = new Date(Date.UTC(p.year, p.month - 1, p.day, 12, 0, 0));
    const dayNum = utc.getUTCDay() || 7;
    utc.setUTCDate(utc.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((utc - yearStart) / 86400000) + 1) / 7);
    return `${utc.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function orderTouchesWindow(order, fromMs, toMs) {
    const stamps = [
        order.createdAt,
        order.updatedAt,
        order.confirmedAt,
        order.cookingAt,
        order.deliveryAt,
        order.archivedAt,
        order.cancelledAt,
        order.deletedAt
    ];
    if (Array.isArray(order.history)) {
        order.history.forEach((h) => stamps.push(h.at));
    }
    return stamps.some((iso) => {
        if (!iso) return false;
        const t = new Date(iso).getTime();
        return !Number.isNaN(t) && t >= fromMs && t <= toMs;
    });
}

function collectOrders(fromMs, toMs) {
    const brand = getExportBrand();
    return store.readOrders()
        .filter((o) => store.resolveBrand(o) === brand)
        .filter((o) => orderTouchesWindow(o, fromMs, toMs))
        .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
}

async function buildWorkbookBuffer(orders, fromMs, toMs) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Dymny Dvor CRM';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Заказы', {
        views: [{ state: 'frozen', ySplit: 1 }]
    });

    sheet.columns = [
        { header: '№ заказа', key: 'orderNumber', width: 14 },
        { header: 'Создан (МСК)', key: 'createdAt', width: 20 },
        { header: 'Имя', key: 'name', width: 20 },
        { header: 'Телефон', key: 'phone', width: 16 },
        { header: 'Состав', key: 'items', width: 48 },
        { header: 'Сумма', key: 'total', width: 10 },
        { header: 'Тип', key: 'type', width: 12 },
        { header: 'Адрес / самовывоз', key: 'address', width: 28 },
        { header: 'Оплата', key: 'payment', width: 14 },
        { header: 'Текущий статус', key: 'status', width: 16 },
        { header: 'Подтверждён', key: 'confirmedAt', width: 20 },
        { header: 'Начали готовить', key: 'cookingAt', width: 20 },
        { header: 'Отдали курьеру', key: 'deliveryAt', width: 20 },
        { header: 'В архив', key: 'archivedAt', width: 20 },
        { header: 'Кто в архив', key: 'archivedBy', width: 16 },
        { header: 'Отменён', key: 'cancelledAt', width: 20 },
        { header: 'Удалён', key: 'deletedAt', width: 20 },
        { header: 'Кто удалил', key: 'deletedBy', width: 16 },
        { header: 'История статусов', key: 'history', width: 50 },
        { header: 'Комментарий', key: 'comment', width: 24 }
    ];

    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFF5C518' }
    };

    orders.forEach((o) => {
        sheet.addRow({
            orderNumber: o.orderNumber || '',
            createdAt: formatMoscow(o.createdAt),
            name: o.customer?.name || '',
            phone: o.customer?.phone || '',
            items: formatItems(o.items),
            total: Number(o.total) || 0,
            type: o.deliveryType === 'pickup' ? 'Самовывоз' : 'Доставка',
            address: o.deliveryType === 'pickup'
                ? (store.locationLabel(store.resolveLocation(o)) || 'Самовывоз')
                : [o.address, o.addressExtra].filter(Boolean).join(', '),
            payment: o.paymentMethod || '',
            status: o.deletedAt
                ? `Удалён / ${STATUS_LABELS[o.status] || o.status}`
                : (STATUS_LABELS[o.status] || o.status || ''),
            confirmedAt: formatMoscow(o.confirmedAt),
            cookingAt: formatMoscow(o.cookingAt),
            deliveryAt: formatMoscow(o.deliveryAt),
            archivedAt: formatMoscow(o.archivedAt),
            archivedBy: o.archivedBy || '',
            cancelledAt: formatMoscow(o.cancelledAt),
            deletedAt: formatMoscow(o.deletedAt),
            deletedBy: o.deletedBy || '',
            history: formatHistory(o.history),
            comment: o.comment || ''
        });
    });

    const events = workbook.addWorksheet('События', {
        views: [{ state: 'frozen', ySplit: 1 }]
    });
    events.columns = [
        { header: 'Время (МСК)', key: 'at', width: 20 },
        { header: '№ заказа', key: 'orderNumber', width: 14 },
        { header: 'Событие', key: 'event', width: 18 },
        { header: 'Статус', key: 'status', width: 16 },
        { header: 'Кто', key: 'by', width: 18 },
        { header: 'Имя гостя', key: 'name', width: 20 }
    ];
    events.getRow(1).font = { bold: true };

    const eventRows = [];
    orders.forEach((o) => {
        const hist = Array.isArray(o.history) && o.history.length
            ? o.history
            : [{ at: o.createdAt, event: 'created', status: 'new', by: 'сайт' }];
        hist.forEach((h) => {
            const t = h.at ? new Date(h.at).getTime() : 0;
            if (t && (t < fromMs || t > toMs)) return;
            eventRows.push({
                at: formatMoscow(h.at),
                orderNumber: o.orderNumber || '',
                event: h.event === 'created' ? 'создан' : h.event === 'deleted' ? 'удалён' : 'статус',
                status: STATUS_LABELS[h.status] || h.status || '',
                by: h.by || '',
                name: o.customer?.name || '',
                _sort: t
            });
        });
    });
    eventRows.sort((a, b) => a._sort - b._sort).forEach((row) => {
        const { _sort, ...rest } = row;
        events.addRow(rest);
    });

    const meta = workbook.addWorksheet('О отчёте');
    meta.addRow(['Бренд', store.brandLabel(getExportBrand())]);
    meta.addRow(['Период с (МСК)', formatMoscow(new Date(fromMs).toISOString())]);
    meta.addRow(['Период по (МСК)', formatMoscow(new Date(toMs).toISOString())]);
    meta.addRow(['Заказов в файле', orders.length]);
    meta.addRow(['Сформирован', formatMoscow(new Date().toISOString())]);
    meta.columns = [{ width: 22 }, { width: 28 }];

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
}

async function sendWeeklyExport(options = {}) {
    if (!isWeeklyExportEnabled() && !options.force) {
        return { ok: false, skipped: true, reason: 'disabled_or_no_smtp' };
    }
    if (!notify.isSmtpConfigured()) {
        return { ok: false, skipped: true, reason: 'smtp_not_configured' };
    }

    const toMs = options.toMs != null ? options.toMs : Date.now();
    const fromMs = options.fromMs != null ? options.fromMs : (toMs - WEEK_MS);
    const orders = collectOrders(fromMs, toMs);
    const recipients = getExportRecipients();
    const fromLabel = formatMoscow(new Date(fromMs).toISOString());
    const toLabel = formatMoscow(new Date(toMs).toISOString());
    const weekKey = options.weekKey || moscowWeekKey(new Date(toMs));
    const filename = `dymny-dvor-zakazy-${weekKey}.xlsx`;

    const buffer = await buildWorkbookBuffer(orders, fromMs, toMs);

    const subject = `Дымный Двор — отчёт по заказам ${weekKey} (${orders.length})`;
    const text = [
        'Еженедельная выгрузка заказов Дымного двора.',
        `Период: ${fromLabel} — ${toLabel}`,
        `Заказов в файле: ${orders.length}`,
        '',
        'Файл сформирован сервером автоматически. Данные из CRM сюда не подделываются задним числом в этом письме — это снимок на момент отправки.',
        '',
        'Во вложении Excel: лист «Заказы» и лист «События».'
    ].join('\n');

    const result = await notify.sendTransactionalMail({
        to: recipients.join(', '),
        subject,
        text,
        html: `<p>Еженедельная выгрузка заказов <strong>Дымного двора</strong>.</p>
<p>Период: <strong>${fromLabel}</strong> — <strong>${toLabel}</strong><br>
Заказов в файле: <strong>${orders.length}</strong></p>
<p>Во вложении Excel (листы «Заказы» и «События»).</p>`,
        attachments: [{
            filename,
            content: buffer,
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        }]
    });

    if (result.ok) {
        const state = readState();
        state.lastWeekKey = weekKey;
        state.lastSentAt = new Date().toISOString();
        state.lastOrderCount = orders.length;
        state.lastRecipients = recipients;
        writeState(state);
    }

    return {
        ...result,
        weekKey,
        orderCount: orders.length,
        recipients,
        filename
    };
}

/**
 * Auto-run: Mondays 09:00–09:59 Moscow, once per ISO week.
 */
async function maybeRunScheduledExport() {
    if (process.env.WEEKLY_EXPORT_DISABLED === 'true') return null;
    if (!notify.isSmtpConfigured()) return null;

    const p = moscowParts();
    // Monday = 1
    if (p.weekday !== 1) return null;
    if (p.hour !== 9) return null;

    const weekKey = moscowWeekKey();
    const state = readState();
    if (state.lastWeekKey === weekKey) return null;

    console.log('[weekly-export] starting scheduled send', weekKey);
    const result = await sendWeeklyExport({ weekKey });
    console.log('[weekly-export]', result.ok ? 'sent' : 'failed', result);
    return result;
}

function startWeeklyExportScheduler() {
    if (process.env.WEEKLY_EXPORT_DISABLED === 'true') {
        console.log('[weekly-export] scheduler disabled');
        return;
    }
    // Check every 15 minutes
    const tick = () => {
        maybeRunScheduledExport().catch((err) => {
            console.error('[weekly-export]', err?.message || err);
        });
    };
    tick();
    setInterval(tick, 15 * 60 * 1000);
    console.log('[weekly-export] scheduler on (Mon 09:00 MSK)');
}

module.exports = {
    isWeeklyExportEnabled,
    sendWeeklyExport,
    maybeRunScheduledExport,
    startWeeklyExportScheduler,
    moscowWeekKey,
    getExportRecipients
};
