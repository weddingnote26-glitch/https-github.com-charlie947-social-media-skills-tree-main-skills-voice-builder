"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, api, useApi, ErrorBox } from "@/components/ui";

interface Health {
  mode: string; node: string;
  ffmpeg: { found: boolean; path: string | null; version: string | null };
  fonts: { korean: boolean };
  services: Record<"llm" | "image" | "tts" | "instagram", boolean>;
}

const STEPS = [
  "프로그램 환경 확인", "FFmpeg 확인", "AI(Claude) 연결", "ElevenLabs 연결",
  "Instagram 연결", "캐릭터 선택", "발행 요일 설정", "테스트 릴스 생성",
];

export default function Wizard() {
  const router = useRouter();
  const { data: health, reload } = useApi<Health>("/api/health");
  const { data: wiz } = useApi<{ wizardStep: number }>("/api/wizard");
  const [step, setStep] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const cur = step ?? wiz?.wizardStep ?? 1;

  const go = async (n: number) => {
    setStep(n);
    try { await api("/api/wizard", { method: "POST", body: JSON.stringify({ step: n }) }); } catch { /* 무시 */ }
  };
  const finish = async () => {
    try { await api("/api/wizard", { method: "POST", body: JSON.stringify({ done: true, step: 8 }) }); router.push("/today"); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  };

  const Ok = ({ ok, yes, no }: { ok: boolean | undefined; yes: string; no: string }) => (
    <div className={`rounded-xl p-4 font-bold ${ok ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>
      {ok ? `✅ ${yes}` : `⚠️ ${no}`}
    </div>
  );

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <header className="text-center pt-6">
        <div className="text-5xl mb-3">🥟</div>
        <h1 className="text-2xl font-extrabold">처음 오셨네요! 8단계만 확인하면 끝납니다</h1>
        <p className="text-gray-500 mt-1">STEP {cur} / 8 — {STEPS[cur - 1]}</p>
      </header>
      <div className="flex gap-1.5">
        {STEPS.map((_, i) => (
          <div key={i} className={`h-2 flex-1 rounded-full ${i < cur ? "bg-[#E86A3A]" : "bg-gray-200"}`} />
        ))}
      </div>
      <ErrorBox msg={err} />

      <Card>
        {cur === 1 && (
          <div className="space-y-3">
            <Ok ok={true} yes={`Node.js ${health?.node ?? ""} 확인 완료`} no="" />
            <Ok ok={health?.fonts.korean} yes="한글 폰트 준비 완료" no="한글 폰트가 없습니다 — start.bat 실행 시 자동으로 내려받습니다" />
            <p className="text-sm text-gray-500">이 프로그램은 컴퓨터 안에서만 동작하며, 완성 영상과 데이터는 프로그램 폴더에 저장됩니다.</p>
          </div>
        )}
        {cur === 2 && (
          <div className="space-y-3">
            <Ok ok={health?.ffmpeg.found} yes={`FFmpeg 사용 가능 — ${health?.ffmpeg.version ?? ""}`} no="FFmpeg를 찾지 못했습니다" />
            {!health?.ffmpeg.found && (
              <div className="text-sm text-gray-600 space-y-1">
                <p>① 보통은 <b>npm install</b>만 다시 실행하면 자동 설치됩니다(ffmpeg-static 포함).</p>
                <p>② 직접 설치: <a className="text-[#E86A3A] font-bold" href="https://www.gyan.dev/ffmpeg/builds/" target="_blank">gyan.dev/ffmpeg/builds</a>에서 essentials zip을 받아 풀고 bin 폴더를 PATH에 추가 → 새 터미널에서 <code className="bg-gray-100 px-1 rounded">ffmpeg -version</code> 확인</p>
                <button className="btn-secondary mt-2" onClick={reload}>다시 확인</button>
              </div>
            )}
          </div>
        )}
        {cur === 3 && (
          <div className="space-y-3">
            <Ok ok={health?.services.llm} yes="Claude API 연결됨" no="아직 연결 전 — .env에 ANTHROPIC_API_KEY를 넣으세요 (Sample Mode로도 계속 진행 가능)" />
            <Link href="/settings" className="btn-secondary">⚙️ 설정에서 연결 테스트</Link>
          </div>
        )}
        {cur === 4 && (
          <div className="space-y-3">
            <Ok ok={health?.services.tts} yes="ElevenLabs 연결됨" no="아직 연결 전 — .env에 ELEVENLABS_API_KEY / VOICE_ID를 넣으세요 (Sample Mode 가능)" />
            <p className="text-sm text-gray-500">추천 음성: 30~40대 톤, 신뢰감 있고 밝게, 약간 빠르게. 설정에서 Speed/Stability를 조절할 수 있습니다.</p>
            <Link href="/settings" className="btn-secondary">⚙️ 설정에서 연결 테스트</Link>
          </div>
        )}
        {cur === 5 && (
          <div className="space-y-3">
            <Ok ok={health?.services.instagram} yes="Instagram 연결됨" no="아직 연결 전 — 나중에 설정해도 됩니다. 예약/발행 전까지는 필요 없습니다" />
            <Link href="/settings" className="btn-secondary">⚙️ 설정에서 단계별 안내 보기</Link>
          </div>
        )}
        {cur === 6 && (
          <div className="space-y-3">
            <p className="font-bold">기본 출연자: 🥟 만두탐정 오락이</p>
            <p className="text-sm text-gray-500">신림 골목의 맛집 사건을 조사하는 오락푸드 전속 탐정입니다. 캐릭터 메뉴에서 Master Reference 이미지를 등록하면 매 영상 같은 얼굴을 유지합니다. 일반 맛집 영상도 언제든 선택할 수 있어요.</p>
            <Link href="/character" className="btn-secondary">🥟 캐릭터 화면 보기</Link>
          </div>
        )}
        {cur === 7 && (
          <div className="space-y-3">
            <p className="font-bold">기본 발행: 월~토 주 6회, 일요일 휴무</p>
            <p className="text-sm text-gray-500">요일과 시간은 설정 → 발행 스케줄에서 언제든 바꿀 수 있습니다.</p>
            <Link href="/settings" className="btn-secondary">📆 스케줄 바꾸기</Link>
          </div>
        )}
        {cur === 8 && (
          <div className="space-y-3">
            <p className="font-bold">이제 테스트 릴스를 하나 만들어보세요!</p>
            <p className="text-sm text-gray-500">API 키가 없어도 Sample Mode로 대본→이미지→음성→자막→영상까지 전체 흐름이 실제로 동작합니다.</p>
          </div>
        )}
      </Card>

      <div className="flex justify-between">
        <button className="btn-ghost" onClick={() => go(Math.max(1, cur - 1))} disabled={cur === 1}>← 이전</button>
        {cur < 8
          ? <button className="btn-primary" onClick={() => go(cur + 1)}>다음 →</button>
          : <button className="btn-primary" onClick={finish}>✨ 첫 릴스 만들러 가기</button>}
      </div>
    </div>
  );
}
