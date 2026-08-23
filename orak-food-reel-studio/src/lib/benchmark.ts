import { db } from "./db";
import { newId } from "./id";
import { getLLM, extractJson } from "./providers/llm";
import { getEnv } from "./env";

/**
 * §58 릴스 벤치마킹 — 구조·연출 방식만 분석. 원본 복제 금지.
 * 접근 가능한 공개 정보가 없으면 구조 프레임만 제공.
 */
export interface BenchmarkAnalysis {
  hook_structure: string;
  estimated_length: string;
  scene_structure: string;
  subtitle_style: string;
  info_layout: string;
  cta_structure: string;
  tempo: string;
  note: string;
}

export async function analyzeBenchmark(url: string): Promise<{ id: string; analysis: BenchmarkAnalysis; template: Record<string, string> }> {
  const env = getEnv();
  let pageText = "";
  try {
    const res = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; OrakFoodStudio/1.0)" },
      signal: AbortSignal.timeout(12000),
    });
    if (res.ok) {
      const html = await res.text();
      const og = [...html.matchAll(/<meta[^>]+(?:property|name)="og:(title|description)"[^>]+content="([^"]*)"/g)]
        .map((m) => `${m[1]}: ${m[2]}`).join("\n");
      pageText = og;
    }
  } catch { /* 접근 불가 — 무리하게 크롤링하지 않음 */ }

  const llm = getLLM();
  const raw = await llm.complete({
    task: "benchmark",
    system: "너는 숏폼 구조 분석가다. 특정 크리에이터의 문장이나 고유 연출을 복제하지 말고, 구조 원리만 일반화해서 설명하라.",
    user: `다음 릴스 URL의 공개 메타정보를 참고해 HOOK 구조/예상 길이/SCENE 구조/자막 스타일/정보 배치/CTA 구조/템포를 JSON으로 정리하라.
{"hook_structure":"","estimated_length":"","scene_structure":"","subtitle_style":"","info_layout":"","cta_structure":"","tempo":"","note":""}
URL: ${url}
공개 메타정보:\n${pageText || "(접근 가능한 정보 없음 — 일반적인 맛집 릴스 구조 원리로 정리)"}`,
    context: { url },
  });
  const analysis = JSON.parse(extractJson(raw)) as BenchmarkAnalysis;

  // 오락푸드용 재구성 템플릿 (복제가 아닌 원리 적용)
  const template = {
    이름: `벤치마킹 템플릿 ${new Date().toISOString().slice(0, 10)}`,
    훅원리: analysis.hook_structure,
    장면구성: analysis.scene_structure,
    정보배치: analysis.info_layout,
    CTA원리: analysis.cta_structure,
    적용메모: "오락푸드 톤(친구에게 알려주는 말투)과 만두탐정 오락이 세계관에 맞게 재구성해 사용합니다. 원본 문구·연출은 복제하지 않습니다.",
  };
  const id = newId("bm");
  db().prepare("INSERT INTO benchmarks (id, source_url, analysis_json, template_json) VALUES (?,?,?,?)")
    .run(id, url, JSON.stringify(analysis), JSON.stringify(template));
  void env;
  return { id, analysis, template };
}

export function listBenchmarks(): Array<{ id: string; source_url: string; analysis_json: string; template_json: string; created_at: string }> {
  return db().prepare("SELECT * FROM benchmarks ORDER BY created_at DESC LIMIT 50").all() as Array<{
    id: string; source_url: string; analysis_json: string; template_json: string; created_at: string;
  }>;
}
