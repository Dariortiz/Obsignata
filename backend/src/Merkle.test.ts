import { ethers } from "ethers";
import { buildTree, getProof, verifyProof, hashFile } from "./merkle";

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/** Creates a deterministic leaf hash from a string, simulating a file hash. */
function makeLeaf(content: string): string {
    return ethers.keccak256(ethers.toUtf8Bytes(content));
}

/** Creates an array of n deterministic leaf hashes. */
function makeLeaves(n: number): string[] {
    return Array.from({ length: n }, (_, i) => makeLeaf(`file_${i}`));
}

// -----------------------------------------------------------------------------
// buildTree
// -----------------------------------------------------------------------------

describe("buildTree", () => {
    test("throws when given no leaves", () => {
        expect(() => buildTree([])).toThrow(
            "Cannot build a Merkle tree with no leaves.",
        );
    });

    test("single leaf: root equals the leaf itself", () => {
        const leaves = makeLeaves(1);
        const tree = buildTree(leaves);
        expect(tree.root).toBe(leaves[0]);
        expect(tree.layers).toHaveLength(1);
        expect(tree.layers[0]).toEqual(leaves);
    });

    test("two leaves: root is hash of the two leaves", () => {
        const leaves = makeLeaves(2);
        const tree = buildTree(leaves);
        expect(tree.layers).toHaveLength(2);
        expect(tree.layers[0]).toHaveLength(2);
        expect(tree.layers[1]).toHaveLength(1);
        expect(tree.root).toBe(tree.layers[1][0]);
    });

    test("odd number of leaves: last leaf is duplicated", () => {
        const leaves = makeLeaves(3);
        const tree = buildTree(leaves);
        // After padding, leaf layer should have 4 entries
        expect(tree.layers[0]).toHaveLength(4);
        expect(tree.layers[0][2]).toBe(tree.layers[0][3]);
    });

    test("even number of leaves: no padding needed", () => {
        const leaves = makeLeaves(4);
        const tree = buildTree(leaves);
        expect(tree.layers[0]).toHaveLength(4);
        expect(tree.layers[1]).toHaveLength(2);
        expect(tree.layers[2]).toHaveLength(1);
    });

    test("large even batch: 100 leaves", () => {
        const leaves = makeLeaves(100);
        const tree = buildTree(leaves);
        expect(tree.root).toBeDefined();
        expect(typeof tree.root).toBe("string");
        expect(tree.root.startsWith("0x")).toBe(true);
    });

    test("large odd batch: 99 leaves", () => {
        const leaves = makeLeaves(99);
        const tree = buildTree(leaves);
        expect(tree.root).toBeDefined();
        expect(tree.root.startsWith("0x")).toBe(true);
    });

    test("root is deterministic — same leaves always produce same root", () => {
        const leaves = makeLeaves(8);
        const tree1 = buildTree(leaves);
        const tree2 = buildTree(leaves);
        expect(tree1.root).toBe(tree2.root);
    });

    test("different leaves produce different roots", () => {
        const tree1 = buildTree(makeLeaves(4));
        const tree2 = buildTree([...makeLeaves(3), makeLeaf("different")]);
        expect(tree1.root).not.toBe(tree2.root);
    });

    test("root is a valid 32-byte hex string", () => {
        const tree = buildTree(makeLeaves(4));
        expect(tree.root).toMatch(/^0x[0-9a-f]{64}$/i);
    });
});

// -----------------------------------------------------------------------------
// getProof
// -----------------------------------------------------------------------------

describe("getProof", () => {
    test("throws for negative index", () => {
        const tree = buildTree(makeLeaves(4));
        expect(() => getProof(tree, -1)).toThrow("out of bounds");
    });

    test("throws for index beyond leaf count", () => {
        const tree = buildTree(makeLeaves(4));
        expect(() => getProof(tree, 10)).toThrow("out of bounds");
    });

    test("returns correct leaf for given index", () => {
        const leaves = makeLeaves(4);
        const tree = buildTree(leaves);
        for (let i = 0; i < leaves.length; i++) {
            const proof = getProof(tree, i);
            expect(proof.leaf).toBe(leaves[i]);
        }
    });

    test("returns correct root", () => {
        const tree = buildTree(makeLeaves(4));
        const proof = getProof(tree, 0);
        expect(proof.root).toBe(tree.root);
    });

    test("returns correct index", () => {
        const tree = buildTree(makeLeaves(4));
        for (let i = 0; i < 4; i++) {
            expect(getProof(tree, i).index).toBe(i);
        }
    });

    test("proof length is correct for power-of-2 tree", () => {
        // 8 leaves → 3 levels of proof (log2(8) = 3)
        const tree = buildTree(makeLeaves(8));
        const proof = getProof(tree, 0);
        expect(proof.proof).toHaveLength(3);
    });

    test("single leaf tree returns empty proof", () => {
        const leaves = makeLeaves(1);
        const tree = buildTree(leaves);
        const proof = getProof(tree, 0);
        expect(proof.proof).toHaveLength(0);
    });
});

// -----------------------------------------------------------------------------
// verifyProof
// -----------------------------------------------------------------------------

