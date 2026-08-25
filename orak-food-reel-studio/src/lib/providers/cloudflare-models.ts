/**
 * Cloudflare Workers AI 이미지 모델 — 기본값과 모델별 성질.
 *
 * 모델 이름은 어디에도 박아 넣지 않는다. 여기 있는 값은 "설정이 비었을 때
 * 쓰는 기본값" 일 뿐이고, 사용자가 설정 화면에서 언제든 바꿀 수 있다.
 * 계정에서 실제로 쓸 수 있는 모델 목록은 [모델 목록 불러오기]로 확인한다.
 *
 * 모델마다 받는 값과 돌려주는 모양이 다르다:
 *   · FLUX 계열   — JSON { result: { image: "<base64>" } }, negative_prompt 없음
 *   · SD/SDXL 계열 — 이미지 바이트 그대로, negative_prompt 와 참조 이미지 받음
 * 그래서 응답은 Content-Type 을 보고 갈라 읽는다 (모델 이름으로 짐작하지 않는다).
 */

/** 설정이 비었을 때 쓰는 일반 장면용 모델 — 빠르고 무료 사용량을 적게 먹는다 */
export const DEFAULT_IMAGE_MODEL = "@cf/black-forest-labs/flux-1-schnell";

/**
 * 설정이 비었을 때 쓰는 캐릭터 장면용 모델.
 * 오락이는 매번 같은 얼굴이어야 하므로 참조 이미지를 받을 수 있는 모델이어야 한다.
 */
export const DEFAULT_CHARACTER_MODEL = "@cf/bytedance/stable-diffusion-xl-lightning";

export interface ModelCapability {
  /** negative_prompt 를 받는가 */
  negativePrompt: boolean;
  /** 참조 이미지(image_b64)를 받는가 — 캐릭터 일관성에 필요 */
  referenceImage: boolean;
  /** 가로·세로를 지정할 수 있는가 (못 하면 만든 뒤 9:16 으로 잘라 쓴다) */
  size: boolean;
}

/**
 * 모델 이름으로 성질을 짐작한다.
 *
 * 짐작이 틀려도 제작이 멈추지는 않는다 — 안 받는 값을 보내 400 이 나면
 * 그 값을 빼고 한 번 더 시도한다(cloudflare-image.ts 참고).
 */
export function capabilityOf(model: string): ModelCapability {
  const m = model.toLowerCase();
  if (m.includes("flux")) {
    // FLUX schnell 은 프롬프트와 steps 만 받는다
    return { negativePrompt: false, referenceImage: false, size: false };
  }
  if (m.includes("stable-diffusion") || m.includes("sdxl") || m.includes("dreamshaper")) {
    return { negativePrompt: true, referenceImage: true, size: true };
  }
  // 모르는 모델은 가장 좁게 잡는다 — 안 받는 값을 보내 거절당하는 편보다 낫다
  return { negativePrompt: false, referenceImage: false, size: false };
}

/** 모델 이름이 Workers AI 모양인지 (@cf/제작사/이름) */
export function looksLikeCfModel(model: string): boolean {
  return /^@cf\/[a-z0-9._-]+\/[a-z0-9._-]+$/i.test(model.trim());
}
