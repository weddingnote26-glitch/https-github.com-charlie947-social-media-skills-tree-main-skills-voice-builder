import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { DIRS } from "../src/lib/paths";
import {
  resolveRef, isValidFolderName, listFolders, listImages,
  createFolder, renameFolder, deleteFolder, deleteImages, moveImages,
} from "../src/lib/character/library";

// 실제 assets/character 를 쓰므로, 테스트가 만든 것만 정확히 지운다
const MADE_FOLDERS = ["테스트폴더", "테스트폴더2", "이동대상"];
const MADE_FILES: string[] = [];

function makeImage(rel: string) {
  const abs = path.join(DIRS.character, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, Buffer.from("89504e470d0a1a0a", "hex")); // 최소한의 PNG 머리
  MADE_FILES.push(abs);
  return rel;
}

function cleanup() {
  for (const f of MADE_FILES) fs.rmSync(f, { force: true });
  MADE_FILES.length = 0;
  for (const d of MADE_FOLDERS) fs.rmSync(path.join(DIRS.character, d), { recursive: true, force: true });
}

beforeEach(cleanup);
afterEach(cleanup);

describe("resolveRef — assets/character 밖으로 나갈 수 없다", () => {
  it("경로 탈출 시도를 모두 막는다", () => {
    expect(resolveRef("../../.env")).toBeNull();
    expect(resolveRef("../secrets.png")).toBeNull();
    expect(resolveRef("a/../../b.png")).toBeNull();
    expect(resolveRef("/etc/passwd")).toBeNull();
    expect(resolveRef("C:\\Windows\\a.png")).toBeNull();
    expect(resolveRef("a/b/c.png")).toBeNull();   // 두 단계 넘는 폴더
    expect(resolveRef("")).toBeNull();
  });

  it("이미지가 아닌 파일은 거부한다", () => {
    expect(resolveRef("orak-studio.db")).toBeNull();
    expect(resolveRef("폴더/notes.txt")).toBeNull();
  });

  it("정상적인 상대 경로는 절대 경로로 바꾼다", () => {
    expect(resolveRef("front.png")).toBe(path.resolve(DIRS.character, "front.png"));
    expect(resolveRef("주인공/hero.PNG")).toBe(path.resolve(DIRS.character, "주인공", "hero.PNG"));
    // 예전 설정처럼 파일명만 있어도 그대로 동작해야 한다
    expect(resolveRef("character_sheet.png")).not.toBeNull();
  });
});

describe("isValidFolderName", () => {
  it("쓸 수 없는 이름을 막는다", () => {
    for (const bad of ["", "  ", ".", "..", "a/b", "a\\b", "a:b", "a*b", "a?b", ".숨김", "svg", "SVG"]) {
      expect(isValidFolderName(bad)).toBe(false);
    }
  });
  it("평범한 한글·영문 이름은 허용", () => {
    expect(isValidFolderName("주인공")).toBe(true);
    expect(isValidFolderName("food shots")).toBe(true);
  });
});

