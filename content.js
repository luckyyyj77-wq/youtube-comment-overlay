// Content Script: YouTube 페이지에서 오버레이 주입 및 댓글 표시

const FADE_DURATION   = 5000;  // 페이드 모드 노출 시간 (ms)
const FADE_INTERVAL   = 8000;  // 페이드 모드 댓글 간격 (ms) — DURATION + 3초 여백
const SCROLL_SPEED_PX = 96;    // 스크롤 속도 (px/s) — 고정 속도로 겹침 방지
const SCROLL_INTERVAL = 4000;  // 스크롤 모드 댓글 간격 (ms)
const SCROLL_LANES    = 10;    // 스크롤 모드 레인 수
const LANE_STEP       = 8;     // 레인 간격 (% 단위)

let overlay        = null;
let currentVideoId = null;
let enabled        = true;
let apiKey         = '';
let mode           = 'fade';   // 'fade' | 'scroll'
let position       = 'bottom'; // 8점 위치
let bgOpacity      = 55;       // 배경 투명도 0~100
let laneOccupiedUntil = new Array(SCROLL_LANES).fill(0);
let scheduleId     = 0;
let lastComments   = null;

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
  if ('mode'      in changes) {
    mode = changes.mode.newValue ?? 'fade';
    if (lastComments && overlay) {
      overlay.querySelectorAll('.yco-chip').forEach(c => c.remove());
      laneOccupiedUntil = new Array(SCROLL_LANES).fill(0);
      scheduleChips(lastComments);
    }
  }
  if ('position'  in changes) position  = changes.position.newValue  ?? 'bottom';
  if ('bgOpacity' in changes) bgOpacity = changes.bgOpacity.newValue ?? 55;
  if ('enabled'   in changes) {
    enabled = changes.enabled.newValue ?? true;
    if (!enabled) {
      removeOverlay();
      currentVideoId = null;
    } else {
      tryAttach();
    }
  }
});

// ── YouTube SPA 페이지 이동 감지 ─────────────────────────────────────────────

function init() {
  observeUrlChange();
  tryAttach();
}

function observeUrlChange() {
  let lastUrl = location.href;
  // attributes만 감시해서 DOM 변경 폭탄 차단 — YouTube는 SPA 이동 시 <body>의 attributes가 바뀜
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
  scheduleId++;
  overlay?.remove();
  overlay = null;
  lastComments = null;
}

// ── 댓글 로드 및 스케줄링 ────────────────────────────────────────────────────

async function loadAndSchedule(videoId) {
  let result;
  try {
    result = await chrome.runtime.sendMessage({
      type: 'FETCH_COMMENTS',
      videoId,
      apiKey,
    });
  } catch {
    return;
  }

  if (videoId !== currentVideoId) return;

  if (result.error || !result.comments?.length) {
    showNoCommentsBadge();
    return;
  }

  lastComments = result.comments;
  if (result.demo) showDemoBadge();
  scheduleChips(result.comments);
}

function showNoCommentsBadge() {
  if (!overlay) return;
  const badge = document.createElement('div');
  badge.className = 'yco-demo-badge yco-no-comments';
  badge.textContent = '댓글을 사용할 수 없는 영상입니다';
  overlay.appendChild(badge);
  setTimeout(() => badge.remove(), 4000);
}

function showDemoBadge() {
  if (!overlay || overlay.querySelector('.yco-demo-badge')) return;
  const badge = document.createElement('div');
  badge.className = 'yco-demo-badge';
  badge.textContent = '데모 모드';
  overlay.appendChild(badge);
}

function scheduleChips(comments) {
  scheduleId++;
  const myId = scheduleId;
  if (mode === 'scroll') {
    scheduleScroll(comments, myId);
  } else {
    scheduleFade(comments, myId);
  }
}

// top10/top25/popular/replies 는 하이라이트 풀, random은 일반 풀
function buildDeck(comments) {
  const popularPool = shuffled(comments.filter(c => c.tag !== 'random'));
  const randomPool  = shuffled(comments.filter(c => c.tag === 'random'));

  const deck = [];
  const half = Math.max(popularPool.length, randomPool.length);
  for (let i = 0; i < half; i++) {
    if (i < popularPool.length) deck.push(popularPool[i]);
    if (i < randomPool.length)  deck.push(randomPool[i]);
  }
  return deck;
}

// 페이드 모드: 한 번에 하나씩, 덱 소진 시 재빌드
function scheduleFade(comments, myId) {
  let deck = buildDeck(comments);
  let pos  = 0;
  const display = () => {
    if (!overlay || !enabled || scheduleId !== myId) return;
    if (pos >= deck.length) { deck = buildDeck(comments); pos = 0; }
    showFadeChip(deck[pos++]);
    setTimeout(display, FADE_INTERVAL);
  };
  setTimeout(display, 1500);
}

// 스크롤 모드: 레인별로 간격을 두고 흘려보냄, 덱 소진 시 재빌드
function scheduleScroll(comments, myId) {
  let deck = buildDeck(comments);
  let pos  = 0;
  const display = () => {
    if (!overlay || !enabled || scheduleId !== myId) return;
    if (pos >= deck.length) { deck = buildDeck(comments); pos = 0; }
    showScrollChip(deck[pos++]);
    setTimeout(display, SCROLL_INTERVAL);
  };
  setTimeout(display, 1500);
}

// ── 칩 생성 ─────────────────────────────────────────────────────────────────

function showFadeChip(comment) {
  if (!overlay) return;

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
  chip.style.top  = `${topPct}%`;
  chip.style.left = '100%';

  // 너비 실측을 위해 잠깐 비가시 상태로 DOM에 삽입
  chip.style.visibility = 'hidden';
  overlay.appendChild(chip);

  const chipW   = chip.offsetWidth;
  const screenW = overlay.offsetWidth || window.innerWidth;
  // 총 이동 거리 = 화면 너비 + 칩 너비, 고정 속도로 소요 시간 계산
  const totalPx  = screenW + chipW;
  const durMs    = (totalPx / SCROLL_SPEED_PX) * 1000;
  // 앞 칩의 오른쪽 끝이 화면 안으로 완전히 들어올 때까지 레인 점유
  // = 칩 너비만큼 이동하는 데 걸리는 시간 + 안전 여백 500ms
  const occupyMs = (chipW / SCROLL_SPEED_PX) * 1000 + 500;

  chip.style.setProperty('--dur', `${durMs / 1000}s`);
  chip.style.visibility = '';

  laneOccupiedUntil[lane] = Date.now() + occupyMs;
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
  if (comment.tag === 'top10')   return `🔥 ${comment.likeCount.toLocaleString()}  ${text}`;
  if (comment.tag === 'top25')   return `👍 ${comment.likeCount.toLocaleString()}  ${text}`;
  if (comment.tag === 'popular') return `💙 ${comment.likeCount.toLocaleString()}  ${text}`;
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

function shuffled(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function stripHtml(html) {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');
}
