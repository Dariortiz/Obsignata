import { randomUUID } from "crypto";
import {
  dbInsert, dbGet, dbGetPending, dbCountPending,
  dbGetAll, dbMarkCommitted, dbMarkFailed, dbRequeueFailed, dbClear,
} from "./db";

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export type SubmissionStatus = "pending" | "committed" | "failed";
export type HashingMode = "raw" | "content";

export interface Submission {
  id: string;
  fileHash: string;
  hashingMode: HashingMode;
  submittedAt: number;
  status: SubmissionStatus;
  batchId?: number;
  merkleRoot?: string;
  proof?: string[];
  transactionHash?: string;
  blockNumber?: number;
  blockTimestamp?: number;
}

// -----------------------------------------------------------------------------
// Queue — backed by SQLite via db.ts
// -----------------------------------------------------------------------------

/**
 * Submission queue backed by SQLite.
 * Submissions survive backend restarts.
 */
export class SubmissionQueue {

  add(fileHash: string, hashingMode: HashingMode = "raw"): Submission {
    if (!isValidHash(fileHash)) {
      throw new Error(
        `Invalid file hash: "${fileHash}". Expected a 0x-prefixed 32-byte hex string.`
      );
    }

    const submission: Submission = {
      id: randomUUID(),
      fileHash,
      hashingMode,
      submittedAt: Date.now(),
      status: "pending",
    };

    dbInsert(submission);
    return submission;
  }

  get(id: string): Submission | undefined {
    return dbGet(id);
  }

  getPending(): Submission[] {
    return dbGetPending();
  }

  getPendingCount(): number {
    return dbCountPending();
  }

  getAll(): Submission[] {
    return dbGetAll();
  }

  markCommitted(
    ids: string[],
    commitData: {
      batchId: number;
      merkleRoot: string;
      proofs: Map<string, string[]>;
      transactionHash: string;
      blockNumber: number;
      blockTimestamp: number;
    }
  ): void {
    for (const id of ids) {
      dbMarkCommitted(id, {
        batchId: commitData.batchId,
        merkleRoot: commitData.merkleRoot,
        proof: commitData.proofs.get(id) ?? [],
        transactionHash: commitData.transactionHash,
        blockNumber: commitData.blockNumber,
        blockTimestamp: commitData.blockTimestamp,
      });
    }
  }

  markFailed(ids: string[]): void {
    ids.forEach(id => dbMarkFailed(id));
  }

  requeueFailed(ids?: string[]): void {
    dbRequeueFailed(ids);
  }

  clear(): void {
    dbClear();
  }
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

export function isValidHash(hash: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(hash);
}