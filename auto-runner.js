const chalk = require("chalk").default || require("chalk");
const path = require("path");
const fs = require("fs");
const service = require("./service");

global.selectedWallets = [];
global.maxTransaction = 5; // مقدار ثابت

// بارگذاری والت‌ها
function loadWallets() {
  try {
    const walletPath = path.join(__dirname, "wallet.json");
    const data = fs.readFileSync(walletPath, "utf8");
    const json = JSON.parse(data);
    global.selectedWallets = json.wallets || [];
    return global.selectedWallets;
  } catch (e) {
    console.error("❌ Wallets not loaded:", e.message);
    return [];
  }
}

// لاگر رنگی
function log(msg) {
  const timestamp = new Date().toLocaleTimeString("en-US", { hour12: false });
  console.log(chalk.hex("#90EE90")(`[${timestamp}] ${msg}`));
}

// اجرای مستقیم autoAll
(async () => {
  log("Starting Auto Runner...");
  loadWallets();
  log(`Wallets Loaded: ${global.selectedWallets.length}`);
  try {
    await service.autoAll(log);
    log("autoAll completed successfully ✅");
  } catch (err) {
    log("❌ autoAll failed: " + err.message);
  }
})();
