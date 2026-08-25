import { describe, it, expect } from "vitest";
import { buildOverlays, PRICE_UNKNOWN, clip } from "../src/lib/pipeline/overlay";
import { buildAss } from "../src/lib/pipeline/subtitles";
import type { Scene, RestaurantInfo } from "../src/lib/schema";

const scene = (n: number, sub: string, extra: Partial<Scene> = {}): Scene => ({
  scene: n, start: (n - 1) * 3, end: n * 3,
  narration: sub, subtitle: sub, visual_prompt: "a korean restaurant",
  camera_motion: "slow_zoom_in", character_presence: "none", fact_source: "",
  ...extra,
});

const SCENES: Scene[] = [
  scene(1, "줄이 계속 생기는 집"),
  scene(2, "대표 메뉴를 살펴봅니다"),
  scene(3, "영업시간을 확인합니다"),
];

const INFO = (over: Partial<RestaurantInfo> = {}): RestaurantInfo => ({
  name: "신림동 만두명가", area: "관악구", address: "서울 관악구 신림로 123",
  phone: "", map_url: "", source_url: "",
  menus: [], hours: "", closed_days: "", parking: "", reservation: "",
  features: [], review_summary: "", pros: [], cons: [], recommended_for: "",
  field_status: {},
  ...over,
});

describe("한글 간판·메뉴판 합성", () => {
  it("첫 장면에 업체명 간판을 올린다", () => {
    const o = buildOverlays(SCENES, INFO());
    const sign = o.find((x) => x.kind === "signboard")!;
    expect(sign.scene).toBe(1);
    expect(sign.title).toBe("신림동 만두명가");
    expect(sign.lines[0]).toBe("만두탐정 오락이의 맛집 조사");
  });

  it("확인된 가격만 화면에 쓴다", () => {
    const o = buildOverlays(SCENES, INFO({
      menus: [{ name: "왕만두", price: "6,000원", verified: true }],
    }));
    const menu = o.find((x) => x.kind === "menu")!;
    expect(menu.lines[0]).toContain("6,000원");
    expect(menu.lines).not.toContain(PRICE_UNKNOWN);
  });

  it("확인 안 된 가격은 절대 쓰지 않고 매장 확인 문구를 넣는다", () => {
    const o = buildOverlays(SCENES, INFO({
      menus: [{ name: "왕만두", price: "6,000원", verified: false }],
    }));
    const menu = o.find((x) => x.kind === "menu")!;
    expect(menu.lines.join(" ")).not.toContain("6,000원");
    expect(menu.lines).toContain(PRICE_UNKNOWN);
  });

  it("가격 칸이 비어 있어도 지어내지 않는다", () => {
    const o = buildOverlays(SCENES, INFO({
      menus: [{ name: "김치만두", price: "", verified: true }],
    }));
    const menu = o.find((x) => x.kind === "menu")!;
    expect(menu.lines[0]).toBe("김치만두");
    expect(menu.lines).toContain(PRICE_UNKNOWN);
  });

  it("확인 안 된 영업시간은 정보판에 올리지 않는다", () => {
    const o = buildOverlays(SCENES, INFO({ hours: "매일 11:00~21:00" }));
    expect(o.find((x) => x.kind === "info")).toBeUndefined();
  });

  it("확인된 영업시간만 정보판에 올린다", () => {
    const o = buildOverlays(SCENES, INFO({
      hours: "매일 11:00~21:00", field_status: { hours: "확인" },
    }));
    const info = o.find((x) => x.kind === "info")!;
    expect(info.lines.join(" ")).toContain("매일 11:00~21:00");
  });

  it("사장님이 직접 적은 값도 확인된 값으로 본다", () => {
    const o = buildOverlays(SCENES, INFO({
      parking: "가게 앞 2대", field_status: { parking: "사용자 입력" },
    }));
    expect(o.find((x) => x.kind === "info")!.lines.join(" ")).toContain("가게 앞 2대");
  });

  it("확인일을 함께 적어 언제 기준인지 밝힌다", () => {
    const o = buildOverlays(SCENES, INFO({ hours: "매일 11~21시", field_status: { hours: "확인" } }),
      { checkedOn: "2026-08-25" });
    expect(o.find((x) => x.kind === "info")!.lines.join(" ")).toContain("확인일  2026-08-25");
  });

  it("올릴 내용이 없으면 빈 판을 만들지 않는다", () => {
    const o = buildOverlays(SCENES, INFO());
    expect(o.filter((x) => x.kind === "menu")).toHaveLength(0);
    expect(o.filter((x) => x.kind === "info")).toHaveLength(0);
  });

  it("긴 글은 잘라서 읽을 수 있게 한다", () => {
    expect(clip("아주 긴 상호명이 계속 이어집니다", 10)).toHaveLength(10);
    expect(clip("짧은 이름", 10)).toBe("짧은 이름");
  });

  it("장면이 없으면 아무 판도 만들지 않는다", () => {
    expect(buildOverlays([], INFO())).toEqual([]);
  });
});

