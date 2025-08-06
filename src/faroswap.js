const axios = require("axios");
const ethers = require("ethers");
const { HttpsProxyAgent } = require("https-proxy-agent");
const { SocksProxyAgent } = require("socks-proxy-agent");

// ---- CONSTANTS ----
const NETWORK_CONFIG = {
  rpc: "https://api.zan.top/node/v1/pharos/testnet/54b49326c9f44b6e8730dc5dd4348421",
  chainId: 688688,
  symbol: "PHRS",
  explorer: "https://pharos-testnet.socialscan.io/",
};

const TOKENS = {
  PHRS: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
  USDT: "0xD4071393f8716661958F766DF660033b3d35fD29",
};

const DODO_ROUTER = "0x73CAfc894dBfC181398264934f7Be4e482fc9d40";
const PHRS_TO_USDT_AMOUNT = ethers.parseEther("0.00245");
const USDT_TO_PHRS_AMOUNT = ethers.parseUnits("1", 6);

const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
];

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.101 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:89.0) Gecko/20100101 Firefox/89.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:89.0) Gecko/20100101 Firefox/89.0",
];

// ---- UTILITY FUNCTIONS ----
function getShortAddress(address) {
  return address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "N/A";
}

function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
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
  if (proxyUrl) {
    console.log("Warning: Proxy support in ethers v6 is limited");
  }
  return new ethers.JsonRpcProvider(NETWORK_CONFIG.rpc, NETWORK_CONFIG.chainId);
}

async function fetchWithTimeout(url, timeout = 15000, proxyUrl = null) {
  try {
    const source = axios.CancelToken.source();
    const timeoutId = setTimeout(() => source.cancel("Timeout"), timeout);
    const config = {
      cancelToken: source.token,
      headers: {
        accept: "application/json, text/plain, */*",
        "accept-language": "en-US,en;q=0.8",
        priority: "u=1, i",
        "sec-ch-ua": '"Not)A;Brand";v="8", "Chromium";v="138", "Brave";v="138"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Windows"',
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "cross-site",
        "sec-gpc": "1",
        Referer: "https://faroswap.xyz/",
        "User-Agent": getRandomUserAgent(),
      },
    };

    if (proxyUrl) {
      const agent = createProxyAgent(proxyUrl);
      if (agent) {
        config.httpsAgent = agent;
        config.httpAgent = agent;
      }
    }

    const res = await axios.get(url, config);
    clearTimeout(timeoutId);
    return res;
  } catch (err) {
    throw new Error("Timeout or network error");
  }
}

