const axios = require("axios");
const crypto = require("crypto");
const { HttpsProxyAgent } = require("https-proxy-agent");
const { SocksProxyAgent } = require("socks-proxy-agent");
const chalk = require("chalk").default || require("chalk");
const UserAgent = require("fake-useragent");
const ethers = require("ethers");

// ---- CONSTANTS ----
const PUBLIC_KEY_PEM = `
-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDWPv2qP8+xLABhn3F/U/hp76HP
e8dD7kvPUh70TC14kfvwlLpCTHhYf2/6qulU1aLWpzCz3PJr69qonyqocx8QlThq
5Hik6H/5fmzHsjFvoPeGN5QRwYsVUH07MbP7MNbJH5M2zD5Z1WEp9AHJklITbS1z
h23cf2WfZ0vwDYzZ8QIDAQAB
-----END PUBLIC KEY-----
`;

const RPC_URL = "https://testnet.dplabs-internal.com/";
const USDC_CONTRACT_ADDRESS = "0x72df0bcd7276f2dFbAc900D1CE63c272C4BCcCED";
const USDT_CONTRACT_ADDRESS = "0xD4071393f8716661958F766DF660033b3d35fD29";
const MUSD_CONTRACT_ADDRESS = "0x7F5e05460F927Ee351005534423917976F92495e";
const mvMUSD_CONTRACT_ADDRESS = "0xF1CF5D79bE4682D50f7A60A047eACa9bD351fF8e";
const STAKING_ROUTER_ADDRESS = "0x11cD3700B310339003641Fdce57c1f9BD21aE015";
const BASE_API = "https://api.autostaking.pro";

const ERC20_CONTRACT_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "address", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "claimFaucet",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
];

