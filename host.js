import {
  db, ref, set, get, update, push, remove, onValue, serverTimestamp,
  ensureAuth, configLooksUnset, makeRoomCode, DEMO
} from "./firebase.js";
import { extractWords, renderCloud } from "./util.js";

const $ = (id) => document.getElementById(id);
const showErr = (msg) => { const e = $("err"); e.textContent = msg; e.classList.remove("hidden"); };
let toastTimer = null;
function toast(msg) {
  let t = $("toast");
  if (!t) { t = document.createElement("div"); t.id = "toast"; t.className = "toast"; document.body.appendChild(t); }
  t.textContent = msg;
  t.style.display = "block";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.style.display = "none"; }, 1800);
}

// ---------- 상태 ----------
let uid = null;
let code = null;
let slides = [];            // [{id, type, q, options, order}]
let currentOrder = -1;      // -1 = 대기(로비)
let participants = 0;
let participantIds = [];     // 현재 접속 중인 참여자 uid 목록
let participantsData = {};   // {uid: {name, anon, ts}}
let responses = {};         // {uid: value} (현재 슬라이드)
let unsubResponses = null;

// ---------- 부팅 ----------
(async function boot() {
  if (configLooksUnset() && !DEMO) {
    showErr("⚠️ firebase-config.js 를 먼저 설정하세요 (databaseURL 등). README.md 참고.");
  }
  try {
    uid = await ensureAuth();
  } catch (e) {
    showErr("로그인 실패: Firebase 콘솔에서 '익명' 로그인을 켰는지 확인하세요. (" + e.message + ")");
    return;
  }
  const saved = localStorage.getItem("livepoll_host_room");
  if (saved) {
    const snap = await get(ref(db, `rooms/${saved}/meta`));
    if (snap.exists()) { enterRoom(saved); return; }
  }
  $("setup").classList.remove("hidden");
})();

$("createBtn").onclick = async () => {
  code = makeRoomCode();
  await set(ref(db, `rooms/${code}`), {
    meta: { hostId: uid, createdAt: serverTimestamp() },
    state: { currentOrder: -1 }
  });
  localStorage.setItem("livepoll_host_room", code);
  enterRoom(code);
};

// ---------- 방 입장 + 리스너 ----------
function enterRoom(roomCode) {
  code = roomCode;
  $("setup").classList.add("hidden");
  $("dash").classList.remove("hidden");

  // 현재 폴더 경로만 남기고 파일명(host / host.html 등)을 떼어 안전하게 조합.
  // .html 을 붙이면 serve가 /play 로 리다이렉트하며 ?room= 쿼리를 버리므로, 깔끔한 주소로 만든다.
  const dir = location.pathname.replace(/[^/]*$/, "");
  const joinUrl = location.origin + dir + "play?room=" + code;
  $("joinLink").value = joinUrl;
  $("joinOpen").href = joinUrl;
  $("qr").src = "https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=" + encodeURIComponent(joinUrl);

  $("copyBtn").onclick = async () => {
    try { await navigator.clipboard.writeText(joinUrl); }
    catch { $("joinLink").select(); document.execCommand("copy"); }
    toast("링크가 복사됐어요!");
  };

  // 슬라이드 목록
  onValue(ref(db, `rooms/${code}/slides`), (snap) => {
    const val = snap.val() || {};
    slides = Object.entries(val)
      .map(([id, s]) => ({ id, ...s }))
      .sort((a, b) => a.order - b.order);
    renderSlideList();
    renderStage();
  });

  // 참여 인원
  onValue(ref(db, `rooms/${code}/participants`), (snap) => {
    participantsData = snap.val() || {};
    participantIds = Object.keys(participantsData);
    participants = participantIds.length;
    $("ptCount").textContent = participants;
    renderResults();
    renderPtList();
  });

  // 현재 진행 슬라이드
  onValue(ref(db, `rooms/${code}/state/currentOrder`), (snap) => {
    currentOrder = snap.exists() ? snap.val() : -1;
    attachResponses();
    renderSlideList();
    renderStage();
  });
}

