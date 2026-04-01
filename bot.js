const fs = require("fs");
const path = require("path");
const dns = require("dns");

const ENV_PATH = path.join(__dirname, ".env");
const TRACKS_PATH = path.join(__dirname, "data", "tracks.json");
const TRACKS_EXAMPLE_PATH = path.join(__dirname, "data", "tracks.example.json");
const MEDIA_DIR = path.join(__dirname, "media");

loadEnv();

dns.setDefaultResultOrder("ipv4first");

const BOT_TOKEN = process.env.BOT_TOKEN;
const REQUIRED_CHANNEL = (process.env.REQUIRED_CHANNEL || "").trim();
const CHANNEL_URL = process.env.CHANNEL_URL || buildChannelUrl(REQUIRED_CHANNEL);
const TELEGRAM_API_BASE = `https://api.telegram.org/bot${BOT_TOKEN}`;

if (!BOT_TOKEN || !REQUIRED_CHANNEL || !CHANNEL_URL) {
  console.error(
    "Missing BOT_TOKEN, REQUIRED_CHANNEL or CHANNEL_URL in .env. Copy .env.example to .env and fill in the values."
  );
  process.exit(1);
}

const translations = {
  ru: {
    chooseLanguage: "Выберите язык / Choose language",
    chooseLanguageFirst: "Сначала выберите язык.",
    languageChanged: "Язык переключен на русский.",
    startText:
      "Этот бот отправляет бит только после подписки на канал.\n\n1. Подпишитесь на канал.\n2. Нажмите \"Проверить подписку\".\n3. Отправьте нужный номер.",
    nonTextMessage: "Отправьте текстовый номер.",
    subscriptionPending: "Подписка пока не подтверждена.",
    subscriptionConfirmed: "Подписка подтверждена.",
    sendNumberPrompt: "Теперь отправьте номер, для которого нужно получить бит.",
    subscriptionConfirmedShort: "Подписка подтверждена. Теперь отправьте номер.",
    digitsOnly: "Номер должен содержать только цифры.",
    notFound: "Для номера {number} бит не найден.",
    fileMissing: "Файл для номера {number} не найден на диске: {file}",
    defaultCaption: "Файл для номера {number}",
    buyButton: "Купить",
    subscribeButton: "Подписаться на канал",
    checkButton: "Проверить подписку",
    publicChannelNotFound:
      "Я не могу найти канал для проверки подписки.\n\nПроверьте значение REQUIRED_CHANNEL в .env. Для публичного канала это обычно @username, а для приватного канала часто нужен ID вида -100...",
    cantCheckSubscription:
      "Я не могу проверить подписку автоматически.\n\nСкорее всего, бота нужно добавить в канал и выдать ему права администратора. После этого нажмите \"Проверить подписку\" ещё раз.",
    genericSubscriptionError:
      "Я не смог проверить подписку из-за настроек канала или бота.\n\nТехническая причина: {error}",
    subscriptionNotFound:
      "Подписка не найдена.\n\nПодпишитесь на канал, затем вернитесь в бота и нажмите \"Проверить подписку\".",
    subscriptionNotConfirmed:
      "Подписка пока не подтверждена.\n\nПодпишитесь на канал, затем вернитесь в бота и нажмите \"Проверить подписку\".",
    userReadyInGroup: "Пользователь подтвердил подписку и может отправить номер.",
    englishLabel: "English",
    russianLabel: "Русский"
  },
  en: {
    chooseLanguage: "Choose language / Выберите язык",
    chooseLanguageFirst: "Please choose a language first.",
    languageChanged: "Language switched to English.",
    startText:
      "This bot sends an mp3 only after channel subscription.\n\n1. Subscribe to the channel.\n2. Tap \"Check subscription\".\n3. Send the required number.",
    nonTextMessage: "Send a text number.",
    subscriptionPending: "Subscription is not confirmed yet.",
    subscriptionConfirmed: "Subscription confirmed.",
    sendNumberPrompt: "Now send the number for which you want to receive an mp3.",
    subscriptionConfirmedShort: "Subscription confirmed. Now send the number.",
    digitsOnly: "The number must contain digits only.",
    notFound: "No mp3 was found for number {number}.",
    fileMissing: "The file for number {number} was not found on disk: {file}",
    defaultCaption: "File for number {number}",
    buyButton: "Buy",
    subscribeButton: "Subscribe to channel",
    checkButton: "Check subscription",
    publicChannelNotFound:
      "I cannot find the channel for subscription check.\n\nCheck REQUIRED_CHANNEL in .env. For a public channel this is usually @username, and for a private channel it is often an ID like -100...",
    cantCheckSubscription:
      "I cannot verify the subscription automatically.\n\nMost likely the bot must be added to the channel and granted admin rights. Then tap \"Check subscription\" again.",
    genericSubscriptionError:
      "I could not verify the subscription because of the channel or bot settings.\n\nTechnical reason: {error}",
    subscriptionNotFound:
      "Subscription not found.\n\nSubscribe to the channel, then return to the bot and tap \"Check subscription\".",
    subscriptionNotConfirmed:
      "Subscription is not confirmed yet.\n\nSubscribe to the channel, then return to the bot and tap \"Check subscription\".",
    userReadyInGroup: "The user confirmed the subscription and can now send a number.",
    englishLabel: "English",
    russianLabel: "Русский"
  }
};

