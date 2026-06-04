const nodemailer = require('nodemailer');
const store = require('./store');

const VENUE_EMAIL = {
    'eat-arena': 'eatarena@emikashotchicken.ru',
    poselok: 'razvilka@emikashotchicken.ru'
};

const INFO_EMAIL = 'info@emikashotchicken.ru';
const CONTACT_PHONE = '+7 977 838 98 98';
const CONTACT_PHONE_HREF = 'tel:+79778389898';
const CONTACT_SITE = 'emikashotchicken.ru';
const MSK_TZ = 'Europe/Moscow';
const ASAP_MIN_MINUTES = 20;

const VENUE_DETAILS = {
    'eat-arena': {
        name: 'Eat Arena',
        address: 'Мичуринский пр-кт 13А, стр. 1 — 2 этаж',
        mapUrl: 'https://yandex.ru/maps/?text=Emika%27s+Hot+Chicken+Мичуринский+проспект+13А+стр+1+Eat+Arena'
    },
    poselok: {
        name: 'пос. Развилка',
        address: 'Проект. пр-зд 5539, 10В',
        mapUrl: 'https://yandex.ru/navi/org/ageva/230515854150?si=3qht15cpg13frarn1n412z92zr'
    }
};

function getPublicSiteBase() {
    const raw = String(process.env.PUBLIC_SITE_URL || process.env.SITE_URL || '').trim();
    if (raw) return raw.replace(/\/$/, '');
    return 'https://emikashotchicken.ru';
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function isSmtpConfigured() {
    const host = String(process.env.SMTP_HOST || '').trim();
    const user = String(process.env.SMTP_USER || '').trim();
    const pass = String(process.env.SMTP_PASS || '').trim();
    return Boolean(host && user && pass);
}

function isValidCustomerEmail(email) {
    const v = String(email || '').trim();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

function getSmtpTransport() {
    const port = Number(process.env.SMTP_PORT) || 587;
    const secure = process.env.SMTP_SECURE === 'true' || port === 465;
    return nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port,
        secure,
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
        }
    });
}