// ---------- 슬라이드 편집 ----------
$("qType").onchange = () => {
  $("optBox").classList.toggle("hidden", $("qType").value !== "choice");
};

$("addBtn").onclick = async () => {
  const type = $("qType").value;
  const q = $("qText").value.trim();
  if (!q) { $("qText").focus(); return; }
  const slide = { type, q, order: slides.length, createdAt: serverTimestamp() };
  if (type === "choice") {
    const opts = $("qOpts").value.split("\n").map(s => s.trim()).filter(Boolean);
    if (opts.length < 2) { showErr("4지선다는 보기를 2개 이상 입력하세요."); return; }
    slide.options = opts;
  }
  await push(ref(db, `rooms/${code}/slides`), slide);
  $("qText").value = ""; $("qOpts").value = "";
  $("err").classList.add("hidden");
};

function renderSlideList() {
  const box = $("slideList");
  if (!slides.length) { box.innerHTML = `<p class="muted">아직 슬라이드가 없습니다.</p>`; return; }
  const labels = { yesno: "Yes/No", choice: "4지선다", open: "주관식" };
  box.innerHTML = "";
  slides.forEach((s) => {
    const div = document.createElement("div");
    div.className = "slide-item" + (s.order === currentOrder ? " active" : "");
    div.innerHTML = `
      <div class="row" style="gap:10px">
        <span class="tag ${s.type}">${labels[s.type]}</span>
        <b>${s.order + 1}. ${escapeHtml(s.q)}</b>
      </div>`;
    const right = document.createElement("div");
    right.className = "row";
    const goBtn = document.createElement("button");
    goBtn.className = "ghost"; goBtn.textContent = "이동"; goBtn.style.padding = "8px 12px";
    goBtn.onclick = () => setOrder(s.order);
    const del = document.createElement("button");
    del.className = "danger"; del.textContent = "🗑"; del.style.padding = "8px 12px";
    del.onclick = () => deleteSlide(s);
    right.append(goBtn, del);
    div.appendChild(right);
    box.appendChild(div);
  });
}

async function deleteSlide(s) {
  if (!confirm(`"${s.q}" 슬라이드를 삭제할까요?`)) return;
  await remove(ref(db, `rooms/${code}/slides/${s.id}`));
  await remove(ref(db, `rooms/${code}/responses/${s.id}`));
}

// ---------- 진행 ----------
function setOrder(o) {
  const clamped = Math.max(-1, Math.min(o, slides.length - 1));
  update(ref(db, `rooms/${code}/state`), { currentOrder: clamped });
}
$("prevBtn").onclick = () => setOrder(currentOrder - 1);
$("nextBtn").onclick = () => setOrder(currentOrder < 0 ? 0 : currentOrder + 1);

// 넘어갈 곳이 없으면 버튼을 비활성화해 헷갈리지 않게
function updateNav() {
  $("prevBtn").disabled = currentOrder < 0;                 // 로비 이전 없음
  $("nextBtn").disabled = currentOrder >= slides.length - 1; // 마지막(또는 슬라이드 없음)
}

$("resetBtn").onclick = async () => {
  const s = activeSlide();
  if (!s) return;
  if (!confirm("이 질문의 응답을 모두 지우고 다시 받을까요?")) return;
  await remove(ref(db, `rooms/${code}/responses/${s.id}`));
};

// ---------- 참여자 명단 ----------
$("ptToggle").onclick = () => { $("ptPanel").classList.toggle("hidden"); renderPtList(); };
$("ptClose").onclick = () => $("ptPanel").classList.add("hidden");

function renderPtList() {
  const list = $("ptList");
  if (!list || $("ptPanel").classList.contains("hidden")) return;
  const ids = Object.keys(participantsData);
  if (!ids.length) { list.innerHTML = `<p class="muted">아직 참여자가 없습니다.</p>`; return; }
  list.innerHTML = "";
  ids.forEach((uid) => {
    const p = participantsData[uid] || {};
    const row = document.createElement("div");
    row.className = "slide-item";
    const who = document.createElement("span");
    who.innerHTML = `${p.anon ? "🕶" : "👤"} <b>${escapeHtml(p.name || "익명")}</b>` +
      ` <span class="muted" style="font-size:12px">#${uid.slice(-4)}</span>`;
    const del = document.createElement("button");
    del.className = "danger"; del.textContent = "내보내기"; del.style.padding = "8px 14px";
    del.onclick = () => kickParticipant(uid, p.name);
    row.append(who, del);
    list.appendChild(row);
  });
}

