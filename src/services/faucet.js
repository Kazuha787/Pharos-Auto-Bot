/**
 * src/services/faucet.js - Faucet claim service
 */
const getConfig = require('../../getConfig');
const { retry, sleep, isProxyError } = require('../utils/helpers');
const { TOKEN_ADDRESSES } = require('../utils/constants');
const RecaptchaService = require('./recaptcha');

// Load configuration
const config = getConfig();

class FaucetService {
  constructor(axios, wallet, logger, walletIndex) {
    this.axios = axios;
    this.wallet = wallet;
    this.logger = logger;
    this.walletIndex = walletIndex;
    this.baseUrl = config.api.pharos.base_url;
    this.zenithBaseUrl = config.api.zenith.base_url;
    this.jwt = null;
    this.recaptchaService = new RecaptchaService(axios, logger, walletIndex);
  }
  
  /**
   * Set JWT token
   */
  setJwt(jwt) {
    this.jwt = jwt;
  }
  
  /**
   * Check if native faucet is available
   */
  async checkFaucetStatus(address) {
    return await retry(async () => {
      // Check faucet status
      const statusUrl = `${this.baseUrl}/faucet/status?address=${address}`;
      const response = await this.axios.get(statusUrl, {
        headers: {
          'Authorization': `Bearer ${this.jwt}`,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
          'Origin': 'https://testnet.pharosnetwork.xyz',
          'Referer': 'https://testnet.pharosnetwork.xyz/',
          'Accept': 'application/json, text/plain, */*'
        }
      });
      
      if (response.data.code === 0) {
        return response.data.data.is_able_to_faucet;
      }
      
      return false;
    }, config.general.retry_attempts, config.general.retry_delay, this.logger, this.walletIndex);
  }
  
  /**
   * Claim native PHRS faucet
   */
  async claimNativeFaucet(address) {
    this.logger.info('Checking if native faucet is available...', { walletIndex: this.walletIndex });
    
    try {
      // Check if faucet is available
      let isAvailable = false;
      try {
        isAvailable = await this.checkFaucetStatus(address);
      } catch (error) {
        this.logger.error(`Failed to check faucet status: ${error.message}`, { walletIndex: this.walletIndex });
        // If it's a proxy error, we'll try claiming anyway since we have retry mechanism
        if (isProxyError(error.message)) {
          this.logger.info(`Proxy error detected when checking faucet. Will try to claim anyway.`, { walletIndex: this.walletIndex });
          isAvailable = true;
        } else {
          return false;
        }
      }
      
      if (!isAvailable) {
        this.logger.info('Native faucet not available yet', { walletIndex: this.walletIndex });
        return false;
      }
      
      this.logger.info('Claiming native faucet...', { walletIndex: this.walletIndex });
      
      return await retry(async () => {
        // Solve reCAPTCHA if enabled
        let recaptchaToken = null;
        if (config.recaptcha.enabled) {
          recaptchaToken = await this.recaptchaService.solveRecaptcha();
        }
        
        // Claim faucet
        const faucetUrl = `${this.baseUrl}/faucet/daily?address=${address}`;
        const response = await this.axios.post(faucetUrl, null, {
          headers: {
            'Authorization': `Bearer ${this.jwt}`,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
            'Origin': 'https://testnet.pharosnetwork.xyz',
            'Referer': 'https://testnet.pharosnetwork.xyz/',
            'Accept': 'application/json, text/plain, */*'
          }
        });
        
        if (response.data.code === 0) {
          this.logger.info('Native faucet claimed successfully', { walletIndex: this.walletIndex });
          return true;
        } else {
          throw new Error(`Failed to claim native faucet: ${response.data.msg}`);
        }
      }, config.general.retry_attempts, config.general.retry_delay, this.logger, this.walletIndex);
    } catch (error) {
      this.logger.error(`Failed to claim native faucet: ${error.message}`, { walletIndex: this.walletIndex });
      return false;
    }
  }
  
  /**
   * Claim USDC/USDT faucet
   */
  async claimTokenFaucet(address, tokenType) {
    this.logger.info(`Claiming ${tokenType} faucet...`, { walletIndex: this.walletIndex });
    
    try {
      return await retry(async () => {
        // Get token address
        const tokenAddress = TOKEN_ADDRESSES[tokenType];
        
        if (!tokenAddress) {
          throw new Error(`Invalid token type: ${tokenType}`);
        }
        
        // Claim faucet
        const faucetUrl = `${this.zenithBaseUrl}/api/v1/faucet`;
        const payload = {
          tokenAddress,
          userAddress: address
        };
        
        const response = await this.axios.post(faucetUrl, payload, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
            'Origin': 'https://testnet.pharosnetwork.xyz',
            'Referer': 'https://testnet.pharosnetwork.xyz/',
            'Accept': 'application/json, text/plain, */*'
          }
        });
        
        if (response.data.status === 200) {
          this.logger.info(`${tokenType} faucet claimed successfully. TX Hash: ${response.data.data.txHash}`, { walletIndex: this.walletIndex });
          return true;
        } else {
          this.logger.warn(`Failed to claim ${tokenType} faucet: ${response.data.message}`, { walletIndex: this.walletIndex });
          return false;
        }
      }, config.general.retry_attempts, config.general.retry_delay, this.logger, this.walletIndex);
    } catch (error) {
      this.logger.error(`Failed to claim ${tokenType} faucet: ${error.message}`, { walletIndex: this.walletIndex });
      return false;
    }
  }
}

module.exports = FaucetService;