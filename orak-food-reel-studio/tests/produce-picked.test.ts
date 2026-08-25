import { describe, it, expect } from "vitest";
import { useTempDb } from "./helpers";
useTempDb("produce-picked");
import { db } from "../src/lib/db";
import { saveManualRestaurant } from "../src/lib/restaurants";
import { restaurantInfoOf } from "../src/lib/pipeline/run";

/**
 * 실제로 겪은 일: 릴스 #014 의 팩트체크가 전부 "확인 필요" 였다.
 * 어제 수기로 채운 업체와 릴스가 연결된 업체가 서로 다른 행이었기 때문이다.
 * 제작할 때 맛집 DB 의 업체를 그대로 고르면 이 문제가 생길 수 없다.
 */
describe("맛집 DB 에서 고른 업체로 제작하면 수기 입력이 그대로 온다", () => {
  it("restaurantInfoOf 가 직접 입력 상태까지 그대로 돌려준다", () => {
    const { id } = saveManualRestaurant({
      name: "연결 시험 만두집", address: "서울 관악구 신림로 1",
      menus_text: "왕만두 6,000원", hours: "매일 10:00~21:00",
    });
    const info = restaurantInfoOf(id);
    expect(info.name).toBe("연결 시험 만두집");
    expect(info.address).toBe("서울 관악구 신림로 1");
    expect(info.menus[0]).toEqual({ name: "왕만두", price: "6,000원", verified: true });
    // 팩트체크가 보는 상태 — 직접 입력이 살아 있어야 한다
    expect(info.field_status.address).toBe("사용자 입력");
    expect(info.field_status.menus).toBe("사용자 입력");
    expect(info.field_status.hours).toBe("사용자 입력");
  });

  it("업체 행이 없으면 조용히 넘어가지 않고 바로 알린다", () => {
    expect(() => restaurantInfoOf("rest_없음")).toThrow(/찾을 수 없습니다/);
  });
});
