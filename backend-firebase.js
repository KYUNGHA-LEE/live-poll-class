// 실제 Firebase 백엔드 (firebase-config.js에 키가 채워졌을 때 사용)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getDatabase, ref as rtdbRef, set, get, update, push, remove,
  onValue, onDisconnect, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";
import {
  getAuth, signInAnonymously, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";

const app  = initializeApp(firebaseConfig);
const db   = getDatabase(app);
const auth = getAuth(app);

export function ref(path) { return rtdbRef(db, path); }
export { set, get, update, push, remove, onValue, onDisconnect, serverTimestamp };

export function ensureAuth() {
  return new Promise((resolve, reject) => {
    onAuthStateChanged(auth, (user) => {
      if (user) { resolve(user.uid); return; }
      signInAnonymously(auth).catch(reject);
    });
  });
}
