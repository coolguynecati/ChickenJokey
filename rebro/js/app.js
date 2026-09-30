const PICKUP_ADDRESS = 'Новосибирск, Тюменская ул., 2А';
const ORDER_BRAND = 're-bro';
const ORDER_LOCATION = 'novosibirsk-tyumenskaya';
const DELIVERY_MIN_ORDER = 0;
const DELIVERY_FREE_FROM = 0;
const DELIVERY_FEE = 0;
const PHOTO_MENU_CATS = new Set(['shashlik', 'lyulya', 'shawarma', 'garnish', 'snacks', 'sauces', 'drinks']);
const KITCHEN_OPEN_MIN = 11 * 60;
const KITCHEN_LAST_SLOT_MIN = 21 * 60 + 30;
const LOCAL_TIME_ZONE = 'Asia/Novosibirsk';
const RESTAURANT_PHONE = '+7 913 757-44-14';
/** URL API приёма заказов (CRM). Пока пусто — заказ подтверждается звонком. */
const ORDER_API_URL = window.REBRO_ORDER_API_URL || '';

const STORAGE_KEYS = {
  cart: 'rebro_cart',
  orders: 'rebro_orders',
  user: 'rebro_user',
  pendingCrm: 'rebro_pending_crm',
};

let cart = JSON.parse(localStorage.getItem(STORAGE_KEYS.cart) || '[]');
let currentUser = JSON.parse(localStorage.getItem(STORAGE_KEYS.user) || 'null');
let checkoutType = 'pickup';
let paymentMethod = 'sbp';
let whenMode = 'asap';
const PREORDER_MAX_DAYS = 14;
const PREORDER_LEAD_MINUTES = 60;
const PREORDER_WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const NO_CART_MODE = document.body?.dataset?.noCart === '1';

function saveCart() {
  localStorage.setItem(STORAGE_KEYS.cart, JSON.stringify(cart));
  updateCartBadge();
}

function formatPrice(n) {
  return n.toLocaleString('ru-RU') + ' ₽';
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2800);
}

function updateCartBadge() {
  const count = cart.reduce((s, i) => s + i.qty, 0);
  document.querySelectorAll('.cart-btn__count').forEach(el => {
    el.textContent = count;
    el.dataset.count = count;
  });
  updateDeliveryProgress();
}

function getFreeDeliveryRemaining() {
  return Math.max(0, DELIVERY_FREE_FROM - getCartTotal());
}

function buildDeliveryProgressHtml() {
  const total = getCartTotal();
  if (total <= 0 || DELIVERY_FREE_FROM <= 0) return '';

  const remaining = getFreeDeliveryRemaining();
  const pct = Math.min(100, Math.round((total / DELIVERY_FREE_FROM) * 100));
  const done = remaining === 0;
  const text = done
    ? 'Доставка бесплатная!'
    : `До бесплатной доставки осталось ${formatPrice(remaining)}!`;

  return `
    <div class="delivery-progress${done ? ' delivery-progress--done' : ''}" role="status">
      <p class="delivery-progress__text">${text}</p>
      <div class="delivery-progress__bar" aria-hidden="true">
        <div class="delivery-progress__fill" style="width:${pct}%"></div>
      </div>
    </div>`;
}

function ensureDeliveryNudge() {
  let el = document.getElementById('delivery-nudge');
  if (el) return el;

  el = document.createElement('button');
  el.id = 'delivery-nudge';
  el.type = 'button';
  el.className = 'delivery-nudge';
  el.hidden = true;
  el.setAttribute('aria-live', 'polite');
  el.addEventListener('click', () => openCart());

  const cartBtn = document.querySelector('.masthead__actions .cart-btn, .subpage-header__actions .cart-btn');
  const actions = cartBtn?.parentElement;
  if (actions && cartBtn) {
    let wrap = actions.querySelector('.header-phone-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'header-phone-wrap';
      const phone = actions.querySelector('.btn-phone');
      if (phone) {
        actions.insertBefore(wrap, cartBtn);
        wrap.appendChild(phone);
      } else {
        actions.insertBefore(wrap, cartBtn);
      }
    }
    wrap.appendChild(el);
  } else {
    document.body.appendChild(el);
  }
  return el;
}

function updateDeliveryProgress() {
  if (NO_CART_MODE || DELIVERY_FREE_FROM <= 0) return;

  const nudge = ensureDeliveryNudge();
  const total = getCartTotal();
  const remaining = getFreeDeliveryRemaining();

  if (total <= 0) {
    nudge.classList.remove('is-visible', 'is-done');
    nudge.hidden = true;
    nudge.removeAttribute('title');
    nudge.removeAttribute('aria-label');
    return;
  }

  const done = remaining === 0;
  const pct = Math.min(100, Math.round((total / DELIVERY_FREE_FROM) * 100));
  const fullText = done
    ? 'Доставка бесплатная!'
    : `До бесплатной доставки осталось ${formatPrice(remaining)}!`;

  nudge.hidden = false;
  nudge.classList.toggle('is-done', done);
  nudge.classList.add('is-visible');
  nudge.title = fullText;
  nudge.setAttribute('aria-label', fullText);
  nudge.innerHTML = `
    <span class="delivery-nudge__icon" aria-hidden="true">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 7h11v8H3z"/>
        <path d="M14 10h4l3 3v2h-7z"/>
        <circle cx="7" cy="17" r="2"/>
        <circle cx="17" cy="17" r="2"/>
      </svg>
    </span>
    <span class="delivery-nudge__track" aria-hidden="true">
      <span class="delivery-nudge__fill" style="width:${pct}%"></span>
    </span>`;
}

function findItem(id) {
  for (const cat of MENU.categories) {
    const item = cat.items.find(i => i.id === id);
    if (item) return { ...item, category: cat.name, categoryId: cat.id };
  }
  return null;
}

/** Норма на 1 взрослого (г): мясо/шашлык — 200 г, овощи как гарнир — 150 г, набор — ~450 г. */
const SERVING_GRAMS = {
  shashlik: 200,
  lyulya: 200,
  shawarma: 500,
  garnish: 150,
  snacks: 250,
  sauces: 50,
  drinks: 500,
};

function parseDishWeight(weight) {
  const s = String(weight || '').trim().toLowerCase().replace(',', '.');
  const kg = s.match(/([\d.]+)\s*кг/);
  if (kg) return { grams: parseFloat(kg[1]) * 1000 };
  const g = s.match(/([\d.]+)\s*г(?:\s|$)/);
  if (g) return { grams: parseFloat(g[1]) };
  const pcs = s.match(/([\d.]+)\s*шт/);
  if (pcs) return { pieces: parseFloat(pcs[1]) };
  const ml = s.match(/([\d.]+)\s*мл/);
  if (ml) return { milliliters: parseFloat(ml[1]) };
  const liters = s.match(/([\d.]+)\s*л/);
  if (liters) return { milliliters: parseFloat(liters[1]) * 1000 };
  return null;
}

