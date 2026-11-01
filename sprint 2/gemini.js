const gemini_key_storage = "tradestream.geminikey";
const gemini_apibase = "https://generativelanguage.googleapis.com/v1beta";

// Preferred models, best first. The app only hardcodes these as fallbacks —
// the real choice comes from asking the API which models the key can use.
const gemini_preferred = [
  "gemini-flash-latest",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash",
  "gemini-pro-latest",
];

// Cache the resolved model so we only list models once per session.
let gemini_resolved_model = null;

// Ask the API which models this key can use for generateContent, then pick the
// best available one. Falls back to the first preferred name on any failure.
async function resolveModel(apiKey) {
  if (gemini_resolved_model) {
    return gemini_resolved_model;
  }

  try {
    const res = await fetch(gemini_apibase + "/models?key=" + apiKey);
    if (!res.ok) {
      throw new Error("list models failed: " + res.status);
    }
    const body = await res.json();
    const usable = (body.models || [])
      .filter(
        (m) =>
          m.supportedGenerationMethods &&
          m.supportedGenerationMethods.includes("generateContent"),
      )
      .map((m) => m.name.replace(/^models\//, ""));

    // Prefer a known-good name; otherwise take the first usable flash model,
    // otherwise the first usable model at all.
    const pick =
      gemini_preferred.find((name) => usable.includes(name)) ||
      usable.find((name) => name.includes("flash")) ||
      usable[0];

    if (pick) {
      gemini_resolved_model = pick;
      return pick;
    }
  } catch (err) {
    // Swallow and fall through to the static fallback below.
  }

  gemini_resolved_model = gemini_preferred[0];
  return gemini_resolved_model;
}

function getstoredKey() {
  try {
    return localStorage.getItem(gemini_key_storage);
  } catch (err) {
    return null;
  }
}
function storeKey(key) {
  try {
    localStorage.setItem(gemini_key_storage, key);
    return true;
  } catch (err) {
    return false;
  }
}

function buildPromt(data) {
  return (
    "Act as a disciplined trading desk strategist for a simulated equity terminal. " +
    "Using ONLY the live market snapshot and portfolio state provided below, give actionable, concise trading guidance.\n\n" +
    "DATA:\n" +
    JSON.stringify(data, null, 2) +
    "\n\n" +
    "Respond in plain text (no markdown symbols) using these sections, each on its own line:\n" +
    "1. TOP CALL: One line naming a single symbol with a clear BUY, SELL, or HOLD and the trigger from the data.\n" +
    "2. WATCHLIST READ: 2-3 short bullets on momentum from the day's percent changes.\n" +
    "3. PORTFOLIO: One line on the current position (if any) and whether to add, trim, or hold given unrealized P/L and cash.\n" +
    "4. RISK: One line on the biggest risk visible in the snapshot.\n\n" +
    "Keep the whole answer under 150 words. Be direct and numeric. " +
    "This is a simulation, not real financial advice, so do not add disclaimers."
  );
}

// Collect a snapshot of the live market and the user's portfolio for the model.
function collectMarketSnapshot() {
  const snapshot = {
    asOf: new Date().toISOString(),
    cash: typeof cash !== "undefined" ? Math.round(cash * 100) / 100 : null,
    selectedSymbol:
      typeof selectedSymbol !== "undefined" ? selectedSymbol : null,
    market: [],
    positions: [],
  };

  if (typeof stocks !== "undefined") {
    stocks.forEach((stock) => {
      snapshot.market.push({
        symbol: stock.symbol,
        name: stock.name,
        price: stock.price,
        open: stock.open,
        dayChangePct: Math.round(todayChange(stock) * 100) / 100,
      });

      const h = typeof holdings !== "undefined" ? holdings[stock.symbol] : null;
      if (h && h.shares > 0) {
        const unrealized = (stock.price - h.avgCost) * h.shares;
        snapshot.positions.push({
          symbol: stock.symbol,
          shares: h.shares,
          avgCost: Math.round(h.avgCost * 100) / 100,
          marketValue: Math.round(stock.price * h.shares * 100) / 100,
          unrealizedPnL: Math.round(unrealized * 100) / 100,
        });
      }
    });
  }

  return snapshot;
}

// Update the small AI status pill (live / offline / thinking).
function setAiStatus(state, label) {
  const pill = document.getElementById("aiStatus");
  if (!pill) {
    return;
  }
  pill.dataset.state = state;
  pill.textContent = label;
}

// Render the model's advice text into the AI panel.
function renderAdvice(text) {
  const box = document.getElementById("aiOutput");
  if (!box) {
    return;
  }
  box.textContent = text;
  box.classList.remove("placeholder");
}

// Wire up the AI advisor panel: key saving + the "get suggestion" button.
function initAiAdvisor() {
  const keyInput = document.getElementById("aiKey");
  const askBtn = document.getElementById("aiAskBtn");
  const box = document.getElementById("aiOutput");

  if (!keyInput || !askBtn || !box) {
    return;
  }

  // Prefill the saved key, if any.
  const saved = getstoredKey();
  if (saved) {
    keyInput.value = saved;
    setAiStatus("on", "● key saved");
  } else {
    setAiStatus("off", "● no key");
  }

  keyInput.addEventListener("change", () => {
    const value = keyInput.value.trim();
    if (value) {
      storeKey(value);
      setAiStatus("on", "● key saved");
    } else {
      setAiStatus("off", "● no key");
    }
  });

  askBtn.addEventListener("click", async () => {
    const apiKey = keyInput.value.trim();
    if (!apiKey) {
      box.textContent = "Add your Gemini API key above to get a suggestion.";
      box.classList.add("placeholder");
      setAiStatus("off", "● no key");
      return;
    }

    storeKey(apiKey);
    askBtn.disabled = true;
    setAiStatus("busy", "● thinking");
    box.textContent = "Analyzing the live market snapshot…";
    box.classList.add("placeholder");

    try {
      const snapshot = collectMarketSnapshot();
      const prompt = buildPromt(snapshot);
      const text = await requestToGemini(apiKey, prompt);
      renderAdvice(text.trim());
      setAiStatus("on", "● live");
    } catch (err) {
      box.textContent = "Could not get a suggestion: " + err.message;
      box.classList.add("placeholder");
      setAiStatus("off", "● error");
    } finally {
      askBtn.disabled = false;
    }
  });
}

document.addEventListener("DOMContentLoaded", initAiAdvisor);

async function requestToGemini(apiKey, prompt) {
  const model = await resolveModel(apiKey);
  const endpoint =
    gemini_apibase + "/models/" + model + ":generateContent?key=" + apiKey;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            {
              text: prompt,
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    let detail = "";
    try {
      const errBody = await response.json();
      detail =
        errBody && errBody.error && errBody.error.message
          ? " — " + errBody.error.message
          : "";
    } catch (err) {
      // No JSON body; keep detail empty.
    }
    if (response.status === 404) {
      // The cached model is bad for this key; clear it so the next try re-lists.
      gemini_resolved_model = null;
    }
    throw new Error("HTTP " + response.status + " on model " + model + detail);
  }

  const data = await response.json();
  const text =
    data &&
    data.candidates &&
    data.candidates[0] &&
    data.candidates[0].content &&
    data.candidates[0].content.parts[0] &&
    data.candidates[0].content.parts[0].text;

  if (!text) {
    throw new Error("Invalid response structure from Gemini API");
  } else {
    return text;
  }
}
