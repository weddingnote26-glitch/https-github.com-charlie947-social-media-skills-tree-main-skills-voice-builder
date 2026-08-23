"use client";
import { useEffect, useState } from "react";
import { Card, api, useApi, ErrorBox } from "@/components/ui";
import type { AppSettings } from "@/lib/settings";

type Services = Record<"llm" | "image" | "tts" | "instagram", boolean>;

export default function SettingsPage() {
  const { data, reload } = useApi<{ settings: AppSettings; services: Services }>("/api/settings");
  const [s, setS] = useState<AppSettings | null>(null);
  const [igToken, setIgToken] = useState("");
  const [igUser, setIgUser] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, string>>({});

  useEffect(() => { if (data && !s) setS(data.settings); }, [data, s]);
  if (!data || !s) return <div className="text-gray-400 py-20 text-center">불러오는 중…</div>;

  const save = async (patch: Partial<AppSettings> & { igAccessToken?: string; igUserId?: string }) => {
    setErr(null); setMsg(null);
    try {
      const out = await api<{ settings: AppSettings }>("/api/settings", { method: "PUT", body: JSON.stringify(patch) });
      setS(out.settings); setMsg("저장했습니다."); reload();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  };

  const test = async (service: string) => {
    setTestResult((t) => ({ ...t, [service]: "테스트 중…" }));
    try {
      const r = await api<{ ok: boolean; detail: string }>("/api/settings/test", { method: "POST", body: JSON.stringify({ service }) });
      setTestResult((t) => ({ ...t, [service]: `${r.ok ? "✅" : "❌"} ${r.detail}` }));
    } catch (e) { setTestResult((t) => ({ ...t, [service]: `❌ ${e instanceof Error ? e.message : e}` })); }
  };

  const TestBtn = ({ service }: { service: string }) => (
    <div className="flex items-center gap-3">
      <button className="btn-secondary px-4 py-2 text-sm" onClick={() => test(service)}>🔌 연결 테스트</button>
      {testResult[service] && <span className="text-sm font-semibold">{testResult[service]}</span>}
    </div>
  );

  const DAY_KO: Record<string, string> = { mon: "월", tue: "화", wed: "수", thu: "목", fri: "금", sat: "토", sun: "일" };

  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-extrabold">⚙️ 설정</h1>
      {msg && <div className="card p-3 px-4 bg-emerald-50 border-emerald-200 text-emerald-800 text-sm font-bold">{msg}</div>}
      <ErrorBox msg={err} />

      <Card title="🤖 AI (Claude) — 대본·캡션·기획">
        <p className="text-sm text-gray-500 mb-2">API 키는 프로그램 폴더의 <b>.env</b> 파일에 넣습니다: <code className="bg-gray-100 px-1 rounded">ANTHROPIC_API_KEY=...</code></p>
        <TestBtn service="llm" />
      </Card>

      <Card title="🎙 ElevenLabs — AI 음성">
        <p className="text-sm text-gray-500 mb-3">.env에 <code className="bg-gray-100 px-1 rounded">ELEVENLABS_API_KEY</code>, <code className="bg-gray-100 px-1 rounded">ELEVENLABS_VOICE_ID</code>를 넣으세요. 아래 세부 값은 바로 저장됩니다.</p>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div><label className="label text-sm">VOICE ID (설정 화면 우선)</label>
            <input className="input py-2 text-sm" value={s.tts.voiceId} onChange={(e) => setS({ ...s, tts: { ...s.tts, voiceId: e.target.value } })} /></div>
          <div><label className="label text-sm">Model</label>
            <input className="input py-2 text-sm" value={s.tts.model} onChange={(e) => setS({ ...s, tts: { ...s.tts, model: e.target.value } })} /></div>
          <div><label className="label text-sm">Speed ({s.tts.speed})</label>
            <input type="range" min="0.7" max="1.2" step="0.01" className="w-full accent-[#E86A3A]" value={s.tts.speed} onChange={(e) => setS({ ...s, tts: { ...s.tts, speed: parseFloat(e.target.value) } })} /></div>
          <div><label className="label text-sm">Stability ({s.tts.stability})</label>
            <input type="range" min="0" max="1" step="0.05" className="w-full accent-[#E86A3A]" value={s.tts.stability} onChange={(e) => setS({ ...s, tts: { ...s.tts, stability: parseFloat(e.target.value) } })} /></div>
          <div><label className="label text-sm">Similarity ({s.tts.similarity})</label>
            <input type="range" min="0" max="1" step="0.05" className="w-full accent-[#E86A3A]" value={s.tts.similarity} onChange={(e) => setS({ ...s, tts: { ...s.tts, similarity: parseFloat(e.target.value) } })} /></div>
        </div>
        <div className="flex gap-3"><button className="btn-primary px-4 py-2 text-sm" onClick={() => save({ tts: s.tts })}>저장</button><TestBtn service="tts" /></div>
      </Card>

      <Card title="🖼 이미지 생성">
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div><label className="label text-sm">공급자</label>
            <select className="input py-2 text-sm" value={s.imageProvider} onChange={(e) => setS({ ...s, imageProvider: e.target.value as AppSettings["imageProvider"] })}>
              <option value="sample">Sample (API 불필요)</option>
              <option value="gemini">Gemini / Imagen</option>
              <option value="openai">OpenAI 이미지</option>
            </select></div>
          <div><label className="label text-sm">모델 (비우면 기본값)</label>
            <input className="input py-2 text-sm" placeholder="imagen-3.0-generate-002 / gpt-image-1" value={s.imageModel} onChange={(e) => setS({ ...s, imageModel: e.target.value })} /></div>
        </div>
        <p className="text-sm text-gray-500 mb-3">API 키는 .env의 <code className="bg-gray-100 px-1 rounded">IMAGE_API_KEY</code>에 넣습니다.</p>
        <div className="flex gap-3"><button className="btn-primary px-4 py-2 text-sm" onClick={() => save({ imageProvider: s.imageProvider, imageModel: s.imageModel })}>저장</button><TestBtn service="image" /></div>
      </Card>

      <Card title="📸 Instagram — Meta 공식 API">
        <ol className="text-sm text-gray-600 space-y-1 mb-4 list-decimal pl-5">
          <li>Instagram을 <b>Professional(비즈니스/크리에이터) 계정</b>으로 전환</li>
          <li>Facebook 페이지와 연결 후 <a className="text-[#E86A3A] font-bold" href="https://developers.facebook.com" target="_blank">developers.facebook.com</a>에서 앱 생성</li>
          <li>권한 <code className="bg-gray-100 px-1 rounded">instagram_content_publish</code> 포함 Access Token 발급</li>
          <li>아래에 토큰과 IG User ID 입력 (토큰은 <b>암호화되어</b> 저장됩니다)</li>
          <li>.env의 <code className="bg-gray-100 px-1 rounded">PUBLIC_MEDIA_BASE_URL</code>에 영상 공개 주소 설정 — Instagram 서버가 영상을 내려받을 수 있어야 합니다 (예: Cloudflare Tunnel 주소)</li>
        </ol>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div><label className="label text-sm">Access Token</label>
            <input type="password" className="input py-2 text-sm" placeholder="붙여넣기 (저장 시 암호화)" value={igToken} onChange={(e) => setIgToken(e.target.value)} /></div>
          <div><label className="label text-sm">Instagram User ID</label>
            <input className="input py-2 text-sm" placeholder="1784..." value={igUser} onChange={(e) => setIgUser(e.target.value)} /></div>
        </div>
        <div className="flex gap-3">
          <button className="btn-primary px-4 py-2 text-sm" disabled={!igToken && !igUser}
            onClick={() => { save({ ...(igToken ? { igAccessToken: igToken } : {}), ...(igUser ? { igUserId: igUser } : {}) } as never); setIgToken(""); setIgUser(""); }}>
            암호화 저장
          </button>
          <TestBtn service="instagram" />
        </div>
      </Card>

      <Card title="🎬 영상 · 자막">
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div><label className="label text-sm">기본 릴스 길이</label>
            <select className="input py-2 text-sm" value={s.reelDurationSec} onChange={(e) => setS({ ...s, reelDurationSec: parseInt(e.target.value) })}>
              {s.durationChoices.map((d) => <option key={d} value={d}>{d}초{d === 25 ? " (맛집 기본 22~27초)" : ""}</option>)}
            </select></div>
          <div><label className="label text-sm">자막 크기 ({s.subtitle.fontSize}px)</label>
            <input type="range" min="48" max="110" className="w-full accent-[#E86A3A]" value={s.subtitle.fontSize} onChange={(e) => setS({ ...s, subtitle: { ...s.subtitle, fontSize: parseInt(e.target.value) } })} /></div>
          <div><label className="label text-sm">자막 위치 — 아래에서 {s.subtitle.marginBottomPct}% (Instagram UI 회피)</label>
            <input type="range" min="12" max="35" className="w-full accent-[#E86A3A]" value={s.subtitle.marginBottomPct} onChange={(e) => setS({ ...s, subtitle: { ...s.subtitle, marginBottomPct: parseInt(e.target.value) } })} /></div>
          <div><label className="label text-sm">강조 색</label>
            <input type="color" className="h-10 w-20 rounded cursor-pointer" value={s.subtitle.highlightColor} onChange={(e) => setS({ ...s, subtitle: { ...s.subtitle, highlightColor: e.target.value } })} /></div>
        </div>
        <div className="flex gap-3">
          <button className="btn-primary px-4 py-2 text-sm" onClick={() => save({ reelDurationSec: s.reelDurationSec, subtitle: s.subtitle })}>저장</button>
          <TestBtn service="ffmpeg" />
        </div>
      </Card>

      <Card title="🎵 BGM">
        <p className="text-sm text-gray-500 mb-3">직접 등록한 음원 또는 상업적 사용이 허용된 음원만 사용하세요. 파일을 <b>assets/bgm/</b> 폴더에 넣고 파일명을 입력하면 나레이션에 맞춰 자동으로 소리가 줄어듭니다(더킹).</p>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div><label className="label text-sm">BGM 파일명 (비우면 BGM 없음)</label>
            <input className="input py-2 text-sm" placeholder="my-bgm.mp3" value={s.bgm.file} onChange={(e) => setS({ ...s, bgm: { ...s.bgm, file: e.target.value } })} /></div>
          <div><label className="label text-sm">BGM 볼륨 ({s.bgm.volumeDb}dB)</label>
            <input type="range" min="-35" max="-10" className="w-full accent-[#E86A3A]" value={s.bgm.volumeDb} onChange={(e) => setS({ ...s, bgm: { ...s.bgm, volumeDb: parseInt(e.target.value) } })} /></div>
        </div>
        <button className="btn-primary px-4 py-2 text-sm" onClick={() => save({ bgm: s.bgm })}>저장</button>
      </Card>

      <Card title="📆 발행 스케줄 (§주 6회)">
        <div className="flex gap-2 mb-3">
          {Object.entries(s.publishDays).map(([k, v]) => (
            <button key={k} onClick={() => setS({ ...s, publishDays: { ...s.publishDays, [k]: !v } })}
              className={`w-12 h-12 rounded-xl font-extrabold border-2 ${v ? "border-[#E86A3A] bg-[#FDEDE5] text-[#E86A3A]" : "border-gray-200 text-gray-400"}`}>
              {DAY_KO[k]}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3 mb-3">
          <label className="label text-sm m-0">발행 시간</label>
          <input type="time" className="input w-36 py-2 text-sm" value={s.publishTime} onChange={(e) => setS({ ...s, publishTime: e.target.value })} />
          <label className="label text-sm m-0 ml-4">주간 오락이 비율</label>
          <select className="input w-40 py-2 text-sm" value={s.orakiPerWeek} onChange={(e) => setS({ ...s, orakiPerWeek: parseInt(e.target.value) })}>
            {[0, 1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>주 {n}개 오락이</option>)}
          </select>
        </div>
        <button className="btn-primary px-4 py-2 text-sm" onClick={() => save({ publishDays: s.publishDays, publishTime: s.publishTime, orakiPerWeek: s.orakiPerWeek })}>저장</button>
      </Card>

      <Card title="✅ 승인 모드 (§SAFE/AUTO)">
        <div className="grid grid-cols-2 gap-3 mb-3">
          <button onClick={() => setS({ ...s, approvalMode: "SAFE" })}
            className={`rounded-xl border-2 p-4 text-left ${s.approvalMode === "SAFE" ? "border-[#E86A3A] bg-[#FDEDE5]" : "border-gray-200"}`}>
            <div className="font-extrabold">SAFE MODE (기본)</div>
            <div className="text-sm text-gray-500">AI 제작 → 사람 확인 → 예약/발행</div>
          </button>
          <button onClick={() => setS({ ...s, approvalMode: "AUTO" })}
            className={`rounded-xl border-2 p-4 text-left ${s.approvalMode === "AUTO" ? "border-[#E86A3A] bg-[#FDEDE5]" : "border-gray-200"}`}>
            <div className="font-extrabold">AUTO MODE</div>
            <div className="text-sm text-gray-500">AI 제작 → 팩트체크·품질검사 통과 시 자동 예약. 팩트체크 실패 콘텐츠는 절대 발행하지 않습니다.</div>
          </button>
        </div>
        <button className="btn-primary px-4 py-2 text-sm" onClick={() => save({ approvalMode: s.approvalMode })}>저장</button>
      </Card>

      <Card title="📁 저장 폴더">
        <p className="text-sm text-gray-600">완성 콘텐츠는 프로그램 폴더 안 <code className="bg-gray-100 px-1 rounded">output/날짜_맛집명/</code>에 저장됩니다 — script.json, caption.txt, hashtags.txt, voice.mp3, subtitle.srt, thumbnail.jpg, reel.mp4, metadata.json.</p>
      </Card>
    </div>
  );
}
