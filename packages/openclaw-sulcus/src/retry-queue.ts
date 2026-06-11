// @ts-nocheck
/**
 * RetryQueue — in-memory retry buffer for failed remote writes.
 *
 * When a dual-write to the remote backend fails, the operation is buffered here
 * and retried on the next flush cycle (triggered per-turn or on a timer).
 *
 * Design constraints:
 * - In-memory only — no disk persistence. Restarts lose the queue. This is OK
 *   because the local sidecar has the data; sync will eventually propagate.
 * - Bounded: max items (default 500) with FIFO eviction when full.
 * - Items have a max retry count before being dropped (default 5).
 * - Flush is non-blocking and serialized (one flush at a time).
 */

/** The types of operations we can retry. */
export type RetryOperation = "store" | "update" | "delete" | "boost";

/** A single item in the retry queue. */
export interface RetryItem {
  /** Unique key for deduplication (e.g. node ID or content hash). */
  key: string;
  /** What operation to retry. */
  operation: RetryOperation;
  /** Arguments to pass to the remote client method. */
  payload: Record<string, unknown>;
  /** How many times we've attempted this item. */
  attempts: number;
  /** When this item was first enqueued (epoch ms). */
  enqueuedAt: number;
  /** When the last attempt happened (epoch ms). */
  lastAttemptAt: number;
  /** Last error message, if any. */
  lastError?: string;
}

/** Logger interface. */
export interface RetryQueueLogger {
  info(msg: string): void;
  warn(msg: string): void;
  debug(msg: string): void;
}

/** Options for RetryQueue construction. */
export interface RetryQueueOptions {
  /** Maximum items in the queue. Oldest evicted when full. Default: 500. */
  maxItems?: number;
  /** Maximum retry attempts per item before dropping. Default: 5. */
  maxRetries?: number;
  /** Logger instance. */
  logger?: RetryQueueLogger;
}

/**
 * Executor function that the queue calls to attempt a retry.
 * Should throw on failure so the queue knows to re-enqueue.
 */
export type RetryExecutor = (item: RetryItem) => Promise<void>;

export class RetryQueue {
  private items = new Map<string, RetryItem>();
  private maxItems: number;
  private maxRetries: number;
  private logger: RetryQueueLogger;
  private flushing = false;

  constructor(opts: RetryQueueOptions = {}) {
    this.maxItems = opts.maxItems ?? 500;
    this.maxRetries = opts.maxRetries ?? 5;
    this.logger = opts.logger ?? { info: () => {}, warn: () => {}, debug: () => {} };
  }

  /** Number of items currently queued. */
  get size(): number {
    return this.items.size;
  }

  /** Whether a flush is currently in progress. */
  get isFlushing(): boolean {
    return this.flushing;
  }

  /**
   * Enqueue an operation for retry.
   * If an item with the same key already exists, it's updated (latest payload wins).
   */
  enqueue(key: string, operation: RetryOperation, payload: Record<string, unknown>): void {
    const existing = this.items.get(key);
    if (existing) {
      // Update payload but keep attempt count
      existing.payload = payload;
      existing.operation = operation;
      this.logger.debug(`sulcus-retry: updated existing item ${key} (attempts: ${existing.attempts})`);
      return;
    }

    // Evict oldest if at capacity
    if (this.items.size >= this.maxItems) {
      const oldestKey = this.items.keys().next().value;
      if (oldestKey !== undefined) {
        this.items.delete(oldestKey);
        this.logger.warn(`sulcus-retry: queue full (${this.maxItems}), evicted oldest item ${oldestKey}`);
      }
    }

    this.items.set(key, {
      key,
      operation,
      payload,
      attempts: 0,
      enqueuedAt: Date.now(),
      lastAttemptAt: 0,
    });

    this.logger.debug(`sulcus-retry: enqueued ${operation} for ${key} (queue size: ${this.items.size})`);
  }

  /**
   * Flush the queue — attempt all pending retries.
   *
   * Calls `executor` for each item. If the executor succeeds, the item is removed.
   * If it throws, the item's attempt count is incremented; items exceeding
   * `maxRetries` are dropped.
   *
   * Returns the number of successfully flushed items.
   */
  async flush(executor: RetryExecutor): Promise<{ flushed: number; failed: number; dropped: number }> {
    if (this.flushing) {
      this.logger.debug("sulcus-retry: flush already in progress, skipping");
      return { flushed: 0, failed: 0, dropped: 0 };
    }

    if (this.items.size === 0) {
      return { flushed: 0, failed: 0, dropped: 0 };
    }

    this.flushing = true;
    let flushed = 0;
    let failed = 0;
    let dropped = 0;

    // Snapshot keys to avoid mutation during iteration
    const keys = [...this.items.keys()];

    for (const key of keys) {
      const item = this.items.get(key);
      if (!item) continue;

      item.attempts++;
      item.lastAttemptAt = Date.now();

      try {
        await executor(item);
        this.items.delete(key);
        flushed++;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        item.lastError = msg;

        if (item.attempts >= this.maxRetries) {
          this.items.delete(key);
          dropped++;
          this.logger.warn(`sulcus-retry: dropped ${item.operation} for ${key} after ${item.attempts} attempts: ${msg}`);
        } else {
          failed++;
          this.logger.debug(`sulcus-retry: ${item.operation} for ${key} failed (attempt ${item.attempts}/${this.maxRetries}): ${msg}`);
        }
      }
    }

    this.flushing = false;

    if (flushed > 0 || dropped > 0) {
      this.logger.info(`sulcus-retry: flush complete — flushed: ${flushed}, failed: ${failed}, dropped: ${dropped}, remaining: ${this.items.size}`);
    }

    return { flushed, failed, dropped };
  }

  /** Clear all items from the queue. */
  clear(): void {
    this.items.clear();
  }

  /** Get a diagnostic snapshot of the queue state. */
  snapshot(): { size: number; flushing: boolean; items: RetryItem[] } {
    return {
      size: this.items.size,
      flushing: this.flushing,
      items: [...this.items.values()],
    };
  }
}
