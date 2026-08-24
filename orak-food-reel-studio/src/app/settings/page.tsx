"use client";
import { useEffect, useState } from "react";
import { Card, api, useApi, ErrorBox, isDesktopApp } from "@/components/ui";
import type { AppSettings } from "@/lib/settings";
import VoicePicker from "@/components/VoicePicker";
import { useToast } from "@/components/Toast";
import { describeSettingsChange } from "@/lib/settings-diff";

type Services = Record<"llm" | "image" | "tts" | "instagram", boolean>;
type SecretName = "ANTHROPIC_API_KEY" | "ELEVENLABS_API_KEY" | "IMAGE_API_KEY";
interface SecretStatus { set: boolean; source: string; hint: string }
interface IgStatus {
  tokenSet: boolean; tokenSource: string; tokenHint: string;
  userIdSet: boolean; userIdSource: string; userId: string;
  loginKind: "instagram" | "facebook" | null;
}
interface SettingsResponse {
  settings: AppSettings;
  services: Services;
  mode: "sample" | "live";
  secrets: Record<SecretName, SecretStatus>;
  instagram: IgStatus;
}

export default function SettingsPage() {
  const { data, reload } = useApi<SettingsResponse>("/api/settings");
  const [s, setS] = useState<AppSettings | null>(null);
  const [igToken, setIgToken] = useState("");
  const [igUser, setIgUser] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, string>>({});
  const [keyInput, setKeyInput] = useState<Partial<Record<SecretName, string>>>({});
  const toast = useToast();
  // ElevenLabs 키를 저장하면 목소리 목록을 다시 불러오게 하는 신호
  const [voiceRefresh, setVoiceRefresh] = useState(0);

  useEffect(() => { if (data && !s) setS(data.settings); }, [data, s]);
  if (!data || !s) return <div className="text-gray-600 py-20 text-center">불러오는 중…</div>;
  const ig = data.instagram;

  const save = async (patch: Partial<AppSettings> & Partial<Record<SecretName, string>> & { igAccessToken?: string; igUserId?: string }) => {
    setErr(null); setMsg(null);
    try {
      const before = data.settings;
      const out = await api<{ settings: AppSettings }>("/api/settings", { method: "PUT", body: JSON.stringify(patch) });
      // 방금 저장한 항목만 서버 값으로 갱신한다.
      // 통째로 덮으면 다른 칸에서 편집 중이던 값(예: 공급자 선택)이 소리 없이 되돌아간다.
      const keys = Object.keys(patch) as Array<keyof AppSettings>;
      setS((cur) => {
        const base = cur ?? out.settings;
        const picked = Object.fromEntries(keys.filter((k) => k in out.settings).map((k) => [k, out.settings[k]]));
        return { ...base, ...picked };
      });
      setMsg("저장했습니다."); reload();
      // 무엇이 바뀌었는지 문장으로 알린다 ("저장했습니다" 만으로는 확인이 안 된다)
      if ("ELEVENLABS_API_KEY" in patch) setVoiceRefresh((n) => n + 1);
      const changes = describeSettingsChange(before, out.settings, patch);
      toast.success(changes.length === 1 ? changes[0] : "설정을 저장했습니다.", changes.length > 1 ? changes : undefined);
    } catch (e) {
      // 저장에 실패하면 성공 알림을 띄우지 않는다
      setErr(e instanceof Error ? e.message : String(e));
      toast.fromError(e, "값을 확인한 뒤 다시 [저장]을 눌러 주세요.");
    }
  };

  const test = async (service: string) => {
    setTestResult((t) => ({ ...t, [service]: "테스트 중…" }));
    // 화면에 보이는 값과 저장된 값이 다르면 엉뚱한 서비스를 테스트하게 된다 → 먼저 맞춘다
    if (service === "image" && data.settings.imageProvider !== s.imageProvider) {
      await save({ imageProvider: s.imageProvider, imageModel: s.imageModel });
    }
    try {
      const r = await api<{ ok: boolean; detail: string }>("/api/settings/test", { method: "POST", body: JSON.stringify({ service }) });
      setTestResult((t) => ({ ...t, [service]: `${r.ok ? "✅" : "❌"} ${r.detail}` }));
    } catch (e) { setTestResult((t) => ({ ...t, [service]: `❌ ${e instanceof Error ? e.message : String(e)}` })); }
  };

  /** 저장된 키가 그 서비스의 형식과 맞는지 (오타·다른 곳에서 복사한 값 걸러내기) */
  const keyFormatWarning = (name: SecretName, hint: string): string | null => {
    if (!hint) return null;
    if (name === "ANTHROPIC_API_KEY" && !hint.startsWith("sk-ant")) {
      return "Claude 키는 sk-ant- 로 시작합니다. console.anthropic.com → API Keys 에서 받은 값인지 확인하세요.";
    }
    if (name === "IMAGE_API_KEY") {
      const provider = s.imageProvider;
      if (provider === "gemini" && !hint.startsWith("AIza")) {
        return "Gemini API 키는 AIza 로 시작합니다. aistudio.google.com/apikey 에서 [API 키 만들기]로 받은 값인지 확인하세요.";
      }
      if (provider === "openai" && !hint.startsWith("sk-")) {
        return "OpenAI 키는 sk- 로 시작합니다. platform.openai.com → API keys 에서 받은 값인지 확인하세요.";
      }
    }
    return null;
  };

  /** API 키 입력 — 키 자체는 화면에 다시 표시하지 않는다 */
  const KeyField = ({ name, label, help }: { name: SecretName; label: string; help?: string }) => {
    const st = data.secrets?.[name];
    const warn = st?.set ? keyFormatWarning(name, st.hint) : null;
    return (
      <div className="mb-3">
        <label className="label text-sm">{label}</label>
        {st?.set && (
          <div className="text-xs text-emerald-700 font-semibold mb-1.5">
            ✅ 저장됨 ({st.source}) · {st.hint}
          </div>
        )}
        <div className="flex gap-2">
          <input type="password" className="input flex-1"
            placeholder={st?.set ? "바꾸려면 새 키를 붙여넣으세요" : "여기에 키를 붙여넣으세요"}
            value={keyInput[name] ?? ""}
            onChange={(e) => setKeyInput({ ...keyInput, [name]: e.target.value })} />
          <button className="btn-primary" disabled={!(keyInput[name] ?? "").trim()}
            onClick={() => { save({ [name]: keyInput[name] } as never); setKeyInput({ ...keyInput, [name]: "" }); }}>
            저장
          </button>
          {st?.set && st.source === "설정" && (
            <button className="btn-ghost" title="설정에 저장된 키를 지웁니다(.env 값으로 되돌아감)"
              onClick={() => save({ [name]: "" } as never)}>지우기</button>
          )}
        </div>
        {warn && (
          <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-2 font-semibold">
            ⚠ {warn}
          </p>
        )}
        {help && <p className="text-xs text-gray-600 mt-1">{help}</p>}
      </div>
    );
  };

  const TestBtn = ({ service }: { service: string }) => {
    const result = testResult[service];
    // 감싸는 <div> 없이 바깥 줄에 그대로 놓는다. 예전에는 이 묶음이 통째로
    // 다음 줄로 밀려나 [저장]과 [연결 테스트]가 세로로 쌓였다.
    return (
      <>
        <button className="btn-secondary" onClick={() => test(service)}>🔌 연결 테스트</button>
        {result && (
          // 짧은 답(연결 성공)은 버튼 옆에, 긴 안내문은 통째로 아랫줄에
          <span className={`text-sm font-semibold min-w-0 break-words ${result.length > 30 ? "basis-full" : ""}`}>
            {result}
          </span>
        )}
      </>
    );
  };

  const DAY_KO: Record<string, string> = { mon: "월", tue: "화", wed: "수", thu: "목", fri: "금", sat: "토", sun: "일" };

  return (
    <div className="page space-y-6">
      <h1 className="text-2xl font-extrabold">⚙️ 설정</h1>
      {msg && <div className="card p-3 px-4 bg-emerald-50 border-emerald-200 text-emerald-800 text-sm font-bold">{msg}</div>}
      <ErrorBox msg={err} />

      <Card title="⚡ 실행 모드">
        <div className="field-grid mb-3">
          <button onClick={() => save({ appMode: "live" })}
            className={`rounded-xl border-2 p-4 text-left ${data.mode === "live" ? "border-[#E86A3A] bg-[#FDEDE5]" : "border-gray-200 hover:border-gray-300"}`}>
            <div className="font-extrabold">🚀 실제 모드</div>
            <div className="text-sm text-gray-600">진짜 AI로 대본·이미지·음성을 만듭니다. 요금이 발생합니다.</div>
          </button>
          <button onClick={() => save({ appMode: "sample" })}
            className={`rounded-xl border-2 p-4 text-left ${data.mode === "sample" ? "border-[#E86A3A] bg-[#FDEDE5]" : "border-gray-200 hover:border-gray-300"}`}>
            <div className="font-extrabold">🧪 연습 모드</div>
            <div className="text-sm text-gray-600">외부 API를 쓰지 않고 샘플로 전체 흐름만 확인합니다. 무료.</div>
          </button>
        </div>
        <p className="text-xs text-gray-600">
          현재: <b>{data.mode === "live" ? "실제 모드" : "연습 모드"}</b> · 바꾸면 바로 적용되며 프로그램을 다시 켜지 않아도 됩니다.
        </p>
      </Card>

      <Card title="🤖 AI (Claude) — 대본·캡션·기획">
        <KeyField name="ANTHROPIC_API_KEY" label="Claude API 키"
          help="console.anthropic.com → API Keys 에서 발급. 저장하면 바로 적용되며 프로그램을 다시 켜지 않아도 됩니다." />
        <div className="flex flex-wrap items-center gap-3"><TestBtn service="llm" /></div>
      </Card>

      <Card title="🎙 ElevenLabs — AI 음성">
        <KeyField name="ELEVENLABS_API_KEY" label="ElevenLabs API 키"
          help="elevenlabs.io → 설정 → 워크스페이스 → API 키. 저장하면 아래에 목소리 목록이 나타납니다." />
        <div className="mb-4">
          <label className="label text-sm">목소리 고르기</label>
          <VoicePicker value={s.tts.voiceId} refreshToken={voiceRefresh}
            onChange={(voiceId) => setS({ ...s, tts: { ...s.tts, voiceId } })} />
        </div>
        <div className="field-grid mb-3">
          <div><label className="label text-sm">Model</label>
            <input className="input" value={s.tts.model} onChange={(e) => setS({ ...s, tts: { ...s.tts, model: e.target.value } })} /></div>
          <div><label className="label text-sm">Speed ({s.tts.speed})</label>
            <input type="range" min="0.7" max="1.2" step="0.01" className="range" value={s.tts.speed} onChange={(e) => setS({ ...s, tts: { ...s.tts, speed: parseFloat(e.target.value) } })} /></div>
          <div><label className="label text-sm">Stability ({s.tts.stability})</label>
            <input type="range" min="0" max="1" step="0.05" className="range" value={s.tts.stability} onChange={(e) => setS({ ...s, tts: { ...s.tts, stability: parseFloat(e.target.value) } })} /></div>
          <div><label className="label text-sm">Similarity ({s.tts.similarity})</label>
            <input type="range" min="0" max="1" step="0.05" className="range" value={s.tts.similarity} onChange={(e) => setS({ ...s, tts: { ...s.tts, similarity: parseFloat(e.target.value) } })} /></div>
        </div>
        <div className="flex flex-wrap items-center gap-3"><button className="btn-primary" onClick={() => save({ tts: s.tts })}>저장</button><TestBtn service="tts" /></div>
      </Card>

      <Card title="🖼 이미지 생성">
        <div className="field-grid mb-3">
          <div><label className="label text-sm">공급자</label>
            <select className="input" value={s.imageProvider}
              onChange={(e) => {
                // 고르는 즉시 저장한다. [저장]을 안 눌러 화면과 저장값이 어긋나면
                // 엉뚱한 서비스로 연결 테스트가 나가 "키가 틀렸다"는 오해를 부른다.
                const imageProvider = e.target.value as AppSettings["imageProvider"];
                setS({ ...s, imageProvider });
                void save({ imageProvider, imageModel: s.imageModel });
              }}>
              <option value="sample">Sample (API 불필요)</option>
              <option value="gemini">Gemini / Imagen</option>
              <option value="openai">OpenAI 이미지</option>
            </select></div>
          <div><label className="label text-sm">모델 (비우면 기본값)</label>
            <input className="input" disabled={s.imageProvider === "sample"}
              placeholder={s.imageProvider === "openai" ? "gpt-image-1 (비우면 이 값)" : s.imageProvider === "gemini" ? "imagen-3.0-generate-002 (비우면 이 값)" : "Sample 모드는 모델이 없습니다"}
              value={s.imageModel} onChange={(e) => setS({ ...s, imageModel: e.target.value })} /></div>
        </div>
        <p className="text-xs text-gray-600 mb-3">모델은 잘 모르면 비워 두세요. 공급자를 바꾸면 예전 모델 이름은 자동으로 지워집니다.</p>
        {s.imageProvider === "openai" && (
          <p className="text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 mb-3">
            기본 모델 <b>gpt-image-1</b>은 계정에 따라 OpenAI의 <b>조직 인증(Verify Organization)</b>을 요구합니다.
            인증이 안 된 계정이면 프로그램이 자동으로 <b>dall-e-3</b>로 바꿔 계속 진행합니다.
            다만 dall-e-3는 오락이 기준 이미지를 입력으로 받지 못해 <b>캐릭터 얼굴이 조금씩 달라질 수 있습니다</b> —
            오락이가 나오는 릴스를 만들 거라면 조직 인증을 마치고 gpt-image-1을 쓰는 편이 좋습니다.
          </p>
        )}
        <KeyField name="IMAGE_API_KEY" label="이미지 API 키"
          help={s.imageProvider === "openai"
            ? "platform.openai.com → API keys 에서 만든 sk- 로 시작하는 값. 공급자를 바꿨으면 위에서 [저장]을 먼저 누르세요."
            : "Gemini는 aistudio.google.com → Get API key, OpenAI는 platform.openai.com → API keys. 공급자를 바꿨으면 위에서 [저장]을 먼저 누르세요."} />
        <div className="flex flex-wrap items-center gap-3"><button className="btn-primary" onClick={() => save({ imageProvider: s.imageProvider, imageModel: s.imageModel })}>저장</button><TestBtn service="image" /></div>
      </Card>

      <Card title="📸 Instagram — Meta 공식 API">
        <ol className="text-sm text-gray-600 space-y-1 mb-4 list-decimal pl-5">
          <li>Instagram을 <b>Professional(비즈니스/크리에이터) 계정</b>으로 전환</li>
          <li><a className="text-[#B84A1B] font-bold" href="https://developers.facebook.com" target="_blank">developers.facebook.com</a>에서 앱 생성</li>
          {/* 로그인 방식이 두 가지고 권한 이름이 서로 다르다 — 없는 권한을 찾아 헤매지 않도록 둘 다 적는다 */}
          <li>
            Access Token 발급 — 두 가지 방법 중 하나입니다
            <ul className="list-disc pl-5 mt-1 space-y-0.5">
              <li><b>Instagram 로그인</b> (페이스북 페이지 없이, 토큰이 <code className="bg-gray-100 px-1 rounded">IGAA…</code>)
                {" "}→ 권한 <code className="bg-gray-100 px-1 rounded">instagram_business_content_publish</code></li>
              <li><b>페이스북 로그인</b> (페이지에 연결, 토큰이 <code className="bg-gray-100 px-1 rounded">EAA…</code>)
                {" "}→ 권한 <code className="bg-gray-100 px-1 rounded">instagram_content_publish</code></li>
            </ul>
          </li>
          <li>아래에 토큰과 IG User ID 입력 (토큰은 <b>암호화되어</b> 저장됩니다). ID 를 모르면 토큰만 저장하고 <b>[연결 테스트]</b>를 누르세요 — 찾아서 알려 드립니다</li>
          <li>아래 <b>[영상 공개 주소]</b> 칸에 인터넷에서 열리는 주소를 넣습니다 — Instagram 서버가 그 주소로 완성 영상을 내려받습니다 (예: Cloudflare Tunnel 주소)</li>
        </ol>
        <div className="field-grid mb-3">
          <div>
            <label className="label text-sm">Access Token</label>
            {/* 저장한 토큰은 다시 보여주지 않는다 — 칸이 비어 있어도 저장된 값으로 테스트한다 */}
            {ig?.tokenSet
              ? <div className="text-xs text-emerald-700 font-semibold mb-1.5">
                  ✅ 저장됨 ({ig.tokenSource}) · {ig.tokenHint}
                  {ig.loginKind && ` · ${ig.loginKind === "instagram" ? "Instagram 로그인" : "페이스북 로그인"}`}
                </div>
              : <div className="text-xs text-gray-500 font-semibold mb-1.5">아직 저장된 토큰이 없습니다</div>}
            <input type="password" className="input"
              placeholder={ig?.tokenSet ? "바꾸려면 새 토큰을 붙여넣으세요" : "붙여넣기 (저장 시 암호화)"}
              value={igToken} onChange={(e) => setIgToken(e.target.value)} />
          </div>
          <div>
            <label className="label text-sm">Instagram User ID</label>
            {ig?.userIdSet
              ? <div className="text-xs text-emerald-700 font-semibold mb-1.5">✅ 저장됨 ({ig.userIdSource}) · {ig.userId}</div>
              : <div className="text-xs text-gray-500 font-semibold mb-1.5">아직 저장된 ID 가 없습니다</div>}
            <input className="input" inputMode="numeric"
              placeholder={ig?.userIdSet ? "바꾸려면 새 ID 를 넣으세요" : "1784... (숫자만)"}
              value={igUser} onChange={(e) => setIgUser(e.target.value)} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn-primary" disabled={!igToken.trim() && !igUser.trim()}
            onClick={() => { save({ ...(igToken.trim() ? { igAccessToken: igToken } : {}), ...(igUser.trim() ? { igUserId: igUser } : {}) } as never); setIgToken(""); setIgUser(""); }}>
            암호화 저장
          </button>
          {(ig?.tokenSource === "설정" || ig?.userIdSource === "설정") && (
            <button className="btn-ghost" title="설정에 저장된 토큰과 ID를 지웁니다(.env 값으로 되돌아감)"
              onClick={() => save({ igAccessToken: "", igUserId: "" } as never)}>지우기</button>
          )}
          <TestBtn service="instagram" />
        </div>

        {/* Instagram 서버가 이 주소로 영상을 받으러 온다 — 없으면 발행 단계에서 멈춘다.
            예전에는 "설정 → Instagram에서 입력하세요" 라고만 하고 넣을 칸이 없었다. */}
        <div className="mt-5 pt-5 border-t border-gray-200">
          <label className="label text-sm" htmlFor="ig-public-url">영상 공개 주소 (발행할 때 필요)</label>
          <div className="flex flex-wrap items-center gap-3">
            <input id="ig-public-url" className="input flex-1 min-w-0" placeholder="https://reels.내주소.com"
              value={s.publicMediaBaseUrl}
              onChange={(e) => setS({ ...s, publicMediaBaseUrl: e.target.value })} />
            <button className="btn-primary" onClick={() => save({ publicMediaBaseUrl: s.publicMediaBaseUrl })}>저장</button>
          </div>
          <p className="text-xs text-gray-600 mt-1">
            Instagram 서버가 <b>이 주소로 완성 영상을 내려받습니다.</b> 인터넷에서 열리는 주소여야 하며,
            내 PC 주소(<code className="bg-gray-100 px-1 rounded">localhost</code>)로는 발행되지 않습니다.
            영상 제작·미리보기만 할 때는 비워 두어도 됩니다.
          </p>
        </div>
      </Card>

      <Card title="🎬 영상 · 자막">
        <div className="field-grid mb-3">
          <div><label className="label text-sm">기본 릴스 길이</label>
            <select className="input" value={s.reelDurationSec} onChange={(e) => setS({ ...s, reelDurationSec: parseInt(e.target.value) })}>
              {s.durationChoices.map((d) => <option key={d} value={d}>{d}초{d === 25 ? " (맛집 기본 22~27초)" : ""}</option>)}
            </select></div>
          <div><label className="label text-sm">자막 크기 ({s.subtitle.fontSize}px)</label>
            <input type="range" min="48" max="110" className="range" value={s.subtitle.fontSize} onChange={(e) => setS({ ...s, subtitle: { ...s.subtitle, fontSize: parseInt(e.target.value) } })} /></div>
          <div><label className="label text-sm">자막 위치 — 아래에서 {s.subtitle.marginBottomPct}% (Instagram UI 회피)</label>
            <input type="range" min="12" max="35" className="range" value={s.subtitle.marginBottomPct} onChange={(e) => setS({ ...s, subtitle: { ...s.subtitle, marginBottomPct: parseInt(e.target.value) } })} /></div>
          <div><label className="label text-sm">강조 색</label>
            <input type="color" className="swatch" value={s.subtitle.highlightColor} onChange={(e) => setS({ ...s, subtitle: { ...s.subtitle, highlightColor: e.target.value } })} /></div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn-primary" onClick={() => save({ reelDurationSec: s.reelDurationSec, subtitle: s.subtitle })}>저장</button>
          <TestBtn service="ffmpeg" />
        </div>
      </Card>

      <Card title="🎵 BGM">
        <p className="text-sm text-gray-600 mb-3">직접 등록한 음원 또는 상업적 사용이 허용된 음원만 사용하세요. 파일을 <b>assets/bgm/</b> 폴더에 넣고 파일명을 입력하면 나레이션에 맞춰 자동으로 소리가 줄어듭니다(더킹).</p>
        <div className="field-grid mb-3">
          <div><label className="label text-sm">BGM 파일명 (비우면 BGM 없음)</label>
            <input className="input" placeholder="my-bgm.mp3" value={s.bgm.file} onChange={(e) => setS({ ...s, bgm: { ...s.bgm, file: e.target.value } })} /></div>
          <div><label className="label text-sm">BGM 볼륨 ({s.bgm.volumeDb}dB)</label>
            <input type="range" min="-35" max="-10" className="range" value={s.bgm.volumeDb} onChange={(e) => setS({ ...s, bgm: { ...s.bgm, volumeDb: parseInt(e.target.value) } })} /></div>
        </div>
        <button className="btn-primary" onClick={() => save({ bgm: s.bgm })}>저장</button>
      </Card>

      <Card title="📆 발행 스케줄 (§주 6회)">
        <div className="flex gap-2 mb-3">
          {Object.entries(s.publishDays).map(([k, v]) => (
            <button key={k} onClick={() => setS({ ...s, publishDays: { ...s.publishDays, [k]: !v } })}
              className={`w-12 h-12 rounded-xl font-extrabold border-2 ${v ? "border-[#E86A3A] bg-[#FDEDE5] text-[#B84A1B]" : "border-gray-200 text-gray-600"}`}>
              {DAY_KO[k]}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3 mb-3">
          <label className="label text-sm m-0">발행 시간</label>
          <input type="time" className="input w-full sm:w-48 min-w-0" value={s.publishTime} onChange={(e) => setS({ ...s, publishTime: e.target.value })} />
          <label className="label text-sm m-0 ml-4">주간 오락이 비율</label>
          <select className="input w-full sm:w-40 min-w-0" value={s.orakiPerWeek} onChange={(e) => setS({ ...s, orakiPerWeek: parseInt(e.target.value) })}>
            {[0, 1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>주 {n}개 오락이</option>)}
          </select>
        </div>
        <button className="btn-primary" onClick={() => save({ publishDays: s.publishDays, publishTime: s.publishTime, orakiPerWeek: s.orakiPerWeek })}>저장</button>
      </Card>

      <Card title="✅ 승인 모드 (§SAFE/AUTO)">
        <div className="field-grid mb-3">
          <button onClick={() => setS({ ...s, approvalMode: "SAFE" })}
            className={`rounded-xl border-2 p-4 text-left ${s.approvalMode === "SAFE" ? "border-[#E86A3A] bg-[#FDEDE5]" : "border-gray-200"}`}>
            <div className="font-extrabold">SAFE MODE (기본)</div>
            <div className="text-sm text-gray-600">AI 제작 → 사람 확인 → 예약/발행</div>
          </button>
          <button onClick={() => setS({ ...s, approvalMode: "AUTO" })}
            className={`rounded-xl border-2 p-4 text-left ${s.approvalMode === "AUTO" ? "border-[#E86A3A] bg-[#FDEDE5]" : "border-gray-200"}`}>
            <div className="font-extrabold">AUTO MODE</div>
            <div className="text-sm text-gray-600">AI 제작 → 팩트체크·품질검사 통과 시 자동 예약. 팩트체크 실패 콘텐츠는 절대 발행하지 않습니다.</div>
          </button>
        </div>
        <button className="btn-primary" onClick={() => save({ approvalMode: s.approvalMode })}>저장</button>
      </Card>

      {/* 업데이트했는데 옛 화면이 보이던 일이 반복됐다 — 지금 도는 것이
          언제 만든 것인지 눈으로 확인할 수 있게 적어 둔다 */}
      <Card title="ℹ️ 프로그램 정보">
        <div className="text-sm text-gray-700">
          <b>빌드</b> <code className="bg-gray-100 px-1.5 py-0.5 rounded">{process.env.ORAK_BUILD ?? "알 수 없음"}</code>
          {" · "}
          <b>실행 방식</b> {isDesktopApp() ? "설치한 프로그램 (바탕화면 아이콘)" : "폴더 실행 (start.bat)"}
        </div>
        <p className="text-xs text-gray-600 mt-2">
          업데이트했는데 화면이 그대로면 이 날짜를 확인해 주세요.
          {" "}<b>업데이트.bat</b> 은 폴더 실행만 바꿉니다 — 바탕화면 아이콘까지 바꾸려면
          {" "}<b>설치파일만들기.bat</b> 으로 다시 만들어 설치해야 합니다.
        </p>
      </Card>

      <Card title="📁 저장 폴더">
        <p className="text-sm text-gray-600">완성 콘텐츠는 프로그램 폴더 안 <code className="bg-gray-100 px-1 rounded">output/날짜_맛집명/</code>에 저장됩니다 — script.json, caption.txt, hashtags.txt, voice.mp3, subtitle.srt, thumbnail.jpg, reel.mp4, metadata.json.</p>
      </Card>
    </div>
  );
}
