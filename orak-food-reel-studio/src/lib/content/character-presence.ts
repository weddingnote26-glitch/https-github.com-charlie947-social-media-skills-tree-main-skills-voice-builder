/**
 * 만두탐정 오락이가 영상에서 빠지지 않게 지킨다.
 *
 * 실제로 겪은 문제: 영상 콘셉트가 "오락이의 맛집 리포트" 인데
 * 대본이 만든 장면에 캐릭터가 하나도 안 들어가 광고 내레이션처럼 나왔다.
 * AI 가 매번 잘 넣어 주기를 기대하지 않고, 여기서 규칙으로 못 박는다.
 *
 * 규칙:
 *   1) 첫 장면(오프닝)과 마지막 장면(마무리)에는 반드시 등장
 *   2) 전체 장면의 최소 비율(기본 60%) 이상에 등장
 *   3) 사용자가 "오프닝·마무리만" 을 고르면 그 규칙만 지킨다
 */
import type { Scene } from "../schema";
import { ORAKI_ACTIONS, ORAKI_EXPRESSIONS } from "../schema";

export type PresencePlan = "all" | "most" | "ends";

/** 대본이 캐릭터를 안 넣은 장면에 채워 넣을 기본 동작 */
const DEFAULT_ACTION: Record<"open" | "middle" | "close", (typeof ORAKI_ACTIONS)[number]> = {
  open: "카메라 쪽으로 설명하기",
  middle: "손가락으로 음식 가리키기",
  close: "사건 해결 포즈",
};

/** 표정도 스키마가 허용한 값만 쓴다 — 검증에서 튕기지 않게 */
const DEFAULT_EXPRESSION: Record<"open" | "middle" | "close", (typeof ORAKI_EXPRESSIONS)[number]> = {
  open: "Happy",
  middle: "Curious",
  close: "Satisfied",
};

export interface PresenceResult {
  scenes: Scene[];
  /** 캐릭터가 나오는 장면 수 */
  count: number;
  /** 우리가 새로 채워 넣은 장면 번호 */
  filled: number[];
  /** 사람에게 보여 줄 요약 */
  summary: string;
}

/** 오락이가 나오는 장면인가 */
export function hasCharacter(s: Scene): boolean {
  return s.character_presence !== "none";
}

/**
 * 장면 목록을 받아 캐릭터 등장 규칙을 맞춘다.
 * 원본을 고치지 않고 새 배열을 돌려준다 (되돌리기 쉬우라고).
 */
export function ensureCharacterPresence(
  scenes: Scene[],
  plan: PresencePlan = "most",
  minRatio = 0.6,
): PresenceResult {
  if (!scenes.length) return { scenes: [], count: 0, filled: [], summary: "장면이 없습니다" };
  const out = scenes.map((s) => ({ ...s }));
  const filled: number[] = [];
  const lastIdx = out.length - 1;

  const put = (i: number, where: "open" | "middle" | "close") => {
    if (hasCharacter(out[i])) return;
    out[i].character_presence = where === "middle" ? "corner" : "hero";
    out[i].character_action = out[i].character_action ?? DEFAULT_ACTION[where];
    out[i].character_expression = out[i].character_expression ?? DEFAULT_EXPRESSION[where];
    filled.push(out[i].scene);
  };

  // 1) 오프닝·마무리는 어느 설정에서도 필수 — 여기서 빠지면 콘셉트가 무너진다
  put(0, "open");
  if (lastIdx > 0) put(lastIdx, "close");

  // 2) 비율 채우기
  if (plan !== "ends") {
    const want = plan === "all" ? out.length : Math.ceil(out.length * minRatio);
    for (let i = 1; i < lastIdx && countCharacter(out) < want; i++) put(i, "middle");
  }

  const count = countCharacter(out);
  return {
    scenes: out, count, filled,
    summary: `${count}/${out.length} 장면에 오락이 등장`
      + (filled.length ? ` (${filled.length}개 장면은 규칙에 따라 채웠습니다)` : ""),
  };
}

export function countCharacter(scenes: Scene[]): number {
  return scenes.filter(hasCharacter).length;
}

/**
 * 제작 전에 막아야 하는 상태인지 판단한다.
 * 캐릭터가 0개면 "오락이의 맛집 리포트" 가 아니므로 만들기 전에 알린다.
 */
export function presenceBlockReason(scenes: Scene[], mode: string): string | null {
  if (mode !== "ORAKI_DETECTIVE") return null;
  if (!scenes.length) return "장면이 없습니다.";
  if (countCharacter(scenes) === 0) {
    return "만두탐정 오락이 캐릭터가 영상에 배치되지 않았습니다.";
  }
  if (!hasCharacter(scenes[0]) || !hasCharacter(scenes[scenes.length - 1])) {
    return "오프닝과 마무리 장면에는 만두탐정 오락이가 나와야 합니다.";
  }
  return null;
}
