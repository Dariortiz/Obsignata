# Obsignata

**Prove any document existed at a specific point in time — without revealing its contents.**

Obsignata is a blockchain timestamping service built on Polygon. Drop a file, get a cryptographic certificate. Anyone can verify it independently using nothing but the certificate PDF and a blockchain explorer. No accounts, no uploads, no trust required.

**Live demo:** https://obsignata-mkhj.vercel.app  
**Contract:** https://amoy.polygonscan.com/address/0x245555e9B1304097544ed09769b31a61483D3f13

---

## What problem does it solve?

Sometimes you need to prove a document existed at a specific time — a design, a contract draft, a research finding, source code. Traditional solutions require trusting a third party (a notary, a timestamp server, a company). Obsignata removes that trust requirement entirely. The proof lives on a public blockchain that no single entity controls.

---

## How it works

```
Your file → keccak256 hash → submission queue → Merkle batch → Polygon transaction → certificate PDF
```

1. **Your file is hashed locally.** The document never leaves your browser. Only a 32-byte fingerprint (keccak256) is sent to the server.
2. **Submissions are batched.** Multiple file hashes are collected into a Merkle tree. This lets thousands of documents share a single blockchain transaction, keeping gas costs low.
3. **The Merkle root is committed on-chain.** A single transaction stores the root of the tree in a smart contract on Polygon Amoy. The transaction timestamp is permanent and immutable.
4. **A certificate is issued.** The PDF contains your file hash, the Merkle proof path, transaction details, and a QR code with the full proof payload.
5. **Anyone can verify it.** The Verify tab recomputes the Merkle root from your file and proof, then checks it against the on-chain root — directly via ethers.js, no backend involved.

---

## Architecture

| Layer | Technology | Role |
|---|---|---|
| Smart contract | Solidity 0.8.24, Polygon Amoy | Stores Merkle roots on-chain |
| Backend | Node.js, Express, TypeScript | Batching, Merkle tree, certificate generation |
| Queue | SQLite (better-sqlite3) | Persistent submission store |
| Certificate | PDFKit, QRCode | PDF generation with embedded proof |
| Frontend | React, Vite, TypeScript | Hashing, submission, verification |
| Blockchain client | ethers.js v6 | Contract interaction on both backend and frontend |
| Infrastructure | Docker, Railway, Vercel | Local dev and production deployment |

### Smart contract

The `Timestamper` contract is minimal by design. It stores a `bytes32` Merkle root per batch and emits a `BatchCommitted` event with the batch ID and timestamp. Gas is optimised by packing the timestamp and version into a single storage slot.

```solidity
function commitBatch(bytes32 merkleRoot) external returns (uint256 batchId)
function verify(bytes32 leafHash, bytes32[] calldata proof, uint256 batchId) 
    external view returns (bool valid, uint256 timestamp)
```

### Merkle tree

Leaves are keccak256 hashes of file contents. Sibling pairs are always sorted before hashing (smaller hash first), matching Solidity's on-chain verification. A single-file batch has an empty proof — the root equals the leaf.

### Adaptive batching

The batcher commits when either threshold is reached:
- **Volume threshold** — commit immediately when N submissions are pending
- **Time threshold** — commit after T milliseconds regardless of queue size

This keeps latency low under high traffic and ensures submissions aren't held indefinitely under low traffic.

---

## Certificate verification

Every certificate is self-contained. To verify without using this app:

