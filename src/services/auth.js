/**
 * src/services/auth.js - Authentication service
 */
const { signMessage } = require('../utils/wallet');
const getConfig = require('../../getConfig');
const { retry } = require('../utils/helpers');

const config = getConfig();

class AuthService {
  constructor(axios, wallet, logger, walletIndex) {
    this.axios = axios;
    this.wallet = wallet;
    this.logger = logger;
    this.walletIndex = walletIndex;
    this.baseUrl = config.api.pharos.base_url;
    this.jwt = null;
  }
  
  /**
   * Login to Pharos testnet
   */
  async login() {
    this.logger.info('Logging in...', { walletIndex: this.walletIndex });
    
    try {
      return await retry(async () => {
        // Get wallet address
        const address = this.wallet.address;
        
        // Get message to sign (can be hardcoded based on your info)
        const message = `pharos`;
        
        // Sign message
        const signature = await signMessage(this.wallet, message);
        
        // Generate a random invite code or use a fixed one
        const inviteCode = 'kwN8Xxeb4sCbTvRA'; // Example from your data
        
        // Login request
        const loginUrl = `${this.baseUrl}/user/login?address=${address}&signature=${signature}&invite_code=${inviteCode}`;
        
        // Add proper headers
        const headers = {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
          'Origin': 'https://testnet.pharosnetwork.xyz',
          'Referer': 'https://testnet.pharosnetwork.xyz/',
          'Accept': 'application/json, text/plain, */*',
          'Authorization': 'Bearer null'
        };
        
        const loginResponse = await this.axios.post(loginUrl, null, { headers });
        
        if (loginResponse.data.code !== 0) {
          throw new Error(`Login failed with code: ${loginResponse.data.code}, message: ${loginResponse.data.msg}`);
        }
        
        // Extract JWT token
        this.jwt = loginResponse.data.data.jwt;
        
        // Get user profile
        const profileUrl = `${this.baseUrl}/user/profile?address=${address}`;
        const profileResponse = await this.axios.get(profileUrl, {
          headers: {
            'Authorization': `Bearer ${this.jwt}`,
            'Origin': 'https://testnet.pharosnetwork.xyz',
            'Referer': 'https://testnet.pharosnetwork.xyz/'
          }
        });
        
        const userInfo = profileResponse.data.data.user_info;
        
        return {
          jwt: this.jwt,
          userInfo
        };
      }, config.general.retry_attempts, config.general.retry_delay, this.logger, this.walletIndex);
    } catch (error) {
      this.logger.error(`Login failed: ${error.message}`, { walletIndex: this.walletIndex });
      throw error;
    }
  }
  
  /**
   * Get JWT token
   */
  getJwt() {
    return this.jwt;
  }
}

module.exports = AuthService;