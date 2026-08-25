import { describe, it, expect } from "vitest";
import { useTempDb } from "./helpers";
useTempDb("ig-login-mode");
import { igLoginKind, graphBase, igLoginMismatch, IG_LOGIN_INFO } from "../src/lib/providers/instagram";
import { describeKeyFailure } from "../src/lib/providers/api-failure";

const IGAA = "IGAAZ" + "x".repeat(160);
const EAA = "EAAB" + "y".repeat(160);

describe("§11 두 방식을 섞지 않는다", () => {
  it("토큰 앞글자로 주소가 갈린다", () => {
    expect(igLoginKind(IGAA)).toBe("instagram");
    expect(igLoginKind(EAA)).toBe("facebook");
    expect(graphBase(IGAA)).toContain("graph.instagram.com");
    expect(graphBase(EAA)).toContain("graph.facebook.com");
  });

  it("방식마다 권한 이름이 다르고 섞이지 않는다", () => {
    expect(IG_LOGIN_INFO.instagram.scopes).toEqual(["instagram_business_basic", "instagram_business_content_publish"]);
    expect(IG_LOGIN_INFO.facebook.scopes).toContain("instagram_content_publish");
    // 예전 권한과 새 권한이 한 방식 안에 같이 있으면 안 된다
    expect(IG_LOGIN_INFO.instagram.scopes).not.toContain("instagram_content_publish");
    expect(IG_LOGIN_INFO.facebook.scopes).not.toContain("instagram_business_content_publish");
  });

  it("고른 방식과 토큰이 어긋나면 부르기 전에 알려 준다", () => {
    expect(igLoginMismatch("instagram", EAA)).toMatch(/Instagram Login/);
    expect(igLoginMismatch("facebook", IGAA)).toMatch(/Facebook Login/);
    // 맞으면 조용하다
    expect(igLoginMismatch("instagram", IGAA)).toBeNull();
    expect(igLoginMismatch("facebook", EAA)).toBeNull();
    // 자동이면 참견하지 않는다
    expect(igLoginMismatch("auto", EAA)).toBeNull();
    // 토큰이 아직 없으면 트집 잡지 않는다
    expect(igLoginMismatch("instagram", "")).toBeNull();
  });
});

describe("§11 400 만 띄우지 않고 원인을 나눠 말한다", () => {
  const meta = (body: object, status = 400) =>
    describeKeyFailure("instagram", status, JSON.stringify(body), { igLogin: "instagram" });

  it("토큰 만료", () => {
    expect(meta({ error: { code: 190, error_subcode: 463, message: "Session has expired" } })).toMatch(/만료/);
  });
  it("토큰 형식 오류", () => {
    expect(meta({ error: { code: 190, message: "Cannot parse access token" } })).toMatch(/알아보지 못했습니다/);
  });
  it("테스터·역할 승인 문제", () => {
    expect(meta({ error: { code: 200, message: "User has not been added as a tester" } })).toMatch(/테스터/);
  });
  it("영상 또는 공개 주소 문제", () => {
    expect(meta({ error: { message: "The video format is not supported" } })).toMatch(/영상을 가져오지 못했거나 형식/);
    expect(meta({ error: { message: "Failed to download media from url" } })).toMatch(/공개 영상 주소/);
  });
  it("요청 한도", () => {
    expect(meta({ error: { code: 4, message: "rate limit" } }, 429)).toMatch(/한도/);
  });
  it("방식마다 알려 주는 권한 이름이 다르다", () => {
    const insta = describeKeyFailure("instagram", 400,
      JSON.stringify({ error: { code: 10, message: "requires permissions" } }), { igLogin: "instagram" });
    const fb = describeKeyFailure("instagram", 400,
      JSON.stringify({ error: { code: 10, message: "requires permissions" } }), { igLogin: "facebook" });
    expect(insta).toContain("instagram_business_content_publish");
    expect(fb).toContain("instagram_content_publish");
    expect(insta).not.toContain("pages_show_list");
  });
  it("어떤 경우에도 토큰을 그대로 되뱉지 않는다", () => {
    const out = meta({ error: { message: `bad token ${IGAA}` } });
    expect(out).not.toContain(IGAA);
  });
});
