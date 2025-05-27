/**
 * src/services/transfer.js - Self-transfer service
 */
const { ethers } = require('ethers');
const getConfig = require('../../getConfig');
const { retry, sleep } = require('../utils/helpers');

const config = getConfig();

class TransferService {
  constructor(wallet, logger, walletIndex) {
    this.wallet = wallet;
    this.logger = logger;
    this.walletIndex = walletIndex;
  }
  
  /**
   * Perform self-transfer
   */
  async selfTransfer(amount) {
    this.logger.info(`Performing self-transfer of ${amount} PHRS...`, { walletIndex: this.walletIndex });
    
    try {
      return await retry(async () => {
        // Get wallet address
        const address = this.wallet.address;
        
        // Check balance
        const balance = await this.wallet.getBalance();
        const balanceInEther = ethers.utils.formatEther(balance);
        
        if (parseFloat(balanceInEther) < parseFloat(amount) + 0.0005) { // Add gas fee buffer
          throw new Error(`Insufficient balance: ${balanceInEther} PHRS`);
        }
        
        // Create transaction
        const tx = {
          to: address,
          value: ethers.utils.parseEther(amount.toString()),
          gasLimit: 21000
        };
        
        // Send transaction
        const txResponse = await this.wallet.sendTransaction(tx);
        
        this.logger.info(`Self-transfer transaction sent: ${txResponse.hash}`, { walletIndex: this.walletIndex });
        
        // Wait for transaction to be mined
        const receipt = await txResponse.wait();
        
        this.logger.info(`Self-transfer transaction confirmed: ${receipt.transactionHash}`, { walletIndex: this.walletIndex });
        
        return receipt.transactionHash;
      }, config.general.retry_attempts, config.general.retry_delay, this.logger, this.walletIndex);
    } catch (error) {
      this.logger.error(`Self-transfer failed: ${error.message}`, { walletIndex: this.walletIndex });
      return null;
    }
  }
}

module.exports = TransferService;