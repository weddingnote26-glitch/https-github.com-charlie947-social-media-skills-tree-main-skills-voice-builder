"use client";
import { useEffect, useState } from "react";
import { api, mediaUrl } from "./ui";

interface CheckLine { key: string; label: string; ok: boolean; detail: string; blocking: boolean }
export interface Preflight {
  reelId: string; title: string; caption: string; hashtags: string[];
  account: string; loginKind: "instagram" | "facebook"; mode: string;
  videoUrl: string | null; lines: CheckLine[]; canPublish: boolean; blockers: string[];
  alreadyPosted: { mediaId: string; permalink: string | null; at: string } | null;
}

/**
 * 막힌 항목마다 "어디서 푸는지" 를 알려 준다.
 *
 * 실제로 겪은 일: [게시하기] 가 회색인데 이유가 창 위쪽으로 스크롤되어 보이지 않아
 * "기능이 막혔다" 고 느끼셨다. 막는 검사 자체는 안전장치라 없애지 않고,
 * 대신 무엇을 하면 풀리는지 단추 바로 옆에 적는다.
 */
const HOW_TO_FIX: Record<string, string> = {
  token: "설정 → Instagram 에서 Access Token 을 넣고 [연결 테스트]",
  userId: "설정 → Instagram 에서 User ID 를 넣거나 [연결 테스트]로 찾기",
  review: "이 릴스의 [🔎 완성 콘텐츠 미리보기·검수]에서 다섯 항목 체크",
  publicUrl: "설정 → Instagram → [영상 공개 주소]에 인터넷 주소 넣기",
  publicFetch: "Cloudflare Tunnel 창이 켜져 있는지 확인 (설정 화면에 명령이 있습니다)",
  videoFile: "② 장면 편집에서 [💾 저장하고 영상 제작하기]",
  factcheck: "① 업체 정보 입력에서 확인 필요 항목 채우기",
  duplicate: "다시 올리시려면 위 [다시 게시]를 체크",
};

