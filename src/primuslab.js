const chalk = require("chalk").default || require("chalk");
const ethers = require("ethers");

// ---- CONSTANTS ----
const PRIMUS_TIP_CONTRACT = "0xd17512b7ec12880bd94eca9d774089ff89805f02";

// ---- ABI ----
const PRIMUS_TIP_ABI = [
  "function tip((uint32,address) token, (string,string,uint256,uint256[]) recipient)",
];

// ---- UTILITY FUNCTIONS ----
function getShortAddress(address) {
  return address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "N/A";
}

function getEthersProvider(proxyUrl = null) {
  if (proxyUrl) {
    console.log(chalk.yellow("Warning: Proxy support in ethers v6 is limited"));
  }
  return new ethers.JsonRpcProvider("https://api.zan.top/node/v1/pharos/testnet/54b49326c9f44b6e8730dc5dd4348421", 688688);
}

// Random X usernames for tipping
const RANDOM_USERNAMES = [
  "CryptoLad",
  "NFTKing",
  "Web3Fan",
  "PharosTester",
  "TokenMaster",
  "BlockchainBuddy",
  "DeFiDreamer",
  "MoonCoiner",
  "EthExplorer",
  "WalletWizard",
];

function getRandomUsername() {
  return RANDOM_USERNAMES[Math.floor(Math.random() * RANDOM_USERNAMES.length)];
}

async function sendTip(wallet, proxyUrl, username, logger, usedNonces) {
  logger(`${getShortAddress(wallet.address)} | Processing Send Tip to ${username}...`);
  try {
    const provider = getEthersProvider(proxyUrl);
    const minAmount = ethers.parseEther("0.0000001");
    const maxAmount = ethers.parseEther("0.00000015");
    const randomAmount = minAmount + BigInt(Math.floor(Math.random() * Number(maxAmount - minAmount + BigInt(1))));
    const amountStr = ethers.formatEther(randomAmount);

    logger(`${getShortAddress(wallet.address)} | Preparing to tip ${amountStr} PHRS to ${username} on X...`);

    const tipContract = new ethers.Contract(PRIMUS_TIP_CONTRACT, PRIMUS_TIP_ABI, wallet.connect(provider));

    const tokenStruct = [1, "0x0000000000000000000000000000000000000000"];
    const recipientStruct = ["x", username, randomAmount, []];

    const nonce = usedNonces[wallet.address] || 0;
    usedNonces[wallet.address] = nonce + 1;
    const feeData = await provider.getFeeData();

    const tx = await tipContract.tip(tokenStruct, recipientStruct, {
      value: randomAmount,
      gasLimit: 300000,
      maxFeePerGas: feeData.maxFeePerGas || ethers.parseUnits("1", "gwei"),
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || ethers.parseUnits("0.5", "gwei"),
      nonce,
    });

    logger(
      `${getShortAddress(wallet.address)} | Success: Tip transaction sent | Confirmed: ${tx.hash}`
    );
    await tx.wait();
    logger(
      `${getShortAddress(wallet.address)} | Success: Successfully tipped ${amountStr} PHRS to ${username}`
    );
  } catch (e) {
    logger(`${getShortAddress(wallet.address)} | Error: Send Tip failed: ${e.message}`);
    throw e;
  }
}

async function sendTipTask(logger, privateKeys, proxies, tipCount, tipUsername, usedNonces) {
  // Use provided username or select a random one if not provided
  const usernameToUse = tipUsername || getRandomUsername();
  logger(`System | Starting Send Tip (PrimusLab) to ${usernameToUse}...`);

  for (let i = 0; i < privateKeys.length; i++) {
    const privateKey = privateKeys[i];
    const proxyUrl = proxies[i % proxies.length] || null;
    const provider = getEthersProvider(proxyUrl);
    const wallet = new ethers.Wallet(privateKey, provider);

    logger(`${getShortAddress(wallet.address)} | Processing tips for account ${i + 1}`);

    if (!usedNonces[wallet.address]) {
      usedNonces[wallet.address] = await provider.getTransactionCount(wallet.address, "latest");
    }

    for (let j = 0; j < tipCount; j++) {
      logger(
        `${getShortAddress(wallet.address)} | Processing Tip #${j + 1} to ${usernameToUse}...`
      );
      try {
        await sendTip(wallet, proxyUrl, usernameToUse, logger, usedNonces);
      } catch (error) {
        logger(
          `${getShortAddress(wallet.address)} | Error: Tip #${j + 1} failed: ${error.message}`
        );
      }
      if (j < tipCount - 1) {
        logger(`${getShortAddress(wallet.address)} | Waiting before next tip...`);
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
  }

  logger("System | Send Tip (PrimusLab) completed!");
}

module.exports = { sendTipTask };
