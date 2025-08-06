const { ethers, Wallet, JsonRpcProvider, parseUnits, Contract } = require("ethers");

// --- CONFIGURATION ---
const RPC_URL = "https://api.zan.top/node/v1/pharos/testnet/c99f5c46d6bf4126a26df3bf19e25c6d";
const routerAddress = "0xad3b4e20412a097f87cd8e8d84fbbe17ac7c89e9";

// Token addresses (symbol: address)
const tokens = {
  USDC: "0x48249feEb47a8453023f702f15CF00206eeBdF08",
  USDT: "0x0B00Fb1F513E02399667FBA50772B21f34c1b5D9",
  BTC: "0xA4a967FC7cF0E9815bF5c2700A055813628b65BE",
  GOLD: "0x77f532df5f46DdFf1c97CDae3115271A523fa0f4",
  TSLA: "0xCDA3DF4AAB8a571688fE493EB1BdC1Ad210C09E4",
  NVIDIA: "0x3299cc551B2a39926Bf14144e65630e533dF6944",
};

// Per-token decimals (symbol: decimals)
const tokenDecimals = {
  USDC: 6,
  USDT: 6,
  BTC: 8,
  GOLD: 18,
  TSLA: 18,
  NVIDIA: 18,
};

// Mint router config
const mintAmount = "100";
const mintRouter = {
  address: "0x2e9d89d372837f71cb529e5ba85bfbc1785c69cd",
  abi: [
    {
      name: "mint",
      type: "function",
      inputs: [
        { name: "_asset", type: "address" },
        { name: "_account", type: "address" },
        { name: "_amount", type: "uint256" },
      ],
      outputs: [],
      stateMutability: "nonpayable",
    },
  ],
  func: "mint",
};

// ERC20 ABI fragment for approve/allowance
const erc20Abi = [
  "function approve(address spender, uint256 amount) public returns (bool)",
  "function allowance(address owner, address spender) public view returns (uint256)",
];

