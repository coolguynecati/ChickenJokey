(function () {
    'use strict';

    const host = location.hostname;
    const isLocal = host === 'localhost' || host === '127.0.0.1';
    const LOCAL_URL = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i;

    try {
        if (!isLocal) {
            sessionStorage.removeItem('emika-api-base');
        }
    } catch (_) {}

    if (isLocal) return;

    function shouldBlock(url) {
        return typeof url === 'string' && LOCAL_URL.test(url);
    }

    const nativeReplace = location.replace.bind(location);
    const nativeAssign = location.assign.bind(location);

    location.replace = function (url) {
        if (shouldBlock(url)) {
            console.warn('[Emika] blocked redirect to localhost');
            return;
        }
        return nativeReplace(url);
    };

    location.assign = function (url) {
        if (shouldBlock(url)) {
            console.warn('[Emika] blocked redirect to localhost');
            return;
        }
        return nativeAssign(url);
    };
})();
