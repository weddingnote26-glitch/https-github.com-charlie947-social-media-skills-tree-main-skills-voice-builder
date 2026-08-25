import { getLLM, extractJson } from "./providers/llm";
import { isSampleMode, resolveSecret } from "./secrets";
import { logWarn } from "./log";

/**
 * §9 식당 URL 자동 분석.
 *
 * 공개 페이지에서 "적혀 있는 것만" 꺼낸다. 없는 값은 지어내지 않고 비워 둔다.
 * 로그인·캡차·접근 제한은 우회하지 않는다 — 막히면 "직접 입력해 주세요" 로 끝낸다.
 */

export interface AnalyzedField {
  value: string;
  /** 어디서 온 값인가 — 화면에 그대로 보여 준다 */
  source: string;
}
export interface UrlAnalysis {
  url: string;
  fields: Partial<Record<
    "name" | "area" | "address" | "phone" | "map_url" | "menus_text" | "hours" | "closed_days" | "parking" | "reservation",
    AnalyzedField
  >>;
  notice: string | null;
}

/* ── 1) 주소 안전 검사 (SSRF 방지) ─────────────────────────
   서버가 대신 접속하는 구조라, 내부 주소를 넣으면 내부망을 찔러 볼 수 있다.
   이름만 보고 막는다 — 사설 IP · 루프백 · 링크로컬 · 메타데이터 주소. */
const PRIVATE_HOST = new RegExp(
  "^(localhost|.*\\.local|.*\\.internal|0\\.0\\.0\\.0|127\\.\\d+\\.\\d+\\.\\d+|10\\.\\d+\\.\\d+\\.\\d+|192\\.168\\.\\d+\\.\\d+|172\\.(1[6-9]|2\\d|3[01])\\.\\d+\\.\\d+|169\\.254\\.\\d+\\.\\d+|\\[?::1\\]?|\\[?fe80:.*|\\[?fc00:.*|\\[?fd[0-9a-f]{2}:.*)$",
  "i",
);

export function guardUrl(raw: string): URL {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { throw new Error("주소 모양이 아닙니다. https:// 로 시작하는 전체 주소를 넣어 주세요."); }
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    throw new Error(`${u.protocol} 주소는 읽을 수 없습니다. https:// 주소를 넣어 주세요.`);
  }
  const allowPrivate = process.env.ORAK_ALLOW_PRIVATE_URL === "1"; // 자동 시험 전용
  if (!allowPrivate && PRIVATE_HOST.test(u.hostname)) {
    throw new Error("내부망 주소는 분석할 수 없습니다. 인터넷에 공개된 식당 페이지 주소를 넣어 주세요.");
  }
  return u;
}

const MAX_BYTES = 700 * 1024;   // 페이지 하나면 충분하다 — 통째로 빨아들이지 않는다
const MAX_REDIRECTS = 3;

/** 크기·시간·리다이렉트를 제한해 한 페이지만 읽는다 */
export async function fetchLimited(rawUrl: string): Promise<{ finalUrl: string; html: string; truncated: boolean }> {
  let url = guardUrl(rawUrl).toString();
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetch(url, {
      redirect: "manual",
      headers: { "user-agent": "Mozilla/5.0 (compatible; OrakFoodStudio/1.0)", accept: "text/html,application/xhtml+xml" },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) throw new Error(`페이지가 이동했는데 새 주소가 없습니다 (${res.status}).`);
      // 옮겨 간 주소도 매번 다시 검사한다 — 공개 주소가 내부망으로 튕길 수 있다
      url = guardUrl(new URL(loc, url).toString()).toString();
      continue;
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error("로그인이 필요하거나 접근이 제한된 페이지입니다. 우회하지 않습니다 — 정보를 직접 입력해 주세요.");
    }
    if (!res.ok) throw new Error(`페이지를 열지 못했습니다 (응답 ${res.status}).`);
    const ct = (res.headers.get("content-type") ?? "").toLowerCase();
    if (!ct.includes("html") && !ct.includes("json") && !ct.includes("text/")) {
      throw new Error(`글 페이지가 아닙니다 (${ct.split(";")[0] || "형식 미상"}). 식당 소개 페이지 주소를 넣어 주세요.`);
    }
    // 본문을 상한까지만 읽는다
    const reader = res.body?.getReader();
    if (!reader) return { finalUrl: url, html: await res.text(), truncated: false };
    const chunks: Uint8Array[] = [];
    let size = 0, truncated = false;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      chunks.push(value);
      if (size >= MAX_BYTES) { truncated = true; void reader.cancel().catch(() => {}); break; }
    }
    const buf = new Uint8Array(size > MAX_BYTES ? MAX_BYTES : size);
    let off = 0;
    for (const c of chunks) { const n = Math.min(c.byteLength, buf.length - off); buf.set(c.subarray(0, n), off); off += n; if (off >= buf.length) break; }
    return { finalUrl: url, html: new TextDecoder("utf-8").decode(buf), truncated };
  }
  throw new Error("페이지 이동이 너무 많습니다. 최종 페이지 주소를 직접 넣어 주세요.");
}

/* ── 2) 구조화 데이터 추출 — 짐작이 아니라 페이지가 선언한 값 ── */

interface JsonLdPlace {
  "@type"?: string | string[];
  name?: string;
  telephone?: string;
  address?: string | { streetAddress?: string; addressLocality?: string; addressRegion?: string };
  openingHours?: string | string[];
  openingHoursSpecification?: Array<{ dayOfWeek?: string | string[]; opens?: string; closes?: string }>;
  hasMenu?: unknown;
  url?: string;
}

const PLACE_TYPES = /restaurant|localbusiness|foodestablishment|cafeorcoffeeshop|bakery|barorpub/i;

