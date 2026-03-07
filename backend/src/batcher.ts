import { SubmissionQueue, Submission } from "./queue";
import { buildTree, getProof } from "./merkle";

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface BatcherConfig {
  /** Commit a batch after this many ms regardless of queue size. Default: 2 hours. */
  timeThresholdMs: number;
  /** Commit a batch immediately when this many submissions are pending. Default: 500. */
  volumeThreshold: number;
  /** Function that commits a Merkle root on-chain. Injected for testability. */
  commitFn: (merkleRoot: string) => Promise<CommitResult>;
  /** Called after a successful commit with the result. */
  onCommit?: (result: BatchResult) => void;
  /** Called if a commit fails. */
  onError?: (error: Error, submissions: Submission[]) => void;
}

export interface CommitResult {
  batchId: number;
  transactionHash: string;
  blockNumber: number;
  blockTimestamp: number;
}

export interface BatchResult {
  batchId: number;
  merkleRoot: string;
  transactionHash: string;
  blockNumber: number;
  blockTimestamp: number;
  submissionCount: number;
}

// -----------------------------------------------------------------------------
// Batcher
// -----------------------------------------------------------------------------

/**
 * Watches the submission queue and commits batches adaptively.
 *
 * Commits when EITHER:
 * - The time threshold is reached (configurable, default 2 hours)
 * - The volume threshold is reached (configurable, default 500 submissions)
 *
 * This ensures low-traffic periods don't cause indefinite delays, while
 * high-traffic periods commit quickly without waiting for the timer.
 */
export class Batcher {
  private queue: SubmissionQueue;
  private config: BatcherConfig;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private isCommitting: boolean = false;
  private isRunning: boolean = false;

  constructor(queue: SubmissionQueue, config: BatcherConfig) {
    this.queue = queue;
    this.config = config;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Starts the batcher. Sets up the time threshold timer.
   */
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.scheduleTimer();
  }

  /**
   * Stops the batcher and clears any pending timer.
   */
  stop(): void {
    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Submission
  // ---------------------------------------------------------------------------

  /**
   * Notifies the batcher that a new submission has been added to the queue.
   * Triggers an immediate commit if the volume threshold is reached.
   */
  async onSubmission(): Promise<void> {
    if (!this.isRunning) return;
    if (this.queue.getPendingCount() >= this.config.volumeThreshold) {
      await this.commit("volume");
    }
  }

  // ---------------------------------------------------------------------------
  // Committing
  // ---------------------------------------------------------------------------

  /**
   * Attempts to commit the current pending batch.
   * No-ops if already committing or if there are no pending submissions.
   *
   * @param trigger What triggered this commit — for logging purposes.
   */
  async commit(trigger: "time" | "volume" | "manual" = "manual"): Promise<void> {
    if (this.isCommitting) return;
    if (this.queue.getPendingCount() === 0) return;

    this.isCommitting = true;

    // Snapshot the pending submissions — new submissions during commit
    // will be held for the next batch
    const pending = this.queue.getPending();
    const submissionIds = pending.map((s) => s.id);
    const leaves = pending.map((s) => s.fileHash);

    try {
      // Build the Merkle tree from the pending file hashes
      const tree = buildTree(leaves);

      // Submit the root on-chain
      const commitResult = await this.config.commitFn(tree.root);

      // Build proof map: submissionId → proof path
      const proofs = new Map<string, string[]>();
      for (let i = 0; i < pending.length; i++) {
        const { proof } = getProof(tree, i);
        proofs.set(pending[i].id, proof);
      }

      // Mark all submissions as committed
      this.queue.markCommitted(submissionIds, {
        batchId: commitResult.batchId,
        merkleRoot: tree.root,
        proofs,
        transactionHash: commitResult.transactionHash,
        blockNumber: commitResult.blockNumber,
        blockTimestamp: commitResult.blockTimestamp,
      });

      const result: BatchResult = {
        batchId: commitResult.batchId,
        merkleRoot: tree.root,
        transactionHash: commitResult.transactionHash,
        blockNumber: commitResult.blockNumber,
        blockTimestamp: commitResult.blockTimestamp,
        submissionCount: pending.length,
      };

      console.log(
        `[Batcher] Committed batch #${result.batchId} (${result.submissionCount} submissions, trigger: ${trigger})`
      );

      this.config.onCommit?.(result);
    } catch (error) {
      console.error(`[Batcher] Commit failed (trigger: ${trigger}):`, error);
      this.queue.markFailed(submissionIds);
      this.config.onError?.(error as Error, pending);
    } finally {
      this.isCommitting = false;

      // Reschedule the timer after every commit attempt
      if (this.isRunning) {
        this.scheduleTimer();
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private scheduleTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(async () => {
      await this.commit("time");
    }, this.config.timeThresholdMs);
  }

  // ---------------------------------------------------------------------------
  // Getters
  // ---------------------------------------------------------------------------

  get running(): boolean {
    return this.isRunning;
  }

  get committing(): boolean {
    return this.isCommitting;
  }
}
