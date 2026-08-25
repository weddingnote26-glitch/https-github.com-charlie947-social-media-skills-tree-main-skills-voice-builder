import { describe, it, expect } from "vitest";
import { useTempDb } from "./helpers";
useTempDb("restaurant-dedupe");
import { db } from "../src/lib/db";
import {
  normalizeName, editDistance, looksSimilar, findByName,
  similarRestaurants, searchRestaurants, saveManualRestaurant,
} from "../src/lib/restaurants";

/**
 * 실제로 겪은 일: 맛집 DB 에 같은 가게가 6개 쌓였다.
 * 이름과 지역이 "글자까지 똑같을 때만" 같은 가게로 봤기 때문이다.
 */
describe("이름 다듬기", () => {
  it("공백·기호·대소문자를 무시한다", () => {
    expect(normalizeName("신림동 막불감동")).toBe(normalizeName(" 신림동  막불감동 "));
    expect(normalizeName("Oraki·Food")).toBe(normalizeName("orakifood"));
  });
  it("글자 차이를 센다", () => {
    expect(editDistance("가나다", "가나다")).toBe(0);
    expect(editDistance("신림막불감동", "신림동막불감동")).toBe(1);
    expect(editDistance("", "가나")).toBe(2);
  });
});

describe("같은 가게 찾기", () => {
  it("지역이 달라도 이름이 같으면 같은 가게로 본다", () => {
    const a = saveManualRestaurant({ name: "신림동 막불감동", area: "관악구" });
    // 지역만 다르게 다시 조사된 상황
    expect(findByName("신림동 막불감동")!.id).toBe(a.id);
    expect(findByName(" 신림동  막불감동 ")!.id).toBe(a.id);
    expect(findByName("없는가게")).toBeNull();
  });

  it("한두 글자 차이는 자동으로 합치지 않고 후보로만 알려 준다", () => {
    const a = saveManualRestaurant({ name: "신림동 막불감동", area: "관악구" });
    // 자동 합치기 금지 — 진짜 다른 가게일 수 있다
    expect(findByName("신림 막불감동")).toBeNull();
    // 대신 후보로는 잡힌다
    const near = similarRestaurants("신림 막불감동");
    expect(near.map((n) => n.id)).toContain(a.id);
  });

  it("전혀 다른 이름은 후보로도 잡지 않는다", () => {
    saveManualRestaurant({ name: "신림동 막불감동", area: "관악구" });
    expect(similarRestaurants("낙성대 순대국")).toEqual([]);
    expect(looksSimilar("가나", "다라")).toBe(false);   // 너무 짧으면 비교하지 않는다
  });
});

describe("같은 가게를 다시 조사해도 새로 쌓이지 않는다", () => {
  it("지역만 바뀌어 다시 저장해도 한 곳이다", () => {
    const first = saveManualRestaurant({ name: "재조사 만두집", area: "관악구" });
    const found = findByName("재조사 만두집")!;
    saveManualRestaurant({ id: found.id, area: "신림" });
    const rows = db().prepare("SELECT COUNT(*) AS c FROM restaurants WHERE name='재조사 만두집'").get() as { c: number };
    expect(rows.c).toBe(1);
    expect(findByName("재조사 만두집")!.id).toBe(first.id);
  });
});

describe("맛집 DB 검색", () => {
  it("업체명·주소·전화번호로 찾는다", () => {
    saveManualRestaurant({ name: "검색 만두집", area: "신림", address: "관악구 신림로 1", phone: "02-111-2222" });
    expect(searchRestaurants("검색 만두").map((r) => r.name)).toContain("검색 만두집");
    expect(searchRestaurants("신림로").map((r) => r.name)).toContain("검색 만두집");
    expect(searchRestaurants("021112222").map((r) => r.name)).toContain("검색 만두집");
    expect(searchRestaurants("있을리없는말")).toEqual([]);
  });

  it("검색어가 없으면 최근 등록 순으로 준다", () => {
    const all = searchRestaurants("");
    expect(all.length).toBeGreaterThan(0);
    expect(all[0]).toHaveProperty("confirmed");
    expect(all[0]).toHaveProperty("menuSummary");
  });
});
