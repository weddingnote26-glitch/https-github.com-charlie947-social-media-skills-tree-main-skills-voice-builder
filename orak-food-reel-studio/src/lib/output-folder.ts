/**
 * 저장 폴더의 "이름"만 뽑는다.
 *
 * 폴더 열기는 본체(Electron)가 완성영상 폴더 안의 이름 하나만 받는다 —
 * 전체 경로를 보내도 본체가 마지막 이름만 남기고 버린다(electron/safe-path.js).
 * 화면 쪽에서도 같은 규칙으로 이름만 보내면, 어떤 실행 방식이든 같은 폴더가 열린다.
 * 릴스 상세 화면이 하던 계산을 제작중 화면·외부 영상 화면도 같이 쓰도록 한 자리에 모았다.
 */
export function outputFolderName(dir: string | null | undefined): string {
  const raw = String(dir ?? "").trim().replace(/[\\/]+$/, "");
  if (!raw) return "";
  const leaf = raw.split(/[\\/]/).pop() ?? "";
  if (!leaf || leaf === "." || leaf === "..") return "";
  return leaf;
}
