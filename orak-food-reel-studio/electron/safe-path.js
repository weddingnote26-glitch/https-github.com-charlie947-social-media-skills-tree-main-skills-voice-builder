"use strict";
/**
 * 화면 쪽이 보내온 이름을 폴더 안쪽 경로로 안전하게 바꾼다.
 *
 * 화면(웹)은 믿을 수 없는 자리다. ".." 이나 절대경로를 섞어 보내면
 * 완성영상 폴더 밖(예: C:\Windows)을 열게 만들 수 있다.
 * 파일 이름만 남기고, 결과가 정말 폴더 안쪽인지 다시 확인한다.
 */
const path = require("node:path");

/**
 * @returns {{ok:true, target:string} | {ok:false, reason:string}}
 */
function resolveInside(root, name) {
  const base = path.resolve(root);
  const raw = String(name ?? "").trim();
  if (!raw) return { ok: true, target: base };

  // 경로 조각을 통째로 버리고 마지막 이름만 쓴다 ("..", "C:\\x", "a/../b" 방어)
  const leaf = path.basename(raw.replace(/[\\/]+$/, ""));
  if (!leaf || leaf === "." || leaf === "..") return { ok: true, target: base };

  const target = path.resolve(base, leaf);
  if (target !== base && !target.startsWith(base + path.sep)) {
    return { ok: false, reason: "완성영상 폴더 밖은 열 수 없습니다" };
  }
  return { ok: true, target };
}

module.exports = { resolveInside };
