const fs = require('fs');
const axios = require('axios');
const { ethers } = require('ethers');

// === Configuration ===
const RPC_URL = 'https://testnet.dplabs-internal.com';
const CONTRACT_ADDRESS = '0xcc8cf44e196cab28dba2d514dc7353af0efb370e';
const API_LOGIN = 'https://api.aquaflux.pro/api/v1/users/wallet-login';
const API_SIGNATURE = 'https://api.aquaflux.pro/api/v1/users/get-signature';
const API_TOKEN_CHECK = 'https://api.aquaflux.pro/api/v1/users/check-token-holding';
const CLAIMTOKENS_ABI = ["function claimTokens() public"];
const RAW_DATA = "0x7905642a0000000000000000000000000000000000000000000000056bc75e2d63100000";

// === Utility Functions ===
function getShortAddress(address) {
  return address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "N/A";
}

// === Main AquaFlux Mint Function ===
async function performAquaFluxMint(logger, privateKeys, proxies, mintCount, usedNonces) {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  
  // Dynamically import p-limit
  const { default: pLimit } = await import('p-limit');
  const limit = pLimit(1); // Respect DOMAIN_CONFIG.MAX_CONCURRENCY from main.js
  const delay = 1000; // 1 second delay between actions

  logger("System | Starting AquaFlux Mint Task...");

  for (let i = 0; i < privateKeys.length; i++) {
    const privateKey = privateKeys[i];
    const walletLogPrefix = `Wallet #${i + 1}`;
    
    let wallet, address;
    try {
      wallet = new ethers.Wallet(privateKey, provider);
      address = wallet.address;
    } catch (error) {
      logger(`${walletLogPrefix} | Error: Invalid private key: ${error.message}`);
      continue;
    }

    logger(`${getShortAddress(address)} | Processing AquaFlux Mint for account ${i + 1}`);

    // Initialize nonce for the wallet
    try {
      const nonce = await provider.getTransactionCount(address, "pending");
      usedNonces[address] = nonce;
    } catch (error) {
      logger(`${getShortAddress(address)} | Error: Failed to initialize nonce: ${error.message}`);
      continue;
    }

    for (let j = 0; j < mintCount; j++) {
      const mintIndex = j + 1;
      const logPrefix = `${walletLogPrefix} | Mint ${mintIndex}`;

      await limit(async () => {
        let attempts = 0;
        const maxAttempts = 3;

        while (attempts < maxAttempts) {
          try {
            // 1. Login request
            logger(`${logPrefix} | Processing login...`);
            const timestamp = Date.now();
            const message = `Sign in to AquaFlux with timestamp: ${timestamp}`;
            const signature = await wallet.signMessage(message);

            const loginResponse = await axios.post(API_LOGIN, {
              address,
              message,
              signature
            }, {
              headers: {
                Accept: "application/json, text/plain, */*",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                Origin: "https://testnet.pharosnetwork.xyz",
                Referer: "https://testnet.pharosnetwork.xyz/",
              },
              timeout: 10000
            });

            const accessToken = loginResponse.data.data.accessToken;
            logger(`${logPrefix} | Success: Logged in successfully`);

            // 2. Call claimTokens()
            logger(`${logPrefix} | Processing claimTokens...`);
            const contract = new ethers.Contract(CONTRACT_ADDRESS, CLAIMTOKENS_ABI, wallet);
            const nonce1 = usedNonces[address] || await provider.getTransactionCount(address, "pending");
            usedNonces[address] = nonce1 + 1;
            const feeData1 = await provider.getFeeData();

            const tx1 = await contract.claimTokens({
              gasLimit: 200000,
              maxFeePerGas: feeData1.maxFeePerGas || ethers.parseUnits("1", "gwei"),
              maxPriorityFeePerGas: feeData1.maxPriorityFeePerGas || ethers.parseUnits("0.5", "gwei"),
              nonce: nonce1
            });
            logger(`${logPrefix} | Success: claimTokens transaction sent | Confirmed: ${tx1.hash}`);
            await tx1.wait();
            logger(`${logPrefix} | Success: claimTokens transaction confirmed`);

            // 3. Send raw transaction
            logger(`${logPrefix} | Processing raw transaction...`);
            const nonce2 = usedNonces[address] || await provider.getTransactionCount(address, "pending");
            usedNonces[address] = nonce2 + 1;
            const feeData2 = await provider.getFeeData();

            const tx2 = await wallet.sendTransaction({
              to: CONTRACT_ADDRESS,
              data: RAW_DATA,
              value: 0,
              gasLimit: 200000,
              maxFeePerGas: feeData2.maxFeePerGas || ethers.parseUnits("1", "gwei"),
              maxPriorityFeePerGas: feeData2.maxPriorityFeePerGas || ethers.parseUnits("0.5", "gwei"),
              nonce: nonce2
            });
            logger(`${logPrefix} | Success: Raw transaction sent | Confirmed: ${tx2.hash}`);
            await tx2.wait();
            logger(`${logPrefix} | Success: Raw transaction confirmed`);

            // 4. Check token holding
            logger(`${logPrefix} | Checking token holding...`);
            const tokenCheck = await axios.post(API_TOKEN_CHECK, {}, {
              headers: {
                Authorization: `Bearer ${accessToken}`,
                Accept: "application/json, text/plain, */*",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                Origin: "https://testnet.pharosnetwork.xyz",
                Referer: "https://testnet.pharosnetwork.xyz/",
              },
              timeout: 10000
            });

            if (!tokenCheck.data.data?.isHoldingToken) {
              throw new Error("Wallet does not hold the required token");
            }
            logger(`${logPrefix} | Success: Token holding confirmed`);

            // 5. Request NFT claim signature
            logger(`${logPrefix} | Requesting NFT claim signature...`);
            const sigRes = await axios.post(API_SIGNATURE, {
              requestedNftType: 0,
              walletAddress: address
            }, {
              headers: {
                Authorization: `Bearer ${accessToken}`,
                Accept: "application/json, text/plain, */*",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                Origin: "https://testnet.pharosnetwork.xyz",
                Referer: "https://testnet.pharosnetwork.xyz/",
              },
              timeout: 10000
            });

            const { signature: nftSignature, expiresAt } = sigRes.data.data;
            logger(`${logPrefix} | Success: Received NFT claim signature`);

            // 6. Encode and send NFT claim transaction
            logger(`${logPrefix} | Processing NFT claim transaction...`);
            const selector = "0x75e7e053";
            const param1 = "0".padStart(64, '0');
            const param2 = ethers.toBeHex(expiresAt, 32).replace('0x', '').padStart(64, '0');
            const param3 = "60".padStart(64, '0'); // Offset for dynamic data
            const param4 = "41".padStart(64, '0'); // Signature length (65 bytes = 0x41)
            const sigData = nftSignature.replace('0x', '').padEnd(130, '0'); // 65 bytes hex

            const finalData = selector + param1 + param2 + param3 + param4 + sigData;

            const nonce3 = usedNonces[address] || await provider.getTransactionCount(address, "pending");
            usedNonces[address] = nonce3 + 1;
            const feeData3 = await provider.getFeeData();

            const tx3 = await wallet.sendTransaction({
              to: CONTRACT_ADDRESS,
              data: finalData,
              value: 0,
              gasLimit: 300000,
              maxFeePerGas: feeData3.maxFeePerGas || ethers.parseUnits("1", "gwei"),
              maxPriorityFeePerGas: feeData3.maxPriorityFeePerGas || ethers.parseUnits("0.5", "gwei"),
              nonce: nonce3
            });
            logger(`${logPrefix} | Success: NFT claim transaction sent | Confirmed: ${tx3.hash}`);
            await tx3.wait();
            logger(`${logPrefix} | Success: NFT claim transaction confirmed`);

            break; // Success, exit retry loop
          } catch (error) {
            if (error.message.includes("TX_REPLAY_ATTACK") && attempts < maxAttempts - 1) {
              logger(`${logPrefix} | Warning: Attempt ${attempts + 1} retry due to TX_REPLAY_ATTACK`);
              attempts++;
              await new Promise(resolve => setTimeout(resolve, 5000));
              continue;
            }
            const msg = error.response?.data?.message || error.message;
            logger(`${logPrefix} | Error: Failed after attempt ${attempts + 1}: ${msg}`);
            break;
          }
        }

        await new Promise(resolve => setTimeout(resolve, delay));
      });
    }
  }

  logger("System | AquaFlux Mint Task completed!");
}

module.exports = { performAquaFluxMint };
