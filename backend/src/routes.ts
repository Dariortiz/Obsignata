import { Router, Request, Response } from "express";
import { SubmissionQueue } from "./queue";
import { Batcher } from "./batcher";
import { isValidHash } from "./queue";
import { generateCertificate } from "./certificate";

/**
 * Creates and returns the Express router with all API routes.
 * Dependencies are injected for testability.
 */
export function createRouter(queue: SubmissionQueue, batcher: Batcher): Router {
  const router = Router();

  // ---------------------------------------------------------------------------
  // POST /submit
  // Submit a file hash for timestamping.
  // ---------------------------------------------------------------------------

  router.post("/submit", async (req: Request, res: Response) => {
    const { fileHash } = req.body;

    if (!fileHash) {
      return res.status(400).json({
        error: "Missing required field: fileHash",
      });
    }

    if (!isValidHash(fileHash)) {
      return res.status(400).json({
        error: "Invalid fileHash. Expected a 0x-prefixed 32-byte hex string.",
      });
    }

    try {
      const submission = queue.add(fileHash);
      await batcher.onSubmission();

      return res.status(201).json({
        submissionId: submission.id,
        status: submission.status,
        submittedAt: submission.submittedAt,
        message:
          "File hash received. Your certificate will be ready after the next batch commit.",
      });
    } catch (error) {
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // ---------------------------------------------------------------------------
  // GET /submission/:id
  // Check the status of a submission.
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
  // Generate and download a PDF certificate for a committed submission.
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
        `attachment; filename="obsignata-certificate-${id}.pdf"`,
      );
      res.setHeader("Content-Length", pdf.length);

      return res.status(200).send(pdf);
    } catch (error) {
      return res.status(500).json({ error: "Failed to generate certificate" });
    }
  });

  // ---------------------------------------------------------------------------
  // GET /health
  // Health check endpoint.
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
