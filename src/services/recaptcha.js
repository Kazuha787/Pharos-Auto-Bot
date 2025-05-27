/**
 * src/services/recaptcha.js - Recaptcha solver service
 */
const getConfig = require('../../getConfig');
const { retry } = require('../utils/helpers');

// Load configuration
const config = getConfig;

class RecaptchaService {
  constructor(axios, logger, walletIndex) {
    this.axios = axios;
    this.logger = logger;
    this.walletIndex = walletIndex;
    this.capsolverApiKey = config.recaptcha.api_key;
    this.siteKey = config.api.pharos.recaptcha_site_key;
    this.pageUrl = 'https://testnet.pharosnetwork.xyz/';
  }
  
  /**
   * Solve reCAPTCHA using capsolver
   */
  async solveRecaptcha() {
    this.logger.info('Solving reCAPTCHA...', { walletIndex: this.walletIndex });
    
    try {
      return await retry(async () => {
        // Create task
        const createTaskUrl = 'https://api.capsolver.com/createTask';
        const createTaskPayload = {
          clientKey: this.capsolverApiKey,
          task: {
            type: 'RecaptchaV2TaskProxyless',
            websiteURL: this.pageUrl,
            websiteKey: this.siteKey
          }
        };
        
        const createTaskResponse = await this.axios.post(createTaskUrl, createTaskPayload);
        
        if (createTaskResponse.data.errorId > 0) {
          throw new Error(`Failed to create reCAPTCHA task: ${createTaskResponse.data.errorDescription}`);
        }
        
        const taskId = createTaskResponse.data.taskId;
        
        this.logger.info(`reCAPTCHA task created with ID: ${taskId}`, { walletIndex: this.walletIndex });
        
        // Get task result
        const getTaskResultUrl = 'https://api.capsolver.com/getTaskResult';
        const getTaskResultPayload = {
          clientKey: this.capsolverApiKey,
          taskId
        };
        
        let maxAttempts = 30; // Maximum number of attempts
        let attempt = 0;
        
        while (attempt < maxAttempts) {
          attempt += 1;
          
          const getTaskResultResponse = await this.axios.post(getTaskResultUrl, getTaskResultPayload);
          
          if (getTaskResultResponse.data.errorId > 0) {
            throw new Error(`Failed to get reCAPTCHA task result: ${getTaskResultResponse.data.errorDescription}`);
          }
          
          const status = getTaskResultResponse.data.status;
          
          if (status === 'ready') {
            const gRecaptchaResponse = getTaskResultResponse.data.solution.gRecaptchaResponse;
            
            this.logger.info('reCAPTCHA solved successfully', { walletIndex: this.walletIndex });
            
            return gRecaptchaResponse;
          } else if (status === 'processing') {
            // Wait before next attempt
            await new Promise(resolve => setTimeout(resolve, 2000));
          } else {
            throw new Error(`Unexpected reCAPTCHA task status: ${status}`);
          }
        }
        
        throw new Error('reCAPTCHA task timed out');
      }, config.general.retry_attempts, config.general.retry_delay, this.logger, this.walletIndex);
    } catch (error) {
      this.logger.error(`Failed to solve reCAPTCHA: ${error.message}`, { walletIndex: this.walletIndex });
      return null;
    }
  }
}

module.exports = RecaptchaService;