describe("합성한 한글이 실제 ASS 자막 파일에 들어간다", () => {
  const overlays = buildOverlays(SCENES, INFO({
    menus: [{ name: "왕만두", price: "6,000원", verified: true }],
    hours: "매일 11:00~21:00", field_status: { hours: "확인" },
  }), { checkedOn: "2026-08-25" });

  const ass = buildAss(SCENES, { overlays });

  it("한글 업체명이 자막 파일에 그대로 들어간다", () => {
    expect(ass).toContain("신림동 만두명가");
  });

  it("확인된 메뉴와 가격이 들어간다", () => {
    expect(ass).toContain("왕만두");
    expect(ass).toContain("6,000원");
  });

  it("한글 폰트 스타일을 쓴다 — 네모로 깨지지 않게", () => {
    expect(ass).toContain("Style: SignTitle,Noto Sans KR ExtraBold");
    expect(ass).toContain("Style: PanelBody,Noto Sans KR ExtraBold");
  });

  it("판은 자막보다 위 레이어에 둬서 자막을 가리지 않는다", () => {
    const panel = ass.split("\n").find((l) => l.startsWith("Dialogue:") && l.includes("SignTitle,"))!;
    expect(panel.startsWith("Dialogue: 2,")).toBe(true);
    // 자막 본문은 레이어 0 — 판이 그 위다
    const sub = ass.split("\n").find((l) => l.startsWith("Dialogue:") && l.includes("Default,"))!;
    expect(sub.startsWith("Dialogue: 0,")).toBe(true);
  });

  it("판이 없으면 자막 파일이 예전과 똑같다 (기존 영상에 영향 없음)", () => {
    expect(buildAss(SCENES)).toBe(buildAss(SCENES, { overlays: [] }));
  });

  it("엔딩 배지와 판이 함께 있어도 둘 다 남는다", () => {
    const both = buildAss(SCENES, { overlays, endBadge: { from: 8, to: 9, text: "사건 해결" } });
    expect(both).toContain("사건 해결");
    expect(both).toContain("신림동 만두명가");
  });
});

describe("판이 한 장면에 겹치지 않는다 (프레임에서 실제로 겹쳐 보였던 문제)", () => {
  const many: Scene[] = [
    scene(1, "오늘 신고 들어온 곳입니다"),
    scene(2, "대표 메뉴를 살펴봅니다"),
    scene(3, "영업시간을 확인합니다"),
    scene(4, "정리하겠습니다"),
  ];
  const full = INFO({
    menus: [{ name: "손만두", price: "6,000원", verified: true }],
    hours: "매일 11:00~21:00", field_status: { hours: "확인" },
  });

  it("간판·메뉴판·정보판이 서로 다른 장면에 놓인다", () => {
    const o = buildOverlays(many, full);
    const used = o.map((x) => x.scene);
    expect(new Set(used).size).toBe(used.length);
  });

  it("간판이 있는 첫 장면에는 다른 판을 겹치지 않는다", () => {
    const o = buildOverlays(many, full);
    const onFirst = o.filter((x) => x.scene === 1);
    expect(onFirst).toHaveLength(1);
    expect(onFirst[0].kind).toBe("signboard");
  });

  it("영어 배경 묘사(menu board)에 걸려 엉뚱한 장면을 고르지 않는다", () => {
    const tricky: Scene[] = [
      scene(1, "오늘 신고 들어온 곳", { visual_prompt: "empty menu board on the wall" }),
      scene(2, "대표 메뉴를 봅니다"),
    ];
    const o = buildOverlays(tricky, full);
    expect(o.find((x) => x.kind === "menu")?.scene).toBe(2);
  });

  it("장면이 하나뿐이면 간판만 — 억지로 겹치지 않는다", () => {
    const o = buildOverlays([scene(1, "인사만 합니다")], full);
    expect(o.map((x) => x.kind)).toEqual(["signboard"]);
  });

  it("낱말이 안 맞아도 확인된 정보를 버리지 않고 빈 장면에 올린다", () => {
    const noKeyword: Scene[] = [scene(1, "인사"), scene(2, "이야기"), scene(3, "마무리")];
    const o = buildOverlays(noKeyword, full);
    expect(o.map((x) => x.kind).sort()).toEqual(["info", "menu", "signboard"]);
    // 그래도 서로 겹치지는 않는다
    const used = o.map((x) => x.scene);
    expect(new Set(used).size).toBe(used.length);
  });
});
