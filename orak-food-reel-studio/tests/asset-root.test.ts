import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { useTempDb } from "./helpers";
useTempDb("asset-root");

import { orakiAssets, characterReferences, masterMissingReason } from "../src/lib/character/asset-root";
import { saveSettings } from "../src/lib/settings";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

function makeAssetDir(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oraki-assets-"));
  fs.mkdirSync(path.join(root, "master"), { recursive: true });
  fs.mkdirSync(path.join(root, "turnaround"), { recursive: true });
  fs.mkdirSync(path.join(root, "actions"), { recursive: true });
  fs.writeFileSync(path.join(root, "master", "oraki_master.png"), PNG);
  fs.writeFileSync(path.join(root, "turnaround", "oraki_front.png"), PNG);
  fs.writeFileSync(path.join(root, "turnaround", "oraki_side.png"), PNG);
  fs.writeFileSync(path.join(root, "actions", "oraki_eat.png"), PNG);
  return root;
}

beforeEach(() => {
  saveSettings({ characterLock: { enabled: true, seed: 1, referenceImages: [], assetRoot: "" } });
});

describe("오락이 에셋 폴더", () => {
  it("설정 폴더가 있으면 master/turnaround/actions 를 읽는다", () => {
    const root = makeAssetDir();
    saveSettings({ characterLock: { enabled: true, seed: 1, referenceImages: [], assetRoot: root } });
    const a = orakiAssets();
    expect(a.source).toBe("설정 폴더");
    expect(a.master).toBe(path.join(root, "master", "oraki_master.png"));
    expect(a.front).toBe(path.join(root, "turnaround", "oraki_front.png"));
    expect(a.turnaround.length).toBe(2);
    expect(a.actions.length).toBe(1);
  });

  it("마스터를 맨 앞에 두고 최대 3장을 참조로 넘긴다", () => {
    const root = makeAssetDir();
    saveSettings({ characterLock: { enabled: true, seed: 1, referenceImages: [], assetRoot: root } });
    const refs = characterReferences();
    expect(refs[0]).toContain("oraki_master.png");
    expect(refs.length).toBeLessThanOrEqual(3);
  });

  it("폴더가 없는 PC 에서는 기본 제공 에셋으로 내려간다 (제작이 멈추지 않는다)", () => {
    saveSettings({ characterLock: { enabled: true, seed: 1, referenceImages: [], assetRoot: "C:\\\\없는폴더\\\\oraki" } });
    const a = orakiAssets();
    expect(a.source).toBe("기본 제공");
    expect(a.master).toBeTruthy(); // 프로그램에 담긴 character_sheet.png
  });

  it("에셋을 바꾸면 판(version)이 달라진다 — 캐시가 옛 그림을 재사용하지 않게", () => {
    const root = makeAssetDir();
    saveSettings({ characterLock: { enabled: true, seed: 1, referenceImages: [], assetRoot: root } });
    const v1 = orakiAssets().version;
    // 마스터를 다른 내용으로 교체 (크기가 달라진다)
    fs.writeFileSync(path.join(root, "master", "oraki_master.png"), Buffer.concat([PNG, PNG]));
    const v2 = orakiAssets().version;
    expect(v1).not.toBe(v2);
  });

  it("마스터가 없으면 어디를 찾아봤는지까지 알려준다", () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "oraki-empty-"));
    fs.mkdirSync(path.join(empty, "master"));
    fs.writeFileSync(path.join(empty, "note.txt"), "이미지 아님");
    fs.writeFileSync(path.join(empty, "turnaround.png"), PNG); // 루트에 이미지가 있어야 usable
    fs.rmSync(path.join(empty, "turnaround.png"));
    // usable 하지 않은 폴더 → 기본 제공으로 내려가므로, 이 시험은 함수 단위로 확인
    const a = { root: empty, source: "설정 폴더" as const, master: null, front: null, turnaround: [], actions: [], version: "x" };
    const reason = masterMissingReason(a);
    expect(reason).toContain("oraki_master.png");
    expect(reason).toContain("찾아본 곳");
    expect(reason).toContain("만들지 않습니다");
  });

  it("원본 파일을 어떤 식으로도 고치지 않는다 (읽기 전용)", () => {
    const root = makeAssetDir();
    saveSettings({ characterLock: { enabled: true, seed: 1, referenceImages: [], assetRoot: root } });
    const master = path.join(root, "master", "oraki_master.png");
    const before = fs.statSync(master);
    orakiAssets(); characterReferences(); orakiAssets();
    const after = fs.statSync(master);
    expect(after.size).toBe(before.size);
    expect(after.mtimeMs).toBe(before.mtimeMs);
  });
});
