// T-302: worker pool — global concurrency cap and fair round-robin across batches (arch §5).

import { describe, expect, it } from "vitest";
import { WorkerPool } from "../pool";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("WorkerPool", () => {
  it("never exceeds the global concurrency cap", async () => {
    const pool = new WorkerPool(4);
    let inFlight = 0;
    let maxInFlight = 0;
    const done: Promise<void>[] = [];
    let resolveAll: () => void;
    const all = new Promise<void>((r) => (resolveAll = r));
    let finished = 0;

    for (let i = 0; i < 12; i++) {
      done.push(
        new Promise<void>((resolveTask) => {
          pool.submit("batch-1", async () => {
            inFlight++;
            maxInFlight = Math.max(maxInFlight, inFlight);
            await sleep(10);
            inFlight--;
            resolveTask();
            if (++finished === 12) resolveAll();
          });
        }),
      );
    }
    await all;
    await Promise.all(done);
    expect(maxInFlight).toBe(4);
    expect(pool.inFlight).toBe(0);
  });

  it("round-robins fairly: a 1-URL batch is not starved by a 50-URL batch", async () => {
    const pool = new WorkerPool(1); // serialise so start order is observable
    const order: string[] = [];
    const make = (label: string) => async () => {
      order.push(label);
      await sleep(1);
    };

    // Big batch enqueues 4 tasks first, then a single-task batch arrives.
    pool.submit("big", make("big-1"));
    pool.submit("big", make("big-2"));
    pool.submit("big", make("big-3"));
    pool.submit("big", make("big-4"));
    pool.submit("small", make("small-1"));

    await new Promise((r) => setTimeout(r, 100));
    // small-1 must run before the big batch drains (fair FIFO across batches).
    const smallIdx = order.indexOf("small-1");
    expect(smallIdx).toBeGreaterThanOrEqual(0);
    expect(smallIdx).toBeLessThan(order.length - 1);
    expect(order).toHaveLength(5);
  });

  it("a throwing task is logged and dropped without wedging the pool", async () => {
    const pool = new WorkerPool(1);
    let ran = false;
    pool.submit("b", async () => {
      throw new Error("pipeline bug");
    });
    await new Promise<void>((r) =>
      pool.submit("b", async () => {
        ran = true;
        r();
      }),
    );
    expect(ran).toBe(true);
    await sleep(5); // let the final task's .finally() run
    expect(pool.inFlight).toBe(0);
  });
});
