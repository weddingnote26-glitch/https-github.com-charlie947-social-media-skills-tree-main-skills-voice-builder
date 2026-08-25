import { db, j } from "./db";
import { getReel, updateReel } from "./reels";
import type { FactCheckItem } from "./schema";

/**
 * §5 발행 전 검수.
 *
 * 확인하지 않은 콘텐츠가 인스타그램에 나가는 일을 막는다.
 * 다섯 항목을 사람이 눈으로 보고 하나씩 체크해야 발행 단추가 열린다.
 */
export const REVIEW_ITEMS = [
  { key: "info", label: "업체명과 주소를 확인했습니다." },
  { key: "hours", label: "영업시간과 메뉴 가격을 확인했습니다." },
  { key: "video", label: "영상과 자막을 확인했습니다." },
  { key: "caption", label: "게시문과 해시태그를 확인했습니다." },
  { key: "rights", label: "이미지와 영상의 사용 권한을 확인했습니다." },
] as const;

export type ReviewKey = (typeof REVIEW_ITEMS)[number]["key"];
export type ReviewChecks = Partial<Record<ReviewKey, boolean>>;

export interface ReviewState {
  checks: ReviewChecks;
  /** 다섯 항목을 모두 확인했는가 */
  done: boolean;
  /** 아직 확인하지 않은 항목의 안내 문구 */
  missing: string[];
  checkedAt: string | null;
}

function stateOf(checks: ReviewChecks, checkedAt: string | null): ReviewState {
  const missing = REVIEW_ITEMS.filter((i) => !checks[i.key]).map((i) => i.label);
  return { checks, done: missing.length === 0, missing, checkedAt };
}

export function getReview(reelId: string): ReviewState {
  const row = db().prepare("SELECT review_json FROM reels WHERE id=?").get(reelId) as { review_json?: string } | undefined;
  const saved = j<{ checks?: ReviewChecks; checkedAt?: string | null }>(row?.review_json ?? "{}", {});
  return stateOf(saved.checks ?? {}, saved.checkedAt ?? null);
}

/**
 * 체크 상태를 저장한다.
 * 영상이나 대본을 다시 만들면 예전 확인은 의미가 없으므로 clearReview 로 지운다.
 */
export function saveReview(reelId: string, checks: ReviewChecks, now = new Date()): ReviewState {
  const clean: ReviewChecks = {};
  for (const item of REVIEW_ITEMS) if (checks[item.key]) clean[item.key] = true;
  const anyChecked = Object.keys(clean).length > 0;
  updateReel(reelId, {
    review_json: JSON.stringify({ checks: clean, checkedAt: anyChecked ? now.toISOString() : null }),
  });
  return stateOf(clean, anyChecked ? now.toISOString() : null);
}

/** 내용이 바뀌었으니 검수를 처음부터 다시 하게 한다 */
export function clearReview(reelId: string): void {
  updateReel(reelId, { review_json: JSON.stringify({ checks: {}, checkedAt: null }) });
}

/**
 * 발행해도 되는 상태인지 한 자리에서 판단한다.
 * 예약·즉시 발행 어느 쪽이든 여기를 지난다.
 */
export function publishBlockReason(reelId: string): string | null {
  const reel = getReel(reelId);
  if (!reel) return "릴스를 찾을 수 없습니다";
  if (!reel.video_path) {
    return "아직 영상이 없어서 발행할 수 없습니다. 먼저 [저장하고 영상 제작하기]로 영상을 만들어 주세요.";
  }
  const q = j<{ fact_blocked?: boolean; fact_block_reasons?: string[] }>(reel.quality_json, {});
  if (q.fact_blocked) {
    return "확인되지 않은 업체 정보가 있습니다. 내용을 확인한 후 게시해 주세요. — "
      + (q.fact_block_reasons ?? []).join(" / ");
  }
  const facts = j<FactCheckItem[]>(reel.factcheck_json, []);
  const unknown = facts.filter((f) => f.status === "미확인").map((f) => f.field);
  const review = getReview(reelId);
  if (!review.done) {
    return "발행 전 검수가 끝나지 않았습니다. 미리보기 화면에서 확인해 주세요 — "
      + review.missing.join(" / ")
      + (unknown.length ? ` (확인 필요: ${unknown.join(", ")})` : "");
  }
  return null;
}
