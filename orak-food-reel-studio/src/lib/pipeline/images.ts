import path from "node:path";
import fs from "node:fs";
import { getImageProvider } from "../providers/image";
import type { Scene } from "../schema";
import { contentHash } from "../id";
import { getSettings } from "../settings";
import { resolvedReferencePaths } from "../character/oraki";
import { logInfo, logWarn } from "../log";

/**
 * §12~13 장면별 이미지 생성.
 * §45 비용 절감: visual_prompt 해시로 캐시 — 프롬프트가 안 바뀐 장면은 다시 만들지 않음.
 * §43 실패한 SCENE만 재시도.
 */
export async function generateSceneImages(
  reelId: string,
  scenes: Scene[],
  outDir: string,
  onProgress?: (done: number, total: number) => void,
  onlyScenes?: number[],
): Promise<Array<{ scene: number; path: string; hash: string; cached: boolean }>> {
  const provider = getImageProvider();
  const lock = getSettings().characterLock;
  const results: Array<{ scene: number; path: string; hash: string; cached: boolean }> = [];
  fs.mkdirSync(outDir, { recursive: true });
  let done = 0;

  for (const scene of scenes) {
    const target = path.join(outDir, `scene-${String(scene.scene).padStart(2, "0")}.jpg`);
    const hash = contentHash({ p: scene.visual_prompt, seed: lock.seed, provider: provider.name });
    const skip = onlyScenes && !onlyScenes.includes(scene.scene);

    if (skip || (scene.image_hash === hash && scene.image_path && fs.existsSync(scene.image_path))) {
      // 캐시 유지
      results.push({ scene: scene.scene, path: scene.image_path ?? target, hash: scene.image_hash ?? hash, cached: true });
      done++; onProgress?.(done, scenes.length);
      continue;
    }

    let lastErr: unknown;
    let ok = false;
    for (let attempt = 0; attempt < 2 && !ok; attempt++) {
      try {
        const refs = resolvedReferencePaths();
        const buf = await provider.generate({
          prompt: scene.visual_prompt,
          seed: lock.seed,
          referenceImagePaths: refs,
          sceneKey: `${reelId}-${scene.scene}`,
        });
        fs.writeFileSync(target, buf);
        results.push({ scene: scene.scene, path: target, hash, cached: false });
        ok = true;
      } catch (e) {
        lastErr = e;
        logWarn("images", `SCENE ${scene.scene} 이미지 실패(시도 ${attempt + 1}): ${e instanceof Error ? e.message : e}`);
      }
    }
    if (!ok) throw new Error(`SCENE ${scene.scene} 이미지 생성 실패: ${lastErr instanceof Error ? lastErr.message : lastErr}`);
    done++; onProgress?.(done, scenes.length);
  }
  logInfo("images", `이미지 ${results.length}장 준비 (캐시 ${results.filter((r) => r.cached).length}장)`);
  return results;
}
