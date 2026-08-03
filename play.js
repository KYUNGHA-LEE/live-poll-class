import {
  db, ref, set, get, update, remove, onValue, onDisconnect, serverTimestamp,
  ensureAuth, configLooksUnset, DEMO
} from "./firebase.js";

const $ = (id) => document.getElementById(id);
const showErr = (msg) => { const e = $("err"); e.textContent = msg; e.classList.remove("hidden"); };
const hideErr = () => $("err").classList.add("hidden");

let code = (new URLSearchParams(location.search).get("room") || "").toUpperCase();
let uid = null;
let slides = {};            // {id: slide}
let currentOrder = -1;
let myAnswers = {};         // {slideId: value}  (내 답)
let draft = null;           // 강사가 지금 타이핑 중인 질문 (저장 전에도 바로 보인다)
const DRAFT_ID = "__draft__";

(async function boot() {
  if (configLooksUnset() && !DEMO) { showErr("⚠️ firebase-config.js 설정이 필요합니다 (README 참고)."); return; }

  try { uid = await ensureAuth(); }
  catch (e) { showErr("접속 실패: " + e.message); return; }

  // 링크/QR(?room=CODE)로 들어왔으면 코드 입력을 건너뛴다.
  if (code) { await openNameGate(code); return; }

  // 주소만 치고 들어온 학생 → 참여 코드부터 입력
  $("codeInput").value = localStorage.getItem("livepoll_last_room") || "";
  $("codeGate").classList.remove("hidden");
  $("codeInput").focus();
})();

// ---------- 참여 코드 ----------
async function openNameGate(input) {
  const c = (input || "").trim().toUpperCase();
  if (!c) { $("codeInput").focus(); return; }

  const meta = await get(ref(db, `rooms/${c}/meta`));
  if (!meta.exists()) { showErr(`'${c}' 세션을 찾을 수 없어요. 코드를 확인해 주세요.`); return; }

  hideErr();
  code = c;
  localStorage.setItem("livepoll_last_room", c);
  $("codeGate").classList.add("hidden");
  $("codeShow").textContent = c;
  $("nameInput").value = localStorage.getItem("livepoll_name") || "";
  $("nameGate").classList.remove("hidden");
  $("nameInput").focus();
}

$("codeInput").addEventListener("input", (e) => {
  e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
});
$("codeBtn").onclick = () => openNameGate($("codeInput").value);
$("codeInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") openNameGate($("codeInput").value);
});

function doJoin() {
  const name = $("nameInput").value.trim();
  if (name) join(name, false);   // 이름 입력 → 실명 참여
  else join("익명", true);        // 비워두면 → 익명 참여
}
$("joinBtn").onclick = doJoin;
$("nameInput").addEventListener("keydown", (e) => { if (e.key === "Enter") doJoin(); });

async function join(name, anon) {
  if (!anon) localStorage.setItem("livepoll_name", name);
  const pRef = ref(db, `rooms/${code}/participants/${uid}`);
  await set(pRef, { name, anon, ts: serverTimestamp() });
  onDisconnect(pRef).remove();          // 나가면 자동 제거 → 인원수 정확

  $("nameGate").classList.add("hidden");
  $("live").classList.remove("hidden");
  $("whoami").textContent = (anon ? "🕶 익명" : "👤 " + name);

  // 내가 이미 한 답 불러오기
  onValue(ref(db, `rooms/${code}/responses`), (snap) => {
    const all = snap.val() || {};
    myAnswers = {};
    for (const [sid, byUser] of Object.entries(all)) {
      if (byUser && byUser[uid] !== undefined) myAnswers[sid] = byUser[uid];
    }
    renderQuestion();
  });

  onValue(ref(db, `rooms/${code}/participants`), (snap) => {
    $("ptCount").textContent = snap.exists() ? Object.keys(snap.val()).length : 0;
  });

  onValue(ref(db, `rooms/${code}/slides`), (snap) => {
    slides = snap.val() || {};
    renderQuestion();
  });

  onValue(ref(db, `rooms/${code}/state`), (snap) => {
    const v = snap.val() || {};
    currentOrder = typeof v.currentOrder === "number" ? v.currentOrder : -1;
    draft = (v.draft && v.draft.q) ? v.draft : null;
    renderQuestion();
  });
}

function activeSlide() {
  const entry = Object.entries(slides).find(([, s]) => s.order === currentOrder);
  return entry ? { id: entry[0], ...entry[1] } : null;
}

// 강사가 타이핑 중이면 그 질문이 우선, 아니면 진행 중 슬라이드
function activeTarget() {
  if (draft) return { id: DRAFT_ID, type: draft.type, q: draft.q, options: draft.options || [] };
  return activeSlide();
}

function submit(slideId, value) {
  set(ref(db, `rooms/${code}/responses/${slideId}/${uid}`), value);
}

