import { SubmissionResponse } from "./types";

const BASE_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:3001";

export async function submitHash(fileHash: string): Promise<SubmissionResponse> {
  const res = await fetch(`${BASE_URL}/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileHash }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Submit failed: ${res.status}`);
  }
  return res.json();
}

export async function getSubmission(id: string): Promise<SubmissionResponse> {
  const res = await fetch(`${BASE_URL}/submission/${id}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Fetch failed: ${res.status}`);
  }
  return res.json();
}

export function getCertificateUrl(id: string): string {
  return `${BASE_URL}/certificate/${id}`;
}
