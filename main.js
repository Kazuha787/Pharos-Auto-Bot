const chalk = require("chalk").default || require("chalk");
const path = require("path");
const fs = require("fs");
const readline = require("readline");
const service = require("./service");
const getConfig = require('./getConfig');
const { sendTelegramMessage, isTelegramLogsEnabled, sendTelegramSummary } = require('./src/utils/telegramLogger');
const dbManager = require('./src/utils/dbManager');
const { fetchWalletStatistics, printStatisticsTable } = require('./src/utils/statistics');

let inquirer = require('inquirer');
if (inquirer.default) inquirer = inquirer.default;

// ---- MENU OPTIONS (Clean, No Emojis) ----
const menuOptions = [
  { label: "Account Login", value: "accountLogin" },
  { label: "Account Check-in", value: "accountCheckIn" },
  { label: "Account Check", value: "accountCheck" },
  { label: "Claim Faucet PHRS", value: "accountClaimFaucet" },
  { label: "Claim Faucet USDC", value: "claimFaucetUSDC" },
  { label: "Swap PHRS to USDC", value: "performSwapUSDC" },
  { label: "Swap PHRS to USDT", value: "performSwapUSDT" },
  { label: "Add Liquidity PHRS-USDC", value: "addLpUSDC" },
  { label: "Add Liquidity PHRS-USDT", value: "addLpUSDT" },
  { label: "Random Transfer", value: "randomTransfer" },
  { label: "Social Task", value: "socialTask" },
  { label: "Auto with DB Manager", value: "automateAllTasks" },
  { label: "Database Manager", value: "databaseManager" },
  { label: "Wallet Statistics", value: "walletStatistics" }, // NEW
  { label: "Set Transaction Count", value: "setTransactionCount" },
  { label: "Exit", value: "exit" },
];

// ---- BANNER ----
const asciiBannerLines = [
  "██████╗     ██╗  ██╗     █████╗     ██████╗      ██████╗     ███████╗",
  "██╔══██╗    ██║  ██║    ██╔══██╗    ██╔══██╗    ██╔═══██╗    ██╔════╝",
  "██████╔╝    ███████║    ███████║    ██████╔╝    ██║   ██║    ███████╗",
  "██╔═══╝     ██╔══██║    ██╔══██║    ██╔══██╗    ██║   ██║    ╚════██║",
  "██║         ██║  ██║    ██║  ██║    ██║  ██║    ╚██████╔╝    ███████║",
  "╚═╝         ╚═╝  ╚═╝    ╚═╝  ╚═╝    ╚═╝  ╚═╝     ╚═════╝     ╚══════╝",
  "",
  "       Pharos Testnet Bot v3.0 - Created By Kazuha787       ",
  "                  LETS FUCK THIS TESTNET                   ",
];

// ---- GLOBAL VARIABLES ----
global.selectedWallets = [];
global.maxTransaction = 5;

// ---- UTILITY FUNCTIONS ----
// Load wallets
function loadWallets() {
  try {
    const walletPath = path.join(__dirname, "wallet.json");
    const data = fs.readFileSync(walletPath, "utf8");
    const json = JSON.parse(data);
    global.selectedWallets = json.wallets || [];
    return global.selectedWallets;
  } catch {
    return [];
  }
}

