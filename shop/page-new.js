(function () {
    const SEEN_KEY = 'emika-seen-pages';

    function getSeen() {
        try {
            return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]'));
        } catch {
            return new Set();
        }
    }

    function markPageSeen(pageId) {
        if (!pageId) return;
        const seen = getSeen();
        seen.add(pageId);
        localStorage.setItem(SEEN_KEY, JSON.stringify([...seen]));
        document.querySelectorAll(`[data-page-new="${pageId}"]`).forEach((el) => {
            el.classList.remove('has-new-badge');
        });
    }

    function initNewBadges() {
        const seen = getSeen();
        document.querySelectorAll('[data-page-new]').forEach((el) => {
            const pageId = el.dataset.pageNew;
            if (!seen.has(pageId)) el.classList.add('has-new-badge');
            el.addEventListener('click', () => markPageSeen(pageId));
        });
        const current = document.body?.dataset?.pageId;
        if (current) markPageSeen(current);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initNewBadges);
    } else {
        initNewBadges();
    }

    window.emikaMarkPageSeen = markPageSeen;
})();
