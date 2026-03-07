import { generateCertificate, parsePayload, CertificatePayload } from "./certificate";
import { Submission } from "./queue";
import { ethers } from "ethers";

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function makeHash(content: string): string {
  return ethers.keccak256(ethers.toUtf8Bytes(content));
}

function makeCommittedSubmission(overrides: Partial<Submission> = {}): Submission {
  return {
    id: "test-submission-id",
    fileHash: makeHash("test file contents"),
    submittedAt: 1700000000000,
    status: "committed",
    batchId: 1,
    merkleRoot: makeHash("merkle root"),
    proof: [makeHash("sibling1"), makeHash("sibling2")],
    transactionHash: "0x" + "a".repeat(64),
    blockNumber: 12345,
    blockTimestamp: 1700000000,
    ...overrides,
  };
}

function makeValidPayload(overrides: Partial<CertificatePayload> = {}): CertificatePayload {
  return {
    version: 1,
    fileHash: makeHash("test file"),
    merkleRoot: makeHash("root"),
    proof: [makeHash("sibling")],
    batchId: 1,
    transactionHash: "0x" + "a".repeat(64),
    blockNumber: 12345,
    blockTimestamp: 1700000000,
    contractAddress: "0x" + "b".repeat(40),
    chainId: 31337,
    issuedAt: Date.now(),
    ...overrides,
  };
}

// -----------------------------------------------------------------------------
// generateCertificate
// -----------------------------------------------------------------------------

describe("generateCertificate", () => {
  test("returns a Buffer for a committed submission", async () => {
    const submission = makeCommittedSubmission();
    const pdf = await generateCertificate(submission);
    expect(Buffer.isBuffer(pdf)).toBe(true);
  });

  test("returns a non-empty buffer", async () => {
    const submission = makeCommittedSubmission();
    const pdf = await generateCertificate(submission);
    expect(pdf.length).toBeGreaterThan(0);
  });

  test("output starts with PDF magic bytes", async () => {
    const submission = makeCommittedSubmission();
    const pdf = await generateCertificate(submission);
    // All PDFs start with %PDF
    expect(pdf.slice(0, 4).toString()).toBe("%PDF");
  });

  test("throws for a pending submission", async () => {
    const submission = makeCommittedSubmission({ status: "pending" });
    await expect(generateCertificate(submission)).rejects.toThrow(
      'status is "pending"'
    );
  });

  test("throws for a failed submission", async () => {
    const submission = makeCommittedSubmission({ status: "failed" });
    await expect(generateCertificate(submission)).rejects.toThrow(
      'status is "failed"'
    );
  });

  test("generates certificate for single-file batch (empty proof)", async () => {
    const submission = makeCommittedSubmission({ proof: [] });
    const pdf = await generateCertificate(submission);
    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.length).toBeGreaterThan(0);
  });

  test("generates certificate for batch with multiple proof siblings", async () => {
    const submission = makeCommittedSubmission({
      proof: [makeHash("s1"), makeHash("s2"), makeHash("s3")],
    });
    const pdf = await generateCertificate(submission);
    expect(Buffer.isBuffer(pdf)).toBe(true);
  });

  test("generates different PDFs for different submissions", async () => {
    const s1 = makeCommittedSubmission({ fileHash: makeHash("file1") });
    const s2 = makeCommittedSubmission({ fileHash: makeHash("file2") });
    const pdf1 = await generateCertificate(s1);
    const pdf2 = await generateCertificate(s2);
    expect(pdf1.equals(pdf2)).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// parsePayload
// -----------------------------------------------------------------------------

describe("parsePayload", () => {
  test("parses a valid payload correctly", () => {
    const payload = makeValidPayload();
    const parsed = parsePayload(JSON.stringify(payload));
    expect(parsed).toEqual(payload);
  });

  test("throws for invalid JSON", () => {
    expect(() => parsePayload("not json")).toThrow("not valid JSON");
  });

  test("throws for missing fileHash", () => {
    const payload = makeValidPayload();
    const { fileHash, ...rest } = payload;
    expect(() => parsePayload(JSON.stringify(rest))).toThrow('missing field "fileHash"');
  });

  test("throws for missing merkleRoot", () => {
    const payload = makeValidPayload();
    const { merkleRoot, ...rest } = payload;
    expect(() => parsePayload(JSON.stringify(rest))).toThrow('missing field "merkleRoot"');
  });

  test("throws for missing proof", () => {
    const payload = makeValidPayload();
    const { proof, ...rest } = payload;
    expect(() => parsePayload(JSON.stringify(rest))).toThrow('missing field "proof"');
  });

  test("throws for missing transactionHash", () => {
    const payload = makeValidPayload();
    const { transactionHash, ...rest } = payload;
    expect(() => parsePayload(JSON.stringify(rest))).toThrow('missing field "transactionHash"');
  });

  test("throws for missing contractAddress", () => {
    const payload = makeValidPayload();
    const { contractAddress, ...rest } = payload;
    expect(() => parsePayload(JSON.stringify(rest))).toThrow('missing field "contractAddress"');
  });

  test("throws for empty string", () => {
    expect(() => parsePayload("")).toThrow("not valid JSON");
  });

  test("preserves proof array correctly", () => {
    const proof = [makeHash("s1"), makeHash("s2"), makeHash("s3")];
    const payload = makeValidPayload({ proof });
    const parsed = parsePayload(JSON.stringify(payload));
    expect(parsed.proof).toEqual(proof);
  });

  test("preserves all numeric fields correctly", () => {
    const payload = makeValidPayload({
      batchId: 42,
      blockNumber: 99999,
      blockTimestamp: 1800000000,
      chainId: 137,
    });
    const parsed = parsePayload(JSON.stringify(payload));
    expect(parsed.batchId).toBe(42);
    expect(parsed.blockNumber).toBe(99999);
    expect(parsed.blockTimestamp).toBe(1800000000);
    expect(parsed.chainId).toBe(137);
  });
});
