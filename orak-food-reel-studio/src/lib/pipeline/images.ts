import path from "node:path";
import fs from "node:fs";
import { getImageProvider, getPlaceholderImageProvider, fallbackProviders, isQuotaError, friendlyImageError } from "../providers/image";
import type { Scene } from "../schema";
import { contentHash } from "../id";
import { getSettings } from "../settings";
import { resolvedReferencePaths } from "../character/oraki";
import { orakiAssets, characterReferences, masterMissingReason } from "../character/asset-root";
import { tierFor, sceneKindOf, TIERS, KIND_LABEL, type SceneKind } from "../providers/image-quality";
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
  /** 장면 종류 (오락이/음식/배경) */
  kind?: SceneKind;
}

/** 제작 한 번의 사용량 집계 — 화면에 그대로 보여준다 */
export interface ImageUsage {
  created: number;      // 새로 만든 장수
  reused: number;       // 캐시로 재사용한 장수
  retries: number;      // 다시 시도한 횟수
  apiCalls: number;     // 실제 API 호출 횟수
  savedByCache: number; // 캐시 덕에 아낀 호출 수
  budget: number;       // 이번 제작의 호출 상한
  budgetHit: boolean;   // 상한에 닿아 멈췄는가
  byKind: Record<SceneKind, number>; // 종류별 신규 생성 수
  models: string[];     // 실제로 쓴 공급자/모델
}

