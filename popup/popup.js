// ── i18n 텍스트 ─────────────────────────────────────────────────────────────

const I18N = {
  ko: {
    apiKeyLabel:  'YouTube Data API 키',
    save:         '저장',
    displayMode:  '표시 방식',
    modeFade:     '페이드인/아웃',
    modeScroll:   '스크롤',
    bgOpacity:    '배경 투명도',
    transparent:  '투명',
    opaque:       '불투명',
    position:     '자막 위치',
    hintDemo:     'API 키 없이도 <strong>데모 모드</strong>로 동작합니다.',
    hintApiKey:   '실제 댓글을 표시하려면 Google Cloud Console → YouTube Data API v3 → 사용자 인증 정보에서 키를 발급하세요.',
    saved:        '저장되었습니다.',
    demoMode:     '데모 모드로 전환되었습니다.',
    invalidKey:   '올바르지 않은 API 키 형식입니다.',
  },
  en: {
    apiKeyLabel:  'YouTube Data API Key',
    save:         'Save',
    displayMode:  'Display Mode',
    modeFade:     'Fade In/Out',
    modeScroll:   'Scroll',
    bgOpacity:    'Background Opacity',
    transparent:  'Clear',
    opaque:       'Solid',
    position:     'Position',
    hintDemo:     'Works in <strong>demo mode</strong> without an API key.',
    hintApiKey:   'To show real comments, create an API key in Google Cloud Console → YouTube Data API v3 → Credentials.',
    saved:        'Saved.',
    demoMode:     'Switched to demo mode.',
    invalidKey:   'Invalid API key format.',
  },
};

// ── DOM 참조 ─────────────────────────────────────────────────────────────────

const chkEnabled   = document.getElementById('chk-enabled');
const inputApiKey  = document.getElementById('input-apikey');
const btnSave      = document.getElementById('btn-save');
const msgStatus    = document.getElementById('msg-status');
const modeRadios   = document.querySelectorAll('input[name="mode"]');
const posBtns      = document.querySelectorAll('.pos-btn');
const rangeOpacity = document.getElementById('range-opacity');
const opacityValue = document.getElementById('opacity-value');
const btnLang      = document.getElementById('btn-lang');

const DEFAULTS = { apiKey: '', enabled: true, mode: 'fade', position: 'bottom', bgOpacity: 55, lang: 'ko' };

let currentLang = 'ko';

// ── 초기화 ───────────────────────────────────────────────────────────────────

chrome.storage.sync.get(DEFAULTS, result => {
  inputApiKey.value  = result.apiKey;
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

btnSave.addEventListener('click', () => {
  const key = inputApiKey.value.trim();
  const t   = I18N[currentLang];

  if (!key) {
    chrome.storage.sync.set({ apiKey: '' }, () => showMsg(t.demoMode));
    return;
  }
  if (!key.startsWith('AIza') || key.length < 30) {
    showMsg(t.invalidKey, true);
    return;
  }
  chrome.storage.sync.set({ apiKey: key }, () => showMsg(t.saved));
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
    if (t[key] !== undefined) el.innerHTML = t[key];
  });

  btnLang.textContent = lang === 'ko' ? 'EN' : '한';
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

function showMsg(text, isError = false) {
  msgStatus.textContent = text;
  msgStatus.className   = 'msg' + (isError ? ' error' : '');
  setTimeout(() => { msgStatus.textContent = ''; }, 3000);
}
