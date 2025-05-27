// src/utils/dbManager.js
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '../../wallet_tasks_db.json');
const WALLET_PATH = path.join(__dirname, '../../wallet.json');

// Example: { "0xA5adE736": { ... } }
function loadDB() {
  if (!fs.existsSync(DB_PATH)) return {};
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    // Migrate old format (private key as key) to address as key
    let db = JSON.parse(raw);
    let migrated = false;
    for (const k of Object.keys(db)) {
      if (!k.startsWith('0x') && k.length === 64) {
        // Looks like a private key, convert to address
        try {
          const addr = new ethers.Wallet(k).address;
          if (!db[addr]) {
            db[addr] = db[k];
            migrated = true;
          }
          delete db[k];
        } catch {}
      }
    }
    if (migrated) saveDB(db);
    return db;
  } catch {
    return {};
  }
}

function saveDB(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
}

function getWalletTasks(address) {
  const db = loadDB();
  // Try both address and privatekey for backward compatibility
  return db[address] || db[Object.keys(db).find(k => k.toLowerCase().endsWith(address.toLowerCase().slice(-40)))] || { tasks: [], status: 'pending' };
}

function setWalletTasks(address, tasks, status = 'pending') {
  const db = loadDB();
  db[address] = { tasks, status };
  saveDB(db);
}

function updateTaskStatus(address, taskName, newStatus) {
  const db = loadDB();
  if (!db[address]) return;
  const task = db[address].tasks.find(t => t.name === taskName);
  if (task) task.status = newStatus;
  if (db[address].tasks.every(t => t.status === 'completed')) {
    db[address].status = 'completed';
  }
  saveDB(db);
}

function getAddressFromPrivateKey(privatekey) {
  try {
    return new ethers.Wallet(privatekey).address;
  } catch {
    return null;
  }
}

function resetDB(wallets, tasksList) {
  const db = {};
  wallets.forEach((w, idx) => {
    const address = getAddressFromPrivateKey(w.privatekey);
    if (address) {
      db[address] = {
        name: w.name,
        token: w.token,
        tasks: tasksList.map((name, tIdx) => ({ name, status: 'pending', index: tIdx + 1 })),
        status: 'pending',
        walletNumber: idx + 1
      };
    }
  });
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function getWalletInfo(address) {
  // Find wallet info from wallet.json by address
  const wallets = JSON.parse(fs.readFileSync(WALLET_PATH, 'utf8')).wallets || [];
  return wallets.find(w => getAddressFromPrivateKey(w.privatekey) === address);
}

function getAllWallets() {
  const db = loadDB();
  return Object.keys(db).map(address => ({ address, ...db[address] }));
}

module.exports = {
  loadDB,
  saveDB,
  getWalletTasks,
  setWalletTasks,
  updateTaskStatus,
  resetDB,
  getWalletInfo,
  getAllWallets,
};
