const fetch = require("node-fetch");
require("dotenv").config();

const STEAM_API_KEY = process.env.STEAM_API_KEY;

/**
 * Extract or resolve a Steam64 ID from a Steam Community URL.
 * Supports both /profiles/123... and /id/vanityname formats.
 */
async function extractSteam64Id(url) {
  const match = url.match(/steamcommunity\.com\/(profiles|id)\/([a-zA-Z0-9_-]+)/i);
  if (!match) return null;

  const type = match[1];
  const idOrVanity = match[2];

  if (type === "profiles") {
    return idOrVanity; // Already a Steam64 ID
  }

  if (type === "id") {
    try {
      const apiUrl = `https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/?key=${STEAM_API_KEY}&vanityurl=${idOrVanity}`;
      const response = await fetch(apiUrl);
      const data = await response.json();

      if (data.response.success === 1) {
        return data.response.steamid;
      } else {
        return null;
      }
    } catch (err) {
      console.error("Error resolving Steam vanity URL:", err);
      return null;
    }
  }

  return null;
}

module.exports = { extractSteam64Id };
