import { useState } from "react";
import { getSubmission, getCertificateUrl } from "../lib/api";
import { SubmissionResponse } from "../lib/types";
import { useSubmissionPoller } from "../hooks/useSubmissionPoller";

// -----------------------------------------------------------------------------
// Retrieve view — look up a submission by ID and download its certificate
// -----------------------------------------------------------------------------

export function RetrieveView() {
  const [input, setInput] = useState("");
  const [lookupId, setLookupId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [initialSnapshot, setInitialSnapshot] = useState<SubmissionResponse | null>(null);

  const { submission } = useSubmissionPoller(
    initialSnapshot?.status === "pending" ? lookupId : null
  );

  const current = submission ?? initialSnapshot;

  const handleRetrieve = async () => {
    const id = input.trim();
    if (!id) return;

    setLoading(true);
    setError(null);
    setLookupId(null);
    setInitialSnapshot(null);

    try {
      const data = await getSubmission(id);
      setLookupId(id);
      setInitialSnapshot(data);
    } catch (err) {
      setError(
        err instanceof Error && err.message.includes("404")
          ? "Submission not found. The ID may be incorrect, or the server may have restarted and lost this record. If you have the certificate PDF, use the Verify tab instead."
          : err instanceof Error ? err.message : "Lookup failed."
      );
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setInput("");
    setLookupId(null);
    setInitialSnapshot(null);
    setError(null);
  };

  const [copied, setCopied] = useState(false);
  const copyId = () => {
    if (!lookupId) return;
    navigator.clipboard.writeText(lookupId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadTxt = () => {
    if (!current || !lookupId) return;
    const lines = [
      "OBSIGNATA SUBMISSION RECORD",
      "===========================",
      "",
      `Submission ID:   ${lookupId}`,
      `File Hash:       ${current.fileHash}`,
      `Status:          ${current.status}`,
      `Submitted At:    ${new Date(current.submittedAt).toUTCString()}`,
      ...(current.batchId !== undefined ? [
        "",
        `Batch ID:        #${current.batchId}`,
        `Merkle Root:     ${current.merkleRoot}`,
        `Transaction:     ${current.transactionHash}`,
        `Block Number:    ${current.blockNumber}`,
        `Block Time:      ${new Date(current.blockTimestamp! * 1000).toUTCString()}`,
      ] : []),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `obsignata-${lookupId.slice(0, 8)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div className="card">
        <div className="card-title">01 — Enter Submission ID</div>
        <p className="text-muted" style={{ marginBottom: 20 }}>
          Paste the submission ID you received when you timestamped your file.
          If your batch has been committed, you can download your certificate here.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, width: "100%" }}>
          <input
            type="text"
            className="id-input"
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleRetrieve()}
            disabled={loading}
            style={{
              width: "100%",
              height: 48,
              borderRadius: "var(--radius)",
              textAlign: "center",
              fontSize: "0.95rem",
              boxSizing: "border-box",
              background: "var(--bg-raised)",
              color: "var(--text)",
              border: "1px solid var(--border-light)",
            }}
          />
          <button
            className="btn btn-primary btn-full"
            onClick={handleRetrieve}
            disabled={!input.trim() || loading}
            style={{ marginTop: 0 }}
          >
            {loading ? <><div className="spinner" /> Looking up…</> : "Retrieve →"}
          </button>
        </div>

        {error && (
          <div className="status-box failed" style={{ marginTop: 16 }}>
            <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.8rem", color: "var(--error)" }}>
              {error}
            </p>
          </div>
        )}
      </div>

      {current && lookupId && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-title">02 — Status</div>

          <div className={`status-box ${current.status}`}>
            <div className="status-header">
              <div className={`status-dot ${current.status}`} />
              <span className="status-title">
                {current.status === "pending" && "Waiting for next batch commit"}
                {current.status === "committed" && "Committed to blockchain"}
                {current.status === "failed" && "Batch commit failed"}
              </span>
            </div>

            <div className="status-meta">
              <div className="status-row" style={{ alignItems: "flex-start" }}>
                <span className="status-key">Submission ID</span>
                <div style={{ flex: 1 }}>
                  <div className="status-val" style={{ wordBreak: "break-all", marginBottom: 8 }}>
                    {lookupId}
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      onClick={copyId}
                      title={copied ? "Copied!" : "Copy to clipboard"}
                      style={{
                        background: "none", border: "none", cursor: "pointer",
                        padding: "2px", color: copied ? "var(--accent)" : "var(--text-muted)",
                        transition: "color 0.2s",
                      }}
                    >
                      {copied ? (
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <polyline points="20 6 9 17 4 12" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      ) : (
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" strokeLinecap="round"/>
                        </svg>
                      )}
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
                <span className="status-val" style={{ wordBreak: "break-all" }}>{current.fileHash}</span>
              </div>

              {current.batchId !== undefined && (
                <div className="status-row">
                  <span className="status-key">Batch</span>
                  <span className="status-val">#{current.batchId}</span>
                </div>
              )}
              {current.transactionHash && (
                <div className="status-row">
                  <span className="status-key">Tx hash</span>
                  <span className="status-val" style={{ wordBreak: "break-all" }}>{current.transactionHash}</span>
                </div>
              )}
              {current.blockTimestamp && (
                <div className="status-row">
                  <span className="status-key">Block time</span>
                  <span className="status-val">
                    {new Date(current.blockTimestamp * 1000).toUTCString()}
                  </span>
                </div>
              )}
              {current.status === "pending" && (
                <div className="status-row">
                  <span className="status-key">Next check</span>
                  <span className="status-val">Polling every 30 seconds</span>
                </div>
              )}
            </div>

            {current.status === "committed" && (
              <a
                href={getCertificateUrl(lookupId)}
                download={`obsignata-certificate-${lookupId}.pdf`}
                className="btn btn-primary"
                style={{ textDecoration: "none", marginTop: 16, display: "inline-flex" }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                </svg>
                Download Certificate
              </a>
            )}

            {current.status === "failed" && (
              <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.8rem", color: "var(--error)", marginTop: 12 }}>
                The batch commit failed for this submission. Please resubmit your file hash from the Timestamp tab.
              </p>
            )}
          </div>

          <button
            className="btn btn-secondary"
            style={{ marginTop: 16 }}
            onClick={handleReset}
          >
            Look up another submission
          </button>
        </div>
      )}
    </div>
  );
}