// T-402: the export route end-to-end through the fixture pipeline.

import { beforeEach, describe, expect, it } from "vitest";
import { setupMockEnv, waitForSettled, FIX } from "./helpers";
import { POST as postBatches } from "@/app/api/batches/route";
import { GET as getExport } from "@/app/api/batches/[id]/export.csv/route";

function postReq(body: unknown): Request {
  return new Request("http://localhost/api/batches", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  setupMockEnv();
});

describe("GET /api/batches/:id/export.csv", () => {
  it("downloads a CSV with exact columns, failed rows populated, mixed batch (ST-03 export)", async () => {
    const created = await (
      await postBatches(postReq({ urls: [FIX.ok(1), FIX.private, FIX.silent] }))
    ).json();
    await waitForSettled(created.batchId);

    const res = await getExport(new Request("http://localhost"), params(created.batchId));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    expect(res.headers.get("Content-Disposition")).toContain('filename="transcripts.csv"');

    const lines = (await res.text()).trimEnd().split("\r\n");
    expect(lines[0]).toBe("url,platform,status,detected_language,transcript,error");
    expect(lines).toHaveLength(4);

    const failed = lines.find((l) => l.includes(FIX.private))!;
    expect(failed).toContain(",failed,");
    expect(failed).toContain("post is private or removed");

    const done = lines.find((l) => l.includes("fix-ok-001"))!;
    expect(done).toContain(",done,");
    expect(done.split(",")[1]).toBe("youtube");

    const silent = lines.find((l) => l.includes("fix-silent"))!;
    expect(silent).toContain(",no_speech,");
  });

  it("404s with the resubmit message for unknown batches", async () => {
    const res = await getExport(new Request("http://localhost"), params("nope"));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("This batch is no longer available — please resubmit");
  });
});
