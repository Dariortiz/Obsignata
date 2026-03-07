import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import { Submission } from "./queue";

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface CertificatePayload {
  version: number;
  fileHash: string;
  merkleRoot: string;
  proof: string[];
  batchId: number;
  transactionHash: string;
  blockNumber: number;
  blockTimestamp: number;
  contractAddress: string;
  chainId: number;
  issuedAt: number;
}

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const POLYGON_CHAIN_ID = 137;
const HARDHAT_CHAIN_ID = 31337;
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS || "";
const IS_LOCAL = process.env.RPC_URL?.includes("hardhat") ?? false;
const CHAIN_ID = IS_LOCAL ? HARDHAT_CHAIN_ID : POLYGON_CHAIN_ID;
const POLYGONSCAN_BASE = IS_LOCAL ? "http://localhost:8545" : "https://polygonscan.com";

// Colors
const COLOR_PRIMARY   = "#1a1a2e";
const COLOR_ACCENT    = "#4f46e5";
const COLOR_BURGUNDY  = "#7a1828";
const COLOR_LIGHT     = "#f8f9fa";
const COLOR_BORDER    = "#e2e8f0";
const COLOR_TEXT      = "#1e293b";
const COLOR_MUTED     = "#64748b";
const COLOR_SUCCESS   = "#059669";

// Layout
const M  = 48;   // margin
const W  = 595;  // A4 width
const H  = 842;  // A4 height
const COL_LABEL = M;
const COL_VALUE = M + 150;
const VALUE_WIDTH = W - COL_VALUE - M - 210; // leave room for QR

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

export async function generateCertificate(submission: Submission): Promise<Buffer> {
  if (submission.status !== "committed") {
    throw new Error(
      `Cannot generate certificate for submission ${submission.id}: status is "${submission.status}", expected "committed".`
    );
  }

  const payload: CertificatePayload = {
    version: 1,
    fileHash: submission.fileHash,
    merkleRoot: submission.merkleRoot!,
    proof: submission.proof!,
    batchId: submission.batchId!,
    transactionHash: submission.transactionHash!,
    blockNumber: submission.blockNumber!,
    blockTimestamp: submission.blockTimestamp!,
    contractAddress: CONTRACT_ADDRESS,
    chainId: CHAIN_ID,
    issuedAt: Date.now(),
  };

  // Generate QR at high resolution for reliable scanning
  const qrBuffer = await QRCode.toBuffer(JSON.stringify(payload), {
    type: "png",
    width: 400,
    margin: 2,
    errorCorrectionLevel: "M",
  });

  return buildPDF(submission, payload, qrBuffer);
}

// -----------------------------------------------------------------------------
// PDF builder
// -----------------------------------------------------------------------------

