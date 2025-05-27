// src/utils/dbManager.js
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '../../wallet_tasks_db.json');

// Example: { "0xA5adE736": { ... } }
function loadDB() {
  if (!fs.existsSync(DB_PATH)) return {};
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    // Migrate old format (private key as key) to address as key
    let db = JSON.parse(raw);
    const { ethers } = require('ethers');
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

function resetDB(wallets, tasksList) {
  // wallets: array of {privatekey, ...}, tasksList: array of task names
  const db = {};
  let idx = 0;
  for (const w of wallets) {
    idx++;
    const { ethers } = require('ethers');
    let address = w.address || (w.privatekey ? new ethers.Wallet(w.privatekey).address : undefined);
    if (!address) continue;
    db[address] = {
      tasks: tasksList.map((name, tIdx) => ({ name, status: 'pending', index: tIdx + 1 })),
      status: 'pending',
      walletNumber: idx
    };
  }
  saveDB(db);
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
  getAllWallets,
};
