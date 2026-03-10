import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { Submission, SubmissionStatus, HashingMode } from "./queue";

// -----------------------------------------------------------------------------
// Database setup
// -----------------------------------------------------------------------------

const DB_DIR = process.env.DB_DIR || path.join(__dirname, "../data");
const DB_PATH = path.join(DB_DIR, "obsignata.db");

// Ensure data directory exists
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
db.pragma("journal_mode = WAL");

// -----------------------------------------------------------------------------
// Schema
// -----------------------------------------------------------------------------

db.exec(`
  CREATE TABLE IF NOT EXISTS submissions (
    id              TEXT PRIMARY KEY,
    file_hash       TEXT NOT NULL,
    hashing_mode    TEXT NOT NULL DEFAULT 'raw',
    submitted_at    INTEGER NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending',
    batch_id        INTEGER,
    merkle_root     TEXT,
    proof           TEXT,
    transaction_hash TEXT,
    block_number    INTEGER,
    block_timestamp INTEGER
  );
`);

// -----------------------------------------------------------------------------
// Mappers
// -----------------------------------------------------------------------------

interface SubmissionRow {
  id: string;
  file_hash: string;
  hashing_mode: string;
  submitted_at: number;
  status: string;
  batch_id: number | null;
  merkle_root: string | null;
  proof: string | null;
  transaction_hash: string | null;
  block_number: number | null;
  block_timestamp: number | null;
}

function rowToSubmission(row: SubmissionRow): Submission {
  return {
    id: row.id,
    fileHash: row.file_hash,
    hashingMode: row.hashing_mode as HashingMode,
    submittedAt: row.submitted_at,
    status: row.status as SubmissionStatus,
    batchId: row.batch_id ?? undefined,
    merkleRoot: row.merkle_root ?? undefined,
    proof: row.proof ? JSON.parse(row.proof) : undefined,
    transactionHash: row.transaction_hash ?? undefined,
    blockNumber: row.block_number ?? undefined,
    blockTimestamp: row.block_timestamp ?? undefined,
  };
}

// -----------------------------------------------------------------------------
// Queries
// -----------------------------------------------------------------------------

export const queries = {
  insert: db.prepare(`
    INSERT INTO submissions (id, file_hash, hashing_mode, submitted_at, status)
    VALUES (@id, @fileHash, @hashingMode, @submittedAt, @status)
  `),

  getById: db.prepare(`
    SELECT * FROM submissions WHERE id = ?
  `),

  getPending: db.prepare(`
    SELECT * FROM submissions WHERE status = 'pending' ORDER BY submitted_at ASC
  `),

  countPending: db.prepare(`
    SELECT COUNT(*) as count FROM submissions WHERE status = 'pending'
  `),

  getAll: db.prepare(`
    SELECT * FROM submissions ORDER BY submitted_at ASC
  `),

  markCommitted: db.prepare(`
    UPDATE submissions
    SET status = 'committed',
        batch_id = @batchId,
        merkle_root = @merkleRoot,
        proof = @proof,
        transaction_hash = @transactionHash,
        block_number = @blockNumber,
        block_timestamp = @blockTimestamp
    WHERE id = @id
  `),

  markFailed: db.prepare(`
    UPDATE submissions SET status = 'failed' WHERE id = ?
  `),

  requeueFailed: db.prepare(`
    UPDATE submissions
    SET status = 'pending',
        batch_id = NULL,
        merkle_root = NULL,
        proof = NULL,
        transaction_hash = NULL,
        block_number = NULL,
        block_timestamp = NULL
    WHERE id = ?
  `),

  requeueAllFailed: db.prepare(`
    UPDATE submissions
    SET status = 'pending',
        batch_id = NULL,
        merkle_root = NULL,
        proof = NULL,
        transaction_hash = NULL,
        block_number = NULL,
        block_timestamp = NULL
    WHERE status = 'failed'
  `),

  getFailedIds: db.prepare(`
    SELECT id FROM submissions WHERE status = 'failed'
  `),

  deleteAll: db.prepare(`DELETE FROM submissions`),
};

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

export function dbInsert(submission: Submission): void {
  queries.insert.run({
    id: submission.id,
    fileHash: submission.fileHash,
    hashingMode: submission.hashingMode,
    submittedAt: submission.submittedAt,
    status: submission.status,
  });
}

export function dbGet(id: string): Submission | undefined {
  const row = queries.getById.get(id) as SubmissionRow | undefined;
  return row ? rowToSubmission(row) : undefined;
}

export function dbGetPending(): Submission[] {
  return (queries.getPending.all() as SubmissionRow[]).map(rowToSubmission);
}

export function dbCountPending(): number {
  const result = queries.countPending.get() as { count: number };
  return result.count;
}

export function dbGetAll(): Submission[] {
  return (queries.getAll.all() as SubmissionRow[]).map(rowToSubmission);
}

export function dbMarkCommitted(
  id: string,
  data: {
    batchId: number;
    merkleRoot: string;
    proof: string[];
    transactionHash: string;
    blockNumber: number;
    blockTimestamp: number;
  }
): void {
  queries.markCommitted.run({
    id,
    batchId: data.batchId,
    merkleRoot: data.merkleRoot,
    proof: JSON.stringify(data.proof),
    transactionHash: data.transactionHash,
    blockNumber: data.blockNumber,
    blockTimestamp: data.blockTimestamp,
  });
}

export function dbMarkFailed(id: string): void {
  queries.markFailed.run(id);
}

export function dbRequeueFailed(ids?: string[]): void {
  if (ids) {
    ids.forEach(id => queries.requeueFailed.run(id));
  } else {
    queries.requeueAllFailed.run();
  }
}

export function dbClear(): void {
  queries.deleteAll.run();
}

export default db;
