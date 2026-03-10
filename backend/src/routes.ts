import { Router, Request, Response } from "express";
import { SubmissionQueue, isValidHash, HashingMode } from "./queue";
import { Batcher } from "./batcher";
import { generateCertificate } from "./certificate";

export function createRouter(queue: SubmissionQueue, batcher: Batcher): Router {
  const router = Router();

  // ---------------------------------------------------------------------------
  // POST /submit
  // ---------------------------------------------------------------------------

  router.post("/submit", async (req: Request, res: Response) => {
    const { fileHash, hashingMode } = req.body;

    if (!fileHash) {
      return res.status(400).json({ error: "Missing required field: fileHash" });
    }

    if (!isValidHash(fileHash)) {
      return res.status(400).json({
        error: "Invalid fileHash. Expected a 0x-prefixed 32-byte hex string.",
      });
    }

    const mode: HashingMode =
      hashingMode === "content" ? "content" : "raw";

    try {
      const submission = queue.add(fileHash, mode);
      await batcher.onSubmission();

      return res.status(201).json({
        submissionId: submission.id,
        fileHash: submission.fileHash,
        status: submission.status,
        submittedAt: submission.submittedAt,
        hashingMode: submission.hashingMode,
        message: "File hash received. Your certificate will be ready after the next batch commit.",
      });
    } catch (error) {
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // ---------------------------------------------------------------------------
  // GET /submission/:id
  // ---------------------------------------------------------------------------

  router.get("/submission/:id", (req: Request, res: Response) => {
    const { id } = req.params;
    const submission = queue.get(id);

    if (!submission) {
      return res.status(404).json({ error: "Submission not found" });
    }

    const response: Record<string, unknown> = {
      submissionId: submission.id,
      fileHash: submission.fileHash,
      hashingMode: submission.hashingMode,
      status: submission.status,
      submittedAt: submission.submittedAt,
    };

    if (submission.status === "committed") {
      response.batchId = submission.batchId;
      response.merkleRoot = submission.merkleRoot;
      response.proof = submission.proof;
      response.transactionHash = submission.transactionHash;
      response.blockNumber = submission.blockNumber;
      response.blockTimestamp = submission.blockTimestamp;
    }

    return res.status(200).json(response);
  });

  // ---------------------------------------------------------------------------
  // GET /certificate/:id
  // ---------------------------------------------------------------------------

  router.get("/certificate/:id", async (req: Request, res: Response) => {
    const { id } = req.params;
    const submission = queue.get(id);

    if (!submission) {
      return res.status(404).json({ error: "Submission not found" });
    }

    if (submission.status === "pending") {
      return res.status(202).json({
        error: "Certificate not ready yet. Submission is still pending.",
        status: submission.status,
      });
    }

    if (submission.status === "failed") {
      return res.status(500).json({
        error: "Batch commit failed for this submission. Please resubmit.",
        status: submission.status,
      });
    }

    try {
      const pdf = await generateCertificate(submission);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="obsignata-certificate-${id}.pdf"`
      );
      res.setHeader("Content-Length", pdf.length);
      return res.status(200).send(pdf);
    } catch (error) {
      return res.status(500).json({ error: "Failed to generate certificate" });
    }
  });

  // ---------------------------------------------------------------------------
  // GET /health
  // ---------------------------------------------------------------------------

  router.get("/health", (_req: Request, res: Response) => {
    return res.status(200).json({
      status: "ok",
      service: "obsignata-backend",
      pendingSubmissions: queue.getPendingCount(),
      batcherRunning: batcher.running,
    });
  });

  return router;
}