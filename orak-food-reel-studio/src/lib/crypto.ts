import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DIRS } from "./paths";

/**
 * Access Token 등 민감값 암호화 저장용.
 * 키는 /data/.secret 에 자동 생성(외부 유출 금지, .gitignore 처리됨).
 */
function getKey(): Buffer {
  fs.mkdirSync(DIRS.data, { recursive: true });
  const p = path.join(DIRS.data, ".secret");
  if (!fs.existsSync(p)) {
    fs.writeFileSync(p, crypto.randomBytes(32).toString("hex"), { mode: 0o600 });
  }
  return Buffer.from(fs.readFileSync(p, "utf8").trim(), "hex");
}

export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), enc.toString("base64")].join(".");
}

export function decrypt(stored: string): string {
  const [v, ivB, tagB, dataB] = stored.split(".");
  if (v !== "v1") throw new Error("알 수 없는 암호화 형식");
  const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), Buffer.from(ivB, "base64"));
  decipher.setAuthTag(Buffer.from(tagB, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB, "base64")), decipher.final()]).toString("utf8");
}
