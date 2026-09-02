"use strict";
/**
 * 화면 쪽에 열어 주는 창구.
 *
 * 지금 웹 앱은 브라우저 기능만으로 동작하므로 열어 줄 것이 거의 없다.
 * 필요 없는 것을 미리 열어 두지 않는다 — 열어 준 만큼이 공격 면이 된다.
 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("orak", {
  isDesktopApp: true,
  version: process.env.npm_package_version ?? "",
  /**
   * 완성 영상 폴더를 탐색기로 연다 (휴대폰으로 옮겨 직접 올릴 때 쓴다).
   *
   * 아무 경로나 열어 주지 않는다 — 어느 폴더를 열지는 본체가 정한다.
   * 화면 쪽은 "완성영상 폴더 안의 어느 이름" 까지만 말할 수 있다.
   */
  openOutputFolder: (folderName) => ipcRenderer.invoke("orak:open-output", String(folderName ?? "")),
  /**
   * AI 음성을 입힐 영상 파일 고르기 창을 띄운다 (외부 영상 AI 음성 최종 제작).
   *
   * 돌려주는 것은 사용자가 창에서 직접 고른 파일의 경로 하나뿐이다.
   * 화면 쪽에 파일 읽기·쓰기 권한을 주는 것이 아니다.
   */
  pickVideoFile: () => ipcRenderer.invoke("orak:pick-video"),
});
