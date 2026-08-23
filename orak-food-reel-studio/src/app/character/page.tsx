"use client";
import { useRef, useState } from "react";
import { Card, api, useApi, ErrorBox, mediaUrl } from "@/components/ui";

interface CharData {
  character: { name: string; world: string; brandColor: string; heightCm: number; personality: Record<string, number>; props: string[]; brandDevices: string[] };
  references: Array<{ file: string; exists: boolean; path: string }>;
  lock: { enabled: boolean; seed: number; referenceImages: string[] };
  actions: string[];
  expressions: string[];
  speechSamples: string[];
  verdictPhrases: Record<string, string[]>;
}

export default function CharacterPage() {
  const { data, reload } = useApi<CharData>("/api/character");
  const [err, setErr] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploadTarget, setUploadTarget] = useState<string>("character_sheet.png");

  const upload = async (file: File) => {
    setErr(null);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        await api("/api/character", {
          method: "POST",
          body: JSON.stringify({ file: uploadTarget, dataBase64: String(reader.result) }),
        });
        reload();
      } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    };
    reader.readAsDataURL(file);
  };

  const setLock = async (patch: Record<string, unknown>) => {
    try { await api("/api/character", { method: "PATCH", body: JSON.stringify(patch) }); reload(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  };

  if (!data) return <div className="text-gray-400 py-20 text-center">불러오는 중…</div>;
  const c = data.character;

  return (
    <div className="max-w-4xl space-y-6">
      <header>
        <h1 className="text-2xl font-extrabold">🥟 {c.name}</h1>
        <p className="text-gray-500 mt-1">“{c.world}” — 오락푸드 전속 캐릭터 IP</p>
      </header>
      <ErrorBox msg={err} />

      <div className="grid grid-cols-2 gap-6">
        <Card title="캐릭터 프로필">
          <dl className="text-sm space-y-2">
            <div className="flex justify-between"><dt className="text-gray-500 font-bold">실제 크기 설정</dt><dd className="font-bold">약 {c.heightCm}cm (테이블 위 크기)</dd></div>
            <div className="flex justify-between"><dt className="text-gray-500 font-bold">브랜드 컬러</dt><dd className="font-bold flex items-center gap-2"><span className="inline-block w-4 h-4 rounded" style={{ background: c.brandColor }} />{c.brandColor}</dd></div>
            <div className="flex justify-between"><dt className="text-gray-500 font-bold">성격</dt><dd className="font-bold">{Object.entries(c.personality).map(([k, v]) => `${k} ${v}%`).join(" · ")}</dd></div>
            <div><dt className="text-gray-500 font-bold mb-1">대표 소품</dt><dd className="flex flex-wrap gap-1.5">{c.props.map((p) => <span key={p} className="badge bg-gray-100 text-gray-700">{p}</span>)}</dd></div>
            <div><dt className="text-gray-500 font-bold mb-1">브랜드 반복 장치 (매 영상 1개 이상)</dt><dd className="flex flex-wrap gap-1.5">{c.brandDevices.map((p) => <span key={p} className="badge bg-[#FDEDE5] text-[#E86A3A]">{p}</span>)}</dd></div>
          </dl>
        </Card>

        <Card title="🔒 캐릭터 고정 (Character Lock)">
          <label className="flex items-center gap-3 mb-4 cursor-pointer">
            <input type="checkbox" className="w-5 h-5 accent-[#E86A3A]" checked={data.lock.enabled}
              onChange={(e) => setLock({ enabled: e.target.checked })} />
            <span className="font-bold">오락이 캐릭터 고정</span>
          </label>
          <p className="text-sm text-gray-500 mb-3">켜져 있으면 만두 형태·얼굴·눈·모자·비율·컬러·가방과 Character Seed가 모든 이미지 프롬프트에 고정됩니다. AI가 임의로 디자인을 바꾸지 않습니다.</p>
          <div className="flex items-center gap-2">
            <label className="text-sm font-bold text-gray-600">Character Seed</label>
            <input type="number" className="input w-40 py-2 text-sm" defaultValue={data.lock.seed}
              onBlur={(e) => setLock({ seed: parseInt(e.target.value) || data.lock.seed })} />
          </div>
        </Card>
      </div>

      <Card title="🖼 Master Reference — 캐릭터 일관성의 기준">
        <p className="text-sm text-gray-500 mb-4">한 번 확정한 오락이 이미지를 등록해두면, 모든 콘텐츠에서 같은 얼굴·의상·비율을 유지하도록 프롬프트에 반영됩니다.</p>
        <div className="grid grid-cols-7 gap-3">
          {data.references.map((r) => (
            <div key={r.file} className="text-center">
              {r.exists && mediaUrl(r.path) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={mediaUrl(r.path)!} alt={r.file} className="aspect-square w-full object-cover rounded-xl border" />
              ) : (
                <div className="aspect-square rounded-xl border-2 border-dashed border-gray-300 flex items-center justify-center text-gray-300 text-2xl">＋</div>
              )}
              <div className="text-[11px] font-bold mt-1 text-gray-600">{r.file}</div>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-3 mt-4">
          <select className="input w-56 py-2 text-sm" value={uploadTarget} onChange={(e) => setUploadTarget(e.target.value)}>
            {data.references.map((r) => <option key={r.file}>{r.file}</option>)}
          </select>
          <button className="btn-secondary" onClick={() => fileInput.current?.click()}>이미지 업로드</button>
          <input ref={fileInput} type="file" accept="image/png,image/jpeg" hidden
            onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-6">
        <Card title="🎬 행동 라이브러리">
          <div className="flex flex-wrap gap-1.5">{data.actions.map((a) => <span key={a} className="badge bg-gray-100 text-gray-700">{a}</span>)}</div>
        </Card>
        <Card title="😀 표정 라이브러리">
          <div className="flex flex-wrap gap-1.5">{data.expressions.map((a) => <span key={a} className="badge bg-gray-100 text-gray-700">{a}</span>)}</div>
        </Card>
      </div>

      <Card title="💬 대표 말투 (그대로 반복하지 않고 매번 변형됩니다)">
        <div className="grid grid-cols-2 gap-2 text-sm">
          {data.speechSamples.map((s) => <div key={s} className="rounded-lg bg-gray-50 px-3 py-2">“{s}”</div>)}
        </div>
      </Card>

      <Card title="⚖️ 탐정 판정 문구 은행">
        <div className="space-y-2 text-sm">
          {Object.entries(data.verdictPhrases).map(([k, arr]) => (
            <div key={k}><span className="font-extrabold text-gray-600">{k}:</span> <span className="text-gray-700">{arr.join(" / ")}</span></div>
          ))}
        </div>
        <p className="text-xs text-gray-400 mt-3">* “오락이 탐정 판정”은 오락푸드 자체 콘텐츠 평가로 표기됩니다. 과장 효능·허위 사실은 생성하지 않습니다.</p>
      </Card>
    </div>
  );
}
