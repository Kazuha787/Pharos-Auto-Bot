/**
 * src/services/swap.js - Token swap service
 */
const { ethers } = require('ethers');
const getConfig = require('../../getConfig');
const { retry, sleep } = require('../utils/helpers');
const { TOKEN_ADDRESSES, CONTRACT_ADDRESSES, FEE_TIERS } = require('../utils/constants');
const { toChecksumAddress } = require('../utils/wallet');

// Config
const config = getConfig();

// ERC20 ABI for token approvals
const ERC20_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)'
];

class SwapService {
  constructor(wallet, logger, walletIndex) {
    this.wallet = wallet;
    this.logger = logger;
    this.walletIndex = walletIndex;
    this.provider = wallet.provider;
  }
  
  /**
   * Get current gas price with buffer
   */
  async getGasPrice() {
    // Get current gas price from the network
    const gasPrice = await this.provider.getGasPrice();
    
    // Add 20% buffer to ensure transaction goes through
    const gasPriceWithBuffer = gasPrice.mul(120).div(100);
    
    return gasPriceWithBuffer;
  }
  
  /**
   * Get EIP-1559 fee data with buffer
   */
  async getFeeData() {
    try {
      // Get fee data from provider
      const feeData = await this.provider.getFeeData();
      
      // Add 20% buffer to maxFeePerGas and maxPriorityFeePerGas
      const maxFeePerGas = feeData.maxFeePerGas ? 
        feeData.maxFeePerGas.mul(120).div(100) : 
        ethers.utils.parseUnits('1.2', 'gwei');
      
      const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas ? 
        feeData.maxPriorityFeePerGas.mul(120).div(100) : 
        ethers.utils.parseUnits('1.2', 'gwei');
      
      return { maxFeePerGas, maxPriorityFeePerGas };
    } catch (error) {
      this.logger.warn(`Error getting fee data: ${error.message}. Using default values.`, { walletIndex: this.walletIndex });
      return {
        maxFeePerGas: ethers.utils.parseUnits('1.2', 'gwei'),
        maxPriorityFeePerGas: ethers.utils.parseUnits('1.2', 'gwei')
      };
    }
  }
  
  /**
   * Estimate gas for a transaction
   */
  async estimateGas(txParams) {
    try {
      const gasEstimate = await this.provider.estimateGas(txParams);
      
      // Add 30% buffer to gas estimate to ensure transaction goes through
      const gasEstimateWithBuffer = gasEstimate.mul(130).div(100);
      
      return gasEstimateWithBuffer;
    } catch (error) {
      this.logger.warn(`Error estimating gas: ${error.message}. Using default values.`, { walletIndex: this.walletIndex });
      
      // Default gas limits based on transaction type
      if (txParams.value && !txParams.value.isZero()) {
        return ethers.BigNumber.from(200000); // Native token swap
      } else {
        return ethers.BigNumber.from(300000); // ERC20 token swap
      }
    }
  }
  
