"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, ProgressBar, StatusBadge, StepRow, api, useApi, ErrorBox, isDesktopApp, canOpenFolder, openOutputFolder } from "@/components/ui";
import ConfirmDialog, { type ConfirmOptions } from "@/components/ConfirmDialog";
import { useToast } from "@/components/Toast";
import { jobProgress, overallProgress, type ProgressStep } from "@/lib/pipeline/progress";
import { outputFolderName } from "@/lib/output-folder";

interface JobRow {
  id: string;
  reel_id: string | null;
  steps: ProgressStep[];
  status: string;
  error: string | null;
  created_at: string;
  updated_at: string;
  reel_title: string | null;
  /** 저장 폴더 — 대본이 만들어져 릴스가 생긴 뒤부터 있다 */
  output_dir: string | null;
}
interface JobsResponse {
  jobs: JobRow[];
  counts: Record<string, number>;
}
/** 외부 영상 + AI 음성 작업 (imported_video_jobs — 맛집 릴스 작업과 다른 표) */
interface ImportedJob {
  id: string;
  title: string;
  steps: ProgressStep[];
  status: string;
  error: string | null;
  updated_at: string;
  output_dir: string | null;
  final_path: string | null;
}
interface ImportedResponse {
  jobs: ImportedJob[];
  counts: Record<string, number>;
}

const shortId = (id: string) => id.slice(-6);

