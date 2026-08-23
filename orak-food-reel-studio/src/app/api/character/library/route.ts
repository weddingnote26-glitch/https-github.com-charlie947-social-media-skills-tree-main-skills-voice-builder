import { handle, ok, fail } from "@/lib/api";
import { getSettings, saveSettings } from "@/lib/settings";
import {
  listFolders, listImages, createFolder, renameFolder, deleteFolder,
  deleteImages, moveImages, resolveRef,
} from "@/lib/character/library";
import { z } from "zod";

export const dynamic = "force-dynamic";

/**
 * Master Reference 보관함.
 * 파일을 옮기거나 지우면 설정의 참조 목록(characterLock.referenceImages)도 함께 고쳐,
 * 새로고침 후에도 화면과 실제 파일이 어긋나지 않게 한다.
 */

function selected(): string[] {
  return getSettings().characterLock.referenceImages;
}

/** 참조 목록을 통째로 다시 저장 — 실제로 있는 파일만 남긴다 */
function saveSelection(next: string[]): string[] {
  const cleaned = [...new Set(next)].filter((r) => resolveRef(r));
  const lock = getSettings().characterLock;
  saveSettings({ characterLock: { ...lock, referenceImages: cleaned } });
  return cleaned;
}

function snapshot() {
  return { folders: listFolders(), images: listImages(), selected: selected() };
}

export async function GET() {
  return handle(() => ok(snapshot()));
}

const PostBody = z.discriminatedUnion("action", [
  z.object({ action: z.literal("createFolder"), name: z.string().min(1) }),
  z.object({ action: z.literal("renameFolder"), from: z.string().min(1), to: z.string().min(1) }),
  z.object({ action: z.literal("moveImages"), images: z.array(z.string()).min(1), toFolder: z.string() }),
  z.object({ action: z.literal("select"), images: z.array(z.string()) }),
]);

export async function POST(req: Request) {
  return handle(async () => {
    const body = PostBody.parse(await req.json());
    try {
      switch (body.action) {
        case "createFolder": {
          const { created } = createFolder(body.name);
          return ok({ ...snapshot(), summary: `Master Reference 폴더 "${created}" 이(가) 생성되었습니다.` });
        }
        case "renameFolder": {
          const r = renameFolder(body.from, body.to);
          // 참조 목록의 경로도 새 폴더 이름으로 따라간다
          const next = selected().map((rel) =>
            rel.startsWith(`${r.from}/`) ? `${r.to}/${rel.slice(r.from.length + 1)}` : rel,
          );
          saveSelection(next);
          return ok({ ...snapshot(), summary: `폴더 이름이 "${r.from}" 에서 "${r.to}" 로 변경되었습니다. (이미지 ${r.moved.length}개 유지)` });
        }
        case "moveImages": {
          const r = moveImages(body.images, body.toFolder);
          const map = new Map(r.moved.map((m) => [m.from, m.to]));
          saveSelection(selected().map((rel) => map.get(rel) ?? rel));
          const where = body.toFolder ? `"${body.toFolder}" 폴더` : "기본 폴더";
          const missing = r.missing.length ? ` (이미 없는 파일 ${r.missing.length}개는 건너뜀)` : "";
          return ok({ ...snapshot(), summary: `이미지 ${r.moved.length}개를 ${where}로 옮겼습니다.${missing}` });
        }
        case "select": {
          const saved = saveSelection(body.images);
          return ok({
            ...snapshot(),
            summary: saved.length
              ? `기준 이미지 ${saved.length}개가 선택되었습니다. (이미지 생성에는 앞의 3개까지 사용됩니다)`
              : "기준 이미지 선택을 해제했습니다. 기본 Master Reference 가 사용됩니다.",
          });
        }
      }
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
  });
}

const DeleteBody = z.object({
  images: z.array(z.string()).optional(),
  folder: z.object({ name: z.string().min(1), mode: z.enum(["move", "delete"]) }).optional(),
});

export async function DELETE(req: Request) {
  return handle(async () => {
    const body = DeleteBody.parse(await req.json());
    if (!body.images?.length && !body.folder) return fail("삭제할 대상을 선택해 주세요");
    try {
      if (body.folder) {
        const r = deleteFolder(body.folder.name, body.folder.mode);
        const gone = new Set(r.deleted);
        // 옮겨진 파일은 기본 폴더 이름으로, 지워진 파일은 목록에서 제거
        const next = selected()
          .filter((rel) => !gone.has(rel))
          .map((rel) => {
            if (!rel.startsWith(`${r.folder}/`)) return rel;
            const file = rel.slice(r.folder.length + 1);
            return r.movedTo.find((m) => m === file || m.startsWith(file.replace(/\.[^.]+$/, "-"))) ?? file;
          });
        saveSelection(next);
        const detail = body.folder.mode === "move"
          ? `안에 있던 이미지 ${r.movedTo.length}개는 기본 폴더로 옮겼습니다.`
          : `안에 있던 이미지 ${r.deleted.length}개도 함께 삭제했습니다.`;
        return ok({ ...snapshot(), summary: `폴더 "${r.folder}" 을(를) 삭제했습니다. ${detail}` });
      }

      const r = deleteImages(body.images ?? []);
      const gone = new Set(r.deleted);
      saveSelection(selected().filter((rel) => !gone.has(rel)));
      const missing = r.missing.length ? ` (이미 없는 파일 ${r.missing.length}개는 건너뜀)` : "";
      return ok({ ...snapshot(), summary: `기준 이미지 ${r.deleted.length}개를 삭제했습니다.${missing}` });
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
  });
}
