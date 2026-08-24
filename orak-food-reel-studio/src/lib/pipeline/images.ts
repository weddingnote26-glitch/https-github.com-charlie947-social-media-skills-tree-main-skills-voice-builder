import path from "node:path";
import fs from "node:fs";
import { getImageProvider, getPlaceholderImageProvider, fallbackProviders, isQuotaError, friendlyImageError } from "../providers/image";
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
  /** 실제로 만든 공급자 (대체로 넘어갔으면 그 공급자) */
  provider?: string;
  /** 고른 공급자가 실패해 대체 공급자로 만들었는가 */
  fallback?: boolean;
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
  const settings = getSettings();
  const lock = settings.characterLock;
  const policy = settings.imagePolicy;
  const results: SceneImageResult[] = [];
  fs.mkdirSync(outDir, { recursive: true });
  let done = 0;
  // 한도 초과가 한 번 확인된 공급자는 더 부르지 않는다 (무료 사용량 낭비 방지)
  const exhausted = new Set<string>();
  let quotaExhausted = false; // 최종 공급자까지 소진된 상태
  let switchedTo: string | null = null; // 대체 공급자로 넘어갔음을 한 번만 알리기 위해

  for (const scene of scenes) {
    const target = path.join(outDir, `scene-${String(scene.scene).padStart(2, "0")}.jpg`);
    // 오락이가 나오는 장면은 캐릭터 모델·참조 이미지 경로를 태운다 (§27 장면 라우팅)
    const characterScene = scene.character_presence !== "none";
    const hash = contentHash({
      p: scene.visual_prompt, seed: lock.seed, provider: provider.name,
      character: characterScene, refs: characterScene ? resolvedReferencePaths() : [],
    });
    const skip = onlyScenes && !onlyScenes.includes(scene.scene);
    const cacheHit = policy.reuseCache && scene.image_hash === hash && !!scene.image_path && fs.existsSync(scene.image_path);

    if (skip || cacheHit) {
      results.push({
        scene: scene.scene, path: scene.image_path ?? target,
        hash: scene.image_hash ?? hash, cached: true, placeholder: false,
      });
      done++; onProgress?.(done, scenes.length);
      continue;
    }

    let lastErr: unknown;
    let ok = false;
    // 고른 공급자 먼저, 실패하면(설정이 켜져 있으면) 대체 순서대로 —
    // Cloudflare → Gemini → OpenAI → Sample. 한도 초과(429)로 죽은 공급자는 다시 부르지 않는다.
    const chain = policy.fallback ? [provider, ...fallbackProviders(provider.name)] : [provider];
    for (const p_ of chain) {
      if (ok || quotaExhausted) break;
      if (exhausted.has(p_.name)) continue;
      const attempts = p_.name === provider.name ? 2 : 1; // 대체 공급자는 한 번만 (429 무한 재시도 금지)
      for (let attempt = 0; attempt < attempts && !ok; attempt++) {
        try {
          const buf = await p_.generate({
            prompt: scene.visual_prompt,
            seed: lock.seed,
            referenceImagePaths: characterScene ? resolvedReferencePaths() : [],
            sceneKey: `${reelId}-${scene.scene}`,
            characterScene,
          });
          fs.writeFileSync(target, buf);
          const fellBack = p_.name !== provider.name;
          if (fellBack && switchedTo !== p_.name) {
            switchedTo = p_.name;
            logWarn("images", `${provider.name} 실패 — ${p_.name} 공급자로 자동 전환했습니다`);
            onProgress?.(done, scenes.length, `${provider.name} 사용량 소진 — ${p_.name} 로 자동 전환`);
          }
          results.push({ scene: scene.scene, path: target, hash, cached: false, placeholder: p_.name === "sample", provider: p_.name, fallback: fellBack, reason: p_.name === "sample" ? friendlyImageError(lastErr) : undefined });
          ok = true;
        } catch (e) {
          lastErr = e;
          if (isQuotaError(e)) {
            // 이 공급자는 오늘 끝났다 — 같은 요청을 다시 보내지 않는다 (§무료 사용량 보호)
            exhausted.add(p_.name);
            logWarn("images", `${p_.name} 사용 한도 초과 — 이 공급자는 오늘 더 부르지 않습니다`);
            break;
          }
          logWarn("images", `SCENE ${scene.scene} 이미지 실패(${p_.name}, 시도 ${attempt + 1}): ${friendlyImageError(e)}`);
        }
      }
    }
    // 대체까지 전부 한도 초과면 남은 장면은 API 를 부르지 않는다
    if (!ok && chain.every((p_) => exhausted.has(p_.name) || p_.name === "sample")) quotaExhausted = true;

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
    // 이미지 옆에 어떻게 만들었는지 남긴다 — 나중에 "이 그림 뭘로 만들었지"를 파일만 보고 알 수 있게
    const last = results[results.length - 1];
    if (last && !last.cached) {
      try {
        fs.writeFileSync(target.replace(/\.jpg$/, ".json"), JSON.stringify({
          provider: last.provider ?? (last.placeholder ? "placeholder" : provider.name),
          scene_type: characterScene ? "character" : "food",
          fallback: !!last.fallback,
          placeholder: last.placeholder,
          prompt: scene.visual_prompt,
          created_at: new Date().toISOString(),
        }, null, 2));
      } catch { /* 기록 실패가 제작을 멈추면 안 된다 */ }
    }
    done++;
    onProgress?.(done, scenes.length, quotaExhausted ? "한도 초과 — 임시 이미지로 진행" : undefined);
  }

  const placeholders = results.filter((r) => r.placeholder).length;
  logInfo("images", `이미지 ${results.length}장 준비 (캐시 ${results.filter((r) => r.cached).length}장, 임시 ${placeholders}장)`);
  return results;
}