function getServesCount(item, categoryId = item.categoryId) {
  const parsed = parseDishWeight(item.weight);
  const cat = categoryId || 'shashlik';

  if (cat === 'drinks' || cat === 'sauces') return 1;
  if (parsed?.pieces != null) {
    const perPerson = cat === 'snacks' ? 4 : 1;
    return Math.max(1, Math.round(parsed.pieces / perPerson));
  }
  if (parsed?.milliliters != null) return 1;
  if (!parsed?.grams) return 1;

  const per = SERVING_GRAMS[cat] || 200;
  return Math.max(1, Math.round(parsed.grams / per));
}

function servesLabel(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `на ${n} человека`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `на ${n} человека`;
  return `на ${n} человек`;
}

function personIconSvg() {
  return `<svg class="serves-scale__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="7" r="3.2"/><path d="M5.5 20.5c.7-3.8 3.4-6 6.5-6s5.8 2.2 6.5 6"/></svg>`;
}

function renderServesScale(item, categoryId) {
  const n = getServesCount(item, categoryId);
  const show = Math.min(n, 8);
  const extra = n > 8 ? `<span class="serves-scale__extra">+${n - 8}</span>` : '';
  const icons = Array.from({ length: show }, () => personIconSvg()).join('');
  const pct = Math.min(100, Math.round((n / 8) * 100));
  return `
    <div class="serves-scale" title="${servesLabel(n)} · норма: мясо 200 г / овощи 150 г на человека" aria-label="${servesLabel(n)}">
      <div class="serves-scale__icons">${icons}${extra}</div>
      <div class="serves-scale__bar" aria-hidden="true"><span style="width:${pct}%"></span></div>
      <span class="serves-scale__label">${servesLabel(n)}</span>
    </div>`;
}

function addToCart(id) {
  if (NO_CART_MODE) {
    showToast('На этой версии сайта добавление в корзину отключено');
    return;
  }
  const item = findItem(id);
  if (!item) return;
  const existing = cart.find(c => c.id === id);
  if (existing) existing.qty++;
  else cart.push({ id, qty: 1 });
  saveCart();
  showToast(`${item.name} добавлен в корзину`);
}

function changeQty(id, delta) {
  const idx = cart.findIndex(c => c.id === id);
  if (idx === -1) return;
  cart[idx].qty += delta;
  if (cart[idx].qty <= 0) cart.splice(idx, 1);
  saveCart();
  renderCart();
}

function isCorporateOrder() {
  return Boolean(window.CorporateLunch?.isActive);
}

function getCartTotal() {
  if (isCorporateOrder()) {
    return window.CorporateLunch.getTotal();
  }
  return cart.reduce((s, c) => {
    const item = findItem(c.id);
    return s + (item ? item.price * c.qty : 0);
  }, 0);
}

function getDeliveryFee() {
  if (checkoutType !== 'delivery') return 0;
  if (isCorporateOrder() && typeof window.CorporateLunch.getDeliveryFee === 'function') {
    return window.CorporateLunch.getDeliveryFee();
  }
  if (DELIVERY_FREE_FROM > 0 && getCartTotal() >= DELIVERY_FREE_FROM) return 0;
  return DELIVERY_FEE;
}

function getOrderTotal() {
  if (isCorporateOrder() && typeof window.CorporateLunch.getOrderTotal === 'function') {
    return window.CorporateLunch.getOrderTotal();
  }
  return getCartTotal() + getDeliveryFee();
}

function updateCheckoutTotals() {
  const subtotal = getCartTotal();
  const fee = getDeliveryFee();
  const total = getOrderTotal();

  const subtotalEl = document.getElementById('checkout-subtotal');
  const feeEl = document.getElementById('checkout-delivery-fee');
  const feeRow = document.getElementById('checkout-delivery-row');
  const hintEl = document.getElementById('checkout-delivery-hint');
  const totalEl = document.getElementById('checkout-total');
  const submitBtn =
    document.getElementById('checkout-submit-btn') ||
    document.querySelector('#checkout-form button[type="submit"]');

  if (subtotalEl) subtotalEl.textContent = formatPrice(subtotal);
  if (totalEl) totalEl.textContent = formatPrice(total);

  const deliveryBlocked = checkoutType === 'delivery' && subtotal < DELIVERY_MIN_ORDER;

  if (submitBtn && !submitBtn.dataset.busy) {
    const defaultLabel = submitBtn.dataset.defaultLabel || submitBtn.textContent.trim() || 'Оплатить и заказать';
    if (!submitBtn.dataset.defaultLabel) submitBtn.dataset.defaultLabel = defaultLabel;
    submitBtn.disabled = deliveryBlocked;
    submitBtn.classList.toggle('btn--order-blocked', deliveryBlocked);
    submitBtn.textContent = deliveryBlocked
      ? `Минимум ${formatPrice(DELIVERY_MIN_ORDER)} на доставку`
      : submitBtn.dataset.defaultLabel;
  }

  if (!feeRow || !feeEl) return;

  if (checkoutType === 'delivery') {
    feeRow.hidden = false;
    feeEl.textContent = fee > 0 ? formatPrice(fee) : 'Уточнит оператор';
    if (hintEl) {
      if (subtotal < DELIVERY_MIN_ORDER) {
        hintEl.textContent = `Минимальная сумма заказа на доставку — ${formatPrice(DELIVERY_MIN_ORDER)}`;
      } else if (fee > 0) {
        hintEl.textContent = `Доставка от ${formatPrice(DELIVERY_FEE)}. Бесплатно от ${formatPrice(DELIVERY_FREE_FROM)}`;
      } else {
        hintEl.textContent = '';
      }
    }
  } else {
    feeRow.hidden = true;
    if (hintEl) hintEl.textContent = '';
  }
}

const MENU_SPLIT_THRESHOLD = 8;

const MENU_TAB_SHORT = {
  shashlik: 'Шашлык',
  lyulya: 'Люля',
  shawarma: 'Шаурма',
  garnish: 'Гарниры',
  snacks: 'Закуски',
  sauces: 'Соусы',
  drinks: 'Напитки',
};

/**
 * Фильтры состава. По умолчанию включены все типы.
 * Клик выключает тип: такие позиции и полностью опустевшие разделы не показываем.
 * Теги определяются по названию, описанию и бейджу позиции.
 */
const MENU_FILTERS = [
  { id: 'pork', label: 'Свинина', words: ['свин', 'сало', 'ветчин', 'пепперони'] },
  { id: 'chicken', label: 'Курица', words: ['куриц', 'курин', 'цыпл', 'наггетс'] },
  { id: 'beef', label: 'Говядина', words: ['говя', 'пепперони'] },
  { id: 'mushrooms', label: 'Грибы', words: ['гриб', 'шампиньон', 'вешенк'] },
  {
    id: 'cheese',
    label: 'Сыр',
    words: ['сыр', 'сулугуни', 'моцарелл', 'пармезан', 'горгонзол', 'имеретин', 'творожн', 'брынз', 'голландск', 'хачапури'],
  },
];