export default function Producing() {
  const running = useApi<JobsResponse>("/api/jobs?status=진행중", 2000);
  const failed = useApi<JobsResponse>("/api/jobs?status=실패", 5000);
  // 외부 영상 AI 음성 작업은 표가 다르므로 따로 불러온다 (맛집 릴스 작업과 섞지 않는다)
  const importedRunning = useApi<ImportedResponse>("/api/imported?status=진행중", 2000);
  const importedFailed = useApi<ImportedResponse>("/api/imported?status=실패", 5000);
  const toast = useToast();

  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<ConfirmOptions | null>(null);
  const [pendingAction, setPendingAction] = useState<(() => Promise<void>) | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // 폴더 열기는 설치형 앱에서만 된다. 서버가 그린 화면과 어긋나지 않게 화면이 켜진 뒤에 확인한다.
  const [desktop, setDesktop] = useState(false);
  useEffect(() => { setDesktop(canOpenFolder()); }, []);

  const jobs = running.data?.jobs ?? [];
  const failedJobs = failed.data?.jobs ?? [];
  const importedJobs = importedRunning.data?.jobs ?? [];
  const importedFailedJobs = importedFailed.data?.jobs ?? [];
  const runningCount = jobs.length + importedJobs.length;

  const overall = useMemo(
    () => overallProgress([...jobs.map((j) => j.steps), ...importedJobs.map((j) => j.steps)]),
    [jobs, importedJobs],
  );

  const toggle = (id: string) =>
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const reloadAll = useCallback(() => {
    failed.reload(); running.reload(); importedFailed.reload(); importedRunning.reload();
  }, [failed, running, importedFailed, importedRunning]);

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
      toast.fromError(e, isDesktopApp() ? "잠시 후 다시 시도해 주세요. 계속 안 되면 프로그램을 껐다 켜 주세요." : "잠시 후 다시 시도하거나, 검은 창(start.bat)이 켜져 있는지 확인해 주세요.");
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

  /** 외부 영상 작업 기록 삭제 — 영상 파일은 남긴다 */
  const deleteImported = (job: ImportedJob) =>
    ask(
      {
        title: "이 외부 영상 작업 기록을 삭제할까요?",
        message: "작업 기록만 지웁니다. 이미 만들어진 영상 파일은 그대로 남습니다.",
        items: [`외부 영상 ${shortId(job.id)} — ${job.title}`],
        confirmLabel: "삭제",
      },
      async () => {
        const r = await api<{ removed: number }>("/api/imported", { method: "DELETE", body: JSON.stringify({ ids: [job.id] }) });
        reloadAll();
        if (r.removed === 0) toast.info("이미 삭제된 작업입니다.", ["목록을 새로 불러왔습니다."]);
        else toast.success(`외부 영상 작업 1개가 삭제되었습니다. (${shortId(job.id)})`);
      },
    );

  /**
   * 저장 폴더 열기 (설치형 앱에서만).
   * 본체에는 폴더 "이름"만 보낸다 — 완성영상 폴더 밖은 열리지 않는다 (electron/safe-path.js).
   * 폴더가 아직 없으면 본체가 완성영상 기본 폴더를 대신 연다.
   */
  const openFolder = async (dir: string | null | undefined) => {
    const name = outputFolderName(dir);
    const r = await openOutputFolder(name);
    if (!r.ok) {
      toast.error(r.reason ?? "폴더를 열지 못했습니다.", "프로그램을 껐다 켠 뒤 다시 시도해 주세요.");
      return;
    }
    const opened = (r.opened ?? "").replace(/[\\/]+$/, "");
    if (name && opened && !opened.endsWith(name)) {
      toast.info("아직 이 작업의 폴더가 없어 완성영상 기본 폴더를 열었습니다.");
    } else {
      toast.info(name ? `저장 폴더를 열었습니다. (${name})` : "완성영상 기본 폴더를 열었습니다.");
    }
  };

  /** 작업 카드의 폴더 단추 — 폴더가 아직 없으면 언제 생기는지 알린다 */
  const folderButton = (dir: string | null, whenMissing: string, small = false) => {
    if (!desktop) return null;
    if (!dir) return <span className="text-xs text-gray-600">📁 {whenMissing}</span>;
    return (
      <button className={small ? "btn-ghost" : "btn-secondary"} onClick={() => openFolder(dir)}>
        📁 {small ? "폴더" : "저장 폴더 열기"}
      </button>
    );
  };

  return (
    <div className="page space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold">🎬 제작중</h1>
        <div className="flex flex-wrap gap-2">
          <Link href="/imported" className="btn-secondary">➕ 제작한 영상 불러와 AI 음성 입히기</Link>
          {desktop && (
            <button className="btn-secondary" onClick={() => openFolder("")}>📁 완성영상 기본 폴더 열기</button>
          )}
        </div>
      </div>
      <ErrorBox msg={err} />

      {/* ---------- 진행 중 ---------- */}
      {runningCount > 1 && (
        <Card title={`전체 진행률 — 작업 ${runningCount}개 동시 진행`}>
          <div className="flex items-center gap-3">
            <div className="flex-1"><ProgressBar pct={overall} label="전체 진행률" /></div>
            <span className="text-lg font-extrabold tabular-nums w-14 text-right">{overall}%</span>
          </div>
          <p className="text-xs text-gray-600 mt-2">끝난 단계만 세어 계산합니다. 진행률을 알 수 없는 단계는 완료 전까지 반영하지 않습니다.</p>
        </Card>
      )}

      {runningCount === 0 && failedJobs.length === 0 && importedFailedJobs.length === 0 && (
        <Card>
          <div className="text-center text-gray-600 py-14">
            지금 제작 중인 작업이 없습니다.<br />
            <Link href="/today" className="text-[#B84A1B] font-bold">✨ 오늘의 릴스 만들기 →</Link>
            <span className="mx-2 text-gray-400">·</span>
            <Link href="/imported" className="text-[#B84A1B] font-bold">🎞 제작한 영상에 AI 음성 입히기 →</Link>
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
            <div className="flex flex-wrap items-center gap-2 mt-4">
              {p.reel_id && <Link href={`/reel/${p.reel_id}`} className="btn-secondary">결과 보기 →</Link>}
              {folderButton(p.output_dir, "저장 폴더는 대본이 만들어진 뒤에 생깁니다")}
            </div>
          </Card>
        );
      })}

      {importedJobs.map((p) => {
        const pct = jobProgress(p.steps);
        return (
          <Card
            key={p.id}
            title={`외부 영상 ${shortId(p.id)} — ${p.title}`}
            right={
              <div className="flex items-center gap-2">
                <span className="text-sm font-extrabold tabular-nums">{pct}%</span>
                <StatusBadge status={p.status} />
              </div>
            }
          >
            <div className="mb-3"><ProgressBar pct={pct} label={`외부 영상 ${shortId(p.id)} 진행률`} /></div>
            <div className="space-y-2.5">
              {p.steps.map((s) => <StepRow key={s.key} step={s} />)}
            </div>
            <div className="flex flex-wrap items-center gap-2 mt-4">
              <Link href="/imported" className="btn-secondary">외부 영상 화면에서 보기 →</Link>
              {folderButton(p.output_dir, "저장 폴더는 원본 확인이 끝난 뒤에 생깁니다")}
            </div>
          </Card>
        );
      })}

      {/* ---------- 실패 목록 ---------- */}
      {failedJobs.length > 0 && (
        <Card
          title={`❌ 실패한 작업 ${failedJobs.length}개`}
          right={
            <div className="flex gap-2">
              <button className="btn-ghost" onClick={() =>
                setPicked(picked.size === failedJobs.length ? new Set() : new Set(failedJobs.map((j) => j.id)))
              }>
                {picked.size === failedJobs.length ? "선택 해제" : "전체 선택"}
              </button>
              <button className="btn-danger" disabled={picked.size === 0} onClick={deletePicked}>
                선택 {picked.size}개 삭제
              </button>
              <button className="btn-danger" onClick={deleteAllFailed}>
                전체 삭제
              </button>
            </div>
          }
        >
          <p className="text-xs text-gray-600 mb-3">
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
                        {jb.reel_title && <span className="text-gray-600 font-normal"> — {jb.reel_title}</span>}
                      </div>
                      <div className="text-xs text-gray-600 mt-0.5">
                        {jb.updated_at}
                        {failedStep && <> · <b className="text-red-600">{failedStep.label}</b> 에서 멈춤</>}
                      </div>
                      {jb.error && <p className="text-xs text-red-700 mt-1 break-words line-clamp-3">{jb.error}</p>}
                    </div>
                    <div className="flex gap-1 shrink-0">
                      {jb.reel_id && <Link href={`/reel/${jb.reel_id}`} className="btn-ghost">보기</Link>}
                      {desktop && jb.output_dir && folderButton(jb.output_dir, "", true)}
                      <button className="btn-ghost text-red-600 hover:bg-red-50" onClick={() => deleteOne(jb)}>
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

      {importedFailedJobs.length > 0 && (
        <Card title={`❌ 실패한 외부 영상 작업 ${importedFailedJobs.length}개`}>
          <p className="text-xs text-gray-600 mb-3">
            작업 기록만 지웁니다. 원본 영상과 이미 만들어진 파일은 <b>그대로 남습니다.</b>
          </p>
          <ul className="space-y-2">
            {importedFailedJobs.map((jb) => {
              const failedStep = jb.steps.find((s) => s.status === "실패");
              return (
                <li key={jb.id} className="rounded-xl border-2 border-gray-200 p-3">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-sm">외부 영상 {shortId(jb.id)} <span className="text-gray-600 font-normal">— {jb.title}</span></div>
                      <div className="text-xs text-gray-600 mt-0.5">
                        {jb.updated_at}
                        {failedStep && <> · <b className="text-red-600">{failedStep.label}</b> 에서 멈춤</>}
                      </div>
                      {jb.error && <p className="text-xs text-red-700 mt-1 break-words line-clamp-3">{jb.error}</p>}
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Link href="/imported" className="btn-ghost">다시 하기</Link>
                      {desktop && jb.output_dir && folderButton(jb.output_dir, "", true)}
                      <button className="btn-ghost text-red-600 hover:bg-red-50" onClick={() => deleteImported(jb)}>삭제</button>
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
