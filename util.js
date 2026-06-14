// 공통 유틸: 한국어 단어 추출(주관식 워드클라우드용) + 워드클라우드 렌더링

// 의미 없는 단어(불용어). 너무 흔하거나 그 자체로 의미가 약한 것들.
const STOPWORDS = new Set([
  "그리고","그러나","하지만","그래서","그런데","또한","또","및","즉","의","를","을","이","가",
  "은","는","에","에서","에게","으로","로","와","과","도","만","요","네","음","아","어","그","저",
  "이것","그것","저것","여기","거기","저기","이거","그거","저거","것","수","때","점","등","및",
  "있다","없다","하다","되다","이다","같다","대한","대해","위해","통해","관련","경우","정도",
  "거","게","걸","건","좀","약간","매우","정말","진짜","너무","아주","조금","그냥","바로","계속",
  "yes","no","네","아니오","예","아니요","모름","글쎄"
]);

// 토큰 뒤에 붙는 조사·어미. 긴 것부터 잘라야 해서 길이순 정렬해 사용.
const SUFFIXES = [
  "습니다","읍니다","입니다","했습니다","됩니다","합니다","에서는","에게서","으로서","으로써",
  "이라고","라고는","했어요","해서요","거든요","는데요","드려요","네요","해요","돼요","아서",
  "어서","라서","하며","했고","어요","아요","에요","예요",
  "이에요","이라","라는","라고","으로","에서","에게","한테","까지","부터","조차","마저","처럼",
  "보다","밖에","뿐","들이","들을","들은","들의","들과","했다","한다","하는","하고","해서","해도",
  "하면","이고","이며","과의","와의","의","를","을","이","가","은","는","에","와","과","도","만","로"
].sort((a, b) => b.length - a.length);

function isKorean(ch) { return /[가-힣]/.test(ch); }

// 한 토큰에서 의미있는 어근만 남기기 (가벼운 규칙 기반 — 형태소 분석기 아님)
function normalizeToken(raw) {
  let t = raw.trim().toLowerCase();
  // 한글/영문/숫자만 남기기
  t = t.replace(/[^가-힣a-z0-9]/g, "");
  if (!t) return "";
  // 한글 토큰이면 조사·어미 떼기 (떼고도 2글자 이상 남을 때만)
  if (isKorean(t[t.length - 1])) {
    for (const suf of SUFFIXES) {
      if (t.length > suf.length + 1 && t.endsWith(suf)) {
        t = t.slice(0, -suf.length);
        break;
      }
    }
  }
  return t;
}

