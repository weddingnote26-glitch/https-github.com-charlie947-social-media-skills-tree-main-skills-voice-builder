/**
 * 붙여넣은 키 값 정리.
 *
 * 사람들은 .env 한 줄을 통째로 복사한다. `ELEVENLABS_API_KEY=abc123` 처럼.
 * 그대로 저장하면 이름까지 키로 전송돼 401이 나는데, 화면에는
 * "키가 올바르지 않습니다"만 뜨니 멀쩡한 키를 계속 다시 발급받게 된다.
 * 저장 직전에 사람이 의도한 값만 남긴다.
 */
export function cleanPastedSecret(raw: string | undefined | null): string {
  let v = (raw ?? "").trim();
  if (!v) return "";

  // export FOO=... / FOO="..." 같은 .env 한 줄
  v = v.replace(/^export\s+/i, "");
  const named = v.match(/^[A-Za-z_][A-Za-z0-9_]*\s*[=:]\s*([\s\S]*)$/);
  if (named) v = named[1].trim();

  // 끝에 붙어 오는 기호를 먼저 떼야 따옴표가 짝으로 인식된다 ("abc", → "abc")
  v = v.replace(/[,;]+$/, "").trim();

  // 양 끝 따옴표
  v = v.replace(/^"([\s\S]*)"$/, "$1").replace(/^'([\s\S]*)'$/, "$1").trim();
  v = v.replace(/[,;]+$/, "").trim();

  // 키에는 공백·줄바꿈이 없다 (메일이나 문서에서 복사하면 줄바꿈이 섞인다)
  v = v.replace(/\s+/g, "");
  return v;
}
