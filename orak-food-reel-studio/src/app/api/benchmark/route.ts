import { handle, ok, fail } from "@/lib/api";
import { analyzeBenchmark, listBenchmarks } from "@/lib/benchmark";
import { z } from "zod";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(() => ok({ benchmarks: listBenchmarks() }));
}

export async function POST(req: Request) {
  return handle(async () => {
    const body = z.object({ url: z.string().url() }).safeParse(await req.json());
    if (!body.success) return fail("올바른 URL을 입력하세요");
    return ok(await analyzeBenchmark(body.data.url));
  });
}
