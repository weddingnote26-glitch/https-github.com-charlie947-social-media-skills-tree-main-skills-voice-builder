import { describe, it, expect } from "vitest";
import { describeAppAddress, DEFAULT_PORT } from "../src/lib/app-address";

describe("describeAppAddress — 지금 이 프로그램 주소", () => {
  it("기본 포트로 열려 있으면 터널 명령을 그대로 보여 준다", () => {
    const a = describeAppAddress("http://localhost:3000/settings")!;
    expect(a.current).toBe("http://localhost:3000");
    expect(a.port).toBe("3000");
    expect(a.isLocal).toBe(true);
    expect(a.tunnelCommand).toBe("cloudflared tunnel --url http://localhost:3000");
    expect(a.portNotice).toBeNull();
  });

  it("127.0.0.1 도 내 PC 주소로 본다 (설치형 앱이 쓰는 주소)", () => {
    const a = describeAppAddress("http://127.0.0.1:3000/")!;
    expect(a.isLocal).toBe(true);
    expect(a.tunnelCommand).toContain("3000");
  });

  it("기본 포트가 아니면 명령도 그 포트로 바꿔 주고 이유를 알려 준다", () => {
    const a = describeAppAddress("http://localhost:3457/")!;
    expect(a.tunnelCommand).toBe("cloudflared tunnel --url http://localhost:3457");
    expect(a.portNotice).toContain("3457");
    expect(a.portNotice).toContain(DEFAULT_PORT);
  });

  it("터널 주소로 열어 보고 있으면 터널 명령을 보여 주지 않는다", () => {
    const a = describeAppAddress("https://abc-def-ghi.trycloudflare.com/settings")!;
    expect(a.current).toBe("https://abc-def-ghi.trycloudflare.com");
    expect(a.isLocal).toBe(false);
    expect(a.tunnelCommand).toBeNull();
    expect(a.portNotice).toBeNull();
  });

  it("주소에 포트가 없으면 규칙상 기본 포트로 읽는다", () => {
    expect(describeAppAddress("https://reels.내주소.com/")!.port).toBe("443");
    expect(describeAppAddress("http://reels.내주소.com/")!.port).toBe("80");
  });

  it("주소를 못 읽으면 null — 틀린 안내를 하지 않는다", () => {
    for (const bad of ["", "그냥글자", "file:///C:/orak", "ftp://localhost:3000"]) {
      expect(describeAppAddress(bad)).toBeNull();
    }
  });
});
