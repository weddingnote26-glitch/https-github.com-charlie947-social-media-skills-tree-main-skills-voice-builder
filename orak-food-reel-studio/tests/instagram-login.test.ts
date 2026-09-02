import { describe, it, expect } from "vitest";
import { useTempDb } from "./helpers";
useTempDb("instagram-login");
import { igLoginKind, graphBase } from "../src/lib/providers/instagram";
import { describeKeyFailure } from "../src/lib/providers/api-failure";

/**
 * 실제로 겪은 일: IGAA… 토큰을 graph.facebook.com 으로 보내
 * "Cannot parse access token" 만 돌아왔다. 토큰은 멀쩡했다.
 */
describe("토큰 생김새로 물어볼 서버를 고른다", () => {
  it("IGAA… 는 Instagram 로그인 → graph.instagram.com", () => {
    const t = "IGAAZA" + "x".repeat(179);
    expect(igLoginKind(t)).toBe("instagram");
    expect(graphBase(t)).toBe("https://graph.instagram.com/v21.0");
  });

  it("EAA… 는 페이스북 로그인 → graph.facebook.com", () => {
    const t = "EAAG" + "x".repeat(100);
    expect(igLoginKind(t)).toBe("facebook");
    expect(graphBase(t)).toBe("https://graph.facebook.com/v21.0");
  });

  it("앞뒤 공백이 섞여도 알아본다 (붙여넣기 흔한 실수)", () => {
    expect(igLoginKind("  IGAAZAsomething  ")).toBe("instagram");
  });

  it("빈 값·모르는 모양은 페이스북 쪽으로 (지금까지 동작 유지)", () => {
    expect(igLoginKind("")).toBe("facebook");
    expect(graphBase("")).toBe("https://graph.facebook.com/v21.0");
  });
});

describe("로그인 방식마다 권한 이름이 다르다", () => {
  const perm = JSON.stringify({ error: { message: "(#200) Requires permission", code: 200 } });

  it("Instagram 로그인은 instagram_business_* 를 알려준다", () => {
    const m = describeKeyFailure("instagram", 403, perm, { igLogin: "instagram" });
    expect(m).toContain("instagram_business_content_publish");
    // 페이스북 로그인에만 있는 권한을 찾게 하면 안 된다
    expect(m).not.toContain("pages_show_list");
  });

  it("페이스북 로그인은 pages_* 까지 알려준다", () => {
    const m = describeKeyFailure("instagram", 403, perm, { igLogin: "facebook" });
    expect(m).toContain("pages_show_list");
    expect(m).not.toContain("instagram_business_content_publish");
  });

  it("주소를 잘못 골랐을 때의 응답은 토큰을 다시 만들라고 하지 않는다", () => {
    const raw = JSON.stringify({ error: { message: "Invalid OAuth access token - Cannot parse access token", code: 190 } });
    const m = describeKeyFailure("instagram", 400, raw, { igLogin: "instagram" });
    expect(m).toContain("IGAA");
    expect(m).toContain("EAA");
    expect(m).not.toContain("다시 만들어");
  });
});