describe("폴더 만들기 · 이름 바꾸기 · 삭제", () => {
  it("폴더를 만들고 목록에 나타난다", () => {
    createFolder("테스트폴더");
    expect(listFolders().map((f) => f.name)).toContain("테스트폴더");
  });

  it("같은 이름으로 두 번 만들 수 없다", () => {
    createFolder("테스트폴더");
    expect(() => createFolder("테스트폴더")).toThrow(/이미 있습니다/);
  });

  it("이름을 바꾸면 안의 이미지가 따라온다", () => {
    createFolder("테스트폴더");
    makeImage("테스트폴더/a.png");
    const r = renameFolder("테스트폴더", "테스트폴더2");
    expect(r.moved).toEqual(["테스트폴더2/a.png"]);
    expect(fs.existsSync(path.join(DIRS.character, "테스트폴더2", "a.png"))).toBe(true);
    MADE_FILES.push(path.join(DIRS.character, "테스트폴더2", "a.png"));
  });

  it("폴더만 삭제하면 이미지는 기본 폴더로 옮겨진다", () => {
    createFolder("테스트폴더");
    makeImage("테스트폴더/keep-me.png");
    const r = deleteFolder("테스트폴더", "move");
    expect(r.movedTo).toEqual(["keep-me.png"]);
    const moved = path.join(DIRS.character, "keep-me.png");
    expect(fs.existsSync(moved)).toBe(true);
    MADE_FILES.push(moved);
    expect(fs.existsSync(path.join(DIRS.character, "테스트폴더"))).toBe(false);
  });

  it("이미지까지 삭제하면 파일이 사라진다", () => {
    createFolder("테스트폴더");
    makeImage("테스트폴더/gone.png");
    const r = deleteFolder("테스트폴더", "delete");
    expect(r.deleted).toEqual(["테스트폴더/gone.png"]);
    expect(fs.existsSync(path.join(DIRS.character, "테스트폴더"))).toBe(false);
  });

  it("기본 폴더는 이름을 바꾸거나 지울 수 없다", () => {
    expect(() => renameFolder("", "무엇")).toThrow();
    expect(() => deleteFolder("", "move")).toThrow();
  });
});

describe("이미지 삭제 · 이동", () => {
  it("여러 개를 한 번에 지운다", () => {
    makeImage("test-del-1.png");
    makeImage("test-del-2.png");
    const r = deleteImages(["test-del-1.png", "test-del-2.png"]);
    expect(r.deleted).toHaveLength(2);
    expect(fs.existsSync(path.join(DIRS.character, "test-del-1.png"))).toBe(false);
  });

  it("이미 지워진 파일을 다시 지워도 오류가 나지 않는다", () => {
    // 새로고침 후 같은 버튼을 두 번 눌러도 막히면 안 된다
    const r = deleteImages(["없는파일.png"]);
    expect(r.deleted).toHaveLength(0);
    expect(r.missing).toEqual(["없는파일.png"]);
  });

  it("경로 탈출 값은 조용히 무시한다", () => {
    const r = deleteImages(["../../.env", "../package.json"]);
    expect(r.deleted).toHaveLength(0);
    expect(fs.existsSync(path.join(process.cwd(), "package.json"))).toBe(true);
  });

  it("이미지를 폴더로 옮긴다", () => {
    createFolder("이동대상");
    makeImage("test-move.png");
    const r = moveImages(["test-move.png"], "이동대상");
    expect(r.moved).toEqual([{ from: "test-move.png", to: "이동대상/test-move.png" }]);
    MADE_FILES.push(path.join(DIRS.character, "이동대상", "test-move.png"));
    expect(listImages().some((i) => i.rel === "이동대상/test-move.png")).toBe(true);
  });

  it("이름이 겹치면 번호를 붙여 덮어쓰지 않는다", () => {
    createFolder("이동대상");
    makeImage("이동대상/dup.png");
    makeImage("dup.png");
    const r = moveImages(["dup.png"], "이동대상");
    expect(r.moved[0].to).toBe("이동대상/dup-2.png");
    MADE_FILES.push(path.join(DIRS.character, "이동대상", "dup-2.png"));
    // 원래 있던 파일은 그대로
    expect(fs.existsSync(path.join(DIRS.character, "이동대상", "dup.png"))).toBe(true);
  });

  it("없는 폴더로는 옮길 수 없다", () => {
    makeImage("test-move2.png");
    expect(() => moveImages(["test-move2.png"], "없는폴더")).toThrow(/없습니다/);
  });
});

describe("기본 제공 7종 표시", () => {
  it("기본 파일은 builtin 으로 구분된다", () => {
    const imgs = listImages();
    const sheet = imgs.find((i) => i.rel === "character_sheet.png");
    if (sheet) expect(sheet.builtin).toBe(true);
    const mine = makeImage("test-mine.png");
    expect(listImages().find((i) => i.rel === mine)?.builtin).toBe(false);
  });
});
