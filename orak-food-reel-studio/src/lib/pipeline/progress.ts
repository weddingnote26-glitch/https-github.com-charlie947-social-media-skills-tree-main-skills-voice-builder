/**
 * 진행률 표시 규칙.
 *
 * 핵심 원칙: 서버가 실제 진행률을 주지 않는 단계는 숫자를 지어내지 않는다.
 * 예전에는 렌더링 단계가 시작하자마자 10%, 30% 처럼 임의의 숫자를 보여 줬는데
 * 그 숫자는 실제로 얼마나 됐는지와 아무 관계가 없어서, 멈춘 것인지 되고 있는 것인지
 * 구분할 수 없었다. 이제 그런 단계는 "처리 중"으로만 표시하고
 * 정말 끝났을 때만 100%가 된다.
 *
 * 서버 코드를 끌어오지 않도록 타입을 여기서 따로 둔다(화면에서도 쓰는 파일).
 */

export type StepStatus = "대기중" | "진행중" | "완료" | "실패" | "건너뜀";

export interface ProgressStep {
  key: string;
  label: string;
  status: StepStatus;
  progress: number;
  message?: string;
  /** 실제 진행률을 셀 수 없는 단계 (몇 %인지 알 수 없음) */
  indeterminate?: boolean;
}

export interface StepView {
  icon: string;
  /** 오른쪽에 표시할 글 */
  text: string;
  /** 막대 길이 0~100 */
  barPct: number;
  /** 길이를 알 수 없어 흐르는 막대로 보여줄지 */
  animated: boolean;
  tone: string;
}

const TONE_RUNNING = "bg-[#E86A3A]";
const TONE_DONE = "bg-emerald-500";
const TONE_FAIL = "bg-red-400";
const TONE_IDLE = "bg-gray-300";

export function stepView(s: ProgressStep): StepView {
  switch (s.status) {
    case "완료":
      return { icon: "✓", text: s.message ?? "완료", barPct: 100, animated: false, tone: TONE_DONE };
    case "실패":
      // 실패한 지점을 그대로 남겨 어디서 멈췄는지 보이게 한다
      return { icon: "✗", text: s.message ?? "실패", barPct: clamp(s.progress), animated: false, tone: TONE_FAIL };
    case "건너뜀":
      return { icon: "–", text: s.message ?? "건너뜀", barPct: 100, animated: false, tone: TONE_IDLE };
    case "진행중":
      if (s.indeterminate) {
        // 몇 %인지 모르는 단계 — 숫자를 지어내지 않는다
        return { icon: "▶", text: s.message ?? "처리 중…", barPct: 100, animated: true, tone: TONE_RUNNING };
      }
      return {
        icon: "▶",
        // 실제로 셀 수 있는 단계만 숫자를 보여준다. 끝나기 전에는 99%를 넘기지 않는다.
        text: s.message ? `${s.message} · ${runningPct(s.progress)}%` : `${runningPct(s.progress)}%`,
        barPct: runningPct(s.progress),
        animated: false,
        tone: TONE_RUNNING,
      };
    default:
      return { icon: "·", text: "대기중", barPct: 0, animated: false, tone: TONE_IDLE };
  }
}

/** 진행 중에는 100%를 쓰지 않는다 — 100%는 실제로 끝났다는 뜻으로만 */
function runningPct(n: number): number {
  return Math.min(99, clamp(n));
}

function clamp(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, Math.round(n)));
}

/**
 * 작업 하나의 전체 진행률 (0~100).
 * 끝난 단계만 온전히 세고, 진행 중인 단계는 실제로 셀 수 있을 때만 부분 반영한다.
 */
export function jobProgress(steps: ProgressStep[]): number {
  if (steps.length === 0) return 0;
  let sum = 0;
  for (const s of steps) {
    if (s.status === "완료" || s.status === "건너뜀") sum += 1;
    else if (s.status === "진행중" && !s.indeterminate) sum += clamp(s.progress) / 100;
    // 대기중 · 실패 · 진행중(셀 수 없음) 은 0
  }
  return Math.round((sum / steps.length) * 100);
}

/** 여러 작업을 동시에 돌릴 때의 전체 진행률 */
export function overallProgress(jobs: ProgressStep[][]): number {
  const real = jobs.filter((j) => j.length > 0);
  if (real.length === 0) return 0;
  return Math.round(real.reduce((a, j) => a + jobProgress(j), 0) / real.length);
}

/** 작업 상태 요약 — 대기/진행/완료/실패 개수 */
export function stepCounts(steps: ProgressStep[]): Record<"대기중" | "진행중" | "완료" | "실패" | "건너뜀", number> {
  const out = { 대기중: 0, 진행중: 0, 완료: 0, 실패: 0, 건너뜀: 0 };
  for (const s of steps) out[s.status] += 1;
  return out;
}
