"use client";
import { useEffect, useRef, useState } from "react";
import { api, useApi, ErrorBox } from "./ui";
import { checkVoiceId } from "@/lib/providers/voice-id";

interface Voice {
  id: string;
  name: string;
  category: string;
  labels: Record<string, string>;
  previewUrl: string;
}
interface VoicesResponse {
  ready: boolean;
  voices: Voice[];
  selected: string;
  notice?: string;
}

/** 라벨 값을 한국어로 (없는 값은 원문 그대로) */
const LABEL_KO: Record<string, string> = {
  male: "남성", female: "여성", neutral: "중성",
  young: "젊은 톤", "middle aged": "30~40대", "middle-aged": "30~40대", old: "장년 톤",
  korean: "한국어", american: "미국식", british: "영국식",
  calm: "차분함", casual: "편안함", confident: "자신감", friendly: "친근함",
  cheerful: "밝음", warm: "따뜻함", narration: "내레이션", conversational: "대화체",
  news: "뉴스", "social media": "소셜미디어", characters: "캐릭터",
};
const ko = (v: string) => LABEL_KO[v.toLowerCase()] ?? v;

/** 직접 입력한 값이 목소리 ID 형태가 아니면 저장 전에 알려준다 */
function ManualWarning({ value }: { value: string }) {
  const v = value.trim();
  if (!v) return null;
  const check = checkVoiceId(v);
  if (check.ok) return null;
  return (
    <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-2 font-semibold">
      ⚠ {check.reason}
    </p>
  );
}

/**
 * §16 ElevenLabs 목소리 선택기.
 * Voice ID를 외워서 붙여넣는 대신 계정에 등록된 목소리를 불러와
 * 들어보고 고를 수 있게 합니다.
 */
export default function VoicePicker({
  value,
  onChange,
  refreshToken = 0,
}: {
  value: string;
  onChange: (voiceId: string) => void;
  /** 이 값이 바뀌면 목록을 다시 불러온다 (키를 저장한 직후 등) */
  refreshToken?: number;
}) {
  const { data, error, loading, reload } = useApi<VoicesResponse>("/api/voices");
  const [playing, setPlaying] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // 키를 저장해도 목록이 그대로여서 "키가 없습니다" 가 계속 보이던 문제.
  // 저장 직후 다시 불러온다.
  const lastToken = useRef(refreshToken);
  useEffect(() => {
    if (lastToken.current !== refreshToken) {
      lastToken.current = refreshToken;
      reload();
    }
  }, [refreshToken, reload]);

  const stop = () => {
    audioRef.current?.pause();
    audioRef.current = null;
    setPlaying(null);
  };

  const play = (url: string, key: string) => {
    stop();
    const a = new Audio(url);
    audioRef.current = a;
    setPlaying(key);
    a.onended = () => setPlaying(null);
    a.onerror = () => { setErr("미리듣기를 재생할 수 없습니다."); setPlaying(null); };
    void a.play().catch(() => { setErr("브라우저가 재생을 막았습니다. 한 번 더 눌러 주세요."); setPlaying(null); });
  };

  /** 실제 한국어 문장으로 생성해서 듣기 (크레딧 소모) */
  const playKorean = async (voiceId: string) => {
    setErr(null); setBusy(voiceId); stop();
    try {
      const res = await fetch("/api/voices/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ voiceId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: `오류 ${res.status}` }));
        throw new Error(body.error ?? `오류 ${res.status}`);
      }
      const blob = await res.blob();
      play(URL.createObjectURL(blob), `ko-${voiceId}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <div className="text-sm text-gray-400 py-4">목소리 목록을 불러오는 중…</div>;

  if (error || !data?.ready) {
    return (
      <div className="space-y-3">
        <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900">
          {data?.notice ?? error ?? "목소리 목록을 불러오지 못했습니다."}
        </div>
        <div>
          <label className="label text-sm">VOICE ID 직접 입력</label>
          <input className="input py-2 text-sm" value={value} onChange={(e) => onChange(e.target.value)}
            placeholder="21m00Tcm4TlvDq8ikWAM" />
          <ManualWarning value={value} />
        </div>
        <button className="btn-secondary px-4 py-2 text-sm" onClick={reload}>다시 불러오기</button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm text-gray-500">
          내 계정에 등록된 목소리 <b>{data.voices.length}개</b> — 들어보고 고르세요
        </span>
        <div className="flex gap-2">
          <button className="btn-ghost text-xs" onClick={reload}>새로고침</button>
          <button className="btn-ghost text-xs" onClick={() => setManual((m) => !m)}>
            {manual ? "목록에서 고르기" : "ID 직접 입력"}
          </button>
        </div>
      </div>

      <ErrorBox msg={err} />

      {manual ? (
        <div>
          <input className="input py-2 text-sm" value={value} onChange={(e) => onChange(e.target.value)}
            placeholder="21m00Tcm4TlvDq8ikWAM" />
          <ManualWarning value={value} />
        </div>
      ) : (
        <div className="max-h-96 overflow-y-auto space-y-2 pr-1">
          {data.voices.map((v) => {
            const selected = v.id === value;
            return (
              <div key={v.id}
                onClick={() => onChange(v.id)}
                className={`cursor-pointer rounded-xl border-2 p-3 transition ${
                  selected ? "border-[#E86A3A] bg-[#FDEDE5]" : "border-gray-200 hover:border-gray-300"
                }`}>
                <div className="flex items-center gap-3">
                  <div className={`w-5 h-5 rounded-full border-2 shrink-0 ${selected ? "border-[#E86A3A] bg-[#E86A3A]" : "border-gray-300"}`}>
                    {selected && <div className="w-full h-full flex items-center justify-center text-white text-[11px] font-bold">✓</div>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-bold truncate">{v.name}</div>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {Object.entries(v.labels).slice(0, 4).map(([k, val]) => (
                        <span key={k} className="badge bg-gray-100 text-gray-600">{ko(String(val))}</span>
                      ))}
                      {v.category && <span className="badge bg-gray-100 text-gray-500">{v.category}</span>}
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                    {v.previewUrl && (
                      <button className="btn-ghost text-xs px-2.5"
                        onClick={() => (playing === v.id ? stop() : play(v.previewUrl, v.id))}>
                        {playing === v.id ? "■ 정지" : "▶ 샘플"}
                      </button>
                    )}
                    <button className="btn-ghost text-xs px-2.5" disabled={busy === v.id}
                      title="이 목소리로 한국어 문장을 실제 생성해서 들어봅니다 (크레딧 소모)"
                      onClick={() => (playing === `ko-${v.id}` ? stop() : playKorean(v.id))}>
                      {busy === v.id ? "생성 중…" : playing === `ko-${v.id}` ? "■ 정지" : "🇰🇷 한국어"}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
          {data.voices.length === 0 && (
            <div className="text-sm text-gray-500 py-6 text-center">
              등록된 목소리가 없습니다.<br />
              ElevenLabs의 <b>Voice Library</b>에서 마음에 드는 목소리를 <b>Add to My Voices</b> 한 뒤 새로고침하세요.
            </div>
          )}
        </div>
      )}

      <p className="text-xs text-gray-400">
        ▶ 샘플은 ElevenLabs가 제공하는 기본 미리듣기(대부분 영어)이고,
        🇰🇷 한국어는 실제로 한 문장을 생성해 들려줍니다 — 크레딧이 조금 소모되니 최종 후보만 눌러 보세요.
      </p>
    </div>
  );
}
