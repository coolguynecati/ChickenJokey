(function () {
    'use strict';

    const FALLBACK_API = 'https://chickenjokey.onrender.com';

    async function ping(base) {
        try {
            const res = await fetch(new URL('/api/health', base).href, { cache: 'no-store' });
            if (!res.ok) return false;
            const data = await res.json();
            return Boolean(data?.ok);
        } catch {
            return false;
        }
    }

    async function detect() {
        const host = location.hostname;
        if (host === 'localhost' || host === '127.0.0.1') {
            return location.origin;
        }
        if (await ping(location.origin)) {
            return location.origin;
        }
        if (await ping(FALLBACK_API)) {
            return FALLBACK_API;
        }
        return location.origin;
    }

    let origin = location.origin;

    window.emikaApiReady = detect().then((resolved) => {
        origin = resolved;
        return resolved;
    });

    window.emikaApiUrl = function (path) {
        return new URL(path, origin).href;
    };
})();
