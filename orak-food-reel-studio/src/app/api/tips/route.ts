import { handle, ok, fail } from "@/lib/api";
import { db } from "@/lib/db";
import { newId } from "@/lib/id";
import { z } from "zod";

export const dynamic = "force-dynamic";

/** §30(캐릭터 문서) 맛집 제보 시스템 */
export async function GET() {
  return handle(() => ok({ tips: db().prepare("SELECT * FROM tips ORDER BY created_at DESC LIMIT 100").all() }));
}

export async function POST(req: Request) {
  return handle(async () => {
    const body = z.object({
      restaurant_name: z.string().min(1),
      location: z.string().default(""),
      reason: z.string().default(""),
      submitted_by: z.string().default(""),
    }).parse(await req.json());
    const id = newId("tip");
    db().prepare("INSERT INTO tips (id, restaurant_name, location, reason, submitted_by) VALUES (?,?,?,?,?)")
      .run(id, body.restaurant_name, body.location, body.reason, body.submitted_by);
    return ok({ id });
  });
}

export async function PATCH(req: Request) {
  return handle(async () => {
    const body = z.object({
      id: z.string(),
      status: z.enum(["제보", "조사예정", "제작중", "완료"]),
      case_number: z.number().int().optional(),
    }).safeParse(await req.json());
    if (!body.success) return fail("id와 status가 필요합니다");
    db().prepare("UPDATE tips SET status=?, case_number=COALESCE(?, case_number) WHERE id=?")
      .run(body.data.status, body.data.case_number ?? null, body.data.id);
    return ok({ updated: true });
  });
}
