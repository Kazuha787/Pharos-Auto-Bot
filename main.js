const chalk = require("chalk").default || require("chalk");
const ethers = require("ethers");
const fs = require("fs");
const Table = require("cli-table3");
const axios = require("axios");
const readline = require("readline");
const crypto = require("crypto");
const { performAquaFluxMint } = require("./src/aquaflux");
const { sendTipTask } = require("./src/primuslab");
const { performFaroswapTask } = require("./src/faroswap");
const { performAutoStakingTask } = require("./src/autoStaking");
const { performOpenFiTask } = require("./src/openfi"); // Added OpenFi import

// ---- CONSTANTS ----
const PHAROS_RPC = "https://testnet.dplabs-internal.com";
const WPHRS_CONTRACT = "0x76aaaDA469D23216bE5f7C596fA25F282Ff9b364";
const USDT_CONTRACT = "0xD4071393f8716661958F766DF660033b3d35fD29";
const SWAP_ROUTER = "0x1A4DE519154Ae51200b0Ad7c90F7faC75547888a";
const POSITION_MANAGER = "0xF8a1D4FF0f9b9Af7CE58E1fc1833688F3BFd6115";
const API_BASE = "https://api.pharosnetwork.xyz";
const REF_CODE = "yoHvlg6UmrQWQTpw";
const DOMAIN_CONFIG = {
  RPC_URL: "https://testnet.dplabs-internal.com",
  CONTROLLER_ADDRESS: "0x51be1ef20a1fd5179419738fc71d95a8b6f8a175",
  DURATION: 31536000,
  RESOLVER: "0x9a43dcA1C3BB268546b98eb2AB1401bFc5b58505",
  DATA: [],
  REVERSE_RECORD: true,
  OWNER_CONTROLLED_FUSES: 0,
  CHAIN_ID: 688688,
  REG_PER_KEY: 1,
  MAX_CONCURRENCY: 1,
};

// ---- GLOBAL VARIABLES ----
let privateKeys = [];
let targetWallets = [];
let accountTokens = {};
let usedNonces = {};
let global = {
  maxTransaction: 5,
  aquaFluxMintCount: 1,
  tipCount: 1,
  tipUsername: "",
  faroswapTxCount: 1,
  faroswapDelay: 20,
  autoStakingTxCount: 1,
  autoStakingMinDelay: 10,
  autoStakingMaxDelay: 20,
  autoStakingUsdcAmount: 0.45,
  autoStakingUsdtAmount: 0.45,
  autoStakingMusdAmount: 0.45,
  autoStakingUseProxy: false,
  autoStakingRotateProxy: false,
  domainMintCount: 1,
  openFiTxCount: 1, // Added OpenFi transaction count
};
const FIXED_WRAP_AMOUNT = "0.0001";

// ---- ABIs ----
const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function deposit() payable",
  "function withdraw(uint256 wad)",
  "function transfer(address to, uint256 amount) returns (bool)",
];

const SWAP_ROUTER_ABI = [
  {
    inputs: [
      { internalType: "uint256", name: "deadline", type: "uint256" },
      { internalType: "bytes[]", name: "data", type: "bytes[]" },
    ],
    name: "multicall",
    outputs: [{ internalType: "bytes[]", name: "", type: "bytes[]" }],
    stateMutability: "payable",
    type: "function",
  },
];

const POSITION_MANAGER_ABI = [
  {
    inputs: [
      {
        components: [
          { internalType: "address", name: "token0", type: "address" },
          { internalType: "address", name: "token1", type: "address" },
          { internalType: "uint24", name: "fee", type: "uint24" },
          { internalType: "int24", name: "tickLower", type: "int24" },
          { internalType: "int24", name: "tickUpper", type: "int24" },
          { internalType: "uint256", name: "amount0Desired", type: "uint256" },
          { internalType: "uint256", name: "amount1Desired", type: "uint256" },
          { internalType: "uint256", name: "amount0Min", type: "uint256" },
          { internalType: "uint256", name: "amount1Min", type: "uint256" },
          { internalType: "address", name: "recipient", type: "address" },
          { internalType: "uint256", name: "deadline", type: "uint256" },
        ],
        internalType: "struct INonfungiblePositionManager.MintParams",
        name: "params",
        type: "tuple",
      },
    ],
    name: "mint",
    outputs: [
      { internalType: "uint256", name: "tokenId", type: "uint256" },
      { internalType: "uint128", name: "liquidity", type: "uint128" },
      { internalType: "uint256", name: "amount0", type: "uint256" },
      { internalType: "uint256", name: "amount1", type: "uint256" },
    ],
    stateMutability: "payable",
    type: "function",
  },
];

