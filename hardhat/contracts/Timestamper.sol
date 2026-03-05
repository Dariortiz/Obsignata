// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title Timestamper
 * @notice Records Merkle roots on-chain to prove a batch of files
 *         existed at a specific point in time.
 * @dev Only the contract owner (the deployer) can submit roots.
 *      Verification is fully public and requires no trust in the owner.
 *      Storage layout is optimized: timestamp and version share one slot.
 */
contract Timestamper {
    // -------------------------------------------------------------------------
    // Types
    // -------------------------------------------------------------------------

    /// @notice Represents a committed batch of timestamped files.
    /// @dev timestamp and version are packed into a single 32-byte storage slot.
    struct Batch {
        bytes32 merkleRoot; // Slot 0
        uint64 timestamp;   // Slot 1 (8 bytes)
        uint16 version;     // Slot 1 (2 bytes, packed)
    }

    // -------------------------------------------------------------------------
    // State
    // -------------------------------------------------------------------------

    /// @notice The address authorized to commit batches.
    address public owner;

    /// @notice The current service version, recorded in every new batch.
    uint16 public currentVersion;

    /// @notice The total number of batches committed so far.
    uint256 public batchCount;

    /// @notice Maps batch ID to its Batch data.
    mapping(uint256 => Batch) public batches;

    /// @notice Maps a Merkle root to the batch ID it was committed in.
    ///         Used to detect duplicate root submissions.
    mapping(bytes32 => uint256) public rootToBatchId;

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    /// @notice Emitted when a new batch is successfully committed.
    /// @param batchId The sequential ID assigned to this batch.
    /// @param merkleRoot The Merkle root of the batch.
    /// @param timestamp The block timestamp at commit time.
    /// @param version The service version at commit time.
    event BatchCommitted(
        uint256 indexed batchId,
        bytes32 indexed merkleRoot,
        uint64 timestamp,
        uint16 version
    );

    /// @notice Emitted when contract ownership is transferred.
    /// @param previousOwner The address that previously held ownership.
    /// @param newOwner The address that now holds ownership.
    event OwnershipTransferred(
        address indexed previousOwner,
        address indexed newOwner
    );

    /// @notice Emitted when the service version is updated.
    /// @param previousVersion The version before the update.
    /// @param newVersion The version after the update.
    event VersionUpdated(uint16 previousVersion, uint16 newVersion);

    // -------------------------------------------------------------------------
    // Errors
    // -------------------------------------------------------------------------

    /// @notice Thrown when a non-owner address calls an owner-only function.
    error NotOwner();

    /// @notice Thrown when the zero address is passed where a valid address is required.
    error ZeroAddress();

    /// @notice Thrown when a Merkle root has already been committed.
    error RootAlreadyCommitted();

    /// @notice Thrown when a zero bytes32 value is passed as a Merkle root.
    error ZeroRoot();

    /// @notice Thrown when a batch ID does not correspond to any committed batch.
    error BatchNotFound();

    // -------------------------------------------------------------------------
    // Modifiers
    // -------------------------------------------------------------------------

    /// @dev Reverts if the caller is not the owner.
    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    /// @notice Deploys the contract, setting the deployer as owner.
    /// @param _initialVersion The initial service version to record in batches.
    constructor(uint16 _initialVersion) {
        owner = msg.sender;
        currentVersion = _initialVersion;
    }

    // -------------------------------------------------------------------------
    // Core functions
    // -------------------------------------------------------------------------

    /// @notice Commits a Merkle root representing a batch of timestamped files.
    /// @dev Only callable by the owner. Reverts on zero or duplicate roots.
    /// @param _merkleRoot The root of the Merkle tree for this batch.
    /// @return batchId The sequential ID assigned to this batch.
    function commitBatch(
        bytes32 _merkleRoot
    ) external onlyOwner returns (uint256 batchId) {
        if (_merkleRoot == bytes32(0)) revert ZeroRoot();
        if (rootToBatchId[_merkleRoot] != 0) revert RootAlreadyCommitted();

        batchId = ++batchCount;

        batches[batchId] = Batch({
            merkleRoot: _merkleRoot,
            timestamp: uint64(block.timestamp),
            version: currentVersion
        });

        rootToBatchId[_merkleRoot] = batchId;

        emit BatchCommitted(
            batchId,
            _merkleRoot,
            uint64(block.timestamp),
            currentVersion
        );
    }

    // -------------------------------------------------------------------------
    // Verification
    // -------------------------------------------------------------------------

    /// @notice Verifies that a file hash is included in a committed batch.
    /// @dev Recomputes the Merkle root from the leaf and proof path, then
    ///      compares it against the stored root. No trust in the caller required.
    /// @param _leafHash The keccak256 hash of the file being verified.
    /// @param _proof The Merkle proof path (sibling hashes from leaf to root).
    /// @param _batchId The ID of the batch to verify against.
    /// @return valid True if the file was included in the batch.
    /// @return timestamp The block timestamp when the batch was committed.
    function verify(
        bytes32 _leafHash,
        bytes32[] calldata _proof,
        uint256 _batchId
    ) external view returns (bool valid, uint256 timestamp) {
        Batch storage batch = batches[_batchId];

        uint64 ts = batch.timestamp;
        // slither-disable-next-line incorrect-equality,timestamp
        // Safe: timestamp == 0 is used solely as an existence check, not for
        // financial logic. Minor miner manipulation (~15s) cannot produce a
        // zero timestamp for a real block, making this a reliable sentinel.
        if (ts == 0) revert BatchNotFound();

        timestamp = uint256(ts);
        valid = _computeRoot(_leafHash, _proof) == batch.merkleRoot;
    }

    /// @notice Returns the full details of a committed batch.
    /// @param _batchId The ID of the batch to look up.
    /// @return The Batch struct containing root, timestamp, and version.
    function getBatch(uint256 _batchId)
        external
        view
        returns (Batch memory)
    {
        Batch memory batch = batches[_batchId];
        // slither-disable-next-line incorrect-equality,timestamp
        // Safe: same reasoning as verify() — existence check only, not financial logic.
        if (batch.timestamp == 0) revert BatchNotFound();
        return batch;
    }

    // -------------------------------------------------------------------------
    // Admin
    // -------------------------------------------------------------------------

    /// @notice Transfers ownership of the contract to a new address.
    /// @dev Reverts if the new owner is the zero address.
    ///      Once transferred, the previous owner loses all admin rights.
    /// @param _newOwner The address to transfer ownership to.
    function transferOwnership(address _newOwner) external onlyOwner {
        if (_newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, _newOwner);
        owner = _newOwner;
    }

    /// @notice Updates the service version recorded in future batches.
    /// @dev Does not affect already-committed batches.
    /// @param _newVersion The new version number.
    function setVersion(uint16 _newVersion) external onlyOwner {
        emit VersionUpdated(currentVersion, _newVersion);
        currentVersion = _newVersion;
    }

    // -------------------------------------------------------------------------
    // Internal
    // -------------------------------------------------------------------------

    /// @dev Recomputes the Merkle root from a leaf hash and its proof path.
    ///      Uses sorted pair hashing — the smaller hash always goes first —
    ///      so the proof path works regardless of which side each sibling is on.
    ///      The backend Merkle implementation must use the same sorting convention.
    /// @param leaf The hash of the file being verified.
    /// @param proof The sibling hashes from the leaf up to the root.
    /// @return The recomputed Merkle root.
    function _computeRoot(
        bytes32 leaf,
        bytes32[] calldata proof
    ) internal pure returns (bytes32) {
        bytes32 computed = leaf;

        for (uint256 i = 0; i < proof.length; ) {
            bytes32 sibling = proof[i];

            if (computed <= sibling) {
                computed = keccak256(abi.encodePacked(computed, sibling));
            } else {
                computed = keccak256(abi.encodePacked(sibling, computed));
            }

            unchecked {
                ++i;
            }
        }

        return computed;
    }
}