// 강사가 질문을 한 글자씩 고치는 동안 답변칸이 통째로 다시 그려지면
// 학생이 쓰던 글이 날아간다. 그래서 "무엇을 묻는 칸인지"가 바뀔 때만 다시 만들고,
// 질문 글자만 바뀐 경우엔 제목과 선택 표시만 갱신한다.
let renderedKey = null;

function renderQuestion() {
  const s = activeTarget();
  if (!s) {
    renderedKey = null;
    $("waiting").classList.remove("hidden");
    $("qcard").classList.add("hidden");
    return;
  }
  $("waiting").classList.add("hidden");
  $("qcard").classList.remove("hidden");
  $("qTitle").textContent = s.q;

  const key = [s.id, s.type, (s.options || []).join("")].join("|");
  if (key !== renderedKey) { renderedKey = key; buildAnswerArea(s); }
  else refreshAnswerArea(s);
}

// 답을 이미 냈는지에 따라 선택 표시·버튼 글자만 살짝 고친다 (입력 중인 글은 건드리지 않음)
function refreshAnswerArea(s) {
  const mine = myAnswers[s.id];
  $("doneMsg").classList.toggle("hidden", mine === undefined);
  const area = $("answerArea");

  if (s.type === "yesno") {
    const selected = mine === undefined ? "no" : mine;
    area.querySelectorAll("button[data-v]").forEach((b) => {
      b.classList.toggle("selected", b.dataset.v === selected);
    });
  } else if (s.type === "choice") {
    area.querySelectorAll("button[data-v]").forEach((b) => {
      b.classList.toggle("selected", b.dataset.v === mine);
    });
  } else {
    const btn = area.querySelector("button");
    if (btn) {
      btn.textContent = s.type === "postit"
        ? (mine === undefined ? "📌 붙이기" : "✏️ 수정하기")
        : (mine === undefined ? "제출" : "수정");
    }
  }
}

function buildAnswerArea(s) {
  const mine = myAnswers[s.id];
  $("doneMsg").classList.toggle("hidden", mine === undefined);

  const area = $("answerArea");
  area.innerHTML = "";

  if (s.type === "yesno") {
    // 초기값은 No (아직 누르지 않았어도 No로 간주) → Yes를 누르면 바뀜
    const wrap = document.createElement("div");
    wrap.className = "big-toggle";
    const selected = mine === undefined ? "no" : mine;
    for (const v of ["yes", "no"]) {
      const b = document.createElement("button");
      b.className = v + (selected === v ? " selected" : "");
      b.dataset.v = v;
      b.textContent = v === "yes" ? "✅ Yes" : "⬜ No";
      b.onclick = () => submit(s.id, v);
      wrap.appendChild(b);
    }
    area.appendChild(wrap);

  } else if (s.type === "choice") {
    const opts = s.options || [];
    if (!opts.length) {
      // 강사가 아직 보기를 입력하는 중
      const wait = document.createElement("p");
      wait.className = "muted center";
      wait.textContent = "보기를 기다리는 중…";
      area.appendChild(wait);
      return;
    }
    const grid = document.createElement("div");
    grid.className = "choice-grid";
    opts.forEach((opt) => {
      const b = document.createElement("button");
      b.className = "choice-btn" + (mine === opt ? " selected" : "");
      b.dataset.v = opt;
      b.textContent = opt;
      b.onclick = () => submit(s.id, opt);
      grid.appendChild(b);
    });
    area.appendChild(grid);

  } else if (s.type === "postit") {
    // 진짜 포스트잇에 펜으로 적는 느낌의 입력 카드
    const note = document.createElement("div");
    note.className = "postit-compose";
    const input = document.createElement("textarea");
    input.rows = 4;
    input.placeholder = "여기에 적어서 붙여요 ✍️";
    input.maxLength = 120;
    if (mine !== undefined) input.value = mine;
    const counter = document.createElement("div");
    counter.className = "postit-count";
    const updateCount = () => { counter.textContent = input.value.length + " / 120"; };
    updateCount();
    input.addEventListener("input", updateCount);
    note.append(input, counter);

    const btn = document.createElement("button");
    btn.textContent = mine === undefined ? "📌 붙이기" : "✏️ 수정하기";
    btn.style.cssText = "margin-top:18px; width:100%";
    const send = () => {
      const v = input.value.trim();
      if (!v) { input.focus(); return; }
      submit(s.id, v);
      btn.textContent = "✏️ 수정하기";
    };
    btn.onclick = send;
    input.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") send();
    });
    area.append(note, btn);

  } else { // open (단답형)
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "답을 입력하세요";
    input.maxLength = 60;
    if (mine !== undefined) input.value = mine;
    const btn = document.createElement("button");
    btn.textContent = mine === undefined ? "제출" : "수정";
    btn.style.marginTop = "10px";
    const send = () => {
      const v = input.value.trim();
      if (!v) return;
      submit(s.id, v);
      btn.textContent = "수정";
    };
    btn.onclick = send;
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") send(); });
    area.append(input, btn);
  }
}
