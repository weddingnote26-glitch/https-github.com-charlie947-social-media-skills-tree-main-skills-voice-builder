/** §40 API Adapter 구조 — 공급자를 바꿔도 프로젝트 전체를 고치지 않도록 인터페이스 분리 */

export type LLMTask = "research" | "idea" | "script" | "caption" | "revision" | "benchmark" | "verdict";

export interface LLMProvider {
  readonly name: string;
  /** system+user 프롬프트로 텍스트(주로 JSON) 생성 */
  complete(req: { system: string; user: string; task: LLMTask; maxTokens?: number; context?: unknown }): Promise<string>;
}

export interface ImageProvider {
  readonly name: string;
  /** 9:16 이미지 생성 → JPEG/PNG Buffer */
  generate(req: { prompt: string; seed?: number; referenceImagePaths?: string[]; sceneKey?: string }): Promise<Buffer>;
}

export interface TTSProvider {
  readonly name: string;
  synthesize(req: {
    text: string;
    voiceId?: string; model?: string;
    speed?: number; stability?: number; similarity?: number;
  }): Promise<Buffer>; // mp3
}

export type ContainerStatus = "IN_PROGRESS" | "FINISHED" | "ERROR" | "PUBLISHED" | "EXPIRED";

export interface PublishingProvider {
  readonly name: string;
  createReelContainer(req: { videoUrl: string; caption: string; coverUrl?: string }): Promise<{ containerId: string }>;
  getContainerStatus(containerId: string): Promise<{ status: ContainerStatus; detail?: string }>;
  publish(containerId: string): Promise<{ mediaId: string }>;
  getPermalink(mediaId: string): Promise<string>;
  getInsights(mediaId: string): Promise<Record<string, number>>;
}