/** Позиции, состав которых не читается из текста: наггетсы и ассорти «все виды». */
const MENU_FILTER_EXTRA_TAGS = {
  sn3: ['chicken'],
  set2: ['pork', 'chicken', 'veal', 'lamb'],
  set3: ['pork', 'chicken', 'veal', 'lamb'],
  set5: ['chicken', 'veal', 'lamb', 'cheese'],
};

const MENU_FILTERS_KEY = 'rebro_menu_filters_off';
const menuTagsCache = new Map();
let disabledMenuFilters = readDisabledMenuFilters();
let activeMenuCategoryId = '';

function readDisabledMenuFilters() {
  const known = new Set(MENU_FILTERS.map((f) => f.id));
  try {
    const raw = JSON.parse(localStorage.getItem(MENU_FILTERS_KEY) || '[]');
    return new Set((Array.isArray(raw) ? raw : []).filter((id) => known.has(id)));
  } catch {
    return new Set();
  }
}

function saveDisabledMenuFilters() {
  try {
    localStorage.setItem(MENU_FILTERS_KEY, JSON.stringify([...disabledMenuFilters]));
  } catch {
    /* приватный режим браузера — фильтр живёт до перезагрузки */
  }
}

function menuItemTags(item) {
  const cached = menuTagsCache.get(item.id);
  if (cached) return cached;
  const text = `${item.name || ''} ${item.desc || ''} ${item.badge || ''}`
    .toLowerCase()
    .replace(/ё/g, 'е');
  const tags = new Set(MENU_FILTER_EXTRA_TAGS[item.id] || []);
  MENU_FILTERS.forEach((filter) => {
    if (filter.words.some((word) => text.includes(word))) tags.add(filter.id);
  });
  menuTagsCache.set(item.id, tags);
  return tags;
}

function isMenuItemAllowed(item) {
  if (!item || !disabledMenuFilters.size) return Boolean(item);
  for (const tag of menuItemTags(item)) {
    if (disabledMenuFilters.has(tag)) return false;
  }
  return true;
}

function allowedCategoryItems(cat) {
  return (cat?.items || []).filter(isMenuItemAllowed);
}

function allowedMenuCategories() {
  return MENU.categories.filter((cat) => allowedCategoryItems(cat).length > 0);
}

function menuFiltersHost() {
  const existing = document.getElementById('menu-filters');
  if (existing) return existing;
  const nav = document.getElementById('menu-nav');
  if (!nav?.parentNode) return null;
  const host = document.createElement('div');
  host.id = 'menu-filters';
  nav.parentNode.insertBefore(host, nav);
  return host;
}

function renderMenuFilters() {
  const host = menuFiltersHost();
  if (!host) return;

  const chips = MENU_FILTERS.map((filter) => {
    const off = disabledMenuFilters.has(filter.id);
    return `<button type="button" class="menu-filter${off ? ' is-off' : ''}" data-filter="${filter.id}" aria-pressed="${off ? 'false' : 'true'}">${filter.label}</button>`;
  }).join('');
  const reset = disabledMenuFilters.size
    ? '<button type="button" class="menu-filter menu-filter--reset" data-filter-reset="1">Сбросить</button>'
    : '';

  host.className = 'menu-filters';
  host.innerHTML = `
    <p class="menu-filters__hint">Показаны блюда из продуктов, выделенных в желтом цвете. Если вы хотите убрать определенные продукты, нажмите на нужный пункт чтобы выключить его из списка меню.</p>
    <div class="menu-filters__row" role="group" aria-label="Фильтр по составу блюд">${chips}${reset}</div>`;

  host.querySelectorAll('[data-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.filter;
      if (disabledMenuFilters.has(id)) disabledMenuFilters.delete(id);
      else disabledMenuFilters.add(id);
      saveDisabledMenuFilters();
      renderMenu();
    });
  });

  host.querySelector('[data-filter-reset]')?.addEventListener('click', () => {
    disabledMenuFilters.clear();
    saveDisabledMenuFilters();
    renderMenu();
  });
}

function menuEmptyStateHtml() {
  return '<p class="menu-filters__empty">Под выбранные ограничения ничего не осталось — включите обратно один из пунктов выше.</p>';
}

function renderCategoryTabButton(cat, active = false, classes = {}) {
  const {
    btnClass = 'menu-tab',
    thumbClass = 'menu-tab__thumb',
    labelClass = 'menu-tab__label',
    shortNames = MENU_TAB_SHORT,
  } = classes;
  const short = shortNames[cat.id] || cat.name;
  const img = cat.image || 'images/menu/sh1.jpg';
  return `
    <button type="button" class="${btnClass}${active ? ' active' : ''}" data-cat="${cat.id}" role="tab" aria-selected="${active}">
      <img class="${thumbClass}" src="${img}" alt="" loading="lazy" aria-hidden="true">
      <span class="${labelClass}">${short}</span>
    </button>`;
}

function categoryHasPhotos(cat) {
  return PHOTO_MENU_CATS.has(cat.id) || cat.items.some((item) => item.image);
}

function renderMenuItem(item, categoryId = '') {
  const addBtn = NO_CART_MODE
    ? ''
    : `<button class="add-btn add-btn--sm" onclick="addToCart('${item.id}')" aria-label="Добавить в корзину">+</button>`;
  return `
    <article class="menu-item ${item.isSet ? 'menu-item--set' : ''}">
      <div class="menu-item__row">
        <div class="menu-item__title">
          <h4 class="menu-item__name">${item.name}</h4>
          ${item.badge ? `<span class="menu-item__badge">${item.badge}</span>` : ''}
          <span class="menu-item__weight">${item.weight}</span>
        </div>
        <span class="menu-item__leader" aria-hidden="true"></span>
        <span class="menu-item__price">${formatPrice(item.price)}</span>
        ${addBtn}
      </div>
      ${item.desc ? `<p class="menu-item__desc">${item.desc}</p>` : ''}
    </article>`;
}

function renderDishCard(item, index = 0, categoryId = '') {
  const img = item.image || 'images/menu/sh1.jpg';
  const catId = categoryId || item.categoryId;
  const addBtn = NO_CART_MODE
    ? ''
    : `<button type="button" class="dish-card__add" onclick="event.stopPropagation();addToCart('${item.id}')" aria-label="Добавить в корзину">В корзину</button>`;
  return `
    <article class="dish-card" style="--i:${index}">
      <button type="button" class="dish-card__media" onclick="openDish('${item.id}')" aria-label="Открыть ${item.name}">
        <img src="${img}" alt="${item.name}" loading="lazy">
      </button>
      <div class="dish-card__body">
        <h4 class="dish-card__name">${item.name}</h4>
        <p class="dish-card__meta">${item.weight} · <span>${formatPrice(item.price)}</span></p>
        ${item.desc ? `<p class="dish-card__desc">${item.desc}</p>` : ''}
        ${addBtn}
      </div>
    </article>`;
}

