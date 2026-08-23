"use strict";
/**
 * 오락푸드 AI릴스 자동제작 스튜디오 — 창을 띄우는 껍데기.
 *
 * 하는 일은 셋뿐이다.
 *   1) 데이터를 쓸 자리를 정해 준다 (설치 폴더는 쓰기 금지일 수 있다)
 *   2) 안에 들어 있는 Next.js 서버를 조용히 띄운다 (검은 창 없이)
 *   3) 준비되면 창 하나에 그 화면을 보여 준다
 *
 * 기능은 전부 기존 웹 앱 그대로다. 여기서는 아무것도 바꾸지 않는다.
 */
const { app, BrowserWindow, shell, dialog, Menu } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const net = require("node:net");
const { fork } = require("node:child_process");

const APP_NAME = "오락푸드 AI릴스 자동제작 스튜디오";
const isDev = !app.isPackaged;

/* ── 데이터를 둘 자리 ──────────────────────────────────────────
   설치 폴더(Program Files)는 쓰기가 막힐 수 있다.
   설정·DB·로그는 Windows 사용자 데이터 폴더에,
   완성 영상과 프로젝트는 사람이 찾기 쉬운 내 문서 아래에 둔다. */
const USER_HOME = app.getPath("userData");
const DOCS_ROOT = path.join(app.getPath("documents"), "오락푸드 AI릴스");
const OUTPUT_DIR = path.join(DOCS_ROOT, "완성영상");

for (const d of [USER_HOME, DOCS_ROOT, OUTPUT_DIR]) {
  try { fs.mkdirSync(d, { recursive: true }); } catch { /* 아래에서 오류로 알린다 */ }
}

/**
 * Next.js 서버가 있는 자리.
 * 설치본은 resources/app, 개발 중에는 next build 결과인 .next/standalone 이다.
 * (프로젝트 뿌리에는 server.js 가 없다 — 여기를 가리키면 영원히 기다리게 된다)
 */
function serverRoot() {
  if (!isDev) return path.join(process.resourcesPath, "app");
  return path.join(__dirname, "..", ".next", "standalone");
}

/** 함께 넣어 둔 FFmpeg (다운로드에 기대지 않는다) */
function bundledBin(name) {
  const exe = process.platform === "win32" ? `${name}.exe` : name;
  const p = path.join(process.resourcesPath, "bin", exe);
  return fs.existsSync(p) ? p : null;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function waitForServer(port, timeoutMs = 120000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const sock = net.connect(port, "127.0.0.1");
      sock.once("connect", () => { sock.destroy(); resolve(); });
      sock.once("error", () => {
        sock.destroy();
        if (Date.now() - started > timeoutMs) reject(new Error("서버가 시간 안에 준비되지 않았습니다"));
        else setTimeout(tryOnce, 300);
      });
    };
    tryOnce();
  });
}

let serverProcess = null;
let mainWindow = null;

async function startServer() {
  const port = await freePort();
  const root = serverRoot();
  const entry = path.join(root, "server.js");   // next build --output standalone 결과
  if (!fs.existsSync(entry)) {
    throw new Error(`프로그램 파일이 손상되었습니다. 다시 설치해 주세요.\n(찾는 위치: ${entry})`);
  }

  const ffmpeg = bundledBin("ffmpeg");
  const ffprobe = bundledBin("ffprobe");

  serverProcess = fork(entry, [], {
    cwd: root,
    // 검은 콘솔 창이 뜨지 않게 파이프로 받는다
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    env: {
      ...process.env,
      NODE_ENV: "production",
      // 설치본에서는 프로그램이 놓인 자리가 곧 기본 자원의 자리다
      ...(isDev ? {} : {}),
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      // 쓰기 폴더를 사용자 폴더로 옮긴다 (paths.ts 가 읽는다)
      ORAK_HOME: USER_HOME,
      ORAK_OUTPUT_DIR: OUTPUT_DIR,
      ...(ffmpeg ? { ORAK_FFMPEG_PATH: ffmpeg } : {}),
      ...(ffprobe ? { ORAK_FFPROBE_PATH: ffprobe } : {}),
    },
  });

  const logFile = path.join(USER_HOME, "logs", "app.log");
  try { fs.mkdirSync(path.dirname(logFile), { recursive: true }); } catch { /* 무시 */ }
  const append = (chunk) => {
    try { fs.appendFileSync(logFile, chunk); } catch { /* 로그 실패가 실행을 막지 않게 */ }
  };
  serverProcess.stdout?.on("data", append);
  serverProcess.stderr?.on("data", append);

  await waitForServer(port);
  return port;
}

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    title: APP_NAME,
    backgroundColor: "#F6F7F9",
    show: false,
    icon: path.join(__dirname, "icon.png"),
    webPreferences: {
      // 화면 쪽에서 Node 를 직접 만지지 못하게 한다
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, "preload.js"),
      devTools: isDev,
    },
  });

  // 배포판에는 개발자 메뉴를 두지 않는다
  Menu.setApplicationMenu(isDev ? Menu.getApplicationMenu() : null);

  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("closed", () => { mainWindow = null; });

  // 바깥 주소(도움말 링크 등)는 기본 브라우저로
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith(`http://127.0.0.1:${port}`)) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });

  mainWindow.loadURL(`http://127.0.0.1:${port}/`);
}

/* ── 두 번 눌러도 창은 하나 ───────────────────────────────── */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    try {
      const port = await startServer();
      createWindow(port);
    } catch (e) {
      dialog.showErrorBox(
        APP_NAME,
        `프로그램을 시작하지 못했습니다.\n\n${e && e.message ? e.message : e}\n\n` +
        `기록이 남는 곳:\n${path.join(USER_HOME, "logs", "app.log")}`,
      );
      app.quit();
    }
  });

  app.on("window-all-closed", () => app.quit());

  // 창을 닫으면 서버도 반드시 같이 내린다 (유령 프로세스 방지)
  app.on("before-quit", () => {
    if (serverProcess && !serverProcess.killed) {
      try { serverProcess.kill(); } catch { /* 이미 종료됨 */ }
    }
  });
}
