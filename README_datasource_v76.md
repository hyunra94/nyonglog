# Paper Log v76 — Notion Data Source API 대응

이 버전의 Worker는 Notion API `2025-09-03` 기준으로 `/v1/data_sources/{data_source_id}/query`를 사용합니다.

따라서 Cloudflare Variables의 `NOTION_..._DB_ID` 이름은 그대로 두되, 값에는 **데이터 소스 ID**를 넣어도 됩니다.

## 그대로 유지할 변수명

```txt
NOTION_TODO_DB_ID
NOTION_SCHEDULE_DB_ID
NOTION_PROJECT_DB_ID
NOTION_INCOME_DB_ID
NOTION_EXPENSE_DB_ID
NOTION_DAILY_LOG_DB_ID

NOTION_BOSS_CHARACTER_DB_ID
NOTION_BOSS_CRYSTAL_DB_ID
NOTION_BOSS_RECORD_DB_ID
NOTION_BOSS_THIS_WEEK_DB_ID
NOTION_BOSS_WEEK_DB_ID
```

위 변수들의 값은 사용자가 다시 복사한 Data Source ID를 넣으면 됩니다.

## 템플릿 ID

템플릿은 데이터 소스 ID가 아니므로 기존처럼 템플릿/페이지 ID만 넣습니다.

```txt
TODO_PERSONAL_TEMPLATE_ID
TODO_WORK_TEMPLATE_ID
```

링크 전체가 아니라 ID만 넣는 것을 권장합니다.

## Secret

```txt
NOTION_TOKEN
SECRET_KEY
```

Secret 값은 그대로 Secret 타입으로 유지하세요.
