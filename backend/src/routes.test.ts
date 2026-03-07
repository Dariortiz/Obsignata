import express from "express";
import request from "supertest";
import { createRouter } from "./routes";
import { SubmissionQueue } from "./queue";
import { Batcher } from "./batcher";
import { ethers } from "ethers";

// Mock certificate generation to avoid generating real PDFs in route tests
jest.mock("./certificate", () => ({
  generateCertificate: jest.fn().mockResolvedValue(Buffer.from("%PDF-fake")),
  parsePayload: jest.requireActual("./certificate").parsePayload,
}));

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function makeHash(content: string): string {
  return ethers.keccak256(ethers.toUtf8Bytes(content));
}

function makeCommitResult(batchId = 1) {
  return {
    batchId,
    transactionHash: "0x" + "a".repeat(64),
    blockNumber: 12345,
    blockTimestamp: 1700000000,
  };
}

function makeApp() {
  const queue = new SubmissionQueue();
  const batcher = new Batcher(queue, {
    timeThresholdMs: 999999,
    volumeThreshold: 999,
    commitFn: jest.fn().mockResolvedValue(makeCommitResult()),
  });
  const app = express();
  app.use(express.json());
  app.use(createRouter(queue, batcher));
  return { app, queue, batcher };
}

// -----------------------------------------------------------------------------
// POST /submit
// -----------------------------------------------------------------------------

describe("POST /submit", () => {
  test("returns 201 with submissionId for valid hash", async () => {
    const { app } = makeApp();
    const res = await request(app)
      .post("/submit")
      .send({ fileHash: makeHash("file1") });

    expect(res.status).toBe(201);
    expect(res.body.submissionId).toBeDefined();
    expect(res.body.status).toBe("pending");
  });

  test("returns 400 if fileHash is missing", async () => {
    const { app } = makeApp();
    const res = await request(app).post("/submit").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Missing required field/);
  });

  test("returns 400 for invalid fileHash format", async () => {
    const { app } = makeApp();
    const res = await request(app)
      .post("/submit")
      .send({ fileHash: "not-a-hash" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid fileHash/);
  });

  test("returns 400 for hash missing 0x prefix", async () => {
    const { app } = makeApp();
    const res = await request(app)
      .post("/submit")
      .send({ fileHash: "a".repeat(64) });
    expect(res.status).toBe(400);
  });

  test("adds submission to queue", async () => {
    const { app, queue } = makeApp();
    await request(app)
      .post("/submit")
      .send({ fileHash: makeHash("file1") });
    expect(queue.getPendingCount()).toBe(1);
  });

  test("returns submittedAt timestamp", async () => {
    const { app } = makeApp();
    const before = Date.now();
    const res = await request(app)
      .post("/submit")
      .send({ fileHash: makeHash("file1") });
    const after = Date.now();
    expect(res.body.submittedAt).toBeGreaterThanOrEqual(before);
    expect(res.body.submittedAt).toBeLessThanOrEqual(after);
  });
});

// -----------------------------------------------------------------------------
// GET /submission/:id
// -----------------------------------------------------------------------------

