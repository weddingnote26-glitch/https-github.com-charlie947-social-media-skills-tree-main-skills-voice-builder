import { describe, it, expect, afterAll } from "vitest";
import { useTempDb } from "./helpers";
useTempDb("url-analyze");
import http from "node:http";
import { guardUrl, fetchLimited, extractStructured, visibleText } from "../src/lib/url-analyze";

/** §16 SSRF — 서버가 대신 접속하므로 내부 주소를 막아야 한다 */
describe("내부망 주소는 분석하지 않는다", () => {
  it.each([
    "http://localhost/x", "http://127.0.0.1/x", "http://10.0.0.5/x",
    "http://192.168.0.10/x", "http://172.16.3.4/x", "http://169.254.169.254/latest",
    "http://printer.local/", "http://db.internal/",
  ])("%s 차단", (u) => {
    delete process.env.ORAK_ALLOW_PRIVATE_URL;
    expect(() => guardUrl(u)).toThrow(/내부망/);
  });

  it("file:// 등 이상한 규약도 거절한다", () => {
    expect(() => guardUrl("file:///etc/passwd")).toThrow(/https/);
    expect(() => guardUrl("ftp://x.com/a")).toThrow(/https/);
    expect(() => guardUrl("이건 주소가 아님")).toThrow(/주소 모양/);
  });

  it("보통의 공개 주소는 통과한다", () => {
    expect(guardUrl("https://example.com/menu").hostname).toBe("example.com");
  });
});

describe("페이지가 선언한 값만 꺼낸다 (JSON-LD · OG)", () => {
  const HTML = `<!doctype html><html><head>
    <title>신림 만두명가 | 신림동 맛집</title>
    <meta property="og:site_name" content="신림 만두명가">
    <script type="application/ld+json">
    {"@context":"https://schema.org","@type":"Restaurant",
     "name":"신림 만두명가","telephone":"02-123-4567",
     "address":{"@type":"PostalAddress","addressRegion":"서울","addressLocality":"관악구","streetAddress":"신림로 123"},
     "openingHours":["Mo-Sa 10:00-21:00"]}
    </script></head>
    <body><h1>어서오세요</h1><p>왕만두 6,000원</p></body></html>`;

  it("이름·전화·주소·영업시간을 출처와 함께 뽑는다", () => {
    const f = extractStructured(HTML);
    expect(f.name?.value).toBe("신림 만두명가");
    expect(f.name?.source).toContain("JSON-LD");
    expect(f.phone?.value).toBe("02-123-4567");
    expect(f.address?.value).toBe("서울 관악구 신림로 123");
    expect(f.hours?.value).toContain("10:00-21:00");
  });

  it("구조화 데이터가 없으면 OG·제목까지만 — 나머지는 비워 둔다 (추측 금지)", () => {
    const f = extractStructured("<title>가나다 식당 - 홈</title><p>블로그 글</p>");
    expect(f.name?.value).toBe("가나다 식당");
    expect(f.address).toBeUndefined();
    expect(f.phone).toBeUndefined();
    expect(f.hours).toBeUndefined();
  });

  it("깨진 JSON-LD 는 조용히 건너뛴다", () => {
    const f = extractStructured('<script type="application/ld+json">{깨짐</script><title>티</title>');
    expect(f.name?.value).toBe("티");
  });

  it("본문 글만 남긴다 (script·style 제거)", () => {
    const t = visibleText("<style>.a{}</style><script>bad()</script><p>왕만두  6,000원</p>");
    expect(t).toBe("왕만두 6,000원");
    expect(t).not.toContain("bad");
  });
});

describe("진짜 HTTP 로 읽기 (시험용 로컬 서버)", () => {
  const servers: http.Server[] = [];
  afterAll(() => { for (const s of servers) s.close(); delete process.env.ORAK_ALLOW_PRIVATE_URL; });

  function serve(handler: http.RequestListener): Promise<number> {
    return new Promise((res) => {
      const s = http.createServer(handler);
      servers.push(s);
      s.listen(0, "127.0.0.1", () => res((s.address() as { port: number }).port));
    });
  }

  it("페이지를 읽고 구조화 데이터를 꺼낸다", async () => {
    process.env.ORAK_ALLOW_PRIVATE_URL = "1";   // 시험에서만 루프백 허용
    const port = await serve((_req, res) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end('<script type="application/ld+json">{"@type":"Restaurant","name":"로컬 시험집","telephone":"02-000-1111"}</script>');
    });
    const { html } = await fetchLimited(`http://127.0.0.1:${port}/`);
    const f = extractStructured(html);
    expect(f.name?.value).toBe("로컬 시험집");
    expect(f.phone?.value).toBe("02-000-1111");
  });

  it("무한 이동은 끊는다", async () => {
    process.env.ORAK_ALLOW_PRIVATE_URL = "1";
    const port = await serve((req, res) => {
      res.writeHead(302, { location: `http://127.0.0.1:${port}${req.url}` });
      res.end();
    });
    await expect(fetchLimited(`http://127.0.0.1:${port}/loop`)).rejects.toThrow(/이동이 너무 많습니다/);
  });

  it("로그인 페이지는 우회하지 않는다", async () => {
    process.env.ORAK_ALLOW_PRIVATE_URL = "1";
    const port = await serve((_req, res) => { res.writeHead(403); res.end("forbidden"); });
    await expect(fetchLimited(`http://127.0.0.1:${port}/`)).rejects.toThrow(/우회하지 않습니다/);
  });

  it("큰 페이지는 상한까지만 읽는다", async () => {
    process.env.ORAK_ALLOW_PRIVATE_URL = "1";
    const big = "가".repeat(2 * 1024 * 1024);
    const port = await serve((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(`<title>큰집</title>${big}`);
    });
    const { html, truncated } = await fetchLimited(`http://127.0.0.1:${port}/`);
    expect(truncated).toBe(true);
    expect(html.length).toBeLessThan(800 * 1024);
    expect(extractStructured(html).name?.value).toBe("큰집");
  });

  it("HTML 이 아니면 거절한다", async () => {
    process.env.ORAK_ALLOW_PRIVATE_URL = "1";
    const port = await serve((_req, res) => {
      res.writeHead(200, { "content-type": "application/zip" });
      res.end("PK");
    });
    await expect(fetchLimited(`http://127.0.0.1:${port}/`)).rejects.toThrow(/글 페이지가 아닙니다/);
  });
});
