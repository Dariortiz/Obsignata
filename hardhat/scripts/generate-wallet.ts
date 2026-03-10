import { ethers } from "ethers";

const wallet = ethers.Wallet.createRandom();
console.log("Address:     ", wallet.address);
console.log("Private key: ", wallet.privateKey);
console.log("");
console.log("IMPORTANT: Save the private key somewhere safe.");
console.log("This wallet is for testnet only — never send real funds to it.");