  /**
   * Swap tokens - Supports any token pair
   */
  async swap(fromToken, toToken, amount) {
    this.logger.info(`Swapping ${amount} ${fromToken} to ${toToken}...`, { walletIndex: this.walletIndex });
    
    try {
      return await retry(async () => {
        // Get token addresses with proper checksums
        const tokenIn = toChecksumAddress(TOKEN_ADDRESSES[fromToken]);
        const tokenOut = toChecksumAddress(TOKEN_ADDRESSES[toToken]);
        
        if (!tokenIn || !tokenOut) {
          throw new Error(`Invalid token pair: ${fromToken}/${toToken}. Available tokens: ${Object.keys(TOKEN_ADDRESSES).join(', ')}`);
        }
        
        // Create deadline (20 minutes from now)
        const deadline = Math.floor(Date.now() / 1000) + (60 * 20);
        
        // The exact function selector for exactInputSingle
        const exactInputSingleFunctionSelector = '0x04e45aaf';
        
        // Parse amount based on whether it's native token or not
        const amountIn = ethers.utils.parseEther(amount.toString());
        
        // Get current fee data
        const { maxFeePerGas, maxPriorityFeePerGas } = await this.getFeeData();
        
        // Check if approval is needed for ERC20 tokens
        let tx;
        
        // If swapping from native PHRS
        if (fromToken === 'PHRS') {
          // Generate the exactInputSingle call data
          const exactInputSingleData = exactInputSingleFunctionSelector + ethers.utils.defaultAbiCoder.encode(
            [
              'address', // tokenIn
              'address', // tokenOut
              'uint24',  // fee
              'address', // recipient
              'uint256', // amountIn
              'uint256', // amountOutMinimum
              'uint160'  // sqrtPriceLimitX96
            ],
            [
              tokenIn,
              tokenOut,
              FEE_TIERS.LOW,  // 500 (0.05%)
              this.wallet.address,
              amountIn,
              '0', // No minimum output
              '0'  // No price limit
            ]
          ).substring(2);
          
          // Format the raw transaction with multicall
          const txData = ethers.utils.hexConcat([
            '0x5ae401dc', // multicall function selector
            ethers.utils.defaultAbiCoder.encode(
              ['uint256', 'bytes[]'],
              [
                deadline,
                [exactInputSingleData]
              ]
            )
          ]);
          
          // Create transaction parameters
          const txParams = {
            to: toChecksumAddress(CONTRACT_ADDRESSES.swapRouter),
            from: this.wallet.address,
            value: amountIn,
            data: txData,
            maxFeePerGas,
            maxPriorityFeePerGas
          };
          
          // Estimate gas dynamically
          txParams.gasLimit = await this.estimateGas(txParams);
          
          this.logger.info(`Sending native token swap transaction`, { walletIndex: this.walletIndex });
          
          // Send transaction
          tx = await this.wallet.sendTransaction(txParams);
        } 
        // If swapping from ERC20 token
        else {
          // First check and approve if needed
          const tokenContract = new ethers.Contract(tokenIn, ERC20_ABI, this.wallet);
          
          // Check current allowance
          const currentAllowance = await tokenContract.allowance(this.wallet.address, CONTRACT_ADDRESSES.swapRouter);
          
          // If allowance is insufficient, approve first
          if (currentAllowance.lt(amountIn)) {
            this.logger.info(`Approving ${fromToken} for swap...`, { walletIndex: this.walletIndex });
            
            // Get fee data for approval transaction
            const approvalFeeData = await this.getFeeData();
            
            const approvalTxParams = {
              gasLimit: ethers.BigNumber.from(100000), // Default gas limit for approvals
              maxFeePerGas: approvalFeeData.maxFeePerGas,
              maxPriorityFeePerGas: approvalFeeData.maxPriorityFeePerGas
            };
            
            // Try to estimate gas for approval
            try {
              const approveGasEstimate = await tokenContract.estimateGas.approve(
                CONTRACT_ADDRESSES.swapRouter,
                ethers.constants.MaxUint256
              );
              
              // Add 30% buffer
              approvalTxParams.gasLimit = approveGasEstimate.mul(130).div(100);
            } catch (error) {
              this.logger.warn(`Error estimating gas for approval: ${error.message}. Using default value.`, { walletIndex: this.walletIndex });
            }
            
            const approveTx = await tokenContract.approve(
              CONTRACT_ADDRESSES.swapRouter,
              ethers.constants.MaxUint256, // Infinite approval
              approvalTxParams
            );
            
            this.logger.info(`Approval transaction sent: ${approveTx.hash}`, { walletIndex: this.walletIndex });
            
            // Wait for approval to be confirmed
            const approveReceipt = await approveTx.wait();
            
            if (approveReceipt.status === 0) {
              throw new Error(`Approval transaction failed: ${approveTx.hash}`);
            }
            
            this.logger.info(`Approval confirmed: ${approveReceipt.transactionHash}`, { walletIndex: this.walletIndex });
          }
          
          // Generate the exactInputSingle call data
          const exactInputSingleData = exactInputSingleFunctionSelector + ethers.utils.defaultAbiCoder.encode(
            [
              'address', // tokenIn
              'address', // tokenOut
              'uint24',  // fee
              'address', // recipient
              'uint256', // amountIn
              'uint256', // amountOutMinimum
              'uint160'  // sqrtPriceLimitX96
            ],
            [
              tokenIn,
              tokenOut,
              FEE_TIERS.LOW,  // 500 (0.05%)
              this.wallet.address,
              amountIn,
              '0', // No minimum output
              '0'  // No price limit
            ]
          ).substring(2);
          
          // Format the raw transaction with multicall
          const txData = ethers.utils.hexConcat([
            '0x5ae401dc', // multicall function selector
            ethers.utils.defaultAbiCoder.encode(
              ['uint256', 'bytes[]'],
              [
                deadline,
                [exactInputSingleData]
              ]
            )
          ]);
          
          // Create transaction parameters for ERC20 swap
          const txParams = {
            to: toChecksumAddress(CONTRACT_ADDRESSES.swapRouter),
            from: this.wallet.address,
            value: 0, // No ETH value for ERC20 swaps
            data: txData,
            maxFeePerGas,
            maxPriorityFeePerGas
          };
          
          // Estimate gas dynamically
          txParams.gasLimit = await this.estimateGas(txParams);
          
          this.logger.info(`Sending ERC20 token swap transaction`, { walletIndex: this.walletIndex });
          
          // Send transaction
          tx = await this.wallet.sendTransaction(txParams);
        }
        
        this.logger.info(`Swap transaction sent: ${tx.hash}`, { walletIndex: this.walletIndex });
        
        // Wait for transaction to be mined
        const receipt = await tx.wait();
        
        if (receipt.status === 0) {
          throw new Error(`Transaction failed: ${tx.hash}`);
        }
        
        this.logger.info(`Swap transaction confirmed: ${receipt.transactionHash}`, { walletIndex: this.walletIndex });
        
        return receipt.transactionHash;
      }, config.general.retry_attempts, config.general.retry_delay, this.logger, this.walletIndex);
    } catch (error) {
      this.logger.error(`Swap failed: ${error.message}`, { walletIndex: this.walletIndex });
      
      // Log detailed error information
      if (error.transaction) {
        this.logger.error(`Transaction details: ${JSON.stringify({
          hash: error.transaction.hash,
          from: error.transaction.from,
          to: error.transaction.to,
          value: error.transaction.value?.toString(),
          gasLimit: error.transaction.gasLimit?.toString(),
          nonce: error.transaction.nonce
        })}`, { walletIndex: this.walletIndex });
      }
      
      return null;
    }
  }
}

module.exports = SwapService;