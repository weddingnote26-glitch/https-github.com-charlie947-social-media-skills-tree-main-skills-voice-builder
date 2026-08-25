/**
 * 프로그램이 클라우드 동기화 폴더 안에 있는지 살핀다.
 *
 * 왜 문제인가: 빌드하면 임시 파일이 수천 개씩 생겼다 사라진다. 구글 드라이브·
 * 원드라이브는 그것들을 하나하나 "백업할 새 파일" 로 보고 붙잡는다. 붙잡힌
 * 파일은 지울 수 없어서 빌드가 EPERM 으로 멈춘다. 실제로 겪은 오류다.
 *
 * 찾는 방법이 둘이다. 둘 다 필요하다:
 *
 *  ① 경로에 서비스 이름이 있는 경우 — 확실하다
 *     예: C:\Users\나\OneDrive\..., G:\내 드라이브\...
 *
 *  ② 경로는 멀쩡한데 동기화되는 경우 — 짐작만 할 수 있다
 *     구글 드라이브는 "폴더 백업" 으로 Documents 를 제자리에서 동기화한다.
 *     경로가 C:\Users\나\Documents\... 라 ① 로는 절대 못 잡는다.
 *     그래서 동기화 프로그램이 켜져 있는지도 함께 본다.
 */

/** 경로 조각에 이 낱말이 있으면 그 서비스의 폴더 안이다 */
const PATH_MARKERS = [
  ["onedrive", "원드라이브"],
  ["google drive", "구글 드라이브"],
  ["googledrive", "구글 드라이브"],
  ["내 드라이브", "구글 드라이브"],
  ["my drive", "구글 드라이브"],
  ["dropbox", "드롭박스"],
  ["icloud", "아이클라우드"],
  ["naver mybox", "네이버 마이박스"],
  ["pclouddrive", "p클라우드"],
];

/** 실행 중이면 "제자리 동기화" 를 하고 있을 수 있는 프로그램 */
const PROCESSES = [
  ["onedrive.exe", "원드라이브"],
  ["googledrivefs.exe", "구글 드라이브"],
  ["googledrivesync.exe", "구글 드라이브"],
  ["dropbox.exe", "드롭박스"],
  ["iclouddrive.exe", "아이클라우드"],
];

/** 경로 안에 클라우드 폴더 이름이 있으면 그 서비스 이름 */
export function cloudFolderName(dir) {
  const lower = String(dir).toLowerCase();
  for (const [marker, korean] of PATH_MARKERS) {
    if (lower.includes(marker)) return korean;
  }
  return null;
}

/** 켜져 있는 동기화 프로그램 이름들 (tasklist 출력 문자열을 받는다) */
export function runningCloudApps(taskListOutput) {
  if (!taskListOutput) return [];
  const lower = taskListOutput.toLowerCase();
  const found = new Set();
  for (const [exe, korean] of PROCESSES) {
    if (lower.includes(exe)) found.add(korean);
  }
  return [...found];
}

/** 개인 폴더(내 문서·바탕화면 등) 안인지 — 제자리 동기화 대상이 되기 쉬운 자리 */
export function inUserProfile(dir, home) {
  if (!home) return false;
  const d = String(dir).toLowerCase().replace(/\\/g, "/");
  const h = String(home).toLowerCase().replace(/\\/g, "/").replace(/\/$/, "");
  return d.startsWith(h + "/");
}

/**
 * 종합 판단.
 * @returns {{level:"none"|"maybe"|"sure", service:string|null, apps:string[]}}
 */
export function checkCloudSync({ dir, home, platform, taskListOutput }) {
  const service = cloudFolderName(dir);
  if (service) return { level: "sure", service, apps: [] };

  if (platform !== "win32") return { level: "none", service: null, apps: [] };

  const apps = runningCloudApps(taskListOutput);
  if (apps.length && inUserProfile(dir, home)) {
    return { level: "maybe", service: apps[0], apps };
  }
  return { level: "none", service: null, apps: [] };
}

/** 화면에 띄울 문장 (없으면 빈 문자열) */
export function cloudAdvice(result, dir) {
  if (result.level === "none") return "";

  const head = result.level === "sure"
    ? `[!] 이 프로그램이 ${result.service} 동기화 폴더 안에 있습니다.`
    : `[!] ${result.apps.join(" · ")}가 실행 중이고, 프로그램이 개인 폴더 안에 있습니다.`;

  const why = result.level === "sure"
    ? "    빌드할 때 만들어지는 임시 파일 수천 개를 동기화가 붙잡아 빌드가 실패할 수 있습니다."
    : "    개인 폴더를 동기화하도록 설정돼 있다면, 빌드가 EPERM 오류로 실패할 수 있습니다.";

  return [
    "",
    head,
    `    ${dir}`,
    why,
    "",
    "    지금 당장: 동기화를 잠시 멈추고 다시 실행하세요.",
    "      · 구글 드라이브 — 트레이의 구름 아이콘 → 톱니바퀴 → [동기화 일시 중지]",
    "      · 원드라이브   — 트레이의 구름 아이콘 → 톱니바퀴 → [동기화 일시 중지] → 2시간",
    "",
    "    제대로 된 해결: 프로그램을 동기화하지 않는 자리로 옮기세요 (예: C:\\orak).",
    "    작업 내용은 깃허브로 이미 동기화되므로 클라우드 백업은 필요하지 않습니다.",
    "",
  ].join("\n");
}
