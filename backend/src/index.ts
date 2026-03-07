import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { SubmissionQueue } from "./queue";
import { Batcher } from "./batcher";
import { createContractFromEnv } from "./contract";
import { createRouter } from "./routes";

dotenv.config();

// -----------------------------------------------------------------------------
// Setup
// -----------------------------------------------------------------------------

const app = express();
const PORT = process.env.PORT || 3001;
const TIME_THRESHOLD_MS = Number(process.env.BATCH_TIME_THRESHOLD_MS) || 7200000;
const VOLUME_THRESHOLD = Number(process.env.BATCH_VOLUME_THRESHOLD) || 500;

app.use(cors({
  origin: process.env.CORS_ORIGIN || "http://localhost:3000",
  methods: ["GET", "POST"],
}));
app.use(express.json());

// -----------------------------------------------------------------------------
// Dependencies
// -----------------------------------------------------------------------------

const queue = new SubmissionQueue();

const contract = createContractFromEnv();

const batcher = new Batcher(queue, {
  timeThresholdMs: TIME_THRESHOLD_MS,
  volumeThreshold: VOLUME_THRESHOLD,
  commitFn: (merkleRoot) => contract.commitBatch(merkleRoot),
  onCommit: (result) => {
    console.log(`[Obsignata] Batch #${result.batchId} committed — ${result.submissionCount} files, tx: ${result.transactionHash}`);
  },
  onError: (error, submissions) => {
    console.error(`[Obsignata] Batch commit failed for ${submissions.length} submissions:`, error.message);
  },
});

// -----------------------------------------------------------------------------
// Routes
// -----------------------------------------------------------------------------

app.use(createRouter(queue, batcher));

// -----------------------------------------------------------------------------
// Start
// -----------------------------------------------------------------------------

app.listen(PORT, () => {
  console.log(`[Obsignata] Backend running on port ${PORT}`);
  console.log(`[Obsignata] RPC URL: ${process.env.RPC_URL}`);
  console.log(`[Obsignata] Contract: ${process.env.CONTRACT_ADDRESS}`);
  console.log(`[Obsignata] Batch time threshold: ${TIME_THRESHOLD_MS}ms`);
  console.log(`[Obsignata] Batch volume threshold: ${VOLUME_THRESHOLD} submissions`);
  batcher.start();
  console.log(`[Obsignata] Batcher started`);
});