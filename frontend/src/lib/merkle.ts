import { ethers } from "ethers";

/**
 * Recomputes a Merkle root from a leaf hash and a proof path.
 * Must match exactly the sorted-pair convention used in the backend and contract.
 *
 * @param leaf    The keccak256 hash of the file.
 * @param proof   The sibling hashes from the certificate payload.
 * @returns       The recomputed Merkle root.
 */
export function computeRoot(leaf: string, proof: string[]): string {
  let current = leaf;

  for (const sibling of proof) {
    // Sort: smaller hash always goes first — must match backend convention
    const [a, b] = [current, sibling].sort();
    current = ethers.keccak256(
      ethers.solidityPacked(["bytes32", "bytes32"], [a, b])
    );
  }

  return current;
}