let offset = 0;
let tracks = loadTracks();
const userState = new Map();
const userLanguage = new Map();

async function main() {
  console.log("Bot is running...");
  console.log(`Checking subscriptions in: ${REQUIRED_CHANNEL}`);

  while (true) {
    try {
      const updates = await api("getUpdates", {
        offset,
        timeout: 30,
        allowed_updates: ["message", "callback_query"]
      });

      for (const update of updates) {
        offset = update.update_id + 1;
        await handleUpdate(update);
      }
    } catch (error) {
      console.error("Polling error:", formatError(error));
      await delay(3000);
    }
  }
}

async function handleUpdate(update) {
  if (update.callback_query) {
    await handleCallbackQuery(update.callback_query);
    return;
  }

  if (update.message) {
    await handleMessage(update.message);
  }
}

async function handleCallbackQuery(callbackQuery) {
  const { id, data, from, message } = callbackQuery;

  if (data === "set_lang_ru" || data === "set_lang_en") {
    const language = data.endsWith("_ru") ? "ru" : "en";
    userLanguage.set(from.id, language);

    const existingState = userState.get(from.id) || {};
    userState.set(from.id, { ...existingState, stage: "awaiting_subscription" });

    await answerCallbackQuery(id, t(language, "languageChanged"));
    await sendMessage(
      from.id,
      `${t(language, "languageChanged")}\n\n${t(language, "startText")}`,
      subscriptionKeyboard(language)
    );
    return;
  }

  const language = getLanguage(from.id);

  if (!language) {
    await answerCallbackQuery(id, translations.ru.chooseLanguageFirst);
    await sendMessage(from.id, translations.ru.chooseLanguage, languageKeyboard());
    return;
  }

  if (data === "check_subscription") {
    const subscriptionState = await getSubscriptionState(from.id);

    if (!subscriptionState.subscribed) {
      await answerCallbackQuery(id, t(language, "subscriptionPending"));
      await sendMessage(
        from.id,
        buildSubscriptionFailureText(language, subscriptionState),
        subscriptionKeyboard(language)
      );
      return;
    }

    userState.set(from.id, { ...(userState.get(from.id) || {}), stage: "awaiting_number" });
    await answerCallbackQuery(id, t(language, "subscriptionConfirmed"));
    await sendMessage(from.id, t(language, "sendNumberPrompt"));

    if (message && message.chat && message.chat.id !== from.id) {
      await sendMessage(message.chat.id, t(language, "userReadyInGroup"));
    }
  }
}

