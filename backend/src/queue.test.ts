import { SubmissionQueue, isValidHash } from "./queue";
import { ethers } from "ethers";

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function makeHash(content: string): string {
  return ethers.keccak256(ethers.toUtf8Bytes(content));
}

function makeCommitData(ids: string[], proofOverride?: Map<string, string[]>) {
  const proofs = proofOverride ?? new Map(ids.map((id) => [id, [makeHash("sibling")]]));
  return {
    batchId: 1,
    merkleRoot: makeHash("root"),
    proofs,
    transactionHash: "0x" + "a".repeat(64),
    blockNumber: 12345,
    blockTimestamp: 1700000000,
  };
}

// -----------------------------------------------------------------------------
// isValidHash
// -----------------------------------------------------------------------------

describe("isValidHash", () => {
  test("returns true for a valid 0x-prefixed 32-byte hex string", () => {
    expect(isValidHash(makeHash("file"))).toBe(true);
  });

  test("returns false for missing 0x prefix", () => {
    expect(isValidHash("a".repeat(64))).toBe(false);
  });

  test("returns false for too short", () => {
    expect(isValidHash("0x" + "a".repeat(62))).toBe(false);
  });

  test("returns false for too long", () => {
    expect(isValidHash("0x" + "a".repeat(66))).toBe(false);
  });

  test("returns false for non-hex characters", () => {
    expect(isValidHash("0x" + "g".repeat(64))).toBe(false);
  });

  test("returns false for empty string", () => {
    expect(isValidHash("")).toBe(false);
  });

  test("returns true for uppercase hex", () => {
    expect(isValidHash("0x" + "A".repeat(64))).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// SubmissionQueue
// -----------------------------------------------------------------------------

describe("SubmissionQueue", () => {
  let queue: SubmissionQueue;

  beforeEach(() => {
    queue = new SubmissionQueue();
  });

  // ---------------------------------------------------------------------------
  // add
  // ---------------------------------------------------------------------------

  describe("add", () => {
    test("adds a submission and returns it with a unique ID", () => {
      const hash = makeHash("file1");
      const submission = queue.add(hash);
      expect(submission.id).toBeDefined();
      expect(submission.fileHash).toBe(hash);
      expect(submission.status).toBe("pending");
    });

    test("generates unique IDs for each submission", () => {
      const s1 = queue.add(makeHash("file1"));
      const s2 = queue.add(makeHash("file2"));
      expect(s1.id).not.toBe(s2.id);
    });

    test("sets submittedAt to current time", () => {
      const before = Date.now();
      const submission = queue.add(makeHash("file1"));
      const after = Date.now();
      expect(submission.submittedAt).toBeGreaterThanOrEqual(before);
      expect(submission.submittedAt).toBeLessThanOrEqual(after);
    });

    test("throws for invalid hash — missing 0x prefix", () => {
      expect(() => queue.add("a".repeat(64))).toThrow("Invalid file hash");
    });

    test("throws for invalid hash — wrong length", () => {
      expect(() => queue.add("0x" + "a".repeat(32))).toThrow("Invalid file hash");
    });

    test("throws for empty string", () => {
      expect(() => queue.add("")).toThrow("Invalid file hash");
    });

    test("allows duplicate file hashes — same file can be submitted twice", () => {
      const hash = makeHash("file1");
      const s1 = queue.add(hash);
      const s2 = queue.add(hash);
      expect(s1.id).not.toBe(s2.id);
      expect(queue.getPendingCount()).toBe(2);
    });
  });

  // ---------------------------------------------------------------------------
  // get
  // ---------------------------------------------------------------------------

  describe("get", () => {
    test("returns a submission by ID", () => {
      const submission = queue.add(makeHash("file1"));
      expect(queue.get(submission.id)).toEqual(submission);
    });

    test("returns undefined for unknown ID", () => {
      expect(queue.get("nonexistent-id")).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // getPending
  // ---------------------------------------------------------------------------

  describe("getPending", () => {
    test("returns all pending submissions", () => {
      queue.add(makeHash("file1"));
      queue.add(makeHash("file2"));
      expect(queue.getPending()).toHaveLength(2);
    });

    test("returns empty array when no pending submissions", () => {
      expect(queue.getPending()).toHaveLength(0);
    });

    test("does not return committed submissions", () => {
      const s1 = queue.add(makeHash("file1"));
      queue.add(makeHash("file2"));
      queue.markCommitted([s1.id], makeCommitData([s1.id]));
      expect(queue.getPending()).toHaveLength(1);
    });

    test("does not return failed submissions", () => {
      const s1 = queue.add(makeHash("file1"));
      queue.add(makeHash("file2"));
      queue.markFailed([s1.id]);
      expect(queue.getPending()).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------------
  // getPendingCount
  // ---------------------------------------------------------------------------

  describe("getPendingCount", () => {
    test("returns correct count of pending submissions", () => {
      queue.add(makeHash("file1"));
      queue.add(makeHash("file2"));
      queue.add(makeHash("file3"));
      expect(queue.getPendingCount()).toBe(3);
    });

    test("returns 0 when queue is empty", () => {
      expect(queue.getPendingCount()).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // markCommitted
  // ---------------------------------------------------------------------------

  describe("markCommitted", () => {
    test("marks submissions as committed with correct data", () => {
      const s1 = queue.add(makeHash("file1"));
      const s2 = queue.add(makeHash("file2"));
      const commitData = makeCommitData([s1.id, s2.id]);
      queue.markCommitted([s1.id, s2.id], commitData);

      const updated1 = queue.get(s1.id)!;
      expect(updated1.status).toBe("committed");
      expect(updated1.batchId).toBe(commitData.batchId);
      expect(updated1.merkleRoot).toBe(commitData.merkleRoot);
      expect(updated1.transactionHash).toBe(commitData.transactionHash);
      expect(updated1.blockNumber).toBe(commitData.blockNumber);
      expect(updated1.blockTimestamp).toBe(commitData.blockTimestamp);
    });

    test("stores correct proof path per submission", () => {
      const s1 = queue.add(makeHash("file1"));
      const s2 = queue.add(makeHash("file2"));
      const proof1 = [makeHash("sibling1")];
      const proof2 = [makeHash("sibling2")];
      const proofs = new Map([[s1.id, proof1], [s2.id, proof2]]);
      queue.markCommitted([s1.id, s2.id], makeCommitData([s1.id, s2.id], proofs));

      expect(queue.get(s1.id)!.proof).toEqual(proof1);
      expect(queue.get(s2.id)!.proof).toEqual(proof2);
    });

    test("ignores unknown IDs gracefully", () => {
      expect(() =>
        queue.markCommitted(["nonexistent"], makeCommitData(["nonexistent"]))
      ).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // markFailed
  // ---------------------------------------------------------------------------

  describe("markFailed", () => {
    test("marks submissions as failed", () => {
      const s1 = queue.add(makeHash("file1"));
      queue.markFailed([s1.id]);
      expect(queue.get(s1.id)!.status).toBe("failed");
    });

    test("ignores unknown IDs gracefully", () => {
      expect(() => queue.markFailed(["nonexistent"])).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // requeueFailed
  // ---------------------------------------------------------------------------

  describe("requeueFailed", () => {
    test("requeues all failed submissions when no IDs provided", () => {
      const s1 = queue.add(makeHash("file1"));
      const s2 = queue.add(makeHash("file2"));
      queue.markFailed([s1.id, s2.id]);
      queue.requeueFailed();
      expect(queue.get(s1.id)!.status).toBe("pending");
      expect(queue.get(s2.id)!.status).toBe("pending");
    });

    test("requeues specific submissions when IDs provided", () => {
      const s1 = queue.add(makeHash("file1"));
      const s2 = queue.add(makeHash("file2"));
      queue.markFailed([s1.id, s2.id]);
      queue.requeueFailed([s1.id]);
      expect(queue.get(s1.id)!.status).toBe("pending");
      expect(queue.get(s2.id)!.status).toBe("failed");
    });

    test("clears commit data when requeuing", () => {
      const s1 = queue.add(makeHash("file1"));
      queue.markCommitted([s1.id], makeCommitData([s1.id]));
      queue.markFailed([s1.id]);
      queue.requeueFailed([s1.id]);
      const requeued = queue.get(s1.id)!;
      expect(requeued.batchId).toBeUndefined();
      expect(requeued.merkleRoot).toBeUndefined();
      expect(requeued.proof).toBeUndefined();
      expect(requeued.transactionHash).toBeUndefined();
    });

    test("does not affect pending or committed submissions", () => {
      const s1 = queue.add(makeHash("file1"));
      const s2 = queue.add(makeHash("file2"));
      queue.markCommitted([s2.id], makeCommitData([s2.id]));
      queue.requeueFailed();
      expect(queue.get(s1.id)!.status).toBe("pending");
      expect(queue.get(s2.id)!.status).toBe("committed");
    });
  });

  // ---------------------------------------------------------------------------
  // clear
  // ---------------------------------------------------------------------------

  describe("clear", () => {
    test("removes all submissions", () => {
      queue.add(makeHash("file1"));
      queue.add(makeHash("file2"));
      queue.clear();
      expect(queue.getAll()).toHaveLength(0);
    });

    test("queue is usable after clearing", () => {
      queue.add(makeHash("file1"));
      queue.clear();
      queue.add(makeHash("file2"));
      expect(queue.getPendingCount()).toBe(1);
    });
  });
});