1. **Recompute the file hash.** Hash your original document using keccak256. It must match the File Hash on the certificate.
2. **Recompute the Merkle root.** Starting from your file hash, hash it with each sibling in the proof path (always place the smaller hash first). The final result must equal the Merkle Root.
3. **Check the chain.** Visit the transaction on [Polygonscan](https://amoy.polygonscan.com), find the `BatchCommitted` event, and confirm the Merkle Root matches.

If all three match, your document was provably included in that batch at that block timestamp. The QR code on the certificate encodes the full proof payload as JSON for programmatic verification.

---

## File type guide

Not all files are equal when it comes to hashing. Some formats silently modify metadata when opened or saved.

| Format | Risk | Recommendation |
|---|---|---|
| `.txt`, `.md`, `.csv`, source code | ✅ Safe | Hash as-is |
| `.png`, `.zip`, video, audio | ✅ Safe | Hash as-is |
| `.jpg` / `.jpeg` | ⚠️ Risky | EXIF data stripped by some apps |
| `.pdf` | ⚠️ Risky | Metadata updates on open/save in some viewers |
| `.docx`, `.xlsx` | ⚠️ Risky | Office updates metadata on every save |

**Key advice:** hash your document immediately after creation, before any other software touches it. For PDFs, Obsignata offers a **Content mode** that hashes only the text content, making the proof stable across metadata changes.

---

## Local development

### Prerequisites

- Docker Desktop
- VS Code with the Dev Containers extension

### Setup

```bash
git clone https://github.com/Dariortiz/Obsignata.git
cd Obsignata
cp .env.example .env   # fill in your values
docker compose up --build
```

Services:
- Frontend: http://localhost:3000
- Backend: http://localhost:3001
- Hardhat node: http://localhost:8545

### Deploy the local contract

```bash
docker exec -it hardhat sh
npx hardhat run scripts/deploy.ts --network localhost
```

Update `CONTRACT_ADDRESS` in `.env` with the deployed address, then restart the backend.

### Environment variables

| Variable | Description |
|---|---|
| `RPC_URL` | Ethereum-compatible RPC endpoint |
| `CONTRACT_ADDRESS` | Deployed Timestamper contract address |
| `DEPLOYER_PRIVATE_KEY` | Wallet private key for signing transactions |
| `BATCH_TIME_THRESHOLD_MS` | Max ms before a batch is committed (default: 7200000) |
| `BATCH_VOLUME_THRESHOLD` | Submissions before immediate commit (default: 500) |
| `CORS_ORIGIN` | Allowed frontend origin |

---

## Project structure

```
Obsignata/
├── hardhat/              # Solidity contract, tests, deploy scripts
│   ├── contracts/        # Timestamper.sol
│   ├── test/             # 33 tests
│   └── scripts/          # deploy.ts
├── backend/              # Node.js/Express API
│   └── src/
│       ├── index.ts      # Entry point
│       ├── queue.ts      # SQLite-backed submission queue
│       ├── db.ts         # Database layer
│       ├── batcher.ts    # Adaptive batch committer
│       ├── merkle.ts     # Merkle tree implementation
│       ├── contract.ts   # ethers.js contract client
│       ├── routes.ts     # Express routes
│       └── certificate.ts # PDF certificate generation
└── frontend/             # React/Vite app
    └── src/
        ├── components/   # StampView, VerifyView, RetrieveView
        ├── lib/          # hash.ts, merkle.ts, qr.ts, api.ts
        └── hooks/        # useSubmissionPoller
```

---

## Engineering decisions

**Why Merkle batching instead of individual transactions?**  
Each Polygon transaction has a gas cost. Batching lets thousands of documents share one transaction, making the service economically viable at scale. The Merkle proof lets each document independently prove its inclusion.

**Why keccak256?**  
It's the native hash function of the EVM. Using it on both the frontend (via ethers.js) and in the smart contract guarantees identical results without any encoding ambiguity.

**Why SQLite over Redis?**  
For this scale, SQLite is simpler, has zero infrastructure overhead, and is a respected production choice. The database file is persisted via a Docker volume on Railway.

**Why Polygon?**  
Low gas fees make individual batch commits economically trivial. EVM compatibility means the same Solidity and ethers.js code works on any EVM chain.

**Why not store documents?**  
Privacy. The document never leaves the user's browser. The server only ever sees a 32-byte hash. Even if the backend were compromised, no document contents could be recovered.

---

## License

MIT