async function handleMessage(message) {
  const chatId = message.chat.id;
  const text = (message.text || "").trim();
  const language = getLanguage(chatId);

  if (text === "/start" || text === "/language") {
    userState.set(chatId, { ...(userState.get(chatId) || {}), stage: "choosing_language" });
    await sendMessage(chatId, translations.ru.chooseLanguage, languageKeyboard());
    return;
  }

  if (!language) {
    await sendMessage(chatId, translations.ru.chooseLanguage, languageKeyboard());
    return;
  }

  if (!text) {
    await sendMessage(chatId, t(language, "nonTextMessage"));
    return;
  }

  if (text === "/check") {
    const subscriptionState = await getSubscriptionState(chatId);

    if (subscriptionState.subscribed) {
      userState.set(chatId, { ...(userState.get(chatId) || {}), stage: "awaiting_number" });
      await sendMessage(chatId, t(language, "subscriptionConfirmedShort"));
      return;
    }

    await sendMessage(
      chatId,
      buildSubscriptionFailureText(language, subscriptionState),
      subscriptionKeyboard(language)
    );
    return;
  }

  const subscriptionState = await getSubscriptionState(chatId);

  if (!subscriptionState.subscribed) {
    userState.set(chatId, { ...(userState.get(chatId) || {}), stage: "awaiting_subscription" });
    await sendMessage(
      chatId,
      buildSubscriptionFailureText(language, subscriptionState),
      subscriptionKeyboard(language)
    );
    return;
  }

  const state = userState.get(chatId);
  if (!state || state.stage !== "awaiting_number") {
    userState.set(chatId, { ...(state || {}), stage: "awaiting_number" });
  }

  const normalizedNumber = normalizeNumber(text);

  if (!normalizedNumber) {
    await sendMessage(chatId, t(language, "digitsOnly"));
    return;
  }

  tracks = loadTracks();
  const track = tracks[normalizedNumber];

  if (!track) {
    await sendMessage(chatId, t(language, "notFound", { number: normalizedNumber }));
    return;
  }

  const caption = track.caption || t(language, "defaultCaption", { number: normalizedNumber });
  const replyMarkup = buildBuyKeyboard(language, track);
  const trackSource = resolveTrackSource(track);

  if (!trackSource) {
    await sendMessage(
      chatId,
      t(language, "fileMissing", { number: normalizedNumber, file: "track.url or track.file" })
    );
    return;
  }

  if (trackSource.type === "url") {
    await sendAudioFromUrl(chatId, trackSource.value, caption, replyMarkup);
    return;
  }

  if (!fs.existsSync(trackSource.value)) {
    await sendMessage(
      chatId,
      t(language, "fileMissing", { number: normalizedNumber, file: track.file })
    );
    return;
  }

  await sendAudio(chatId, trackSource.value, caption, replyMarkup);
}

function loadEnv() {
  if (!fs.existsSync(ENV_PATH)) {
    return;
  }

  const envContent = fs.readFileSync(ENV_PATH, "utf8");
  const lines = envContent.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function loadTracks() {
  if (fs.existsSync(TRACKS_PATH)) {
    return JSON.parse(fs.readFileSync(TRACKS_PATH, "utf8"));
  }

  if (fs.existsSync(TRACKS_EXAMPLE_PATH)) {
    return JSON.parse(fs.readFileSync(TRACKS_EXAMPLE_PATH, "utf8"));
  }

  return {};
}

function normalizeNumber(value) {
  const cleaned = value.replace(/\s+/g, "");
  return /^\d+$/.test(cleaned) ? cleaned : null;
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getLanguage(userId) {
  return userLanguage.get(userId) || null;
}

function t(language, key, params = {}) {
  const dictionary = translations[language] || translations.ru;
  let text = dictionary[key] || translations.ru[key] || key;

  for (const [paramKey, value] of Object.entries(params)) {
    text = text.replaceAll(`{${paramKey}}`, String(value));
  }

  return text;
}

function languageKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: translations.ru.russianLabel, callback_data: "set_lang_ru" },
        { text: translations.en.englishLabel, callback_data: "set_lang_en" }
      ]
    ]
  };
}

function subscriptionKeyboard(language) {
  return {
    inline_keyboard: [
      [
        {
          text: t(language, "subscribeButton"),
          url: CHANNEL_URL
        }
      ],
      [
        {
          text: t(language, "checkButton"),
          callback_data: "check_subscription"
        }
      ]
    ]
  };
}

function buildBuyKeyboard(language, track) {
  if (!track.buyUrl) {
    return null;
  }

  return {
    inline_keyboard: [
      [
        {
          text: track.buyText || t(language, "buyButton"),
          url: track.buyUrl
        }
      ]
    ]
  };
}

