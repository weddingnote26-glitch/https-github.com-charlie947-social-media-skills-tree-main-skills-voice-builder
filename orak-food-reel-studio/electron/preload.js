"use strict";
/**
 * 화면 쪽에 열어 주는 창구.
 *
 * 지금 웹 앱은 브라우저 기능만으로 동작하므로 열어 줄 것이 거의 없다.
 * 필요 없는 것을 미리 열어 두지 않는다 — 열어 준 만큼이 공격 면이 된다.
 */
const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("orak", {
  isDesktopApp: true,
  version: process.env.npm_package_version ?? "",
});
