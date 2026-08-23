import { handle, ok } from "@/lib/api";
import { listReels } from "@/lib/reels";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handle(() => {
    const url = new URL(req.url);
    const status = url.searchParams.get("status") ?? undefined;
    const date = url.searchParams.get("date") ?? undefined;
    return ok({ reels: listReels({ status, date }) });
  });
}
