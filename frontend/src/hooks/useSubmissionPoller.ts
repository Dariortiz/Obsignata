import { useState, useEffect, useRef, useCallback } from "react";
import { getSubmission } from "../lib/api";
import { SubmissionResponse } from "../lib/types";

const POLL_INTERVAL_MS = 30_000;

export function useSubmissionPoller(submissionId: string | null) {
  const [submission, setSubmission] = useState<SubmissionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = useCallback(async (id: string) => {
    try {
      const data = await getSubmission(id);
      setSubmission(data);
      // Stop polling once terminal state reached
      if (data.status === "committed" || data.status === "failed") {
        if (intervalRef.current) clearInterval(intervalRef.current);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  }, []);

  useEffect(() => {
    if (!submissionId) return;
    // Immediate first poll
    poll(submissionId);
    intervalRef.current = setInterval(() => poll(submissionId), POLL_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [submissionId, poll]);

  return { submission, error };
}
