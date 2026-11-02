// Service Worker: 백엔드 서버를 통해 댓글 조회 (서버 캐시 공유)

const SERVER_URL = 'https://youtube-comment-overlay-server-production.up.railway.app';

// 시작 시 저장된 enabled 상태로 아이콘 초기화
chrome.storage.sync.get({ enabled: true }, r => updateIcon(r.enabled));

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && 'enabled' in changes) {
    updateIcon(changes.enabled.newValue ?? true);
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'FETCH_COMMENTS') {
    handleFetchComments(msg.videoId)
      .then(sendResponse)
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }
});

function updateIcon(enabled) {
  // 뱃지로 상태 표시 — OffscreenCanvas ImageData는 SW에서 setIcon 전달이 불안정
  if (enabled) {
    chrome.action.setBadgeText({ text: '' });
  } else {
    chrome.action.setBadgeText({ text: 'OFF' });
    chrome.action.setBadgeBackgroundColor({ color: '#CC0000' });
    chrome.action.setBadgeTextColor({ color: '#FFFFFF' });
  }
}

const CLIENT_CACHE_TTL = 2 * 60 * 60 * 1000; // 2시간 (ms)

async function getClientCache(videoId) {
  const key = `cc:${videoId}`;
  const result = await chrome.storage.local.get(key);
  const entry = result[key];
  if (!entry) return null;
  if (Date.now() - entry.ts > CLIENT_CACHE_TTL) {
    chrome.storage.local.remove(key);
    return null;
  }
  return entry.comments;
}

// 다시 보지 않는 영상의 항목이 쌓이지 않도록 저장할 때마다 만료 항목을 지움
async function pruneClientCache() {
  const all = await chrome.storage.local.get(null);
  const now = Date.now();
  const expired = Object.keys(all).filter(
    key => key.startsWith('cc:') && now - all[key].ts > CLIENT_CACHE_TTL
  );
  if (expired.length > 0) await chrome.storage.local.remove(expired);
}

async function setClientCache(videoId, comments) {
  const key = `cc:${videoId}`;
  try {
    await pruneClientCache();
    await chrome.storage.local.set({ [key]: { comments, ts: Date.now() } });
  } catch {
    // 캐시 실패(용량 초과 등)로 이미 받은 댓글까지 버리지 않음
  }
}

async function handleFetchComments(videoId) {
  const cached = await getClientCache(videoId);
  if (cached) return { comments: cached, fromCache: true };

  try {
    const res = await fetch(`${SERVER_URL}/api/comments?videoId=${videoId}`, {
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json();

    if (!res.ok) return { unavailable: true };

    const comments = tagComments(data.comments);
    await setClientCache(videoId, comments);
    return { comments, fromCache: data.fromCache };
  } catch {
    return { unavailable: true };
  }
}

function tagComments(comments) {
  if (comments.length === 0) return [];

  const n = comments.length;
  const byLikes = [...comments].sort((a, b) => b.likeCount - a.likeCount);

  // 좋아요 순위 기반 3단계 구간 계산
  const top10Count  = Math.max(1, Math.ceil(n * 0.10));
  const top25Count  = Math.max(1, Math.ceil(n * 0.25));
  const top50Count  = Math.max(1, Math.ceil(n * 0.50));

  const top10Ids  = new Set(byLikes.slice(0,          top10Count).map(c => c.id));
  const top25Ids  = new Set(byLikes.slice(top10Count, top25Count).map(c => c.id));
  const top50Ids  = new Set(byLikes.slice(top25Count, top50Count).map(c => c.id));

  // 대댓글 1위 → 'replies' 태그 (좋아요 태그보다 우선)
  const topReplyId = comments.reduce((best, c) => c.replyCount > best.replyCount ? c : best).id;

  return comments.map(c => {
    if (c.id === topReplyId)  return { ...c, tag: 'replies' };
    if (top10Ids.has(c.id))   return { ...c, tag: 'top10' };
    if (top25Ids.has(c.id))   return { ...c, tag: 'top25' };
    if (top50Ids.has(c.id))   return { ...c, tag: 'popular' };
    return { ...c, tag: 'random' };
  });
}

function shuffled(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