function renderMenuList(items, withPhotos = false, categoryId = '') {
  if (withPhotos) {
    return `<div class="dish-grid">${items.map((item, i) => renderDishCard(item, i, categoryId)).join('')}</div>`;
  }

  if (items.length < MENU_SPLIT_THRESHOLD) {
    return `<div class="menu-list">${items.map((item) => renderMenuItem(item, categoryId)).join('')}</div>`;
  }

  const mid = Math.ceil(items.length / 2);
  const left = items.slice(0, mid);
  const right = items.slice(mid);

  return `
    <div class="menu-list menu-list--split">
      <div class="menu-list__col">${left.map((item) => renderMenuItem(item, categoryId)).join('')}</div>
      <div class="menu-list__col">${right.map((item) => renderMenuItem(item, categoryId)).join('')}</div>
    </div>`;
}

function renderCategoryBlock(cat, compact = false) {
  const modern = categoryHasPhotos(cat) && PHOTO_MENU_CATS.has(cat.id);
  const header = compact
    ? `<h3 class="menu-category__title">${cat.name}</h3>`
    : `
      <div class="menu-category__img-wrap">
        <img class="menu-category__img" src="${cat.image}" alt="${cat.name}" loading="lazy">
      </div>
      <h3 class="menu-category__title">${cat.name}</h3>`;

  return `
    <div class="menu-category${compact ? ' menu-category--compact' : ''}${modern ? ' menu-category--gallery' : ''}" id="cat-${cat.id}">
      <div class="menu-category__header${compact ? ' menu-category__header--compact' : ''}">
        ${header}
      </div>
      ${renderMenuList(allowedCategoryItems(cat), modern, cat.id)}
    </div>`;
}

function openDish(id) {
  const item = findItem(id);
  if (!item) return;
  const modal = document.getElementById('dish-modal');
  const img = document.getElementById('dish-modal-img');
  const name = document.getElementById('dish-modal-name');
  const meta = document.getElementById('dish-modal-meta');
  const desc = document.getElementById('dish-modal-desc');
  const addBtn = document.getElementById('dish-modal-add');
  if (!modal || !img || !name || !meta || !desc) return;

  img.src = item.image || 'images/menu/sh1.jpg';
  img.alt = item.name;
  name.textContent = item.name;
  meta.textContent = `${item.weight} · ${formatPrice(item.price)}`;
  desc.textContent = item.desc || '';
  desc.hidden = !item.desc;

  if (addBtn) {
    if (NO_CART_MODE) {
      addBtn.hidden = true;
    } else {
      addBtn.hidden = false;
      addBtn.onclick = () => {
        addToCart(item.id);
        closeModal('dish-modal');
      };
    }
  }
  openModal('dish-modal');
}

function renderMenuNavCard(cat) {
  return `
    <button type="button" class="menu-nav__card" data-cat="${cat.id}" aria-expanded="false">
      <div class="menu-nav__img-wrap">
        <img class="menu-nav__img" src="${cat.image}" alt="${cat.name}" loading="lazy">
      </div>
      <span class="menu-nav__label">${cat.name}</span>
    </button>`;
}

function renderFullMenu(animate = false) {
  const container = document.getElementById('menu-content');
  const nav = document.getElementById('menu-nav');
  if (!container) return;

  const cats = allowedMenuCategories();

  if (nav) {
    nav.className = 'menu-nav menu-nav--text';
    nav.innerHTML = cats.map(cat => `
      <a href="#cat-${cat.id}" class="menu-nav__link" data-cat="${cat.id}">${cat.name}</a>
    `).join('');

    nav.querySelectorAll('.menu-nav__link').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        nav.querySelectorAll('.menu-nav__link').forEach(l => l.classList.remove('active'));
        link.classList.add('active');
        document.getElementById(`cat-${link.dataset.cat}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        history.replaceState(null, '', `#cat-${link.dataset.cat}`);
      });
    });
  }

  if (animate) {
    // Smooth transition for content change
    const currentHeight = container.offsetHeight;
    container.style.height = currentHeight + 'px';
    container.style.opacity = '0.7';

    setTimeout(() => {
      container.innerHTML = cats.length
        ? cats.map(cat => renderCategoryBlock(cat, true)).join('')
        : menuEmptyStateHtml();
      const newHeight = container.offsetHeight;
      container.style.height = newHeight + 'px';
      container.style.opacity = '1';

      setTimeout(() => {
        container.style.height = '';
      }, 800);
    }, 200);
  } else {
    container.innerHTML = cats.length
      ? cats.map(cat => renderCategoryBlock(cat, true)).join('')
      : menuEmptyStateHtml();
  }

  const hashMatch = location.hash.match(/^#cat-(.+)$/);
  if (hashMatch) {
    const target = document.getElementById(`cat-${hashMatch[1]}`);
    if (target) {
      nav?.querySelector(`[data-cat="${hashMatch[1]}"]`)?.classList.add('active');
      requestAnimationFrame(() => target.scrollIntoView({ block: 'start' }));
    }
  }
}

function renderHomeMenuCategory(catId) {
  const cat = MENU.categories.find((c) => c.id === catId);
  if (!cat) return '';
  const withPhotos = categoryHasPhotos(cat) && PHOTO_MENU_CATS.has(cat.id);
  return renderMenuList(allowedCategoryItems(cat), withPhotos, cat.id);
}

function renderHomeMenu() {
  const container = document.getElementById('menu-content');
  const nav = document.getElementById('menu-nav');
  const hint = document.getElementById('menu-hint');
  if (!container || !nav) return;

  const cats = allowedMenuCategories();
  nav.className = 'menu-nav menu-nav--tabs';
  nav.setAttribute('role', 'tablist');

  if (!cats.length) {
    nav.innerHTML = '';
    container.innerHTML = menuEmptyStateHtml();
    if (hint) hint.hidden = true;
    return;
  }

  const activeId = cats.some((cat) => cat.id === activeMenuCategoryId)
    ? activeMenuCategoryId
    : cats[0].id;
  activeMenuCategoryId = activeId;

  nav.innerHTML = cats.map((cat) => renderCategoryTabButton(cat, cat.id === activeId)).join('');

  container.innerHTML = `<div class="menu-tabs-panel" id="menu-tabs-panel" role="tabpanel">${renderHomeMenuCategory(activeId)}</div>`;
  if (hint) hint.hidden = true;

  nav.querySelectorAll('.menu-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.cat;
      activeMenuCategoryId = id;
      nav.querySelectorAll('.menu-tab').forEach((b) => {
        const isActive = b.dataset.cat === id;
        b.classList.toggle('active', isActive);
        b.setAttribute('aria-selected', isActive ? 'true' : 'false');
      });
      const panel = document.getElementById('menu-tabs-panel');
      if (panel) {
        applySmoothTransition(panel, renderHomeMenuCategory(id));
      }
    });
  });
}

