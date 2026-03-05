import { ethers } from "ethers";

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/**
 * The result of building a Merkle tree.
 * Layers are stored bottom-up: layers[0] is the leaf layer, layers[last] is [root].
 */
export interface MerkleTree {
    root: string;
    layers: string[][];
}

/**
 * The result of generating a proof for a leaf.
 */
export interface MerkleProof {
    leaf: string;
    proof: string[];
    root: string;
    index: number;
}

// -----------------------------------------------------------------------------
// Core hashing
// -----------------------------------------------------------------------------

/**
 * Hashes a pair of nodes using sorted pair keccak256 — the smaller hash always
 * goes first. This matches the contract's _computeRoot convention exactly,
 * meaning proofs generated here will verify correctly on-chain.
 */
function hashPair(a: string, b: string): string {
    const [left, right] = a <= b ? [a, b] : [b, a];
    return ethers.keccak256(
        ethers.solidityPacked(["bytes32", "bytes32"], [left, right]),
    );
}

// -----------------------------------------------------------------------------
// Tree building
// -----------------------------------------------------------------------------

/**
 * Builds a Merkle tree from an array of leaf hashes.
 *
 * Handles edge cases:
 * - Single leaf: root equals the leaf itself
 * - Odd number of leaves: last leaf is duplicated to make the layer even
 *
 * @param leaves Array of keccak256 hashes (hex strings) representing files.
 * @returns MerkleTree containing the root and all layers bottom-up.
 * @throws If no leaves are provided.
 */
export function buildTree(leaves: string[]): MerkleTree {
    if (leaves.length === 0) {
        throw new Error("Cannot build a Merkle tree with no leaves.");
    }

    // Single leaf edge case — root is the leaf itself, no hashing needed
    if (leaves.length === 1) {
        return {
            root: leaves[0],
            layers: [[leaves[0]]],
        };
    }

    const layers: string[][] = [];

    // Pad to even number by duplicating last leaf if necessary
    let currentLayer =
        leaves.length % 2 === 0
            ? [...leaves]
            : [...leaves, leaves[leaves.length - 1]];

    layers.push(currentLayer);

    // Build tree bottom-up until we reach the root
    while (currentLayer.length > 1) {
        const nextLayer: string[] = [];

        for (let i = 0; i < currentLayer.length; i += 2) {
            nextLayer.push(hashPair(currentLayer[i], currentLayer[i + 1]));
        }

        // Pad next layer if odd (can happen in multi-level trees)
        if (nextLayer.length > 1 && nextLayer.length % 2 !== 0) {
            nextLayer.push(nextLayer[nextLayer.length - 1]);
        }

        layers.push(nextLayer);
        currentLayer = nextLayer;
    }

    return {
        root: currentLayer[0],
        layers,
    };
}

// -----------------------------------------------------------------------------
// Proof generation
// -----------------------------------------------------------------------------

/**
 * Generates a Merkle proof path for the leaf at the given index.
 * The proof is an array of sibling hashes from the leaf up to (not including) the root.
 *
 * @param tree The MerkleTree returned by buildTree.
 * @param index The index of the leaf to generate a proof for.
 * @returns MerkleProof containing the leaf, proof path, root, and index.
 * @throws If the index is out of bounds.
 */
export function getProof(tree: MerkleTree, index: number): MerkleProof {
    const leafLayer = tree.layers[0];

    if (index < 0 || index >= leafLayer.length) {
        throw new Error(
            `Leaf index ${index} is out of bounds. Tree has ${leafLayer.length} leaves.`,
        );
    }

    const proof: string[] = [];
    let currentIndex = index;

    for (let i = 0; i < tree.layers.length - 1; i++) {
        const layer = tree.layers[i];
        const siblingIndex =
            currentIndex % 2 === 0 ? currentIndex + 1 : currentIndex - 1;

        // Sibling must exist — padding guarantees it
        proof.push(layer[siblingIndex]);
        currentIndex = Math.floor(currentIndex / 2);
    }

    return {
        leaf: leafLayer[index],
        proof,
        root: tree.root,
        index,
    };
}

// -----------------------------------------------------------------------------
// Proof verification
// -----------------------------------------------------------------------------

/**
 * Verifies that a leaf is included in a Merkle tree by recomputing the root
 * from the leaf and its proof path, then comparing against the expected root.
 *
 * Uses the same sorted pair hashing as buildTree and the contract, so a proof
 * generated here will also verify correctly when passed to the smart contract.
 *
 * @param leaf The keccak256 hash of the file being verified.
 * @param proof The sibling hashes from the leaf up to the root.
 * @param root The expected Merkle root to verify against.
 * @returns True if the leaf is included in the tree, false otherwise.
 */
export function verifyProof(
    leaf: string,
    proof: string[],
    root: string,
): boolean {
    if (proof.length === 0) {
        // Single leaf tree — root equals the leaf
        return leaf === root;
    }

    let computed = leaf;
    for (const sibling of proof) {
        computed = hashPair(computed, sibling);
    }

    return computed === root;
}

// -----------------------------------------------------------------------------
// Convenience: hash a file buffer
// -----------------------------------------------------------------------------

/**
 * Hashes a file's raw bytes using keccak256.
 * This is the same operation the frontend performs before sending a hash to the backend.
 *
 * @param buffer The raw file contents as a Buffer or Uint8Array.
 * @returns The keccak256 hash as a hex string.
 */
export function hashFile(buffer: Buffer | Uint8Array): string {
    return ethers.keccak256(buffer);
}
