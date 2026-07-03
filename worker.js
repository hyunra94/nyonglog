export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,x-paper-log-key",
      "Content-Type": "application/json; charset=utf-8",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    try {
      const url = new URL(request.url);
      const clientKey = request.headers.get("x-paper-log-key");

      if (clientKey !== env.SECRET_KEY) {
        return json({ ok: false, error: "Unauthorized" }, 401, cors);
      }

      // ── 캘린더 / Notion 엔드포인트 ──────────────────────────────────

      if (url.pathname === "/api/projects" && request.method === "GET") {
        const projects = await getProjects(env);
        return json({ ok: true, projects }, 200, cors);
      }

      if (url.pathname === "/api/calendar" && request.method === "GET") {
        const schedules = await getSchedules(request, env);
        return json({ ok: true, schedules }, 200, cors);
      }

      if (url.pathname === "/api/schedule" && request.method === "POST") {
        const result = await createSchedule(request, env);
        return json({ ok: true, page: result }, 200, cors);
      }

      if (url.pathname === "/api/schedule" && request.method === "PATCH") {
        const result = await updateSchedule(request, env);
        return json({ ok: true, page: result }, 200, cors);
      }

      if (url.pathname === "/api/schedule" && request.method === "DELETE") {
        const result = await deleteSchedule(request, env);
        return json({ ok: true, page: result }, 200, cors);
      }

      // ── 가계부 / D1 엔드포인트 ──────────────────────────────────────

      if (url.pathname === "/api/money/init" && request.method === "GET") {
        await initMoneyTable(env);
        return json({ ok: true, message: "테이블 생성 완료" }, 200, cors);
      }

      if (url.pathname === "/api/money" && request.method === "GET") {
        const records = await getMoneyRecords(request, env);
        return json({ ok: true, records }, 200, cors);
      }

      if (url.pathname === "/api/money" && request.method === "POST") {
        const id = await createMoneyRecord(request, env);
        return json({ ok: true, id }, 200, cors);
      }

      // PATCH /api/money/:id
      const patchMoneyMatch = url.pathname.match(/^\/api\/money\/([^/]+)$/);
      if (patchMoneyMatch && request.method === "PATCH") {
        await updateMoneyRecord(patchMoneyMatch[1], request, env);
        return json({ ok: true }, 200, cors);
      }

      // DELETE /api/money/:id
      const deleteMoneyMatch = url.pathname.match(/^\/api\/money\/([^/]+)$/);
      if (deleteMoneyMatch && request.method === "DELETE") {
        await deleteMoneyRecord(deleteMoneyMatch[1], env);
        return json({ ok: true }, 200, cors);
      }

      return json({ ok: false, error: "Not found", path: url.pathname }, 404, cors);

    } catch (err) {
      return json({
        ok: false,
        error: "Worker crashed",
        message: err.message,
        stack: err.stack,
      }, 500, cors);
    }
  }
};

function json(data, status, cors) {
  return new Response(JSON.stringify(data), { status, headers: cors });
}

/* =========================
   Notion 공통
========================= */

const NOTION_VERSION = "2025-09-03";

async function notionQuery(env, dataSourceId, body = {}) {
  if (!dataSourceId) throw new Error("Notion data source ID is missing");

  const results = [];
  let hasMore = true;
  let startCursor = undefined;

  while (hasMore) {
    const queryBody = { page_size: 100, ...body };
    if (startCursor) queryBody.start_cursor = startCursor;

    const res = await fetch(`https://api.notion.com/v1/data_sources/${dataSourceId}/query`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.NOTION_TOKEN}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(queryBody),
    });

    const text = await res.text();
    if (!res.ok) throw new Error(`Notion query failed ${res.status}: ${text}`);

    const data = JSON.parse(text);
    results.push(...(data.results || []));
    hasMore = Boolean(data.has_more);
    startCursor = data.next_cursor;
  }

  return { results };
}

