const { ethers } = require('ethers');
const axios = require('axios');
const getConfig = require('../../getConfig');
const { signMessage } = require('./wallet');
const { retry } = require('./helpers');
const fs = require('fs');
const path = require('path');

const RPC_URL = "https://testnet.dplabs-internal.com";

async function fetchWalletStatistics(wallets, logger) {
  if (!wallets.length) {
    logger("System | No wallets loaded.");
    return;
  }

  const headers = [
    "#", "Wallet Address", "Balance (PHRS)", "Total Txs", "Account ID", "TotalPoints", "TaskPoints", "InvitePoints"
  ];
  let tableData = [];
  let totalBalance = 0;
  let totalTxs = 0;
  let totalPoints = 0, totalTaskPoints = 0, totalInvitePoints = 0;
  let idx = 0;

  for (const w of wallets) {
    idx++;
    let address = w.address;
    let privatekey = w.privatekey;
    if (!address && privatekey) {
      try {
        address = new ethers.Wallet(privatekey).address;
      } catch {}
    }
    if (!address) continue;

    let balance = 0;
    let txCount = 0;
    try {
      const provider = new ethers.JsonRpcProvider(RPC_URL, { chainId: 688688, name: "pharos-testnet" });
      balance = parseFloat(ethers.formatEther(await provider.getBalance(address)));
      txCount = await provider.getTransactionCount(address);
    } catch {}
    totalBalance += balance;
    totalTxs += txCount;

    let accountId = "-", totalPts = "-", taskPts = "-", invitePts = "-";
    let jwt = w.token;
    let gotStats = false;
    let refreshedToken = false;
    if (jwt) {
      try {
        const resp = await axios.get(`https://api.pharosnetwork.xyz/user/profile?address=${address}`, {
          headers: {
            authorization: `Bearer ${jwt}`
          }
        });
        if (resp.data && resp.data.data && resp.data.data.user_info) {
          const info = resp.data.data.user_info;
          accountId = info.ID || "-";
          totalPts = info.TotalPoints || "-";
          taskPts = info.TaskPoints || "-";
          invitePts = info.InvitePoints || "-";
          if (!isNaN(Number(totalPts))) totalPoints += Number(totalPts);
          if (!isNaN(Number(taskPts))) totalTaskPoints += Number(taskPts);
          if (!isNaN(Number(invitePts))) totalInvitePoints += Number(invitePts);
          gotStats = true;
        }
      } catch (err) {
        if (err.response && err.response.status === 403 && privatekey) {
          // Try to login and get a new token
          try {
            const message = 'pharos';
            const wallet = new ethers.Wallet(privatekey);
            const signature = await signMessage(wallet, message);
            const inviteCode = 'kwN8Xxeb4sCbTvRA';
            const loginUrl = `https://api.pharosnetwork.xyz/user/login?address=${address}&signature=${signature}&invite_code=${inviteCode}`;
            const headers = {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
              'Origin': 'https://testnet.pharosnetwork.xyz',
              'Referer': 'https://testnet.pharosnetwork.xyz/',
              'Accept': 'application/json, text/plain, */*',
              'Authorization': 'Bearer null'
            };
            const loginResponse = await axios.post(loginUrl, null, { headers });
            if (loginResponse.data && loginResponse.data.data && loginResponse.data.data.jwt) {
              jwt = loginResponse.data.data.jwt;
              w.token = jwt;
              refreshedToken = true;
              // Try fetching stats again
              const profileUrl = `https://api.pharosnetwork.xyz/user/profile?address=${address}`;
              const profileResponse = await axios.get(profileUrl, {
                headers: {
                  'Authorization': `Bearer ${jwt}`,
                  'Origin': 'https://testnet.pharosnetwork.xyz',
                  'Referer': 'https://testnet.pharosnetwork.xyz/'
                }
              });
              if (profileResponse.data && profileResponse.data.data && profileResponse.data.data.user_info) {
                const info = profileResponse.data.data.user_info;
                accountId = info.ID || "-";
                totalPts = info.TotalPoints || "-";
                taskPts = info.TaskPoints || "-";
                invitePts = info.InvitePoints || "-";
                if (!isNaN(Number(totalPts))) totalPoints += Number(totalPts);
                if (!isNaN(Number(taskPts))) totalTaskPoints += Number(taskPts);
                if (!isNaN(Number(invitePts))) totalInvitePoints += Number(invitePts);
                gotStats = true;
              }
            }
          } catch (loginErr) {
            logger(`System | ${address} | Failed to login for stats: ${loginErr.message}`);
          }
        } else {
          logger(`System | ${address} | Failed to fetch account stats: ${err.message}`);
        }
      }
    } else if (privatekey) {
      // No token at all, try to login and get one
      try {
        const message = 'pharos';
        const wallet = new ethers.Wallet(privatekey);
        const signature = await signMessage(wallet, message);
        const inviteCode = 'kwN8Xxeb4sCbTvRA';
        const loginUrl = `https://api.pharosnetwork.xyz/user/login?address=${address}&signature=${signature}&invite_code=${inviteCode}`;
        const headers = {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
          'Origin': 'https://testnet.pharosnetwork.xyz',
          'Referer': 'https://testnet.pharosnetwork.xyz/',
          'Accept': 'application/json, text/plain, */*',
          'Authorization': 'Bearer null'
        };
        const loginResponse = await axios.post(loginUrl, null, { headers });
        if (loginResponse.data && loginResponse.data.data && loginResponse.data.data.jwt) {
          jwt = loginResponse.data.data.jwt;
          w.token = jwt;
          refreshedToken = true;
          // Try fetching stats again
          const profileUrl = `https://api.pharosnetwork.xyz/user/profile?address=${address}`;
          const profileResponse = await axios.get(profileUrl, {
            headers: {
              'Authorization': `Bearer ${jwt}`,
              'Origin': 'https://testnet.pharosnetwork.xyz',
              'Referer': 'https://testnet.pharosnetwork.xyz/'
            }
          });
          if (profileResponse.data && profileResponse.data.data && profileResponse.data.data.user_info) {
            const info = profileResponse.data.data.user_info;
            accountId = info.ID || "-";
            totalPts = info.TotalPoints || "-";
            taskPts = info.TaskPoints || "-";
            invitePts = info.InvitePoints || "-";
            if (!isNaN(Number(totalPts))) totalPoints += Number(totalPts);
            if (!isNaN(Number(taskPts))) totalTaskPoints += Number(taskPts);
            if (!isNaN(Number(invitePts))) totalInvitePoints += Number(invitePts);
            gotStats = true;
          }
        }
      } catch (loginErr) {
        logger(`System | ${address} | Failed to login for stats: ${loginErr.message}`);
      }
    }
    tableData.push([
      idx,
      address,
      balance.toFixed(4),
      txCount,
      accountId,
      totalPts,
      taskPts,
      invitePts
    ]);
    // Save refreshed token to wallet.json if needed
    if (refreshedToken) {
      try {
        const walletPath = path.join(__dirname, '../../wallet.json');
        const data = fs.readFileSync(walletPath, 'utf8');
        const json = JSON.parse(data);
        for (const walletObj of json.wallets) {
          if ((walletObj.privatekey && walletObj.privatekey.trim().toLowerCase() === privatekey.trim().toLowerCase()) ||
              (walletObj.address && walletObj.address.trim().toLowerCase() === address.trim().toLowerCase())) {
            walletObj.token = jwt;
          }
        }
        fs.writeFileSync(walletPath, JSON.stringify(json, null, 2), 'utf8');
      } catch (e) {
        logger(`System | ${address} | Failed to save refreshed token: ${e.message}`);
      }
    }
  }

  return { headers, tableData, totalBalance, totalTxs, walletsLength: wallets.length, totalPoints, totalTaskPoints, totalInvitePoints };
}

