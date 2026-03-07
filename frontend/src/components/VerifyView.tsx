import { useState } from "react";
import { ethers } from "ethers";
import { hashFile, formatFileSize } from "../lib/hash";
import { computeRoot } from "../lib/merkle";
import { extractPayloadFromPDF } from "../lib/qr";
import { CertificatePayload } from "../lib/types";

const RPC_URL = import.meta.env.VITE_RPC_URL || "http://localhost:8545";

const TIMESTAMPER_ABI = [
  "function verify(bytes32 leafHash, bytes32[] calldata proof, uint256 batchId) external view returns (bool valid, uint256 timestamp)",
];

type VerifyState =
  | { phase: "idle" }
  | { phase: "loading"; message: string }
  | { phase: "valid"; payload: CertificatePayload; timestamp: number }
  | { phase: "invalid"; reason: string }
  | { phase: "error"; message: string };

export function VerifyView() {
  const [originalFile, setOriginalFile] = useState<File | null>(null);
  const [certFile, setCertFile] = useState<File | null>(null);
  const [state, setState] = useState<VerifyState>({ phase: "idle" });

  const canVerify = originalFile && certFile && state.phase !== "loading";

  const handleVerify = async () => {
    if (!originalFile || !certFile) return;

    setState({ phase: "loading", message: "Hashing your file…" });

    try {
      // Step 1: Hash the original file
      const fileHash = await hashFile(originalFile);

      // Step 2: Extract proof payload from certificate PDF
      setState({ phase: "loading", message: "Reading certificate QR code…" });
      const payload = await extractPayloadFromPDF(certFile);

      // Step 3: Check file hash matches certificate
      if (fileHash.toLowerCase() !== payload.fileHash.toLowerCase()) {
        setState({
          phase: "invalid",
          reason: "File hash does not match the certificate. This file was not timestamped by this certificate.",
        });
        return;
      }

      // Step 4: Recompute Merkle root client-side
      setState({ phase: "loading", message: "Recomputing Merkle proof…" });
      const recomputedRoot = computeRoot(fileHash, payload.proof);

      if (recomputedRoot.toLowerCase() !== payload.merkleRoot.toLowerCase()) {
        setState({
          phase: "invalid",
          reason: "Merkle proof is invalid. The certificate data may have been tampered with.",
        });
        return;
      }

      // Step 5: Verify root on-chain via ethers.js — no backend involved
      setState({ phase: "loading", message: "Verifying on blockchain…" });
      const provider = new ethers.JsonRpcProvider(RPC_URL);
      const contract = new ethers.Contract(
        payload.contractAddress,
        TIMESTAMPER_ABI,
        provider
      );

      const [valid, timestamp]: [boolean, bigint] = await contract.verify(
        fileHash,
        payload.proof,
        payload.batchId
      );

      if (!valid) {
        setState({
          phase: "invalid",
          reason: "The Merkle proof does not verify against the on-chain root. The certificate may be fraudulent.",
        });
        return;
      }

      setState({ phase: "valid", payload, timestamp: Number(timestamp) });
    } catch (err) {
      setState({
        phase: "error",
        message: err instanceof Error ? err.message : "Verification failed.",
      });
    }
  };

  const handleReset = () => {
    setOriginalFile(null);
    setCertFile(null);
    setState({ phase: "idle" });
  };

  return (
    <div>
      <div className="card">
        <div className="card-title">01 — Upload original file</div>
        <FileDropzone
          label="Original file"
          hint="The file you want to verify"
          file={originalFile}
          onFile={setOriginalFile}
          disabled={state.phase === "loading"}
        />
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-title">02 — Upload certificate</div>
        <FileDropzone
          label="Obsignata certificate"
          hint="The PDF certificate from your timestamp"
          accept=".pdf,application/pdf"
          file={certFile}
          onFile={setCertFile}
          disabled={state.phase === "loading"}
        />
      </div>

      {(state.phase === "error") && (
        <div className="status-box failed" style={{ marginTop: 16 }}>
          <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.8rem", color: "var(--error)" }}>
            {state.message}
          </p>
        </div>
      )}

      {state.phase !== "valid" && state.phase !== "invalid" && (
        <button
          className="btn btn-primary btn-full"
          style={{ marginTop: 16 }}
          onClick={handleVerify}
          disabled={!canVerify}
        >
          {state.phase === "loading"
            ? <><div className="spinner" /> {state.message}</>
            : "Verify certificate →"
          }
        </button>
      )}

      {state.phase === "valid" && (
        <VerifyResult
          valid
          payload={state.payload}
          timestamp={state.timestamp}
          onReset={handleReset}
        />
      )}

      {state.phase === "invalid" && (
        <VerifyResult valid={false} reason={state.reason} onReset={handleReset} />
      )}
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────

function FileDropzone({
  file,
  onFile,
  hint,
  accept,
  disabled,
}: {
  label: string;
  hint: string;
  file: File | null;
  onFile: (f: File) => void;
  accept?: string;
  disabled?: boolean;
}) {
  const [dragging, setDragging] = useState(false);

  if (file) {
    return (
      <div className="file-info">
        <svg className="file-info-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
        </svg>
        <span className="file-info-name">{file.name}</span>
        <span className="file-info-size">{formatFileSize(file.size)}</span>
        {!disabled && (
          <button
            className="btn btn-secondary"
            style={{ padding: "4px 10px", fontSize: "0.75rem" }}
            onClick={(e) => {
              e.preventDefault();
              // Reset by re-rendering the dropzone — parent must handle clearing
              const input = document.createElement("input");
              input.type = "file";
              input.onchange = (ev) => {
                const f = (ev.target as HTMLInputElement).files?.[0];
                if (f) onFile(f);
              };
              input.click();
            }}
          >
            Change
          </button>
        )}
      </div>
    );
  }

  return (
    <label
      className={`dropzone${dragging ? " dragging" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const f = e.dataTransfer.files[0];
        if (f) onFile(f);
      }}
    >
      <input
        type="file"
        accept={accept}
        onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
        disabled={disabled}
      />
      <svg className="dropzone-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
      </svg>
      <p className="dropzone-text"><strong>Drop here</strong> or click to browse</p>
      <p className="dropzone-hint">{hint}</p>
    </label>
  );
}

function CopyableHash({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="status-row" style={{ alignItems: "flex-start", gap: 12 }}>
      <span className="status-key">{label}</span>
      <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "flex-start", gap: 8 }}>
        <span className="status-val" style={{ wordBreak: "break-all", flex: 1 }}>{value}</span>
        <button
          onClick={copy}
          title={copied ? "Copied!" : "Copy to clipboard"}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: "2px",
            flexShrink: 0,
            color: copied ? "var(--accent)" : "var(--text-muted)",
            transition: "color 0.2s",
            marginTop: 1,
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
      </div>
    </div>
  );
}

function VerifyResult({
  valid,
  payload,
  timestamp,
  reason,
  onReset,
}: {
  valid: boolean;
  payload?: CertificatePayload;
  timestamp?: number;
  reason?: string;
  onReset: () => void;
}) {
  return (
    <div className={`verify-result ${valid ? "valid" : "invalid"}`}>
      <span className="verify-icon">{valid ? "✓" : "✗"}</span>
      <h2 className="verify-title">
        {valid ? "Authenticity Verified" : "Verification Failed"}
      </h2>
      <p className="verify-subtitle">
        {valid
          ? "This file was included in a blockchain timestamp batch. The proof has been verified."
          : reason}
      </p>

      {valid && payload && timestamp !== undefined && (
        <div className="verify-details">
          <div className="status-row">
            <span className="status-key">Timestamp</span>
            <span className="status-val">{new Date(timestamp * 1000).toUTCString()}</span>
          </div>
          <div className="status-row">
            <span className="status-key">Batch</span>
            <span className="status-val">#{payload.batchId}</span>
          </div>
          <CopyableHash label="Tx hash" value={payload.transactionHash} />
          <CopyableHash label="File hash" value={payload.fileHash} />
          <CopyableHash label="Merkle root" value={payload.merkleRoot} />
        </div>
      )}

      <button className="btn btn-secondary" style={{ marginTop: 20 }} onClick={onReset}>
        Verify another file
      </button>
    </div>
  );
}