async function notionCreatePage(env, dataSourceId, properties) {
  const payload = {
    parent: { type: "data_source_id", data_source_id: dataSourceId },
    properties,
  };

  const res = await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.NOTION_TOKEN}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`Notion page create failed ${res.status}: ${text}`);
  return JSON.parse(text);
}

async function notionUpdatePage(env, pageId, properties) {
  const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: "PATCH",
    headers: {
      "Authorization": `Bearer ${env.NOTION_TOKEN}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ properties }),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`Notion page update failed ${res.status}: ${text}`);
  return JSON.parse(text);
}

async function notionArchivePage(env, pageId) {
  const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: "PATCH",
    headers: {
      "Authorization": `Bearer ${env.NOTION_TOKEN}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ archived: true }),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`Notion page archive failed ${res.status}: ${text}`);
  return JSON.parse(text);
}

/* =========================
   속성명 설정
========================= */

function scheduleProps(env) {
  return {
    title: env.SCHEDULE_TITLE_PROP || "제목",
    date: env.SCHEDULE_DATE_PROP || "날짜",
    category: env.SCHEDULE_CATEGORY_PROP || "카테고리",
    cancel: env.SCHEDULE_CANCEL_PROP || "취소",
    project: env.SCHEDULE_PROJECT_PROP || "프로젝트",
    memo: env.SCHEDULE_MEMO_PROP || "개인 메모",
  };
}

function projectProps(env) {
  return {
    title: env.PROJECT_TITLE_PROP || "프로젝트 이름",
  };
}

/* =========================
   날짜 처리
========================= */

function makeDateRangeFilter(propertyName, from, to) {
  const filters = [];
  if (from) filters.push({ property: propertyName, date: { on_or_after: from } });
  if (to) filters.push({ property: propertyName, date: { on_or_before: to } });
  if (!filters.length) return null;
  if (filters.length === 1) return filters[0];
  return { and: filters };
}

function readDateRange(props, propName) {
  const prop = props?.[propName];
  const start = prop?.date?.start || "";
  const end = prop?.date?.end || "";
  const startInfo = splitNotionDate(start);
  const endInfo = splitNotionDate(end || start);
  return {
    date: startInfo.date,
    time: startInfo.time,
    endDate: endInfo.date,
  };
}

function splitNotionDate(value) {
  if (!value) return { date: "", time: "" };
  if (!value.includes("T")) return { date: value, time: "" };
  return { date: value.slice(0, 10), time: value.slice(11, 16) };
}

function notionDatePayload(body) {
  const start = body.time ? `${body.date}T${body.time}:00+09:00` : body.date;
  const end = body.endDate
    ? (body.time ? `${body.endDate}T23:59:00+09:00` : body.endDate)
    : undefined;
  return end ? { start, end } : { start };
}

