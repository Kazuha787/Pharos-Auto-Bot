/**
 * src/services/liquidity.js - Add liquidity service
 */
const { ethers } = require('ethers');
const getConfig = require('../../getConfig');
const { retry, sleep } = require('../utils/helpers');
const { TOKEN_ADDRESSES, CONTRACT_ADDRESSES, FEE_TIERS } = require('../utils/constants');
const { toChecksumAddress } = require('../utils/wallet');

// Config
const config = getConfig();

// Position Manager ABI for adding liquidity
const POSITION_MANAGER_ABI = [
  'function mint(tuple(address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline)) external payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)',
  'function increaseLiquidity(tuple(uint256 tokenId, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, uint256 deadline)) external payable returns (uint128 liquidity, uint256 amount0, uint256 amount1)',
  'function multicall(uint256 deadline, bytes[] calldata data) external payable returns (bytes[] memory)',
  'function balanceOf(address owner) external view returns (uint256)',
  'function tokenOfOwnerByIndex(address owner, uint256 index) external view returns (uint256)',
  'function positions(uint256 tokenId) external view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)'
];

// ERC20 ABI for approvals and balance checks
const ERC20_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function balanceOf(address account) external view returns (uint256)',
  'function decimals() external view returns (uint8)'
];

class LiquidityService {
  constructor(wallet, logger, walletIndex) {
    this.wallet = wallet;
    this.logger = logger;
    this.walletIndex = walletIndex;
    
    // Initialize contracts
    this.positionManager = new ethers.Contract(
      toChecksumAddress(CONTRACT_ADDRESSES.positionManager),
      POSITION_MANAGER_ABI,
      this.wallet
    );
  }
  
  /**
   * Find existing position for token pair
   */
  async findExistingPosition(token0, token1, fee) {
    try {
      // Get balance of NFT positions
      const balance = await this.positionManager.balanceOf(this.wallet.address);
      
      if (balance.eq(0)) {
        return null; // No positions owned
      }
      
      // Normalize addresses for comparison
      token0 = token0.toLowerCase();
      token1 = token1.toLowerCase();
      
      // Check each position
      for (let i = 0; i < balance.toNumber(); i++) {
        try {
          // Get token ID
          const tokenId = await this.positionManager.tokenOfOwnerByIndex(this.wallet.address, i);
          
          // Get position details
          const position = await this.positionManager.positions(tokenId);
          
          // Check if this position matches our token pair and fee
          const positionToken0 = position.token0.toLowerCase();
          const positionToken1 = position.token1.toLowerCase();
          
          if (
            ((positionToken0 === token0 && positionToken1 === token1) || 
             (positionToken0 === token1 && positionToken1 === token0)) && 
            position.fee === fee
          ) {
            this.logger.info(`Found existing position #${tokenId} for token pair`, { walletIndex: this.walletIndex });
            return {
              tokenId,
              token0: position.token0,
              token1: position.token1,
              tickLower: position.tickLower,
              tickUpper: position.tickUpper
            };
          }
        } catch (err) {
          this.logger.warn(`Error checking position ${i}: ${err.message}`, { walletIndex: this.walletIndex });
          continue;
        }
      }
      
      return null; // No matching position found
    } catch (error) {
      this.logger.error(`Error finding existing positions: ${error.message}`, { walletIndex: this.walletIndex });
      return null;
    }
  }
  
