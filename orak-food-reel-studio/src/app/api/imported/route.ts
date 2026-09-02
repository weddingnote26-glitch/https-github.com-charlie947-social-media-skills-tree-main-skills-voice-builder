import { handle, ok, fail } from "@/lib/api";
import { z } from "zod";
import {
  checkSourcePath, inspectVideo, startImportedJob, listImportedJobs, deleteImportedJobs, countImportedJobs,
  NARRATION_MAX_CHARS,
} from "@/lib/pipeline/imported-video";
import { checkVoiceId, checkTtsModel } from "@/lib/providers/voice-id";
import { getSettings, saveSettings } from "@/lib/settings";
import { isSampleMode, resolveSecret } from "@/lib/secrets";

export const dynamic = "force-dynamic";

const counts = () => ({ 진행중: countImportedJobs("진행중"), 완료: countImportedJobs("완료"), 실패: countImportedJobs("실패") });

/** 외부 영상 작업 목록 — ?status=진행중 처럼 거를 수 있다 */
export async function GET(req: Request) {
  return handle(() => {
    const status = new URL(req.url).searchParams.get("status") ?? undefined;
    return ok({ jobs: listImportedJobs(status), counts: counts() });
  });
}

const CreateBody = z.object({
  sourcePath: z.string().min(1, "영상 파일을 먼저 골라 주세요."),
  title: z.string().max(80).optional(),
  narration: z.string().max(NARRATION_MAX_CHARS, `나레이션은 ${NARRATION_MAX_CHARS}자까지 넣을 수 있습니다.`),
  voiceId: z.string().max(200).optional().default(""),
  model: z.string().max(200).optional().default(""),
  speed: z.number().min(0.7).max(1.2).optional(),
  stability: z.number().min(0).max(1).optional(),
  similarity: z.number().min(0).max(1).optional(),
  audioMode: z.enum(["mute", "mix"]).optional().default("mute"),
  mixDb: z.number().min(-40).max(0).optional(),
  /** 고른 목소리·모델·속도를 전체 프로그램 기본값으로도 저장할지 (기본은 이번 작업에만) */
  saveAsDefault: z.boolean().optional().default(false),
});

/** 외부 영상 + AI 음성 최종 제작 시작 */
export async function POST(req: Request) {
  return handle(async () => {
    const parsed = CreateBody.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "입력값을 확인해 주세요.");
    const b = parsed.data;

    const narration = b.narration.trim();
    if (!narration) return fail("나레이션을 입력해 주세요. 영상에서 말할 문장을 적으면 그대로 음성이 됩니다.");

    // 목소리 ID·모델 칸에 API 키가 들어가는 실수를 시작 전에 막는다 (주소에 실려 나가면 키가 샌다)
    const voiceId = b.voiceId.trim();
    if (voiceId) {
      const check = checkVoiceId(voiceId);
      if (!check.ok) return fail(check.reason ?? "목소리 ID가 올바르지 않습니다.");
    }
    const model = b.model.trim();
    const modelCheck = checkTtsModel(model);
    if (!modelCheck.ok) return fail(modelCheck.reason ?? "Model 값이 올바르지 않습니다.");

    // 실제 모드인데 목소리가 아무 데도 없으면 음성 단계에서 실패한다 — 시작 전에 알린다
    const live = !isSampleMode() && !!resolveSecret("ELEVENLABS_API_KEY");
    if (live && !voiceId && !getSettings().tts.voiceId) {
      return fail("목소리를 골라 주세요. (또는 ⚙️ 설정에서 기본 목소리를 정해 두면 그 목소리를 씁니다)");
    }

    const src = checkSourcePath(b.sourcePath);
    if (!src.ok) return fail(src.reason);
    let info;
    try { info = await inspectVideo(src.path); }
    catch (e) { return fail(e instanceof Error ? e.message : String(e)); }

    // 사용자가 따로 고른 경우에만 전체 설정을 바꾼다
    if (b.saveAsDefault) {
      const cur = getSettings().tts;
      saveSettings({
        tts: {
          ...cur,
          ...(voiceId ? { voiceId } : {}),
          ...(model ? { model } : {}),
          ...(b.speed !== undefined ? { speed: b.speed } : {}),
        },
      });
    }

    const { jobId } = startImportedJob({
      sourcePath: src.path,
      title: b.title,
      narration,
      voice: {
        voiceId: voiceId || undefined,
        model: model || undefined,
        speed: b.speed,
        stability: b.stability,
        similarity: b.similarity,
      },
      audioMode: b.audioMode,
      mixDb: b.mixDb,
    }, info);
    return ok({ jobId, info, mode: live ? "live" : "sample" });
  });
}

const DeleteBody = z.object({ ids: z.array(z.string()).min(1) });

/** 작업 기록 삭제 — 만들어진 영상 파일은 지우지 않는다 */
export async function DELETE(req: Request) {
  return handle(async () => {
    const body = DeleteBody.safeParse(await req.json().catch(() => ({})));
    if (!body.success) return fail("삭제할 작업을 선택해 주세요");
    return ok({ removed: deleteImportedJobs(body.data.ids), counts: counts() });
  });
}
