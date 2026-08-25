import type { ReelScript, RestaurantInfo, FactCheckItem } from "../schema";

/**
 * §26 AI 팩트체크 — 가장 중요한 기능.
 * 매장명/주소/메뉴/가격/영업시간/휴무/주차/예약을 검사하고
 * 확인할 수 없는 정보에 ⚠ 확인 필요 표시.
 * 확인되지 않은 가격·영업시간이 대본에 사실처럼 들어가면 blocked=true.
 */
export function runFactCheck(script: ReelScript, info: RestaurantInfo): {
  items: FactCheckItem[]; blocked: boolean; blockReasons: string[];
} {
  const st = info.field_status;
  /**
   * 사람이 직접 넣은 값은 확인된 값으로 본다.
   * 자동 수집이 실패해도 사장님이 매장에서 보고 적으면 그게 가장 정확한 출처다.
   */
  const ok = (k: string) => st[k] === "확인" || st[k] === "사용자 입력";
  const items: FactCheckItem[] = [
    { field: "매장명", value: info.name, status: st["name"] ?? "미확인", source: info.source_url || "입력 정보" },
    { field: "주소", value: info.address || "-", status: st["address"] ?? "미확인", source: info.source_url },
    { field: "메뉴/가격", value: info.menus.map((m) => `${m.name} ${m.price}`.trim()).join(", ") || "-", status: st["menus"] ?? "미확인", source: info.source_url },
    { field: "영업시간", value: info.hours || "-", status: st["hours"] ?? "미확인", source: info.source_url },
    { field: "휴무", value: info.closed_days || "-", status: st["closed_days"] ?? "미확인", source: info.source_url },
    { field: "주차", value: info.parking || "-", status: st["parking"] ?? "미확인", source: info.source_url },
    { field: "예약", value: info.reservation || "-", status: st["reservation"] ?? "미확인", source: info.source_url },
  ];

  const blockReasons: string[] = [];
  const allText = script.scenes.map((s) => s.narration + " " + s.subtitle).join(" ") + " " + script.caption;

  // 미확인 가격이 숫자로 대본에 등장하는지
  if (!ok("menus")) {
    const priceMention = /[0-9][0-9,.]*\s*(원|천\s*원|만\s*원)/.exec(allText);
    if (priceMention) blockReasons.push(`가격이 미확인인데 대본에 "${priceMention[0]}"이 들어 있습니다.`);
  }
  // 미확인 영업시간
  if (!ok("hours") && /(오전|오후|\d{1,2}시)[^.]{0,10}(영업|엽니다|문|마감|라스트오더)/.test(allText)) {
    blockReasons.push("영업시간이 미확인인데 대본에 시간 정보가 들어 있습니다.");
  }
  // 과장 건강 효능 (§11)
  const health = /(다이어트에 좋|건강에 좋|면역|피부에 좋|항암|혈압을 낮)/.exec(allText);
  if (health) blockReasons.push(`검증할 수 없는 효능 표현: "${health[0]}"`);

  // 장면별 fact_source 비어있으면 미확인 처리
  for (const s of script.scenes) {
    if (!s.fact_source) s.fact_source = "미확인";
  }

  return { items, blocked: blockReasons.length > 0, blockReasons };
}