// Format log messages with vibrant colors
function formatLogMessage(msg) {
  const timestamp = new Date().toLocaleTimeString("en-US", { hour12: false });
  msg = (msg || "").toString().trim();
  if (!msg) return chalk.hex("#CCCCCC")(`[${timestamp}] Empty log`);

  const parts = msg.split("|").map((s) => s?.trim() || "");
  const walletName = parts[0] || "System";

  // Transaction Confirmation or Success (Green)
  if (parts.length >= 3 && (parts[2]?.includes("Confirmed") || parts[2]?.includes("claimed successfully"))) {
    const logParts = parts[2].split(/Confirmed:|claimed successfully:/);
    const message = logParts[0]?.trim() || "";
    const hashPart = logParts[1]?.trim() || "";
    return chalk.green.bold(
      `[${timestamp}] ${walletName.padEnd(25)} | ${message}${hashPart ? "Confirmed: " : "claimed successfully: "}${chalk.greenBright.bold(hashPart || "0.2 PHRS")}`
    );
  }

  // Transaction Initiation (Purple)
  if (
    parts.length >= 2 &&
    (parts[1]?.includes("Initiating") || parts[1]?.includes("Claiming") || parts[1]?.includes("Checking") || parts[1]?.includes("Generating"))
  ) {
    return chalk.hex("#C71585").bold(
      `[${timestamp}] ${walletName.padEnd(25)} | ${parts[1]}`
    );
  }

  // Warnings (Yellow)
  if (parts.length >= 2 && parts[1]?.includes("Warning")) {
    return chalk.yellow.bold(
      `[${timestamp}] ${walletName.padEnd(25)} | ${parts.slice(1).join(" | ")}`
    );
  }

  // Errors (Red)
  if (msg.includes("Error") || msg.includes("Failed")) {
    const errorMsg = parts.length > 2 ? parts.slice(2).join(" | ").replace(/\d{2}:\d{2}:\d{2}\s*\|\s*\d{2}-\d{2}-\d{4}/, "").trim() : msg;
    return chalk.red.bold(
      `[${timestamp}] ${walletName.padEnd(25)} | ${errorMsg}`
    );
  }

  // System Messages (Gray)
  return chalk.hex("#CCCCCC")(
    `[${timestamp}] ${walletName.padEnd(25)} | ${parts.slice(parts.length >= 2 ? 1 : 0).join(" | ") || msg}`
  );
}

// Spinner animation
const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
function createSpinner(text) {
  let frameIndex = 0;
  let stopped = false;

  const interval = setInterval(() => {
    if (stopped) return;
    process.stdout.write(`\r${chalk.green(spinnerFrames[frameIndex])} ${chalk.greenBright(text)}`);
    frameIndex = (frameIndex + 1) % spinnerFrames.length;
  }, 100);

  return {
    stop: () => {
      stopped = true;
      clearInterval(interval);
      process.stdout.write("\r\x1b[K"); // Clear line
    },
  };
}

// Readline interface
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// Input prompt
function requestInput(promptText, type = "text", defaultValue = "") {
  return new Promise((resolve) => {
    rl.question(chalk.greenBright(`${promptText}${defaultValue ? ` [${defaultValue}]` : ""}: `), (value) => {
      if (type === "number") value = Number(value);
      if (value === "" || (type === "number" && isNaN(value))) value = defaultValue;
      resolve(value);
    });
  });
}

// Display banner
function displayBanner() {
  console.clear();
  console.log(chalk.hex("#D8BFD8").bold(asciiBannerLines.join("\n")));
  console.log();
}

// Display menu
function displayMenu() {
  console.log(chalk.blueBright.bold("\n>═══ Pharos Testnet Bot Menu ═══<"));
  menuOptions.forEach((opt, idx) => {
    const optionNumber = `${idx + 1}`.padStart(2, '0'); // Two-digit numbering
    console.log(chalk.blue(`  ${optionNumber} > ${opt.label.padEnd(35)} <`));
  });
  console.log(chalk.blueBright.bold(">═══════════════════════════════<\n"));
}

// Helper to get wallet balance summary for Telegram
async function getWalletBalancesSummary() {
  const { ethers } = require('ethers');
  const config = getConfig();
  const RPC_URL = "https://testnet.dplabs-internal.com";
  let summary = [];
  for (let a of global.selectedWallets || []) {
    let { privatekey: t, name: $ } = a;
    if (!t) continue;
    try {
      let provider = new ethers.JsonRpcProvider(RPC_URL, { chainId: 688688, name: "pharos-testnet" });
      let r = new ethers.Wallet(t, provider);
      let balance = await provider.getBalance(r.address);
      let balanceEth = ethers.formatEther(balance);
      summary.push(`${$ || 'Wallet'}: ${balanceEth} PHRS`);
    } catch (e) {
      summary.push(`${$ || 'Wallet'}: Error`);
    }
  }
  return summary.join('\n');
}

