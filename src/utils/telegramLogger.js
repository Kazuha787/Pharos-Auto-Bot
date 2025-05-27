// src/utils/telegramLogger.js
const axios = require('axios');
const getConfig = require('../../getConfig');

const config = getConfig;

/**
 * Check if Telegram logs are enabled
 * @returns {boolean} - True if enabled, false otherwise
 */
function isTelegramLogsEnabled() {
  const config = getConfig();
  return config.SETTINGS && config.SETTINGS.TELEGRAM_LOGS !== false;
}

/**
 * Send a message to Telegram bot/channel
 * @param {string} message - The message to send
 */
async function sendTelegramMessage(message) {
  if (!isTelegramLogsEnabled()) return;
  try {
    const config = getConfig();
    const botToken = config.SETTINGS.TELEGRAM_BOT_TOKEN;
    const userIds = config.SETTINGS.TELEGRAM_USERS_IDS;
    if (!botToken || !userIds || userIds.length === 0) return;
    for (const userId of userIds) {
      await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        chat_id: userId,
        text: message,
        parse_mode: 'Markdown'
      });
    }
  } catch (err) {
    // Optionally log error
  }
}

// Utility to get address from private key (ethers.js)
const { ethers } = require('ethers');

function getAddressFromPrivateKey(pk) {
  try {
    return new ethers.Wallet(pk).address;
  } catch {
    return pk;
  }
}

// Enhanced summary with more professional details
async function sendTelegramSummary({botName, walletName, walletAddress, completedTasks, failedTasks, totalTasks, settings, walletNumber, totalWallets, runTime, startTime, endTime}) {
  if (!isTelegramLogsEnabled()) return;
  const completedList = completedTasks.length
    ? completedTasks.map((t, i) => `${i + 1}. ${t}`).join("\n")
    : 'None';
  const failedList = failedTasks.length
    ? failedTasks.map((t, i) => `${i + 1}. ${t}`).join("\n")
    : 'None';
  const successRate = totalTasks > 0 ? ((completedTasks.length / totalTasks) * 100).toFixed(1) : '0.0';
  const now = new Date();
  const timeStr = now.toLocaleString('en-GB', { hour12: false });
  const header = `🐰 *Pharos Bot Report*\n` +
    `🕒 Run Time: ${runTime || '-'}\n` +
    `🗓 Date: ${timeStr}`;
  const walletInfo = `\n💳 Wallet ${walletNumber}/${totalWallets}: ${walletName} | \`${walletAddress}\``;
  const completedSection = `\n✅ *Completed Tasks:*\n${completedList}`;
  const failedSection = failedTasks.length ? `\n❌ *Failed Tasks:*\n${failedList}` : '';
  const stats =
    `\n\n📊 *Statistics:*\n` +
    `Total Tasks: ${totalTasks}\n` +
    `Completed: ${completedTasks.length}\n` +
    `Failed: ${failedTasks.length}\n` +
    `Success Rate: ${successRate}%`;
  const settingsSection =
    `\n\n⚙️ *Settings:*\n` +
    `Threads: ${settings.THREADS}\n` +
    `Attempts: ${settings.ATTEMPTS}\n` +
    `Skip Failed: ${settings.skipFailed ? 'Yes' : 'No'}`;
  const message = `${header}${walletInfo}${completedSection}${failedSection}${stats}${settingsSection}`;
  await sendTelegramMessage(message);
}

module.exports = {
  sendTelegramMessage,
  sendTelegramSummary,
  getAddressFromPrivateKey,
  isTelegramLogsEnabled
};