function resolveTrackSource(track) {
  if (typeof track.url === "string" && track.url.trim()) {
    return {
      type: "url",
      value: track.url.trim()
    };
  }

  if (typeof track.file === "string" && track.file.trim()) {
    return {
      type: "file",
      value: path.join(MEDIA_DIR, track.file.trim())
    };
  }

  return null;
}

function buildChannelUrl(channelValue) {
  if (!channelValue) {
    return "";
  }

  if (channelValue.startsWith("https://") || channelValue.startsWith("http://")) {
    return channelValue;
  }

  if (channelValue.startsWith("-100")) {
    return "";
  }

  if (channelValue.startsWith("@")) {
    return `https://t.me/${channelValue.slice(1)}`;
  }

  return `https://t.me/${channelValue}`;
}

async function getSubscriptionState(userId) {
  try {
    const member = await api("getChatMember", {
      chat_id: REQUIRED_CHANNEL,
      user_id: userId
    });

    return {
      subscribed: ["creator", "administrator", "member", "restricted"].includes(member.status),
      status: member.status,
      error: null
    };
  } catch (error) {
    console.error("Subscription check failed:", error.message);
    return {
      subscribed: false,
      status: null,
      error: error.message
    };
  }
}

function buildSubscriptionFailureText(language, subscriptionState) {
  if (subscriptionState.error) {
    if (subscriptionState.error.includes("chat not found")) {
      return t(language, "publicChannelNotFound");
    }

    if (
      subscriptionState.error.includes("bot is not a member of the channel chat") ||
      subscriptionState.error.includes("member list is inaccessible") ||
      subscriptionState.error.includes("administrator")
    ) {
      return t(language, "cantCheckSubscription");
    }

    return t(language, "genericSubscriptionError", { error: subscriptionState.error });
  }

  if (subscriptionState.status === "left" || subscriptionState.status === "kicked") {
    return t(language, "subscriptionNotFound");
  }

  return t(language, "subscriptionNotConfirmed");
}

async function sendMessage(chatId, text, replyMarkup) {
  const payload = {
    chat_id: chatId,
    text
  };

  if (replyMarkup) {
    payload.reply_markup = replyMarkup;
  }

  await api("sendMessage", payload);
}

async function answerCallbackQuery(callbackQueryId, text) {
  await api("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text
  });
}

async function sendAudio(chatId, audioPath, caption, replyMarkup) {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("caption", caption);

  if (replyMarkup) {
    form.append("reply_markup", JSON.stringify(replyMarkup));
  }

  const fileBuffer = fs.readFileSync(audioPath);
  const fileName = path.basename(audioPath);
  const blob = new Blob([fileBuffer]);
  form.append("audio", blob, fileName);

  const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendAudio`, {
    method: "POST",
    body: form
  }).catch((error) => {
    throw new Error(`sendAudio network error: ${formatError(error)}`);
  });

  const data = await response.json();

  if (!data.ok) {
    throw new Error(data.description || "Telegram API error while sending audio");
  }
}

async function sendAudioFromUrl(chatId, audioUrl, caption, replyMarkup) {
  const payload = {
    chat_id: chatId,
    audio: audioUrl,
    caption
  };

  if (replyMarkup) {
    payload.reply_markup = replyMarkup;
  }

  await api("sendAudio", payload);
}

async function api(method, payload) {
  const response = await fetch(`${TELEGRAM_API_BASE}/${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  }).catch((error) => {
    throw new Error(`${method} network error: ${formatError(error)}`);
  });

  const data = await response.json();

  if (!data.ok) {
    throw new Error(data.description || `Telegram API error in ${method}`);
  }

  return data.result;
}

main().catch((error) => {
  console.error("Fatal error:", formatError(error));
  process.exit(1);
});

function formatError(error) {
  if (!error) {
    return "Unknown error";
  }

  if (error.cause) {
    const causeCode = error.cause.code ? ` (${error.cause.code})` : "";
    const causeMessage = error.cause.message ? `: ${error.cause.message}` : "";
    return `${error.message}${causeCode}${causeMessage}`;
  }

  return error.message || String(error);
}
