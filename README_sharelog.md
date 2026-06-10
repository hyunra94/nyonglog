# Share Log Hybrid v1

기존 Paper Log Worker는 그대로 쓰고, 별도 공유용으로 쓰는 앱입니다.

## 구성
- 캘린더: 기존 Worker의 `/api/calendar`에서 일정만 불러오기
- 가계부: 브라우저 localStorage 로컬 저장
- 보스탭 없음
- 할 일/Daily Log 표시 없음

## 파일
- sharelog.html
- sharelog.webmanifest
- sharelog-sw.js

## 사용
GitHub Pages 저장소에 세 파일을 올리고 접속합니다.

`https://<github-id>.github.io/<repo>/sharelog.html`

앱 설정에서 기존 Paper Log Worker 앞부분, Cloudflare ID, SECRET Key를 입력하면 일정만 불러옵니다.
가계부는 친구 기기 브라우저 안에만 저장되고 JSON 백업/복원이 가능합니다.
