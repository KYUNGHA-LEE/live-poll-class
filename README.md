# 🟢 라이브 폴 (Live Poll)

멘티미터/슬라이도 같은 **실시간 참여형 웹앱**. 강사가 질문을 던지면 학생들의 답이 한 화면에 실시간으로 모입니다.

- **Yes/No** — 처음엔 모두 `No`, 학생이 Yes를 누를수록 Yes 막대가 커짐
- **4지선다** — 많이 고른 보기일수록 막대가 길어짐
- **단답형** — 많이 나온 단어일수록 크게 (워드클라우드, 조사·어미·불용어 자동 제거)
- **포스트잇** — 짧은 문장을 제출하면 비슷한 의견끼리 자동 그룹핑
- 강사가 슬라이드를 넘기면 **모든 학생 화면이 같은 슬라이드로 따라감**
- 익명/실명 참여, 실시간 참여 인원 수 표시

빌드 도구가 필요 없는 **순수 정적 웹앱**입니다 (HTML/JS/CSS).

---

## 1. Firebase 설정 (필수)

1. <https://console.firebase.google.com> 에서 **프로젝트 생성**
2. **빌드 → Realtime Database → 데이터베이스 만들기**
   - 위치 선택 → "테스트 모드로 시작" (아래 보안 규칙으로 교체 권장)
3. **빌드 → Authentication → 시작하기 → 로그인 방법 → "익명" 사용 설정**
4. 프로젝트 개요 옆 ⚙️ → **프로젝트 설정 → 내 앱 → 웹 앱 추가(`</>`)**
5. 나오는 `firebaseConfig` 객체를 복사해서 **`firebase-config.js`** 에 붙여넣기
   - 특히 `databaseURL` 이 채워져 있어야 합니다 (`https://...-rtdb.firebaseio.com`)

### 권장 Realtime Database 보안 규칙

실제 배포에서는 저장소의 **`database.rules.json`** 규칙을 적용하세요.
학생은 자기 참여 정보와 자기 응답만 쓰고, 강사만 슬라이드·진행 상태를 바꿀 수 있게 분리해 둔 규칙입니다.

적용 방법은 둘 중 하나입니다.

```powershell
firebase deploy --only database
```

또는 Firebase 콘솔의 **Realtime Database → 규칙** 탭에 `database.rules.json` 내용을 붙여넣고 게시하세요.

> 이전처럼 `".write": "auth != null"`만 두면 익명 로그인한 학생도 슬라이드나 진행 상태를 수정할 수 있으므로, 실제 수업/배포용으로는 권장하지 않습니다.

---

## 2. 로컬에서 실행

ES 모듈을 쓰기 때문에 **파일을 더블클릭(`file://`)하면 작동하지 않습니다.** 간단한 로컬 서버가 필요해요.

```powershell
# 이 폴더에서
npx serve .
```

브라우저에서 안내된 주소(예: `http://localhost:3000`)로 접속.

> 참고: 학생 참여 링크는 `.html` 없는 깔끔한 주소(`/play?room=코드`)를 씁니다.
> `serve`는 `/play.html?room=…` 을 `/play` 로 리다이렉트하면서 코드(`?room=`)를 버리기 때문이에요.
> (`python -m http.server` 같은 서버는 클린 URL을 지원하지 않으니 `npx serve` 를 권장합니다.)

- 강사: `index.html` → "강사로 시작하기"
- 학생: 강사 화면의 링크/QR로 참여 (다른 기기·시크릿창에서 테스트)

### 🧪 데모 모드 (Firebase 없이 바로 체험)

`firebase-config.js`가 아직 비어 있으면 **자동으로 데모 모드**로 동작합니다.
같은 브라우저의 **여러 탭끼리** localStorage로 동기화돼, Firebase 설정 전에 전체 흐름을 눌러볼 수 있어요.
(주소에 `?demo=1`을 붙이면 키가 있어도 강제로 데모 모드)

- 화면 상단에 "🧪 데모 모드" 배너가 뜸
- ⚠️ **같은 컴퓨터·같은 브라우저 탭끼리만** 연결됨 — 다른 폰·다른 PC는 안 됨
- 실제 수업(여러 기기 참여)은 아래 Firebase 설정이 필요합니다

**데모 테스트 방법:** 탭 2개를 열어 한쪽은 강사, 한쪽은 학생으로 진행.

---

## 3. Vercel 배포

1. 이 폴더를 GitHub 저장소로 push
2. <https://vercel.com> → **Add New → Project → 저장소 선택**
3. Framework Preset: **Other**, Build Command/Output: **비워둠** (정적 파일 그대로)
4. Deploy → 생성된 주소가 곧 학생 참여 링크가 됩니다.

> `firebase-config.js` 의 키들은 클라이언트에 노출되어도 되는 공개 키입니다.
> 보안은 위의 **Database 규칙**으로 거는 것이 정석입니다.

---

## 파일 구조

| 파일 | 역할 |
|------|------|
| `index.html` | 진입(강사 시작, 공유 링크 입장 처리) |
| `host.html` / `host.js` | 강사: 슬라이드 작성·진행·실시간 결과 |
| `play.html` / `play.js` | 학생: 참여·답변 |
| `firebase.js` | Firebase 초기화 + 공통 헬퍼 |
| `firebase-config.js` | **내 Firebase 키 (직접 입력)** |
| `database.rules.json` / `firebase.json` | Realtime Database 보안 규칙 배포 설정 |
| `util.js` | 한국어 단어 추출 + 워드클라우드 렌더 |
| `styles.css` | 스타일 |

## 단답형/포스트잇 필터에 대해

`util.js` 는 형태소 분석기나 외부 AI가 아니라 **가벼운 규칙 기반** 필터입니다.
조사·어미(`습니다/입니다/은/는/이/가/에서` 등)와 불용어를 제거하고 2글자 이상 단어만 셉니다.
더 정확한 분석이 필요하면 서버 측 형태소 분석기(은전한닢/Komoran 등) 연동을 검토하세요.
