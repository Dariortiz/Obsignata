import { hashFile, hashFilePdfContent, formatFileSize } from "../lib/hash";
import { useState, useCallback } from "react";

import { submitHash, getCertificateUrl } from "../lib/api";
import { useSubmissionPoller } from "../hooks/useSubmissionPoller";
import { SubmissionResponse } from "../lib/types";

// -----------------------------------------------------------------------------
// Committed submission record — shown persistently above the form
// -----------------------------------------------------------------------------

function CommittedRecord({ submission }: { submission: SubmissionResponse }) {
  const [copied, setCopied] = useState(false);

  const copyId = () => {
    navigator.clipboard.writeText(submission.submissionId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadTxt = () => {
    const lines = [
      "OBSIGNATA SUBMISSION RECORD",
      "===========================",
      "",
      `Submission ID:   ${submission.submissionId}`,
      `File Hash:       ${submission.fileHash}`,
      `Status:          ${submission.status}`,
      `Submitted At:    ${new Date(submission.submittedAt).toUTCString()}`,
      ...(submission.batchId !== undefined
        ? [
            "",
            `Batch ID:        #${submission.batchId}`,
            `Merkle Root:     ${submission.merkleRoot}`,
            `Transaction:     ${submission.transactionHash}`,
            `Block Number:    ${submission.blockNumber}`,
            `Block Time:      ${new Date(submission.blockTimestamp! * 1000).toUTCString()}`,
          ]
        : []),
      "",
      "Use your Submission ID to download your certificate at any time.",
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `obsignata-${submission.submissionId.slice(0, 8)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      className={`status-box ${submission.status}`}
      style={{ marginBottom: 16 }}
    >
      <div className="status-header">
        <div className={`status-dot ${submission.status}`} />
        <span className="status-title">
          {submission.status === "pending" && "Waiting for next batch commit"}
          {submission.status === "committed" && "Committed to blockchain"}
          {submission.status === "failed" && "Batch commit failed"}
        </span>
      </div>

      <div className="status-meta">
        {/* Full submission ID with copy + download */}
        <div className="status-row" style={{ alignItems: "flex-start" }}>
          <span className="status-key">Submission ID</span>
          <div style={{ flex: 1 }}>
            <div
              className="status-val"
              style={{ wordBreak: "break-all", marginBottom: 8 }}
            >
              {submission.submissionId}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                className="btn btn-secondary"
                style={{ padding: "4px 12px", fontSize: "0.75rem" }}
                onClick={copyId}
              >
                {copied ? "✓ Copied" : "Copy ID"}
              </button>
              <button
                className="btn btn-secondary"
                style={{ padding: "4px 12px", fontSize: "0.75rem" }}
                onClick={downloadTxt}
              >
                Save as .txt
              </button>
            </div>
          </div>
        </div>

        <div className="status-row">
          <span className="status-key">File hash</span>
          <span className="status-val" style={{ wordBreak: "break-all" }}>
            {submission.fileHash}
          </span>
        </div>

        {submission.batchId !== undefined && (
          <div className="status-row">
            <span className="status-key">Batch</span>
            <span className="status-val">#{submission.batchId}</span>
          </div>
        )}
        {submission.transactionHash && (
          <div className="status-row">
            <span className="status-key">Tx hash</span>
            <span className="status-val" style={{ wordBreak: "break-all" }}>
              {submission.transactionHash}
            </span>
          </div>
        )}
        {submission.blockTimestamp && (
          <div className="status-row">
            <span className="status-key">Block time</span>
            <span className="status-val">
              {new Date(submission.blockTimestamp * 1000).toUTCString()}
            </span>
          </div>
        )}
        {submission.status === "pending" && (
          <div className="status-row">
            <span className="status-key">Next check</span>
            <span className="status-val">Polling every 30 seconds</span>
          </div>
        )}
      </div>

      {submission.status === "committed" && (
        <a
          href={getCertificateUrl(submission.submissionId)}
          download={`obsignata-certificate-${submission.submissionId}.pdf`}
          className="btn btn-primary"
          style={{
            textDecoration: "none",
            marginTop: 16,
            display: "inline-flex",
          }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
            />
          </svg>
          Download Certificate
        </a>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Pending submission — polls until terminal state
// -----------------------------------------------------------------------------

function PendingSubmission({ submissionId }: { submissionId: string }) {
  const { submission } = useSubmissionPoller(submissionId);
  if (!submission) return null;
  return <CommittedRecord submission={submission} />;
}

// -----------------------------------------------------------------------------
// Main stamp view
// -----------------------------------------------------------------------------

export function StampView() {
  const [file, setFile] = useState<File | null>(null);
  const [fileHash, setFileHash] = useState<string | null>(null);
  const [hashing, setHashing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submissionId, setSubmissionId] = useState<string | null>(null);
  const [submittedSnapshot, setSubmittedSnapshot] =
    useState<SubmissionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [hashingMode, setHashingMode] = useState<"raw" | "content">("raw");
  const [isPdf, setIsPdf] = useState(false);

  // Past submissions shown above the form
  const [history, setHistory] = useState<
    { id: string; snapshot: SubmissionResponse }[]
  >([]);

  const isPdfFile = (f: File) =>
    f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf");

  const computeHash = useCallback(async (f: File, mode: "raw" | "content") => {
    setHashing(true);
    setFileHash(null);
    setError(null);
    try {
      const hash =
        mode === "content" && isPdfFile(f)
          ? await hashFilePdfContent(f)
          : await hashFile(f);
      setFileHash(hash);
    } catch {
      setError("Failed to hash file.");
    } finally {
      setHashing(false);
    }
  }, []);

  const handleFile = useCallback(
    async (f: File) => {
      setFile(f);
      setFileHash(null);
      setSubmissionId(null);
      setSubmittedSnapshot(null);
      setError(null);
      const pdf = isPdfFile(f);
      setIsPdf(pdf);
      const mode = "raw";
      setHashingMode(mode);
      await computeHash(f, mode);
    },
    [computeHash],
  );

  const handleModeChange = async (mode: "raw" | "content") => {
    setHashingMode(mode);
    if (file) await computeHash(file, mode);
  };

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const f = e.dataTransfer.files[0];
      if (f) handleFile(f);
    },
    [handleFile],
  );

  const handleSubmit = async () => {
    if (!fileHash || !file) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await submitHash(fileHash, hashingMode);
      setSubmissionId(res.submissionId);
      setSubmittedSnapshot({ ...res, fileHash });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submission failed.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleTimestampAnother = () => {
    if (submissionId && submittedSnapshot) {
      setHistory((h) => [
        ...h,
        { id: submissionId, snapshot: submittedSnapshot },
      ]);
    }
    setFile(null);
    setFileHash(null);
    setSubmissionId(null);
    setSubmittedSnapshot(null);
    setError(null);
    setIsPdf(false);
    setHashingMode("raw");
  };

  const submitted = !!submissionId;

  return (
    <div>
      {/* Past submissions */}
      {history.map(({ id }) => (
        <PendingSubmission key={id} submissionId={id} />
      ))}

      {/* Current submission status */}
      {submissionId && submittedSnapshot && (
        <PendingSubmission submissionId={submissionId} />
      )}

      {/* Single card: file selection + submit */}
      {!submitted && (
        <div className="card">
          <div className="card-title">01 — Select & Timestamp</div>

          {!file ? (
            <label
              className={`dropzone${dragging ? " dragging" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
            >
              <input
                type="file"
                onChange={(e) =>
                  e.target.files?.[0] && handleFile(e.target.files[0])
                }
              />
              <svg
                className="dropzone-icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
                />
              </svg>
              <p className="dropzone-text">
                <strong>Drop your document here</strong> or click to browse
              </p>
              <p className="dropzone-hint">
                Any file type · Hash computed locally · Document never uploaded
              </p>
            </label>
          ) : (
            <>
              <div className="file-info">
                <svg
                  className="file-info-icon"
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
                  />
                </svg>
                <span className="file-info-name">{file.name}</span>
                <span className="file-info-size">
                  {formatFileSize(file.size)}
                </span>
                <button
                  className="btn btn-secondary"
                  style={{ padding: "4px 10px", fontSize: "0.75rem" }}
                  onClick={() => {
                    setFile(null);
                    setFileHash(null);
                    setError(null);
                  }}
                >
                  Change
                </button>
              </div>

              {hashing && (
                <div className="hash-display">
                  <div className="hash-label">Computing keccak256 hash</div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      marginTop: 4,
                    }}
                  >
                    <div
                      className="spinner"
                      style={{ borderTopColor: "var(--accent)" }}
                    />
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: "0.75rem",
                        color: "var(--text-muted)",
                      }}
                    >
                      Hashing locally…
                    </span>
                  </div>
                </div>
              )}

              {fileHash && (
                <>
                  <div className="hash-display">
                    <div className="hash-label">
                      keccak256 hash
                      {hashingMode === "content" && (
                        <span
                          style={{
                            marginLeft: 8,
                            fontSize: "0.7rem",
                            color: "var(--accent)",
                            fontFamily: "var(--font-sans)",
                            fontWeight: 400,
                          }}
                        >
                          content only
                        </span>
                      )}
                    </div>
                    <div className="hash-value">{fileHash}</div>
                  </div>

                  {isPdf && (
                    <div
                      style={{
                        marginTop: 12,
                        padding: "10px 14px",
                        borderRadius: "var(--radius)",
                        border: "1px solid var(--border-light)",
                        background: "var(--bg-raised)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 12,
                      }}
                    >
                      <div>
                        <span
                          style={{
                            fontSize: "0.8rem",
                            color: "var(--text)",
                            fontWeight: 500,
                          }}
                        >
                          PDF detected
                        </span>
                        <span
                          style={{
                            fontSize: "0.78rem",
                            color: "var(--text-muted)",
                            marginLeft: 8,
                          }}
                        >
                          {hashingMode === "content"
                            ? "Hashing text content only — metadata changes won't affect the hash."
                            : "Content-only mode recommended — PDF metadata can change silently."}
                        </span>
                      </div>
                      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                        <button
                          className={`btn ${hashingMode === "raw" ? "btn-primary" : "btn-secondary"}`}
                          style={{ padding: "4px 12px", fontSize: "0.75rem" }}
                          onClick={() => handleModeChange("raw")}
                          disabled={hashing}
                        >
                          Raw
                        </button>
                        <button
                          className={`btn ${hashingMode === "content" ? "btn-primary" : "btn-secondary"}`}
                          style={{ padding: "4px 12px", fontSize: "0.75rem" }}
                          onClick={() => handleModeChange("content")}
                          disabled={hashing}
                        >
                          Content
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="divider" />

                  <p className="text-muted" style={{ marginBottom: 16 }}>
                    Only the hash above will be sent to the server. Your
                    document stays on your machine and will be included in the
                    next batch commit to the blockchain.
                  </p>

                  {error && (
                    <div
                      className="status-box failed"
                      style={{ marginBottom: 16 }}
                    >
                      <p
                        style={{
                          fontFamily: "var(--font-mono)",
                          fontSize: "0.8rem",
                          color: "var(--error)",
                        }}
                      >
                        {error}
                      </p>
                    </div>
                  )}

                  <button
                    className="btn btn-primary btn-full"
                    onClick={handleSubmit}
                    disabled={submitting}
                  >
                    {submitting ? (
                      <>
                        <div className="spinner" /> Submitting…
                      </>
                    ) : (
                      "Timestamp this file →"
                    )}
                  </button>
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* Timestamp another file button */}
      {submitted && (
        <button
          className="btn btn-secondary btn-full"
          style={{ marginTop: 16 }}
          onClick={handleTimestampAnother}
        >
          + Timestamp another file
        </button>
      )}
    </div>
  );
}
