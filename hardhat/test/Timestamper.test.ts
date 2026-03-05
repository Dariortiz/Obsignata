import { expect } from "chai";
import { ethers } from "hardhat";
import { Timestamper } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Builds a minimal Merkle tree from an array of leaf hashes using sorted pair
 * hashing — matching the contract's _computeRoot convention exactly.
 * Returns the root and a proof path for the leaf at the given index.
 */
function buildMerkleTree(leaves: string[]): {
    root: string;
    getProof: (index: number) => string[];
} {
    if (leaves.length === 0) throw new Error("No leaves");

    // Pad to even number of leaves by duplicating last leaf
    let layer = [...leaves];
    if (layer.length % 2 !== 0) layer.push(layer[layer.length - 1]);

    const layers: string[][] = [layer];

    // Build tree bottom-up
    while (layer.length > 1) {
        const next: string[] = [];
        for (let i = 0; i < layer.length; i += 2) {
            const [a, b] = [layer[i], layer[i + 1]];
            // Sorted pair hashing — smaller hash first
            const pair =
                a <= b
                    ? ethers.solidityPacked(["bytes32", "bytes32"], [a, b])
                    : ethers.solidityPacked(["bytes32", "bytes32"], [b, a]);
            next.push(ethers.keccak256(pair));
        }
        layer = next;
        layers.push(layer);
    }

    const root = layers[layers.length - 1][0];

    const getProof = (index: number): string[] => {
        const proof: string[] = [];
        let idx = index;
        for (let i = 0; i < layers.length - 1; i++) {
            const siblingIdx = idx % 2 === 0 ? idx + 1 : idx - 1;
            proof.push(layers[i][siblingIdx]);
            idx = Math.floor(idx / 2);
        }
        return proof;
    };

    return { root, getProof };
}

