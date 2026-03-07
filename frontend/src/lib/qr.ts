import * as pdfjsLib from "pdfjs-dist";
import jsQR from "jsqr";
import { CertificatePayload } from "./types";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.mjs",
  import.meta.url
).toString();

/**
 * Extracts and parses the Obsignata proof payload from a certificate PDF.
 * Renders the first page at high scale to ensure QR code is readable.
 */
export async function extractPayloadFromPDF(file: File): Promise<CertificatePayload> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const page = await pdf.getPage(1);

  // Try multiple scales — start high for best QR readability
  const scales = [3, 2, 4];

  for (const scale of scales) {
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d")!;

    await page.render({ canvasContext: ctx, viewport }).promise;

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(imageData.data, imageData.width, imageData.height, {
      inversionAttempts: "attemptBoth",
    });

    if (code) {
      let payload: CertificatePayload;
      try {
        payload = JSON.parse(code.data);
      } catch {
        throw new Error("QR code found but payload is not valid JSON.");
      }

      const required = [
        "fileHash", "merkleRoot", "proof", "batchId",
        "transactionHash", "blockNumber", "blockTimestamp",
        "contractAddress", "chainId",
      ];

      for (const field of required) {
        if ((payload as Record<string, unknown>)[field] === undefined) {
          throw new Error(`Certificate payload is missing field: "${field}".`);
        }
      }

      return payload;
    }
  }

  throw new Error(
    "No QR code found in certificate. Make sure you uploaded the original Obsignata certificate PDF."
  );
}