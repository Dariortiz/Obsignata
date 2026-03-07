import { ethers } from "ethers";
import { CommitResult } from "./batcher";

// -----------------------------------------------------------------------------
// ABI — only the functions we need
// -----------------------------------------------------------------------------

const TIMESTAMPER_ABI = [
  "function commitBatch(bytes32 merkleRoot) external returns (uint256 batchId)",
  "function verify(bytes32 leafHash, bytes32[] calldata proof, uint256 batchId) external view returns (bool valid, uint256 timestamp)",
  "function getBatch(uint256 batchId) external view returns (tuple(bytes32 merkleRoot, uint64 timestamp, uint16 version))",
  "function batchCount() external view returns (uint256)",
  "event BatchCommitted(uint256 indexed batchId, bytes32 indexed merkleRoot, uint64 timestamp, uint16 version)",
];

// -----------------------------------------------------------------------------
// Contract client
// -----------------------------------------------------------------------------

/**
 * Wraps ethers.js contract interaction for the Timestamper contract.
 * Handles provider setup, signing, and transaction confirmation.
 */
export class TimestamperContract {
  private contract: ethers.Contract;
  private provider: ethers.JsonRpcProvider;

  constructor(rpcUrl: string, privateKey: string, contractAddress: string) {
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(privateKey, this.provider);
    this.contract = new ethers.Contract(contractAddress, TIMESTAMPER_ABI, wallet);
  }

  /**
   * Commits a Merkle root to the contract and waits for confirmation.
   * @param merkleRoot The 32-byte Merkle root to commit.
   * @returns CommitResult with on-chain data from the confirmed transaction.
   */
  async commitBatch(merkleRoot: string): Promise<CommitResult> {
    // Read batchCount before commit — new batchId will be batchCount after commit
    const batchCountBefore = Number(await this.contract.batchCount());

    const tx = await this.contract.commitBatch(merkleRoot);

    // Poll for receipt directly — avoids Hardhat/ethers v6 tx.wait() log issues
    let receipt = null;
    for (let attempt = 0; attempt < 30; attempt++) {
      receipt = await this.provider.getTransactionReceipt(tx.hash);
      if (receipt) break;
      await new Promise((r) => setTimeout(r, 500));
    }

    if (!receipt) throw new Error("Transaction receipt not found after 15 seconds");
    if (receipt.status === 0) throw new Error("Transaction reverted on-chain");

    // Derive batchId from batchCount — simpler than parsing logs
    const batchCountAfter = Number(await this.contract.batchCount());
    if (batchCountAfter !== batchCountBefore + 1) {
      throw new Error(`Unexpected batch count: expected ${batchCountBefore + 1}, got ${batchCountAfter}`);
    }

    const batchId = batchCountAfter;

    const block = await this.provider.getBlock(receipt.blockNumber);
    if (!block) throw new Error("Could not fetch block data");

    return {
      batchId,
      transactionHash: receipt.hash,
      blockNumber: receipt.blockNumber,
      blockTimestamp: block.timestamp,
    };
  }

  /**
   * Returns the current batch count from the contract.
   * Useful for health checks and status endpoints.
   */
  async getBatchCount(): Promise<number> {
    const count = await this.contract.batchCount();
    return Number(count);
  }
}

// -----------------------------------------------------------------------------
// Factory
// -----------------------------------------------------------------------------

/**
 * Creates a TimestamperContract instance from environment variables.
 * Throws clearly if any required variable is missing.
 */
export function createContractFromEnv(): TimestamperContract {
  const rpcUrl = process.env.RPC_URL;
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
  const contractAddress = process.env.CONTRACT_ADDRESS;

  if (!rpcUrl) throw new Error("Missing environment variable: RPC_URL");
  if (!privateKey) throw new Error("Missing environment variable: DEPLOYER_PRIVATE_KEY");
  if (!contractAddress) throw new Error("Missing environment variable: CONTRACT_ADDRESS");

  return new TimestamperContract(rpcUrl, privateKey, contractAddress);
}