/** 같은 요청을 두 번 보내지 않도록 창을 열 때 열쇠를 하나 만든다 */
function newRequestKey(): string {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * §7 실제 게시 전 최종 확인창.
 *
 * 단추를 누르는 즉시 API 를 호출하지 않는다.
 * 어떤 영상이, 어떤 글로, 어느 계정에 나가는지 눈으로 본 뒤
 * [게시하기] 를 눌러야만 실제로 올라간다.
 */
export default function PublishDialog({ reelId, videoPath, onClose, onPublished }: {
  reelId: string;
  videoPath: string | null;
  onClose: () => void;
  onPublished: (mediaJobId: string) => void;
}) {
  const [pre, setPre] = useState<Preflight | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<string>("");
  const [agree, setAgree] = useState(false);
  const [republish, setRepublish] = useState(false);
  const [requestKey] = useState(newRequestKey);

  useEffect(() => {
    let alive = true;
    setPhase("Instagram 연결 확인 중");
    api<Preflight>(`/api/reels/${reelId}/publish`)
      .then((p) => { if (alive) { setPre(p); setPhase(""); } })
      .catch((e) => { if (alive) { setErr(e instanceof Error ? e.message : String(e)); setPhase(""); } });
    return () => { alive = false; };
  }, [reelId]);

  const publish = async () => {
    setBusy(true); setErr(null);
    try {
      setPhase("영상 업로드 준비 중");
      const r = await api<{ jobId: string; reused: boolean }>(`/api/reels/${reelId}/publish`, {
        method: "POST",
        body: JSON.stringify({ confirmed: true, requestKey, republish: republish || undefined }),
      });
      setPhase(r.reused ? "이미 보낸 요청입니다 — 진행 상황을 확인합니다" : "Instagram에서 영상을 처리 중");
      onPublished(r.jobId);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setPhase("게시 실패");
      setBusy(false);
    }
  };

  const video = mediaUrl(videoPath);
  const canGo = !!pre && (pre.canPublish || (republish && pre.blockers.every((b) => b.startsWith("중복 게시")))) && agree && !busy;
  /* 화면에 보여 줄 "막는 이유". [다시 게시] 를 체크했으면 중복 항목은 이미 푼 것이므로 뺀다. */
  const blockingLines = (pre?.lines ?? []).filter(
    (l) => l.blocking && !l.ok && !(republish && l.key === "duplicate"),
  );

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4"
      role="dialog" aria-modal="true" aria-label="발행 최종 확인">
      <div className="w-full max-w-2xl my-6 rounded-2xl bg-white shadow-xl">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-xl font-extrabold">🚀 발행 전 마지막 확인</h2>
          <p className="text-sm text-gray-600 mt-1">
            아래 내용이 그대로 인스타그램에 올라갑니다. 눈으로 확인해 주세요.
          </p>
        </div>

        <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
          {!pre && !err && <div className="text-center text-gray-600 py-10">{phase || "불러오는 중…"}</div>}

          {pre && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-[160px_minmax(0,1fr)] gap-4">
                {video
                  ? <video className="w-full rounded-xl bg-black" src={video} controls preload="metadata" />
                  : <div className="rounded-xl bg-gray-100 h-40 flex items-center justify-center text-sm text-gray-600">영상 없음</div>}
                <div className="min-w-0">
                  <div className="font-bold break-keep">{pre.title}</div>
                  <div className="text-sm text-gray-600 mt-1">
                    올라갈 계정 <b className="text-gray-900">{pre.account}</b>
                    <span className="badge bg-gray-100 text-gray-700 ml-2">
                      {pre.loginKind === "instagram" ? "Instagram 로그인" : "Facebook 로그인"}
                    </span>
                  </div>
                  <div className="mt-2 rounded-xl border border-gray-200 bg-gray-50 p-2 text-sm max-h-28 overflow-y-auto whitespace-pre-wrap break-words">
                    {pre.caption || "(본문 없음)"}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {pre.hashtags.map((h) => <span key={h} className="badge bg-[#FDEDE5] text-[#B84A1B]">{h}</span>)}
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-gray-200 divide-y divide-gray-100">
                {pre.lines.map((l) => (
                  <div key={l.key} className="flex items-start gap-2 p-2.5 text-sm">
                    <span className="shrink-0">{l.ok ? "✅" : l.blocking ? "❌" : "⚠"}</span>
                    <span className="font-bold shrink-0 w-32 break-keep">{l.label}</span>
                    <span className="text-gray-700 break-words min-w-0">{l.detail}</span>
                  </div>
                ))}
              </div>

              {pre.alreadyPosted && (
                <label className="flex items-start gap-3 rounded-xl border-2 border-amber-300 bg-amber-50 p-3 cursor-pointer">
                  <input type="checkbox" className="mt-1 w-5 h-5 accent-[#E86A3A] shrink-0"
                    checked={republish} onChange={(e) => setRepublish(e.target.checked)} />
                  <span className="text-sm text-amber-900">
                    <b>다시 게시</b> — 이미 {pre.alreadyPosted.at} 에 올린 릴스입니다. 한 번 더 올리려면 여기를 눌러 주세요.
                  </span>
                </label>
              )}

              <div className="rounded-xl border-2 border-[#E86A3A] bg-[#FFF9F6] p-4">
                <p className="font-bold text-[#B84A1B] break-keep">
                  이 영상을 {pre.account} 계정에 지금 공개하시겠습니까?
                </p>
                <p className="text-sm text-gray-700 mt-1">
                  게시 후에는 Instagram에서 직접 수정하거나 삭제해야 합니다.
                </p>
                <label className="flex items-center gap-3 mt-3 cursor-pointer">
                  <input type="checkbox" className="w-5 h-5 accent-[#E86A3A]"
                    checked={agree} onChange={(e) => setAgree(e.target.checked)} />
                  <span className="text-sm font-bold">확인했습니다. 지금 공개합니다.</span>
                </label>
              </div>
            </>
          )}

          {phase && busy && (
            <div className="rounded-xl bg-blue-50 border border-blue-200 p-3 text-sm text-blue-800">{phase}</div>
          )}
          {err && (
            <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-sm text-red-700 break-words">{err}</div>
          )}
        </div>

        <div className="p-6 border-t border-gray-200 space-y-3">
          {/* 왜 못 누르는지 단추 바로 옆에 적는다 — 이유가 스크롤 위로 숨으면 "고장" 처럼 보인다 */}
          {pre && !busy && blockingLines.length > 0 && (
            <div className="rounded-xl bg-red-50 border border-red-200 p-3">
              <p className="text-sm font-bold text-red-800">
                지금은 게시할 수 없습니다 — {blockingLines.length}가지를 먼저 해결해 주세요
              </p>
              <ul className="mt-1.5 space-y-1.5">
                {blockingLines.map((l) => (
                  <li key={l.key} className="text-sm text-red-800">
                    <b>{l.label}</b> — {l.detail}
                    {HOW_TO_FIX[l.key] && (
                      <div className="text-xs text-red-700 mt-0.5">→ {HOW_TO_FIX[l.key]}</div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {pre && !busy && blockingLines.length === 0 && !agree && (
            <p className="text-sm text-gray-700">
              위 <b>확인했습니다. 지금 공개합니다.</b> 에 체크하시면 [게시하기] 가 켜집니다.
            </p>
          )}

          <div className="flex flex-wrap gap-2 justify-end">
            <button className="btn-secondary" onClick={onClose} disabled={busy}>취소</button>
            <button className="btn-primary" disabled={!canGo} onClick={() => void publish()}>
              {busy ? "게시 중…" : "게시하기"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
