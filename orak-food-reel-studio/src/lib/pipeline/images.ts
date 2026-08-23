import path from "node:path";
import fs from "node:fs";
import { getImageProvider, getPlaceholderImageProvider, isQuotaError, friendlyImageError } from "../providers/image";
import type { Scene } from "../schema";
import { contentHash } from "../id";
import { getSettings } from "../settings";
import { resolvedReferencePaths } from "../character/oraki";
import { logInfo, logWarn } from "../log";

export interface SceneImageResult {
  scene: number;
  path: string;
  hash: string;
  cached: boolean;
  /** 실제 생성에 실패해 임시 이미지로 채운 장면 */
  placeholder: boolean;
  reason?: string;
}

/**
 * §12 장면별 이미지 생성.
 * §45 비용 절감: visual_prompt 해시로 캐시 — 프롬프트가 안 바뀐 장면은 다시 만들지 않음.
 * §43 한 장면이 실패해도 제작 전체를 버리지 않는다:
 *     실패한 장면은 임시 이미지로 채우고 계속 진행한 뒤, 나중에 그 장면만 다시 만들 수 있게 한다.
 */
export async function generateSceneImages(
  reelId: string,
  scenes: Scene[],
  outDir: string,
  onProgress?: (done: number, total: number, note?: string) => void,
  onlyScenes?: number[],
): Promise<SceneImageResult[]> {
  const provider = getImageProvider();
  const lock = getSettings().characterLock;
  const results: SceneImageResult[] = [];
  fs.mkdirSync(outDir, { recursive: true });
  let done = 0;
  // 한도 초과가 한 번 확인되면 남은 장면은 API를 더 부르지 않는다 (할당량 낭비 방지)
  let quotaExhausted = false;

  for (const scene of scenes) {
    const target = path.join(outDir, `scene-${String(scene.scene).padStart(2, "0")}.jpg`);
    const hash = contentHash({ p: scene.visual_prompt, seed: lock.seed, provider: provider.name });
    const skip = onlyScenes && !onlyScenes.includes(scene.scene);

    if (skip || (scene.image_hash === hash && scene.image_path && fs.existsSync(scene.image_path))) {
      results.push({
        scene: scene.scene, path: scene.image_path ?? target,
        hash: scene.image_hash ?? hash, cached: true, placeholder: false,
      });
      done++; onProgress?.(done, scenes.length);
      continue;
    }

    let lastErr: unknown;
    let ok = false;
    const attempts = quotaExhausted ? 0 : 2;
    for (let attempt = 0; attempt < attempts && !ok; attempt++) {
      try {
        const buf = await provider.generate({
          prompt: scene.visual_prompt,
          seed: lock.seed,
          referenceImagePaths: resolvedReferencePaths(),
          sceneKey: `${reelId}-${scene.scene}`,
        });
        fs.writeFileSync(target, buf);
        results.push({ scene: scene.scene, path: target, hash, cached: false, placeholder: false });
        ok = true;
      } catch (e) {
        lastErr = e;
        if (isQuotaError(e)) {
          quotaExhausted = true;
          logWarn("images", "이미지 API 한도 초과 — 남은 장면은 임시 이미지로 채웁니다");
          break;
        }
        logWarn("images", `SCENE ${scene.scene} 이미지 실패(시도 ${attempt + 1}): ${friendlyImageError(e)}`);
      }
    }

    if (!ok) {
      // 제작을 멈추지 않고 임시 이미지로 채운다 (나중에 장면 단위로 다시 생성 가능)
      const reason = quotaExhausted && !lastErr
        ? "이미지 API 사용 한도 초과"
        : friendlyImageError(lastErr);
      const buf = await getPlaceholderImageProvider().generate({
        prompt: scene.visual_prompt,
        sceneKey: `${reelId}-${scene.scene}`,
      });
      fs.writeFileSync(target, buf);
      results.push({ scene: scene.scene, path: target, hash: `placeholder-${hash}`, cached: false, placeholder: true, reason });
    }
    done++;
    onProgress?.(done, scenes.length, quotaExhausted ? "한도 초과 — 임시 이미지로 진행" : undefined);
  }

  const placeholders = results.filter((r) => r.placeholder).length;
  logInfo("images", `이미지 ${results.length}장 준비 (캐시 ${results.filter((r) => r.cached).length}장, 임시 ${placeholders}장)`);
  return results;
}
