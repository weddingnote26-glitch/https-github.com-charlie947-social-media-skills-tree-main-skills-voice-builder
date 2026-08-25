"use client";
import { useRef, useState } from "react";
import { api, useApi, mediaUrl, LoadGate } from "./ui";
import ConfirmDialog, { type ConfirmOptions } from "./ConfirmDialog";
import { useToast } from "./Toast";

interface RefImage { rel: string; file: string; folder: string; path: string; sizeKb: number; builtin: boolean }
interface RefFolder { name: string; count: number }
interface Library { folders: RefFolder[]; images: RefImage[]; selected: string[]; summary?: string }

const folderLabel = (name: string) => (name === "" ? "기본 폴더" : name);

/**
 * 🖼 Master Reference 보관함.
 * 폴더 만들기·이름 바꾸기·삭제, 이미지 개별/여러 개 삭제, 폴더 간 이동,
 * 그리고 어떤 이미지를 캐릭터 기준으로 쓸지 선택.
 */
export default function ReferenceLibrary() {
  const { data, error: loadError, reload } = useApi<Library>("/api/character/library");
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const [folder, setFolder] = useState("");           // 지금 보고 있는 폴더
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<ConfirmOptions | null>(null);
  const [pending, setPending] = useState<(() => Promise<void>) | null>(null);
  const [busy, setBusy] = useState(false);
  const [newFolder, setNewFolder] = useState("");
  const [moveTo, setMoveTo] = useState("");

  if (!data) return <LoadGate error={loadError} onRetry={reload} what="기준 이미지 보관함" />;

  const folders = data.folders;
  const shown = data.images.filter((i) => i.folder === folder);
  const selected = new Set(data.selected);

  const ask = (options: ConfirmOptions, run: () => Promise<void>) => { setConfirm(options); setPending(() => run); };

  const runConfirmed = async () => {
    if (!pending) return;
    setBusy(true);
    try { await pending(); }
    catch (e) { toast.fromError(e, "다시 시도해 주세요. 계속 실패하면 파일이 다른 프로그램에서 열려 있는지 확인하세요."); }
    finally { setBusy(false); setConfirm(null); setPending(null); }
  };

  /** 서버 응답의 summary 를 그대로 알림으로 — 실제로 바뀐 내용이 담겨 있다 */
  const call = async (init: RequestInit, fallback: string) => {
    const r = await api<Library>("/api/character/library", init);
    setPicked(new Set());
    reload();
    toast.success(r.summary ?? fallback);
  };

  const guard = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); }
    catch (e) { toast.fromError(e); }
    finally { setBusy(false); }
  };

  /* ---------- 폴더 ---------- */

  const addFolder = () => guard(async () => {
    const name = newFolder.trim();
    if (!name) { toast.error("폴더 이름을 입력해 주세요."); return; }
    await call({ method: "POST", body: JSON.stringify({ action: "createFolder", name }) }, `폴더 "${name}" 이(가) 생성되었습니다.`);
    setNewFolder("");
    setFolder(name);
  });

  const rename = () => {
    if (!folder) return;
    const to = window.prompt(`"${folder}" 폴더의 새 이름을 입력하세요.`, folder);
    if (to === null) return;
    if (!to.trim() || to.trim() === folder) return;
    void guard(async () => {
      await call({ method: "POST", body: JSON.stringify({ action: "renameFolder", from: folder, to: to.trim() }) }, "폴더 이름을 바꿨습니다.");
      setFolder(to.trim());
    });
  };

  const removeFolder = (mode: "move" | "delete") => {
    if (!folder) return;
    const inside = data.images.filter((i) => i.folder === folder);
    ask(
      {
        title: `"${folder}" 폴더를 삭제할까요?`,
        message: mode === "move"
          ? `폴더 안의 이미지 ${inside.length}개는 지워지지 않고 기본 폴더로 옮겨집니다. 폴더만 사라집니다.`
          : `폴더와 함께 안에 있는 이미지 ${inside.length}개도 모두 삭제됩니다.`,
        items: inside.slice(0, 20).map((i) => i.file),
        warning: mode === "delete" ? "이미지 파일이 실제로 삭제되며 되돌릴 수 없습니다." : undefined,
        confirmLabel: mode === "move" ? "폴더만 삭제" : "이미지까지 삭제",
      },
      async () => {
        await call({ method: "DELETE", body: JSON.stringify({ folder: { name: folder, mode } }) }, "폴더를 삭제했습니다.");
        setFolder("");
      },
    );
  };

  /* ---------- 이미지 ---------- */

  const toggle = (rel: string) => setPicked((cur) => {
    const next = new Set(cur);
    if (next.has(rel)) next.delete(rel); else next.add(rel);
    return next;
  });

  const removeImages = (rels: string[]) => {
    const builtins = rels.filter((r) => data.images.find((i) => i.rel === r)?.builtin);
    ask(
      {
        title: rels.length === 1 ? "이 이미지를 삭제할까요?" : `이미지 ${rels.length}개를 삭제할까요?`,
        message: "파일이 실제로 삭제됩니다.",
        items: rels,
        warning: builtins.length
          ? `기본 제공 기준 이미지 ${builtins.length}개가 포함돼 있습니다. 지우면 캐릭터 일관성이 떨어질 수 있고, 되살리려면 npm run character 를 실행해야 합니다.`
          : "되돌릴 수 없습니다.",
        confirmLabel: `${rels.length}개 삭제`,
      },
      () => call({ method: "DELETE", body: JSON.stringify({ images: rels }) }, "이미지를 삭제했습니다."),
    );
  };

  const move = () => guard(async () => {
    const rels = [...picked];
    if (rels.length === 0) return;
    await call(
      { method: "POST", body: JSON.stringify({ action: "moveImages", images: rels, toFolder: moveTo }) },
      "이미지를 옮겼습니다.",
    );
  });

  const toggleSelected = (rel: string) => guard(async () => {
    const next = new Set(data.selected);
    if (next.has(rel)) next.delete(rel); else next.add(rel);
    await call({ method: "POST", body: JSON.stringify({ action: "select", images: [...next] }) }, "기준 이미지를 변경했습니다.");
  });

  const readAsDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`${file.name} 을(를) 읽지 못했습니다`));
    reader.readAsDataURL(file);
  });

  const OK_TYPES = ["image/png", "image/jpeg", "image/webp"];

  /** 여러 장을 한 번에 올린다 — 끌어다 놓기와 파일 고르기 모두 여기로 온다 */
  const upload = (files: File[]) => void guard(async () => {
    const images = files.filter((f) => OK_TYPES.includes(f.type));
    const skipped = files.length - images.length;
    if (!images.length) {
      throw new Error("PNG · JPG · WEBP 이미지 파일만 올릴 수 있습니다.");
    }
    let done = 0;
    for (const file of images) {
      const dataBase64 = await readAsDataUrl(file);
      await api("/api/character", {
        method: "POST",
        body: JSON.stringify({ file: file.name, folder, dataBase64 }),
      });
      done++;
    }
    reload();
    const tail = skipped ? ` (이미지가 아닌 파일 ${skipped}개는 건너뛰었습니다)` : "";
    toast.success(
      done === 1
        ? `이미지 1장을 ${folderLabel(folder)}에 넣었습니다.${tail}`
        : `이미지 ${done}장을 ${folderLabel(folder)}에 넣었습니다.${tail}`,
    );
  });

  return (
    <div className="space-y-4">
      {/* 폴더 줄 */}
      <div className="flex flex-wrap items-center gap-2">
        {folders.map((f) => (
          <button
            key={f.name || "__root__"}
            onClick={() => { setFolder(f.name); setPicked(new Set()); }}
            aria-pressed={folder === f.name}
            className="chip"
          >
            📁 {folderLabel(f.name)} <span className="ml-1 opacity-60">{f.count}</span>
          </button>
        ))}
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <input
            className="input w-full sm:w-40 min-w-0"
            placeholder="새 폴더 이름"
            value={newFolder}
            onChange={(e) => setNewFolder(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addFolder()}
            aria-label="새 폴더 이름"
          />
          <button className="btn-ghost" onClick={addFolder} disabled={busy}>＋ 폴더 만들기</button>
        </div>
      </div>

      {/* 현재 폴더 도구 */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-bold text-gray-700">{folderLabel(folder)}</span>
        <span className="text-gray-600">이미지 {shown.length}개</span>
        {folder && (
          <>
            <button className="btn-ghost" onClick={rename} disabled={busy}>이름 바꾸기</button>
            <button className="btn-ghost text-red-600 hover:bg-red-50" onClick={() => removeFolder("move")} disabled={busy}>
              폴더만 삭제
            </button>
            <button className="btn-ghost text-red-600 hover:bg-red-50" onClick={() => removeFolder("delete")} disabled={busy}>
              폴더+이미지 삭제
            </button>
          </>
        )}
        <span className="flex-1" />
        <button className="btn-ghost" onClick={() =>
          setPicked(picked.size === shown.length ? new Set() : new Set(shown.map((i) => i.rel)))
        }>
          {picked.size === shown.length && shown.length > 0 ? "선택 해제" : "전체 선택"}
        </button>
      </div>

      {/* 선택했을 때 나오는 작업 줄 */}
      {picked.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-[#FDEDE5] border border-[#E86A3A] px-3 py-2">
          <span className="text-sm font-bold text-[#B84A1B]">{picked.size}개 선택됨</span>
          <span className="flex-1" />
          <select className="input w-full sm:w-40 min-w-0" value={moveTo} onChange={(e) => setMoveTo(e.target.value)} aria-label="옮길 폴더">
            {folders.map((f) => <option key={f.name || "__root__"} value={f.name}>{folderLabel(f.name)}로 이동</option>)}
          </select>
          <button className="btn-ghost" onClick={move} disabled={busy}>이동</button>
          <button className="btn-danger" onClick={() => removeImages([...picked])} disabled={busy}>
            {picked.size}개 삭제
          </button>
        </div>
      )}

      {/* 이미지 격자 */}
      {shown.length === 0 ? (
        <p className="text-sm text-gray-600 py-8 text-center">이 폴더에 이미지가 없습니다.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {shown.map((img) => {
            const checked = picked.has(img.rel);
            const isRef = selected.has(img.rel);
            return (
              <div key={img.rel} className={`rounded-xl border-2 p-2 transition ${checked ? "border-[#E86A3A] bg-[#FDEDE5]" : "border-gray-200"}`}>
                <div className="relative">
                  {mediaUrl(img.path) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={mediaUrl(img.path)!} alt={img.file} className="aspect-square w-full object-cover rounded-lg border bg-white" />
                  ) : (
                    <div className="aspect-square rounded-lg border-2 border-dashed border-gray-300" />
                  )}
                  <input
                    type="checkbox"
                    className="absolute top-1.5 left-1.5 w-5 h-5 accent-[#E86A3A] cursor-pointer"
                    checked={checked}
                    onChange={() => toggle(img.rel)}
                    aria-label={`${img.file} 선택`}
                  />
                  {isRef && <span className="absolute top-1.5 right-1.5 badge bg-[#B84A1B] text-white">기준</span>}
                </div>
                <div className="text-xs font-bold mt-1 text-gray-700 truncate" title={img.file}>{img.file}</div>
                <div className="text-xs text-gray-600 mb-1">{img.sizeKb}KB{img.builtin && " · 기본"}</div>
                <div className="flex flex-wrap gap-1">
                  <button className="btn-ghost flex-1 min-w-0 px-3" onClick={() => toggleSelected(img.rel)} disabled={busy}>
                    {isRef ? "기준 해제" : "기준으로"}
                  </button>
                  <button className="btn-ghost px-3 text-red-600 hover:bg-red-50" onClick={() => removeImages([img.rel])} disabled={busy}>
                    삭제
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 예전에는 회색 단추 하나가 목록 맨 아래 묻혀 있어 첨부할 수 있는 줄 모르셨다.
          끌어다 놓을 수 있는 넓은 자리로 바꾸고, 여러 장을 한 번에 받는다. */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault(); setDragging(false);
          const files = Array.from(e.dataTransfer.files ?? []);
          if (files.length) upload(files);
        }}
        className={`rounded-xl border-2 border-dashed p-5 text-center transition ${
          dragging ? "border-[#E86A3A] bg-[#FDEDE5]" : "border-gray-300 bg-gray-50"
        }`}
      >
        <p className="text-base font-bold text-gray-800 mb-1">
          {dragging ? "여기에 놓으세요" : "오락이 이미지를 여기로 끌어다 놓으세요"}
        </p>
        <p className="text-xs text-gray-600 mb-3">PNG · JPG · WEBP · 여러 장 한꺼번에 가능</p>
        <button className="btn-primary" onClick={() => fileInput.current?.click()} disabled={busy}>
          {busy ? "올리는 중…" : `📎 파일 고르기 → ${folderLabel(folder)}`}
        </button>
        <input ref={fileInput} type="file" multiple accept="image/png,image/jpeg,image/webp" hidden
          onChange={(e) => { const f = Array.from(e.target.files ?? []); if (f.length) upload(f); e.target.value = ""; }} />
      </div>

      <p className="text-xs text-gray-600">
        “기준”으로 표시한 이미지가 이미지 생성 시 함께 전달됩니다 (앞의 3개까지).
        하나도 고르지 않으면 기본 Master Reference 를 씁니다.
      </p>

      <ConfirmDialog
        open={!!confirm}
        options={confirm}
        busy={busy}
        onCancel={() => { if (!busy) { setConfirm(null); setPending(null); } }}
        onConfirm={runConfirmed}
      />
    </div>
  );
}
