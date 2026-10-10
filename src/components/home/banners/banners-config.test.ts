import { test } from "node:test";
import assert from "node:assert/strict";
import { getHomeBanners } from "./banners-config";
import { botStartUrl, publicBotUsername } from "@/lib/telegram/public";

const x = (telegramBot?: string | null) => getHomeBanners({ referrals: false, founderNft: false, telegramBot }).find((b) => b.id === "x-community")!;

test("the X banner gets a second button to the Telegram bot (?start=web, new tab) only when the bot's username is known", () => {
  assert.deepEqual(x("PandaBot").cta2, { labelKey: "banner.xCommunity.telegram", href: "https://t.me/PandaBot?start=web", external: true, icon: "telegram" });
  assert.equal(x(null).cta2, null);
  assert.equal(x(undefined).cta2, null);
  // Nothing else about the banner changes either way.
  assert.equal(x("PandaBot").cta?.labelKey, "banner.xCommunity.cta");
  assert.deepEqual({ ...x("PandaBot"), cta2: null }, x(null));
  assert.ok(getHomeBanners({ referrals: true, founderNft: false, telegramBot: "PandaBot" }).filter((b) => b.id !== "x-community").every((b) => !b.cta2));
});

test("the website only learns the bot's username while the bot is on and the name is a valid one", () => {
  assert.equal(publicBotUsername({ FEATURE_TELEGRAM_BOT: "true", TELEGRAM_BOT_USERNAME: "@PandaBot" }), "PandaBot");
  assert.equal(publicBotUsername({ TELEGRAM_BOT_USERNAME: "PandaBot" }), null, "bot off");
  assert.equal(publicBotUsername({ FEATURE_TELEGRAM_BOT: "true" }), null);
  assert.equal(publicBotUsername({ FEATURE_TELEGRAM_BOT: "true", TELEGRAM_BOT_USERNAME: "bad name/../x" }), null);
  assert.equal(botStartUrl("PandaBot"), "https://t.me/PandaBot?start=web");
});
