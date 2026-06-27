# Web State Checker

Daily checker for the Colorful Palette official goods list. It compares the first 20 product hrefs from today's page with the saved previous snapshot, ignores removed items, and sends only new products to Discord.

## What It Sends

- Count of new items.
- One Discord embed per new item.
- Product title, product URL, price, and product image.

The image picker prefers an image inside `.flex-active-slide` when present. If the server-rendered HTML has not added that class yet, it falls back to the first thumbnail image for that product.

## Local Setup

1. Create a Discord webhook:
   - Discord channel settings
   - Integrations
   - Webhooks
   - New Webhook
   - Copy Webhook URL

2. Create a `.env` file from `.env.example`, then paste your webhook URL.

3. Run a dry test:

```sh
DRY_RUN=true node src/checker.js
```

To test against saved HTML instead of the live page:

```sh
SOURCE_FILE="/path/to/pasted-text.txt" DRY_RUN=true node src/checker.js
```

4. Run for real:

```sh
DISCORD_WEBHOOK_URL="https://discord.com/api/webhooks/..." node src/checker.js
```

On the first successful run, the script only creates `data/state.json`. It does not send a notification because there is no previous day to compare against yet.

## GitHub Actions Hosting

The included workflow runs every day at `03:00 UTC`, which is `11:00 HKT`.

To use it:

1. Put this folder in a GitHub repository.
2. In the repository, add a secret named `DISCORD_WEBHOOK_URL`.
3. Enable GitHub Actions.
4. Run the workflow manually once to seed `data/state.json`.

After each successful run, the workflow commits the latest snapshot back to the repository so tomorrow has something to compare against.

## Other Free Hosting Options

GitHub Actions is the easiest fit for this exact version because it can run the Node script on a schedule and store the snapshot in the repo. Cloudflare Workers Cron Triggers are also a good free option, but you would rewrite this as a Worker and store the snapshot in Workers KV or D1. Render-style cron services can work too, but free availability and persistent storage rules change often, so check their current pricing before relying on them.
