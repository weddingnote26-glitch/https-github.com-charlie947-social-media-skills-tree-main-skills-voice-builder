"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  Card, ErrorBox, ProgressBar, StatusBadge, StepRow, api, useApi, mediaUrl,
  canOpenFolder, openOutputFolder, canPickVideo, pickVideoFile,
} from "@/components/ui";
import VoicePicker from "@/components/VoicePicker";
import { useToast } from "@/components/Toast";
import { jobProgress, type ProgressStep } from "@/lib/pipeline/progress";
import { outputFolderName } from "@/lib/output-folder";

/* 서버가 돌려주는 모양 (src/lib/pipeline/imported-video.ts) */
interface VideoInfo {
  name: string; sizeBytes: number; durationSec: number; width: number; height: number;
  videoCodec: string; hasAudio: boolean;
}
interface ImportedJob {
  id: string; title: string; status: string; error: string | null; steps: ProgressStep[];
  output_dir: string | null; final_path: string | null; duration_sec: number | null; updated_at: string;
}
interface SettingsResponse {
  settings: { tts: { voiceId: string; model: string; speed: number } };
  services: { tts: boolean };
  mode: "sample" | "live";
}
interface ModelsResponse {
  ready: boolean;
  models: Array<{ id: string; name: string; description: string; languages: string[] }>;
  selected: string;
  notice?: string;
}

const NARRATION_MAX = 8000;
const EXTENSIONS = ".mp4 .mov .m4v .mkv .webm .avi .mpg .mpeg .wmv";
const fmtSize = (b: number) => `${(b / 1024 / 1024).toFixed(1)}MB`;

/**
 * 외부 영상 AI 음성 최종 제작.
 * 다른 도구로 만든 영상 → 나레이션 입력 → 목소리·모델·속도 선택 → 최종 MP4.
 * 맛집 릴스 제작 흐름과는 별개다(가짜 맛집·장면을 만들지 않는다). 원본 영상은 읽기만 한다.
 */