describe("verifyProof", () => {
    test("returns true for a valid proof — 2 leaves", () => {
        const leaves = makeLeaves(2);
        const tree = buildTree(leaves);
        for (let i = 0; i < leaves.length; i++) {
            const { leaf, proof, root } = getProof(tree, i);
            expect(verifyProof(leaf, proof, root)).toBe(true);
        }
    });

    test("returns true for a valid proof — 4 leaves", () => {
        const leaves = makeLeaves(4);
        const tree = buildTree(leaves);
        for (let i = 0; i < leaves.length; i++) {
            const { leaf, proof, root } = getProof(tree, i);
            expect(verifyProof(leaf, proof, root)).toBe(true);
        }
    });

    test("returns true for every leaf in a large tree — 64 leaves", () => {
        const leaves = makeLeaves(64);
        const tree = buildTree(leaves);
        for (let i = 0; i < leaves.length; i++) {
            const { leaf, proof, root } = getProof(tree, i);
            expect(verifyProof(leaf, proof, root)).toBe(true);
        }
    });

    test("returns true for every leaf in an odd tree — 7 leaves", () => {
        const leaves = makeLeaves(7);
        const tree = buildTree(leaves);
        for (let i = 0; i < leaves.length; i++) {
            const { leaf, proof, root } = getProof(tree, i);
            expect(verifyProof(leaf, proof, root)).toBe(true);
        }
    });

    test("returns true for single leaf — empty proof", () => {
        const leaves = makeLeaves(1);
        const tree = buildTree(leaves);
        expect(verifyProof(leaves[0], [], tree.root)).toBe(true);
    });

    test("returns false for tampered file hash", () => {
        const leaves = makeLeaves(4);
        const tree = buildTree(leaves);
        const { proof, root } = getProof(tree, 0);
        const tamperedLeaf = makeLeaf("tampered_file");
        expect(verifyProof(tamperedLeaf, proof, root)).toBe(false);
    });

    test("returns false for correct leaf with wrong proof", () => {
        const leaves = makeLeaves(4);
        const tree = buildTree(leaves);
        const { leaf } = getProof(tree, 0);
        const { proof: wrongProof, root } = getProof(tree, 1);
        expect(verifyProof(leaf, wrongProof, root)).toBe(false);
    });

    test("returns false for correct leaf and proof against wrong root", () => {
        const leaves = makeLeaves(4);
        const tree = buildTree(leaves);
        const { leaf, proof } = getProof(tree, 0);
        const wrongRoot = makeLeaf("wrong_root");
        expect(verifyProof(leaf, proof, wrongRoot)).toBe(false);
    });

    test("returns false for empty proof against multi-leaf tree", () => {
        const leaves = makeLeaves(4);
        const tree = buildTree(leaves);
        expect(verifyProof(leaves[0], [], tree.root)).toBe(false);
    });

    test("returns false for corrupted proof — one hash tampered", () => {
        const leaves = makeLeaves(8);
        const tree = buildTree(leaves);
        const { leaf, proof, root } = getProof(tree, 0);
        const corruptedProof = [...proof];
        corruptedProof[0] = makeLeaf("corrupted");
        expect(verifyProof(leaf, corruptedProof, root)).toBe(false);
    });
});

// -----------------------------------------------------------------------------
// hashFile
// -----------------------------------------------------------------------------

describe("hashFile", () => {
    test("returns a valid 32-byte hex string", () => {
        const buffer = Buffer.from("hello world");
        const hash = hashFile(buffer);
        expect(hash).toMatch(/^0x[0-9a-f]{64}$/i);
    });

    test("same input always produces same hash", () => {
        const buffer = Buffer.from("deterministic");
        expect(hashFile(buffer)).toBe(hashFile(buffer));
    });

    test("different inputs produce different hashes", () => {
        const hash1 = hashFile(Buffer.from("file_a"));
        const hash2 = hashFile(Buffer.from("file_b"));
        expect(hash1).not.toBe(hash2);
    });

    test("accepts Uint8Array as well as Buffer", () => {
        const uint8 = new Uint8Array([1, 2, 3, 4]);
        const hash = hashFile(uint8);
        expect(hash).toMatch(/^0x[0-9a-f]{64}$/i);
    });
});

// -----------------------------------------------------------------------------
// Cross-consistency: verifyProof must match buildTree
// -----------------------------------------------------------------------------

describe("Cross-consistency", () => {
    test("proof generated for one tree does not verify against a different tree", () => {
        const tree1 = buildTree(makeLeaves(4));
        // Use a completely different set of leaves to guarantee a different root
        const tree2 = buildTree([
            makeLeaf("x"),
            makeLeaf("y"),
            makeLeaf("z"),
            makeLeaf("w"),
        ]);
        const { leaf, proof } = getProof(tree1, 0);
        expect(verifyProof(leaf, proof, tree2.root)).toBe(false);
    });

    test("sorted pair hashing is consistent regardless of leaf order in pair", () => {
        // Two leaves — their order in the pair shouldn't matter because we sort
        const leaves = makeLeaves(2);
        const tree1 = buildTree([leaves[0], leaves[1]]);
        const tree2 = buildTree([leaves[1], leaves[0]]);
        // Roots will differ (leaf order matters for the tree structure)
        // but both proofs should verify against their own roots
        expect(
            verifyProof(leaves[0], getProof(tree1, 0).proof, tree1.root),
        ).toBe(true);
        expect(
            verifyProof(leaves[1], getProof(tree2, 0).proof, tree2.root),
        ).toBe(true);
    });
});
