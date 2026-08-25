import fs from "node:fs";
import { resolveIgAuth, igAuthStatus } from "./providers/instagram";
import { checkPublicMediaUrl } from "./media-url";
import { resolvePublicMediaBase, publicUrlFor } from "./scheduler";
import { publishBlockReason } from "./review";
import { getReel } from "./reels";
import { videoInfo } from "./video-info";
import { db, j } from "./db";
import { getAppMode } from "./secrets";

/**
 * §6 실제 게시 직전에 하나씩 미리 확인한다.
 *
 * 눌러 놓고 한참 뒤에 "400" 만 보는 일을 없애기 위해서다.
 * 여기서는 인스타그램에 아무것도 올리지 않는다 — 확인만 한다.
 */
export interface CheckLine {
  key: string;
  label: string;
  ok: boolean;
  detail: string;
  /** 못 넘어가면 발행을 막는다. 경고면 알리기만 한다. */
  blocking: boolean;
}

export interface PublishPreflight {
  reelId: string;
  title: string;
  caption: string;
  hashtags: string[];
  account: string;
  loginKind: "instagram" | "facebook";
  mode: string;
  videoUrl: string | null;
  lines: CheckLine[];
  canPublish: boolean;
  blockers: string[];
  alreadyPosted: { mediaId: string; permalink: string | null; at: string } | null;
}

export async function publishPreflight(reelId: string): Promise<PublishPreflight> {
  const reel = getReel(reelId);
  if (!reel) throw new Error("릴스를 찾을 수 없습니다");

  const auth = resolveIgAuth();
  const status = igAuthStatus();
  const lines: CheckLine[] = [];
  const add = (key: string, label: string, ok: boolean, detail: string, blocking = true) =>
    lines.push({ key, label, ok, detail, blocking });

  // 1) 계정과 토큰 — 토큰 자체는 절대 화면에 보내지 않는다 (앞뒤 몇 글자만)
  add("token", "Instagram Access Token", !!auth.token,
    auth.token ? `저장돼 있습니다 (${status.tokenHint}) · ${status.tokenSource}` : "토큰이 없습니다. 설정 → Instagram 에서 넣어 주세요.");
  add("userId", "Instagram User ID", !!auth.userId,
    auth.userId ? `${auth.userId} · ${status.userIdSource}` : "계정 ID 가 없습니다. 설정 → Instagram 에서 넣어 주세요.");
  add("login", "연동 방식", true,
    auth.kind === "instagram"
      ? "Instagram Login — graph.instagram.com · instagram_business_basic, instagram_business_content_publish"
      : "Facebook Login — graph.facebook.com · instagram_basic, instagram_content_publish",
    false);

  // 2) 발행 전 검수 · 팩트체크 · 영상 (§5 와 같은 관문)
  const blocked = publishBlockReason(reelId);
  add("review", "발행 전 검수", !blocked, blocked ?? "다섯 항목을 모두 확인했습니다.");

  // 3) 공개 주소 — 인스타그램 서버가 직접 내려받을 수 있어야 한다
  const base = resolvePublicMediaBase();
  const urlCheck = checkPublicMediaUrl(base);
  add("publicUrl", "공개 영상 주소", !!base && urlCheck.ok,
    !base
      ? "공개 주소가 설정돼 있지 않습니다. Instagram 서버가 영상을 내려받을 수 있어야 합니다 (설정 → Instagram → 공개 영상 주소)."
      : urlCheck.ok ? `${base}${urlCheck.warn ? ` — ${urlCheck.warn}` : ""}` : (urlCheck.reason ?? "주소를 확인해 주세요."));

  // 4) 영상 파일 자체
  const info = await videoInfo(reel.video_path, reel.srt_path);
  const fmtOk = info.exists && /\.(mp4|mov)$/i.test(reel.video_path ?? "");
  add("videoFile", "영상 파일", fmtOk,
    !info.exists ? "완성된 영상 파일이 없습니다."
      : fmtOk ? `${info.sizeText} · ${info.ratio} · ${info.durationSec ?? "?"}초`
      : "MP4 또는 MOV 만 올릴 수 있습니다.");
  if (info.notes.length) add("videoNote", "영상 확인 사항", false, info.notes.join(" / "), false);

  // 5) 이미 올라간 적이 있는가
  const posted = db().prepare(
    "SELECT ig_media_id, permalink, published_at FROM instagram_posts WHERE reel_id=? ORDER BY published_at DESC LIMIT 1"
  ).get(reelId) as { ig_media_id: string; permalink: string | null; published_at: string } | undefined;
  if (posted) {
    add("duplicate", "중복 게시", false,
      `이미 ${posted.published_at} 에 올라간 릴스입니다 (미디어 ID ${posted.ig_media_id}).`);
  }

  const blockers = lines.filter((l) => l.blocking && !l.ok).map((l) => `${l.label}: ${l.detail}`);
  return {
    reelId,
    title: reel.title,
    caption: reel.caption,
    hashtags: j<string[]>(reel.hashtags_json, []),
    account: status.userId ? `@${status.userId}` : "(계정 미설정)",
    loginKind: auth.kind,
    mode: getAppMode(),
    videoUrl: reel.video_path && base ? publicUrlFor(reel.video_path) : null,
    lines,
    canPublish: blockers.length === 0,
    blockers,
    alreadyPosted: posted ? { mediaId: posted.ig_media_id, permalink: posted.permalink, at: posted.published_at } : null,
  };
}

/** 파일이 실제로 있는지만 빠르게 (컨테이너 만들기 직전에 한 번 더) */
export function videoStillThere(videoPath: string | null): boolean {
  return !!videoPath && fs.existsSync(videoPath);
}