export default function ImportedVideoPage() {
  const settings = useApi<SettingsResponse>("/api/settings");
  const models = useApi<ModelsResponse>("/api/voices/models");
  const recent = useApi<{ jobs: ImportedJob[] }>("/api/imported?status=완료");
  const toast = useToast();

  // 설치형 앱에서만 되는 것(파일 창·폴더 열기)은 화면이 켜진 뒤에 확인한다
  const [desktop, setDesktop] = useState(false);
  const [canPick, setCanPick] = useState(false);
  useEffect(() => { setDesktop(canOpenFolder()); setCanPick(canPickVideo()); }, []);

  const [sourcePath, setSourcePath] = useState("");
  const [info, setInfo] = useState<VideoInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [narration, setNarration] = useState("");
  const [title, setTitle] = useState("");
  const [voiceId, setVoiceId] = useState("");
  const [model, setModel] = useState("");
  const [speed, setSpeed] = useState(1.06);
  const [saveDefault, setSaveDefault] = useState(false);
  const [audioMode, setAudioMode] = useState<"mute" | "mix">("mute");
  const [mixDb, setMixDb] = useState(-18);
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<ImportedJob | null>(null);
  const [starting, setStarting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const notified = useRef<string | null>(null);
  const seeded = useRef(false);

  // 설정의 기본 목소리·모델·속도를 처음 한 번만 채운다. 여기서 바꿔도 설정은 그대로다.
  useEffect(() => {
    if (seeded.current || !settings.data) return;
    seeded.current = true;
    const t = settings.data.settings.tts;
    setVoiceId(t.voiceId); setModel(t.model); setSpeed(t.speed);
  }, [settings.data]);

  const live = settings.data?.mode === "live" && !!settings.data?.services.tts;

  /** 서버가 FFprobe 로 정말 영상인지 확인한다 (확장자만 믿지 않는다) */
  const inspect = async (p: string) => {
    setErr(null); setInfo(null);
    if (!p.trim()) { setErr("영상 파일을 먼저 골라 주세요."); return; }
    setChecking(true);
    try {
      const r = await api<{ info: VideoInfo }>("/api/imported/inspect", { method: "POST", body: JSON.stringify({ sourcePath: p }) });
      setInfo(r.info);
      setTitle((cur) => cur || r.info.name.replace(/\.[^.]+$/, ""));
      if (!r.info.hasAudio) setAudioMode("mute");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setChecking(false);
    }
  };

  const pick = async () => {
    setErr(null);
    const r = await pickVideoFile();
    if (!r.ok) { if (!r.canceled) setErr(r.reason ?? "파일을 고르지 못했습니다."); return; }
    const p = r.path ?? "";
    setSourcePath(p);
    await inspect(p);
  };

  const start = async () => {
    setErr(null); setStarting(true);
    try {
      const r = await api<{ jobId: string }>("/api/imported", {
        method: "POST",
        body: JSON.stringify({ sourcePath, title, narration, voiceId, model, speed, audioMode, mixDb, saveAsDefault: saveDefault }),
      });
      setJob(null); setJobId(r.jobId); notified.current = null;
      toast.info("최종 영상 만들기를 시작했습니다.", ["진행 상황은 아래와 🎬 제작중 화면에서 볼 수 있습니다."]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      toast.fromError(e, "입력값을 확인하고 다시 시도해 주세요.");
    } finally {
      setStarting(false);
    }
  };

  useEffect(() => {
    if (!jobId) return;
    const poll = async () => {
      try {
        const j = await api<ImportedJob>(`/api/imported/${jobId}`);
        setJob(j);
        if (j.status !== "진행중") {
          if (timer.current) clearInterval(timer.current);
          if (notified.current !== j.id) {
            notified.current = j.id;
            // 실패했을 때 성공 알림을 띄우지 않는다
            if (j.status === "완료") { toast.success("최종 영상이 완성되었습니다.", ["결과 파일 검증까지 통과했습니다."]); recent.reload(); }
            else toast.error(j.error ?? "제작에 실패했습니다.", "실패한 단계의 설명을 확인한 뒤 다시 시도해 주세요.");
          }
        }
      } catch { /* 다음 폴링에서 재시도 */ }
    };
    poll();
    timer.current = setInterval(poll, 1500);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [jobId]);

  /** 저장 폴더 열기 — 본체에는 폴더 이름만 보낸다 (완성영상 폴더 밖은 열리지 않는다) */
  const openFolder = async (dir: string | null) => {
    const r = await openOutputFolder(outputFolderName(dir));
    if (!r.ok) toast.error(r.reason ?? "폴더를 열지 못했습니다.", "프로그램을 껐다 켠 뒤 다시 시도해 주세요.");
  };

  const reset = () => {
    setJobId(null); setJob(null); setInfo(null); setSourcePath(""); setNarration(""); setTitle(""); setErr(null);
  };

  const producing = job?.status === "진행중" || (!!jobId && !job);
  const done = job?.status === "완료";
  const canStart = !!info && narration.trim().length > 0 && !producing && !starting && (!live || !!voiceId.trim());
  const videoUrl = done ? mediaUrl(job?.final_path) : null;

  return (
    <div className="page space-y-6">
      <header>
        <h1 className="text-2xl font-extrabold">🎞 외부 영상 AI 음성 최종 제작</h1>
        <p className="text-gray-600 mt-1">
          제작한 영상을 불러와 나레이션을 적으면, 고른 AI 목소리로 음성을 만들어 최종 MP4 를 저장합니다. 원본 영상은 바꾸지 않습니다.
        </p>
      </header>
      <ErrorBox msg={err} />

      {settings.data && (live ? (
        <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900">
          🚀 <b>실제 모드</b> — AI 음성을 만들 때 ElevenLabs 크레딧이 나레이션 글자 수만큼 사용됩니다.
        </div>
      ) : (
        <div className="rounded-xl bg-blue-50 border border-blue-200 px-4 py-3 text-sm text-blue-900">
          🧪 <b>연습 모드</b> — 실제 AI 목소리 대신 샘플 톤이 들어갑니다. 실제 목소리로 만들려면{" "}
          <Link href="/settings" className="font-bold underline">⚙️ 설정</Link>에서 실제 모드로 바꾸고 ElevenLabs 키를 넣어 주세요.
        </div>
      ))}

      {/* ---------- 1. 영상 ---------- */}
      <Card title="1. 영상 고르기">
        <p className="text-sm text-gray-600 mb-3">다른 도구로 만든 영상을 고릅니다. 원본은 읽기만 하고 바꾸지 않습니다. ({EXTENSIONS})</p>
        {canPick ? (
          <div className="flex flex-wrap items-center gap-3">
            <button className="btn-primary" onClick={pick} disabled={checking || producing}>📂 영상 파일 고르기</button>
            {sourcePath && <code className="text-xs bg-gray-100 px-2 py-1 rounded break-all">{sourcePath}</code>}
          </div>
        ) : (
          <div className="space-y-2">
            <label className="label text-sm">영상 파일의 전체 경로</label>
            <div className="flex flex-wrap gap-2">
              <input className="input flex-1 min-w-[16rem]" value={sourcePath} onChange={(e) => setSourcePath(e.target.value)}
                placeholder="C:\Users\이름\Videos\영상.mp4" disabled={producing} />
              <button className="btn-secondary" onClick={() => inspect(sourcePath)} disabled={checking || producing || !sourcePath.trim()}>
                {checking ? "확인 중…" : "확인"}
              </button>
            </div>
            <p className="text-xs text-gray-600">
              폴더 실행(start.bat)에서는 파일 창을 띄울 수 없어 경로를 직접 넣습니다.
              탐색기에서 파일을 <b>Shift+우클릭 → 경로로 복사</b> 한 뒤 붙여넣으세요.
              파일을 올리는 것이 아니라 이 PC 안의 파일을 그대로 읽습니다.
            </p>
          </div>
        )}
        {checking && <p className="text-sm text-gray-600 mt-3">영상인지 확인하는 중…</p>}
        {info && (
          <div className="mt-3 rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-900">
            ✅ <b>{info.name}</b> — {info.width}×{info.height} · {info.durationSec}초 · {fmtSize(info.sizeBytes)} · {info.hasAudio ? "소리 있음" : "소리 없음"}
          </div>
        )}
      </Card>

      {/* ---------- 2. 나레이션 ---------- */}
      <Card title="2. 나레이션 입력">
        <textarea className="input" rows={6} value={narration} maxLength={NARRATION_MAX} disabled={producing}
          onChange={(e) => setNarration(e.target.value)}
          placeholder="영상에서 AI 목소리가 읽을 문장을 적어 주세요. 문장 끝에 마침표를 찍으면 자연스럽게 끊어 읽습니다." />
        <div className="flex flex-wrap justify-between gap-2 text-xs text-gray-600 mt-1">
          <span>영상 속 말을 자동으로 받아 적는 기능은 아직 없습니다 — 말할 문장을 직접 적어 주세요.</span>
          <span>{narration.length.toLocaleString()} / {NARRATION_MAX.toLocaleString()}자</span>
        </div>
      </Card>

      {/* ---------- 3. 목소리 ---------- */}
      <Card title="3. 목소리 · 모델 · 속도">
        <p className="text-sm text-gray-600 mb-3">여기서 고른 값은 <b>이번 영상에만</b> 씁니다. 전체 기본값으로도 쓰려면 아래 칸에 표시하세요.</p>
        <div className="mb-4">
          <label className="label text-sm">목소리</label>
          {settings.data && !settings.data.services.tts && (
            <p className="text-xs text-gray-600 mb-2">
              ElevenLabs 키는 <Link href="/settings" className="font-bold underline">⚙️ 설정</Link> 화면에서 넣습니다.
              연습 모드에서는 목소리를 고르지 않아도 됩니다.
            </p>
          )}
          <VoicePicker value={voiceId} onChange={setVoiceId} />
          {live && !voiceId.trim() && (
            <p className="text-xs text-amber-800 mt-2 font-semibold">⚠ 실제 모드에서는 목소리를 골라야 시작할 수 있습니다.</p>
          )}
        </div>
        <div className="field-grid mb-3">
          <div>
            <label className="label text-sm">모델</label>
            {models.data?.ready && models.data.models.length > 0 ? (
              <select className="input" value={model} onChange={(e) => setModel(e.target.value)} disabled={producing}>
                {model && !models.data.models.some((m) => m.id === model) && <option value={model}>{model} (설정값)</option>}
                {models.data.models.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}{m.languages.includes("ko") ? " · 한국어" : ""} — {m.id}</option>
                ))}
              </select>
            ) : (
              <>
                <input className="input" value={model} onChange={(e) => setModel(e.target.value)} placeholder="eleven_multilingual_v2" disabled={producing} />
                {models.data?.notice && <p className="text-xs text-gray-600 mt-1">{models.data.notice}</p>}
              </>
            )}
          </div>
          <div>
            <label className="label text-sm">말 속도 ({speed.toFixed(2)})</label>
            <input type="range" min="0.7" max="1.2" step="0.01" className="range" value={speed} disabled={producing}
              onChange={(e) => setSpeed(parseFloat(e.target.value))} />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" className="w-5 h-5 accent-[#E86A3A]" checked={saveDefault} disabled={producing}
            onChange={(e) => setSaveDefault(e.target.checked)} />
          <span>이 목소리·모델·속도를 <b>기본 목소리로 저장</b> (맛집 릴스 제작에도 적용됩니다)</span>
        </label>
      </Card>

      {/* ---------- 4. 기존 소리 ---------- */}
      <Card title="4. 영상에 원래 있던 소리">
        <div className="flex flex-wrap gap-2">
          <button type="button" className="chip" aria-pressed={audioMode === "mute"} disabled={producing}
            onClick={() => setAudioMode("mute")}>🔇 기존 소리 끄기 (AI 음성만)</button>
          <button type="button" className="chip" aria-pressed={audioMode === "mix"} disabled={producing || (!!info && !info.hasAudio)}
            onClick={() => setAudioMode("mix")}>🔉 기존 소리 작게 섞기</button>
        </div>
        {info && !info.hasAudio && <p className="text-xs text-gray-600 mt-2">이 영상에는 소리가 없어 AI 음성만 넣습니다.</p>}
        {audioMode === "mix" && (
          <div className="mt-3 max-w-sm">
            <label className="label text-sm">기존 소리 크기 ({mixDb} dB)</label>
            <input type="range" min="-40" max="-6" step="1" className="range" value={mixDb} disabled={producing}
              onChange={(e) => setMixDb(parseInt(e.target.value))} />
            <p className="text-xs text-gray-600 mt-1">숫자가 작을수록 기존 소리가 더 작아집니다. (-18dB 권장)</p>
          </div>
        )}
        <p className="text-xs text-gray-600 mt-3">
          음성이 영상보다 길면 마지막 장면을 멈춘 채 음성이 끝날 때까지 이어 붙입니다. 음성은 자르지 않습니다.
        </p>
      </Card>

      {/* ---------- 5. 만들기 ---------- */}
      <Card title="5. 최종 MP4 만들기">
        <div className="mb-3 max-w-md">
          <label className="label text-sm">제목 (저장 폴더 이름에 씁니다)</label>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} disabled={producing} placeholder="영상 이름" />
        </div>
        <ul className="text-sm text-gray-700 space-y-1 mb-4">
          <li>• 영상: {info ? info.name : "아직 고르지 않음"}</li>
          <li>• 나레이션: {narration.trim() ? `${narration.trim().length}자` : "아직 없음"}</li>
          <li>• 목소리: {voiceId.trim() || (live ? "없음" : "연습 모드 샘플 톤")} · 모델: {model || "설정값"} · 속도 {speed.toFixed(2)}</li>
          <li>• 기존 소리: {audioMode === "mix" ? `작게 섞기 (${mixDb}dB)` : "끄기"}</li>
          <li>• 저장: 완성영상 폴더 → 날짜_외부영상_이름 → <b>최종_AI음성.mp4</b> (H.264 · AAC · faststart, 검증 통과 후 완료)</li>
        </ul>
        <button className="btn-primary" onClick={start} disabled={!canStart}>
          {starting ? "시작하는 중…" : producing ? "만드는 중…" : "🎬 최종 MP4 만들기"}
        </button>
      </Card>

      {/* ---------- 진행 ---------- */}
      {jobId && (
        <Card title={job ? `진행 상황 — ${job.title}` : "진행 상황"} right={job ? <StatusBadge status={job.status} /> : undefined}>
          {job ? (
            <>
              <div className="mb-3"><ProgressBar pct={jobProgress(job.steps)} label="외부 영상 진행률" /></div>
              <div className="space-y-2.5">{job.steps.map((s) => <StepRow key={s.key} step={s} />)}</div>
              {job.status === "실패" && job.error && <div className="mt-3"><ErrorBox msg={job.error} /></div>}
            </>
          ) : (
            <p className="text-sm text-gray-600">시작하는 중…</p>
          )}
        </Card>
      )}

      {/* ---------- 결과 ---------- */}
      {done && job && (
        <Card title="✅ 최종 영상이 완성되었습니다">
          {videoUrl ? (
            <video controls className="w-full max-h-[480px] rounded-xl bg-black mb-3" src={videoUrl} />
          ) : (
            <p className="text-sm text-gray-600 mb-3">이 화면에서는 미리보기를 열 수 없는 위치입니다 — 저장 폴더를 열어 영상을 확인해 주세요.</p>
          )}
          <p className="text-sm break-all mb-3">
            저장 위치: <code className="bg-gray-100 px-1 rounded">{job.final_path}</code>
            {job.duration_sec ? ` · ${job.duration_sec}초` : ""}
          </p>
          <div className="flex flex-wrap gap-2">
            {desktop && <button className="btn-primary" onClick={() => openFolder(job.output_dir)}>📁 저장 폴더 열기</button>}
            <button className="btn-secondary" onClick={reset}>다른 영상으로 다시 하기</button>
          </div>
        </Card>
      )}

      {/* ---------- 최근 ---------- */}
      {(recent.data?.jobs.length ?? 0) > 0 && (
        <Card title="최근 완성한 외부 영상">
          <ul className="space-y-2">
            {(recent.data?.jobs ?? []).slice(0, 10).map((jb) => (
              <li key={jb.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gray-200 p-3 text-sm">
                <div className="min-w-0">
                  <div className="font-bold truncate">{jb.title}</div>
                  <div className="text-xs text-gray-600 break-all">
                    {jb.final_path}{jb.duration_sec ? ` · ${jb.duration_sec}초` : ""} · {jb.updated_at}
                  </div>
                </div>
                {desktop && <button className="btn-ghost" onClick={() => openFolder(jb.output_dir)}>📁 폴더</button>}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