function applySmoothTransition(element, newContent) {
  const currentHeight = element.offsetHeight;
  element.style.height = currentHeight + 'px';
  element.style.opacity = '0.7';

  setTimeout(() => {
    element.innerHTML = newContent;
    const newHeight = element.offsetHeight;
    element.style.height = newHeight + 'px';
    element.style.opacity = '1';

    setTimeout(() => {
      element.style.height = '';
    }, 800);
  }, 200);
}

function renderMenu() {
  const page = document.body.dataset.page || 'home';
  if (page === 'corporate') return; // js/corporate.js
  if (page === 'alt') return; // js/app-alt.js
  renderMenuFilters();

  const container = document.getElementById('menu-content');
  if (container) {
    const currentHeight = container.offsetHeight;
    container.style.height = currentHeight + 'px';
    container.style.opacity = '0.7';

    setTimeout(() => {
      if (page === 'full-menu') renderFullMenu(false);
      else renderHomeMenu();

      const newHeight = container.offsetHeight;
      container.style.height = newHeight + 'px';
      container.style.opacity = '1';

      setTimeout(() => {
        container.style.height = '';
      }, 800);
    }, 200);
  } else {
    if (page === 'full-menu') renderFullMenu(false);
    else renderHomeMenu();
  }
}

function renderCart() {
  const body = document.getElementById('cart-body');
  const footer = document.getElementById('cart-footer');
  if (!body) return;

  if (cart.length === 0) {
    body.innerHTML = `<div class="cart-empty"><div class="cart-empty__icon">🛒</div><p>Корзина пуста</p><p style="margin-top:8px;font-size:0.85rem">Добавьте блюда из меню</p></div>`;
    footer.style.display = 'none';
    return;
  }

  footer.style.display = 'flex';
  body.innerHTML = buildDeliveryProgressHtml() + cart.map(c => {
    const item = findItem(c.id);
    if (!item) return '';
    return `
      <div class="cart-item">
        <div class="cart-item__info">
          <div class="cart-item__name">${item.name}</div>
          <div class="cart-item__weight">${item.weight}</div>
        </div>
        <div class="qty-control">
          <button onclick="changeQty('${c.id}', -1)">−</button>
          <span>${c.qty}</span>
          <button onclick="changeQty('${c.id}', 1)">+</button>
        </div>
        <div class="cart-item__price">${formatPrice(item.price * c.qty)}</div>
      </div>`;
  }).join('');

  document.getElementById('cart-total-sum').textContent = formatPrice(getCartTotal());
  updateCheckoutTotals();
}

function anyModalOpen() {
  return Boolean(document.querySelector('.modal-overlay.open'));
}

function openModal(id) {
  document.getElementById(id)?.classList.add('open');
  document.body.style.overflow = 'hidden';
  document.body.classList.add('modal-open');
  closeOrderBotUi();
}

function closeModal(id) {
  document.getElementById(id)?.classList.remove('open');
  if (!anyModalOpen()) {
    document.body.style.overflow = '';
    document.body.classList.remove('modal-open');
    restoreOrderBotFab();
  }
}

function closeAllModals() {
  document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open'));
  document.body.style.overflow = '';
  document.body.classList.remove('modal-open');
  restoreOrderBotFab();
}

function closeOrderBotUi() {
  // При корзине/чекауте прячем и панель, и кнопку — иначе FAB перекрывает модалку.
  const panel = document.getElementById('order-bot');
  const fab = document.getElementById('order-bot-fab');
  const wrap = document.getElementById('order-bot-fab-wrap');
  panel?.classList.remove('is-open');
  panel?.setAttribute('aria-hidden', 'true');
  fab?.classList.add('is-hidden');
  wrap?.classList.add('is-hidden');
}

function restoreOrderBotFab() {
  if (anyModalOpen()) return;
  const panel = document.getElementById('order-bot');
  const fab = document.getElementById('order-bot-fab');
  const wrap = document.getElementById('order-bot-fab-wrap');
  if (panel?.classList.contains('is-open')) return;
  fab?.classList.remove('is-hidden');
  wrap?.classList.remove('is-hidden');
  // Если пользователь сам скрыл крестиком/свайпом — не возвращаем
  try {
    if (localStorage.getItem('rebro_order_bot_fab_dismissed') === '1') {
      wrap?.classList.add('is-dismissed');
    }
  } catch (_) {}
}

function openCart() {
  if (NO_CART_MODE) {
    showToast('Корзина отключена на этой версии сайта');
    return;
  }
  renderCart();
  openModal('cart-modal');
}

function openCheckout() {
  if (NO_CART_MODE) {
    showToast('Оформление заказа отключено на этой версии сайта');
    return;
  }
  if (isCorporateOrder()) {
    if (!window.CorporateLunch.hasItems()) return;
    setCheckoutType('delivery');
    const cmt = document.getElementById('checkout-comment') || document.querySelector('#checkout-form textarea[name="comment"]');
    if (cmt && typeof window.CorporateLunch.buildComment === 'function') {
      cmt.value = window.CorporateLunch.buildComment();
    }
    updateCheckoutTotals();
    openModal('checkout-modal');
    return;
  }
  if (cart.length === 0) return;
  // Не вызываем closeModal('cart'), иначе помощник вспыхнет между модалками.
  document.getElementById('cart-modal')?.classList.remove('open');
  updateCheckoutTotals();
  if (whenMode === 'preorder') refreshPreorderSlots();
  openModal('checkout-modal');
}

function setCheckoutType(type) {
  checkoutType = type;
  document.querySelectorAll('.delivery-toggle__btn').forEach(b => {
    b.classList.toggle('active', b.dataset.type === type);
  });
  document.getElementById('address-group').style.display = type === 'delivery' ? 'block' : 'none';
  document.getElementById('pickup-info').style.display = type === 'pickup' ? 'block' : 'none';
  updateCheckoutTotals();
}

function setPayment(method) {
  paymentMethod = method;
  document.querySelectorAll('.payment-method').forEach(m => {
    m.classList.toggle('active', m.dataset.method === method);
  });
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function localNowParts() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: LOCAL_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
  return {
    y: Number(parts.year),
    mo: Number(parts.month),
    d: Number(parts.day),
    h: Number(parts.hour),
    mi: Number(parts.minute),
  };
}

function isoFromParts(p) {
  return `${p.y}-${pad2(p.mo)}-${pad2(p.d)}`;
}

function addDaysIso(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

function weekdayFromIso(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function formatPreorderHuman(dateIso, time) {
  if (!dateIso) return '';
  const [y, m, d] = dateIso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const day = dt.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', weekday: 'short', timeZone: 'UTC' });
  return time ? `${day}, ${time}` : day;
}

function formatPreorderShort(dateIso, time) {
  if (!dateIso) return String(time || '');
  const [, m, d] = dateIso.split('-');
  return `${d}.${m} ${time || ''}`.trim();
}

function parsePickupTimeAt(value) {
  const s = String(value || '').trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})/);
  if (m) return { date: `${m[1]}-${m[2]}-${m[3]}`, time: `${pad2(m[4])}:${m[5]}` };
  m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (m) return { date: '', time: `${pad2(m[1])}:${m[2]}` };
  return null;
}

