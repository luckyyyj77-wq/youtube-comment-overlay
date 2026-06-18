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

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'FETCH_COMMENTS') {
    handleFetchComments(msg.videoId, msg.apiKey)
      .then(sendResponse)
      .catch(err => sendResponse({ error: err.message }));
    return true; // 비동기 응답을 위해 true 반환
  }
});

async function handleFetchComments(videoId, apiKey) {
  if (!apiKey) {
    return { comments: selectComments(DEMO_COMMENTS), demo: true };
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
  // 1차: relevance 순으로 최대 100개 가져오기
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

  return selectComments(comments);
}

function selectComments(comments) {
  if (comments.length === 0) return [];

  const byLikes = [...comments].sort((a, b) => b.likeCount - a.likeCount);
  const topLike = byLikes[0];

  const byReplies = [...comments].sort((a, b) => b.replyCount - a.replyCount);
  const topReply = byReplies.find(c => c.id !== topLike.id) ?? byReplies[0];

  const usedIds = new Set([topLike.id, topReply.id]);
  const pool = comments.filter(c => !usedIds.has(c.id));
  const randoms = shuffled(pool).slice(0, 8);

  return [
    { ...topLike, tag: 'likes' },
    { ...topReply, tag: 'replies' },
    ...randoms.map(c => ({ ...c, tag: 'random' })),
  ];
}

function shuffled(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
