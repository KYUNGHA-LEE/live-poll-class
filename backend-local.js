// 데모(로컬) 백엔드 — Firebase 없이 같은 브라우저의 여러 탭끼리 동기화.
// localStorage(저장) + BroadcastChannel/storage 이벤트(탭 간 알림)로 RTDB API를 흉내냄.
// ⚠️ 같은 컴퓨터·같은 브라우저 탭끼리만 연결됨. 다른 기기·다른 폰은 안 됨 → 실제 수업은 Firebase 필요.

const KEY = "livepoll_demo_db";
const bc = ("BroadcastChannel" in self) ? new BroadcastChannel("livepoll_demo") : null;
const listeners = [];          // {path, cb}
let pushCounter = 0;

function loadTree() {
  try { return JSON.parse(localStorage.getItem(KEY) || "{}"); }
  catch { return {}; }
}
function saveTree(t) { localStorage.setItem(KEY, JSON.stringify(t)); }
function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }

function getAt(tree, path) {
  if (!path) return tree;
  let node = tree;
  for (const p of path.split("/")) {
    if (node == null || typeof node !== "object") return undefined;
    node = node[p];
  }
  return node;
}
function setAt(tree, path, value) {
  const parts = path.split("/");
  let node = tree;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (typeof node[p] !== "object" || node[p] === null) node[p] = {};
    node = node[p];
  }
  const last = parts[parts.length - 1];
  if (value === null || value === undefined) delete node[last];
  else node[last] = value;
}

function snapshot(value) {
  return {
    exists: () => value !== undefined && value !== null,
    val: () => (value === undefined ? null : value),
  };
}

function fireAll() {
  const tree = loadTree();
  for (const l of listeners) l.cb(snapshot(getAt(tree, l.path)));
}
function broadcast() { if (bc) bc.postMessage(1); }
function commit(mutate) {
  const t = loadTree();
  mutate(t);
  saveTree(t);
  fireAll();        // 내 탭 즉시 갱신
  broadcast();      // 다른 탭에 알림
  return Promise.resolve();
}

if (bc) bc.onmessage = () => fireAll();
self.addEventListener("storage", (e) => { if (e.key === KEY) fireAll(); });

// ---- RTDB 호환 API ----
export function ref(path) { return { path }; }

export function set(r, value)      { return commit((t) => setAt(t, r.path, clone(value))); }
export function remove(r)          { return commit((t) => setAt(t, r.path, null)); }
export function update(r, partial) {
  return commit((t) => {
    const cur = clone(getAt(t, r.path)) || {};
    for (const k in partial) cur[k] = partial[k];
    setAt(t, r.path, cur);
  });
}
export function push(r, value) {
  const id = "k" + Date.now().toString(36) + (pushCounter++);
  return commit((t) => setAt(t, r.path + "/" + id, clone(value)))
    .then(() => ({ key: id, path: r.path + "/" + id }));
}
export function get(r) {
  return Promise.resolve(snapshot(getAt(loadTree(), r.path)));
}
export function onValue(r, cb) {
  const l = { path: r.path, cb };
  listeners.push(l);
  cb(snapshot(getAt(loadTree(), r.path)));   // 즉시 1회 호출
  return () => { const i = listeners.indexOf(l); if (i >= 0) listeners.splice(i, 1); };
}
export function onDisconnect(r) {
  return {
    remove: () => {
      const handler = () => commit((t) => setAt(t, r.path, null));
      self.addEventListener("pagehide", handler);
      self.addEventListener("beforeunload", handler);
      return Promise.resolve();
    },
  };
}
export function serverTimestamp() { return Date.now(); }

export function ensureAuth() {
  // 탭마다 별도 참여자로 취급 (sessionStorage = 탭 단위)
  let uid = sessionStorage.getItem("livepoll_uid");
  if (!uid) {
    uid = "u" + Math.random().toString(36).slice(2, 10);
    sessionStorage.setItem("livepoll_uid", uid);
  }
  return Promise.resolve(uid);
}
