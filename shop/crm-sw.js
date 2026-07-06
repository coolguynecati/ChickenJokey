/* CRM service worker — push-уведомления о новых заказах */
self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
    let payload = {
        title: 'Новый заказ',
        body: 'Поступил заказ — откройте CRM',
        tag: 'emika-order',
        url: '/crm.html'
    };
    try {
        if (event.data) payload = { ...payload, ...event.data.json() };
    } catch (_) {}

    event.waitUntil(
        self.registration.showNotification(payload.title, {
            body: payload.body,
            tag: payload.tag || 'emika-order',
            renotify: true,
            requireInteraction: true,
            icon: '/images/favicon.ico',
            badge: '/images/favicon.ico',
            data: { url: payload.url || '/crm.html' }
        })
    );
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const targetUrl = event.notification.data?.url || '/crm.html';
    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
            for (const client of clients) {
                if (client.url.includes('crm') && 'focus' in client) {
                    return client.focus();
                }
            }
            if (self.clients.openWindow) {
                return self.clients.openWindow(targetUrl);
            }
        })
    );
});
