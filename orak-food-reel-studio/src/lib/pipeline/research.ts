import { RestaurantInfoSchema, type RestaurantInfo } from "../schema";
import { getEnv } from "../env";
import { getLLM, extractJson } from "../providers/llm";
import { logWarn } from "../log";

/**
 * §5~6 맛집 정보 입력 — 이름 직접 입력 또는 URL.
 * 합법적으로 접근 가능한 공개 페이지만 참고. 차단되면 "정보를 직접 입력해주세요" 안내.
 * 확인되지 않은 정보는 만들지 않고 "미확인"으로 표시.
 */
export interface ResearchInput {
  name?: string;
  url?: string;
  area?: string;
  manual?: Partial<RestaurantInfo>;
}

export async function researchRestaurant(input: ResearchInput): Promise<{ info: RestaurantInfo; notice?: string }> {
  const env = getEnv();
  let notice: string | undefined;
  let pageText = "";

  if (input.url) {
    const fetched = await fetchPublicPage(input.url);
    if (fetched.blocked) {
      notice = "이 주소는 자동으로 읽을 수 없습니다. 맛집 정보를 직접 입력해주세요.";
    } else {
      pageText = fetched.text;
    }
  }

  // 수동 입력이 항상 우선
  const base: Partial<RestaurantInfo> = {
    name: input.manual?.name || input.name || "",
    area: input.manual?.area || input.area || "관악구",
    source_url: input.url ?? "",
    ...input.manual,
  };

  if (env.APP_MODE !== "sample" && env.ANTHROPIC_API_KEY && pageText) {
    try {
      const llm = getLLM();
      const raw = await llm.complete({
        task: "research",
        system: "너는 맛집 정보를 구조화하는 조사원이다. 본문에 명시된 정보만 추출하고, 없는 값은 빈 문자열로 두어라. 절대 추측하지 마라.",
        user: `아래 공개 페이지 본문에서 맛집 정보를 JSON으로 추출하라.
형식: {"name":"","area":"","address":"","phone":"","map_url":"","menus":[{"name":"","price":"","verified":true}],"hours":"","closed_days":"","parking":"","reservation":"","features":[],"review_summary":"","pros":[],"cons":[],"recommended_for":""}
본문에 있는 값만 verified:true. 본문:\n${pageText.slice(0, 12000)}`,
        context: base,
      });
      const parsed = JSON.parse(extractJson(raw)) as Partial<RestaurantInfo>;
      for (const [k, v] of Object.entries(parsed)) {
        const key = k as keyof RestaurantInfo;
        if (v && !(base as Record<string, unknown>)[key]) (base as Record<string, unknown>)[key] = v;
      }
    } catch (e) {
      logWarn("research", `URL 분석 실패 — 입력값만 사용: ${e instanceof Error ? e.message : e}`);
      notice = "주소 분석에 실패했습니다. 입력한 정보만 사용합니다.";
    }
  }

  if (!base.name) throw new Error("맛집 이름이 필요합니다. 맛집명을 입력해주세요.");

  const info = RestaurantInfoSchema.parse(base);
  // §6 각 정보에 확인/미확인 상태 표시
  info.field_status = fieldStatus(info);
  return { info, notice };
}

export function fieldStatus(info: RestaurantInfo): Record<string, "확인" | "미확인"> {
  const st: Record<string, "확인" | "미확인"> = {};
  st["name"] = info.name ? "확인" : "미확인";
  st["address"] = info.address ? "확인" : "미확인";
  st["phone"] = info.phone ? "확인" : "미확인";
  st["hours"] = info.hours ? "확인" : "미확인";
  st["closed_days"] = info.closed_days ? "확인" : "미확인";
  st["parking"] = info.parking ? "확인" : "미확인";
  st["reservation"] = info.reservation ? "확인" : "미확인";
  st["menus"] = info.menus.some((m) => m.verified && m.price) ? "확인" : "미확인";
  return st;
}

async function fetchPublicPage(url: string): Promise<{ text: string; blocked: boolean }> {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return { text: "", blocked: true };
    const res = await fetch(url, {
      redirect: "follow",
      headers: { "user-agent": "Mozilla/5.0 (compatible; OrakFoodStudio/1.0)" },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return { text: "", blocked: true };
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("html") && !ct.includes("json") && !ct.includes("text")) return { text: "", blocked: true };
    const html = await res.text();
    // 로그인 벽/봇 차단 페이지 감지 → 무리하게 크롤링하지 않음 (§5)
    if (/로그인이 필요|captcha|access denied|보안문자/i.test(html)) return { text: "", blocked: true };
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&[a-z]+;/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    return { text, blocked: text.length < 200 };
  } catch {
    return { text: "", blocked: true };
  }
}