async function kickParticipant(uid, name) {
  if (!confirm(`'${name || "익명"}' 참여자를 내보낼까요? (응답도 함께 정리됩니다)`)) return;
  await remove(ref(db, `rooms/${code}/participants/${uid}`));
  for (const s of slides) await remove(ref(db, `rooms/${code}/responses/${s.id}/${uid}`));
}

function activeSlide() { return slides.find(s => s.order === currentOrder) || null; }

function attachResponses() {
  if (unsubResponses) { unsubResponses(); unsubResponses = null; }
  responses = {};
  const s = activeSlide();
  if (!s) { renderResults(); return; }
  unsubResponses = onValue(ref(db, `rooms/${code}/responses/${s.id}`), (snap) => {
    responses = snap.val() || {};
    renderResults();
  });
}

// ---------- 결과 렌더 ----------
function renderStage() {
  updateNav();
  const s = activeSlide();
  const stage = $("stage");
  if (!s) {
    $("progressLabel").textContent = "대기 중";
    stage.innerHTML = `<div class="waiting">“다음 ›”을 누르면 첫 질문이 모두에게 표시됩니다.</div>`;
    $("respCount").textContent = "0";
    return;
  }
  $("progressLabel").textContent = `진행 ${s.order + 1} / ${slides.length}`;
  stage.innerHTML = `<div class="question-title">${escapeHtml(s.q)}</div><div id="results"></div>`;
  renderResults();
}

function renderResults() {
  const s = activeSlide();
  const box = $("results");
  if (!s || !box) return;
  // 현재 접속 중인 참여자의 응답만 집계 (나간 사람의 옛 답은 표시에서 제외)
  const present = new Set(participantIds);
  const entries = Object.entries(responses)
    .filter(([uid]) => present.has(uid))
    .map(([, v]) => v);
  $("respCount").textContent = entries.length;

  if (s.type === "yesno") {
    const yes = entries.filter(v => v === "yes").length;
    const no = participants - yes;           // 응답 안 한 사람은 No (초기값 No)
    box.innerHTML = barsHtml([
      { label: "✅ Yes", count: yes, cls: "yes", total: participants },
      { label: "⬜ No",  count: Math.max(0, no), cls: "no", total: participants }
    ]);
  } else if (s.type === "choice") {
    const counts = (s.options || []).map(opt => entries.filter(v => v === opt).length);
    const total = Math.max(1, ...counts);
    box.innerHTML = barsHtml((s.options || []).map((opt, i) => ({
      label: opt, count: counts[i], cls: "", total
    })));
  } else { // open
    if (!box.querySelector(".cloud")) box.innerHTML = `<div class="cloud" id="cloud"></div>`;
    renderCloudThrottled($("cloud") || box, extractWords(entries), { minPx: 18, maxPx: 96 });
  }
}

// 클라우드는 최대 ~0.9초에 한 번만 다시 그림(마지막 상태는 보장)
let _cloudTimer = null, _cloudLast = 0;
function renderCloudThrottled(el, words, opts) {
  const now = Date.now(), gap = 900;
  clearTimeout(_cloudTimer);
  const run = () => { _cloudLast = Date.now(); renderCloud(el, words, opts); };
  if (now - _cloudLast >= gap) run();
  else _cloudTimer = setTimeout(run, gap - (now - _cloudLast));
}

function barsHtml(rows) {
  return `<div class="bars">` + rows.map(r => {
    const pct = r.total > 0 ? Math.round((r.count / r.total) * 100) : 0;
    return `<div class="bar-row">
      <div class="bar-label"><span>${escapeHtml(r.label)}</span><span>${r.count}명 · ${pct}%</span></div>
      <div class="bar-track"><div class="bar-fill ${r.cls}" style="width:${pct}%"></div></div>
    </div>`;
  }).join("") + `</div>`;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
