"use client";
import { useEffect, useRef, useState } from "react";
import { Card, ErrorBox, api, useApi, mediaUrl } from "./ui";
import { useToast } from "./Toast";

/* 서버가 돌려주는 모양 (src/app/api/branding/route.ts) */
interface SlotStatus { file: string; seconds: number; exists: boolean; path: string | null }
interface BrandStatus { intro: SlotStatus; outro: SlotStatus; applyToReels: boolean; applyToImported: boolean }

const SLOT_LABEL = { intro: "인트로 (맨 앞)", outro: "아웃트로 (맨 뒤)" } as const;
const OK_TYPES = ["image/png", "image/jpeg", "image/webp"];

/**
 * 인트로 · 아웃트로 설정 — 로고·배너 그림을 올리고, 몇 초 보여 줄지 정한다.
 * 그림은 완성 영상의 맨 앞과 맨 뒤에 장면으로 붙는다 (pipeline/branding.ts).
 */
export default function BrandingCard() {
  const { data, error, reload } = useApi<BrandStatus>("/api/branding");
  const toast = useToast();
  const [draft, setDraft] = useState<BrandStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const inputs = { intro: useRef<HTMLInputElement>(null), outro: useRef<HTMLInputElement>(null) };

  // 서버 값이 오면 편집본을 그것으로 맞춘다 (올리기·지우기 뒤에도 다시 맞춘다)
  useEffect(() => { if (data) setDraft(data); }, [data]);

  const upload = async (slot: "intro" | "outro", file: File | undefined) => {
    if (!file) return;
    setErr(null);
    if (!OK_TYPES.includes(file.type)) { setErr("PNG · JPG · WEBP 그림만 올릴 수 있습니다."); return; }
    setBusy(slot);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(new Error(`${file.name} 을(를) 읽지 못했습니다`));
        r.readAsDataURL(file);
      });
      await api("/api/branding", { method: "POST", body: JSON.stringify({ action: "upload", slot, dataUrl }) });
      reload();
      toast.success(`${SLOT_LABEL[slot]} 그림을 바꿨습니다.`, ["다음에 만드는 영상부터 붙습니다."]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      const el = inputs[slot].current; if (el) el.value = "";
    }
  };

  const clear = async (slot: "intro" | "outro") => {
    setErr(null); setBusy(slot);
    try {
      await api("/api/branding", { method: "POST", body: JSON.stringify({ action: "clear", slot }) });
      reload();
      toast.info(`${SLOT_LABEL[slot]}을(를) 떼었습니다.`, ["올려 둔 그림 파일은 지우지 않았습니다."]);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };

  const save = async () => {
    if (!draft) return;
    setErr(null); setBusy("save");
    try {
      await api("/api/settings", {
        method: "PUT",
        body: JSON.stringify({ branding: {
          intro: { file: draft.intro.file, seconds: draft.intro.seconds },
          outro: { file: draft.outro.file, seconds: draft.outro.seconds },
          applyToReels: draft.applyToReels, applyToImported: draft.applyToImported,
        } }),
      });
      reload();
      toast.success("인트로·아웃트로 설정을 저장했습니다.", [
        `인트로 ${draft.intro.seconds}초 · 아웃트로 ${draft.outro.seconds}초`,
        `맛집 릴스 ${draft.applyToReels ? "적용" : "미적용"} · 외부 영상 ${draft.applyToImported ? "적용" : "미적용"}`,
      ]);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };

  return (
    <Card title="🎞 인트로 · 아웃트로 (로고 · 배너)" collapsible>
      <p className="text-sm text-gray-600 mb-4">
        모든 완성 영상의 <b>맨 앞</b>과 <b>맨 뒤</b>에 그림 장면을 붙입니다. 붙인 만큼 영상이 길어지니 2초 안팎을 권합니다.
        그림은 영상 크기에 맞춰 줄이고 남는 자리는 검게 채웁니다. 세로 영상(1080×1920)에 맞춘 그림이 가장 깔끔합니다.
      </p>
      <ErrorBox msg={err ?? error} />
      {draft && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            {(["intro", "outro"] as const).map((slot) => {
              const st = draft[slot];
              const preview = st.exists ? mediaUrl(st.path) : null;
              return (
                <div key={slot} className="rounded-xl border-2 border-gray-200 p-4">
                  <div className="font-bold mb-2">{SLOT_LABEL[slot]}</div>
                  <div className="flex items-start gap-3">
                    <div className="w-24 h-40 rounded-lg bg-gray-100 border border-gray-200 flex items-center justify-center overflow-hidden shrink-0">
                      {preview
                        ? <img src={preview} alt={`${SLOT_LABEL[slot]} 그림`} className="max-w-full max-h-full object-contain" />
                        : <span className="text-xs text-gray-500 text-center px-1">아직 그림 없음</span>}
                    </div>
                    <div className="flex-1 min-w-0 space-y-2">
                      <input ref={inputs[slot]} type="file" accept="image/png,image/jpeg,image/webp" hidden
                        onChange={(e) => upload(slot, e.target.files?.[0])} />
                      <div className="flex flex-wrap gap-2">
                        <button className="btn-secondary" disabled={busy !== null} onClick={() => inputs[slot].current?.click()}>
                          {busy === slot ? "올리는 중…" : st.exists ? "🖼 그림 바꾸기" : "🖼 그림 올리기"}
                        </button>
                        {st.file && (
                          <button className="btn-ghost text-red-600 hover:bg-red-50" disabled={busy !== null} onClick={() => clear(slot)}>떼기</button>
                        )}
                      </div>
                      {st.file && !st.exists && <p className="text-xs text-amber-800">⚠ 설정된 파일({st.file})을 찾을 수 없습니다. 다시 올려 주세요.</p>}
                      <div>
                        <label className="label text-sm">보여 주는 시간 ({st.seconds}초)</label>
                        <input type="range" min="0.5" max="10" step="0.5" className="range" value={st.seconds}
                          onChange={(e) => setDraft({ ...draft, [slot]: { ...st, seconds: parseFloat(e.target.value) } })} />
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-4 mb-4 text-sm">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" className="w-5 h-5 accent-[#E86A3A]" checked={draft.applyToReels}
                onChange={(e) => setDraft({ ...draft, applyToReels: e.target.checked })} />
              맛집 릴스에 붙이기
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" className="w-5 h-5 accent-[#E86A3A]" checked={draft.applyToImported}
                onChange={(e) => setDraft({ ...draft, applyToImported: e.target.checked })} />
              외부 영상 AI 음성 결과에 붙이기
            </label>
          </div>
          <button className="btn-primary" disabled={busy !== null} onClick={save}>{busy === "save" ? "저장 중…" : "저장"}</button>
          <p className="text-xs text-gray-600 mt-2">그림을 붙이기 전 영상은 같은 폴더에 <code className="bg-gray-100 px-1 rounded">.raw.mp4</code> 로 남습니다.</p>
        </>
      )}
    </Card>
  );
}