  /**
   * Get token decimals
   */
  async getTokenDecimals(tokenAddress) {
    try {
      const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, this.wallet);
      const decimals = await tokenContract.decimals();
      return decimals;
    } catch (error) {
      this.logger.warn(`Failed to fetch decimals for ${tokenAddress}, assuming 6: ${error.message}`, { walletIndex: this.walletIndex });
      return 6; // Default to 6 for USDC/USDT
    }
  }
  
  /**
   * Add liquidity to a pool
   */
  async addLiquidity(token0Name, token1Name, amount0, amount1) {
    this.logger.info(`Adding liquidity: ${amount0} ${token0Name} and ${amount1} ${token1Name}...`, { walletIndex: this.walletIndex });
    
    try {
      return await retry(async () => {
        // Get token addresses and ensure correct order
        let token0 = toChecksumAddress(TOKEN_ADDRESSES[token0Name]);
        let token1 = toChecksumAddress(TOKEN_ADDRESSES[token1Name]);
        
        if (!token0 || !token1) {
          throw new Error(`Invalid token pair: ${token0Name}/${token1Name}`);
        }
        
        // Ensure token0 < token1 (required by Uniswap)
        let swapped = false;
        if (token0.toLowerCase() > token1.toLowerCase()) {
          [token0, token1] = [token1, token0];
          [amount0, amount1] = [amount1, amount0];
          [token0Name, token1Name] = [token1Name, token0Name];
          swapped = true;
        }
        
        // Get token decimals
        const decimals0 = await this.getTokenDecimals(token0);
        const decimals1 = await this.getTokenDecimals(token1);
        
        // Calculate amounts
        const amount0Desired = ethers.utils.parseUnits(amount0.toString(), decimals0);
        const amount1Desired = ethers.utils.parseUnits(amount1.toString(), decimals1);
        
        // Initialize token contracts
        const token0Contract = new ethers.Contract(token0, ERC20_ABI, this.wallet);
        const token1Contract = new ethers.Contract(token1, ERC20_ABI, this.wallet);
        
        // Check balances
        const balance0 = await token0Contract.balanceOf(this.wallet.address);
        const balance1 = await token1Contract.balanceOf(this.wallet.address);
        this.logger.info(`Balances: ${ethers.utils.formatUnits(balance0, decimals0)} ${token0Name}, ${ethers.utils.formatUnits(balance1, decimals1)} ${token1Name}`, { walletIndex: this.walletIndex });
        
        if (balance0.lt(amount0Desired) || balance1.lt(amount1Desired)) {
          throw new Error(`Insufficient balance: Need ${amount0} ${token0Name} and ${amount1} ${token1Name}`);
        }
        
        // Approve position manager to spend tokens
        const allowance0 = await token0Contract.allowance(this.wallet.address, toChecksumAddress(CONTRACT_ADDRESSES.positionManager));
        const allowance1 = await token1Contract.allowance(this.wallet.address, toChecksumAddress(CONTRACT_ADDRESSES.positionManager));
        
        if (allowance0.lt(amount0Desired)) {
          this.logger.info(`Approving ${amount0} ${token0Name} for ${CONTRACT_ADDRESSES.positionManager}...`, { walletIndex: this.walletIndex });
          const approveTx0 = await token0Contract.approve(
            toChecksumAddress(CONTRACT_ADDRESSES.positionManager),
            amount0Desired, // Approve exact amount
            { gasLimit: 100000 }
          );
          await approveTx0.wait();
          this.logger.info(`Approved ${token0Name}`, { walletIndex: this.walletIndex });
        }
        
        if (allowance1.lt(amount1Desired)) {
          this.logger.info(`Approving ${amount1} ${token1Name} for ${CONTRACT_ADDRESSES.positionManager}...`, { walletIndex: this.walletIndex });
          const approveTx1 = await token1Contract.approve(
            toChecksumAddress(CONTRACT_ADDRESSES.positionManager),
            amount1Desired, // Approve exact amount
            { gasLimit: 100000 }
          );
          await approveTx1.wait();
          this.logger.info(`Approved ${token1Name}`, { walletIndex: this.walletIndex });
        }
        
        // Check for existing position
        const existingPosition = await this.findExistingPosition(
          token0, 
          token1, 
          FEE_TIERS.LOW
        );
        
        let tx;
        
        if (existingPosition) {
          // Use existing position
          this.logger.info(`Using existing position #${existingPosition.tokenId}`, { walletIndex: this.walletIndex });
          
          const params = {
            tokenId: existingPosition.tokenId,
            amount0Desired,
            amount1Desired,
            amount0Min: 0,
            amount1Min: 0,
            deadline: Math.floor(Date.now() / 1000) + 60 * 20
          };
          
          tx = await this.positionManager.increaseLiquidity(
            params,
            { gasLimit: 800000 } // Increased gas limit
          );
          
          this.logger.info(`Increase liquidity transaction sent: ${tx.hash}`, { walletIndex: this.walletIndex });
        } else {
          // Create new position
          this.logger.info(`Creating new position for ${token0Name}/${token1Name}`, { walletIndex: this.walletIndex });
          
          // Use narrower ticks for stablecoin pairs
          const tickLower = -100; // Narrow range for stablecoins
          const tickUpper = 100;
          
          const mintParams = {
            token0,
            token1,
            fee: FEE_TIERS.LOW, // Verify this (500 = 0.05%)
            tickLower,
            tickUpper,
            amount0Desired,
            amount1Desired,
            amount0Min: 0,
            amount1Min: 0,
            recipient: this.wallet.address,
            deadline: Math.floor(Date.now() / 1000) + 60 * 20
          };
          
          tx = await this.positionManager.mint(
            mintParams,
            { gasLimit: 1000000 } // Increased gas limit
          );
          
          this.logger.info(`Add liquidity transaction sent: ${tx.hash}`, { walletIndex: this.walletIndex });
        }
        
        // Wait for transaction to be mined
        const receipt = await tx.wait();
        
        this.logger.info(`Add liquidity transaction confirmed: ${receipt.transactionHash}`, { walletIndex: this.walletIndex });
        
        return receipt.transactionHash;
      }, config.general.retry_attempts, config.general.retry_delay * 2, this.logger, this.walletIndex); // Increased retry delay
    } catch (error) {
      // Debug revert reason
      if (error.code === 'CALL_EXCEPTION' && error.transactionHash) {
        try {
          const provider = this.wallet.provider;
          const txResponse = await provider.getTransaction(error.transactionHash);
          const code = await provider.call(txResponse, txResponse.blockNumber);
          this.logger.error(`Revert reason: ${code}`, { walletIndex: this.walletIndex });
        } catch (revertError) {
          this.logger.error(`Failed to fetch revert reason: ${revertError.message}`, { walletIndex: this.walletIndex });
        }
      }
      this.logger.error(`Add liquidity failed: ${error.message}`, { walletIndex: this.walletIndex });
      return null;
    }
  }
  
  /**
   * Increase liquidity in an existing position
   */
  async increaseLiquidity(tokenId, amount0, amount1, token0Name, token1Name) {
    this.logger.info(`Increasing liquidity for position #${tokenId}: ${amount0} ${token0Name} and ${amount1} ${token1Name}...`, { walletIndex: this.walletIndex });
    
    try {
      return await retry(async () => {
        // Get token addresses
        const token0 = toChecksumAddress(TOKEN_ADDRESSES[token0Name]);
        const token1 = toChecksumAddress(TOKEN_ADDRESSES[token1Name]);
        
        if (!token0 || !token1) {
          throw new Error(`Invalid token pair: ${token0Name}/${token1Name}`);
        }
        
        // Get token decimals
        const decimals0 = await this.getTokenDecimals(token0);
        const decimals1 = await this.getTokenDecimals(token1);
        
        // Calculate amounts
        const amount0Desired = ethers.utils.parseUnits(amount0.toString(), decimals0);
        const amount1Desired = ethers.utils.parseUnits(amount1.toString(), decimals1);
        
        // Initialize token contracts
        const token0Contract = new ethers.Contract(token0, ERC20_ABI, this.wallet);
        const token1Contract = new ethers.Contract(token1, ERC20_ABI, this.wallet);
        
        // Check balances
        const balance0 = await token0Contract.balanceOf(this.wallet.address);
        const balance1 = await token1Contract.balanceOf(this.wallet.address);
        if (balance0.lt(amount0Desired) || balance1.lt(amount1Desired)) {
          throw new Error(`Insufficient balance: Need ${amount0} ${token0Name} and ${amount1} ${token1Name}`);
        }
        
        // Approve position manager to spend tokens
        const allowance0 = await token0Contract.allowance(this.wallet.address, toChecksumAddress(CONTRACT_ADDRESSES.positionManager));
        const allowance1 = await token1Contract.allowance(this.wallet.address, toChecksumAddress(CONTRACT_ADDRESSES.positionManager));
        
        if (allowance0.lt(amount0Desired)) {
          this.logger.info(`Approving ${amount0} ${token0Name} for ${CONTRACT_ADDRESSES.positionManager}...`, { walletIndex: this.walletIndex });
          const approveTx0 = await token0Contract.approve(
            toChecksumAddress(CONTRACT_ADDRESSES.positionManager),
            amount0Desired,
            { gasLimit: 100000 }
          );
          await approveTx0.wait();
          this.logger.info(`Approved ${token0Name}`, { walletIndex: this.walletIndex });
        }
        
        if (allowance1.lt(amount1Desired)) {
          this.logger.info(`Approving ${amount1} ${token1Name} for ${CONTRACT_ADDRESSES.positionManager}...`, { walletIndex: this.walletIndex });
          const approveTx1 = await token1Contract.approve(
            toChecksumAddress(CONTRACT_ADDRESSES.positionManager),
            amount1Desired,
            { gasLimit: 100000 }
          );
          await approveTx1.wait();
          this.logger.info(`Approved ${token1Name}`, { walletIndex: this.walletIndex });
        }
        
        // Create increase liquidity parameters
        const params = {
          tokenId,
          amount0Desired,
          amount1Desired,
          amount0Min: 0,
          amount1Min: 0,
          deadline: Math.floor(Date.now() / 1000) + 60 * 20
        };
        
        const tx = await this.positionManager.increaseLiquidity(
          params,
          { gasLimit: 800000 } // Increased gas limit
        );
        
        this.logger.info(`Increase liquidity transaction sent: ${tx.hash}`, { walletIndex: this.walletIndex });
        
        const receipt = await tx.wait();
        
        this.logger.info(`Increase liquidity transaction confirmed: ${receipt.transactionHash}`, { walletIndex: this.walletIndex });
        
        return receipt.transactionHash;
      }, config.general.retry_attempts, config.general.retry_delay * 2, this.logger, this.walletIndex);
    } catch (error) {
      if (error.code === 'CALL_EXCEPTION' && error.transactionHash) {
        try {
          const provider = this.wallet.provider;
          const txResponse = await provider.getTransaction(error.transactionHash);
          const code = await provider.call(txResponse, txResponse.blockNumber);
          this.logger.error(`Revert reason: ${code}`, { walletIndex: this.walletIndex });
        } catch (revertError) {
          this.logger.error(`Failed to fetch revert reason: ${revertError.message}`, { walletIndex: this.walletIndex });
        }
      }
      this.logger.error(`Increase liquidity failed: ${error.message}`, { walletIndex: this.walletIndex });
      return null;
    }
  }
}

module.exports = LiquidityService;
