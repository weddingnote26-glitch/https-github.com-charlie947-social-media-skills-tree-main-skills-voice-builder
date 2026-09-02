"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Card, ErrorBox, api } from "@/components/ui";
import { findCategory, TOPIC_CATEGORIES } from "@/lib/content/categories";

interface Topic { title: string; hook: string; why: string }
interface TopicsResponse {
  category: { key: string; icon: string; label: string; hint: string };
  topics: Topic[];
  source: "gemini" | "claude" | "sample";
  notice?: string;
}

const SOURCE_LABEL: Record<TopicsResponse["source"], string> = {
  gemini: "제미나이 분석", claude: "Claude 분석", sample: "예시 주제",
};

/**
 * 세부 주제 추천 화면.
 * 오늘의 릴스에서 4대 분류 하나를 누르면 여기로 온다. 주제를 고르면 "콘텐츠 유형" 이 채워진
 * 채로 오늘의 릴스로 돌아간다 — 맛집 이름·스타일은 거기서 마저 고른다.
 */
export default function TopicsPage() {
  const params = useParams<{ category: string }>();
  const router = useRouter();
  const key = String(params?.category ?? "");
  const known = findCategory(key);
  const [data, setData] = useState<TopicsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null); setLoading(true);
    try { setData(await api<TopicsResponse>(`/api/topics?category=${encodeURIComponent(key)}`)); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, [key]);

  useEffect(() => { if (known) void load(); }, [known, load]);

  if (!known) {
    return (
      <div className="page space-y-6">
        <h1 className="text-2xl font-extrabold">🧭 주제 고르기</h1>
        <ErrorBox msg="없는 분류입니다. 아래에서 다시 골라 주세요." />
        <CategoryLinks />
      </div>
    );
  }

  return (
    <div className="page space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/today" className="text-sm text-gray-600 hover:underline">← 오늘의 릴스</Link>
          <h1 className="text-2xl font-extrabold mt-1">{known.icon} {known.label}</h1>
          <p className="text-gray-600 mt-1">{known.hint} — 이 분류에 맞는 세부 주제를 추천합니다.</p>
        </div>
        <button className="btn-secondary" onClick={load} disabled={loading}>{loading ? "추천받는 중…" : "🔄 다시 추천받기"}</button>
      </header>
      <ErrorBox msg={err} />

      {data?.notice && (
        <div className="rounded-xl bg-blue-50 border border-blue-200 px-4 py-3 text-sm text-blue-900">ℹ️ {data.notice}</div>
      )}

      <Card
        title={data ? `추천 주제 ${data.topics.length}개` : "추천 주제"}
        right={data ? <span className="badge bg-gray-100 text-gray-700">{SOURCE_LABEL[data.source]}</span> : undefined}
      >
        {loading && !data && <p className="text-sm text-gray-600 py-6 text-center">AI 가 주제를 고르는 중…</p>}
        {data && (
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {data.topics.map((t) => (
              <li key={t.title} className="rounded-xl border-2 border-gray-200 p-4 flex flex-col gap-2 hover:border-gray-300 transition">
                <div className="font-extrabold text-base break-keep">{t.title}</div>
                {t.hook && <div className="text-sm text-gray-800">“{t.hook}”</div>}
                {t.why && <div className="text-xs text-gray-600">{t.why}</div>}
                <button
                  className="btn-secondary mt-auto self-start"
                  onClick={() => router.push(`/today?type=${encodeURIComponent(t.title)}`)}
                >
                  ✨ 이 주제로 만들기 →
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="다른 분류" collapsible>
        <CategoryLinks current={known.key} />
      </Card>
    </div>
  );
}

function CategoryLinks({ current }: { current?: string }) {
  return (
    <div className="flex flex-wrap gap-2">
      {TOPIC_CATEGORIES.filter((c) => c.key !== current).map((c) => (
        <Link key={c.key} href={`/topics/${c.key}`} className="chip">{c.icon} {c.label}</Link>
      ))}
    </div>
  );
}
