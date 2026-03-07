import { randomUUID } from "crypto";

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/**
 * The status of a submission through its lifecycle.
 *
 * pending   → hash is in the queue, waiting for a batch to be committed
 * committed → batch has been committed on-chain, proof path is available
 * failed    → batch commit failed, submission needs to be requeued
 */
export type SubmissionStatus = "pending" | "committed" | "failed";

/**
 * Represents a single file hash submission from a user.
 */
export interface Submission {
  id: string;                  // Unique submission ID returned to the user
  fileHash: string;            // keccak256 hash of the user's file
  submittedAt: number;         // Unix timestamp (ms) when submission was received
  status: SubmissionStatus;
  batchId?: number;            // On-chain batch ID, set after commit
  merkleRoot?: string;         // Merkle root of the batch, set after commit
  proof?: string[];            // Merkle proof path, set after commit
  transactionHash?: string;    // Polygon transaction hash, set after commit
  blockNumber?: number;        // Block number of the commit transaction
  blockTimestamp?: number;     // Block timestamp of the commit transaction
}

// -----------------------------------------------------------------------------
// Queue
// -----------------------------------------------------------------------------

/**
 * In-memory store for all submissions.
 * Pending submissions are those waiting to be included in the next batch.
 *
 * NOTE: This is an in-memory store. Submissions are lost if the backend
 * restarts before they are committed. For production, this would be replaced
 * with a persistent store (e.g. Redis or a database). For this portfolio
 * project, the trade-off is acceptable and clearly documented.
 */
export class SubmissionQueue {
  private submissions: Map<string, Submission> = new Map();

  // ---------------------------------------------------------------------------
  // Adding submissions
  // ---------------------------------------------------------------------------

  /**
   * Adds a new file hash to the queue.
   * @param fileHash The keccak256 hash of the file to timestamp.
   * @returns The created Submission with a unique ID.
   * @throws If the fileHash is not a valid 32-byte hex string.
   */
  add(fileHash: string): Submission {
    if (!isValidHash(fileHash)) {
      throw new Error(
        `Invalid file hash: "${fileHash}". Expected a 0x-prefixed 32-byte hex string.`
      );
    }

    const submission: Submission = {
      id: randomUUID(),
      fileHash,
      submittedAt: Date.now(),
      status: "pending",
    };

    this.submissions.set(submission.id, submission);
    return submission;
  }

  // ---------------------------------------------------------------------------
  // Retrieving submissions
  // ---------------------------------------------------------------------------

  /**
   * Returns a submission by ID, or undefined if not found.
   */
  get(id: string): Submission | undefined {
    return this.submissions.get(id);
  }

  /**
   * Returns all submissions currently in pending status.
   * These are the submissions that will be included in the next batch.
   */
  getPending(): Submission[] {
    return Array.from(this.submissions.values()).filter(
      (s) => s.status === "pending"
    );
  }

  /**
   * Returns the number of pending submissions.
   */
  getPendingCount(): number {
    return this.getPending().length;
  }

  /**
   * Returns all submissions regardless of status.
   */
  getAll(): Submission[] {
    return Array.from(this.submissions.values());
  }

  // ---------------------------------------------------------------------------
  // Updating submissions
  // ---------------------------------------------------------------------------

  /**
   * Marks a set of submissions as committed after a successful batch commit.
   * @param ids The submission IDs to mark as committed.
   * @param commitData The on-chain data from the committed batch.
   */
  markCommitted(
    ids: string[],
    commitData: {
      batchId: number;
      merkleRoot: string;
      proofs: Map<string, string[]>; // submissionId → proof path
      transactionHash: string;
      blockNumber: number;
      blockTimestamp: number;
    }
  ): void {
    for (const id of ids) {
      const submission = this.submissions.get(id);
      if (!submission) continue;

      submission.status = "committed";
      submission.batchId = commitData.batchId;
      submission.merkleRoot = commitData.merkleRoot;
      submission.proof = commitData.proofs.get(id);
      submission.transactionHash = commitData.transactionHash;
      submission.blockNumber = commitData.blockNumber;
      submission.blockTimestamp = commitData.blockTimestamp;
    }
  }

  /**
   * Marks a set of submissions as failed.
   * Failed submissions should be requeued or handled by the caller.
   * @param ids The submission IDs to mark as failed.
   */
  markFailed(ids: string[]): void {
    for (const id of ids) {
      const submission = this.submissions.get(id);
      if (!submission) continue;
      submission.status = "failed";
    }
  }

  /**
   * Requeues failed submissions by resetting their status to pending.
   * @param ids The submission IDs to requeue. If omitted, requeues all failed.
   */
  requeueFailed(ids?: string[]): void {
    const targets = ids
      ? ids.map((id) => this.submissions.get(id)).filter(Boolean) as Submission[]
      : Array.from(this.submissions.values()).filter((s) => s.status === "failed");

    for (const submission of targets) {
      submission.status = "pending";
      submission.batchId = undefined;
      submission.merkleRoot = undefined;
      submission.proof = undefined;
      submission.transactionHash = undefined;
      submission.blockNumber = undefined;
      submission.blockTimestamp = undefined;
    }
  }

  // ---------------------------------------------------------------------------
  // Clearing
  // ---------------------------------------------------------------------------

  /**
   * Removes all submissions from the queue.
   * Primarily used in tests.
   */
  clear(): void {
    this.submissions.clear();
  }
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/**
 * Validates that a string is a 0x-prefixed 32-byte hex string,
 * which is the expected format for keccak256 hashes.
 */
export function isValidHash(hash: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(hash);
}
