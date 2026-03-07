import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("Deploying Timestamper with account:", deployer.address);
  console.log("Account balance:", (await ethers.provider.getBalance(deployer.address)).toString());

  const initialVersion = 1;
  const factory = await ethers.getContractFactory("Timestamper");
  const contract = await factory.deploy(initialVersion);
  await contract.waitForDeployment();

  const address = await contract.getAddress();

  console.log("Timestamper deployed to:", address);
  console.log("Initial version:", initialVersion);
  console.log("");
  console.log("Add this to your .env file:");
  console.log(`CONTRACT_ADDRESS=${address}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});