// 답변 문자열 배열 → [{text, count}] (빈도 내림차순)
export function extractWords(answers) {
  const freq = new Map();
  for (const ans of answers) {
    if (!ans) continue;
    const tokens = String(ans).split(/[\s,.!?·…/\\()\[\]{}'"“”‘’~\-:;]+/);
    for (const tok of tokens) {
      const w = normalizeToken(tok);
      if (!w) continue;
      if (w.length < 2) continue;          // 한 글자 토큰 제거
      if (STOPWORDS.has(w)) continue;       // 불용어 제거
      freq.set(w, (freq.get(w) || 0) + 1);
    }
  }
  return [...freq.entries()]
    .map(([text, count]) => ({ text, count }))
    .sort((a, b) => b.count - a.count);
}

const DEEP_INK = "#130e30";
const HI_YELLOW = "#ffe228";

// 단어 텍스트로 안정적인 시작 각도를 만들어, 같은 단어가 갱신돼도 비슷한 위치에 오게 한다.
function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

// 워드클라우드 컬러 팔레트 (크림 표면에서 잘 읽히는 보석톤)
const CLOUD_PALETTE = ["#7048e8", "#e261e5", "#2b8a3e", "#1098ad", "#e8590c", "#130e30"];

// items: [{text, count}] → 워드클라우드.
// wordcloud2.js 가 로드돼 있으면 빽빽·컬러·회전 클라우드, 없으면(오프라인 등) 나선 패킹으로 폴백.
export function renderCloud(container, items, opts = {}) {
  container.innerHTML = "";
  if (!items.length) {
    container.innerHTML = `<p class="empty">아직 응답이 없어요…</p>`;
    return;
  }
  const W = container.clientWidth || 640;
  const H = opts.height || Math.max(300, Math.min(460, 240 + items.length * 16));
  container.style.position = "relative";
  container.style.height = H + "px";

  if (typeof window !== "undefined" && window.WordCloud && W > 40) {
    renderWordCloud2(container, items, W, H, opts);
  } else {
    renderSpiral(container, items, W, H, opts);
  }
}

// 빽빽·컬러·회전 (wordcloud2.js, canvas)
function renderWordCloud2(container, items, W, H, opts) {
  const counts = items.map(i => i.count);
  const max = Math.max(...counts), min = Math.min(...counts);
  const minPx = opts.minPx || 16, maxPx = opts.maxPx || 96;

  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  canvas.style.width = W + "px"; canvas.style.height = H + "px";
  container.appendChild(canvas);

  window.WordCloud(canvas, {
    list: items.map(i => [i.text, i.count]),
    gridSize: Math.max(4, Math.round(7 * W / 640)),
    weightFactor: (n) => (max === min ? (minPx + maxPx) / 2 : minPx + (n - min) / (max - min) * (maxPx - minPx)),
    fontFamily: "'Pretendard Variable', Pretendard, sans-serif",
    fontWeight: "700",
    color: (word, weight) => (weight === max ? DEEP_INK : CLOUD_PALETTE[hashStr(word) % CLOUD_PALETTE.length]),
    rotateRatio: 0.35,
    rotationSteps: 2,
    minRotation: -Math.PI / 2,
    maxRotation: Math.PI / 2,
    backgroundColor: "transparent",
    drawOutOfBound: false,
    shrinkToFit: true,
    clearCanvas: true,
  });
}

// 폴백: 중앙 나선 패킹 (DOM 텍스트, 최다 단어 옐로 강조)
function renderSpiral(container, items, W, H, opts) {
  items = items.slice().sort((a, b) => b.count - a.count || (a.text < b.text ? -1 : 1));
  const max = Math.max(...items.map(i => i.count));
  const min = Math.min(...items.map(i => i.count));
  const minPx = opts.minPx || 18, maxPx = opts.maxPx || 92;
  const cx = W / 2, cy = H / 2;
  const placed = [];
  const PAD = 7;
  const hit = (a, b) =>
    !(a.x + a.w + PAD < b.x || b.x + b.w + PAD < a.x || a.y + a.h + PAD < b.y || b.y + b.h + PAD < a.y);

  items.forEach((it) => {
    const ratio = max === min ? 1 : (it.count - min) / (max - min);
    const size = Math.round(minPx + ratio * (maxPx - minPx));
    const isTop = it.count === max;
    const span = document.createElement("span");
    span.className = "cloud-word";
    span.textContent = it.text;
    span.title = `${it.text} · ${it.count}`;
    span.style.position = "absolute";
    span.style.whiteSpace = "nowrap";
    span.style.fontSize = size + "px";
    span.style.fontWeight = String(500 + Math.round(ratio * 3) * 100);
    span.style.color = DEEP_INK;
    span.style.opacity = String(0.5 + ratio * 0.5);
    if (isTop) {
      span.style.background = HI_YELLOW;
      span.style.opacity = "1";
      span.style.padding = "0 .14em";
      span.style.borderRadius = ".14em";
    }
    container.appendChild(span);
    const w = span.offsetWidth, h = span.offsetHeight;
    let angle = (hashStr(it.text) % 360) * Math.PI / 180;
    let r = 0, x = cx - w / 2, y = cy - h / 2;
    for (let step = 0; step < 1600; step++) {
      x = cx + r * Math.cos(angle) - w / 2;
      y = cy + r * Math.sin(angle) * 0.6 - h / 2;
      const box = { x, y, w, h };
      if (x >= 0 && y >= 0 && x + w <= W && y + h <= H && !placed.some(p => hit(box, p))) break;
      angle += 0.35;
      r += 1.6;
    }
    x = Math.max(0, Math.min(x, W - w));
    y = Math.max(0, Math.min(y, H - h));
    span.style.left = x + "px";
    span.style.top = y + "px";
    placed.push({ x, y, w, h });
  });
}
