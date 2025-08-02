# ⚡ ParSaw's Pharos Auto Bot + Auto Run (Every 24–27h)

[![Version](https://img.shields.io/badge/version-v2.0.0-blue)](https://github.com/0xParSaw/Pharos-Bot-Auto-Run)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

🌀 **This project is a customized fork of [Kazuha787/Pharos-Auto-Bot](https://github.com/Kazuha787/Pharos-Auto-Bot)** — extended and enhanced by [ParSaw](https://github.com/0xParSaw) for full automation and long-term unattended runs.

**ParSaw’s Pharos Bot** is a powerful and fully automated system built in **Node.js** for daily interaction with the [Pharos Testnet](https://testnet.pharosnetwork.xyz/experience?inviteCode=cprte13gYiUj0ZPH). It runs **all tasks automatically** every 24 to 27 hours — no click needed.

Made for **point farmers, testers, and automation nerds** who value precision, privacy, and efficiency.

---

## 🚀 Features

- **🔥 Fully Headless Auto Run**  
  Just launch it once — it handles everything forever.

- **🎯 Task #9 Mode (Do Everything)**  
  Executes all faucet, swap, LP, NFT, OpenFi, transfer, and deployment operations.

- **🔀 Proxy Support**  
  Plug in your `proxy.txt` for stealth and IP rotation.

- **🔁 24–27 Hour Smart Loop**  
  Random delay keeps behavior human-like and anti-bot safe.

- **🧩 Modular System**  
  Clear separation of services — easy to maintain or expand.

- **🧵 Multi-Account Friendly**  
  Add unlimited accounts in `wallet.json` and let it rotate.

---

## ✅ Tasks Automated

1. Login & Check-ins  
2. Faucet (PHRS, USDC)  
3. Swaps (PHRS → USDC / USDT)  
4. Liquidity Pooling (PHRS-USDC / PHRS-USDT)  
5. NFT Minting (Gotchipus)  
6. Token Transfers  
7. Social Tasks  
8. OpenFi Operations  
9. Pharos Deployment  
10. Full Auto Run  
11. Configurable Tx count  
12. Clean Exit

---

## 📁 File Structure

```bash
Pharos-Bot-Auto-Run/
├── auto-runner.js      # Smart timed runner (24–27h)
├── service.js          # Core logic for full task execution
├── actions/option9.js  # Master script for “Do Everything”
├── config.js           # Threading, delays, preferences
├── proxy.txt           # Optional proxies
├── wallet.json         # Multi-wallet storage
├── wallet.txt          # Main wallet address
├── address.txt         # Generated wallets
├── package.json        # Dependencies
└── README.md           # This doc
```
⚙️ Requirements
Node.js v16+

Git

Pharos Testnet account → pharos.network

Optional: Proxies (proxy.txt)

Terminal basics (or just copy-paste 👀)

🛠 Installation & Usage
1. Clone the Repo
```bash
git clone https://github.com/0xParSaw/Pharos-Bot-Auto-Run.git
cd Pharos-Bot-Auto-Run
```
2. Install Dependencies
```bash
npm install
```
3. Setup Your Wallets
```bash
nano wallet.json    # Add your accounts
nano wallet.txt     # Main wallet address
```
4. Launch Bot (Auto Run)
```bash
node auto-runner.js
```
You're done. It now runs forever, every ~24–27 hours 🌀

☕ Buy Me a Coffee
If this helped you automate hours of work, feel free to support future bots:

ETH / USDT or any EVM-compatible tip:

0xE9e2BF78C53028C4CeCCce85165d8739786BCb7a

Thanks for your support! 🙏
It motivates me to keep building more awesome tools.

🤝 Community & Support
Need help? Suggest a feature? Just wanna vibe?

Join our discussion group →
**[→ Telegram: @Offical_Im_kazuha](https://t.me/Offical_Im_kazuha)**

Or open an Issue / Pull Request

📜 License
Released under the MIT License.
Use, remix, fork — just keep the credits.

See the LICENSE file for full details.