function kitchenSlotsForDate(_iso) {
  const slots = [];
  for (let t = KITCHEN_OPEN_MIN; t <= KITCHEN_LAST_SLOT_MIN; t += 30) {
    slots.push(`${pad2(Math.floor(t / 60))}:${pad2(t % 60)}`);
  }
  return slots;
}

function isPreorderSlotOpen(dateIso, hhmm) {
  if (!dateIso || !hhmm) return false;
  const now = localNowParts();
  const today = isoFromParts(now);
  const max = addDaysIso(today, PREORDER_MAX_DAYS);
  if (dateIso < today || dateIso > max) return false;
  const [h, mi] = hhmm.split(':').map(Number);
  const slotMin = h * 60 + mi;
  if (dateIso === today) {
    return slotMin >= now.h * 60 + now.mi + PREORDER_LEAD_MINUTES;
  }
  return true;
}

function defaultPreorderDate() {
  const now = localNowParts();
  const today = isoFromParts(now);
  const hasToday = kitchenSlotsForDate(today).some((t) => isPreorderSlotOpen(today, t));
  return hasToday ? today : addDaysIso(today, 1);
}

function getCheckoutWhen() {
  if (whenMode !== 'preorder') {
    return { pickupTimeMode: 'asap', pickupTimeAt: '', label: '' };
  }
  const date = document.getElementById('preorder-date')?.value || '';
  const time = document.getElementById('preorder-time')?.value || '';
  if (!date || !time || !isPreorderSlotOpen(date, time)) {
    return { pickupTimeMode: 'at', pickupTimeAt: '', label: '', invalid: true };
  }
  return {
    pickupTimeMode: 'at',
    pickupTimeAt: `${date} ${time}`,
    label: formatPreorderHuman(date, time),
    short: formatPreorderShort(date, time),
  };
}

function renderPreorderDays(selectedIso) {
  const wrap = document.getElementById('preorder-days');
  if (!wrap) return;
  const today = isoFromParts(localNowParts());
  wrap.innerHTML = '';
  for (let i = 0; i < 8; i++) {
    const iso = addDaysIso(today, i);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'preorder-day' + (iso === selectedIso ? ' is-active' : '');
    btn.dataset.date = iso;
    const wd = PREORDER_WEEKDAYS[weekdayFromIso(iso)];
    const title = i === 0 ? 'Сегодня' : i === 1 ? 'Завтра' : `${Number(iso.slice(8))}`;
    btn.innerHTML = `${title}<span>${wd}</span>`;
    btn.addEventListener('click', () => {
      const dateInput = document.getElementById('preorder-date');
      if (dateInput) dateInput.value = iso;
      refreshPreorderSlots();
    });
    wrap.appendChild(btn);
  }
}

function refreshPreorderSlots() {
  const dateInput = document.getElementById('preorder-date');
  const timeSelect = document.getElementById('preorder-time');
  if (!dateInput || !timeSelect) return;

  const today = isoFromParts(localNowParts());
  dateInput.min = today;
  dateInput.max = addDaysIso(today, PREORDER_MAX_DAYS);
  if (!dateInput.value) dateInput.value = defaultPreorderDate();
  if (dateInput.value < today) dateInput.value = today;
  if (dateInput.value > dateInput.max) dateInput.value = dateInput.max;

  const prev = timeSelect.value;
  const slots = kitchenSlotsForDate(dateInput.value).filter((t) => isPreorderSlotOpen(dateInput.value, t));
  timeSelect.innerHTML = '<option value="">Выберите время</option>';
  slots.forEach((slot) => {
    const opt = document.createElement('option');
    opt.value = slot;
    opt.textContent = slot;
    timeSelect.appendChild(opt);
  });
  if (prev && slots.includes(prev)) timeSelect.value = prev;
  else if (slots[0]) timeSelect.value = slots[0];

  renderPreorderDays(dateInput.value);
}

function setWhenMode(mode) {
  whenMode = mode === 'preorder' ? 'preorder' : 'asap';
  document.querySelectorAll('.when-toggle .delivery-toggle__btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.when === whenMode);
  });
  const panel = document.getElementById('preorder-fields');
  if (panel) {
    panel.hidden = whenMode !== 'preorder';
  }
  if (whenMode === 'preorder') refreshPreorderSlots();
}

function initPreorderUi() {
  const dateInput = document.getElementById('preorder-date');
  if (!dateInput) return;
  dateInput.addEventListener('change', refreshPreorderSlots);
  setWhenMode('asap');
}

function buildOrderItems() {
  if (isCorporateOrder() && typeof window.CorporateLunch.buildOrderItems === 'function') {
    return window.CorporateLunch.buildOrderItems();
  }

  const items = cart.map((c) => {
    const item = findItem(c.id);
    if (!item) return null;
    return {
      id: c.id,
      titleRu: item.name,
      titleEn: item.name,
      price: item.price,
      qty: c.qty,
      image: item.image || '',
    };
  }).filter(Boolean);

  const deliveryFee = getDeliveryFee();
  if (deliveryFee > 0) {
    items.push({
      id: 'delivery-fee',
      titleRu: 'Доставка',
      titleEn: 'Delivery',
      price: deliveryFee,
      qty: 1,
      image: '',
    });
  }

  return items;
}

function makeLocalOrderNumber() {
  const t = Date.now().toString(36).toUpperCase();
  const r = Math.random().toString(36).slice(2, 5).toUpperCase();
  return `WEB-${t}-${r}`;
}

function readPendingCrmOrders() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEYS.pendingCrm) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function writePendingCrmOrders(list) {
  localStorage.setItem(STORAGE_KEYS.pendingCrm, JSON.stringify(list.slice(0, 30)));
}

function queuePendingCrmOrder(payload, localOrderNumber) {
  const list = readPendingCrmOrders();
  list.push({
    payload,
    localOrderNumber,
    createdAt: new Date().toISOString(),
    tries: 0,
  });
  writePendingCrmOrders(list);
}

