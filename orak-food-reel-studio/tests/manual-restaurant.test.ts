import { describe, it, expect } from "vitest";
import { useTempDb } from "./helpers";
useTempDb("manual-restaurant");
import { db, j } from "../src/lib/db";
import {
  parseMenuLines, menuLines, saveManualRestaurant, readRestaurant,
  recheckReelsOfRestaurant, restaurantForm,
} from "../src/lib/restaurants";
import { runFactCheck } from "../src/lib/pipeline/factcheck";
import { RestaurantInfoSchema, ReelScriptSchema, type ReelScript } from "../src/lib/schema";
import { getReel } from "../src/lib/reels";

/** 대본 한 편 — 가격과 영업시간이 말로 들어 있다. 실제 스키마로 검증해 둔다. */
function script(): ReelScript {
  const lines = [
    ["왕만두 한 접시가 6,000원", "6,000원", "매장 메뉴판"],
    ["매일 오전 10시에 문을 엽니다", "10시 영업", "매장 확인"],
    ["줄이 길어도 금방 빠집니다", "회전 빠름", "방문 확인"],
    ["자리는 스무 석 정도", "20석", "방문 확인"],
    ["신림역에서 걸어서 5분", "도보 5분", "지도 확인"],
  ];
  return ReelScriptSchema.parse({
    title: "신림 왕만두",
    restaurant: "신림 왕만두",
    target: "관악구 40~70대",
    hook: "여기 만두 6,000원이라고요?",
    duration: 20,
    content_mode: "NORMAL_FOOD",
    content_type: "가성비 맛집",
    scenes: lines.map(([narration, subtitle, fact_source], i) => ({
      scene: i + 1, start: i * 4, end: (i + 1) * 4,
      narration, subtitle, visual_prompt: "만두", camera_motion: "static",
      character_presence: "none", fact_source,
    })),
    caption: "신림 왕만두",
    cta: "저장해 두고 가보세요",
    hashtags: ["#신림맛집", "#관악구맛집", "#만두"],
    fact_check: [],
    quality_score: 0,
  });
}

describe("메뉴 줄 읽기 — 사람이 적는 대로 받아 준다", () => {
  it("여러 가지 적는 방식을 모두 나눈다", () => {
    const got = parseMenuLines([
      "왕만두 6,000원",
      "김치만두 | 6500",
      "고기만두, 7000",
      "특 만두전골 - 25,000원",
      "오늘의 메뉴",
      "   ",
    ].join("\n"));
    expect(got).toEqual([
      { name: "왕만두", price: "6,000원", verified: true },
      { name: "김치만두", price: "6500", verified: true },
      { name: "고기만두", price: "7000", verified: true },
      { name: "특 만두전골", price: "25,000원", verified: true },
      { name: "오늘의 메뉴", price: "", verified: false },
    ]);
  });

  it("천 단위 쉼표를 가격 구분자로 착각하지 않는다", () => {
    // 실제로 겪은 일: "왕만두 6,000원" 이 이름 "왕만두 6" + 가격 "000원" 으로 잘렸다
    expect(parseMenuLines("왕만두 6,000원")[0]).toEqual({ name: "왕만두", price: "6,000원", verified: true });
    expect(parseMenuLines("만두국 12,000")[0]).toEqual({ name: "만두국", price: "12,000", verified: true });
  });

  it("수량이 붙은 이름과 가격 범위도 나눈다", () => {
    expect(parseMenuLines("왕만두 12개 6,000원")[0]).toEqual({ name: "왕만두 12개", price: "6,000원", verified: true });
    expect(parseMenuLines("코스 6,000~8,000원")[0]).toEqual({ name: "코스", price: "6,000~8,000원", verified: true });
  });

  it("저장했다 다시 열어도 고치던 글이 살아 있다", () => {
    const text = "왕만두 | 6,000원\n김치만두 | 6,500원";
    expect(menuLines(parseMenuLines(text))).toBe(text);
  });
});

