# Xi Coin v4

Telegram Mini App with server balance, transfers, referrals, Telegram Stars donations and rewarded ads.

## Monetization

- Rewarded AdsGram ad: +1 XI per completed rewarded ad.
- Daily ad limit: 20 rewards per user.
- Donations use Telegram Stars (XTR), as required for digital goods sold inside Telegram.
- 150 ⭐: +0.010 XI permanent click power.
- 80 ⭐: +5000 maximum energy.
- 300 ⭐: VIP x2 permanent click income.

## Required backend variables

- `BOT_TOKEN` — token of the Telegram bot that owns the Mini App.
- `PORT` — optional server port.

The backend creates Telegram Stars invoice links and receives successful-payment updates at `/telegram/webhook`.

After deploying the backend, configure the Telegram bot webhook to:

`https://YOUR_BACKEND_DOMAIN/telegram/webhook`

## Required frontend settings

Open `xi-coin-v4/index.html` and replace:

- `YOUR_BACKEND_URL` with the deployed backend URL.
- `YOUR_ADSGRAM_BLOCK_ID` with the Rewarded AdsGram blockId.
- `YOUR_BOT_USERNAME` with the Telegram bot username.

AdsGram's rewarded format grants the reward only after the user watches the ad to the end. The game then calls `/api/ad-reward` and the server applies its daily limit.

## Important

GitHub Pages can host the Mini App frontend, but it cannot run the Node.js database backend. The backend must be deployed on a Node.js host. The GitHub repository contains both parts.