// Wraps a service function to send Telegram summary after execution
function withTelegramSummary(taskName, serviceFunc) {
  return async function(logger) {
    let completed = 0, failed = 0;
    // Wrap logger to count success/fail
    const countingLogger = (msg) => {
      logger(msg);
      if (typeof msg === 'string') {
        if (/confirmed|success|completed|claimed|sent/i.test(msg)) completed++;
        if (/fail|error|insufficient/i.test(msg)) failed++;
      }
    };
    await serviceFunc(countingLogger);
    const balances = await getWalletBalancesSummary();
    const message = `*Task:* ${taskName}\n*Completed:* ${completed}\n*Failed:* ${failed}\n*Wallet Balances:*\n${balances}`;
    await sendTelegramMessage(message);
  };
}

// Patch: Wrap each menu task in a Telegram logger wrapper
function telegramTaskWrapper(taskName, serviceFunc) {
  return async function(logger) {
    if (global.suppressTelegramLogs) {
      // Just run the task, no Telegram log
      await serviceFunc(logger);
      return;
    }
    let completedTasks = [], failedTasks = [];
    // Wrap logger to track each task
    const countingLogger = (msg) => {
      logger(msg);
      if (typeof msg === 'string') {
        if (/confirmed|success|completed|claimed|sent/i.test(msg)) completedTasks.push(taskName);
        if (/fail|error|insufficient/i.test(msg)) failedTasks.push(taskName);
      }
    };
    await serviceFunc(countingLogger);
    // Compose a detailed summary for this wallet and task
    const botName = 'Pharos Bot';
    const config = getConfig();
    const settings = {
      THREADS: config.SETTINGS.THREADS,
      ATTEMPTS: config.SETTINGS.ATTEMPTS,
      PAUSE_BETWEEN_ATTEMPTS: config.SETTINGS.PAUSE_BETWEEN_ATTEMPTS,
      PAUSE_BETWEEN_SWAPS: config.SETTINGS.PAUSE_BETWEEN_SWAPS,
      RANDOM_PAUSE: config.SETTINGS.RANDOM_PAUSE,
      RANDOM_PAUSE_BETWEEN_ACCOUNTS: config.SETTINGS.RANDOM_PAUSE_BETWEEN_ACCOUNTS,
      RANDOM_PAUSE_BETWEEN_ACTIONS: config.SETTINGS.RANDOM_PAUSE_BETWEEN_ACTIONS,
      skipFailed: false
    };
    // Try to get wallet info from global.selectedWallets
    let walletName = 'Wallet';
    let walletAddress = '';
    if (global.selectedWallets && global.selectedWallets.length > 0) {
      const w = global.selectedWallets[0];
      walletName = w.name || 'Wallet';
      const { getAddressFromPrivateKey } = require('./src/utils/telegramLogger');
      walletAddress = getAddressFromPrivateKey(w.privatekey);
    }
    await sendTelegramSummary({
      botName,
      walletName,
      walletAddress,
      completedTasks,
      failedTasks,
      totalTasks: completedTasks.length + failedTasks.length,
      settings,
      walletNumber: 1,
      totalWallets: 1
    });
  };
}

const telegramTasks = [
  'accountLogin',
  'accountCheckIn',
  'accountCheck',
  'accountClaimFaucet',
  'claimFaucetUSDC',
  'performSwapUSDC',
  'performSwapUSDT',
  'addLpUSDC',
  'addLpUSDT',
  'randomTransfer',
  'socialTask',
];

// Remove global wrapping of service functions with telegramTaskWrapper
// for (const task of telegramTasks) {
//   if (service[task]) {
//     // Save the raw function for single menu actions
//     service[task].__rawFunc = service[task].__rawFunc || service[task];
//     service[task] = telegramTaskWrapper(task, service[task].__rawFunc);
//   }
// }