function friendlyFetchError(err, fallback = 'Нет связи с сервером') {
  const msg = String(err?.message || err || '');
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(msg)) {
    return `${fallback}. Проверьте интернет или попробуйте через минуту`;
  }
  if (/abort|timeout|timed out/i.test(msg)) {
    return 'Сервер не ответил вовремя. Попробуйте ещё раз';
  }
  return msg || fallback;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 6000) {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    return await fetch(url, { ...options, signal: ctrl?.signal || options.signal });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function postOrderToCrm(payload, { timeoutMs = 8000, localOrderNumber } = {}) {
  if (!ORDER_API_URL) throw new Error('API заказов не настроен');
  const body = {
    ...payload,
    clientOrderKey: localOrderNumber || payload.clientOrderKey || '',
    localOrderNumber: localOrderNumber || payload.localOrderNumber || '',
  };
  try {
    const res = await fetchWithTimeout(
      ORDER_API_URL,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      timeoutMs
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Не удалось отправить заказ в CRM');
    return { ok: true, id: data.id, orderNumber: data.orderNumber, deduped: Boolean(data.deduped) };
  } catch (err) {
    throw new Error(friendlyFetchError(err, 'CRM временно недоступна'));
  }
}

function formatPickupTimeAtLabel(value) {
  const parsed = parsePickupTimeAt(value);
  if (!parsed) return String(value || '').trim();
  if (parsed.date) return formatPreorderHuman(parsed.date, parsed.time);
  return parsed.time;
}

async function flushPendingCrmOrders() {
  if (!ORDER_API_URL) return;
  const list = readPendingCrmOrders();
  if (!list.length) return;
  const left = [];
  for (const row of list) {
    try {
      await postOrderToCrm(row.payload, {
        timeoutMs: 15000,
        localOrderNumber: row.localOrderNumber,
      });
    } catch {
      row.tries = (row.tries || 0) + 1;
      if (row.tries < 12) left.push(row);
    }
  }
  writePendingCrmOrders(left);
}

function normalizeCheckoutEmail(form) {
  const emailInput = form?.email || document.getElementById('checkout-email');
  const hint = document.getElementById('checkout-email-hint');
  if (!emailInput) return { email: '', blocked: false };

  const raw = String(emailInput.value || '').trim();
  if (!raw) {
    emailInput.classList.remove('is-invalid');
    if (hint) hint.hidden = true;
    return { email: '', blocked: false };
  }

  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) {
    emailInput.value = raw;
    emailInput.classList.remove('is-invalid');
    if (hint) hint.hidden = true;
    return { email: raw, blocked: false };
  }

  // Неверный формат: очищаем, предупреждаем, заказ пока не отправляем
  emailInput.value = '';
  emailInput.classList.add('is-invalid');
  if (hint) hint.hidden = false;
  showToast('Email неверный — поле очищено. Можно оставить пустым и отправить заказ');
  emailInput.focus();
  return { email: '', blocked: true };
}

async function placeOrder(e) {
  e.preventDefault();
  const form = e.target;
  const name = form.name.value.trim();
  const phone = form.phone.value.trim();
  if (!name || !phone) return;

  const corporate = isCorporateOrder() && window.CorporateLunch.hasItems();
  if (corporate) checkoutType = 'delivery';

  const address = form.address?.value?.trim() || '';
  if (checkoutType === 'delivery' && !address) {
    showToast(corporate ? 'Укажите адрес офиса' : 'Укажите адрес доставки');
    return;
  }
  if (checkoutType === 'delivery' && getCartTotal() < DELIVERY_MIN_ORDER) {
    showToast(`Минимальная сумма заказа на доставку — ${formatPrice(DELIVERY_MIN_ORDER)}`);
    return;
  }
  if (corporate && !window.CorporateLunch.hasItems()) {
    showToast('Добавьте блюда хотя бы на один день');
    return;
  }
  if (!corporate && cart.length === 0) return;

  const when = document.getElementById('preorder-fields') ? getCheckoutWhen() : { pickupTimeMode: 'asap', pickupTimeAt: '' };
  if (when.invalid) {
    showToast('Выберите дату и время предзаказа');
    setWhenMode('preorder');
    document.getElementById('preorder-time')?.focus();
    return;
  }

  const emailResult = normalizeCheckoutEmail(form);
  if (emailResult.blocked) return;
  const email = emailResult.email;

  const submitBtn = form.querySelector('button[type="submit"]');
  const prevLabel = submitBtn?.dataset.defaultLabel || submitBtn?.textContent;
  if (submitBtn) {
    submitBtn.dataset.busy = '1';
    submitBtn.disabled = true;
    submitBtn.classList.remove('btn--order-blocked');
    submitBtn.textContent = 'Отправляем…';
  }

  const localOrderNumber = makeLocalOrderNumber();
  let comment = form.comment?.value?.trim() || '';
  if (corporate && typeof window.CorporateLunch.buildComment === 'function') {
    const built = window.CorporateLunch.buildComment();
    // если гость правил поле — берём его текст, иначе собранный
    comment = comment || built;
    if (comment && built && !comment.includes('[corp]')) {
      comment = `${comment}\n${built}`;
    }
  }

  const corpMeta = corporate && typeof window.CorporateLunch.getScheduleMeta === 'function'
    ? window.CorporateLunch.getScheduleMeta()
    : null;

  if (when.pickupTimeMode === 'at' && when.label && !/Предзаказ:/i.test(comment)) {
    comment = comment ? `Предзаказ: ${when.label}\n${comment}` : `Предзаказ: ${when.label}`;
  }

  const payload = {
    brand: ORDER_BRAND,
    customer: {
      name,
      phone,
      email,
    },
    deliveryType: checkoutType,
    location: ORDER_LOCATION,
    address: checkoutType === 'delivery' ? address : PICKUP_ADDRESS,
    addressExtra: '',
    comment,
    paymentMethod,
    pickupTimeMode: when.pickupTimeMode || 'asap',
    pickupTimeAt: when.pickupTimeAt || '',
    wantedAt: when.pickupTimeAt || '',
    promoCode: '',
    items: buildOrderItems(),
    total: getOrderTotal(),
    orderKind: corporate ? 'corporate' : 'regular',
    corporate: corpMeta || undefined,
  };

  try {
    let crmOk = false;
    let crmId = null;
    let orderNumber = localOrderNumber;

    if (ORDER_API_URL) {
      try {
        const crm = await postOrderToCrm(payload, { timeoutMs: 8000, localOrderNumber });
        crmOk = Boolean(crm?.ok);
        crmId = crm?.id || null;
        orderNumber = crm?.orderNumber || localOrderNumber;
      } catch {
        queuePendingCrmOrder(payload, localOrderNumber);
      }
    }

    const orderItems = corporate && typeof window.CorporateLunch.snapshotCart === 'function'
      ? window.CorporateLunch.snapshotCart()
      : [...cart];
    const orderTotal = getOrderTotal();
    const orderDeliveryFee = getDeliveryFee();

    const order = {
      id: crmOk ? crmId : localOrderNumber,
      orderNumber,
      items: orderItems,
      total: orderTotal,
      deliveryFee: orderDeliveryFee,
      type: checkoutType,
      payment: paymentMethod,
      name,
      phone,
      email: payload.customer.email,
      address: payload.address,
      status: 'new',
      createdAt: new Date().toISOString(),
      crmSynced: crmOk,
      pickupTimeMode: payload.pickupTimeMode,
      pickupTimeAt: payload.pickupTimeAt,
      orderKind: corporate ? 'corporate' : 'regular',
      corporate: corpMeta || undefined,
    };

    const orders = JSON.parse(localStorage.getItem(STORAGE_KEYS.orders) || '[]');
    orders.unshift(order);
    localStorage.setItem(STORAGE_KEYS.orders, JSON.stringify(orders));

    if (!currentUser) {
      currentUser = { name, phone, email: order.email };
      localStorage.setItem(STORAGE_KEYS.user, JSON.stringify(currentUser));
    }

    if (corporate && typeof window.CorporateLunch.clear === 'function') {
      window.CorporateLunch.clear();
    } else {
      cart = [];
      saveCart();
    }
    closeAllModals();

    document.getElementById('success-order-id').textContent = orderNumber;
    const note = document.getElementById('success-order-note');
    if (note) {
      const whenText = payload.pickupTimeMode === 'at' && when.label ? ` Приготовим к ${when.label}.` : '';
      note.textContent = crmOk
        ? `Заказ отправлен на кухню.${whenText} Мы свяжемся с вами при необходимости.`
        : `Позвоните ${RESTAURANT_PHONE} и назовите номер заказа — кухня начнёт готовить после подтверждения.${whenText}`;
    }
    openModal('success-modal');
  } catch (err) {
    showToast(friendlyFetchError(err, 'Ошибка при отправке заказа'));
  } finally {
    if (submitBtn) {
      delete submitBtn.dataset.busy;
      submitBtn.textContent = prevLabel || submitBtn.dataset.defaultLabel || 'Оплатить и заказать';
      updateCheckoutTotals();
    }
  }
}

function renderOrders() {
  const container = document.getElementById('orders-list');
  if (!container) return;

  const orders = JSON.parse(localStorage.getItem(STORAGE_KEYS.orders) || '[]');
  if (orders.length === 0) {
    container.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:24px">У вас пока нет заказов</p>';
    return;
  }

  const statusOrder = ['new', 'cooking', 'ready', 'delivery', 'done'];

  container.innerHTML = orders.map(order => {
    const items = order.items.map(c => {
      const item = findItem(c.id);
      return item ? `${item.name} ×${c.qty}` : '';
    }).join(', ');

    const st = ORDER_STATUSES[order.status] || ORDER_STATUSES.new;
    const stepIdx = statusOrder.indexOf(order.status);

    return `
      <div class="order-card">
        <div class="order-card__header">
          <span class="order-card__id">${order.orderNumber || order.id}</span>
          <span class="order-status" style="background:${st.color}">${st.label}</span>
        </div>
        <div class="order-card__items">${items}</div>
        <div class="order-card__footer">
          <span>${order.pickupTimeMode === 'at' && order.pickupTimeAt
            ? `К ${formatPickupTimeAtLabel(order.pickupTimeAt)}`
            : new Date(order.createdAt).toLocaleString('ru-RU')}</span>
          <strong>${formatPrice(order.total)}</strong>
        </div>
        <div class="order-progress">
          ${statusOrder.map((s, i) => `
            <div class="order-progress__step ${i <= stepIdx ? (i === stepIdx ? 'active' : 'done') : ''}"></div>
          `).join('')}
        </div>
      </div>`;
  }).join('');
}

function openAccount() {
  if (currentUser) {
    document.getElementById('profile-name').value = currentUser.name || '';
    document.getElementById('profile-phone').value = currentUser.phone || '';
    document.getElementById('profile-email').value = currentUser.email || '';
  }
  renderOrders();
  openModal('account-modal');
}

function saveProfile(e) {
  e.preventDefault();
  const emailInput = document.getElementById('profile-email');
  let email = String(emailInput?.value || '').trim();
  let emailWasCleared = false;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    if (emailInput) emailInput.value = '';
    email = '';
    emailWasCleared = true;
  }
  currentUser = {
    name: document.getElementById('profile-name').value,
    phone: document.getElementById('profile-phone').value,
    email,
  };
  localStorage.setItem(STORAGE_KEYS.user, JSON.stringify(currentUser));
  showToast(
    emailWasCleared
      ? 'Профиль сохранён. Неверный email очищен — укажите вида name@example.com'
      : 'Профиль сохранён'
  );
}


