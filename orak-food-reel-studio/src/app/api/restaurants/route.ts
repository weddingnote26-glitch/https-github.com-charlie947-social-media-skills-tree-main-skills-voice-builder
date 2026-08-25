import { handle, ok, fail } from "@/lib/api";
import { db } from "@/lib/db";
import { researchRestaurant } from "@/lib/pipeline/research";
import {
  saveManualRestaurant, recheckReelsOfRestaurant, readRestaurant, toForm,
  searchRestaurants, similarRestaurants,
} from "@/lib/restaurants";
import { z } from "zod";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handle(() => {
    const params = new URL(req.url).searchParams;
    // ?id= 를 주면 수정 폼 한 개만 돌려준다
    const id = params.get("id");
    if (id) {
      const info = readRestaurant(id);
      if (!info) return fail("맛집을 찾을 수 없습니다", 404);
      return ok({
        form: toForm(id, info),
        // 헷갈릴 만큼 이름이 비슷한 업체 — 화면에서 "혹시 이 가게인가요?" 로 쓴다
        similar: similarRestaurants(info.name, id),
      });
    }
    // ?q= 를 주면 [맛집 DB에서 불러오기] 용 목록을 돌려준다
    if (params.has("q") || params.has("list")) {
      return ok({ list: searchRestaurants(params.get("q") ?? "") });
    }
    const trash = params.get("trash") === "1";
    return ok({
      restaurants: db().prepare(
        `SELECT * FROM restaurants WHERE deleted_at IS ${trash ? "NOT NULL" : "NULL"} ORDER BY updated_at DESC LIMIT 200`
      ).all(),
    });
  });
}

/** URL/이름으로 맛집 조사만 미리 실행 (§5~6) */
export async function POST(req: Request) {
  return handle(async () => {
    const body = z.object({ name: z.string().optional(), url: z.string().optional(), area: z.string().optional() })
      .parse(await req.json());
    if (!body.name && !body.url) return fail("맛집명 또는 URL이 필요합니다");
    const { info, notice } = await researchRestaurant(body);
    return ok({ info, notice });
  });
}

/** 수기 입력 폼 값 — 보내지 않은 항목은 건드리지 않는다 */
const ManualSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  area: z.string().optional(),
  source_url: z.string().optional(),
  address: z.string().optional(),
  phone: z.string().optional(),
  map_url: z.string().optional(),
  menus_text: z.string().optional(),
  hours: z.string().optional(),
  closed_days: z.string().optional(),
  parking: z.string().optional(),
  reservation: z.string().optional(),
  review_summary: z.string().optional(),
});

/** §6 업체 정보 직접 입력 — 자동 수집이 막힌 곳은 사람이 적어 넣는다 */
export async function PATCH(req: Request) {
  return handle(async () => {
    const body = ManualSchema.parse(await req.json());
    const { id, form, marked } = saveManualRestaurant(body);
    // 고친 정보로 이 업체의 릴스 팩트체크를 다시 돌린다 (막혀 있던 발행이 풀릴 수 있다)
    const rechecked = recheckReelsOfRestaurant(id);
    return ok({ id, form, marked, rechecked });
  });
}
