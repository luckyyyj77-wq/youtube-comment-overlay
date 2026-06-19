// ── i18n 텍스트 ─────────────────────────────────────────────────────────────

const I18N = {
  ko: {
    displayMode:  '표시 방식',
    modeFade:     '페이드인/아웃',
    modeScroll:   '스크롤',
    bgOpacity:    '배경 투명도',
    transparent:  '투명',
    opaque:       '불투명',
    position:     '자막 위치',
  },
  en: {
    displayMode:  'Display Mode',
    modeFade:     'Fade In/Out',
    modeScroll:   'Scroll',
    bgOpacity:    'Background Opacity',
    transparent:  'Clear',
    opaque:       'Solid',
    position:     'Position',
  },
};

// ── DOM 참조 ─────────────────────────────────────────────────────────────────

const chkEnabled   = document.getElementById('chk-enabled');
const modeRadios   = document.querySelectorAll('input[name="mode"]');
const posBtns      = document.querySelectorAll('.pos-btn');
const rangeOpacity = document.getElementById('range-opacity');
const opacityValue = document.getElementById('opacity-value');
const btnLang      = document.getElementById('btn-lang');

const DEFAULTS = { enabled: true, mode: 'scroll', position: 'bottom', bgOpacity: 50, lang: 'en' };

let currentLang = 'en';

// ── 초기화 ───────────────────────────────────────────────────────────────────

chrome.storage.sync.get(DEFAULTS, result => {
  chkEnabled.checked = result.enabled;
  setMode(result.mode);
  setPosition(result.position);
  setOpacity(result.bgOpacity);
  applyLang(result.lang);
});

// ── 이벤트 ───────────────────────────────────────────────────────────────────

chkEnabled.addEventListener('change', () => {
  chrome.storage.sync.set({ enabled: chkEnabled.checked });
});

modeRadios.forEach(radio => {
  radio.addEventListener('change', () => chrome.storage.sync.set({ mode: radio.value }));
});

posBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    setPosition(btn.dataset.pos);
    chrome.storage.sync.set({ position: btn.dataset.pos });
  });
});

rangeOpacity.addEventListener('input', () => {
  const val = Number(rangeOpacity.value);
  setOpacity(val);
  chrome.storage.sync.set({ bgOpacity: val });
});

btnLang.addEventListener('click', () => {
  const next = currentLang === 'ko' ? 'en' : 'ko';
  chrome.storage.sync.set({ lang: next });
  applyLang(next);
});

// ── 헬퍼 ─────────────────────────────────────────────────────────────────────

function applyLang(lang) {
  currentLang = lang;
  const t = I18N[lang];

  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n;
    if (t[key] !== undefined) el.textContent = t[key];
  });

  btnLang.textContent = lang === 'en' ? '한' : 'EN';
  document.documentElement.lang = lang;
}

function setMode(mode) {
  modeRadios.forEach(r => { r.checked = (r.value === mode); });
}

function setPosition(pos) {
  posBtns.forEach(b => b.classList.toggle('active', b.dataset.pos === pos));
}

function setOpacity(val) {
  rangeOpacity.value       = val;
  opacityValue.textContent = `${val}%`;
}

