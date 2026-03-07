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

export interface SubmissionResponse {
  submissionId: string;
  status: "pending" | "committed" | "failed";
  submittedAt: number;
  message?: string;
  batchId?: number;
  merkleRoot?: string;
  proof?: string[];
  transactionHash?: string;
  blockNumber?: number;
  blockTimestamp?: number;
}

export type AppView = "stamp" | "verify" | "retrieve";