const CONTROLLER_ABI = [
  {
    constant: true,
    inputs: [
      { name: "name", type: "string" },
      { name: "owner", type: "address" },
      { name: "duration", type: "uint256" },
      { name: "secret", type: "bytes32" },
      { name: "resolver", type: "address" },
      { name: "data", type: "bytes[]" },
      { name: "reverseRecord", type: "bool" },
      { name: "ownerControlledFuses", type: "uint16" },
    ],
    name: "makeCommitment",
    outputs: [{ name: "", type: "bytes32" }],
    stateMutability: "pure",
    type: "function",
  },
  {
    constant: false,
    inputs: [{ name: "commitment", type: "bytes32" }],
    name: "commit",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    constant: true,
    inputs: [
      { name: "name", type: "string" },
      { name: "duration", type: "uint256" },
    ],
    name: "rentPrice",
    outputs: [
      {
        components: [
          { name: "base", type: "uint256" },
          { name: "premium", type: "uint256" },
        ],
        name: "",
        type: "tuple",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    constant: false,
    inputs: [
      { name: "name", type: "string" },
      { name: "owner", type: "address" },
      { name: "duration", type: "uint256" },
      { name: "secret", type: "bytes32" },
      { name: "resolver", type: "address" },
      { name: "data", type: "bytes[]" },
      { name: "reverseRecord", type: "bool" },
      { name: "ownerControlledFuses", type: "uint16" },
    ],
    name: "register",
    outputs: [],
    stateMutability: "payable",
    type: "function",
  },
];

// ---- MENU OPTIONS ----
const menuOptions = [
  { label: "Daily Sign-In", value: "performDailySignIn" },
  { label: "Claim Faucet", value: "claimFaucet" },
  { label: "Send PHRS to Friends", value: "performTransfers" },
  { label: "Wrap PHRS to WPHRS", value: "performWrap" },
  { label: "Unwrap WPHRS to PHRS", value: "performUnwrap" },
  { label: "Swap Tokens", value: "performSwaps" },
  { label: "Add Liquidity", value: "addLiquidity" },
  { label: "AquaFlux Mint", value: "performAquaFluxMint" },
  { label: "Send Tip (PrimusLab)", value: "sendTip" },
  { label: "Faroswap Task", value: "performFaroswapTask" },
  { label: "AutoStaking Task", value: "performAutoStakingTask" },
  { label: "Domain Mint Task", value: "performDomainMintTask" },
  { label: "OpenFi Task", value: "performOpenFiTask" }, // Added OpenFi option
  { label: "Display All Accounts", value: "displayAccounts" },
  { label: "Run All Activities", value: "runAllActivities" },
  { label: "Set Transaction Count", value: "setTransactionCount" },
];

// ---- BANNER ----
const asciiBannerLines = [
  "██████╗     ██╗  ██╗     █████╗     ██████╗      ██████╗     ███████╗",
  "██╔══██╗    ██║  ██║    ██╔══██╗    ██╔══██╗    ██╔═══██╗    ██╔════╝",
  "██████╔╝    ███████║    ███████║    ██████╔╝    ██║   ██║    ███████╗",
  "██╔═══╝     ██╔══██║    ██╔══██║    ██╔══██╗    ██║   ██║    ╚════██║",
  "██║         ██║  ██║    ██║  ██║    ██║  ██║    ╚██████╔╝    ███████║",
  "╚═╝         ╚═╝  ╚═╝    ╚═╝  ╚═╝    ╚═╝  ╚═╝     ╚═════╝     ╚══════╝",
  "",
  "       Pharos Testnet Bot v2.0 - Created By Kazuha787       ",
  "                  LETS FUCK THIS TESTNET                   ",
];

// ---- UTILITY FUNCTIONS ----
function formatLogMessage(msg) {
  const timestamp = new Date().toLocaleTimeString("en-US", { hour12: false });
  msg = (msg || "").toString().trim();
  if (!msg) return chalk.hex("#CCCCCC")(`[${timestamp}] Empty log`);

  const parts = msg.split("|").map((s) => s?.trim() || "");
  const walletName = parts[0] || "System";

  if (
    parts.length >= 3 &&
    (parts[2]?.includes("successful") ||
      parts[2]?.includes("Confirmed") ||
      parts[2]?.includes("Approved"))
  ) {
    const logParts = parts[2].split(/successful:|Confirmed:|Approved:/);
    const message = logParts[0]?.trim() || "";
    const hashPart = logParts[1]?.trim() || "";
    return chalk.green.bold(
      `[${timestamp}] ${walletName.padEnd(25)} | ${message}${
        hashPart ? "Confirmed: " : "successful: "
      }${chalk.greenBright.bold(hashPart || "")}`
    );
  }

  if (
    parts.length >= 2 &&
    (parts[1]?.includes("Starting") ||
      parts[1]?.includes("Processing") ||
      parts[1]?.includes("Approving"))
  ) {
    return chalk.hex("#C71585").bold(
      `[${timestamp}] ${walletName.padEnd(25)} | ${parts[1]}`
    );
  }

  if (parts.length >= 2 && parts[1]?.includes("Warning")) {
    return chalk.yellow.bold(
      `[${timestamp}] ${walletName.padEnd(25)} | ${parts.slice(1).join(" | ")}`
    );
  }

  if (msg.includes("Error") || msg.includes("failed")) {
    const errorMsg = parts.length > 2 ? parts.slice(2).join(" | ").trim() : msg;
    return chalk.red.bold(
      `[${timestamp}] ${walletName.padEnd(25)} | ${errorMsg}`
    );
  }

  return chalk.hex("#CCCCCC")(
    `[${timestamp}] ${walletName.padEnd(25)} | ${
      parts.slice(parts.length >= 2 ? 1 : 0).join(" | ") || msg
    }`
  );
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function requestInput(promptText, type = "text", defaultValue = "") {
  return new Promise((resolve) => {
    rl.question(
      chalk.greenBright(`${promptText}${defaultValue ? ` [${defaultValue}]` : ""}: `),
      (value) => {
        if (type === "number") value = Number(value);
        if (value === "" || (type === "number" && isNaN(value))) value = defaultValue;
        resolve(value);
      }
    );
  });
}

function displayBanner() {
  console.clear();
  console.log(chalk.hex("#D8BFD8").bold(asciiBannerLines.join("\n")));
  console.log();
}

function displayMenu() {
  console.log(chalk.blueBright.bold("\n>=== Pharos Testnet Bot Menu ===<"));
  menuOptions.forEach((opt, idx) => {
    const optionNumber = `${idx + 1}`.padStart(2, "0");
    console.log(chalk.blue(`  ${optionNumber} > ${opt.label.padEnd(35)} <`));
  });
  console.log(chalk.blueBright.bold(">===============================<\n"));
}

function formatNumber(num, decimals = 4) {
  return Number(num).toFixed(decimals);
}

function getShortAddress(address) {
  return address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "N/A";
}

function loadPrivateKeys() {
  try {
    const data = fs.readFileSync("wallets.txt", "utf8");
    privateKeys = data
      .split("\n")
      .map((key) => {
        key = key.trim();
        if (key.startsWith("0x")) {
          key = key.slice(2);
        }
        return "0x" + key;
      })
      .filter((key) => key.length === 66);

    if (privateKeys.length === 0) throw new Error("No valid private keys");
    return true;
  } catch (error) {
    return false;
  }
}

function loadTargetWallets() {
  try {
    const data = fs.readFileSync("wallet.txt", "utf8");
    targetWallets = data
      .split("\n")
      .map((addr) => {
        try {
          return ethers.getAddress(addr.trim());
        } catch {
          return null;
        }
      })
      .filter((addr) => addr !== null);
  } catch (error) {
    targetWallets = [];
  }
}

function getEthersProvider() {
  return new ethers.JsonRpcProvider(PHAROS_RPC, 688688);
}

async function initializeNonce(provider, address) {
  try {
    const nonce = await provider.getTransactionCount(address, "pending");
    usedNonces[address] = nonce;
    return nonce;
  } catch (error) {
    throw new Error(`Failed to initialize nonce: ${error.message}`);
  }
}

async function makeApiRequest(method, url, data = null, headers = {}) {
  const defaultHeaders = {
    Accept: "application/json, text/plain, */*",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    Origin: "https://testnet.pharosnetwork.xyz",
    Referer: "https://testnet.pharosnetwork.xyz/",
    ...headers,
  };

  const config = {
    method,
    url,
    headers: defaultHeaders,
    timeout: 10000,
  };

  if (data) config.data = data;

  try {
    const response = await axios(config);
    return response.data;
  } catch (error) {
    throw new Error(error.response?.data?.msg || error.message);
  }
}

async function loginAccount(privateKey, logger) {
  try {
    const wallet = new ethers.Wallet(privateKey);
    const timestamp = new Date().toISOString();
    const nonce = Date.now().toString();

    const message = `testnet.pharosnetwork.xyz wants you to sign in with your Ethereum account:\n${wallet.address}\n\nI accept the Pharos Terms of Service: testnet.pharosnetwork.xyz/privacy-policy/Pharos-PrivacyPolicy.pdf\n\nURI: https://testnet.pharosnetwork.xyz\n\nVersion: 1\n\nChain ID: 688688\n\nNonce: ${nonce}\n\nIssued At: ${timestamp}`;

    const signature = await wallet.signMessage(message);

    const loginData = {
      address: wallet.address,
      signature: signature,
      wallet: "OKX Wallet",
      nonce: nonce,
      chain_id: "688688",
      timestamp: timestamp,
      domain: "testnet.pharosnetwork.xyz",
      invite_code: REF_CODE,
    };

    const response = await makeApiRequest("post", `${API_BASE}/user/login`, loginData);

    if (response.code === 0) {
      accountTokens[wallet.address] = response.data.jwt;
      return true;
    }
    return false;
  } catch (error) {
    logger(`${getShortAddress(wallet.address)} | Error: Login failed: ${error.message}`);
    return false;
  }
}

async function getBalances(address, logger) {
  try {
    const provider = getEthersProvider();

    const [phrsBalance, wphrsBalance, usdtBalance] = await Promise.all([
      provider.getBalance(address),
      new ethers.Contract(WPHRS_CONTRACT, ERC20_ABI, provider).balanceOf(address),
      new ethers.Contract(USDT_CONTRACT, ERC20_ABI, provider).balanceOf(address),
    ]);

    return {
      PHRS: formatNumber(ethers.formatEther(phrsBalance)),
      WPHRS: formatNumber(ethers.formatEther(wphrsBalance)),
      USDT: formatNumber(Number(usdtBalance) / 1e6),
    };
  } catch (error) {
    logger(`${getShortAddress(address)} | Error: Failed to fetch balances: ${error.message}`);
    return { PHRS: "0", WPHRS: "0", USDT: "0" };
  }
}

async function performDailySignIn(logger) {
  logger("System | Starting Daily Sign-In...");

  for (let i = 0; i < privateKeys.length; i++) {
    const privateKey = privateKeys[i];
    const wallet = new ethers.Wallet(privateKey);

    logger(`${getShortAddress(wallet.address)} | Processing sign-in for account ${i + 1}`);

    if (!accountTokens[wallet.address]) {
      const loginSuccess = await loginAccount(privateKey, logger);
      if (!loginSuccess) {
        logger(`${getShortAddress(wallet.address)} | Error: Login failed, skipping...`);
        continue;
      }
    }

    try {
      const response = await makeApiRequest(
        "post",
        `${API_BASE}/sign/in`,
        { address: wallet.address },
        { Authorization: `Bearer ${accountTokens[wallet.address]}` }
      );

      if (response.code === 0) {
        logger(`${getShortAddress(wallet.address)} | Success: Daily sign-in successful`);
      } else {
        logger(
          `${getShortAddress(wallet.address)} | Warning: ${response.msg || "Already signed in today"}`
        );
      }
    } catch (error) {
      logger(`${getShortAddress(wallet.address)} | Error: Sign-in error: ${error.message}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  logger("System | Daily Sign-In completed!");
}

async function claimFaucet(logger) {
  logger("System | Starting Faucet Claims...");

  for (let i = 0; i < privateKeys.length; i++) {
    const privateKey = privateKeys[i];
    const wallet = new ethers.Wallet(privateKey);

    logger(`${getShortAddress(wallet.address)} | Processing faucet claim for account ${i + 1}`);

    if (!accountTokens[wallet.address]) {
      const loginSuccess = await loginAccount(privateKey, logger);
      if (!loginSuccess) {
        logger(`${getShortAddress(wallet.address)} | Error: Login failed, skipping...`);
        continue;
      }
    }

    try {
      const statusResponse = await makeApiRequest(
        "get",
        `${API_BASE}/faucet/status?address=${wallet.address}`,
        null,
        { Authorization: `Bearer ${accountTokens[wallet.address]}` }
      );

      if (statusResponse.code === 0 && statusResponse.data.is_able_to_faucet) {
        const claimResponse = await makeApiRequest(
          "post",
          `${API_BASE}/faucet/daily`,
          { address: wallet.address },
          { Authorization: `Bearer ${accountTokens[wallet.address]}` }
        );

        if (claimResponse.code === 0) {
          logger(`${getShortAddress(wallet.address)} | Success: Faucet claimed successfully`);
        } else {
          logger(`${getShortAddress(wallet.address)} | Error: ${claimResponse.msg}`);
        }
      } else {
        logger(`${getShortAddress(wallet.address)} | Warning: Already claimed today`);
      }
    } catch (error) {
      logger(`${getShortAddress(wallet.address)} | Error: Faucet error: ${error.message}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  logger("System | Faucet Claims completed!");
}

async function performTransfers(logger) {
  if (targetWallets.length === 0) {
    logger("System | Warning: No target wallets loaded for transfers");
    return;
  }

  logger("System | Starting Transfers...");

  const transferAmount = "0.001";

  for (let i = 0; i < privateKeys.length; i++) {
    const privateKey = privateKeys[i];
    const provider = getEthersProvider();
    const wallet = new ethers.Wallet(privateKey, provider);

    logger(`${getShortAddress(wallet.address)} | Processing transfers for account ${i + 1}`);

    await initializeNonce(provider, wallet.address);

    for (let j = 0; j < global.maxTransaction; j++) {
      let attempts = 0;
      const maxAttempts = 3;

      while (attempts < maxAttempts) {
        try {
          const toAddress = targetWallets[Math.floor(Math.random() * targetWallets.length)];
          const nonce = await provider.getTransactionCount(wallet.address, "pending");
          usedNonces[wallet.address] = nonce + 1;
          const feeData = await provider.getFeeData();

          const tx = await wallet.sendTransaction({
            to: toAddress,
            value: ethers.parseEther(transferAmount),
            gasLimit: 21000,
            maxFeePerGas: feeData.maxFeePerGas || ethers.parseUnits("1", "gwei"),
            maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || ethers.parseUnits("0.5", "gwei"),
            nonce,
          });

          logger(
            `${getShortAddress(wallet.address)} | Success: Transfer ${j + 1}: ${transferAmount} PHRS to ${getShortAddress(
              toAddress
            )} | Confirmed: ${tx.hash}`
          );
          await tx.wait();
          break; // Success, exit retry loop
        } catch (error) {
          if (error.message.includes("TX_REPLAY_ATTACK") && attempts < maxAttempts - 1) {
            logger(
              `${getShortAddress(wallet.address)} | Warning: Transfer ${j + 1} retry ${attempts + 1} due to TX_REPLAY_ATTACK`
            );
            attempts++;
            await new Promise((resolve) => setTimeout(resolve, 5000)); // Wait 5 seconds before retry
            continue;
          }
          logger(`${getShortAddress(wallet.address)} | Error: Transfer ${j + 1} failed: ${error.message}`);
          break;
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  logger("System | Transfers completed!");
}

async function performWrapUnwrap(isWrap, logger, wallet) {
  const address = wallet.address;
  logger(`${getShortAddress(address)} | Processing ${isWrap ? "wrap" : "unwrap"}...`);

  const provider = getEthersProvider();
  wallet = wallet.connect(provider);

  for (let j = 0; j < global.maxTransaction; j++) {
    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
      try {
        const amount = FIXED_WRAP_AMOUNT;
        const wphrsContract = new ethers.Contract(WPHRS_CONTRACT, ERC20_ABI, wallet);
        const nonce = await provider.getTransactionCount(address, "pending");
        usedNonces[address] = nonce + 1;
        const feeData = await provider.getFeeData();

        if (isWrap) {
          const balance = await provider.getBalance(address);
          const amountWei = BigInt(ethers.parseEther(amount));
          const gasReserve = BigInt(ethers.parseEther("0.001"));
          const needed = amountWei + gasReserve;
          if (BigInt(balance) < needed) {
            logger(`${getShortAddress(address)} | Warning: Insufficient PHRS balance for wrap ${j + 1}`);
            break;
          }
        } else {
          const balance = await wphrsContract.balanceOf(address);
          const amountWei = BigInt(ethers.parseEther(amount));
          if (BigInt(balance) < amountWei) {
            logger(`${getShortAddress(address)} | Warning: Insufficient WPHRS balance for unwrap ${j + 1}`);
            break;
          }
        }

        let tx;
        if (isWrap) {
          tx = await wphrsContract.deposit({
            value: ethers.parseEther(amount),
            gasLimit: 100000,
            maxFeePerGas: feeData.maxFeePerGas || ethers.parseUnits("1", "gwei"),
            maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || ethers.parseUnits("0.5", "gwei"),
            nonce,
          });
          logger(
            `${getShortAddress(address)} | Success: Wrap ${j + 1}: ${amount} PHRS to WPHRS | Confirmed: ${tx.hash}`
          );
        } else {
          tx = await wphrsContract.withdraw(ethers.parseEther(amount), {
            gasLimit: 100000,
            maxFeePerGas: feeData.maxFeePerGas || ethers.parseUnits("1", "gwei"),
            maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || ethers.parseUnits("0.5", "gwei"),
            nonce,
          });
          logger(
            `${getShortAddress(address)} | Success: Unwrap ${j + 1}: ${amount} WPHRS to PHRS | Confirmed: ${tx.hash}`
          );
        }

        await tx.wait();
        break; // Success, exit retry loop
      } catch (error) {
        if (error.message.includes("TX_REPLAY_ATTACK") && attempts < maxAttempts - 1) {
          logger(
            `${getShortAddress(address)} | Warning: ${isWrap ? "Wrap" : "Unwrap"} ${j + 1} retry ${
              attempts + 1
            } due to TX_REPLAY_ATTACK`
          );
          attempts++;
          await new Promise((resolve) => setTimeout(resolve, 5000));
          continue;
        }
        logger(
          `${getShortAddress(address)} | Error: ${isWrap ? "Wrap" : "Unwrap"} ${j + 1} failed: ${error.message}`
        );
        break;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

async function performSwaps(logger, wallet) {
  const address = wallet.address;
  const provider = getEthersProvider();
  wallet = wallet.connect(provider);

  logger(
    `${getShortAddress(address)} | Warning: USDC swaps disabled due to invalid contract address. Please verify USDC address on https://pharos-testnet.socialscan.io/`
  );

  const swapOptions = [
    {
      from: WPHRS_CONTRACT,
      to: USDT_CONTRACT,
      fromName: "WPHRS",
      toName: "USDT",
      amount: "0.0001",
    },
    {
      from: USDT_CONTRACT,
      to: WPHRS_CONTRACT,
      fromName: "USDT",
      toName: "WPHRS",
      amount: "0.45",
    },
  ];

  for (let j = 0; j < global.maxTransaction; j++) {
    const swap = swapOptions[Math.floor(Math.random() * swapOptions.length)];
    const swapAmount = swap.amount;

    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
      try {
        let fromAddress, toAddress;
        try {
          fromAddress = ethers.getAddress(swap.from);
          toAddress = ethers.getAddress(swap.to);
        } catch (error) {
          logger(`${getShortAddress(address)} | Error: Invalid contract address for swap ${j + 1}: ${error.message}`);
          break;
        }

        const tokenContract = new ethers.Contract(fromAddress, ERC20_ABI, wallet);
        const decimals = await tokenContract.decimals().catch(() => {
          logger(`${getShortAddress(address)} | Warning: Failed to fetch decimals for ${swap.fromName}, skipping...`);
          return null;
        });
        if (!decimals) break;

        const amount = ethers.parseUnits(swapAmount, decimals);

        const balance = await tokenContract.balanceOf(address).catch(() => {
          logger(`${getShortAddress(address)} | Warning: Failed to fetch balance for ${swap.fromName}, skipping...`);
          return BigInt(0);
        });
        if (BigInt(balance) < BigInt(amount)) {
          logger(
            `${getShortAddress(address)} | Warning: Insufficient ${swap.fromName} balance for swap ${j + 1}`
          );
          break;
        }

        const allowance = await tokenContract.allowance(address, SWAP_ROUTER).catch(() => BigInt(0));
        if (BigInt(allowance) < BigInt(amount)) {
          logger(`${getShortAddress(address)} | Approving ${swap.fromName}...`);
          const nonce = await provider.getTransactionCount(address, "pending");
          usedNonces[address] = nonce + 1;
          const feeData = await provider.getFeeData();

          const approveTx = await tokenContract.approve(SWAP_ROUTER, ethers.MaxUint256, {
            gasLimit: 100000,
            maxFeePerGas: feeData.maxFeePerGas || ethers.parseUnits("1", "gwei"),
            maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || ethers.parseUnits("0.5", "gwei"),
            nonce,
          });
          logger(`${getShortAddress(address)} | Success: Approved | Confirmed: ${approveTx.hash}`);
          await approveTx.wait();
          await new Promise((resolve) => setTimeout(resolve, 10000));
        }

        const routerContract = new ethers.Contract(SWAP_ROUTER, SWAP_ROUTER_ABI, wallet);
        const deadline = Math.floor(Date.now() / 1000) + 300;

        const abiCoder = new ethers.AbiCoder();
        const encodedData = abiCoder.encode(
          ["address", "address", "uint256", "address", "uint256", "uint256", "uint256"],
          [fromAddress, toAddress, 500, ethers.getAddress(address), amount, 0, 0]
        );
        const multicallData = ["0x04e45aaf" + encodedData.slice(2)];

        const swapNonce = await provider.getTransactionCount(address, "pending");
        usedNonces[address] = swapNonce + 1;
        const swapFeeData = await provider.getFeeData();

        const tx = await routerContract.multicall(deadline, multicallData, {
          gasLimit: 300000,
          maxFeePerGas: swapFeeData.maxFeePerGas || ethers.parseUnits("2", "gwei"),
          maxPriorityFeePerGas: swapFeeData.maxPriorityFeePerGas || ethers.parseUnits("1", "gwei"),
          nonce: swapNonce,
        });

        logger(
          `${getShortAddress(address)} | Success: Swap ${j + 1}: ${swapAmount} ${swap.fromName} to ${
            swap.toName
          } | Confirmed: ${tx.hash}`
        );
        await tx.wait();
        break; // Success, exit retry loop
      } catch (error) {
        if (error.message.includes("TX_REPLAY_ATTACK") && attempts < maxAttempts - 1) {
          logger(
            `${getShortAddress(address)} | Warning: Swap ${j + 1} retry ${attempts + 1} due to TX_REPLAY_ATTACK`
          );
          attempts++;
          await new Promise((resolve) => setTimeout(resolve, 5000));
          continue;
        }
        logger(`${getShortAddress(address)} | Error: Swap ${j + 1} failed: ${error.message}`);
        break;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
}

async function addLiquidity(logger, wallet) {
  const address = wallet.address;
  const provider = getEthersProvider();
  wallet = wallet.connect(provider);

  logger(
    `${getShortAddress(address)} | Warning: USDC liquidity pairs disabled due to invalid contract address. Please verify USDC address on https://pharos-testnet.socialscan.io/`
  );

  const lpOptions = [
    {
      token0: USDT_CONTRACT,
      token1: WPHRS_CONTRACT,
      amount0: "0.45",
      amount1: "0.001",
      name: "USDT/WPHRS",
    },
  ];

  for (let j = 0; j < global.maxTransaction; j++) {
    const lp = lpOptions[Math.floor(Math.random() * lpOptions.length)];

    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
      try {
        let token0, token1;
        try {
          token0 = ethers.getAddress(lp.token0);
          token1 = ethers.getAddress(lp.token1);
        } catch (error) {
          logger(`${getShortAddress(address)} | Error: Invalid contract address for LP ${j + 1}: ${error.message}`);
          break;
        }

        let amount0 = lp.amount0;
        let amount1 = lp.amount1;

        if (token0.toLowerCase() > token1.toLowerCase()) {
          [token0, token1] = [token1, token0];
          [amount0, amount1] = [amount1, amount0];
        }

        const token0Contract = new ethers.Contract(token0, ERC20_ABI, wallet);
        const token1Contract = new ethers.Contract(token1, ERC20_ABI, wallet);

        const decimals0 = await token0Contract.decimals().catch(() => null);
        const decimals1 = await token1Contract.decimals().catch(() => null);
        if (!decimals0 || !decimals1) {
          logger(`${getShortAddress(address)} | Warning: Failed to fetch decimals for LP ${j + 1}, skipping...`);
          break;
        }

        const amount0Wei = ethers.parseUnits(amount0, decimals0);
        const amount1Wei = ethers.parseUnits(amount1, decimals1);

        for (const [contract, amountWei, tokenName] of [
          [token0Contract, amount0Wei, "Token0"],
          [token1Contract, amount1Wei, "Token1"],
        ]) {
          const allowance = await contract.allowance(address, POSITION_MANAGER).catch(() => BigInt(0));
          if (BigInt(allowance) < BigInt(amountWei)) {
            logger(`${getShortAddress(address)} | Approving ${tokenName}...`);
            const nonce = await provider.getTransactionCount(address, "pending");
            usedNonces[address] = nonce + 1;
            const feeData = await provider.getFeeData();

            const approveTx = await contract.approve(POSITION_MANAGER, ethers.MaxUint256, {
              gasLimit: 100000,
              maxFeePerGas: feeData.maxFeePerGas || ethers.parseUnits("1", "gwei"),
              maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || ethers.parseUnits("0.5", "gwei"),
              nonce,
            });
            logger(`${getShortAddress(address)} | Success: Approved | Confirmed: ${approveTx.hash}`);
            await approveTx.wait();
            await new Promise((resolve) => setTimeout(resolve, 10000));
          }
        }

        const lpContract = new ethers.Contract(POSITION_MANAGER, POSITION_MANAGER_ABI, wallet);
        const nonce = await provider.getTransactionCount(address, "pending");
        usedNonces[address] = nonce + 1;
        const feeData = await provider.getFeeData();

        const mintParams = {
          token0: token0,
          token1: token1,
          fee: 500,
          tickLower: -887270,
          tickUpper: 887270,
          amount0Desired: amount0Wei,
          amount1Desired: amount1Wei,
          amount0Min: 0,
          amount1Min: 0,
          recipient: ethers.getAddress(address),
          deadline: Math.floor(Date.now() / 1000) + 600,
        };

        const tx = await lpContract.mint(mintParams, {
          gasLimit: 600000,
          maxFeePerGas: feeData.maxFeePerGas || ethers.parseUnits("5", "gwei"),
          maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || ethers.parseUnits("1", "gwei"),
          nonce,
        });

        logger(
          `${getShortAddress(address)} | Success: LP ${j + 1}: Added liquidity to ${lp.name} | Confirmed: ${tx.hash}`
        );
        await tx.wait();
        break; // Success, exit retry loop
      } catch (error) {
        if (error.message.includes("TX_REPLAY_ATTACK") && attempts < maxAttempts - 1) {
          logger(
            `${getShortAddress(address)} | Warning: LP ${j + 1} retry ${attempts + 1} due to TX_REPLAY_ATTACK`
          );
          attempts++;
          await new Promise((resolve) => setTimeout(resolve, 5000));
          continue;
        }
        logger(`${getShortAddress(address)} | Error: LP ${j + 1} failed: ${error.message}`);
        break;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
}

async function performDomainMintTask(logger, privateKeys, proxies, domainMintCount, usedNonces) {
  const delay = 60; // Hardcoded delay in seconds
  const MAX_RETRY = 5;

  function randomName(length = 9) {
    if (length < 3) length = 3;
    const charsLetters = "abcdefghijklmnopqrstuvwxyz";
    const charsLettersDigits = charsLetters + "0123456789";
    let nameList = [charsLetters[Math.floor(Math.random() * charsLetters.length)]];
    
    for (let i = 0; i < length - 1; i++) {
      if (nameList[nameList.length - 1] === "-") {
        nameList.push(charsLettersDigits[Math.floor(Math.random() * charsLettersDigits.length)]);
      } else {
        const chars = charsLettersDigits + "-";
        nameList.push(chars[Math.floor(Math.random() * chars.length)]);
      }
    }

    if (nameList[nameList.length - 1] === "-") {
      nameList[nameList.length - 1] = charsLettersDigits[Math.floor(Math.random() * charsLettersDigits.length)];
    }

    let cleanedName = [];
    for (let i = 0; i < nameList.length; i++) {
      if (nameList[i] === "-" && cleanedName.length > 0 && cleanedName[cleanedName.length - 1] === "-") {
        cleanedName.push(charsLettersDigits[Math.floor(Math.random() * charsLettersDigits.length)]);
      } else {
        cleanedName.push(nameList[i]);
      }
    }

    while (cleanedName.length < length) {
      if (cleanedName.length > 0 && cleanedName[cleanedName.length - 1] === "-") {
        cleanedName.push(charsLettersDigits[Math.floor(Math.random() * charsLettersDigits.length)]);
      } else {
        const chars = charsLettersDigits + "-";
        cleanedName.push(chars[Math.floor(Math.random() * chars.length)]);
      }
    }

    let finalResult = cleanedName.slice(0, length).join("");
    if (finalResult.startsWith("-")) {
      finalResult = charsLettersDigits[Math.floor(Math.random() * charsLettersDigits.length)] + finalResult.slice(1);
    }
    if (finalResult.endsWith("-")) {
      finalResult = finalResult.slice(0, -1) + charsLettersDigits[Math.floor(Math.random() * charsLettersDigits.length)];
    }

    finalResult = finalResult.replace(/--/g, () => {
      return charsLettersDigits[Math.floor(Math.random() * charsLettersDigits.length)] + charsLettersDigits[Math.floor(Math.random() * charsLettersDigits.length)];
    });

    while (finalResult.length < length) {
      finalResult += charsLettersDigits[Math.floor(Math.random() * charsLettersDigits.length)];
    }

    return finalResult.slice(0, length);
  }

  function validatePrivateKey(privateKey) {
    if (privateKey.startsWith("0x")) privateKey = privateKey.slice(2);
    return privateKey.length === 64 && /^[0-9a-fA-F]+$/.test(privateKey);
  }

  logger("System | Starting Domain Mint Task...");

  for (let i = 0; i < privateKeys.length; i++) {
    const privateKey = privateKeys[i];
    const walletLogPrefix = `Wallet #${i + 1}`;
    
    if (!validatePrivateKey(privateKey)) {
      logger(`${walletLogPrefix} | Error: Invalid private key, skipping...`);
      continue;
    }

    const provider = new ethers.JsonRpcProvider(DOMAIN_CONFIG.RPC_URL, DOMAIN_CONFIG.CHAIN_ID);
    let ownerAddress, controllerAddress, resolverAddress;

    try {
      const wallet = new ethers.Wallet(privateKey, provider);
      ownerAddress = wallet.address;
      controllerAddress = ethers.getAddress(DOMAIN_CONFIG.CONTROLLER_ADDRESS);
      resolverAddress = ethers.getAddress(DOMAIN_CONFIG.RESOLVER);
    } catch (error) {
      logger(`${walletLogPrefix} | Error: Invalid contract or resolver address: ${error.message}`);
      continue;
    }

    logger(`${getShortAddress(ownerAddress)} | Processing Domain Mint for account ${i + 1}`);

    for (let j = 0; j < domainMintCount; j++) {
      const regIndex = j + 1;
      const domainName = randomName();
      const logPrefix = `${walletLogPrefix} | Attempt ${regIndex} | ${domainName}.phrs`;

      let domainRegistered = false;
      let retry = 0;

      while (retry < MAX_RETRY && !domainRegistered) {
        try {
          const wallet = new ethers.Wallet(privateKey, provider);
          const controller = new ethers.Contract(controllerAddress, CONTROLLER_ABI, wallet);
          const secret = "0x" + crypto.randomBytes(32).toString("hex");

          logger(`${logPrefix} | COMMIT - Creating commitment...`);
          const commitment = await controller.makeCommitment(
            domainName,
            ownerAddress,
            DOMAIN_CONFIG.DURATION,
            secret,
            resolverAddress,
            DOMAIN_CONFIG.DATA,
            DOMAIN_CONFIG.REVERSE_RECORD,
            DOMAIN_CONFIG.OWNER_CONTROLLED_FUSES
          );

          logger(`${logPrefix} | COMMIT - Sending transaction...`);
          const commitTx = await controller.commit(commitment, {
            gasLimit: 200000,
            maxFeePerGas: (await provider.getFeeData()).maxFeePerGas || ethers.parseUnits("1", "gwei"),
            maxPriorityFeePerGas: (await provider.getFeeData()).maxPriorityFeePerGas || ethers.parseUnits("0.5", "gwei"),
            nonce: usedNonces[ownerAddress] || (await provider.getTransactionCount(ownerAddress, "pending")),
          });

          const commitReceipt = await commitTx.wait();
          if (commitReceipt.status === 1) {
            logger(`${logPrefix} | Success: COMMIT - Confirmed: ${commitTx.hash}`);
          } else {
            throw new Error(`Commitment transaction failed. TX Hash: ${commitTx.hash}`);
          }

          logger(`${logPrefix} | WAITING ${delay} seconds...`);
          await new Promise((resolve) => setTimeout(resolve, delay * 1000));

          logger(`${logPrefix} | REGISTER - Calculating rent price...`);
          const price = await controller.rentPrice(domainName, DOMAIN_CONFIG.DURATION);
          const value = BigInt(price.base) + BigInt(price.premium);
          logger(`${logPrefix} | REGISTER - Rent price: ${ethers.formatEther(value)} ETH`);

          logger(`${logPrefix} | REGISTER - Sending transaction...`);
          const registerTx = await controller.register(
            domainName,
            ownerAddress,
            DOMAIN_CONFIG.DURATION,
            secret,
            resolverAddress,
            DOMAIN_CONFIG.DATA,
            DOMAIN_CONFIG.REVERSE_RECORD,
            DOMAIN_CONFIG.OWNER_CONTROLLED_FUSES,
            {
              gasLimit: 300000,
              maxFeePerGas: (await provider.getFeeData()).maxFeePerGas || ethers.parseUnits("1", "gwei"),
              maxPriorityFeePerGas: (await provider.getFeeData()).maxPriorityFeePerGas || ethers.parseUnits("0.5", "gwei"),
              value: value.toString(),
              nonce: usedNonces[ownerAddress] || (await provider.getTransactionCount(ownerAddress, "pending")),
            }
          );

          const registerReceipt = await registerTx.wait();
          if (registerReceipt.status === 1) {
            logger(`${logPrefix} | Success: REGISTER - Domain registered | Confirmed: ${registerTx.hash}`);
            domainRegistered = true;
            usedNonces[ownerAddress] = (usedNonces[ownerAddress] || (await provider.getTransactionCount(ownerAddress, "pending"))) + 1;
          } else {
            throw new Error(`Registration transaction failed. TX Hash: ${registerTx.hash}`);
          }
        } catch (error) {
          retry++;
          const msg = error.message.length > 150 ? error.message.slice(0, 150) + "..." : error.message;
          logger(`${logPrefix} | Error: ${msg} - retrying (${retry}/${MAX_RETRY}) in ${delay} seconds...`);
          await new Promise((resolve) => setTimeout(resolve, delay * 1000));
        }
      }

      if (!domainRegistered) {
        logger(`${logPrefix} | Error: Failed to register domain after ${MAX_RETRY} retries`);
      }
    }
  }

  logger("System | Domain Mint Task completed!");
}

async function displayAccounts(logger) {
  logger("System | Displaying Account Balances...");

  const table = new Table({
    head: ["#", "Address", "PHRS", "WPHRS", "USDT"],
    colWidths: [5, 20, 12, 12, 12],
    style: { head: ["cyan"] },
  });

  for (let i = 0; i < privateKeys.length; i++) {
    const wallet = new ethers.Wallet(privateKeys[i]);
    const balances = await getBalances(wallet.address, logger);

    table.push([
      i + 1,
      getShortAddress(wallet.address),
      balances.PHRS,
      balances.WPHRS,
      balances.USDT,
    ]);
  }

  console.log(table.toString());
  logger("System | Account Balances displayed!");
}

async function runAllActivities(logger) {
  logger("System | Starting Run All Activities...");

  for (let i = 0; i < privateKeys.length; i++) {
    const privateKey = privateKeys[i];
    const provider = getEthersProvider();
    const wallet = new ethers.Wallet(privateKey, provider);

    logger(`${getShortAddress(wallet.address)} | Starting activities for account ${i + 1}`);

    await initializeNonce(provider, wallet.address);

    // 1. Daily Sign-In
    logger(`${getShortAddress(wallet.address)} | Processing Daily Sign-In...`);
    try {
      if (!accountTokens[wallet.address]) {
        const loginSuccess = await loginAccount(privateKey, logger);
        if (!loginSuccess) {
          logger(`${getShortAddress(wallet.address)} | Error: Login failed, skipping sign-in...`);
        } else {
          const response = await makeApiRequest(
            "post",
            `${API_BASE}/sign/in`,
            { address: wallet.address },
            { Authorization: `Bearer ${accountTokens[wallet.address]}` }
          );

          if (response.code === 0) {
            logger(`${getShortAddress(wallet.address)} | Success: Daily sign-in successful`);
          } else {
            logger(
              `${getShortAddress(wallet.address)} | Warning: ${response.msg || "Already signed in today"}`
            );
          }
        }
      } else {
        const response = await makeApiRequest(
          "post",
          `${API_BASE}/sign/in`,
          { address: wallet.address },
          { Authorization: `Bearer ${accountTokens[wallet.address]}` }
        );

        if (response.code === 0) {
          logger(`${getShortAddress(wallet.address)} | Success: Daily sign-in successful`);
        } else {
          logger(
            `${getShortAddress(wallet.address)} | Warning: ${response.msg || "Already signed in today"}`
          );
        }
      }
    } catch (error) {
      logger(`${getShortAddress(wallet.address)} | Error: Sign-in failed: ${error.message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // 2. Claim Faucet
    logger(`${getShortAddress(wallet.address)} | Processing Faucet Claim...`);
    try {
      if (!accountTokens[wallet.address]) {
        const loginSuccess = await loginAccount(privateKey, logger);
        if (!loginSuccess) {
          logger(`${getShortAddress(wallet.address)} | Error: Login failed, skipping faucet...`);
        } else {
          const statusResponse = await makeApiRequest(
            "get",
            `${API_BASE}/faucet/status?address=${wallet.address}`,
            null,
            { Authorization: `Bearer ${accountTokens[wallet.address]}` }
          );

          if (statusResponse.code === 0 && statusResponse.data.is_able_to_faucet) {
            const claimResponse = await makeApiRequest(
              "post",
              `${API_BASE}/faucet/daily`,
              { address: wallet.address },
              { Authorization: `Bearer ${accountTokens[wallet.address]}` }
            );

            if (claimResponse.code === 0) {
              logger(`${getShortAddress(wallet.address)} | Success: Faucet claimed successfully`);
            } else {
              logger(`${getShortAddress(wallet.address)} | Error: ${claimResponse.msg}`);
            }
          } else {
            logger(`${getShortAddress(wallet.address)} | Warning: Already claimed today`);
          }
        }
      } else {
        const statusResponse = await makeApiRequest(
          "get",
          `${API_BASE}/faucet/status?address=${wallet.address}`,
          null,
          { Authorization: `Bearer ${accountTokens[wallet.address]}` }
        );

        if (statusResponse.code === 0 && statusResponse.data.is_able_to_faucet) {
          const claimResponse = await makeApiRequest(
            "post",
            `${API_BASE}/faucet/daily`,
            { address: wallet.address },
            { Authorization: `Bearer ${accountTokens[wallet.address]}` }
          );

          if (claimResponse.code === 0) {
            logger(`${getShortAddress(wallet.address)} | Success: Faucet claimed successfully`);
          } else {
            logger(`${getShortAddress(wallet.address)} | Error: ${claimResponse.msg}`);
          }
        } else {
          logger(`${getShortAddress(wallet.address)} | Warning: Already claimed today`);
        }
      }
    } catch (error) {
      logger(`${getShortAddress(wallet.address)} | Error: Faucet claim failed: ${error.message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // 3. Transfers
    if (targetWallets.length > 0) {
      logger(`${getShortAddress(wallet.address)} | Processing Transfers...`);
      for (let j = 0; j < global.maxTransaction; j++) {
        let attempts = 0;
        const maxAttempts = 3;

        while (attempts < maxAttempts) {
          try {
            const toAddress = targetWallets[Math.floor(Math.random() * targetWallets.length)];
            const nonce = await provider.getTransactionCount(wallet.address, "pending");
            usedNonces[wallet.address] = nonce + 1;
            const feeData = await provider.getFeeData();

            const tx = await wallet.sendTransaction({
              to: toAddress,
              value: ethers.parseEther("0.001"),
              gasLimit: 21000,
              maxFeePerGas: feeData.maxFeePerGas || ethers.parseUnits("1", "gwei"),
              maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || ethers.parseUnits("0.5", "gwei"),
              nonce,
            });

            logger(
              `${getShortAddress(wallet.address)} | Success: Transfer ${j + 1}: 0.001 PHRS to ${getShortAddress(
                toAddress
              )} | Confirmed: ${tx.hash}`
            );
            await tx.wait();
            break;
          } catch (error) {
            if (error.message.includes("TX_REPLAY_ATTACK") && attempts < maxAttempts - 1) {
              logger(
                `${getShortAddress(wallet.address)} | Warning: Transfer ${j + 1} retry ${attempts + 1} due to TX_REPLAY_ATTACK`
              );
              attempts++;
              await new Promise((resolve) => setTimeout(resolve, 5000));
              continue;
            }
            logger(`${getShortAddress(wallet.address)} | Error: Transfer ${j + 1} failed: ${error.message}`);
            break;
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    } else {
      logger(`${getShortAddress(wallet.address)} | Warning: No target wallets loaded for transfers`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // 4. Wrap PHRS to WPHRS
    logger(`${getShortAddress(wallet.address)} | Processing Wrap PHRS to WPHRS...`);
    await performWrapUnwrap(true, logger, wallet);
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // 5. Unwrap WPHRS to PHRS
    logger(`${getShortAddress(wallet.address)} | Processing Unwrap WPHRS to PHRS...`);
    await performWrapUnwrap(false, logger, wallet);
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // 6. Swaps
    logger(`${getShortAddress(wallet.address)} | Processing Swaps...`);
    await performSwaps(logger, wallet);
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // 7. Add Liquidity
    logger(`${getShortAddress(wallet.address)} | Processing Add Liquidity...`);
    await addLiquidity(logger, wallet);
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // 8. AquaFlux Mint
    if (global.aquaFluxMintCount > 0) {
      logger(`${getShortAddress(wallet.address)} | Processing AquaFlux Mint...`);
      await performAquaFluxMint(logger, [privateKey], [], global.aquaFluxMintCount, usedNonces);
    } else {
      logger(`${getShortAddress(wallet.address)} | Warning: AquaFlux mint count is 0, skipping...`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // 9. Send Tip (PrimusLab)
    if (global.tipUsername && global.tipCount > 0) {
      logger(`${getShortAddress(wallet.address)} | Processing Send Tip (PrimusLab)...`);
      await sendTipTask(logger, [privateKey], [], global.tipCount, global.tipUsername, usedNonces);
    } else {
      logger(
        `${getShortAddress(wallet.address)} | Warning: No X username or tip count provided, skipping tips...`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // 10. Faroswap Task
    if (global.faroswapTxCount > 0) {
      logger(`${getShortAddress(wallet.address)} | Processing Faroswap Task...`);
      await performFaroswapTask(
        logger,
        [privateKey],
        [],
        global.faroswapTxCount,
        usedNonces
      );
    } else {
      logger(`${getShortAddress(wallet.address)} | Warning: Faroswap transaction count is 0, skipping...`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // 11. AutoStaking Task
    if (global.autoStakingTxCount > 0) {
      logger(`${getShortAddress(wallet.address)} | Processing AutoStaking Task...`);
      await performAutoStakingTask(
        logger,
        [privateKey],
        [],
        global.autoStakingTxCount,
        global.autoStakingMinDelay,
        global.autoStakingMaxDelay,
        global.autoStakingUsdcAmount,
        global.autoStakingUsdtAmount,
        global.autoStakingMusdAmount,
        global.autoStakingUseProxy,
        global.autoStakingRotateProxy,
        usedNonces
      );
    } else {
      logger(`${getShortAddress(wallet.address)} | Warning: AutoStaking transaction count is 0, skipping...`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // 12. Domain Mint Task
    if (global.domainMintCount > 0) {
      logger(`${getShortAddress(wallet.address)} | Processing Domain Mint Task...`);
      await performDomainMintTask(
        logger,
        [privateKey],
        [],
        global.domainMintCount,
        usedNonces
      );
    } else {
      logger(`${getShortAddress(wallet.address)} | Warning: Domain mint count is 0, skipping...`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // 13. OpenFi Task
    if (global.openFiTxCount > 0) {
      logger(`${getShortAddress(wallet.address)} | Processing OpenFi Task...`);
      await performOpenFiTask(
        logger,
        [privateKey],
        [],
        global.openFiTxCount,
        usedNonces
      );
    } else {
      logger(`${getShortAddress(wallet.address)} | Warning: OpenFi transaction count is 0, skipping...`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));

    logger(`${getShortAddress(wallet.address)} | All activities completed for account ${i + 1}`);
  }

  logger("System | All activities completed for all accounts!");
}

async function mainMenu(logger) {
  while (true) {
    displayBanner();
    displayMenu();
    const choice = await requestInput(`Select an option (1-${menuOptions.length})`, "number");
    const idx = choice - 1;

    if (isNaN(idx) || idx < 0 || idx >= menuOptions.length) {
      logger("System | Error: Invalid option. Try again.");
      await new Promise((resolve) => setTimeout(resolve, 1000));
      continue;
    }

    const selected = menuOptions[idx];
    if (selected.value === "exit") {
      logger("System | Exiting...");
      await new Promise((resolve) => setTimeout(resolve, 500));
      rl.close();
      process.exit(0);
    }

    if (selected.value === "setTransactionCount") {
      const newTxCount = await requestInput(
        "Enter number of transactions",
        "number",
        global.maxTransaction.toString()
      );
      if (isNaN(newTxCount) || newTxCount <= 0) {
        logger("System | Error: Invalid transaction count. Keeping current: " + global.maxTransaction);
      } else {
        global.maxTransaction = newTxCount;
        logger(`System | Success: Set transaction count to: ${newTxCount}`);
      }
      const newMintCount = await requestInput(
        "Enter number of AquaFlux mints",
        "number",
        global.aquaFluxMintCount.toString()
      );
      if (isNaN(newMintCount) || newMintCount < 0) {
        logger(
          "System | Error: Invalid AquaFlux mint count. Keeping current: " + global.aquaFluxMintCount
        );
      } else {
        global.aquaFluxMintCount = newMintCount;
        logger(`System | Success: Set AquaFlux mint count to: ${newMintCount}`);
      }
      const newTipCount = await requestInput(
        "Enter number of tips",
        "number",
        global.tipCount.toString()
      );
      if (isNaN(newTipCount) || newTipCount < 0) {
        logger("System | Error: Invalid tip count. Keeping current: " + global.tipCount);
      } else {
        global.tipCount = newTipCount;
        logger(`System | Success: Set tip count to: ${newTipCount}`);
      }
      const newTipUsername = await requestInput(
        "Enter X username to tip",
        "text",
        global.tipUsername
      );
      global.tipUsername = newTipUsername;
      logger(`System | Success: Set tip username to: ${newTipUsername}`);
      const newFaroswapTxCount = await requestInput(
        "Enter number of Faroswap transactions",
        "number",
        global.faroswapTxCount.toString()
      );
      if (isNaN(newFaroswapTxCount) || newFaroswapTxCount < 0) {
        logger(
          "System | Error: Invalid Faroswap transaction count. Keeping current: " + global.faroswapTxCount
        );
      } else {
        global.faroswapTxCount = newFaroswapTxCount;
        logger(`System | Success: Set Faroswap transaction count to: ${newFaroswapTxCount}`);
      }
      const newAutoStakingTxCount = await requestInput(
        "Enter number of AutoStaking transactions",
        "number",
        global.autoStakingTxCount.toString()
      );
      if (isNaN(newAutoStakingTxCount) || newAutoStakingTxCount < 0) {
        logger(
          "System | Error: Invalid AutoStaking transaction count. Keeping current: " + global.autoStakingTxCount
        );
      } else {
        global.autoStakingTxCount = newAutoStakingTxCount;
        logger(`System | Success: Set AutoStaking transaction count to: ${newAutoStakingTxCount}`);
      }
      const newAutoStakingMinDelay = await requestInput(
        "Enter minimum delay between AutoStaking transactions (seconds)",
        "number",
        global.autoStakingMinDelay.toString()
      );
      if (isNaN(newAutoStakingMinDelay) || newAutoStakingMinDelay < 0) {
        logger(
          "System | Error: Invalid AutoStaking min delay. Keeping current: " + global.autoStakingMinDelay
        );
      } else {
        global.autoStakingMinDelay = newAutoStakingMinDelay;
        logger(`System | Success: Set AutoStaking min delay to: ${newAutoStakingMinDelay} seconds`);
      }
      const newAutoStakingMaxDelay = await requestInput(
        "Enter maximum delay between AutoStaking transactions (seconds)",
        "number",
        global.autoStakingMaxDelay.toString()
      );
      if (isNaN(newAutoStakingMaxDelay) || newAutoStakingMaxDelay < 0) {
        logger(
          "System | Error: Invalid AutoStaking max delay. Keeping current: " + global.autoStakingMaxDelay
        );
      } else {
        global.autoStakingMaxDelay = newAutoStakingMaxDelay;
        logger(`System | Success: Set AutoStaking max delay to: ${newAutoStakingMaxDelay} seconds`);
      }
      const newAutoStakingUsdcAmount = await requestInput(
        "Enter USDC amount for AutoStaking",
        "number",
        global.autoStakingUsdcAmount.toString()
      );
      if (isNaN(newAutoStakingUsdcAmount) || newAutoStakingUsdcAmount <= 0) {
        logger(
          "System | Error: Invalid AutoStaking USDC amount. Keeping current: " + global.autoStakingUsdcAmount
        );
      } else {
        global.autoStakingUsdcAmount = newAutoStakingUsdcAmount;
        logger(`System | Success: Set AutoStaking USDC amount to: ${newAutoStakingUsdcAmount}`);
      }
      const newAutoStakingUsdtAmount = await requestInput(
        "Enter USDT amount for AutoStaking",
        "number",
        global.autoStakingUsdtAmount.toString()
      );
      if (isNaN(newAutoStakingUsdtAmount) || newAutoStakingUsdtAmount <= 0) {
        logger(
          "System | Error: Invalid AutoStaking USDT amount. Keeping current: " + global.autoStakingUsdtAmount
        );
      } else {
        global.autoStakingUsdtAmount = newAutoStakingUsdtAmount;
        logger(`System | Success: Set AutoStaking USDT amount to: ${newAutoStakingUsdtAmount}`);
      }
      const newAutoStakingMusdAmount = await requestInput(
        "Enter MockUSD amount for AutoStaking",
        "number",
        global.autoStakingMusdAmount.toString()
      );
      if (isNaN(newAutoStakingMusdAmount) || newAutoStakingMusdAmount <= 0) {
        logger(
          "System | Error: Invalid AutoStaking MockUSD amount. Keeping current: " + global.autoStakingMusdAmount
        );
      } else {
        global.autoStakingMusdAmount = newAutoStakingMusdAmount;
        logger(`System | Success: Set AutoStaking MockUSD amount to: ${newAutoStakingMusdAmount}`);
      }
      const newAutoStakingUseProxy = await requestInput(
        "Use proxy for AutoStaking? (true/false)",
        "text",
        global.autoStakingUseProxy.toString()
      );
      global.autoStakingUseProxy = newAutoStakingUseProxy.toLowerCase() === "true";
      logger(`System | Success: Set AutoStaking use proxy to: ${global.autoStakingUseProxy}`);
      const newAutoStakingRotateProxy = await requestInput(
        "Rotate proxy for AutoStaking? (true/false)",
        "text",
        global.autoStakingRotateProxy.toString()
      );
      global.autoStakingRotateProxy = newAutoStakingRotateProxy.toLowerCase() === "true";
      logger(`System | Success: Set AutoStaking rotate proxy to: ${global.autoStakingRotateProxy}`);
      const newDomainMintCount = await requestInput(
        "Enter number of Domain mints",
        "number",
        global.domainMintCount.toString()
      );
      if (isNaN(newDomainMintCount) || newDomainMintCount < 0) {
        logger(
          "System | Error: Invalid Domain mint count. Keeping current: " + global.domainMintCount
        );
      } else {
        global.domainMintCount = newDomainMintCount;
        logger(`System | Success: Set Domain mint count to: ${newDomainMintCount}`);
      }
      const newOpenFiTxCount = await requestInput(
        "Enter number of OpenFi transactions",
        "number",
        global.openFiTxCount.toString()
      );
      if (isNaN(newOpenFiTxCount) || newOpenFiTxCount < 0) {
        logger(
          "System | Error: Invalid OpenFi transaction count. Keeping current: " + global.openFiTxCount
        );
      } else {
        global.openFiTxCount = newOpenFiTxCount;
        logger(`System | Success: Set OpenFi transaction count to: ${newOpenFiTxCount}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
      continue;
    }

    try {
      logger(`System | Starting ${selected.label}...`);
      const functions = {
        performDailySignIn,
        claimFaucet,
        performTransfers,
        performWrap: async () => {
          for (let i = 0; i < privateKeys.length; i++) {
            const privateKey = privateKeys[i];
            const wallet = new ethers.Wallet(privateKey);
            await performWrapUnwrap(true, logger, wallet);
          }
        },
        performUnwrap: async () => {
          for (let i = 0; i < privateKeys.length; i++) {
            const privateKey = privateKeys[i];
            const wallet = new ethers.Wallet(privateKey);
            await performWrapUnwrap(false, logger, wallet);
          }
        },
        performSwaps: async () => {
          for (let i = 0; i < privateKeys.length; i++) {
            const privateKey = privateKeys[i];
            const wallet = new ethers.Wallet(privateKey);
            await performSwaps(logger, wallet);
          }
        },
        addLiquidity: async () => {
          for (let i = 0; i < privateKeys.length; i++) {
            const privateKey = privateKeys[i];
            const wallet = new ethers.Wallet(privateKey);
            await addLiquidity(logger, wallet);
          }
        },
        performAquaFluxMint: async () => {
          await performAquaFluxMint(logger, privateKeys, [], global.aquaFluxMintCount, usedNonces);
        },
        sendTip: async () => {
          await sendTipTask(logger, privateKeys, [], global.tipCount, global.tipUsername, usedNonces);
        },
        performFaroswapTask: async () => {
          await performFaroswapTask(
            logger,
            privateKeys,
            [],
            global.faroswapTxCount,
            usedNonces
          );
        },
        performAutoStakingTask: async () => {
          await performAutoStakingTask(
            logger,
            privateKeys,
            [],
            global.autoStakingTxCount,
            global.autoStakingMinDelay,
            global.autoStakingMaxDelay,
            global.autoStakingUsdcAmount,
            global.autoStakingUsdtAmount,
            global.autoStakingMusdAmount,
            global.autoStakingUseProxy,
            global.autoStakingRotateProxy,
            usedNonces
          );
        },
        performDomainMintTask: async () => {
          await performDomainMintTask(
            logger,
            privateKeys,
            [],
            global.domainMintCount,
            usedNonces
          );
        },
        performOpenFiTask: async () => {
          await performOpenFiTask(logger, privateKeys, [], global.openFiTxCount, usedNonces);
        },
        displayAccounts,
        runAllActivities,
      };
      const scriptFunc = functions[selected.value];
      if (scriptFunc) {
        await scriptFunc(logger);
        logger(`System | ${selected.label} completed.`);
      } else {
        logger(`System | Error: ${selected.label} not implemented.`);
      }
    } catch (e) {
      logger(`System | Error in ${selected.label}: ${chalk.red(e.message)}`);
    }

    await requestInput("Press Enter to continue...");
  }
}

async function main() {
  const logger = (message) => console.log(formatLogMessage(message));

  displayBanner();

  if (!loadPrivateKeys()) {
    logger("System | Error: No valid private keys found in wallets.txt. Please add at least one private key.");
    await new Promise((resolve) => setTimeout(resolve, 2000));
    process.exit(1);
  }

  loadTargetWallets();

  logger(`System | Loaded ${privateKeys.length} private keys, ${targetWallets.length} target wallets`);

  await mainMenu(logger);
}

main().catch((err) => {
  console.error(chalk.red("Fatal error:"), err);
  process.exit(1);
});
