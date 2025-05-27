/**
 * src/services/checkin.js - Daily check-in service
 */
const getConfig = require('../../getConfig');
const { retry } = require('../utils/helpers');

// Load configuration
const config = getConfig;

class CheckinService {
  constructor(axios, logger, walletIndex) {
    this.axios = axios;
    this.logger = logger;
    this.walletIndex = walletIndex;
    this.baseUrl = config.api.pharos.base_url;
    this.jwt = null;
  }
  
  /**
   * Set JWT token
   */
  setJwt(jwt) {
    this.jwt = jwt;
  }
  
  /**
   * Perform daily check-in
   */
  async dailyCheckin(address) {
    this.logger.info('Performing daily check-in...', { walletIndex: this.walletIndex });
    
    try {
      return await retry(async () => {
        // Check if JWT is set
        if (!this.jwt) {
          throw new Error('JWT token not set');
        }
        
        // Check-in request
        const checkinUrl = `${this.baseUrl}/sign/in?address=${address}`;
        const response = await this.axios.post(checkinUrl, null, {
          headers: {
            'Authorization': `Bearer ${this.jwt}`,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
            'Origin': 'https://testnet.pharosnetwork.xyz',
            'Referer': 'https://testnet.pharosnetwork.xyz/',
            'Accept': 'application/json, text/plain, */*'
          }
        });
        
        if (response.data.code === 0) {
          this.logger.info('Daily check-in successful', { walletIndex: this.walletIndex });
          return true;
        } else {
          throw new Error(`Check-in failed: ${response.data.msg}`);
        }
      }, config.general.retry_attempts, config.general.retry_delay, this.logger, this.walletIndex);
    } catch (error) {
      this.logger.error(`Daily check-in failed: ${error.message}`, { walletIndex: this.walletIndex });
      return false;
    }
  }
}

module.exports = CheckinService;