function toDate(dateText) {
  if (!dateText) return null;
  const d = new Date(`${dateText}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function dateKey(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function expandDateRange(item, from, to) {
  if (!item.date) return [];
  const start = toDate(item.date);
  const end = toDate(item.endDate || item.date);
  if (!start || !end) return [];
  const fromDate = from ? toDate(from) : null;
  const toDateObj = to ? toDate(to) : null;
  const result = [];
  const maxDays = 370;
  let count = 0;
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    count += 1;
    if (count > maxDays) break;
    if (fromDate && d < fromDate) continue;
    if (toDateObj && d > toDateObj) continue;
    const currentKey = dateKey(d);
    result.push({
      ...item,
      date: currentKey,
      occurrenceKey: `${item.id}_${currentKey}`,
    });
  }
  return result;
}

function uniqueByOccurrence(items) {
  const seen = new Set();
  return items.filter(item => {
    const k = item.occurrenceKey || `${item.id}_${item.date}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/* =========================
   속성 읽기 헬퍼
========================= */

function readTitle(props, propName) {
  const prop = props?.[propName];
  if (prop?.title) return prop.title.map(t => t.plain_text).join("").trim();
  for (const value of Object.values(props || {})) {
    if (value?.type === "title") return value.title.map(t => t.plain_text).join("").trim();
  }
  return "";
}

function readCheckbox(props, propName) {
  const prop = props?.[propName];
  if (!prop || prop.type !== "checkbox") return false;
  return Boolean(prop.checkbox);
}

function readSelect(props, propName) {
  const prop = props?.[propName];
  if (!prop) return "";
  if (prop.type === "select") return prop.select?.name || "";
  if (prop.type === "multi_select") return (prop.multi_select || []).map(x => x.name).join(", ");
  return "";
}

function readMultiSelect(props, propName) {
  return (props?.[propName]?.multi_select || []).map(x => x.name);
}

function readRelationIds(props, propName) {
  return (props?.[propName]?.relation || []).map(x => x.id);
}

function relationValue(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean).map(id => ({ id }));
  return [{ id: value }];
}

/* =========================
   프로젝트 DB
========================= */

async function getProjects(env) {
  if (!env.NOTION_PROJECT_DB) return [];
  const p = projectProps(env);
  const notionData = await notionQuery(env, env.NOTION_PROJECT_DB, {
    sorts: [{ property: p.title, direction: "ascending" }],
  });
  return notionData.results.map(page => ({
    id: page.id,
    title: readTitle(page.properties || {}, p.title) || "이름 없음",
  }));
}

/* =========================
   일정 DB
========================= */

async function getSchedules(request, env) {
  const url = new URL(request.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const includeCanceled = url.searchParams.get("includeCanceled") === "true";
  const p = scheduleProps(env);

  const filter = makeDateRangeFilter(p.date, from, to);
  const body = { sorts: [{ property: p.date, direction: "ascending" }] };
  if (filter) body.filter = filter;

  const notionData = await notionQuery(env, env.NOTION_SCHEDULE_DB, body);

  const items = notionData.results
    .map(page => {
      const props = page.properties || {};
      const dateInfo = readDateRange(props, p.date);
      const canceled = readCheckbox(props, p.cancel);
      return {
        id: page.id,
        url: page.url,
        title: readTitle(props, p.title) || "제목 없음",
        date: dateInfo.date,
        time: dateInfo.time,
        endDate: dateInfo.endDate,
        category: readSelect(props, p.category),
        canceled,
        memoTags: readMultiSelect(props, p.memo),
        projectIds: readRelationIds(props, p.project),
      };
    })
    .filter(item => includeCanceled || !item.canceled);

  return uniqueByOccurrence(items.flatMap(item => expandDateRange(item, from, to)));
}

async function createSchedule(request, env) {
  const body = await request.json();
  const p = scheduleProps(env);

  if (!body.title) throw new Error("title is required");
  if (!body.date) throw new Error("date is required");

  const properties = {
    [p.title]: { title: [{ text: { content: body.title } }] },
    [p.date]: { date: notionDatePayload(body) },
  };

  if (body.category) properties[p.category] = { select: { name: body.category } };

  const projectIds = relationValue(body.projectPageIds || body.projectPageId);
  if (projectIds.length) properties[p.project] = { relation: projectIds };

  if (Array.isArray(body.memoTags) && body.memoTags.length) {
    properties[p.memo] = { multi_select: body.memoTags.map(name => ({ name })) };
  }

  return notionCreatePage(env, env.NOTION_SCHEDULE_DB, properties);
}

async function updateSchedule(request, env) {
  const body = await request.json();
  const p = scheduleProps(env);

  if (!body.id) throw new Error("schedule page id is required");

  const properties = {};

  if (body.title !== undefined) {
    properties[p.title] = { title: [{ text: { content: body.title || "제목 없음" } }] };
  }
  if (body.date) properties[p.date] = { date: notionDatePayload(body) };
  if (body.category !== undefined) {
    properties[p.category] = body.category ? { select: { name: body.category } } : { select: null };
  }
  if (body.memoTags !== undefined) {
    properties[p.memo] = {
      multi_select: Array.isArray(body.memoTags)
        ? body.memoTags.filter(Boolean).map(name => ({ name }))
        : [],
    };
  }
  if (body.projectPageIds !== undefined || body.projectPageId !== undefined) {
    properties[p.project] = { relation: relationValue(body.projectPageIds || body.projectPageId) };
  }

  return notionUpdatePage(env, body.id, properties);
}

async function deleteSchedule(request, env) {
  const body = await request.json();
  if (!body.id) throw new Error("schedule page id is required");
  return notionArchivePage(env, body.id);
}

/* =========================
   가계부 D1
========================= */

async function initMoneyTable(env) {
  await env.NYONG_MONEY_DB.exec(`
    CREATE TABLE IF NOT EXISTS money_records (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      amount REAL NOT NULL,
      date TEXT NOT NULL,
      category TEXT DEFAULT '',
      memo TEXT DEFAULT '',
      payment TEXT DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_money_date ON money_records(date);
  `);
}

async function getMoneyRecords(request, env) {
  const url = new URL(request.url);
  const month = url.searchParams.get("month") || "";
  const fallback = new Date();
  const raw = month || `${fallback.getFullYear()}-${String(fallback.getMonth() + 1).padStart(2, "0")}`;
  const [y, m] = raw.split("-").map(Number);
  const from = `${y}-${String(m).padStart(2, "0")}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const to = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

  const result = await env.NYONG_MONEY_DB.prepare(
    "SELECT * FROM money_records WHERE date >= ?1 AND date <= ?2 ORDER BY date ASC, created_at ASC"
  ).bind(from, to).all();

  return result.results || [];
}

async function createMoneyRecord(request, env) {
  const body = await request.json();

  if (!body.type) throw new Error("type is required");
  if (!body.title) throw new Error("title is required");
  if (body.amount === undefined) throw new Error("amount is required");
  if (!body.date) throw new Error("date is required");

  const id = crypto.randomUUID();
  const created_at = new Date().toISOString();

  await env.NYONG_MONEY_DB.prepare(
    `INSERT INTO money_records (id, type, title, amount, date, category, memo, payment, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`
  ).bind(
    id,
    body.type,
    body.title,
    Number(body.amount),
    body.date,
    body.category || "",
    body.memo || "",
    body.payment || "",
    created_at
  ).run();

  return id;
}

async function updateMoneyRecord(id, request, env) {
  const body = await request.json();

  const setClauses = [];
  const values = [];
  let idx = 1;

  if (body.type !== undefined) { setClauses.push(`type = ?${idx++}`); values.push(body.type); }
  if (body.title !== undefined) { setClauses.push(`title = ?${idx++}`); values.push(body.title); }
  if (body.amount !== undefined) { setClauses.push(`amount = ?${idx++}`); values.push(Number(body.amount)); }
  if (body.date !== undefined) { setClauses.push(`date = ?${idx++}`); values.push(body.date); }
  if (body.category !== undefined) { setClauses.push(`category = ?${idx++}`); values.push(body.category); }
  if (body.memo !== undefined) { setClauses.push(`memo = ?${idx++}`); values.push(body.memo); }
  if (body.payment !== undefined) { setClauses.push(`payment = ?${idx++}`); values.push(body.payment); }

  if (!setClauses.length) return;

  values.push(id);
  const sql = `UPDATE money_records SET ${setClauses.join(", ")} WHERE id = ?${idx}`;

  await env.NYONG_MONEY_DB.prepare(sql).bind(...values).run();
}

async function deleteMoneyRecord(id, env) {
  await env.NYONG_MONEY_DB.prepare("DELETE FROM money_records WHERE id = ?1").bind(id).run();
}

/*
wrangler.toml 예시:
name = "nyong-log"
main = "worker.js"
compatibility_date = "2024-01-01"

[vars]
SECRET_KEY = "your-secret-key"
NOTION_TOKEN = "secret_xxx"
NOTION_SCHEDULE_DB = "32자리-db-id"
NOTION_PROJECT_DB = "32자리-db-id"

[[d1_databases]]
binding = "NYONG_MONEY_DB"
database_name = "nyong-money"
database_id = "your-d1-database-id"
*/