describe("GET /submission/:id", () => {
  test("returns 404 for unknown submission ID", async () => {
    const { app } = makeApp();
    const res = await request(app).get("/submission/nonexistent-id");
    expect(res.status).toBe(404);
  });

  test("returns pending submission correctly", async () => {
    const { app, queue } = makeApp();
    const hash = makeHash("file1");
    const submission = queue.add(hash);

    const res = await request(app).get(`/submission/${submission.id}`);
    expect(res.status).toBe(200);
    expect(res.body.submissionId).toBe(submission.id);
    expect(res.body.fileHash).toBe(hash);
    expect(res.body.status).toBe("pending");
  });

  test("does not include on-chain data for pending submission", async () => {
    const { app, queue } = makeApp();
    const submission = queue.add(makeHash("file1"));

    const res = await request(app).get(`/submission/${submission.id}`);
    expect(res.body.batchId).toBeUndefined();
    expect(res.body.proof).toBeUndefined();
    expect(res.body.transactionHash).toBeUndefined();
  });

  test("returns committed submission with on-chain data", async () => {
    const { app, queue } = makeApp();
    const submission = queue.add(makeHash("file1"));
    const proofs = new Map([[submission.id, [makeHash("sibling")]]]);

    queue.markCommitted([submission.id], {
      batchId: 1,
      merkleRoot: makeHash("root"),
      proofs,
      transactionHash: "0x" + "a".repeat(64),
      blockNumber: 12345,
      blockTimestamp: 1700000000,
    });

    const res = await request(app).get(`/submission/${submission.id}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("committed");
    expect(res.body.batchId).toBe(1);
    expect(res.body.proof).toBeDefined();
    expect(res.body.transactionHash).toBeDefined();
    expect(res.body.blockNumber).toBe(12345);
    expect(res.body.blockTimestamp).toBe(1700000000);
  });
});

// -----------------------------------------------------------------------------
// GET /health
// -----------------------------------------------------------------------------

describe("GET /health", () => {
  test("returns 200 with status ok", async () => {
    const { app } = makeApp();
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });

  test("includes pending submission count", async () => {
    const { app, queue } = makeApp();
    queue.add(makeHash("file1"));
    queue.add(makeHash("file2"));

    const res = await request(app).get("/health");
    expect(res.body.pendingSubmissions).toBe(2);
  });

  test("includes batcher running status", async () => {
    const { app } = makeApp();
    const res = await request(app).get("/health");
    expect(res.body.batcherRunning).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// GET /certificate/:id
// -----------------------------------------------------------------------------

describe("GET /certificate/:id", () => {
  function makeCommittedSubmission(queue: SubmissionQueue) {
    const submission = queue.add(makeHash("file1"));
    const proofs = new Map([[submission.id, [makeHash("sibling")]]]);
    queue.markCommitted([submission.id], {
      batchId: 1,
      merkleRoot: makeHash("root"),
      proofs,
      transactionHash: "0x" + "a".repeat(64),
      blockNumber: 12345,
      blockTimestamp: 1700000000,
    });
    return submission;
  }

  test("returns 404 for unknown submission ID", async () => {
    const { app } = makeApp();
    const res = await request(app).get("/certificate/nonexistent-id");
    expect(res.status).toBe(404);
  });

  test("returns 202 for pending submission", async () => {
    const { app, queue } = makeApp();
    const submission = queue.add(makeHash("file1"));
    const res = await request(app).get(`/certificate/${submission.id}`);
    expect(res.status).toBe(202);
    expect(res.body.error).toMatch(/not ready/i);
  });

  test("returns 500 for failed submission", async () => {
    const { app, queue } = makeApp();
    const submission = queue.add(makeHash("file1"));
    queue.markFailed([submission.id]);
    const res = await request(app).get(`/certificate/${submission.id}`);
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/failed/i);
  });

  test("returns 200 with PDF content type for committed submission", async () => {
    const { app, queue } = makeApp();
    const submission = makeCommittedSubmission(queue);
    const res = await request(app).get(`/certificate/${submission.id}`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/pdf/);
  });

  test("sets correct Content-Disposition header with submission ID", async () => {
    const { app, queue } = makeApp();
    const submission = makeCommittedSubmission(queue);
    const res = await request(app).get(`/certificate/${submission.id}`);
    expect(res.headers["content-disposition"]).toContain(submission.id);
    expect(res.headers["content-disposition"]).toContain("attachment");
  });

  test("returns a non-empty buffer for committed submission", async () => {
    const { app, queue } = makeApp();
    const submission = makeCommittedSubmission(queue);
    const res = await request(app).get(`/certificate/${submission.id}`);
    expect(res.body).toBeDefined();
    expect(res.headers["content-length"]).toBeDefined();
  });
});