function pickPlaces(html: string): JsonLdPlace[] {
  const out: JsonLdPlace[] = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      const parsed = JSON.parse(m[1].trim()) as unknown;
      const list = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of list) {
        const node = item as JsonLdPlace & { "@graph"?: JsonLdPlace[] };
        const cands = node["@graph"] ? node["@graph"] : [node];
        for (const c of cands) {
          const t = Array.isArray(c["@type"]) ? c["@type"].join(",") : c["@type"] ?? "";
          if (PLACE_TYPES.test(String(t))) out.push(c);
        }
      }
    } catch { /* 깨진 JSON-LD 는 조용히 넘어간다 */ }
  }
  return out;
}

function metaOf(html: string, prop: string): string {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`, "i");
  const alt = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`, "i");
  return (re.exec(html)?.[1] ?? alt.exec(html)?.[1] ?? "").trim();
}

export function extractStructured(html: string): UrlAnalysis["fields"] {
  const fields: UrlAnalysis["fields"] = {};
  const put = (k: keyof UrlAnalysis["fields"], value: string, source: string) => {
    const v = value.trim();
    if (v && !fields[k]) fields[k] = { value: v, source };
  };

  for (const p of pickPlaces(html)) {
    if (p.name) put("name", String(p.name), "페이지 구조화 데이터(JSON-LD)");
    if (p.telephone) put("phone", String(p.telephone), "페이지 구조화 데이터(JSON-LD)");
    if (p.address) {
      const a = typeof p.address === "string"
        ? p.address
        : [p.address.addressRegion, p.address.addressLocality, p.address.streetAddress].filter(Boolean).join(" ");
      put("address", a, "페이지 구조화 데이터(JSON-LD)");
    }
    if (p.openingHours) {
      put("hours", Array.isArray(p.openingHours) ? p.openingHours.join(", ") : String(p.openingHours), "페이지 구조화 데이터(JSON-LD)");
    } else if (p.openingHoursSpecification?.length) {
      const lines = p.openingHoursSpecification
        .map((s) => {
          const days = Array.isArray(s.dayOfWeek) ? s.dayOfWeek.join("·") : s.dayOfWeek ?? "";
          return [String(days).replace(/https?:\/\/schema\.org\//g, ""), s.opens && s.closes ? `${s.opens}~${s.closes}` : ""].filter(Boolean).join(" ");
        })
        .filter(Boolean);
      if (lines.length) put("hours", lines.join(", "), "페이지 구조화 데이터(JSON-LD)");
    }
  }

  // OpenGraph — 이름 보조. 설명글은 사실이 아니라 소개 문구라 값으로 넣지 않는다.
  put("name", metaOf(html, "og:site_name") || metaOf(html, "og:title"), "페이지 정보(OpenGraph)");
  if (!fields.name) {
    const t = /<title[^>]*>([^<]+)<\/title>/i.exec(html)?.[1] ?? "";
    put("name", t.split(/[|\-–:]/)[0] ?? "", "페이지 제목");
  }
  return fields;
}

/** 태그를 걷어낸 본문 — LLM 에게 줄 재료 */
export function visibleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* ── 3) 전체 흐름 ────────────────────────────────────────── */

export async function analyzeRestaurantUrl(rawUrl: string): Promise<UrlAnalysis> {
  const { finalUrl, html, truncated } = await fetchLimited(rawUrl);
  const fields = extractStructured(html);
  let notice: string | null = truncated ? "페이지가 길어 앞부분만 읽었습니다." : null;

  // LLM 정리 — 구조화 데이터가 못 채운 칸만, 본문에 적힌 값으로.
  // 키가 없거나 Sample 모드면 건너뛴다 (구조화 데이터만으로도 동작해야 한다).
  if (!isSampleMode() && resolveSecret("ANTHROPIC_API_KEY")) {
    try {
      const llm = getLLM();
      const raw = await llm.complete({
        task: "research",
        system:
          "너는 식당 공개 페이지에서 정보를 옮겨 적는 조사원이다. 본문에 글자로 적혀 있는 값만 옮긴다. " +
          "없는 값은 빈 문자열로 둔다. 주소·가격·영업시간을 절대 추측하지 않는다. " +
          "리뷰나 광고 문구(맛집·최고·원조·1위 등)는 값이 아니다.",
        user:
          `아래 본문에서 다음 JSON 형식으로만 답하라.\n` +
          `{"name":"","address":"","phone":"","hours":"","closed_days":"","parking":"","reservation":"","menus_text":""}\n` +
          `menus_text 는 "메뉴이름 가격" 을 줄바꿈(\\n)으로 나눈 글이다. 본문에 가격이 없으면 이름만 적는다.\n본문:\n` +
          visibleText(html).slice(0, 9000),
        context: {},
      });
      const parsed = JSON.parse(extractJson(raw)) as Record<string, string>;
      for (const k of ["name", "address", "phone", "hours", "closed_days", "parking", "reservation", "menus_text"] as const) {
        const v = (parsed[k] ?? "").trim();
        if (v && !fields[k]) fields[k] = { value: v, source: "본문에서 AI 정리 — 확인 필요" };
      }
    } catch (e) {
      logWarn("analyze", `LLM 정리 건너뜀: ${e instanceof Error ? e.message : e}`);
      notice = [notice, "AI 정리는 건너뛰었습니다 — 페이지가 선언한 값만 채웠습니다."].filter(Boolean).join(" ");
    }
  } else {
    notice = [notice, "AI 정리 없이 페이지가 선언한 값만 채웠습니다. (Claude 키가 없거나 Sample 모드)"].filter(Boolean).join(" ") || null;
  }

  fields.map_url = fields.map_url ?? undefined;
  return { url: finalUrl, fields, notice };
}