// ---- Wallet Statistics Function ----
function formatStatisticsTextTable({ headers, tableData, totalBalance, totalTxs, walletsLength, totalPoints, totalTaskPoints, totalInvitePoints }) {
  // Calculate column widths
  const colWidths = headers.map((h, i) => Math.max(h.length, ...tableData.map(row => (row[i] + '').length)));
  const pad = (str, len, isNum) => isNum ? (str + '').padStart(len, ' ') : (str + '').padEnd(len, ' ');
  const numCols = [0, 2, 3, 4, 5, 6, 7];
  const drawLine = (left, fill, mid, right) =>
    left + colWidths.map(w => fill.repeat(w + 2)).join(mid) + right;
  const drawRow = (row) =>
    '│' + row.map((cell, i) => ' ' + pad(cell, colWidths[i], numCols.includes(i) && !isNaN(cell)) + ' ').join('│') + '│';
  let lines = [];
  lines.push(drawLine('┌', '─', '┬', '┐'));
  lines.push(drawRow(headers));
  lines.push(drawLine('├', '─', '┼', '┤'));
  for (const row of tableData) lines.push(drawRow(row));
  lines.push(drawLine('└', '─', '┴', '┘'));
  lines.push(`Total wallets: ${walletsLength} | Total balance: ${totalBalance.toFixed(4)} PHRS | Total txs: ${totalTxs}`);
  lines.push(`Total Points: ${totalPoints} | Task Points: ${totalTaskPoints} | Invite Points: ${totalInvitePoints}`);
  return lines.join('\n');
}

function formatStatisticsMarkdownTable({ headers, tableData, totalBalance, totalTxs, walletsLength, totalPoints, totalTaskPoints, totalInvitePoints }) {
  // Markdown table header
  let md = `| ${headers.join(' | ')} |\n|${headers.map(() => '---').join('|')}|\n`;
  for (const row of tableData) {
    md += `| ${row.join(' | ')} |\n`;
  }
  md += `\n**Total wallets:** ${walletsLength}  |  **Total balance:** ${totalBalance.toFixed(4)} PHRS  |  **Total txs:** ${totalTxs}`;
  md += `\n**Total Points:** ${totalPoints}  |  **Task Points:** ${totalTaskPoints}  |  **Invite Points:** ${totalInvitePoints}`;
  return md;
}

async function walletStatistics(logger) {
  const wallets = global.selectedWallets || [];
  const stats = await fetchWalletStatistics(wallets, logger);
  if (stats) printStatisticsTable(stats, logger);
  // Ask user if they want to send the table to Telegram
  if (isTelegramLogsEnabled()) {
    const sendToTelegram = await requestInput('Send this table to Telegram? (y/n)', 'text', 'n');
    if (sendToTelegram.toLowerCase().startsWith('y')) {
      const mdTable = formatStatisticsMarkdownTable(stats);
      await sendTelegramMessage(mdTable);
      logger('System | Wallet statistics table sent to Telegram.');
    }
  }
}

// --- Send Menu Task Telegram Report ---
async function sendMenuTaskTelegramReport({
  logger,
  selected,
  completedTasks = [],
  failedTasks = [],
  totalTasks = 0,
  walletIdx = 1,
  totalWallets = 1
}) {
  if (!isTelegramLogsEnabled()) return;
  const botName = 'Pharos Bot';
  const config = getConfig();
  const settings = {
    THREADS: config.SETTINGS?.THREADS,
    ATTEMPTS: config.SETTINGS?.ATTEMPTS,
    PAUSE_BETWEEN_ATTEMPTS: config.SETTINGS?.PAUSE_BETWEEN_ATTEMPTS,
    PAUSE_BETWEEN_SWAPS: config.SETTINGS?.PAUSE_BETWEEN_SWAPS,
    RANDOM_PAUSE: config.SETTINGS?.RANDOM_PAUSE,
    RANDOM_PAUSE_BETWEEN_ACCOUNTS: config.SETTINGS?.RANDOM_PAUSE_BETWEEN_ACCOUNTS,
    RANDOM_PAUSE_BETWEEN_ACTIONS: config.SETTINGS?.RANDOM_PAUSE_BETWEEN_ACTIONS,
    skipFailed: false
  };
  let walletName = 'Wallet';
  let walletAddress = '';
  if (global.selectedWallets && global.selectedWallets.length > 0) {
    const w = global.selectedWallets[0];
    walletName = w.name || 'Wallet';
    const { getAddressFromPrivateKey } = require('./src/utils/telegramLogger');
    walletAddress = getAddressFromPrivateKey(w.privatekey);
  }
  // Format completed/failed tasks as numbered list
  const formatList = arr => arr.length ? arr.map((t,i)=>`${i+1}. ${t}`).join('\n') : 'None';
  const completed = formatList(completedTasks);
  const failed = formatList(failedTasks);
  // Calculate stats
  const completedCount = completedTasks.length;
  const failedCount = failedTasks.length;
  const successRate = totalTasks > 0 ? ((completedCount/totalTasks)*100).toFixed(1) : '0.0';
  // Compose message
  const message = `🐰 Pharos Bot Report\n`+
    `🕒 Run Time: -\n`+
    `🗓 Date: ${new Date().toLocaleString()}\n`+
    `💳 Wallet ${walletIdx}/${totalWallets}: ${walletName} | ${walletAddress}\n`+
    `✅ Completed Tasks:\n${completed}\n\n`+
    `📊 Statistics:\nTotal Tasks: ${totalTasks}\nCompleted: ${completedCount}\nFailed: ${failedCount}\nSuccess Rate: ${successRate}%\n\n`+
    `⚙️ Settings:\nThreads: ${settings.THREADS}\nAttempts: ${settings.ATTEMPTS}\nSkip Failed: No`;
  await sendTelegramMessage(message);
  logger('System | Telegram report sent.');
}

