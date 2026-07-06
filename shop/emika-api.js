(function () {
    'use strict';

    const FALLBACK_API = 'https://chickenjokey.onrender.com';
    const STATIC_SITE_HOSTS = new Set([
        'emikashotchicken.ru',
        'www.emikashotchicken.ru'
    ]);

    async function ping(base, timeoutMs = 12000) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const res = await fetch(new URL('/api/health', base).href, {
                cache: 'no-store',
                signal: controller.signal
            });
            if (!res.ok) return false;
            const data = await res.json();
            return Boolean(data?.ok);
        } catch {
            return false;
        } finally {
            clearTimeout(timer);
        }
    }

    async function pingWithRetry(base, attempts = 3) {
        for (let i = 0; i < attempts; i += 1) {
            if (await ping(base)) return true;
            if (i < attempts - 1) {
                await new Promise((resolve) => setTimeout(resolve, 1800));
            }
        }
        return false;
    }

    function isStaticSiteHost(host) {
        return STATIC_SITE_HOSTS.has(host) || host.endsWith('.emikashotchicken.ru');
    }

    async function detect() {
        const host = location.hostname;
        if (host === 'localhost' || host === '127.0.0.1') {
            return location.origin;
        }
        if (isStaticSiteHost(host)) {
            return FALLBACK_API;
        }
        if (await ping(location.origin)) return location.origin;
        if (await pingWithRetry(FALLBACK_API)) return FALLBACK_API;
        return FALLBACK_API;
    }

    let origin = isStaticSiteHost(location.hostname) ? FALLBACK_API : location.origin;

    window.emikaApiReady = detect().then((resolved) => {
        origin = resolved;
        try {
            window.dispatchEvent(new CustomEvent('emika-api-ready', { detail: { origin: resolved } }));
        } catch (_) {}
        return resolved;
    });

    window.emikaApiUrl = function (path) {
        return new URL(path, origin).href;
    };

    window.emikaApiOrigin = function () {
        return origin;
    };
})();
