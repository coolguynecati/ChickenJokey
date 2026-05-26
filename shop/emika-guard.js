(function () {
    'use strict';

    const host = location.hostname;
    const isLocal = host === 'localhost' || host === '127.0.0.1';
    const LOCAL_URL = /localhost|127\.0\.0\.1/i;

    try {
        sessionStorage.removeItem('emika-api-base');
        localStorage.removeItem('emika-api-base');
    } catch (_) {}

    if (isLocal) return;

    const nativeFetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
        let url = typeof input === 'string' ? input : (input && input.url);
        if (url && LOCAL_URL.test(url) && !LOCAL_URL.test(location.host)) {
            console.warn('[Emika] blocked fetch to localhost from', location.host);
            return Promise.reject(new Error('blocked-localhost'));
        }
        return nativeFetch(input, init);
    };

    const nativeReplace = location.replace.bind(location);
    const nativeAssign = location.assign.bind(location);

    location.replace = function (url) {
        if (typeof url === 'string' && LOCAL_URL.test(url)) {
            console.warn('[Emika] blocked redirect to localhost');
            return;
        }
        return nativeReplace(url);
    };

    location.assign = function (url) {
        if (typeof url === 'string' && LOCAL_URL.test(url)) {
            console.warn('[Emika] blocked redirect to localhost');
            return;
        }
        return nativeAssign(url);
    };
})();
