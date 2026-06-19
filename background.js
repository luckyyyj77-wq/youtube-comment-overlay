// Service Worker: YouTube API 호출 및 캐싱 담당

const CACHE_TTL_MS = 5 * 60 * 1000; // 5분
const cache = new Map(); // videoId → { data, fetchedAt }

const DEMO_COMMENTS = [
  { id: 'd1', text: '이 영상 진짜 최고다 ㅋㅋㅋㅋ', likeCount: 18400, replyCount: 312, authorName: '유저A' },
  { id: 'd2', text: '몇 번을 봐도 질리지가 않네요', likeCount: 9200, replyCount: 87, authorName: '유저B' },
  { id: 'd3', text: '와 이게 무료라고?', likeCount: 7700, replyCount: 204, authorName: '유저C' },
  { id: 'd4', text: '제 인생 영상입니다 진심으로', likeCount: 6500, replyCount: 56, authorName: '유저D' },
  { id: 'd5', text: '처음 봤을 때 충격받았어요', likeCount: 4300, replyCount: 33, authorName: '유저E' },
  { id: 'd6', text: '알고리즘이 나를 여기 데려왔다', likeCount: 3800, replyCount: 19, authorName: '유저F' },
  { id: 'd7', text: '10년 후에도 이 영상 찾아볼 것 같음', likeCount: 3200, replyCount: 41, authorName: '유저G' },
  { id: 'd8', text: 'ㅋㅋㅋㅋㅋ 진짜 웃기다', likeCount: 2900, replyCount: 8, authorName: '유저H' },
  { id: 'd9', text: '이 부분에서 소름 돋았다', likeCount: 2400, replyCount: 15, authorName: '유저I' },
  { id: 'd10', text: '구독하고 갑니다', likeCount: 1800, replyCount: 6, authorName: '유저J' },
  { id: 'd11', text: '댓글 보러 왔어요', likeCount: 1500, replyCount: 22, authorName: '유저K' },
  { id: 'd12', text: '이 채널 숨겨진 보물이네', likeCount: 1200, replyCount: 11, authorName: '유저L' },
];

// 시작 시 저장된 enabled 상태로 아이콘 초기화
chrome.storage.sync.get({ enabled: true }, r => updateIcon(r.enabled));

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && 'enabled' in changes) {
    updateIcon(changes.enabled.newValue ?? true);
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'FETCH_COMMENTS') {
    handleFetchComments(msg.videoId, msg.apiKey)
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

async function handleFetchComments(videoId, apiKey) {
  if (!apiKey) {
    return { comments: tagComments(DEMO_COMMENTS), demo: true };
  }

  const cached = cache.get(videoId);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return { comments: cached.data, fromCache: true };
  }

  const comments = await fetchTopComments(videoId, apiKey);
  cache.set(videoId, { data: comments, fetchedAt: Date.now() });
  return { comments, fromCache: false };
}

async function fetchTopComments(videoId, apiKey) {
  const url = new URL('https://www.googleapis.com/youtube/v3/commentThreads');
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('videoId', videoId);
  url.searchParams.set('order', 'relevance');
  url.searchParams.set('maxResults', '100');
  url.searchParams.set('key', apiKey);

  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const reason = body?.error?.message ?? `HTTP ${res.status}`;
    throw new Error(reason);
  }

  const data = await res.json();
  const items = data.items ?? [];

  const comments = items.map(item => {
    const s = item.snippet.topLevelComment.snippet;
    return {
      id: item.id,
      text: s.textDisplay,
      likeCount: s.likeCount ?? 0,
      replyCount: item.snippet.totalReplyCount ?? 0,
      authorName: s.authorDisplayName,
    };
  });

  return tagComments(comments);
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