describe("§6 업체 정보 직접 입력", () => {
  it("적어 넣은 항목만 '사용자 입력' 으로 표시된다", () => {
    const { id, form, marked } = saveManualRestaurant({
      name: "신림 왕만두", address: "서울 관악구 신림로 1", menus_text: "왕만두 6,000원",
      hours: "", parking: "가게 앞 2대",
    });
    expect(form.field_status.name).toBe("사용자 입력");
    expect(form.field_status.address).toBe("사용자 입력");
    expect(form.field_status.menus).toBe("사용자 입력");
    expect(form.field_status.parking).toBe("사용자 입력");
    // 빈 칸은 저장은 되지만 확인 필요로 남는다
    expect(form.field_status.hours).toBe("미확인");
    expect(marked).not.toContain("hours");
    expect(readRestaurant(id)!.menus[0]).toEqual({ name: "왕만두", price: "6,000원", verified: true });
  });

  it("폼이 보내지 않은 항목은 건드리지 않는다", () => {
    const { id } = saveManualRestaurant({ name: "덮어쓰기 시험", address: "옛 주소", phone: "02-000-0000" });
    saveManualRestaurant({ id, address: "새 주소" });
    const after = readRestaurant(id)!;
    expect(after.address).toBe("새 주소");
    expect(after.phone).toBe("02-000-0000");           // 보내지 않은 값은 그대로
    expect(after.field_status.phone).toBe("사용자 입력");
  });

  it("이미 확인된 항목을 비우면 다시 '확인 필요' 가 된다", () => {
    const { id } = saveManualRestaurant({ name: "비우기 시험", hours: "10:00~21:00" });
    db().prepare("UPDATE restaurants SET field_status_json=? WHERE id=?")
      .run(JSON.stringify({ hours: "확인" }), id);
    const { form } = saveManualRestaurant({ id, hours: "" });
    expect(form.hours).toBe("");
    expect(form.field_status.hours).toBe("미확인");     // 빈 값이 확인됨으로 남으면 안 된다
  });

  it("매장명은 비울 수 없고, 없는 업체는 고칠 수 없다", () => {
    const { id } = saveManualRestaurant({ name: "이름 시험" });
    expect(() => saveManualRestaurant({ id, name: "  " })).toThrow(/매장명/);
    expect(() => saveManualRestaurant({ id: "rest_없음", name: "가" })).toThrow(/찾을 수 없/);
    expect(() => saveManualRestaurant({ address: "이름 없이 등록" })).toThrow(/매장명/);
  });
});

describe("§26 팩트체크 — 직접 입력한 값은 확인된 값으로 본다", () => {
  it("미확인이면 대본의 가격·시간이 발행을 막는다", () => {
    const info = RestaurantInfoSchema.parse({ name: "신림 왕만두" });
    const fact = runFactCheck(script(), info);
    expect(fact.blocked).toBe(true);
    expect(fact.blockReasons.join(" ")).toContain("6,000원");
    expect(fact.blockReasons.join(" ")).toContain("영업시간");
  });

  it("사람이 적어 넣으면 막힘이 풀린다", () => {
    const info = RestaurantInfoSchema.parse({
      name: "신림 왕만두",
      field_status: { menus: "사용자 입력", hours: "사용자 입력" },
    });
    const fact = runFactCheck(script(), info);
    expect(fact.blocked).toBe(false);
    expect(fact.blockReasons).toEqual([]);
  });

  it("직접 입력 항목은 '미확인' 으로 표시하지 않는다", () => {
    const info = RestaurantInfoSchema.parse({
      name: "신림 왕만두", hours: "10:00~21:00", field_status: { hours: "사용자 입력" },
    });
    const item = runFactCheck(script(), info).items.find((i) => i.field === "영업시간")!;
    expect(item.status).toBe("사용자 입력");
  });
});

describe("업체 정보를 고치면 그 업체의 릴스를 다시 검사한다", () => {
  it("막혀 있던 팩트체크가 저장과 동시에 풀린다", () => {
    const { id: restId } = saveManualRestaurant({ name: "재검사 왕만두" });
    db().prepare(`INSERT INTO reels (id, restaurant_id, title, status, script_json, factcheck_json, quality_json)
      VALUES (?,?,?,?,?,?,?)`)
      .run("reel_recheck", restId, "재검사", "검수", JSON.stringify(script()), "[]",
        JSON.stringify({ total: 80, fact_blocked: true, fact_block_reasons: ["가격 미확인"] }));

    // 아직 아무것도 확인되지 않았으니 그대로 막혀 있다
    let out = recheckReelsOfRestaurant(restId);
    expect(out).toHaveLength(1);
    expect(out[0].blocked).toBe(true);

    // 사장님이 메뉴와 영업시간을 적어 넣는다
    saveManualRestaurant({ id: restId, menus_text: "왕만두 6,000원", hours: "매일 10:00~21:00" });
    out = recheckReelsOfRestaurant(restId);
    expect(out[0].blocked).toBe(false);

    const reel = getReel("reel_recheck")!;
    const q = j<{ fact_blocked?: boolean; total?: number }>(reel.quality_json, {});
    expect(q.fact_blocked).toBe(false);
    expect(q.total).toBe(80);                          // 다른 품질 점수는 건드리지 않는다
    const items = j<Array<{ field: string; status: string }>>(reel.factcheck_json, []);
    expect(items.find((i) => i.field === "영업시간")!.status).toBe("사용자 입력");
  });
});

describe("릴스 화면이 쓰는 폼 값", () => {
  it("연결된 업체가 없으면 null 을 준다", () => {
    expect(restaurantForm(null)).toBeNull();
    expect(restaurantForm("rest_없음")).toBeNull();
  });
  it("저장된 업체는 폼 그대로 돌려준다", () => {
    const { id } = saveManualRestaurant({ name: "폼 시험", menus_text: "왕만두 6,000원" });
    const form = restaurantForm(id)!;
    expect(form.name).toBe("폼 시험");
    expect(form.menus_text).toBe("왕만두 | 6,000원");
  });
});