/** Hashes a string the same way the frontend would hash a file. */
function hashFile(content: string): string {
    return ethers.keccak256(ethers.toUtf8Bytes(content));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Timestamper", function () {
    let timestamper: Timestamper;
    let owner: SignerWithAddress;
    let nonOwner: SignerWithAddress;
    let newOwner: SignerWithAddress;

    const INITIAL_VERSION = 1;

    beforeEach(async function () {
        [owner, nonOwner, newOwner] = await ethers.getSigners();
        const factory = await ethers.getContractFactory("Timestamper");
        timestamper = (await factory.deploy(INITIAL_VERSION)) as Timestamper;
        await timestamper.waitForDeployment();
    });

    // -------------------------------------------------------------------------
    // Deployment
    // -------------------------------------------------------------------------

    describe("Deployment", function () {
        it("sets the deployer as owner", async function () {
            expect(await timestamper.owner()).to.equal(owner.address);
        });

        it("sets the correct initial version", async function () {
            expect(await timestamper.currentVersion()).to.equal(
                INITIAL_VERSION,
            );
        });

        it("initializes batchCount at zero", async function () {
            expect(await timestamper.batchCount()).to.equal(0);
        });
    });

    // -------------------------------------------------------------------------
    // commitBatch
    // -------------------------------------------------------------------------

    describe("commitBatch", function () {
        let merkleRoot: string;

        beforeEach(function () {
            const leaves = [hashFile("file1"), hashFile("file2")];
            ({ root: merkleRoot } = buildMerkleTree(leaves));
        });

        it("successfully commits a root and returns batch ID 1", async function () {
            const batchId =
                await timestamper.commitBatch.staticCall(merkleRoot);
            expect(batchId).to.equal(1);
        });

        it("increments batchCount after each commit", async function () {
            const leaves2 = [hashFile("file3"), hashFile("file4")];
            const { root: root2 } = buildMerkleTree(leaves2);

            await timestamper.commitBatch(merkleRoot);
            expect(await timestamper.batchCount()).to.equal(1);

            await timestamper.commitBatch(root2);
            expect(await timestamper.batchCount()).to.equal(2);
        });

        it("stores correct merkleRoot in the batch", async function () {
            await timestamper.commitBatch(merkleRoot);
            const batch = await timestamper.getBatch(1);
            expect(batch.merkleRoot).to.equal(merkleRoot);
        });

        it("stores correct version in the batch", async function () {
            await timestamper.commitBatch(merkleRoot);
            const batch = await timestamper.getBatch(1);
            expect(batch.version).to.equal(INITIAL_VERSION);
        });

        it("stores a non-zero timestamp in the batch", async function () {
            await timestamper.commitBatch(merkleRoot);
            const batch = await timestamper.getBatch(1);
            expect(batch.timestamp).to.be.gt(0);
        });

        it("records rootToBatchId mapping correctly", async function () {
            await timestamper.commitBatch(merkleRoot);
            expect(await timestamper.rootToBatchId(merkleRoot)).to.equal(1);
        });

        it("emits BatchCommitted with correct arguments", async function () {
            const tx = await timestamper.commitBatch(merkleRoot);
            const receipt = await tx.wait();
            const block = await ethers.provider.getBlock(receipt!.blockNumber);

            await expect(tx)
                .to.emit(timestamper, "BatchCommitted")
                .withArgs(1, merkleRoot, block!.timestamp, INITIAL_VERSION);
        });

        it("reverts with ZeroRoot when root is zero bytes32", async function () {
            const zeroRoot = ethers.ZeroHash;
            await expect(
                timestamper.commitBatch(zeroRoot),
            ).to.be.revertedWithCustomError(timestamper, "ZeroRoot");
        });

        it("reverts with RootAlreadyCommitted on duplicate root", async function () {
            await timestamper.commitBatch(merkleRoot);
            await expect(
                timestamper.commitBatch(merkleRoot),
            ).to.be.revertedWithCustomError(
                timestamper,
                "RootAlreadyCommitted",
            );
        });

        it("reverts with NotOwner when called by non-owner", async function () {
            await expect(
                timestamper.connect(nonOwner).commitBatch(merkleRoot),
            ).to.be.revertedWithCustomError(timestamper, "NotOwner");
        });
    });

    // -------------------------------------------------------------------------
    // verify
    // -------------------------------------------------------------------------

    describe("verify", function () {
        let leaves: string[];
        let merkleRoot: string;
        let getProof: (index: number) => string[];

        beforeEach(async function () {
            leaves = [
                hashFile("file1"),
                hashFile("file2"),
                hashFile("file3"),
                hashFile("file4"),
            ];
            ({ root: merkleRoot, getProof } = buildMerkleTree(leaves));
            await timestamper.commitBatch(merkleRoot);
        });

        it("returns valid=true for a legitimate proof", async function () {
            const proof = getProof(0);
            const { valid } = await timestamper.verify(leaves[0], proof, 1);
            expect(valid).to.be.true;
        });

        it("returns valid=true for every leaf in the batch", async function () {
            for (let i = 0; i < leaves.length; i++) {
                const proof = getProof(i);
                const { valid } = await timestamper.verify(leaves[i], proof, 1);
                expect(valid).to.be.true;
            }
        });

        it("returns valid=false for a tampered file hash", async function () {
            const proof = getProof(0);
            const tamperedHash = hashFile("tampered_file");
            const { valid } = await timestamper.verify(tamperedHash, proof, 1);
            expect(valid).to.be.false;
        });

        it("returns valid=false for a correct hash with wrong proof", async function () {
            const wrongProof = getProof(1); // proof for leaf 1, not leaf 0
            const { valid } = await timestamper.verify(
                leaves[0],
                wrongProof,
                1,
            );
            expect(valid).to.be.false;
        });

        it("returns valid=false for an empty proof", async function () {
            const { valid } = await timestamper.verify(leaves[0], [], 1);
            expect(valid).to.be.false;
        });

        it("returns the correct timestamp", async function () {
            const proof = getProof(0);
            const { timestamp } = await timestamper.verify(leaves[0], proof, 1);
            const batch = await timestamper.getBatch(1);
            expect(timestamp).to.equal(batch.timestamp);
        });

        it("reverts with BatchNotFound for non-existent batch ID", async function () {
            const proof = getProof(0);
            await expect(
                timestamper.verify(leaves[0], proof, 999),
            ).to.be.revertedWithCustomError(timestamper, "BatchNotFound");
        });
    });

    // -------------------------------------------------------------------------
    // getBatch
    // -------------------------------------------------------------------------

    describe("getBatch", function () {
        let merkleRoot: string;

        beforeEach(async function () {
            const leaves = [hashFile("file1"), hashFile("file2")];
            ({ root: merkleRoot } = buildMerkleTree(leaves));
            await timestamper.commitBatch(merkleRoot);
        });

        it("returns correct batch data", async function () {
            const batch = await timestamper.getBatch(1);
            expect(batch.merkleRoot).to.equal(merkleRoot);
            expect(batch.version).to.equal(INITIAL_VERSION);
            expect(batch.timestamp).to.be.gt(0);
        });

        it("reverts with BatchNotFound for non-existent batch ID", async function () {
            await expect(
                timestamper.getBatch(999),
            ).to.be.revertedWithCustomError(timestamper, "BatchNotFound");
        });
    });

    // -------------------------------------------------------------------------
    // transferOwnership
    // -------------------------------------------------------------------------

    describe("transferOwnership", function () {
        it("transfers ownership to the new owner", async function () {
            await timestamper.transferOwnership(newOwner.address);
            expect(await timestamper.owner()).to.equal(newOwner.address);
        });

        it("emits OwnershipTransferred with correct arguments", async function () {
            await expect(timestamper.transferOwnership(newOwner.address))
                .to.emit(timestamper, "OwnershipTransferred")
                .withArgs(owner.address, newOwner.address);
        });

        it("reverts with ZeroAddress when passed zero address", async function () {
            await expect(
                timestamper.transferOwnership(ethers.ZeroAddress),
            ).to.be.revertedWithCustomError(timestamper, "ZeroAddress");
        });

        it("reverts with NotOwner when called by non-owner", async function () {
            await expect(
                timestamper
                    .connect(nonOwner)
                    .transferOwnership(newOwner.address),
            ).to.be.revertedWithCustomError(timestamper, "NotOwner");
        });

        it("previous owner loses ability to commit batches after transfer", async function () {
            await timestamper.transferOwnership(newOwner.address);
            const leaves = [hashFile("file1"), hashFile("file2")];
            const { root } = buildMerkleTree(leaves);
            await expect(
                timestamper.commitBatch(root),
            ).to.be.revertedWithCustomError(timestamper, "NotOwner");
        });

        it("new owner can commit batches after transfer", async function () {
            await timestamper.transferOwnership(newOwner.address);
            const leaves = [hashFile("file1"), hashFile("file2")];
            const { root } = buildMerkleTree(leaves);
            await expect(timestamper.connect(newOwner).commitBatch(root)).to.not
                .be.reverted;
        });
    });

    // -------------------------------------------------------------------------
    // setVersion
    // -------------------------------------------------------------------------

    describe("setVersion", function () {
        const NEW_VERSION = 2;

        it("updates currentVersion correctly", async function () {
            await timestamper.setVersion(NEW_VERSION);
            expect(await timestamper.currentVersion()).to.equal(NEW_VERSION);
        });

        it("emits VersionUpdated with correct arguments", async function () {
            await expect(timestamper.setVersion(NEW_VERSION))
                .to.emit(timestamper, "VersionUpdated")
                .withArgs(INITIAL_VERSION, NEW_VERSION);
        });

        it("reverts with NotOwner when called by non-owner", async function () {
            await expect(
                timestamper.connect(nonOwner).setVersion(NEW_VERSION),
            ).to.be.revertedWithCustomError(timestamper, "NotOwner");
        });

        it("new version is recorded in subsequent batches", async function () {
            await timestamper.setVersion(NEW_VERSION);
            const leaves = [hashFile("file1"), hashFile("file2")];
            const { root } = buildMerkleTree(leaves);
            await timestamper.commitBatch(root);
            const batch = await timestamper.getBatch(1);
            expect(batch.version).to.equal(NEW_VERSION);
        });

        it("already committed batches retain their original version", async function () {
            const leaves1 = [hashFile("file1"), hashFile("file2")];
            const { root: root1 } = buildMerkleTree(leaves1);
            await timestamper.commitBatch(root1);

            await timestamper.setVersion(NEW_VERSION);

            const leaves2 = [hashFile("file3"), hashFile("file4")];
            const { root: root2 } = buildMerkleTree(leaves2);
            await timestamper.commitBatch(root2);

            const batch1 = await timestamper.getBatch(1);
            const batch2 = await timestamper.getBatch(2);

            expect(batch1.version).to.equal(INITIAL_VERSION);
            expect(batch2.version).to.equal(NEW_VERSION);
        });
    });
});