function initHeader() {
  const topBar = document.querySelector('.masthead__top');
  window.addEventListener('scroll', () => {
    topBar?.classList.toggle('scrolled', window.scrollY > 20);
  });

  const burger = document.querySelector('.burger');
  const mobileNav = document.querySelector('.mobile-nav');
  burger?.addEventListener('click', () => {
    burger.classList.toggle('open');
    mobileNav?.classList.toggle('open');
  });

  mobileNav?.querySelectorAll('a').forEach(a => {
    a.addEventListener('click', () => {
      burger.classList.remove('open');
      mobileNav.classList.remove('open');
    });
  });
}

function initModals() {
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => {
      if (e.target === overlay) closeModal(overlay.id);
    });
  });

  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.dataset.close));
  });
}

function initAccountTabs() {
  document.querySelectorAll('.account-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.account-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.account-panel').forEach(p => p.style.display = 'none');
      tab.classList.add('active');
      document.getElementById(tab.dataset.panel).style.display = 'block';
    });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  if (NO_CART_MODE) {
    cart = [];
    localStorage.removeItem(STORAGE_KEYS.cart);
  }
  renderMenu();
  updateCartBadge();
  initHeader();
  initModals();
  initAccountTabs();
  setCheckoutType('pickup');
  setPayment('sbp');
  initPreorderUi();

  if (document.body?.dataset?.page === 'corporate') {
    document.querySelectorAll('.cart-btn').forEach((el) => {
      el.style.display = 'none';
    });
    // Самовывоз скрыт на корпоративной странице
    document.querySelectorAll('.delivery-toggle').forEach((el) => {
      el.style.display = 'none';
    });
  }

  const timeSelect = document.getElementById('order-time');
  if (timeSelect && !document.getElementById('preorder-fields')) {
    for (let h = 11; h <= 22; h++) {
      for (const m of ['00', '30']) {
        const slot = `${String(h).padStart(2, '0')}:${m}`;
        const opt = document.createElement('option');
        opt.value = slot;
        opt.textContent = `Сегодня, ${slot}`;
        timeSelect.appendChild(opt);
      }
    }
  }

  if (NO_CART_MODE) {
    document.querySelectorAll('.cart-btn').forEach((el) => {
      el.style.display = 'none';
    });
  }

  window.backToMenu = function () {
    if (typeof closeModal === 'function') closeModal('success-modal');
    document.getElementById('menu')?.scrollIntoView({ behavior: 'smooth' });
  };

  flushPendingCrmOrders().catch(() => {});
  setInterval(() => {
    flushPendingCrmOrders().catch(() => {});
  }, 60000);
  window.addEventListener('online', () => {
    flushPendingCrmOrders().catch(() => {});
  });
});
