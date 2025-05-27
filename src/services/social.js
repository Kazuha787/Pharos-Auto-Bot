/**
 * src/services/social.js - Social tasks service
 */
const getConfig = require('../../getConfig');
const { retry } = require('../utils/helpers');

// Load configuration
const config = getConfig();

class SocialService {
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
   * Verify social task
   * Task IDs:
   * - 201: Follow on X
   * - 202: Retweet on X
   * - 203: Comment on X
   * - 204: Join Discord
   */
  async verifyTask(address, taskId) {
    const taskNames = {
      201: 'Follow on X',
      202: 'Retweet on X',
      203: 'Comment on X',
      204: 'Join Discord',
      101: 'Swap',
      102: 'Add Liquidity',
      103: 'Self Transfer'
    };
    
    this.logger.info(`Verifying task: ${taskNames[taskId] || `Task ${taskId}`}...`, { walletIndex: this.walletIndex });
    
    try {
      return await retry(async () => {
        // Check if JWT is set
        if (!this.jwt) {
          throw new Error('JWT token not set');
        }
        
        // Verify task
        const verifyUrl = `${this.baseUrl}/task/verify?address=${address}&task_id=${taskId}`;
        const response = await this.axios.post(verifyUrl, null, {
          headers: {
            'Authorization': `Bearer ${this.jwt}`,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
            'Origin': 'https://testnet.pharosnetwork.xyz',
            'Referer': 'https://testnet.pharosnetwork.xyz/',
            'Accept': 'application/json, text/plain, */*'
          }
        });
        
        if (response.data.code === 0 && response.data.data.verified) {
          this.logger.info(`Task ${taskId} verified successfully`, { walletIndex: this.walletIndex });
          return true;
        } else {
          throw new Error(`Task verification failed: ${response.data.msg}`);
        }
      }, config.general.retry_attempts, config.general.retry_delay, this.logger, this.walletIndex);
    } catch (error) {
      this.logger.error(`Task ${taskId} verification failed: ${error.message}`, { walletIndex: this.walletIndex });
      return false;
    }
  }
  
  /**
   * Verify task with transaction hash
   */
  async verifyTaskWithTxHash(address, taskId, txHash) {
    const taskNames = {
      101: 'Swap',
      102: 'Add Liquidity',
      103: 'Self Transfer'
    };
    
    this.logger.info(`Verifying task: ${taskNames[taskId] || `Task ${taskId}`} with TX hash...`, { walletIndex: this.walletIndex });
    
    try {
      return await retry(async () => {
        // Check if JWT is set
        if (!this.jwt) {
          throw new Error('JWT token not set');
        }
        
        // Verify task with transaction hash
        const verifyUrl = `${this.baseUrl}/task/verify?address=${address}&task_id=${taskId}&tx_hash=${txHash}`;
        const response = await this.axios.post(verifyUrl, null, {
          headers: {
            'Authorization': `Bearer ${this.jwt}`,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
            'Origin': 'https://testnet.pharosnetwork.xyz',
            'Referer': 'https://testnet.pharosnetwork.xyz/',
            'Accept': 'application/json, text/plain, */*'
          }
        });
        
        if (response.data.code === 0 && response.data.data.verified) {
          this.logger.info(`Task ${taskId} verified successfully with TX hash`, { walletIndex: this.walletIndex });
          return true;
        } else {
          throw new Error(`Task verification with TX hash failed: ${response.data.msg}`);
        }
      }, config.general.retry_attempts, config.general.retry_delay, this.logger, this.walletIndex);
    } catch (error) {
      this.logger.error(`Task ${taskId} verification with TX hash failed: ${error.message}`, { walletIndex: this.walletIndex });
      return false;
    }
  }
  
  /**
   * Get user tasks
   */
  async getUserTasks(address) {
    try {
      return await retry(async () => {
        // Check if JWT is set
        if (!this.jwt) {
          throw new Error('JWT token not set');
        }
        
        // Get user tasks
        const tasksUrl = `${this.baseUrl}/user/tasks?address=${address}`;
        const response = await this.axios.get(tasksUrl, {
          headers: {
            'Authorization': `Bearer ${this.jwt}`,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
            'Origin': 'https://testnet.pharosnetwork.xyz',
            'Referer': 'https://testnet.pharosnetwork.xyz/',
            'Accept': 'application/json, text/plain, */*'
          }
        });
        
        if (response.data.code === 0) {
          return response.data.data.user_tasks || [];
        } else {
          throw new Error(`Failed to get user tasks: ${response.data.msg}`);
        }
      }, config.general.retry_attempts, config.general.retry_delay, this.logger, this.walletIndex);
    } catch (error) {
      this.logger.error(`Failed to get user tasks: ${error.message}`, { walletIndex: this.walletIndex });
      return [];
    }
  }
}

module.exports = SocialService;
