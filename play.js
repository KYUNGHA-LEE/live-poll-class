import {
  db, ref, set, get, update, remove, onValue, onDisconnect, serverTimestamp,
  ensureAuth, configLooksUnset, DEMO
} from "./firebase.js";

const $ = (id) => document.getElementById(id);
const showErr = (msg) => { const e = $("err"); e.textContent = msg; e.classList.remove("hidden"); };

const code = (new URLSearchParams(location.search).get("room") || "").toUpperCase();
let uid = null;
let slides = {};            // {id: slide}
let currentOrder = -1;
let myAnswers = {};         // {slideId: value}  (내 답)

(async function boot() {
  if (!code) { showErr("참여 코드가 없습니다. 강사가 준 링크나 코드로 다시 들어와 주세요."); return; }
  if (configLooksUnset() && !DEMO) { showErr("⚠️ firebase-config.js 설정이 필요합니다 (README 참고)."); return; }

  try { uid = await ensureAuth(); }
  catch (e) { showErr("접속 실패: " + e.message); return; }

  const meta = await get(ref(db, `rooms/${code}/meta`));
  if (!meta.exists()) { showErr(`'${code}' 세션을 찾을 수 없어요. 코드를 확인해 주세요.`); return; }

  $("codeShow").textContent = code;
  const savedName = localStorage.getItem("livepoll_name") || "";
  $("nameInput").value = savedName;
  $("nameGate").classList.remove("hidden");
})();

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

  onValue(ref(db, `rooms/${code}/state/currentOrder`), (snap) => {
    currentOrder = snap.exists() ? snap.val() : -1;
    renderQuestion();
  });
}

function activeSlide() {
  const entry = Object.entries(slides).find(([, s]) => s.order === currentOrder);
  return entry ? { id: entry[0], ...entry[1] } : null;
}

function submit(slideId, value) {
  set(ref(db, `rooms/${code}/responses/${slideId}/${uid}`), value);
}

function renderQuestion() {
  const s = activeSlide();
  if (!s) {
    $("waiting").classList.remove("hidden");
    $("qcard").classList.add("hidden");
    return;
  }
  $("waiting").classList.add("hidden");
  $("qcard").classList.remove("hidden");
  $("qTitle").textContent = s.q;
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
      b.textContent = v === "yes" ? "✅ Yes" : "⬜ No";
      b.onclick = () => submit(s.id, v);
      wrap.appendChild(b);
    }
    area.appendChild(wrap);

  } else if (s.type === "choice") {
    const grid = document.createElement("div");
    grid.className = "choice-grid";
    (s.options || []).forEach((opt) => {
      const b = document.createElement("button");
      b.className = "choice-btn" + (mine === opt ? " selected" : "");
      b.textContent = opt;
      b.onclick = () => submit(s.id, opt);
      grid.appendChild(b);
    });
    area.appendChild(grid);

  } else if (s.type === "postit") {
    const input = document.createElement("textarea");
    input.rows = 4;
    input.placeholder = "짧은 문장으로 적어주세요";
    input.maxLength = 120;
    if (mine !== undefined) input.value = mine;
    const btn = document.createElement("button");
    btn.textContent = mine === undefined ? "붙이기" : "수정";
    btn.style.marginTop = "10px";
    const send = () => {
      const v = input.value.trim();
      if (!v) return;
      submit(s.id, v);
      btn.textContent = "수정";
    };
    btn.onclick = send;
    input.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") send();
    });
    area.append(input, btn);

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
