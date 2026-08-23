"use client";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { Card, ProgressBar, StatusBadge, StepRow, api, useApi, ErrorBox } from "@/components/ui";
import ConfirmDialog, { type ConfirmOptions } from "@/components/ConfirmDialog";
import { useToast } from "@/components/Toast";
import { jobProgress, overallProgress, type ProgressStep } from "@/lib/pipeline/progress";

interface JobRow {
  id: string;
  reel_id: string | null;
  steps: ProgressStep[];
  status: string;
  error: string | null;
  created_at: string;
  updated_at: string;
  reel_title: string | null;
}
interface JobsResponse {
  jobs: JobRow[];
  counts: Record<string, number>;
}

const shortId = (id: string) => id.slice(-6);

export default function Producing() {
  const running = useApi<JobsResponse>("/api/jobs?status=진행중", 2000);
  const failed = useApi<JobsResponse>("/api/jobs?status=실패", 5000);
  const toast = useToast();

  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<ConfirmOptions | null>(null);
  const [pendingAction, setPendingAction] = useState<(() => Promise<void>) | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const jobs = running.data?.jobs ?? [];
  const failedJobs = failed.data?.jobs ?? [];

  const overall = useMemo(() => overallProgress(jobs.map((j) => j.steps)), [jobs]);

  const toggle = (id: string) =>
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const reloadAll = useCallback(() => { failed.reload(); running.reload(); }, [failed, running]);

  /** 확인 창을 띄우고, 확인을 누르면 실제 삭제를 수행한다 */
  const ask = (options: ConfirmOptions, run: () => Promise<void>) => {
    setConfirm(options);
    setPendingAction(() => run);
  };

  const runConfirmed = async () => {
    if (!pendingAction) return;
    setBusy(true); setErr(null);
    try {
      await pendingAction();
    } catch (e) {
      // 실패했을 때는 성공 알림을 띄우지 않는다
      toast.fromError(e, "잠시 후 다시 시도하거나, 검은 창(start.bat)이 켜져 있는지 확인해 주세요.");
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setConfirm(null);
      setPendingAction(null);
    }
  };

  const del = async (body: object, describe: (removed: number) => string) => {
    const r = await api<{ removed: number }>("/api/jobs", { method: "DELETE", body: JSON.stringify(body) });
    setPicked(new Set());
    reloadAll();
    if (r.removed === 0) {
      // 새로고침 전에 이미 지워진 경우 — 오류가 아니라 사실을 알린다
      toast.info("이미 삭제된 작업입니다.", ["목록을 새로 불러왔습니다."]);
    } else {
      toast.success(describe(r.removed));
    }
  };

  const deleteOne = (job: JobRow) =>
    ask(
      {
        title: "이 작업 기록을 삭제할까요?",
        message: "작업 기록만 지웁니다. 이미 만들어진 릴스와 영상 파일은 그대로 남습니다.",
        items: [`작업 ${shortId(job.id)}${job.reel_title ? ` — ${job.reel_title}` : ""}`],
        confirmLabel: "삭제",
      },
      () => del({ ids: [job.id] }, () => `실패한 작업 1개가 삭제되었습니다. (${shortId(job.id)})`),
    );

  const deletePicked = () => {
    const ids = [...picked];
    ask(
      {
        title: `선택한 작업 ${ids.length}개를 삭제할까요?`,
        message: "작업 기록만 지웁니다. 이미 만들어진 릴스와 영상 파일은 그대로 남습니다.",
        items: ids.map((id) => {
          const jb = failedJobs.find((x) => x.id === id);
          return `작업 ${shortId(id)}${jb?.reel_title ? ` — ${jb.reel_title}` : ""}`;
        }),
        confirmLabel: `${ids.length}개 삭제`,
      },
      () => del({ ids }, (n) => `실패한 작업 ${n}개가 삭제되었습니다.`),
    );
  };

  const deleteAllFailed = () =>
    ask(
      {
        title: "실패 목록을 전부 삭제할까요?",
        message: `실패한 작업 기록 ${failedJobs.length}개를 모두 지웁니다. 작업 기록만 지우며, 이미 만들어진 릴스와 영상 파일은 그대로 남습니다.`,
        warning: "되돌릴 수 없습니다.",
        confirmLabel: "전체 삭제",
      },
      () => del({ allWithStatus: "실패" }, (n) => `실패한 작업 ${n}개가 모두 삭제되었습니다.`),
    );

  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-extrabold">🎬 제작중</h1>
      <ErrorBox msg={err} />

      {/* ---------- 진행 중 ---------- */}
      {jobs.length > 1 && (
        <Card title={`전체 진행률 — 작업 ${jobs.length}개 동시 진행`}>
          <div className="flex items-center gap-3">
            <div className="flex-1"><ProgressBar pct={overall} label="전체 진행률" /></div>
            <span className="text-lg font-extrabold tabular-nums w-14 text-right">{overall}%</span>
          </div>
          <p className="text-xs text-gray-400 mt-2">끝난 단계만 세어 계산합니다. 진행률을 알 수 없는 단계는 완료 전까지 반영하지 않습니다.</p>
        </Card>
      )}

      {jobs.length === 0 && failedJobs.length === 0 && (
        <Card>
          <div className="text-center text-gray-400 py-14">
            지금 제작 중인 작업이 없습니다.<br />
            <Link href="/today" className="text-[#E86A3A] font-bold">✨ 오늘의 릴스 만들기 →</Link>
          </div>
        </Card>
      )}

      {jobs.map((p) => {
        const pct = jobProgress(p.steps);
        return (
          <Card
            key={p.id}
            title={`작업 ${shortId(p.id)}${p.reel_title ? ` — ${p.reel_title}` : ""}`}
            right={
              <div className="flex items-center gap-2">
                <span className="text-sm font-extrabold tabular-nums">{pct}%</span>
                <StatusBadge status={p.status} />
              </div>
            }
          >
            <div className="mb-3"><ProgressBar pct={pct} label={`작업 ${shortId(p.id)} 진행률`} /></div>
            <div className="space-y-2.5">
              {p.steps.map((s) => <StepRow key={s.key} step={s} />)}
            </div>
            {p.reel_id && <Link href={`/reel/${p.reel_id}`} className="btn-secondary mt-4 w-full">결과 보기 →</Link>}
          </Card>
        );
      })}

      {/* ---------- 실패 목록 ---------- */}
      {failedJobs.length > 0 && (
        <Card
          title={`❌ 실패한 작업 ${failedJobs.length}개`}
          right={
            <div className="flex gap-2">
              <button className="btn-ghost text-xs" onClick={() =>
                setPicked(picked.size === failedJobs.length ? new Set() : new Set(failedJobs.map((j) => j.id)))
              }>
                {picked.size === failedJobs.length ? "선택 해제" : "전체 선택"}
              </button>
              <button className="btn-danger text-xs px-3 py-1.5" disabled={picked.size === 0} onClick={deletePicked}>
                선택 {picked.size}개 삭제
              </button>
              <button className="btn-danger text-xs px-3 py-1.5" onClick={deleteAllFailed}>
                전체 삭제
              </button>
            </div>
          }
        >
          <p className="text-xs text-gray-400 mb-3">
            작업 기록만 지웁니다. 이미 만들어진 릴스와 영상 파일은 <b>그대로 남습니다.</b>
          </p>
          <ul className="space-y-2">
            {failedJobs.map((jb) => {
              const failedStep = jb.steps.find((s) => s.status === "실패");
              const checked = picked.has(jb.id);
              return (
                <li key={jb.id} className={`rounded-xl border-2 p-3 transition ${checked ? "border-[#E86A3A] bg-[#FDEDE5]" : "border-gray-200"}`}>
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      className="mt-1 w-5 h-5 accent-[#E86A3A] shrink-0 cursor-pointer"
                      checked={checked}
                      onChange={() => toggle(jb.id)}
                      aria-label={`작업 ${shortId(jb.id)} 선택`}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-sm">
                        작업 {shortId(jb.id)}
                        {jb.reel_title && <span className="text-gray-500 font-normal"> — {jb.reel_title}</span>}
                      </div>
                      <div className="text-xs text-gray-400 mt-0.5">
                        {jb.updated_at}
                        {failedStep && <> · <b className="text-red-600">{failedStep.label}</b> 에서 멈춤</>}
                      </div>
                      {jb.error && <p className="text-xs text-red-700 mt-1 break-words line-clamp-3">{jb.error}</p>}
                    </div>
                    <div className="flex gap-1 shrink-0">
                      {jb.reel_id && <Link href={`/reel/${jb.reel_id}`} className="btn-ghost text-xs px-2.5">보기</Link>}
                      <button className="btn-ghost text-xs px-2.5 text-red-600 hover:bg-red-50" onClick={() => deleteOne(jb)}>
                        삭제
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <ConfirmDialog
        open={!!confirm}
        options={confirm}
        busy={busy}
        onCancel={() => { if (!busy) { setConfirm(null); setPendingAction(null); } }}
        onConfirm={runConfirmed}
      />
    </div>
  );
}
