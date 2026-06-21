// /api/v1/odds — backend abstraction layer.
//
// The frontend ONLY ever talks to this endpoint. The Odds API (or any future
// provider) is called from here, server-side, where the API key is safe.
// Swapping providers later means rewriting fetchFromProvider() + normalize()
// in this one file — no frontend changes required.

const PROVIDER_BASE = "https://api.the-odds-api.com/v4";

// The Odds API bookmaker key -> the display name LineEdge's UI expects.
// (See BOOKS_CONFIG in the frontend for the canonical list of names.)
const BOOKMAKER_NAME_MAP = {
  draftkings: "DraftKings",
  fanduel: "FanDuel",
  betmgm: "BetMGM",
  williamhill_us: "Caesars", // The Odds API's bookmaker key for Caesars
  espnbet: "ESPN BET",
  pinnacle: "Pinnacle",
};

const SPORT_LABELS = {
  baseball_mlb: { sport: "MLB", league: "MLB" },
  basketball_wnba: { sport: "WNBA", league: "WNBA" },
  icehockey_nhl: { sport: "NHL", league: "NHL" },
  soccer_usa_mls: { sport: "Soccer", league: "MLS" },
  soccer_epl: { sport: "Soccer", league: "Premier League" },
};

// Extremely small in-memory cache. Serverless functions are stateless between
// cold starts, so this mainly helps on warm invocations within a short
// window — it is NOT a substitute for a real cache (Redis/KV) in production,
// but it costs nothing and meaningfully cuts credit usage during dev/testing.
const cache = new Map();
const CACHE_TTL_MS = 60 * 1000; // 60s — matches typical free-tier odds delay anyway

function americanFromDecimal(decimalOdds) {
  if (decimalOdds == null) return null;
  return decimalOdds >= 2
    ? Math.round((decimalOdds - 1) * 100)
    : Math.round(-100 / (decimalOdds - 1));
}

// Normalize one event from The Odds API's /odds response into LineEdge's
// {id, sport, league, time, home, away, outcomes, books} shape.
function normalizeEvent(event, sportKey) {
  const labels = SPORT_LABELS[sportKey] || { sport: sportKey, league: sportKey };
  const home = event.home_team;
  const away = event.away_team;

  // Collect every distinct outcome name across all bookmakers' h2h market
  // (handles draws for soccer automatically).
  const outcomeNames = new Set();
  (event.bookmakers || []).forEach((bm) => {
    const h2h = (bm.markets || []).find((m) => m.key === "h2h");
    (h2h?.outcomes || []).forEach((o) => outcomeNames.add(o.name));
  });

  const outcomeKeyFor = (name) => {
    if (name === home) return "home";
    if (name === away) return "away";
    return "draw";
  };

  const outcomes = Array.from(outcomeNames).map((name) => ({
    key: outcomeKeyFor(name),
    label: name,
  }));

  const books = (event.bookmakers || [])
    .filter((bm) => BOOKMAKER_NAME_MAP[bm.key])
    .map((bm) => {
      const h2h = (bm
