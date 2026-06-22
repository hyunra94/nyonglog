# Paper Log Local

기존 Paper Log에서 새로 분기한 PWA입니다.

- Calendar: Notion 일정 DB만 Cloudflare Worker를 통해 연동
- Money Log: Notion 연동 제거, 브라우저 IndexedDB 로컬 저장
- Boss: 제거
- Backup: 가계부 JSON 백업/복원, CSV 내보내기 지원
- Security: Worker URL은 `config.js`에 고정, 앱 키는 PIN으로 암호화 저장 가능

## 폴더 구조

```text
paper-log-local/
├─ index.html
├─ config.js
├─ styles.css
├─ app.js
├─ manifest.json
├─ sw.js
├─ icons/
│  ├─ icon-192.png
│  └─ icon-512.png
└─ cloudflare-worker/
   └─ schedule-worker.js
```

## 1. Worker URL 설정

Cloudflare Worker를 만든 뒤 `config.js`에서 아래 값을 본인 Worker 주소로 바꿉니다.

```js
window.PAPER_LOG_CONFIG = {
  WORKER_URL: 'https://YOUR-WORKER-NAME.YOUR-SUBDOMAIN.workers.dev'
};
```

이제 앱 화면에서는 Worker URL을 입력하지 않습니다. 사용자는 앱 키만 입력합니다.

## 2. 프론트 배포

GitHub Pages에 `paper-log-local` 폴더의 파일을 업로드합니다.

필수 파일:

- `index.html`
- `config.js`
- `styles.css`
- `app.js`
- `manifest.json`
- `sw.js`
- `icons/`

## 3. Cloudflare Worker 배포

`cloudflare-worker/schedule-worker.js` 내용을 새 Worker에 붙여 넣습니다.

### Worker 환경변수

필수:

```text
SECRET_KEY=프론트에서 입력할 앱 키
NOTION_TOKEN=노션 통합 토큰
NOTION_SCHEDULE_DB_ID=일정 DB의 Data Source ID
```

선택:

```text
ALLOWED_ORIGIN=https://깃허브페이지주소.github.io
SCHEDULE_TITLE_PROP=제목
SCHEDULE_DATE_PROP=날짜
SCHEDULE_CATEGORY_PROP=카테고리
SCHEDULE_CANCEL_PROP=취소
SCHEDULE_MEMO_PROP=개인 메모
SCHEDULE_MEMO_TYPE=multi_select
```

`ALLOWED_ORIGIN`을 비워두면 기본값은 `*`입니다. 개인 테스트에는 생략 가능하지만, 실제 사용 시 GitHub Pages 주소를 넣는 것을 추천합니다.

## 4. Notion 일정 DB 속성

기본값 기준으로 아래 속성을 사용합니다.

| 속성명 | 타입 | 설명 |
|---|---|---|
| 제목 | Title | 일정 제목 |
| 날짜 | Date | 일정 날짜/기간 |
| 카테고리 | Select | 업무, 개인, 약속 등 |
| 취소 | Checkbox | 취소 일정 표시 |
| 개인 메모 | Multi-select | 쉼표로 입력한 메모 태그 |

기존 DB의 `개인 메모`가 Rich text라면 Worker 환경변수에 아래를 추가하세요.

```text
SCHEDULE_MEMO_TYPE=rich_text
```

## 5. 앱 설정 흐름

앱 실행 후 Settings 탭에서 입력합니다.

### 이 기기에 저장하는 경우

```text
앱 키 입력
→ 이 기기에 앱 키 저장 체크
→ 저장/잠금 PIN 입력
→ 설정 저장
```

이 경우 앱 키는 PIN으로 암호화되어 이 브라우저에 저장됩니다. 다음 실행부터는 PIN만 입력하면 앱 키가 복호화되고 Calendar 연동이 됩니다.

### 이 기기에 저장하지 않는 경우

```text
앱 키 입력
→ 이 기기에 앱 키 저장 체크 해제
→ 설정 저장
```

이 경우 앱 키는 `sessionStorage`에만 저장됩니다. 브라우저 탭/앱을 닫으면 다시 입력해야 합니다.

## 6. PIN 잠금

- 앱 키를 이 기기에 저장하면 PIN 잠금이 자동으로 함께 설정됩니다.
- Settings > 앱 잠금에서 PIN을 변경할 수 있습니다.
- 저장된 앱 키가 있는 상태에서 PIN을 해제하면 저장된 앱 키도 함께 삭제됩니다.

## 7. 가계부 백업

Money Log는 로컬 IndexedDB에 저장됩니다. 브라우저 초기화, 기기 변경, 사이트 데이터 삭제 시 사라질 수 있으니 Settings에서 JSON 백업을 권장합니다.

- 전체 JSON 내보내기: 앱 복구용
- JSON 가져오기: 기존 데이터 교체 또는 추가 가능
- 현재 월 CSV: 엑셀 확인용
- 전체 CSV: 전체 기록 확인용

## 8. 수정 후 캐시 반영

`index.html`, `config.js`, `styles.css`, `app.js`를 수정한 뒤 앱이 예전 화면으로 보이면 `sw.js`의 캐시 버전을 올리세요.

```js
const CACHE_NAME = 'paper-log-local-v3';
```
