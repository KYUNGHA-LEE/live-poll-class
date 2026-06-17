import {
  db, ref, set, get, update, push, remove, onValue, serverTimestamp,
  ensureAuth, configLooksUnset, makeRoomCode, DEMO
} from "./firebase.js";
import { extractWords, groupPostIts, renderCloud } from "./util.js";

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
let editingId = null;        // 내용 수정 중인 슬라이드 id (null = 편집 중 아님)

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
  try {
    code = await createRoom();
    localStorage.setItem("livepoll_host_room", code);
    enterRoom(code);
  } catch (e) {
    showErr("세션을 만들지 못했어요. 잠시 후 다시 시도해 주세요. (" + e.message + ")");
  }
};

async function createRoom() {
  for (let i = 0; i < 8; i++) {
    const roomCode = makeRoomCode();
    const snap = await get(ref(db, `rooms/${roomCode}/meta`));
    if (snap.exists()) continue;
    await set(ref(db, `rooms/${roomCode}/meta`), { hostId: uid, createdAt: serverTimestamp() });
    await set(ref(db, `rooms/${roomCode}/state`), { currentOrder: -1 });
    return roomCode;
  }
  throw new Error("세션 ID를 만들 수 없습니다");
}

// ---------- 방 입장 + 리스너 ----------
function enterRoom(roomCode) {
  code = roomCode;
  $("setup").classList.add("hidden");
  $("dash").classList.remove("hidden");

  // 현재 폴더 경로만 남기고 파일명(host / host.html 등)을 떼어 안전하게 조합.
  // .html 을 붙이면 serve가 /play 로 리다이렉트하며 ?room= 쿼리를 버리므로, 깔끔한 주소로 만든다.
  const dir = location.pathname.replace(/[^/]*$/, "");
  const joinParams = new URLSearchParams({ room: code });
  if (DEMO) joinParams.set("demo", "1");
  const joinUrl = location.origin + dir + "play?" + joinParams.toString();
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

const SLIDE_LABELS = { yesno: "Yes/No", choice: "4지선다", open: "단답형", postit: "포스트잇" };
let dragId = null;          // 드래그 중인 슬라이드 id

function renderSlideList() {
  const box = $("slideList");
  if (!slides.length) { box.innerHTML = `<p class="muted">아직 슬라이드가 없습니다.</p>`; return; }
  box.innerHTML = "";
  slides.forEach((s) => {
    if (s.id === editingId) { box.appendChild(buildEditor(s)); return; }

    const div = document.createElement("div");
    div.className = "slide-item" + (s.order === currentOrder ? " active" : "");
    div.draggable = true;
    div.dataset.id = s.id;
    div.addEventListener("dragstart", (e) => {
      dragId = s.id; div.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", s.id); // Firefox는 데이터 설정이 있어야 드래그 시작
    });
    div.addEventListener("dragend", () => {
      dragId = null; div.classList.remove("dragging");
      [...box.children].forEach(c => c.classList.remove("drag-over"));
    });
    div.addEventListener("dragover", (e) => {
      if (!dragId || dragId === s.id) return;
      e.preventDefault(); e.dataTransfer.dropEffect = "move";
      div.classList.add("drag-over");
    });
    div.addEventListener("dragleave", () => div.classList.remove("drag-over"));
    div.addEventListener("drop", (e) => {
      e.preventDefault(); div.classList.remove("drag-over"); dropOn(s.id);
    });

    const handle = document.createElement("span");
    handle.textContent = "⠿"; handle.title = "드래그해서 순서를 바꾸세요";
    handle.style.cssText = "cursor:grab; color:var(--muted); font-size:18px; line-height:1; user-select:none; flex:0 0 auto";

    const meta = document.createElement("span");
    meta.innerHTML = `<span class="tag ${s.type}">${SLIDE_LABELS[s.type]}</span> <b>${s.order + 1}. ${escapeHtml(s.q)}</b>`;
    meta.style.cssText = "display:inline-flex; align-items:center; gap:8px; flex:1 1 auto; min-width:0";

    // 박스 전체: 클릭 → 수정, 드래그 → 순서 이동 (목록에 버튼 없음)
    div.classList.add("clickable");
    div.title = "클릭해 수정 · 드래그해 순서 변경";
    div.onclick = () => { editingId = s.id; renderSlideList(); };

    div.append(handle, meta);
    box.appendChild(div);
  });
}

// 드래그한 슬라이드(dragId)를 targetId 위치로 옮긴다. 순서가 바뀐 슬라이드만 DB에 기록.
async function dropOn(targetId) {
  if (!dragId || dragId === targetId) return;
  const from = slides.findIndex(s => s.id === dragId);
  const to = slides.findIndex(s => s.id === targetId);
  if (from < 0 || to < 0) return;
  const liveId = activeSlide()?.id;   // 지금 띄워둔 슬라이드는 내용 그대로 따라가게

  const reordered = slides.slice();
  const [moved] = reordered.splice(from, 1);
  reordered.splice(to, 0, moved);

  await Promise.all(reordered.map((s, order) => (
    s.order === order ? Promise.resolve()
      : set(ref(db, `rooms/${code}/slides/${s.id}/order`), order)
  )));
  if (liveId) {
    const newOrder = reordered.findIndex(s => s.id === liveId);
    if (newOrder >= 0 && newOrder !== currentOrder) {
      await update(ref(db, `rooms/${code}/state`), { currentOrder: newOrder });
    }
  }
  dragId = null;
}

// 내용 수정용 인라인 에디터 (질문 + 4지선다면 보기). 유형은 바꾸지 않음.
function buildEditor(s) {
  const div = document.createElement("div");
  div.className = "slide-item";
  div.style.cssText = "flex-direction:column; align-items:stretch; gap:10px";

  const head = document.createElement("div");
  head.className = "row"; head.style.gap = "10px";
  head.innerHTML = `<span class="tag ${s.type}">${SLIDE_LABELS[s.type]}</span> <b>${s.order + 1}번 슬라이드 수정</b>`;

  const qInput = document.createElement("input");
  qInput.type = "text"; qInput.value = s.q;
  qInput.addEventListener("keydown", (e) => { if (e.key === "Enter" && s.type !== "choice") saveEdit(s, qInput, null); });

  let optInput = null, optLabel = null;
  if (s.type === "choice") {
    optLabel = document.createElement("label"); optLabel.textContent = "보기 (한 줄에 하나)";
    optInput = document.createElement("textarea");
    optInput.rows = 4; optInput.value = (s.options || []).join("\n");
  }

  const actions = document.createElement("div");
  actions.className = "row"; actions.style.gap = "8px";
  const save = document.createElement("button");
  save.textContent = "저장"; save.style.padding = "8px 18px";
  save.onclick = () => saveEdit(s, qInput, optInput);
  const cancel = document.createElement("button");
  cancel.className = "ghost"; cancel.textContent = "취소"; cancel.style.padding = "8px 18px";
  cancel.onclick = () => { editingId = null; $("err").classList.add("hidden"); renderSlideList(); };
  const present = document.createElement("button");
  present.className = "ghost"; present.textContent = "▶ 학생에게 띄우기"; present.style.cssText = "padding:8px 16px; margin-left:auto";
  present.title = "이 슬라이드를 학생 화면에 표시";
  present.onclick = () => { editingId = null; setOrder(s.order); };
  const del = document.createElement("button");
  del.className = "danger"; del.textContent = "삭제"; del.style.padding = "8px 16px";
  del.onclick = () => deleteSlide(s);
  actions.append(save, cancel, present, del);

  div.append(head, qInput);
  if (optInput) div.append(optLabel, optInput);
  div.append(actions);
  return div;
}

async function saveEdit(s, qInput, optInput) {
  const q = qInput.value.trim();
  if (!q) { qInput.focus(); return; }
  const patch = { q };
  if (s.type === "choice") {
    const opts = optInput.value.split("\n").map(t => t.trim()).filter(Boolean);
    if (opts.length < 2) { showErr("4지선다는 보기를 2개 이상 입력하세요."); return; }
    patch.options = opts;
  }
  await update(ref(db, `rooms/${code}/slides/${s.id}`), patch);
  editingId = null;
  $("err").classList.add("hidden");
}

async function deleteSlide(s) {
  if (!confirm(`"${s.q}" 슬라이드를 삭제할까요?`)) return;
  const remaining = slides.filter(slide => slide.id !== s.id);
  let nextOrder = currentOrder;
  if (!remaining.length) nextOrder = -1;
  else if (currentOrder === s.order) nextOrder = Math.min(s.order, remaining.length - 1);
  else if (currentOrder > s.order) nextOrder = currentOrder - 1;
  nextOrder = Math.max(-1, Math.min(nextOrder, remaining.length - 1));

  await remove(ref(db, `rooms/${code}/slides/${s.id}`));
  await remove(ref(db, `rooms/${code}/responses/${s.id}`));
  await Promise.all(remaining.map((slide, order) => (
    slide.order === order
      ? Promise.resolve()
      : set(ref(db, `rooms/${code}/slides/${slide.id}/order`), order)
  )));
  await update(ref(db, `rooms/${code}/state`), { currentOrder: nextOrder });
  editingId = null;
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
    const total = Math.max(1, entries.length);
    box.innerHTML = barsHtml((s.options || []).map((opt, i) => ({
      label: opt, count: counts[i], cls: "", total
    })));
  } else if (s.type === "postit") {
    renderPostItGroups(box, groupPostIts(entries));
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

function renderPostItGroups(box, groups) {
  if (!groups.length) {
    box.innerHTML = `<p class="empty">아직 포스트잇이 없어요…</p>`;
    return;
  }
  box.innerHTML = `<div class="postit-board">` + groups.map((g) => `
    <section class="postit-cluster">
      <div class="postit-cluster-head">
        <b>${escapeHtml(g.label)}</b>
        <span>${g.count}개</span>
      </div>
      <div class="postit-stack">
        ${g.items.map((text) => `<div class="postit-note">${escapeHtml(text)}</div>`).join("")}
      </div>
    </section>`).join("") + `</div>`;
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
