// 백엔드 어댑터 — 키가 없으면 데모(로컬), 있으면 진짜 Firebase를 자동 선택.
// host.js / play.js 는 항상 이 파일에서만 import 하므로 코드를 바꿀 필요가 없다.
import { firebaseConfig } from "./firebase-config.js";

// ---- 설정 점검용 (동기, boot 초반에 호출됨) ----
export function configLooksUnset() {
  return !firebaseConfig.databaseURL || firebaseConfig.databaseURL.includes("여기에");
}
export function makeRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

// ?demo=1 강제, 또는 키 미설정 시 자동으로 데모 모드
export const DEMO =
  configLooksUnset() || new URLSearchParams(location.search).has("demo");

// 선택한 백엔드를 비동기 로드. ensureAuth()가 ready를 기다리므로,
// 그 이후 호출되는 동기 함수(ref/onValue 등)에서는 impl이 항상 준비돼 있다.
let impl = null;
const ready = (async () => {
  impl = DEMO
    ? await import("./backend-local.js")
    : await import("./backend-firebase.js");
  return impl;
})();

// 진짜 Firebase의 db 자리표시자 (로컬 backend는 ref에서 무시)
export const db = { __adapter: true };

export function ref(_db, path)      { return impl.ref(path); }
export function set(r, value)       { return impl.set(r, value); }
export function get(r)              { return impl.get(r); }
export function update(r, partial)  { return impl.update(r, partial); }
export function push(r, value)      { return impl.push(r, value); }
export function remove(r)           { return impl.remove(r); }
export function onValue(r, cb)      { return impl.onValue(r, cb); }
export function onDisconnect(r)     { return impl.onDisconnect(r); }
export function serverTimestamp()   { return impl.serverTimestamp(); }
export async function ensureAuth()  { await ready; return impl.ensureAuth(); }

// 데모 모드면 상단에 안내 배너 표시
if (DEMO) {
  const addBanner = () => {
    if (document.getElementById("demo-banner")) return;
    const tag = document.createElement("div");
    tag.id = "demo-banner";
    tag.textContent = "🧪 데모 모드 · 같은 브라우저 탭끼리만 동기화 (실시간·다기기는 Firebase 키 입력 후)";
    tag.style.cssText =
      "position:fixed;top:0;left:0;right:0;z-index:9999;background:#130e30;color:#ffe228;" +
      "font:600 13px/1.5 Pretendard,sans-serif;text-align:center;padding:8px 12px;";
    document.body.appendChild(tag);
    document.body.style.paddingTop = "38px";
  };
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", addBanner);
  else addBanner();
}
