// Hand-rolled worker pool (ADR-003 allows "p-limit or a 30-line hand-rolled pool").
// Global concurrency N across ALL batches, fair round-robin between batches so one user's
// 50-URL batch never starves another's single URL (arch §5). Tasks must not throw — the
// pipeline converts every failure into item state; a throwing task is logged and dropped.

import { log } from "./logger";

export type Task = () => Promise<void>;

export class WorkerPool {
  private queues = new Map<string, Task[]>(); // batchId -> FIFO of tasks
  private rotation: string[] = []; // round-robin order of batchIds with queued work
  private running = 0;

  constructor(private concurrency: number) {}

  submit(batchId: string, task: Task): void {
    let q = this.queues.get(batchId);
    if (!q) {
      q = [];
      this.queues.set(batchId, q);
      this.rotation.push(batchId);
    }
    q.push(task);
    this.pump();
  }

  /** Number of tasks currently executing (test/diagnostic hook). */
  get inFlight(): number {
    return this.running;
  }

  private nextTask(): Task | undefined {
    while (this.rotation.length > 0) {
      const batchId = this.rotation.shift()!;
      const q = this.queues.get(batchId);
      if (!q || q.length === 0) {
        this.queues.delete(batchId);
        continue;
      }
      const task = q.shift()!;
      if (q.length > 0) {
        this.rotation.push(batchId); // keep the batch in rotation, at the back: fairness
      } else {
        this.queues.delete(batchId);
      }
      return task;
    }
    return undefined;
  }

  private pump(): void {
    while (this.running < this.concurrency) {
      const task = this.nextTask();
      if (!task) return;
      this.running++;
      task()
        .catch((err) => {
          // Pipeline bugs only — item-level failures are handled inside the task.
          log("error", "pool_task_unhandled_error", { error: String(err) });
        })
        .finally(() => {
          this.running--;
          this.pump();
        });
    }
  }
}
