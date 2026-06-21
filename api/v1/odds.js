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
      const h2h = (bm.markets || []).find((m) => m.key === "h2h");
      const prices = {};
      (h2h?.outcomes || []).forEach((o) => {
        prices[outcomeKeyFor(o.name)] = americanFromDecimal(o.price);
      });
      return { name: BOOKMAKER_NAME_MAP[bm.key], prices };
    })
    .filter((b) => Object.keys(b.prices).length > 0);

  return {
    id: event.id,
    sport: labels.sport,
    league: labels.league,
    time: new Date(event.commence_time).toLocaleString("en-US", {
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }),
    commenceTime: event.commence_time, // raw ISO timestamp — for date filtering client-side
    home,
    away,
    outcomes,
    books,
  };
}

async function fetchFromProvider(sportKey, apiKey) {
  const url = `${PROVIDER_BASE}/sports/${sportKey}/odds?apiKey=${apiKey}&regions=us,eu&markets=h2h&oddsFormat=american`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Provider error ${res.status}: ${body.slice(0, 200)}`);
  }
  // The Odds API returns remaining-credit info in response headers — useful
  // to log during development so you notice before you run out.
  const remaining = res.headers.get("x-requests-remaining");
  const used = res.headers.get("x-requests-used");
  if (remaining) console.log(`[odds-api] credits remaining=${remaining} used=${used}`);
  return res.json();
}

export default async function handler(req, res) {
  // CORS — relax this to your actual frontend origin once deployed.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "ODDS_API_KEY is not configured on the server." });
  }

  // Defaults to a few in-season sports if none specified. Pass ?sport=X to
  // request just one (cheaper — each sport+region+market combo costs credits).
  const requestedSport = req.query.sport;
  const sportKeys = requestedSport ? [requestedSport] : Object.keys(SPORT_LABELS);

  try {
    const results = await Promise.all(
      sportKeys.map(async (sportKey) => {
        const cacheKey = `odds:${sportKey}`;
        const cached = cache.get(cacheKey);
        if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
          return cached.data;
        }
        const raw = await fetchFromProvider(sportKey, apiKey);
        const normalized = raw.map((event) => normalizeEvent(event, sportKey));
        cache.set(cacheKey, { ts: Date.now(), data: normalized });
        return normalized;
      })
    );

    const games = results.flat();
    return res.status(200).json({ games, fetchedAt: new Date().toISOString() });
  } catch (err) {
    console.error("[/api/v1/odds] error:", err.message);
    return res.status(502).json({ error: "Failed to fetch odds from provider.", detail: err.message });
  }
}