// Router ABI fragment for supply
const supplyAbi = [
  {
    name: "supply",
    type: "function",
    inputs: [
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "onBehalfOf", type: "address" },
      { name: "referralCode", type: "uint16" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
];

// --- HELPER FUNCTIONS ---
function getRandomSupplyAmount(min, max, decimals) {
  const rand = Math.random() * (max - min) + min;
  return ethers.parseUnits(rand.toFixed(6), decimals);
}

function getShortAddress(address) {
  return address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "N/A";
}

// --- MAIN TASK FUNCTION ---
async function performOpenFiTask(logger, privateKeys, proxies, openFiTxCount, usedNonces) {
  logger("System | Starting OpenFi Task...");

  const provider = new ethers.JsonRpcProvider(RPC_URL);

  for (let i = 0; i < privateKeys.length; i++) {
    const privateKey = privateKeys[i];
    const wallet = new Wallet(privateKey, provider);
    const onBehalfOf = wallet.address;

    logger(`${getShortAddress(wallet.address)} | Processing OpenFi for account ${i + 1}`);

    // Initialize nonce if not already set
    if (!usedNonces[wallet.address]) {
      usedNonces[wallet.address] = await provider.getTransactionCount(wallet.address, "pending");
    }

    for (let j = 0; j < openFiTxCount; j++) {
      logger(`${getShortAddress(wallet.address)} | OpenFi transaction ${j + 1}/${openFiTxCount}`);

      // ----- MINT -----
      const mintContract = new Contract(mintRouter.address, mintRouter.abi, wallet);
      for (const [symbol, tokenAddress] of Object.entries(tokens)) {
        const decimals = tokenDecimals[symbol];
        const amt = parseUnits(mintAmount, decimals);
        let attempts = 0;
        const maxAttempts = 3;

        while (attempts < maxAttempts) {
          try {
            logger(`${getShortAddress(wallet.address)} | [${symbol}] Minting ${mintAmount}...`);
            const nonce = usedNonces[wallet.address] || (await provider.getTransactionCount(wallet.address, "pending"));
            const feeData = await provider.getFeeData();
            const tx = await mintContract[mintRouter.func](
              tokenAddress,
              wallet.address,
              amt,
              {
                gasLimit: 200000,
                maxFeePerGas: feeData.maxFeePerGas || parseUnits("5", "gwei"),
                maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || parseUnits("1", "gwei"),
                nonce,
              }
            );
            logger(`${getShortAddress(wallet.address)} | [${symbol}] Mint tx: ${tx.hash}`);
            await tx.wait();
            logger(`${getShortAddress(wallet.address)} | [${symbol}] Mint confirmed`);
            usedNonces[wallet.address] = nonce + 1;
            break;
          } catch (err) {
            attempts++;
            const errorMsg = err.reason || err.message || "Unknown error";
            logger(
              `${getShortAddress(wallet.address)} | [${symbol}] Mint failed (attempt ${attempts}/${maxAttempts}): ${errorMsg}`
            );
            if (attempts < maxAttempts && !errorMsg.includes("TX_REPLAY_ATTACK")) {
              await new Promise((resolve) => setTimeout(resolve, 5000));
            } else {
              break;
            }
          }
        }
      }

      // ----- APPROVE -----
      for (const [symbol, tokenAddress] of Object.entries(tokens)) {
        const decimals = tokenDecimals[symbol];
        const tokenContract = new Contract(tokenAddress, erc20Abi, wallet);
        let allowance = 0n;
        try {
          allowance = await tokenContract.allowance(wallet.address, routerAddress);
        } catch (e) {
          logger(
            `${getShortAddress(wallet.address)} | [${symbol}] Allowance fetch error: ${e.reason || e.message}`
          );
        }
        const maxUint = ethers.MaxUint256;
        if (allowance < maxUint / 2n) {
          let attempts = 0;
          const maxAttempts = 3;
          while (attempts < maxAttempts) {
            try {
              logger(`${getShortAddress(wallet.address)} | [${symbol}] Approving router unlimited...`);
              const nonce = usedNonces[wallet.address] || (await provider.getTransactionCount(wallet.address, "pending"));
              const feeData = await provider.getFeeData();
              const approveTx = await tokenContract.approve(routerAddress, maxUint, {
                gasLimit: 100000,
                maxFeePerGas: feeData.maxFeePerGas || parseUnits("5", "gwei"),
                maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || parseUnits("1", "gwei"),
                nonce,
              });
              logger(`${getShortAddress(wallet.address)} | [${symbol}] Approve tx: ${approveTx.hash}`);
              await approveTx.wait();
              logger(`${getShortAddress(wallet.address)} | [${symbol}] Approval confirmed`);
              usedNonces[wallet.address] = nonce + 1;
              break;
            } catch (e) {
              attempts++;
              const errorMsg = e.reason || e.message || "Unknown error";
              logger(
                `${getShortAddress(wallet.address)} | [${symbol}] Approve failed (attempt ${attempts}/${maxAttempts}): ${errorMsg}`
              );
              if (attempts < maxAttempts && !errorMsg.includes("TX_REPLAY_ATTACK")) {
                await new Promise((resolve) => setTimeout(resolve, 5000));
              } else {
                break;
              }
            }
          }
        } else {
          logger(`${getShortAddress(wallet.address)} | [${symbol}] Already unlimited approval`);
        }
      }

      // ----- SUPPLY -----
      const supplyContract = new Contract(routerAddress, supplyAbi, wallet);
      const suppliedAmounts = {};
      for (const [symbol, tokenAddress] of Object.entries(tokens)) {
        const decimals = tokenDecimals[symbol];
        const supplyAmt = getRandomSupplyAmount(50, 80, decimals);
        suppliedAmounts[symbol] = supplyAmt;
        let attempts = 0;
        const maxAttempts = 3;
        while (attempts < maxAttempts) {
          try {
            logger(
              `${getShortAddress(wallet.address)} | [${symbol}] Supplying ${ethers.formatUnits(
                supplyAmt,
                decimals
              )}...`
            );
            const nonce = usedNonces[wallet.address] || (await provider.getTransactionCount(wallet.address, "pending"));
            const feeData = await provider.getFeeData();
            const tx = await supplyContract.supply(tokenAddress, supplyAmt, wallet.address, 0, {
              gasLimit: 300000,
              maxFeePerGas: feeData.maxFeePerGas || parseUnits("5", "gwei"),
              maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || parseUnits("1", "gwei"),
              nonce,
            });
            logger(`${getShortAddress(wallet.address)} | [${symbol}] Supply tx: ${tx.hash}`);
            await tx.wait();
            logger(`${getShortAddress(wallet.address)} | [${symbol}] Supply confirmed`);
            usedNonces[wallet.address] = nonce + 1;
            break;
          } catch (e) {
            attempts++;
            const errorMsg = e.reason || e.message || "Unknown error";
            logger(
              `${getShortAddress(wallet.address)} | [${symbol}] Supply failed (attempt ${attempts}/${maxAttempts}): ${errorMsg}`
            );
            if (attempts < maxAttempts && !errorMsg.includes("TX_REPLAY_ATTACK")) {
              await new Promise((resolve) => setTimeout(resolve, 5000));
            } else {
              break;
            }
          }
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 2000)); // Delay between transactions
    }
  }

  logger("System | OpenFi Task completed!");
}

module.exports = { performOpenFiTask };
