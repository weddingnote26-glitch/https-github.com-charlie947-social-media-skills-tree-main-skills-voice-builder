import path from "node:path";
import fs from "node:fs";
import { handle, ok, fail } from "@/lib/api";
import { getReel } from "@/lib/reels";
import { checkSourcePath, inspectVideo, VIDEO_EXTENSIONS } from "@/lib/pipeline/imported-video";
import { MAX_CLIP_BYTES, uniqueClipPath, clipNotes, attachClip } from "@/lib/pipeline/scene-clip";
import { logInfo } from "@/lib/log";
import { z } from "zod";

export const dynamic = "force-dynamic";

/**
 * 장면 영상 클립 넣기·빼기 — 클링AI 웹에서 만든 영상을 장면에 끌어다 붙인다.
 *
 * POST 두 가지 방법:
 *  - multipart/form-data (scene + file): 브라우저에서 파일을 끌어다 놓거나 골랐을 때.
 *    cloudflared 공개 주소로 다른 기기에서 접속해도 이 방법으로 넣을 수 있다.
 *  - JSON { scene, sourcePath }: 설치형(Electron) 파일 고르기 창이나 "경로로 복사" 붙여넣기.
 * 어느 쪽이든 원본은 그대로 두고 릴스 폴더 clips\ 에 복사본을 만들어 그 경로를 기록한다.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await ctx.params;
    const reel = getReel(id);
    if (!reel) return fail("릴스를 찾을 수 없습니다", 404);
    if (reel.deleted_at) return fail("휴지통에 있는 릴스입니다. 복원한 뒤에 수정해 주세요.");
    if (!reel.output_dir) return fail("이 릴스에는 저장 폴더가 아직 없습니다 — [② 장면 편집]에서 영상을 한 번 만든 뒤에 클립을 넣어 주세요.");

    const contentType = req.headers.get("content-type") ?? "";
    let sceneNo: number;
    let savedPath: string;

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      sceneNo = parseInt(String(form.get("scene") ?? ""), 10);
      if (!Number.isInteger(sceneNo)) return fail("장면 번호가 없습니다.");
      if (!reel.scenes.some((s) => s.scene === sceneNo)) return fail(`SCENE ${sceneNo} 를 찾을 수 없습니다`);
      const file = form.get("file");
      if (!(file instanceof File)) return fail("영상 파일이 없습니다 — 파일을 끌어다 놓거나 골라 주세요.");
      if (file.size === 0) return fail("빈 파일입니다 (0 바이트).");
      if (file.size > MAX_CLIP_BYTES) {
        return fail(`파일이 너무 큽니다 (${Math.round(file.size / 1024 / 1024)}MB). ${Math.round(MAX_CLIP_BYTES / 1024 / 1024)}MB 이하 영상만 넣을 수 있습니다.`);
      }
      const ext = path.extname(file.name ?? "").slice(1).toLowerCase();
      if (!VIDEO_EXTENSIONS.includes(ext)) {
        return fail(`지원하지 않는 파일 형식입니다 (.${ext || "확장자 없음"}). 쓸 수 있는 형식: ${VIDEO_EXTENSIONS.map((e) => "." + e).join(" ")}`);
      }
      savedPath = uniqueClipPath(reel.output_dir, sceneNo, "." + ext);
      fs.writeFileSync(savedPath, Buffer.from(await file.arrayBuffer()));
    } else {
      const body = z.object({ scene: z.number().int().min(1), sourcePath: z.string().min(1) })
        .parse(await req.json().catch(() => ({})));
      sceneNo = body.scene;
      if (!reel.scenes.some((s) => s.scene === sceneNo)) return fail(`SCENE ${sceneNo} 를 찾을 수 없습니다`);
      const checked = checkSourcePath(body.sourcePath);
      if (!checked.ok) return fail(checked.reason);
      let st: fs.Stats;
      try { st = fs.statSync(checked.path); }
      catch { return fail(`영상 파일을 찾을 수 없습니다: ${checked.path}`); }
      if (st.size > MAX_CLIP_BYTES) {
        return fail(`파일이 너무 큽니다 (${Math.round(st.size / 1024 / 1024)}MB). ${Math.round(MAX_CLIP_BYTES / 1024 / 1024)}MB 이하 영상만 넣을 수 있습니다.`);
      }
      savedPath = uniqueClipPath(reel.output_dir, sceneNo, path.extname(checked.path));
      // COPYFILE_EXCL: 만에 하나 같은 이름이 생겨도 덮어쓰는 대신 실패한다
      fs.copyFileSync(checked.path, savedPath, fs.constants.COPYFILE_EXCL);
    }

    // 확장자는 첫 관문일 뿐 — 실제 영상인지는 FFprobe 가 정한다
    let info;
    try {
      info = await inspectVideo(savedPath);
    } catch (e) {
      // 방금 우리가 만든 복사본만 치운다 — 사용자의 원본은 건드리지 않았다
      try { fs.rmSync(savedPath); } catch { /* 못 지워도 기록은 남기지 않는다 */ }
      return fail(e instanceof Error ? e.message : String(e));
    }

    const scene = reel.scenes.find((s) => s.scene === sceneNo)!;
    attachClip(id, sceneNo, savedPath);
    const notes = clipNotes(info, Math.round((scene.end - scene.start) * 100) / 100);
    logInfo("clip", `SCENE ${sceneNo} 에 영상 클립을 넣었습니다 — ${savedPath} (${info.width}x${info.height} · ${info.durationSec}s)`);
    return ok({
      scene: sceneNo,
      video_path: savedPath,
      info,
      notes,
      message: `SCENE ${sceneNo} 에 영상 클립을 넣었습니다. [💾 저장하고 영상 제작하기]를 누르면 반영됩니다.`,
    });
  });
}

/** 클립 빼기 — 기록만 비우고 파일은 지우지 않는다 */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await ctx.params;
    const reel = getReel(id);
    if (!reel) return fail("릴스를 찾을 수 없습니다", 404);
    if (reel.deleted_at) return fail("휴지통에 있는 릴스입니다. 복원한 뒤에 수정해 주세요.");
    const body = z.object({ scene: z.number().int().min(1) }).parse(await req.json().catch(() => ({})));
    if (!reel.scenes.some((s) => s.scene === body.scene)) return fail(`SCENE ${body.scene} 를 찾을 수 없습니다`);
    attachClip(id, body.scene, null);
    return ok({ scene: body.scene, video_path: null, message: `SCENE ${body.scene} 의 클립을 뺐습니다 — 이 장면은 다시 이미지로 만들어집니다. 파일은 지우지 않았습니다.` });
  });
}
