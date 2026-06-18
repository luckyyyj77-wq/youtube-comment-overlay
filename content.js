// Content Script: YouTube 페이지에서 오버레이 주입 및 댓글 표시

const FADE_DURATION   = 5000;  // 페이드 모드 노출 시간 (ms)
const FADE_INTERVAL   = 6500;  // 페이드 모드 댓글 간격 (ms)
const SCROLL_DURATION = 18000; // 스크롤 모드 이동 시간 (ms) — 기존 9s의 2배
const SCROLL_INTERVAL = 4000;  // 스크롤 모드 댓글 간격 (ms)
const SCROLL_LANES    = 5;     // 스크롤 모드 레인 수
const LANE_STEP       = 16;    // 레인 간격 (% 단위)

let overlay        = null;
let currentVideoId = null;
let enabled        = true;
let apiKey         = '';
let mode           = 'fade';   // 'fade' | 'scroll'
let position       = 'bottom'; // 8점 위치
let bgOpacity      = 55;       // 배경 투명도 0~100
let laneOccupiedUntil = new Array(SCROLL_LANES).fill(0);

// ── 초기화 ──────────────────────────────────────────────────────────────────

chrome.storage.sync.get(
  { apiKey: '', enabled: true, mode: 'fade', position: 'bottom', bgOpacity: 55 },
  result => {
    apiKey    = result.apiKey;
    enabled   = result.enabled;
    mode      = result.mode;
    position  = result.position;
    bgOpacity = result.bgOpacity;
    init();
  }
);

chrome.storage.onChanged.addListener(changes => {
  if ('apiKey'    in changes) apiKey    = changes.apiKey.newValue    ?? '';
  if ('mode'      in changes) mode      = changes.mode.newValue      ?? 'fade';
  if ('position'  in changes) position  = changes.position.newValue  ?? 'bottom';
  if ('bgOpacity' in changes) bgOpacity = changes.bgOpacity.newValue ?? 55;
  if ('enabled'   in changes) {
    enabled = changes.enabled.newValue ?? true;
    if (!enabled) removeOverlay();
  }
});

// ── YouTube SPA 페이지 이동 감지 ─────────────────────────────────────────────

function init() {
  observeUrlChange();
  tryAttach();
}

function observeUrlChange() {
  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      onNavigate();
    }
  }).observe(document.body, { childList: true, subtree: true });
}

function onNavigate() {
  removeOverlay();
  currentVideoId = null;
  tryAttach();
}

// ── 영상 플레이어에 오버레이 붙이기 ──────────────────────────────────────────

function tryAttach() {
  if (!enabled || !isWatchPage()) return;

  const videoId = extractVideoId(location.href);
  if (!videoId || videoId === currentVideoId) return;

  waitForPlayer().then(container => {
    if (!container) return;
    currentVideoId = videoId;
    attachOverlay(container);
    loadAndSchedule(videoId);
  });
}

function waitForPlayer(timeout = 8000) {
  return new Promise(resolve => {
    const start = Date.now();
    const check = () => {
      const el = document.querySelector('#movie_player');
      if (el) return resolve(el);
      if (Date.now() - start > timeout) return resolve(null);
      setTimeout(check, 300);
    };
    check();
  });
}

function attachOverlay(container) {
  removeOverlay();
  if (getComputedStyle(container).position === 'static') {
    container.style.position = 'relative';
  }
  overlay = document.createElement('div');
  overlay.id = 'yco-overlay';
  container.appendChild(overlay);
}

function removeOverlay() {
  overlay?.remove();
  overlay = null;
}

// ── 댓글 로드 및 스케줄링 ────────────────────────────────────────────────────

async function loadAndSchedule(videoId) {
  const result = await chrome.runtime.sendMessage({
    type: 'FETCH_COMMENTS',
    videoId,
    apiKey,
  });

  if (result.error || !result.comments?.length) return;
  if (videoId !== currentVideoId) return;

  if (result.demo) showDemoBadge();
  scheduleChips(result.comments);
}