// ---- MAIN ----
async function main() {
  // Logger
  const logger = (message) => console.log(formatLogMessage(message));

  // Initialize
  displayBanner();
  loadWallets();
  logger(`System | Pharos Bot started. Wallets loaded: ${global.selectedWallets.length}`);

  // Load config value for maxTransaction
  const config = getConfig();
  const flow = config.FLOW || {};
  const numSwapsRange = flow.NUMBER_OF_SWAPS || [5, 5];
  const minSwaps = numSwapsRange[0];
  const maxSwaps = numSwapsRange[1];
  // Pick a random value in range for this session
  global.maxTransaction = Math.floor(Math.random() * (maxSwaps - minSwaps + 1)) + minSwaps;
  logger(`System | Using config for transaction count: ${global.maxTransaction}`);

  // Main loop
  while (true) {
    displayBanner();
    displayMenu();
    const choice = await requestInput("Select an option (1-14)", "number");
    const idx = choice - 1;

    if (isNaN(idx) || idx < 0 || idx >= menuOptions.length) {
      logger("System | Invalid option. Try again.");
      await new Promise((resolve) => setTimeout(resolve, 1000));
      continue;
    }

    const selected = menuOptions[idx];
    if (selected.value === "exit") {
      logger("System | Exiting...");
      await new Promise((resolve) => setTimeout(resolve, 500));
      rl.close();
      process.exit(0);
    }

    if (selected.value === "setTransactionCount") {
      // Allow user to override config if desired
      const newTxCount = await requestInput("Enter number of transactions", "number", global.maxTransaction.toString());
      if (isNaN(newTxCount) || newTxCount <= 0) {
        logger("System | Invalid transaction count. Keeping current: " + global.maxTransaction);
      } else {
        global.maxTransaction = newTxCount;
        logger(`System | Set transaction count to: ${newTxCount}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
      continue;
    }

    // --- Wallet Statistics Option ---
    if (selected.value === "walletStatistics") {
      logger("System                    | Starting Wallet Statistics...");
      await walletStatistics(logger);
      logger("System                    | Wallet Statistics completed.");
      await requestInput("Press Enter to continue...");
      continue;
    }

    let completedTasks = [];
    let failedTasks = [];
    let totalTasks = 1;
    let taskLogs = [];
    // Wrap logger to capture all logs
    const wrappedLogger = (msg) => {
      taskLogs.push(msg);
      logger(msg);
    };
    try {
      let spinner;
      spinner = createSpinner(`Running ${selected.label}...`);
      wrappedLogger(`System | Starting ${selected.label}...`);
      // Use the raw service function for single menu actions to avoid double Telegram reports
      const scriptFunc = service[selected.value]?.__rawFunc || service[selected.value];
      if (scriptFunc) {
        await scriptFunc(wrappedLogger);
        wrappedLogger(`System | ${selected.label} completed.`);
      } else {
        wrappedLogger(`System | Error: ${selected.label} not implemented.`);
        failedTasks.push(selected.value);
      }
      if (spinner) spinner.stop();
    } catch (e) {
      wrappedLogger(`System | Error in ${selected.label}: ${chalk.red(e.message)}`);
      if (spinner) spinner.stop();
      failedTasks.push(selected.value);
    }
    // After all logs, scan for success
    let taskCompleted = false;
    for (const msg of taskLogs) {
      if (typeof msg === 'string') {
        if (selected.value === 'accountLogin' && msg.includes('Account Login completed.')) taskCompleted = true;
        else if (selected.value === 'accountCheckIn' && msg.includes('Account Check-in completed.')) taskCompleted = true;
        else if (selected.value === 'accountCheck' && (msg.includes('Checking Profile Stats for') || /ID:\s*\d+, TotalPoints:/i.test(msg))) taskCompleted = true;
        else if (selected.value === 'accountClaimFaucet' && (msg.includes('Claim Faucet PHRS completed.') || msg.includes('Faucet not available.'))) taskCompleted = true;
        else if (/confirmed|success|completed|claimed|sent/i.test(msg)) taskCompleted = true;
      }
    }
    if (taskCompleted && failedTasks.length === 0) completedTasks.push(selected.value);
    if (completedTasks.length === 0 && failedTasks.length === 0) failedTasks.push(selected.value);
    // Always send Telegram report for menu actions (except exit/setTransactionCount)
    await sendMenuTaskTelegramReport({
      logger,
      selected,
      completedTasks,
      failedTasks,
      totalTasks,
      walletIdx: 1,
      totalWallets: 1
    });
    await requestInput("Press Enter to continue...");
  }
}

// List of automatable tasks (must match service keys)
const automatableTasks = [
  'accountLogin',
  'accountCheckIn',
  'accountCheck',
  'accountClaimFaucet',
  'claimFaucetUSDC',
  'performSwapUSDC',
  'performSwapUSDT',
  'addLpUSDC',
  'addLpUSDT',
  'randomTransfer',
  'socialTask',
];

async function automateAllTasks(logger) {
  global.suppressTelegramLogs = true; // Suppress per-task Telegram logs
  const botName = 'MegaETH StarLabs Bot';
  const config = getConfig();
  const settings = {
    THREADS: config.SETTINGS.THREADS,
    ATTEMPTS: config.SETTINGS.ATTEMPTS,
    PAUSE_BETWEEN_ATTEMPTS: config.SETTINGS.PAUSE_BETWEEN_ATTEMPTS,
    PAUSE_BETWEEN_SWAPS: config.SETTINGS.PAUSE_BETWEEN_SWAPS,
    RANDOM_PAUSE: config.SETTINGS.RANDOM_PAUSE,
    RANDOM_PAUSE_BETWEEN_ACCOUNTS: config.SETTINGS.RANDOM_PAUSE_BETWEEN_ACCOUNTS,
    RANDOM_PAUSE_BETWEEN_ACTIONS: config.SETTINGS.RANDOM_PAUSE_BETWEEN_ACTIONS,
    skipFailed: false
  };
  // Shuffle wallets for human-like behavior
  const wallets = [...global.selectedWallets];
  for (let i = wallets.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [wallets[i], wallets[j]] = [wallets[j], wallets[i]];
  }
  let walletIdx = 0;
  for (const wallet of wallets) {
    walletIdx++;
    const pk = wallet.privatekey;
    const { getAddressFromPrivateKey, sendTelegramSummary } = require('./src/utils/telegramLogger');
    const address = getAddressFromPrivateKey(pk);
    let { tasks, status } = dbManager.getWalletTasks(address); // FIX: use address
    if (!tasks || !tasks.length) {
      logger(`System | Wallet ${address.slice(0,6)}... has no tasks in DB. Use Database Manager to assign tasks.`);
      continue;
    }
    if (status === 'completed') {
      logger(`System | Wallet ${address.slice(0,6)}... already completed. Skipping.`);
      continue;
    }
    // Shuffle pending tasks for this wallet
    let pendingTasks = tasks.filter(t => t.status === 'pending');
    for (let i = pendingTasks.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pendingTasks[i], pendingTasks[j]] = [pendingTasks[j], pendingTasks[i]];
    }
    let completedTasks = [];
    let failedTasks = [];
    for (const task of pendingTasks) {
      logger(`System | Wallet ${address.slice(0,6)}... | Running task: ${task.name}`);
      try {
        // Wrap with telegramTaskWrapper for automation mode only
        const taskFunc = telegramTasks.includes(task.name)
          ? telegramTaskWrapper(task.name, service[task.name])
          : service[task.name];
        if (taskFunc) {
          await taskFunc(logger);
          dbManager.updateTaskStatus(address, task.name, 'completed');
          logger(`System | Wallet ${address.slice(0,6)}... | Task ${task.name} completed.`);
          completedTasks.push(task.name);
        } else {
          logger(`System | Wallet ${address.slice(0,6)}... | Task ${task.name} not implemented.`);
          failedTasks.push(task.name);
        }
      } catch (e) {
        logger(`System | Wallet ${address.slice(0,6)}... | Task ${task.name} failed: ${e.message}`);
        failedTasks.push(task.name);
      }
    }
    logger(`System | Wallet ${address.slice(0,6)}... | All pending tasks processed.`);
    await sendTelegramSummary({
      botName,
      walletName: wallet.name || address.slice(0,6),
      walletAddress: address,
      completedTasks,
      failedTasks,
      totalTasks: tasks.length,
      settings,
      walletNumber: walletIdx,
      totalWallets: wallets.length
    });
  }
  global.suppressTelegramLogs = false; // Re-enable per-task logs after automation
  logger(`System | Automation complete for all wallets.`);
}

// Database manager menu
async function databaseManagerMenu(logger) {
  let exit = false;
  while (!exit) {
    const { dbAction } = await inquirer.prompt([
      {
        type: 'list',
        name: 'dbAction',
        message: 'Database Management Options:',
        choices: [
          { name: '🗑  Create/Reset Database', value: 'reset' },
          { name: '📊 Show Database Contents', value: 'show' },
          { name: '➕ Add Wallets from wallet.json', value: 'add' },
          { name: '👋 Exit', value: 'exit' },
        ],
      },
    ]);
    if (dbAction === 'reset') {
      const { confirm } = await inquirer.prompt([
        { type: 'confirm', name: 'confirm', message: 'This will reset the DB for all wallets in wallet.json. Continue?', default: false }
      ]);
      if (confirm) {
        const wallets = loadWallets();
        const { tasks } = await inquirer.prompt([
          { type: 'checkbox', name: 'tasks', message: 'Select tasks to assign to all wallets:', choices: automatableTasks, validate: arr => arr.length > 0 || 'Select at least one task.' }
        ]);
        dbManager.resetDB(wallets, tasks);
        logger('System | Database reset and initialized.');
      }
    } else if (dbAction === 'show') {
      const all = dbManager.getAllWallets();
      if (!all.length) {
        logger('System | Database is empty.');
      } else {
        logger('System | Wallet DB:');
        all.forEach(w => {
          logger(`Wallet: ${w.address.slice(0,6)}... | Status: ${w.status} | Tasks: ${w.tasks.map(t=>`${t.name}(${t.status})`).join(', ')}`);
        });
      }
    } else if (dbAction === 'add') {
      const wallets = loadWallets();
      const { tasks } = await inquirer.prompt([
        { type: 'checkbox', name: 'tasks', message: 'Select tasks to assign to new wallets:', choices: automatableTasks, validate: arr => arr.length > 0 || 'Select at least one task.' }
      ]);
      for (const w of wallets) {
        if (!dbManager.getWalletTasks(w.privatekey).tasks.length) {
          dbManager.setWalletTasks(w.privatekey, tasks.map((name, idx) => ({ name, status: 'pending', index: idx + 1 })), 'pending');
        }
      }
      logger('System | Added new wallets to DB.');
    } else if (dbAction === 'exit') {
      exit = true;
    }
  }
}

// ---- Run ----
(async () => {
  try {
    await main();
  } catch (error) {
    console.error(chalk.red(`Fatal error: ${error.message}`));
    rl.close();
    process.exit(1);
  }
})();
