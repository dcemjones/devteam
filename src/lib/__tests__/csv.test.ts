// T-402: CSV escaping + formula-injection guard (pure logic), per delivery-plan DoD #2.

import { describe, expect, it } from "vitest";
import { csvCell, batchToCsv, CSV_HEADER } from "../csv";
import type { Batch, Item } from "../types";

function item(over: Partial<Item>): Item {
  return {
    id: "i1",
    url: "https://www.youtube.com/watch?v=abc12345",
    normalizedUrl: "https://www.youtube.com/watch?v=abc12345",
    platform: "youtube",
    status: "done",
    timings: {},
    ...over,
  };
}

function batch(items: Item[]): Batch {
  return {
    id: "b1",
    createdAt: "2026-06-11T00:00:00.000Z",
    items,
    rejected: [],
    duplicatesRemoved: 0,
    expiresAt: "2026-06-12T00:00:00.000Z",
  };
}

describe("csvCell", () => {
  it("passes plain text through", () => {
    expect(csvCell("hello world")).toBe("hello world");
    expect(csvCell(undefined)).toBe("");
  });
  it("quotes commas, quotes and newlines (RFC 4180)", () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
  });
  it("neutralises spreadsheet formula prefixes (= + - @ TAB)", () => {
    expect(csvCell("=SUM(A1:A9)")).toBe("'=SUM(A1:A9)");
    expect(csvCell("+1234")).toBe("'+1234");
    expect(csvCell("-cmd")).toBe("'-cmd");
    expect(csvCell("@import")).toBe("'@import");
    expect(csvCell("\tx")).toBe("'\tx");
  });
  it("guards then quotes when both apply", () => {
    expect(csvCell("=HYPERLINK(\"http://evil\",\"x\")")).toBe("\"'=HYPERLINK(\"\"http://evil\"\",\"\"x\"\")\"");
  });
});

describe("batchToCsv", () => {
  it("emits the exact PRD columns and one row per item", () => {
    const csv = batchToCsv(
      batch([
        item({ transcript: "Hello there", detectedLanguage: "Spanish" }),
        item({
          id: "i2",
          url: "https://www.tiktok.com/@x/video/123456789",
          platform: "tiktok",
          status: "failed",
          error: { step: "FETCH", code: "private_or_removed", message: "post is private or removed", retryable: true },
        }),
        item({ id: "i3", status: "no_speech" }),
      ]),
    );
    const lines = csv.trimEnd().split("\r\n");
    expect(lines[0]).toBe(CSV_HEADER);
    expect(lines).toHaveLength(4);
    expect(lines[1]).toBe("https://www.youtube.com/watch?v=abc12345,youtube,done,Spanish,Hello there,");
    // failed row: status failed + populated error column (ST-03)
    expect(lines[2]).toContain(",failed,,,");
    expect(lines[2]).toContain("private_or_removed: post is private or removed");
    // no-speech row: completed status, empty transcript
    expect(lines[3]).toBe("https://www.youtube.com/watch?v=abc12345,youtube,no_speech,,,");
  });

  it("a transcript that starts with '=' cannot become a formula", () => {
    const csv = batchToCsv(batch([item({ transcript: "=2+2", detectedLanguage: "Spanish" })]));
    expect(csv).toContain(",'=2+2,");
    expect(csv).not.toContain(",=2+2,");
  });
});