function printStatisticsTable({ headers, tableData, totalBalance, totalTxs, walletsLength, totalPoints, totalTaskPoints, totalInvitePoints }, logger, asHtml = false) {
  if (asHtml) {
    // Print as HTML table for copy-paste or export
    let html = '<table border="1" style="border-collapse:collapse;text-align:center;">\n';
    html += '  <tr>' + headers.map(h => `<th>${h}</th>`).join('') + '</tr>\n';
    for (const row of tableData) {
      html += '  <tr>' + row.map(cell => `<td>${cell}</td>`).join('') + '</tr>\n';
    }
    html += '</table>\n';
    html += `<div style="margin-top:8px;font-family:monospace;">Total wallets: <b>${walletsLength}</b> | Total balance: <b>${totalBalance.toFixed(4)} PHRS</b> | Total txs: <b>${totalTxs}</b><br/>Total Points: <b>${totalPoints}</b> | Task Points: <b>${totalTaskPoints}</b> | Invite Points: <b>${totalInvitePoints}</b></div>`;
    logger(html);
    return;
  }
  // Calculate column widths
  const colWidths = headers.map((h, i) => Math.max(h.length, ...tableData.map(row => (row[i] + '').length)));
  // Helper to pad cell (right-align numbers, left-align text)
  const pad = (str, len, isNum) => isNum ? (str + '').padStart(len, ' ') : (str + '').padEnd(len, ' ');
  // Which columns are numbers
  const numCols = [0, 2, 3, 4, 5, 6, 7];
  // Box drawing
  const drawLine = (left, fill, mid, right) =>
    left + colWidths.map(w => fill.repeat(w + 2)).join(mid) + right;
  const drawRow = (row) =>
    '│' + row.map((cell, i) => ' ' + pad(cell, colWidths[i], numCols.includes(i) && !isNaN(cell)) + ' ').join('│') + '│';

  // Top border
  logger(drawLine('┌', '─', '┬', '┐'));
  // Header
  logger(drawRow(headers));
  // Header-bottom border
  logger(drawLine('├', '─', '┼', '┤'));
  // Rows
  for (const row of tableData) logger(drawRow(row));
  // Bottom border
  logger(drawLine('└', '─', '┴', '┘'));
  // Summary
  logger(`Total wallets: ${walletsLength} | Total balance: ${totalBalance.toFixed(4)} PHRS | Total txs: ${totalTxs}`);
  logger(`Total Points: ${totalPoints} | Task Points: ${totalTaskPoints} | Invite Points: ${totalInvitePoints}`);

}

module.exports = {
  fetchWalletStatistics,
  printStatisticsTable
};