async function robustFetchDodoRoute(url, logger, walletAddress, proxyUrl) {
  for (let i = 0; i < 5; i++) {
    try {
      const res = await fetchWithTimeout(url, 15000, proxyUrl);
      const data = res.data;
      if (data.status !== -1) return data;
      logger(`${getShortAddress(walletAddress)} | Warning: Retry ${i + 1} DODO API status -1`);
    } catch (e) {
      logger(`${getShortAddress(walletAddress)} | Warning: Retry ${i + 1} failed: ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("DODO API permanently failed");
}

async function fetchDodoRoute(fromAddr, toAddr, userAddr, amountWei, logger, proxyUrl) {
  const deadline = Math.floor(Date.now() / 1000) + 600;
  const url = `https://api.dodoex.io/route-service/v2/widget/getdodoroute?chainId=${NETWORK_CONFIG.chainId}&deadLine=${deadline}&apikey=a37546505892e1a952&slippage=3.225&source=dodoV2AndMixWasm&toTokenAddress=${toAddr}&fromTokenAddress=${fromAddr}&userAddr=${userAddr}&estimateGas=true&fromAmount=${amountWei}`;
  try {
    const result = await robustFetchDodoRoute(url, logger, userAddr, proxyUrl);
    if (!result.data || !result.data.data) {
      throw new Error("Invalid DODO API response: missing data field");
    }
    logger(`${getShortAddress(userAddr)} | Success: DODO Route Info fetched successfully`);
    return result.data;
  } catch (err) {
    logger(`${getShortAddress(userAddr)} | Error: DODO API fetch failed: ${err.message}`);
    throw err;
  }
}

async function approveToken(wallet, tokenAddr, amount, logger, usedNonces) {
  if (tokenAddr === TOKENS.PHRS) return true;
  const contract = new ethers.Contract(tokenAddr, ERC20_ABI, wallet);
  try {
    const balance = await contract.balanceOf(wallet.address);
    if (BigInt(balance) < BigInt(amount)) {
      logger(
        `${getShortAddress(wallet.address)} | Error: Insufficient USDT balance: ${ethers.formatUnits(
          balance,
          6
        )} USDT`
      );
      return false;
    }
    const allowance = await contract.allowance(wallet.address, DODO_ROUTER);
    if (BigInt(allowance) >= BigInt(amount)) {
      logger(`${getShortAddress(wallet.address)} | Success: Token already approved`);
      return true;
    }
    logger(`${getShortAddress(wallet.address)} | Processing Approving ${ethers.formatUnits(amount, 6)} USDT...`);
    const nonce = usedNonces[wallet.address] || (await wallet.provider.getTransactionCount(wallet.address, "latest"));
    usedNonces[wallet.address] = nonce + 1;
    const feeData = await wallet.provider.getFeeData();
    const tx = await contract.approve(DODO_ROUTER, amount, {
      gasLimit: 100000,
      maxFeePerGas: feeData.maxFeePerGas || ethers.parseUnits("1", "gwei"),
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || ethers.parseUnits("0.5", "gwei"),
      nonce,
    });
    logger(`${getShortAddress(wallet.address)} | Success: Approval TX sent | Confirmed: ${tx.hash}`);
    await tx.wait();
    logger(`${getShortAddress(wallet.address)} | Success: Approval confirmed`);
    return true;
  } catch (e) {
    logger(`${getShortAddress(wallet.address)} | Error: Approval failed: ${e.message}`);
    return false;
  }
}

async function executeSwap(wallet, routeData, fromAddr, amount, logger, usedNonces) {
  if (fromAddr !== TOKENS.PHRS) {
    const approved = await approveToken(wallet, fromAddr, amount, logger, usedNonces);
    if (!approved) throw new Error("Token approval failed");
  }
  try {
    if (!routeData.data || routeData.data === "0x") {
      throw new Error("Invalid transaction data from DODO API");
    }
    const nonce = usedNonces[wallet.address] || (await wallet.provider.getTransactionCount(wallet.address, "latest"));
    usedNonces[wallet.address] = nonce + 1;
    const feeData = await wallet.provider.getFeeData();
    const tx = await wallet.sendTransaction({
      to: routeData.to,
      data: routeData.data,
      value: BigInt(routeData.value),
      gasLimit: BigInt(routeData.gasLimit || 500000),
      maxFeePerGas: feeData.maxFeePerGas || ethers.parseUnits("2", "gwei"),
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || ethers.parseUnits("1", "gwei"),
      nonce,
    });
    logger(`${getShortAddress(wallet.address)} | Success: Swap Transaction sent | Confirmed: ${tx.hash}`);
    await tx.wait();
    logger(`${getShortAddress(wallet.address)} | Success: Swap Transaction confirmed`);
  } catch (e) {
    logger(`${getShortAddress(wallet.address)} | Error: Swap TX failed: ${e.message}`);
    throw e;
  }
}

async function batchSwap(wallet, proxyUrl, count, logger, usedNonces) {
  const swaps = [];
  for (let i = 0; i < count; i++) {
    swaps.push(
      i % 2 === 0
        ? { from: TOKENS.PHRS, to: TOKENS.USDT, amount: PHRS_TO_USDT_AMOUNT, decimals: 18 }
        : { from: TOKENS.USDT, to: TOKENS.PHRS, amount: USDT_TO_PHRS_AMOUNT, decimals: 6 }
    );
  }

  for (let i = 0; i < swaps.length; i++) {
    const { from, to, amount, decimals } = swaps[i];
    const pair = from === TOKENS.PHRS ? "PHRS -> USDT" : "USDT -> PHRS";
    logger(`${getShortAddress(wallet.address)} | Processing Swap #${i + 1} of ${count}: ${pair}`);
    try {
      // Check balance
      let balance;
      if (from === TOKENS.PHRS) {
        balance = await wallet.provider.getBalance(wallet.address);
      } else {
        const tokenContract = new ethers.Contract(from, ERC20_ABI, wallet);
        balance = await tokenContract.balanceOf(wallet.address);
      }
      if (BigInt(balance) < BigInt(amount)) {
        logger(
          `${getShortAddress(wallet.address)} | Warning: Insufficient ${
            from === TOKENS.PHRS ? "PHRS" : "USDT"
          } balance for swap ${i + 1}`
        );
        continue;
      }

      const data = await fetchDodoRoute(from, to, wallet.address, amount, logger, proxyUrl);
      await executeSwap(wallet, data, from, amount, logger, usedNonces);
    } catch (e) {
      logger(`${getShortAddress(wallet.address)} | Error: Swap #${i + 1} failed: ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}

async function performFaroswapTask(logger, privateKeys, proxies, faroswapTxCount, usedNonces) {
  logger(`System | Starting Faroswap Task...`);

  for (let i = 0; i < privateKeys.length; i++) {
    const privateKey = privateKeys[i];
    const proxyUrl = proxies[i % proxies.length] || null;
    const provider = getEthersProvider(proxyUrl);
    const wallet = new ethers.Wallet(privateKey, provider);

    logger(`${getShortAddress(wallet.address)} | Processing Faroswap for account ${i + 1}`);

    if (!usedNonces[wallet.address]) {
      usedNonces[wallet.address] = await provider.getTransactionCount(wallet.address, "latest");
    }

    try {
      await batchSwap(wallet, proxyUrl, faroswapTxCount, logger, usedNonces);
      logger(`${getShortAddress(wallet.address)} | Success: Faroswap Task completed`);
    } catch (error) {
      logger(`${getShortAddress(wallet.address)} | Error: Faroswap Task failed: ${error.message}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  logger(`System | Faroswap Task completed!`);
}

module.exports = { performFaroswapTask };