export const lastImageUsage: { value: ImageUsage | null } = { value: null };

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

  // 오락이 공식 에셋 — 마스터가 없으면 캐릭터 장면은 만들지 않는다(§오류 처리)
  const assets = orakiAssets();
  const missingMaster = masterMissingReason(assets);
  const charRefs = characterReferences(assets);

  // 사용량 집계 + 릴스당 호출 상한(예산). 상한에 닿으면 남은 장면은 API 를 부르지 않고
  // 지금까지 만든 것은 그대로 지킨다 — 전체를 버리는 것보다 낫다.
  const usage: ImageUsage = {
    created: 0, reused: 0, retries: 0, apiCalls: 0, savedByCache: 0,
    budget: policy.budgetCalls, budgetHit: false,
    byKind: { character: 0, food: 0, background: 0 }, models: [],
  };
  const overBudget = () => policy.budgetStop && policy.budgetCalls > 0 && usage.apiCalls >= policy.budgetCalls;

  for (const scene of scenes) {
    const target = path.join(outDir, `scene-${String(scene.scene).padStart(2, "0")}.jpg`);
    // 오락이가 나오는 장면은 캐릭터 모델·참조 이미지 경로를 태운다 (§27 장면 라우팅)
    const characterScene = scene.character_presence !== "none";
    const kind = sceneKindOf(scene);
    const tier = TIERS[tierFor(policy.costPolicy, kind)];
    const refPaths = characterScene ? (charRefs.length ? charRefs : resolvedReferencePaths()) : [];
    // 캐시 키 — 여기 들어간 것 중 하나라도 바뀌면 다시 만든다.
    // 에셋 판(version)이 들어 있어서 마스터를 바꾸면 옛 캐릭터 그림을 재사용하지 않는다.
    const hash = contentHash({
      p: scene.visual_prompt, seed: lock.seed, provider: provider.name,
      character: characterScene, refs: refPaths,
      kind, tier, assetVersion: characterScene ? assets.version : "",
    });
    const skip = onlyScenes && !onlyScenes.includes(scene.scene);
    const cacheHit = policy.reuseCache && scene.image_hash === hash && !!scene.image_path && fs.existsSync(scene.image_path);

    if (skip || cacheHit) {
      if (cacheHit && !skip) { usage.reused++; usage.savedByCache++; }
      results.push({
        scene: scene.scene, path: scene.image_path ?? target,
        hash: scene.image_hash ?? hash, cached: true, placeholder: false, kind,
      });
      done++; onProgress?.(done, scenes.length);
      continue;
    }

    // 마스터가 없으면 캐릭터 장면은 새로 만들지 않는다 — 얼굴이 매번 달라지기 때문.
    // 임시 이미지로 채우고 이유를 남긴다. 다른 장면 제작은 계속 간다.
    if (characterScene && missingMaster) {
      const buf = await getPlaceholderImageProvider().generate({ prompt: scene.visual_prompt, sceneKey: `${reelId}-${scene.scene}` });
      fs.writeFileSync(target, buf);
      results.push({ scene: scene.scene, path: target, hash: `placeholder-${hash}`, cached: false, placeholder: true, reason: missingMaster, kind });
      done++; onProgress?.(done, scenes.length, "마스터 이미지 없음 — 캐릭터 장면 건너뜀");
      continue;
    }

    // 예산 상한 — 넘으면 남은 장면은 API 를 부르지 않는다 (§비용 제어)
    if (overBudget()) {
      usage.budgetHit = true;
      const buf = await getPlaceholderImageProvider().generate({ prompt: scene.visual_prompt, sceneKey: `${reelId}-${scene.scene}` });
      fs.writeFileSync(target, buf);
      results.push({ scene: scene.scene, path: target, hash: `placeholder-${hash}`, cached: false, placeholder: true, reason: `이미지 호출 상한(${policy.budgetCalls}회)에 도달해 이 장면은 만들지 않았습니다. 설정에서 상한을 올리거나, 나중에 이 장면만 다시 만들 수 있습니다.`, kind });
      done++; onProgress?.(done, scenes.length, `호출 상한 ${policy.budgetCalls}회 도달 — 남은 장면은 임시 이미지`);
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
      // 재시도는 등급이 정한다 — 배경·음식은 1회, 캐릭터는 장면당 상한(기본 2회)까지.
      // 대체 공급자는 언제나 1회만 (429 무한 재시도 금지).
      const maxTries = p_.name !== provider.name ? 1
        : characterScene ? Math.max(1, policy.maxCharacterGen)
        : 1 + tier.retries;
      for (let attempt = 0; attempt < maxTries && !ok; attempt++) {
        if (overBudget()) { usage.budgetHit = true; break; }
        if (attempt > 0) usage.retries++;
        usage.apiCalls++;
        try {
          const buf = await p_.generate({
            prompt: scene.visual_prompt,
            seed: lock.seed,
            referenceImagePaths: refPaths,
            sceneKey: `${reelId}-${scene.scene}`,
            characterScene,
            sceneKind: kind,
            tier: { steps: tier.steps, width: tier.width, height: tier.height },
          });
          fs.writeFileSync(target, buf);
          const fellBack = p_.name !== provider.name;
          if (fellBack && switchedTo !== p_.name) {
            switchedTo = p_.name;
            logWarn("images", `${provider.name} 실패 — ${p_.name} 공급자로 자동 전환했습니다`);
            onProgress?.(done, scenes.length, `${provider.name} 사용량 소진 — ${p_.name} 로 자동 전환`);
          }
          usage.created++;
          usage.byKind[kind]++;
          if (!usage.models.includes(p_.name)) usage.models.push(p_.name);
          results.push({ scene: scene.scene, path: target, hash, cached: false, placeholder: p_.name === "sample", provider: p_.name, fallback: fellBack, reason: p_.name === "sample" ? friendlyImageError(lastErr) : undefined, kind });
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
      results.push({ scene: scene.scene, path: target, hash: `placeholder-${hash}`, cached: false, placeholder: true, reason, kind });
    }
    // 이미지 옆에 어떻게 만들었는지 남긴다 — 나중에 "이 그림 뭘로 만들었지"를 파일만 보고 알 수 있게
    const last = results[results.length - 1];
    if (last && !last.cached) {
      try {
        fs.writeFileSync(target.replace(/\.jpg$/, ".json"), JSON.stringify({
          provider: last.provider ?? (last.placeholder ? "placeholder" : provider.name),
          scene_type: kind,
          quality_tier: tierFor(policy.costPolicy, kind),
          steps: tier.steps, width: tier.width, height: tier.height,
          asset_version: characterScene ? assets.version : undefined,
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
  lastImageUsage.value = usage;
  logInfo("images", `이미지 ${results.length}장 준비 (신규 ${usage.created} · 캐시 ${usage.reused} · 임시 ${placeholders})`, {
    apiCalls: usage.apiCalls, retries: usage.retries, savedByCache: usage.savedByCache,
    budget: usage.budget, budgetHit: usage.budgetHit, byKind: usage.byKind, models: usage.models,
  });
  return results;
}