function buildPDF(
  submission: Submission,
  payload: CertificatePayload,
  qrBuffer: Buffer
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 0,
      info: {
        Title: "Obsignata Timestamp Certificate",
        Author: "Obsignata",
        Subject: `Certificate for submission ${submission.id}`,
      },
    });

    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // ── Header ──────────────────────────────────────────────────
    doc.rect(0, 0, W, 100).fill(COLOR_PRIMARY);
    doc.rect(0, 100, W, 3).fill(COLOR_ACCENT);

    doc.font("Helvetica-Bold").fontSize(26).fillColor("#ffffff")
      .text("OBSIGNATA", M, 28);

    // Burgundy underline accent on logo
    doc.rect(M, 58, 110, 1.5).fill(COLOR_BURGUNDY);

    doc.font("Helvetica").fontSize(10).fillColor("#a5b4fc")
      .text("Blockchain Timestamp Certificate", M, 64);

    // ── Status badge ─────────────────────────────────────────────
    const ts = new Date(payload.blockTimestamp * 1000);
    doc.rect(M, 118, W - M * 2, 40).fill(COLOR_LIGHT);
    doc.rect(M, 118, W - M * 2, 40).stroke(COLOR_BORDER);

    doc.font("Helvetica-Bold").fontSize(10).fillColor(COLOR_SUCCESS)
      .text("✓  VERIFIED ON BLOCKCHAIN", M + 14, 128);

    doc.font("Helvetica").fontSize(8).fillColor(COLOR_MUTED)
      .text(
        `Block ${payload.blockNumber}  ·  ${ts.toUTCString()}  ·  Batch #${payload.batchId}`,
        M + 14, 141
      );

    // ── QR code (right column, fixed position) ───────────────────
    const qrSize = 180;
    const qrX = W - M - qrSize;
    const qrY = 172;
    doc.image(qrBuffer, qrX, qrY, { width: qrSize, height: qrSize });

    doc.font("Helvetica-Bold").fontSize(7).fillColor(COLOR_TEXT)
      .text("Scan to verify", qrX, qrY + qrSize + 6, { width: qrSize, align: "center" });

    doc.font("Helvetica").fontSize(6.5).fillColor(COLOR_MUTED)
      .text("Contains full proof payload", qrX, qrY + qrSize + 16, { width: qrSize, align: "center" });

    // ── Content ───────────────────────────────────────────────────
    let y = 172;
    const ROW = 22;

    function sectionHeading(title: string) {
      doc.font("Helvetica-Bold").fontSize(7.5).fillColor(COLOR_ACCENT)
        .text(title, COL_LABEL, y);
      y += 4;
      doc.rect(COL_LABEL, y, W - M * 2 - qrSize - 16, 0.5).fill(COLOR_BORDER);
      y += 10;
    }

    function row(label: string, value: string, mono = false) {
      doc.font("Helvetica-Bold").fontSize(7.5).fillColor(COLOR_MUTED)
        .text(label, COL_LABEL, y, { width: 140 });

      doc.font(mono ? "Courier" : "Helvetica").fontSize(7.5).fillColor(COLOR_TEXT)
        .text(value, COL_VALUE, y, { width: VALUE_WIDTH, lineGap: 1 });

      // Advance y by however tall the value text was, minimum ROW
      const valueHeight = doc.heightOfString(value, { width: VALUE_WIDTH }) + 1;
      y += Math.max(ROW, valueHeight + 4);
    }

    // File Information
    sectionHeading("FILE INFORMATION");
    row("File Hash (keccak256)", payload.fileHash, true);
    row("Submission ID", submission.id, true);
    row("Submitted", new Date(submission.submittedAt).toUTCString());

    y += 6;

    // Blockchain Proof
    sectionHeading("BLOCKCHAIN PROOF");
    row("Transaction Hash", payload.transactionHash, true);
    row("Block Number", payload.blockNumber.toString());
    row("Timestamp (UTC)", ts.toUTCString());
    row("Merkle Root", payload.merkleRoot, true);
    row("Contract Address", payload.contractAddress, true);
    row("Chain", IS_LOCAL ? "Hardhat Local (31337)" : "Polygon Mainnet (137)");

    y += 6;

    // Merkle Proof Path
    sectionHeading("MERKLE PROOF PATH");
    if (payload.proof.length === 0) {
      doc.font("Helvetica").fontSize(7.5).fillColor(COLOR_MUTED)
        .text("Single-file batch — root equals file hash, no siblings needed.", COL_LABEL, y, {
          width: VALUE_WIDTH + 140,
        });
      y += ROW;
    } else {
      payload.proof.forEach((hash, i) => {
        row(`Sibling ${i + 1}`, hash, true);
      });
    }

    // ── Verification instructions ─────────────────────────────────
    // Start below QR if needed
    y = Math.max(y + 16, qrY + qrSize + 44);

    doc.rect(M, y, W - M * 2, 0.5).fill(COLOR_BORDER);
    y += 12;

    doc.font("Helvetica-Bold").fontSize(7.5).fillColor(COLOR_ACCENT)
      .text("HOW TO VERIFY THIS CERTIFICATE INDEPENDENTLY", M, y);
    y += 14;

    const txUrl = `${POLYGONSCAN_BASE}/tx/${payload.transactionHash}`;
    const steps = [
      `1. Hash your original file using keccak256. The result must match the File Hash above.`,
      `2. Visit ${txUrl}`,
      `   Confirm the transaction exists and the BatchCommitted event's Merkle Root matches.`,
      `3. Recompute the Merkle root: starting from your file hash, hash it with each Sibling in`,
      `   the proof path above (always sort the pair — smaller hash first). The final result must`,
      `   equal the Merkle Root. If it does, your file was provably included in this batch.`,
      `4. All data needed for steps 1–3 is encoded in the QR code on this certificate.`,
    ];

    steps.forEach((step) => {
      doc.font("Helvetica").fontSize(7.5).fillColor(COLOR_TEXT)
        .text(step, M, y, { width: W - M * 2 });
      y += 12;
    });

    // ── Footer ────────────────────────────────────────────────────
    doc.rect(0, H - 40, W, 40).fill(COLOR_PRIMARY);
    doc.font("Helvetica").fontSize(7).fillColor("#a5b4fc")
      .text(
        `Obsignata  ·  obsignata.vercel.app  ·  Certificate issued ${new Date(payload.issuedAt).toUTCString()}`,
        M, H - 24, { width: W - M * 2, align: "center" }
      );

    doc.end();
  });
}

// -----------------------------------------------------------------------------
// Payload extraction
// -----------------------------------------------------------------------------

export function parsePayload(json: string): CertificatePayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("Invalid certificate payload: not valid JSON.");
  }

  const p = parsed as Record<string, unknown>;
  const required = [
    "version", "fileHash", "merkleRoot", "proof",
    "batchId", "transactionHash", "blockNumber",
    "blockTimestamp", "contractAddress", "chainId", "issuedAt",
  ];

  for (const field of required) {
    if (p[field] === undefined) {
      throw new Error(`Invalid certificate payload: missing field "${field}".`);
    }
  }

  return parsed as CertificatePayload;
}