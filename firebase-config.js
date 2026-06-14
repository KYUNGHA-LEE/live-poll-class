// ⚙️ Firebase 설정
// Firebase 콘솔(https://console.firebase.google.com) → 프로젝트 만들기 →
// "웹 앱 추가(</>)" 후 나오는 firebaseConfig 객체를 그대로 아래에 붙여넣으세요.
//
// 꼭 해야 할 것 (README.md 참고):
//   1) Realtime Database 만들기 (databaseURL 이 여기에 들어가야 함)
//   2) Authentication → 로그인 방법 → "익명" 사용 설정
//
// databaseURL 이 비어 있으면 실시간 동기화가 동작하지 않습니다!

export const firebaseConfig = {
  apiKey: "여기에-API-KEY",
  authDomain: "여기에-PROJECT.firebaseapp.com",
  databaseURL: "https://여기에-PROJECT-default-rtdb.firebaseio.com",
  projectId: "여기에-PROJECT-ID",
  storageBucket: "여기에-PROJECT.appspot.com",
  messagingSenderId: "여기에-SENDER-ID",
  appId: "여기에-APP-ID"
};
