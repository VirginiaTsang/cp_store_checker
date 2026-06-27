import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_TARGET_URL = "https://official-goods-store.jp/colorfulpalette/product/list";
const BASE_URL = "https://official-goods-store.jp";

const config = {
  targetUrl: process.env.TARGET_URL || DEFAULT_TARGET_URL,
  sourceFile: process.env.SOURCE_FILE || "",
  webhookUrl: process.env.DISCORD_WEBHOOK_URL,
  stateFile: process.env.STATE_FILE || "data/state.json",
  itemLimit: Number.parseInt(process.env.ITEM_LIMIT || "20", 10),
  dryRun: process.env.DRY_RUN === "true",
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  if (!Number.isInteger(config.itemLimit) || config.itemLimit < 1) {
    throw new Error("ITEM_LIMIT must be a positive integer.");
  }

  const previousState = await readState(config.stateFile);
  const currentItems = await fetchCurrentItems(config.targetUrl, config.itemLimit);

  if (currentItems.length === 0) {
    throw new Error("No products were found. The page structure may have changed.");
  }

  const previousHrefs = new Set((previousState.items || []).map((item) => item.href));
  const newItems = previousState.items ? currentItems.filter((item) => !previousHrefs.has(item.href)) : [];

  if (!previousState.items) {
    console.log(`Seeded initial state with ${currentItems.length} items. No Discord message sent.`);
  } else if (newItems.length === 0) {
    console.log(`No new items found among the first ${currentItems.length} products.`);
  } else {
    await notifyDiscord(newItems, currentItems.length);
  }

  await writeState(config.stateFile, {
    checkedAt: new Date().toISOString(),
    targetUrl: config.targetUrl,
    itemLimit: config.itemLimit,
    items: currentItems,
  });
}

async function fetchCurrentItems(url, limit) {
  if (config.sourceFile) {
    const html = await fs.readFile(config.sourceFile, "utf8");
    return parseProductItems(html).slice(0, limit);
  }

  const response = await fetch(url, {
    headers: {
      "user-agent": "web-state-checker/1.0 (+daily Discord notification)",
      accept: "text/html,application/xhtml+xml",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  return parseProductItems(html, url).slice(0, limit);
}

function parseProductItems(html, pageUrl) {
  const itemMatches = [...html.matchAll(/<li\b[^>]*class=["'][^"']*\bogs-v2-top-list-item\b[^"']*["'][^>]*>\s*(<a\b[\s\S]*?<\/a>)\s*<\/li>/gi)];

  return itemMatches.map((match) => parseProductItem(match[1], pageUrl)).filter(Boolean);
}

function parseProductItem(itemHtml, pageUrl) {
  const href = readAttribute(itemHtml.match(/<a\b[^>]*href=["'][^"']+["'][^>]*>/i)?.[0] || "", "href");
  if (!href) return null;

  const titleMatch = itemHtml.match(/<p\b[^>]*class=["'][^"']*\bogs-v2-top-list-text-title\b[^"']*["'][^>]*>([\s\S]*?)<\/p>/i);
  const priceMatch = itemHtml.match(/<p\b[^>]*class=["'][^"']*\bogs-v2-top-list-price\b[^"']*["'][^>]*>([\s\S]*?)<\/p>/i);

  return {
    href: absoluteUrl(href, BASE_URL),
    title: cleanText(titleMatch?.[1] || "Untitled item"),
    price: cleanText(priceMatch?.[1] || ""),
    image: findProductImage(itemHtml),
  };
}

function findProductImage(itemHtml) {
  const activeSlideMatch = itemHtml.match(/<li\b[^>]*class=["'][^"']*\bflex-active-slide\b[^"']*["'][^>]*>[\s\S]*?<img\b[^>]*>/i);
  const activeImage = activeSlideMatch ? readAttribute(activeSlideMatch[0], "src") : "";
  if (activeImage) return activeImage;

  const thumbnailMatch = itemHtml.match(/<div\b[^>]*class=["'][^"']*\bogs-v2-top-list-thumbnail\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
  const imgTag = thumbnailMatch?.[1]?.match(/<img\b[^>]*>/i)?.[0] || "";
  return readAttribute(imgTag, "src");
}

function readAttribute(tag, attribute) {
  const match = tag.match(new RegExp(`${attribute}=["']([^"']+)["']`, "i"));
  return match?.[1] || "";
}

function cleanText(value) {
  return decodeHtml(value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function decodeHtml(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#039;", "'")
    .replaceAll("&yen;", "¥");
}

function absoluteUrl(href, baseUrl) {
  return new URL(href, baseUrl).toString();
}

async function notifyDiscord(newItems, scannedCount) {
  const content = `Found ${newItems.length} new item${newItems.length === 1 ? "" : "s"} in the first ${scannedCount} products.`;

  if (config.dryRun) {
    console.log(content);
    console.log(JSON.stringify(newItems, null, 2));
    return;
  }

  if (!config.webhookUrl) {
    throw new Error("DISCORD_WEBHOOK_URL is required unless DRY_RUN=true.");
  }

  const chunks = chunk(newItems, 10);
  for (let index = 0; index < chunks.length; index += 1) {
    const payload = {
      content: index === 0 ? content : undefined,
      embeds: chunks[index].map((item) => ({
        title: item.title,
        url: item.href,
        description: item.price || undefined,
        image: item.image ? { url: item.image } : undefined,
      })),
    };

    const response = await fetch(config.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Discord webhook failed: ${response.status} ${response.statusText} ${body}`);
    }
  }
}

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function readState(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

async function writeState(file, state) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(state, null, 2)}\n`);
}