function absAssetUrl(baseUrl, assetPath) {
    const path = String(assetPath || '/images/logo.png').trim();
    if (/^https?:\/\//i.test(path)) return path;
    return `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
}

async function sendTransactionalMail({ to, subject, text, html }) {
    if (process.env.ORDER_NOTIFY_DISABLED === 'true') {
        return { ok: false, skipped: true, reason: 'disabled' };
    }
    if (!isSmtpConfigured()) {
        return { ok: false, skipped: true, reason: 'smtp_not_configured' };
    }
    const from = String(process.env.SMTP_FROM || process.env.SMTP_USER || '').trim();
    if (!from) {
        return { ok: false, skipped: true, reason: 'no_from' };
    }

    const transport = getSmtpTransport();
    try {
        const result = await transport.sendMail({ from, to, subject, text, html });
        return { ok: true, messageId: result.messageId };
    } catch (err) {
        return { ok: false, error: err?.message || String(err) };
    }
}

/** @returns {string[]} unique recipient emails for order location */
function getOrderNotifyRecipients(order) {
    const loc = store.resolveLocation(order);
    const venue = VENUE_EMAIL[loc] || VENUE_EMAIL['eat-arena'];
    return [...new Set([venue, INFO_EMAIL])];
}

function paymentLabel(method) {
    return method === 'transfer' ? 'Перевод' : 'На кассе';
}

function pickupTimeText(order) {
    if (order.pickupTimeMode === 'hour') return 'В течение часа';
    if (order.pickupTimeMode === 'at' && order.pickupTimeAt) return `К ${order.pickupTimeAt}`;
    return 'Как можно скорее';
}

function formatMoscowTime(date) {
    return new Intl.DateTimeFormat('ru-RU', {
        timeZone: MSK_TZ,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    }).format(date);
}

/** When guest should pick up / expect order — for cooking email */
function getPickupWaitPhrase(order) {
    if (order.pickupTimeMode === 'at' && order.pickupTimeAt) {
        return order.pickupTimeAt;
    }
    if (order.pickupTimeMode === 'hour') {
        return 'течение часа';
    }
    const readyAt = new Date(Date.now() + ASAP_MIN_MINUTES * 60 * 1000);
    return formatMoscowTime(readyAt);
}

function getVenueDetails(order) {
    const loc = store.resolveLocation(order);
    return VENUE_DETAILS[loc] || VENUE_DETAILS['eat-arena'];
}

function buildOrderMail(order) {
    const loc = store.resolveLocation(order);
    const venueName = store.locationLabel(loc);
    const lines = [
        `Заказ: ${order.orderNumber}`,
        `Точка: ${venueName}`,
        `Тип: ${order.deliveryType === 'pickup' ? 'Самовывоз' : 'Доставка'}`,
        order.address ? `Адрес: ${order.address}` : '',
        order.addressExtra ? `Доп. адрес: ${order.addressExtra}` : '',
        `Время: ${pickupTimeText(order)}`,
        `Оплата: ${paymentLabel(order.paymentMethod)}`,
        `Итого: ${order.total} ₽`,
        '',
        `Имя: ${order.customer?.name || '—'}`,
        `Телефон: ${order.customer?.phone || '—'}`,
        order.customer?.email ? `Email/TG: ${order.customer.email}` : '',
        order.comment ? `Комментарий: ${order.comment}` : '',
        order.promoCode ? `Промокод: ${order.promoCode}` : '',
        '',
        'Состав:'
    ].filter(Boolean);

    (order.items || []).forEach((item) => {
        const title = item.titleRu || item.titleEn || item.id || 'Позиция';
        lines.push(`  · ${title} × ${item.qty} — ${item.price * item.qty} ₽`);
    });

    const text = lines.join('\n');
    const html = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>\n');

    return {
        subject: `Новый заказ ${order.orderNumber} — ${venueName}`,
        text,
        html: `<!DOCTYPE html><html><body style="font-family:sans-serif;line-height:1.5">${html}</body></html>`
    };
}

function buildCookingItemsHtml(order, baseUrl) {
    const rows = (order.items || []).map((item) => {
        const title = escapeHtml(item.titleRu || item.titleEn || item.id || 'Позиция');
        const sum = (Number(item.price) || 0) * (Number(item.qty) || 1);
        const img = escapeHtml(absAssetUrl(baseUrl, item.image || '/images/logo.png'));
        return `
          <tr>
            <td style="padding:8px 10px 8px 0;vertical-align:middle;width:52px;">
              <img src="${img}" alt="" width="44" height="44" style="display:block;border-radius:8px;background:#1a1a1f;object-fit:contain;">
            </td>
            <td style="padding:8px 0;vertical-align:middle;color:#f5f5f5;font-size:14px;line-height:1.35;">
              <div style="font-weight:600;">${title}</div>
              <div style="color:#a8a8b0;font-size:12px;margin-top:2px;">${item.price} ₽ × ${item.qty} = ${sum} ₽</div>
            </td>
          </tr>`;
    }).join('');

    return `
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;margin:12px 0 0;">
        ${rows}
      </table>`;
}

function buildCookingStartedMail(order) {
    const baseUrl = getPublicSiteBase();
    const name = String(order.customer?.name || 'Гость').trim() || 'Гость';
    const venue = getVenueDetails(order);
    const waitPhrase = getPickupWaitPhrase(order);
    const waitIn = order.pickupTimeMode === 'hour'
        ? `в течение ${waitPhrase}`
        : `в ${waitPhrase}`;
    const logoUrl = escapeHtml(absAssetUrl(baseUrl, '/images/logo.png'));
    const siteUrl = escapeHtml(baseUrl);
    const mapUrl = escapeHtml(venue.mapUrl);
    const itemsHtml = buildCookingItemsHtml(order, baseUrl);

    const subject = `${name}, уже готовим для вас!`;

    const text = [
        `${name}, мы начали готовить ваш заказ!`,
        '',
        'Ваш заказ:',
        ...(order.items || []).map((item) => {
            const title = item.titleRu || item.titleEn || item.id;
            return `· ${title} × ${item.qty} — ${item.price * item.qty} ₽`;
        }),
        '',
        `Ждём вас ${waitIn} в ${venue.name}, ${venue.address}`,
        venue.mapUrl,
        '',
        `Телефон: ${CONTACT_PHONE}`,
        `Сайт: ${CONTACT_SITE}`
    ].join('\n');

    const html = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#0d0d0f;font-family:Montserrat,Arial,sans-serif;color:#f5f5f5;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#0d0d0f;">
    <tr>
      <td align="center" style="padding:28px 16px 36px;">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:520px;background:#141418;border:1px solid #2a2a30;border-radius:16px;overflow:hidden;">
          <tr>
            <td style="padding:24px 24px 8px;text-align:center;">
              <img src="${logoUrl}" alt="Emika's Hot Chicken" width="120" style="display:inline-block;max-width:120px;height:auto;">
            </td>
          </tr>
          <tr>
            <td style="padding:8px 24px 0;font-size:20px;font-weight:700;line-height:1.35;color:#f5f5f5;">
              ${escapeHtml(name)}, мы начали готовить ваш заказ!
            </td>
          </tr>
          <tr>
            <td style="padding:16px 24px 0;">
              <div style="font-size:12px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:#a8a8b0;">Ваш заказ</div>
              ${itemsHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:20px 24px 0;font-size:15px;line-height:1.55;color:#e8e8ec;">
              Ждём вас ${escapeHtml(waitIn)} в
              <strong style="color:#ff6a1a;">${escapeHtml(venue.name)}</strong>,
              <a href="${mapUrl}" style="color:#ff6a1a;text-decoration:none;font-weight:600;">${escapeHtml(venue.address)}</a>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 24px 20px;border-top:1px solid #2a2a30;font-size:13px;line-height:1.6;color:#a8a8b0;">
              <a href="${CONTACT_PHONE_HREF}" style="color:#ff6a1a;text-decoration:none;font-weight:600;">${CONTACT_PHONE}</a><br>
              <a href="${siteUrl}" style="color:#ff6a1a;text-decoration:none;">${escapeHtml(CONTACT_SITE)}</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

    return { subject, text, html };
}

/**
 * @param {object} order
 * @returns {Promise<{ ok: boolean, skipped?: boolean, reason?: string, recipients?: string[], messageId?: string, error?: string }>}
 */
async function sendOrderNotification(order) {
    const recipients = getOrderNotifyRecipients(order);
    const mail = buildOrderMail(order);
    const result = await sendTransactionalMail({
        to: recipients.join(', '),
        subject: mail.subject,
        text: mail.text,
        html: mail.html
    });

    if (result.ok) {
        console.log('[order-notify] отправлено:', order.orderNumber, '→', recipients.join(', '));
    } else if (result.skipped) {
        console.warn('[order-notify] пропущено:', order.orderNumber, result.reason);
    } else {
        console.error('[order-notify] ошибка:', order.orderNumber, result.error);
    }

    return { ...result, recipients };
}

/**
 * Guest email when CRM sets status to «готовится».
 * @param {object} order
 */
async function sendCookingStartedEmail(order) {
    if (order.cookingEmailSentAt) {
        return { ok: false, skipped: true, reason: 'already_sent' };
    }

    const email = String(order.customer?.email || '').trim();
    if (!isValidCustomerEmail(email)) {
        console.warn('[cooking-email] нет email у гостя:', order.orderNumber);
        return { ok: false, skipped: true, reason: 'no_valid_email' };
    }

    const mail = buildCookingStartedMail(order);
    const result = await sendTransactionalMail({
        to: email,
        subject: mail.subject,
        text: mail.text,
        html: mail.html
    });

    if (result.ok) {
        store.markCookingEmailSent(order.id);
        console.log('[cooking-email] отправлено:', order.orderNumber, '→', email);
    } else if (result.skipped) {
        console.warn('[cooking-email] пропущено:', order.orderNumber, result.reason);
    } else {
        console.error('[cooking-email] ошибка:', order.orderNumber, result.error);
    }

    return { ...result, recipient: email };
}

/**
 * @param {{ ok?: boolean, skipped?: boolean, reason?: string, error?: string } | null | undefined} result
 * @returns {string} короткое сообщение для CRM
 */
function getCookingEmailNotice(result) {
    if (!result) return '';
    if (result.ok) return 'Письмо гостю отправлено';
    if (result.skipped && result.reason === 'no_valid_email') {
        return 'Письмо гостю не отправлено: нет email';
    }
    if (result.skipped && result.reason === 'already_sent') return '';
    if (result.skipped && result.reason === 'smtp_not_configured') {
        return 'Письмо гостю не отправлено: SMTP не настроен';
    }
    if (result.skipped && result.reason === 'disabled') {
        return 'Письмо гостю отключено';
    }
    if (result.skipped && result.reason === 'no_from') {
        return 'Письмо гостю не отправлено: не задан SMTP_FROM';
    }
    if (result.error) return 'Письмо гостю не отправлено: ошибка почты';
    return '';
}

/**
 * @param {Array<{ ok?: boolean, skipped?: boolean, reason?: string }>} results
 * @returns {string}
 */
function summarizeCookingEmailResults(results) {
    if (!Array.isArray(results) || !results.length) return '';
    const sent = results.filter((r) => r.ok).length;
    const noEmail = results.filter((r) => r.skipped && r.reason === 'no_valid_email').length;
    const smtp = results.filter((r) => r.skipped && r.reason === 'smtp_not_configured').length;
    const errors = results.filter((r) => r.error).length;
    const parts = [];
    if (sent) parts.push(`письмо гостю: ${sent}`);
    if (noEmail) parts.push(`без email: ${noEmail}`);
    if (smtp) parts.push(`SMTP не настроен: ${smtp}`);
    if (errors) parts.push(`ошибка почты: ${errors}`);
    return parts.length ? parts.join(' · ') : '';
}

/**
 * Call when order transitions to cooking (not already cooking).
 * @param {object} order
 * @param {string} [previousStatus]
 * @returns {Promise<object|null>}
 */
async function handleOrderCookingStarted(order, previousStatus) {
    if (!order || previousStatus === 'cooking' || order.status !== 'cooking') return null;
    return sendCookingStartedEmail(order);
}

module.exports = {
    getOrderNotifyRecipients,
    sendOrderNotification,
    sendCookingStartedEmail,
    handleOrderCookingStarted,
    getCookingEmailNotice,
    summarizeCookingEmailResults,
    isValidCustomerEmail,
    isSmtpConfigured,
    VENUE_EMAIL,
    INFO_EMAIL
};
