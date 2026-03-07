import { Batcher, BatcherConfig, CommitResult } from "./batcher";
import { SubmissionQueue } from "./queue";
import { ethers } from "ethers";

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function makeHash(content: string): string {
  return ethers.keccak256(ethers.toUtf8Bytes(content));
}

function makeCommitResult(batchId = 1): CommitResult {
  return {
    batchId,
    transactionHash: "0x" + "a".repeat(64),
    blockNumber: 12345,
    blockTimestamp: 1700000000,
  };
}

function makeBatcher(
  queue: SubmissionQueue,
  overrides: Partial<BatcherConfig> = {}
): Batcher {
  return new Batcher(queue, {
    timeThresholdMs: 60000,
    volumeThreshold: 5,
    commitFn: jest.fn().mockResolvedValue(makeCommitResult()),
    ...overrides,
  });
}

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

describe("Batcher", () => {
  let queue: SubmissionQueue;

  beforeEach(() => {
    queue = new SubmissionQueue();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  describe("lifecycle", () => {
    test("starts in stopped state", () => {
      const batcher = makeBatcher(queue);
      expect(batcher.running).toBe(false);
    });

    test("running is true after start()", () => {
      const batcher = makeBatcher(queue);
      batcher.start();
      expect(batcher.running).toBe(true);
      batcher.stop();
    });

    test("running is false after stop()", () => {
      const batcher = makeBatcher(queue);
      batcher.start();
      batcher.stop();
      expect(batcher.running).toBe(false);
    });

    test("calling start() twice does not cause issues", () => {
      const batcher = makeBatcher(queue);
      batcher.start();
      batcher.start();
      expect(batcher.running).toBe(true);
      batcher.stop();
    });
  });

  // ---------------------------------------------------------------------------
  // Time threshold
  // ---------------------------------------------------------------------------

  describe("time threshold", () => {
    test("commits when time threshold is reached", async () => {
      const commitFn = jest.fn().mockResolvedValue(makeCommitResult());
      const batcher = makeBatcher(queue, { timeThresholdMs: 1000, commitFn });
      queue.add(makeHash("file1"));
      batcher.start();

      jest.advanceTimersByTime(1000);
      await Promise.resolve();
      await Promise.resolve();

      expect(commitFn).toHaveBeenCalledTimes(1);
      batcher.stop();
    });

    test("does not commit if queue is empty when time threshold fires", async () => {
      const commitFn = jest.fn().mockResolvedValue(makeCommitResult());
      const batcher = makeBatcher(queue, { timeThresholdMs: 1000, commitFn });
      batcher.start();

      jest.advanceTimersByTime(1000);
      await Promise.resolve();

      expect(commitFn).not.toHaveBeenCalled();
      batcher.stop();
    });

    test("reschedules timer after a successful commit", async () => {
      const commitFn = jest.fn().mockResolvedValue(makeCommitResult(1))
        .mockResolvedValueOnce(makeCommitResult(1))
        .mockResolvedValueOnce(makeCommitResult(2));

      const batcher = makeBatcher(queue, { timeThresholdMs: 1000, commitFn });
      queue.add(makeHash("file1"));
      batcher.start();

      jest.advanceTimersByTime(1000);
      await Promise.resolve();
      await Promise.resolve();

      queue.add(makeHash("file2"));
      jest.advanceTimersByTime(1000);
      await Promise.resolve();
      await Promise.resolve();

      expect(commitFn).toHaveBeenCalledTimes(2);
      batcher.stop();
    });
  });

  // ---------------------------------------------------------------------------
  // Volume threshold
  // ---------------------------------------------------------------------------

  describe("volume threshold", () => {
    test("commits immediately when volume threshold is reached", async () => {
      const commitFn = jest.fn().mockResolvedValue(makeCommitResult());
      const batcher = makeBatcher(queue, { volumeThreshold: 3, commitFn });
      batcher.start();

      queue.add(makeHash("file1"));
      await batcher.onSubmission();
      queue.add(makeHash("file2"));
      await batcher.onSubmission();
      queue.add(makeHash("file3"));
      await batcher.onSubmission();

      expect(commitFn).toHaveBeenCalledTimes(1);
      batcher.stop();
    });

    test("does not commit before volume threshold is reached", async () => {
      const commitFn = jest.fn().mockResolvedValue(makeCommitResult());
      const batcher = makeBatcher(queue, { volumeThreshold: 5, commitFn });
      batcher.start();

      queue.add(makeHash("file1"));
      await batcher.onSubmission();
      queue.add(makeHash("file2"));
      await batcher.onSubmission();

      expect(commitFn).not.toHaveBeenCalled();
      batcher.stop();
    });
  });

  // ---------------------------------------------------------------------------
  // Commit behavior
  // ---------------------------------------------------------------------------

  describe("commit behavior", () => {
    test("marks submissions as committed after successful commit", async () => {
      const batcher = makeBatcher(queue);
      const s1 = queue.add(makeHash("file1"));
      const s2 = queue.add(makeHash("file2"));

      await batcher.commit("manual");

      expect(queue.get(s1.id)!.status).toBe("committed");
      expect(queue.get(s2.id)!.status).toBe("committed");
    });

    test("stores proof paths after successful commit", async () => {
      const batcher = makeBatcher(queue);
      const s1 = queue.add(makeHash("file1"));
      const s2 = queue.add(makeHash("file2"));

      await batcher.commit("manual");

      expect(queue.get(s1.id)!.proof).toBeDefined();
      expect(queue.get(s2.id)!.proof).toBeDefined();
    });

    test("does not commit if queue is empty", async () => {
      const commitFn = jest.fn().mockResolvedValue(makeCommitResult());
      const batcher = makeBatcher(queue, { commitFn });

      await batcher.commit("manual");

      expect(commitFn).not.toHaveBeenCalled();
    });

    test("does not double-commit if already committing", async () => {
      const commitFn = jest.fn().mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve(makeCommitResult()), 100))
      );
      const batcher = makeBatcher(queue, { commitFn });
      queue.add(makeHash("file1"));

      // Start two commits simultaneously
      const p1 = batcher.commit("manual");
      const p2 = batcher.commit("manual");
      jest.advanceTimersByTime(100);
      await Promise.all([p1, p2]);

      expect(commitFn).toHaveBeenCalledTimes(1);
    });

    test("marks submissions as failed if commit throws", async () => {
      const commitFn = jest.fn().mockRejectedValue(new Error("RPC error"));
      const batcher = makeBatcher(queue, { commitFn });
      const s1 = queue.add(makeHash("file1"));

      await batcher.commit("manual");

      expect(queue.get(s1.id)!.status).toBe("failed");
    });

    test("calls onCommit callback after successful commit", async () => {
      const onCommit = jest.fn();
      const batcher = makeBatcher(queue, { onCommit });
      queue.add(makeHash("file1"));

      await batcher.commit("manual");

      expect(onCommit).toHaveBeenCalledTimes(1);
      expect(onCommit.mock.calls[0][0].submissionCount).toBe(1);
    });

    test("calls onError callback if commit fails", async () => {
      const onError = jest.fn();
      const commitFn = jest.fn().mockRejectedValue(new Error("RPC error"));
      const batcher = makeBatcher(queue, { commitFn, onError });
      queue.add(makeHash("file1"));

      await batcher.commit("manual");

      expect(onError).toHaveBeenCalledTimes(1);
    });

    test("only commits pending submissions, not already committed ones", async () => {
      const commitFn = jest.fn()
        .mockResolvedValueOnce(makeCommitResult(1))
        .mockResolvedValueOnce(makeCommitResult(2));
      const batcher = makeBatcher(queue, { commitFn });

      const s1 = queue.add(makeHash("file1"));
      await batcher.commit("manual");
      expect(queue.get(s1.id)!.status).toBe("committed");

      const s2 = queue.add(makeHash("file2"));
      await batcher.commit("manual");

      expect(queue.get(s1.id)!.batchId).toBe(1);
      expect(queue.get(s2.id)!.batchId).toBe(2);
      expect(commitFn).toHaveBeenCalledTimes(2);
    });
  });
});
