const { Collection, Client, GatewayIntentBits } = require("discord.js");
const dotenv = require("dotenv");
dotenv.config();
const fs = require("fs");
const path = require("path");
const yaml = require("yaml");
const { extractSteam64Id } = require("./utils/steamResolver"); // ✅ Import Steam resolver
const configFile = fs.readFileSync("./config.yml", "utf8");
const config = yaml.parse(configFile);
const { client, ticketsDB } = require("./init.js");
const {
  cleanBlacklist,
  logError,
  lastChannelMsgTimestamp,
  updateStatsChannels,
} = require("./utils/mainUtils.js");
const { autoCloseTicket } = require("./utils/ticketAutoClose.js");
const { autoDeleteTicket } = require("./utils/ticketAutoDelete.js");

client.startingTime = Date.now();

// 🧹 Schedule blacklist cleanup
const blacklistInterval = config.blacklistCleanup || 120;
setInterval(cleanBlacklist, blacklistInterval * 1000);

// 🕒 Auto-close tickets
async function autoCloseTickets() {
  const currentTime = Math.floor(Date.now() / 1000);
  const tickets = (await ticketsDB.all()) || [];
  const openTickets = tickets.filter(
    (ticket) => ticket.value.status === "Open"
  );
  const autoCloseTime = config?.autoCloseTickets?.time || 86400;

  for (const ticket of openTickets) {
    const channelID = ticket.id;
    const lastMsgTime = await lastChannelMsgTimestamp(channelID);
    if (!lastMsgTime) continue;

    const lastMsgTimeSeconds = Math.floor(lastMsgTime / 1000);
    const timeDifference = currentTime - lastMsgTimeSeconds;

    if (timeDifference > autoCloseTime) {
      await autoCloseTicket(channelID);
    }
  }
}

// 🧨 Auto-delete closed tickets
async function autoDeleteTickets() {
  const currentTime = Math.floor(Date.now() / 1000);
  const tickets = (await ticketsDB.all()) || [];
  const closedTickets = tickets.filter(
    (ticket) => ticket.value.status === "Closed"
  );
  const autoDeleteTime = config?.autoDeleteTickets?.time || 86400;

  for (const ticket of closedTickets) {
    const channelID = ticket.id;
    const { closedAt } = ticket.value;

    if (!closedAt) continue;

    const closedAtSeconds = Math.floor(closedAt / 1000);
    const timeDifference = currentTime - closedAtSeconds;

    if (timeDifference > autoDeleteTime) {
      await autoDeleteTicket(channelID);
    }
  }
}

// 🕰️ Schedule auto tasks
if (config.autoCloseTickets.enabled) {
  const autoCloseInterval = config?.autoCloseTickets?.interval || 60;
  setInterval(autoCloseTickets, autoCloseInterval * 1000);
}

if (config.autoDeleteTickets.enabled) {
  const autoDeleteInterval = config?.autoDeleteTickets?.interval || 60;
  setInterval(autoDeleteTickets, autoDeleteInterval * 1000);
}

if (config.statsChannels.enabled) {
  const statsInterval = parseInt(config?.statsChannels?.interval, 10) || 600;
  const statsIntervalMs = Math.max(statsInterval * 1000, 600 * 1000);
  setInterval(updateStatsChannels, statsIntervalMs);
}

// 💾 Command setup
client.cooldowns = new Collection();
client.commands = new Collection();

const commandFolders = fs.readdirSync("./commands");
for (const folder of commandFolders) {
  const commandFiles = fs
    .readdirSync(`./commands/${folder}`)
    .filter((file) => file.endsWith(".js"));
  for (const file of commandFiles) {
    const command = require(`./commands/${folder}/${file}`);
    if (command.enabled) {
      if (!config.silentStartup) {
        console.log(`The slash command [${file}] has been loaded!`);
      }
      client.commands.set(command.data.name, command);
    }
  }
}

// ⚡ Load events
const eventsPath = path.join(__dirname, "events");
const eventFiles = fs
  .readdirSync(eventsPath)
  .filter((file) => file.endsWith(".js"));

for (const file of eventFiles) {
  const filePath = path.join(eventsPath, file);
  const event = require(filePath);
  if (event.once) {
    client.once(event.name, (...args) => event.execute(...args));
  } else {
    client.on(event.name, (...args) => event.execute(...args));
  }
}

// ⚠️ Error handlers
client.on("warn", async (error) => {
  console.log(error);
  await logError("WARN", error);
});

client.on("error", async (error) => {
  console.log(error);
  await logError("ERROR", error);
});

process.on("unhandledRejection", async (error) => {
  console.log(error);
  await logError("unhandledRejection", error);
});

process.on("uncaughtException", async (error) => {
  console.log(error);
  await logError("uncaughtException", error);
});

// 🎮 Steam URL Resolver — supports multiple links in one message
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  const regex = /https?:\/\/steamcommunity\.com\/(profiles\/\d+|id\/[a-zA-Z0-9_-]+)/g;
  const matches = [...message.content.matchAll(regex)];
  if (matches.length === 0) return;

  const replyLines = [];

  for (const match of matches) {
    const steamUrl = match[0];
    try {
      const steam64 = await extractSteam64Id(steamUrl);
      if (steam64) {
        replyLines.push(`${steam64}`);
      } else {
        replyLines.push(`❌ **${steamUrl}** → Could not extract a valid Steam64 ID.`);
      }
    } catch (error) {
      console.error(error);
      replyLines.push(`⚠️ **${steamUrl}** → An error occurred while processing that link.`);
    }
  }

  if (replyLines.length > 0) {
    await message.reply(replyLines.join("\n"));
  }
});

// ✅ Safe login
client.login(process.env.TOKEN).catch(async (error) => {
  console.log(error);

  if (error.message.includes("An invalid token was provided")) {
    await logError("INVALID_TOKEN", error);
  } else if (
    error.message.includes(
      "Privileged intent provided is not enabled or whitelisted."
    )
  ) {
    await logError("DISALLOWED_INTENTS", error);
  } else {
    await logError("ERROR", error);
  }

  process.exit();
});