function showDemoBadge() {
  if (!overlay || overlay.querySelector('.yco-demo-badge')) return;
  const badge = document.createElement('div');
  badge.className = 'yco-demo-badge';
  badge.textContent = '데모 모드';
  overlay.appendChild(badge);
}

function scheduleChips(comments) {
  if (mode === 'scroll') {
    scheduleScroll(comments);
  } else {
    scheduleFade(comments);
  }
}

// 페이드 모드: 한 번에 하나씩, 순차 표시
function scheduleFade(comments) {
  const display = (idx) => {
    if (!overlay || !enabled) return;
    showFadeChip(comments[idx % comments.length]);
    setTimeout(() => display(idx + 1), FADE_INTERVAL);
  };
  setTimeout(() => display(0), 1500);
}

// 스크롤 모드: 레인별로 간격을 두고 흘려보냄
function scheduleScroll(comments) {
  laneOccupiedUntil = new Array(SCROLL_LANES).fill(0);
  const display = (idx) => {
    if (!overlay || !enabled) return;
    showScrollChip(comments[idx % comments.length]);
    setTimeout(() => display(idx + 1), SCROLL_INTERVAL);
  };
  setTimeout(() => display(0), 1500);
}

// ── 칩 생성 ─────────────────────────────────────────────────────────────────

function showFadeChip(comment) {
  if (!overlay) return;

  // 이전 칩 즉시 제거 (겹침 방지)
  overlay.querySelectorAll('.yco-chip').forEach(el => el.remove());

  const chip = makeChip(comment);
  chip.classList.add('mode-fade', `pos-${position}`);
  chip.style.setProperty('--dur', `${FADE_DURATION / 1000}s`);

  overlay.appendChild(chip);
  chip.addEventListener('animationend', () => chip.remove(), { once: true });
}

function showScrollChip(comment) {
  if (!overlay) return;

  const lane   = pickLane();
  const topPct = 8 + lane * LANE_STEP;

  const chip = makeChip(comment);
  chip.classList.add('mode-scroll');
  chip.style.setProperty('--dur', `${SCROLL_DURATION / 1000}s`);
  chip.style.top  = `${topPct}%`;
  chip.style.left = '100%';

  overlay.appendChild(chip);
  laneOccupiedUntil[lane] = Date.now() + SCROLL_DURATION * 0.15;
  chip.addEventListener('animationend', () => chip.remove(), { once: true });
}

function makeChip(comment) {
  const chip = document.createElement('div');
  chip.className = 'yco-chip';
  chip.dataset.tag = comment.tag;
  chip.title = `${comment.authorName}: ${stripHtml(comment.text)}`;
  chip.textContent = buildLabel(comment);
  chip.style.setProperty('--bg-opacity', (bgOpacity / 100).toFixed(2));
  return chip;
}

function buildLabel(comment) {
  const text = stripHtml(comment.text).slice(0, 100);
  if (comment.tag === 'likes')   return `👍 ${comment.likeCount.toLocaleString()}  ${text}`;
  if (comment.tag === 'replies') return `💬 ${comment.replyCount}  ${text}`;
  return text;
}

function pickLane() {
  const now  = Date.now();
  const free = laneOccupiedUntil
    .map((t, i) => ({ i, t }))
    .filter(x => x.t <= now);

  if (free.length > 0) return free[Math.floor(Math.random() * free.length)].i;
  return laneOccupiedUntil.indexOf(Math.min(...laneOccupiedUntil));
}

// ── 유틸 ────────────────────────────────────────────────────────────────────

function isWatchPage() {
  return location.pathname === '/watch';
}

function extractVideoId(href) {
  try { return new URL(href).searchParams.get('v'); }
  catch { return null; }
}

function stripHtml(html) {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');
}