const AUTOSTAKING_CONTRACT_ABI = [
  {
    type: "function",
    name: "getNextFaucetClaimTime",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
];

const PROMPT = `1. Mandatory Requirement: The product's TVL must be higher than one million USD.
2. Balance Preference: Prioritize products that have a good balance of high current APY and high TVL.
3. Portfolio Allocation: Select the 3 products with the best combined ranking in terms of current APY and TVL among those with TVL > 1,000,000 USD. To determine the combined ranking, rank all eligible products by current APY (highest to lowest) and by TVL (highest to lowest), then sum the two ranks for each product. Choose the 3 products with the smallest sum of ranks. Allocate the investment equally among these 3 products, with each receiving approximately 33.3% of the investment.`;

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

function createProxyAgent(proxyUrl) {
  if (!proxyUrl) return null;
  try {
    if (proxyUrl.startsWith("socks")) {
      return new SocksProxyAgent(proxyUrl);
    } else if (proxyUrl.startsWith("http")) {
      return new HttpsProxyAgent(proxyUrl);
    }
    return null;
  } catch (error) {
    return null;
  }
}

function getEthersProvider(proxyUrl = null) {
  const options = {
    headers: { "User-Agent": "Mozilla/5.0" },
  };
  if (proxyUrl) {
    const agent = createProxyAgent(proxyUrl);
    if (agent) options.agent = agent;
  }
  return new ethers.JsonRpcProvider(RPC_URL, undefined, options);
}

async function makeApiRequest(method, url, data = null, headers = {}, proxyUrl = null, rotateProxy = false, proxies = [], retries = 3) {
  const userAgent = new UserAgent();
  const defaultHeaders = {
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
    Origin: "https://autostaking.pro",
    Referer: "https://autostaking.pro/",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-site",
    "User-Agent": userAgent.random,
    ...headers,
  };
  const config = { method, url, headers: defaultHeaders, timeout: 60000 };
  if (data) config.data = data;
  if (proxyUrl) {
    const agent = createProxyAgent(proxyUrl);
    if (agent) {
      config.httpsAgent = agent;
      config.httpAgent = agent;
    }
  }
  let currentProxy = proxyUrl;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await axios(config);
      return response.data;
    } catch (error) {
      const errorMsg = error.response
        ? `HTTP ${error.response.status}: ${error.response.data?.msg || error.message}`
        : error.message;
      if (attempt === retries || !rotateProxy) {
        throw new Error(errorMsg);
      }
      const proxyIndex = proxies.indexOf(currentProxy);
      currentProxy = proxies[(proxyIndex + 1) % proxies.length] || null;
      config.httpsAgent = createProxyAgent(currentProxy);
      config.httpAgent = createProxyAgent(currentProxy);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

// ---- MAIN FUNCTION ----
async function performAutoStakingTask(
  logger,
  privateKeys,
  proxies,
  stakingCount,
  minDelay,
  maxDelay,
  usdcAmount,
  usdtAmount,
  musdAmount,
  useProxy,
  rotateProxy,
  usedNonces
) {
  logger("System | Starting AutoStaking Task...");

  const generateAddress = (privateKey) => {
    try {
      const wallet = new ethers.Wallet(privateKey);
      return wallet.address;
    } catch (error) {
      logger(`System | Error: Generate address failed: ${error.message}`);
      return null;
    }
  };

  const getShortAddress = (address) => {
    return address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "N/A";
  };

  const generateAuthToken = (address) => {
    try {
      const publicKey = crypto.createPublicKey(PUBLIC_KEY_PEM);
      const ciphertext = crypto.publicEncrypt(
        {
          key: publicKey,
          padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
          oaepHash: "sha256",
        },
        Buffer.from(address)
      );
      return ciphertext.toString("base64");
    } catch (error) {
      logger(`System | Error: Generate auth token failed: ${error.message}`);
      return null;
    }
  };

  const generateRecommendationPayload = (address) => {
    try {
      const usdcAssets = Math.floor(usdcAmount * 10 ** 6);
      const usdtAssets = Math.floor(usdtAmount * 10 ** 6);
      const musdAssets = Math.floor(musdAmount * 10 ** 6);

      return {
        user: address,
        profile: PROMPT,
        userPositions: [],
        userAssets: [
          {
            chain: { id: 688688 },
            name: "USDC",
            symbol: "USDC",
            decimals: 6,
            address: USDC_CONTRACT_ADDRESS,
            assets: usdcAssets.toString(),
            price: 1,
            assetsUsd: usdcAmount,
          },
          {
            chain: { id: 688688 },
            name: "USDT",
            symbol: "USDT",
            decimals: 6,
            address: USDT_CONTRACT_ADDRESS,
            assets: usdtAssets.toString(),
            price: 1,
            assetsUsd: usdtAmount,
          },
          {
            chain: { id: 688688 },
            name: "MockUSD",
            symbol: "MockUSD",
            decimals: 6,
            address: MUSD_CONTRACT_ADDRESS,
            assets: musdAssets.toString(),
            price: 1,
            assetsUsd: musdAmount,
          },
        ],
        chainIds: [688688],
        tokens: ["USDC", "USDT", "MockUSD"],
        protocols: ["MockVault"],
        env: "pharos",
      };
    } catch (error) {
      throw new Error(`Generate recommendation payload failed: ${error.message}`);
    }
  };

  const generateTransactionsPayload = (address, changeTx) => {
    try {
      return {
        user: address,
        changes: changeTx,
        prevTransactionResults: {},
      };
    } catch (error) {
      throw new Error(`Generate transactions payload failed: ${error.message}`);
    }
  };

  const getEthersWithCheck = async (address, proxyUrl, retries = 3, timeout = 60) => {
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const provider = getEthersProvider(proxyUrl);
        await provider.getBlockNumber();
        return provider;
      } catch (error) {
        if (attempt < retries - 1) {
          logger(`${getShortAddress(address)} | Warning: RPC connection attempt ${attempt + 1} failed: ${error.message}`);
          await new Promise((resolve) => setTimeout(resolve, 3000));
          continue;
        }
        throw new Error(`Failed to connect to RPC: ${error.message}`);
      }
    }
  };

  const getTokenBalance = async (address, contractAddress, proxyUrl) => {
    try {
      const provider = await getEthersWithCheck(address, proxyUrl);
      const contract = new ethers.Contract(contractAddress, ERC20_CONTRACT_ABI, provider);
      const balance = await contract.balanceOf(address);
      const decimals = await contract.decimals();
      return Number(ethers.formatUnits(balance, decimals));
    } catch (error) {
      logger(`${getShortAddress(address)} | Error: Get token balance failed for ${contractAddress}: ${error.message}`);
      return null;
    }
  };

  const sendTransactionWithRetries = async (wallet, tx, address, retries = 5) => {
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const txResponse = await wallet.sendTransaction(tx);
        const receipt = await txResponse.wait();
        return { transactionHash: txResponse.hash, blockNumber: receipt.blockNumber };
      } catch (error) {
        if (error.message.includes("nonce too low") || error.message.includes("transaction underpriced")) {
          await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 1000));
          continue;
        }
        logger(`${getShortAddress(address)} | Error: [Attempt ${attempt + 1}] Send TX error: ${error.message}`);
        await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 1000));
      }
    }
    throw new Error("Transaction hash not found after maximum retries");
  };

  const getNextFaucetClaimTime = async (address, proxyUrl) => {
    try {
      const provider = await getEthersWithCheck(address, proxyUrl);
      const contract = new ethers.Contract(mvMUSD_CONTRACT_ADDRESS, AUTOSTAKING_CONTRACT_ABI, provider);
      const nextClaimTime = await contract.getNextFaucetClaimTime(address);
      return Number(nextClaimTime);
    } catch (error) {
      logger(`${getShortAddress(address)} | Error: Get next faucet claim time failed: ${error.message}`);
      return null;
    }
  };

  const performClaimFaucet = async (privateKey, address, proxyUrl) => {
    try {
      const provider = await getEthersWithCheck(address, proxyUrl);
      const wallet = new ethers.Wallet(privateKey, provider);
      const contract = new ethers.Contract(mvMUSD_CONTRACT_ADDRESS, ERC20_CONTRACT_ABI, wallet);
      const tx = await contract.claimFaucet({
        gasLimit: ethers.parseUnits("200000", "wei"),
        maxFeePerGas: ethers.parseUnits("1", "gwei"),
        maxPriorityFeePerGas: ethers.parseUnits("1", "gwei"),
        nonce: usedNonces[address] || await wallet.getNonce(),
      });
      const receipt = await tx.wait();
      usedNonces[address] = (usedNonces[address] || 0) + 1;
      return { txHash: tx.hash, blockNumber: receipt.blockNumber };
    } catch (error) {
      logger(`${getShortAddress(address)} | Error: Perform claim faucet failed: ${error.message}`);
      return { txHash: null, blockNumber: null };
    }
  };

  const approvingToken = async (privateKey, address, routerAddress, assetAddress, amount, proxyUrl) => {
    try {
      const provider = await getEthersWithCheck(address, proxyUrl);
      const wallet = new ethers.Wallet(privateKey, provider);
      const contract = new ethers.Contract(assetAddress, ERC20_CONTRACT_ABI, wallet);
      const decimals = await contract.decimals();
      const amountToWei = ethers.parseUnits(amount.toString(), decimals);

      const allowance = await contract.allowance(address, routerAddress);
      if (allowance < amountToWei) {
        logger(`${getShortAddress(address)} | Approving token ${assetAddress}...`);
        const approveTx = await contract.approve(routerAddress, ethers.MaxUint256, {
          gasLimit: ethers.parseUnits("100000", "wei"),
          maxFeePerGas: ethers.parseUnits("1", "gwei"),
          maxPriorityFeePerGas: ethers.parseUnits("1", "gwei"),
          nonce: usedNonces[address] || await wallet.getNonce(),
        });
        const receipt = await approveTx.wait();
        usedNonces[address] = (usedNonces[address] || 0) + 1;
        logger(`${getShortAddress(address)} | Success: Approved | Confirmed: ${approveTx.hash}`);
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
      return true;
    } catch (error) {
      throw new Error(`Approving token contract failed for ${assetAddress}: ${error.message}`);
    }
  };

  const performStaking = async (privateKey, address, changeTx, proxyUrl) => {
    try {
      const provider = await getEthersWithCheck(address, proxyUrl);
      const wallet = new ethers.Wallet(privateKey, provider);

      await approvingToken(privateKey, address, STAKING_ROUTER_ADDRESS, USDC_CONTRACT_ADDRESS, usdcAmount, proxyUrl);
      await approvingToken(privateKey, address, STAKING_ROUTER_ADDRESS, USDT_CONTRACT_ADDRESS, usdtAmount, proxyUrl);
      await approvingToken(privateKey, address, STAKING_ROUTER_ADDRESS, MUSD_CONTRACT_ADDRESS, musdAmount, proxyUrl);

      const transactions = await makeApiRequest(
        "post",
        `${BASE_API}/investment/generate-change-transactions`,
        generateTransactionsPayload(address, changeTx),
        { Authorization: authTokens[address], "Content-Type": "application/json" },
        proxyUrl,
        rotateProxy,
        proxies
      );

      if (!transactions || !transactions.data || !transactions.data["688688"]) {
        throw new Error("Generate transaction calldata failed or invalid response");
      }

      const calldata = transactions.data["688688"].data;
      const tx = {
        to: STAKING_ROUTER_ADDRESS,
        data: calldata,
        gasLimit: ethers.parseUnits("500000", "wei"),
        maxFeePerGas: ethers.parseUnits("1", "gwei"),
        maxPriorityFeePerGas: ethers.parseUnits("1", "gwei"),
        nonce: usedNonces[address] || await wallet.getNonce(),
      };

      const { transactionHash, blockNumber } = await sendTransactionWithRetries(wallet, tx, address);
      usedNonces[address] = (usedNonces[address] || 0) + 1;

      return { txHash: transactionHash, blockNumber };
    } catch (error) {
      logger(`${getShortAddress(address)} | Error: Perform staking failed: ${error.message}`);
      return { txHash: null, blockNumber: null };
    }
  };

  const financialPortfolioRecommendation = async (address, proxyUrl) => {
    try {
      const response = await makeApiRequest(
        "post",
        `${BASE_API}/investment/financial-portfolio-recommendation`,
        generateRecommendationPayload(address),
        { Authorization: authTokens[address], "Content-Type": "application/json" },
        proxyUrl,
        rotateProxy,
        proxies
      );
      if (!response || !response.data) {
        throw new Error("Invalid API response");
      }
      return response;
    } catch (error) {
      logger(`${getShortAddress(address)} | Error: Financial portfolio recommendation failed: ${error.message}`);
      return null;
    }
  };

  const authTokens = {};
  for (let i = 0; i < privateKeys.length; i++) {
    const privateKey = privateKeys[i];
    const proxyUrl = useProxy ? proxies[i % proxies.length] || null : null;
    const address = generateAddress(privateKey);
    if (!address) {
      logger(`${getShortAddress("N/A")} | Error: Invalid private key or library version not supported`);
      continue;
    }

    logger(`${getShortAddress(address)} | Processing AutoStaking for account ${i + 1}`);

    authTokens[address] = generateAuthToken(address);
    if (!authTokens[address]) {
      logger(`${getShortAddress(address)} | Error: Cryptography library version not supported`);
      continue;
    }

    const provider = await getEthersWithCheck(address, proxyUrl);
    if (!provider) {
      logger(`${getShortAddress(address)} | Error: Provider not connected`);
      continue;
    }

    usedNonces[address] = await new ethers.Wallet(privateKey, provider).getNonce();

    // Claim Faucet
    logger(`${getShortAddress(address)} | Processing Faucet Claim...`);
    const nextClaimTime = await getNextFaucetClaimTime(address, proxyUrl);
    if (nextClaimTime === null) {
      logger(`${getShortAddress(address)} | Error: Failed to retrieve next faucet claim time`);
    } else if (Math.floor(Date.now() / 1000) >= nextClaimTime) {
      const { txHash, blockNumber } = await performClaimFaucet(privateKey, address, proxyUrl);
      if (txHash && blockNumber) {
        logger(
          `${getShortAddress(address)} | Success: Claim faucet successful | Confirmed: ${txHash}`
        );
      } else {
        logger(`${getShortAddress(address)} | Error: Perform on-chain claim faucet failed`);
      }
    } else {
      logger(
        `${getShortAddress(address)} | Warning: Already claimed, next claim at ${new Date(
          nextClaimTime * 1000
        ).toISOString()}`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Perform Staking
    for (let j = 0; j < stakingCount; j++) {
      logger(
        `${getShortAddress(address)} | Processing staking attempt ${j + 1} of ${stakingCount}`
      );

      const usdcBalance = await getTokenBalance(address, USDC_CONTRACT_ADDRESS, proxyUrl);
      const usdtBalance = await getTokenBalance(address, USDT_CONTRACT_ADDRESS, proxyUrl);
      const musdBalance = await getTokenBalance(address, MUSD_CONTRACT_ADDRESS, proxyUrl);

      logger(
        `${getShortAddress(address)} | Balances: USDC=${usdcBalance}, USDT=${usdtBalance}, MockUSD=${musdBalance}`
      );
      logger(
        `${getShortAddress(address)} | Required: USDC=${usdcAmount}, USDT=${usdtAmount}, MockUSD=${musdAmount}`
      );

      if (usdcBalance === null || usdcBalance < usdcAmount) {
        logger(
          `${getShortAddress(address)} | Error: Insufficient USDC token balance: ${usdcBalance} < ${usdcAmount}`
        );
        break;
      }
      if (usdtBalance === null || usdtBalance < usdtAmount) {
        logger(
          `${getShortAddress(address)} | Error: Insufficient USDT token balance: ${usdtBalance} < ${usdtAmount}`
        );
        break;
      }
      if (musdBalance === null || musdBalance < musdAmount) {
        logger(
          `${getShortAddress(address)} | Error: Insufficient MockUSD token balance: ${musdBalance} < ${musdAmount}`
        );
        break;
      }

      const portfolio = await financialPortfolioRecommendation(address, proxyUrl);
      if (portfolio) {
        const changeTx = portfolio.data.changes;
        const { txHash, blockNumber } = await performStaking(privateKey, address, changeTx, proxyUrl);
        if (txHash && blockNumber) {
          logger(
            `${getShortAddress(address)} | Success: Staking successful | Confirmed: ${txHash}`
          );
        } else {
          logger(`${getShortAddress(address)} | Error: Perform on-chain staking failed`);
        }
      } else {
        logger(`${getShortAddress(address)} | Error: Get financial portfolio recommendation failed`);
      }

      const delay = Math.floor(Math.random() * (maxDelay - minDelay + 1) + minDelay) * 1000;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  logger("System | AutoStaking Task completed!");
}

module.exports = { performAutoStakingTask };
