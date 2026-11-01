const STARTING_CASH = 100000;
const TICK_TIME = 900;
const PRICE_MOVE = 0.012;
const NEWS_MIN_TIME = 4000;
const NEWS_MAX_TIME = 9000;

const stocks = [
  { symbol: "AAPL", name: "Apple Inc.", price: 224.31, open: 224.31 },
  { symbol: "MSFT", name: "Microsoft Corp.", price: 418.9, open: 418.9 },
  { symbol: "NVDA", name: "NVIDIA Corp.", price: 128.44, open: 128.44 },
  { symbol: "TSLA", name: "Tesla Inc.", price: 246.12, open: 246.12 },
  { symbol: "AMZN", name: "Amazon.com Inc.", price: 186.55, open: 186.55 },
  { symbol: "GOOGL", name: "Alphabet Inc.", price: 165.28, open: 165.28 },
];

const holdings = {};

let cash = STARTING_CASH;
const trades = [];
let selectedSymbol = stocks[0].symbol;
let side = "buy";
let priceTimer = null;
let newsTimer = null;

// Find one stock object by its symbol.
function findStock(symbol) {
  for (let i = 0; i < stocks.length; i++) {
    if (stocks[i].symbol === symbol) {
      return stocks[i];
    }
  }
  return null;
}

const dollars = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

// Turn a number into money text, like 1234.5 -> "$1,234.50".
function money(amount) {
  return dollars.format(amount);
}

// Turn a percent into text, like 1.2 -> "+1.20%".
function percent(value) {
  const sign = value >= 0 ? "+" : "";
  return sign + value.toFixed(2) + "%";
}

// Work out how much a stock has moved since the market opened, as a percent.
function todayChange(stock) {
  if (stock.open === 0) {
    return 0;
  }
  return ((stock.price - stock.open) / stock.open) * 100;
}

// Make sure a holding exists for this symbol, then return it.
function getHolding(symbol) {
  if (!holdings[symbol]) {
    holdings[symbol] = { shares: 0, avgCost: 0 };
  }
  return holdings[symbol];
}

// Add up the value of every share we own at today's prices.
function totalHoldings() {
  let total = 0;
  for (const symbol in holdings) {
    const h = holdings[symbol];
    if (h.shares > 0) {
      const stock = findStock(symbol);
      total = total + h.shares * stock.price;
    }
  }
  return total;
}

const clock = document.getElementById("clock");
const connBadge = document.getElementById("connBadge");
const feedBtn = document.getElementById("feedBtn");
const cashValue = document.getElementById("cashValue");
const holdingsValue = document.getElementById("holdingsValue");
const netValue = document.getElementById("netValue");
const watchlist = document.getElementById("watchlist");
const detailSymbol = document.getElementById("detailSymbol");
const detailName = document.getElementById("detailName");
const quotePrice = document.getElementById("quotePrice");
const quoteChange = document.getElementById("quoteChange");
const orderForm = document.getElementById("orderForm");
const orderQty = document.getElementById("orderQty");
const orderEst = document.getElementById("orderEst");
const orderSubmit = document.getElementById("orderSubmit");
const orderMsg = document.getElementById("orderMsg");
const positionValue = document.getElementById("positionValue");
const tradeLog = document.getElementById("tradeLog");
const logCount = document.getElementById("logCount");
const newsFeed = document.getElementById("newsFeed");

// Build one watchlist row for every stock.
function drawWatchlist() {
  watchlist.innerHTML = "";
  for (const stock of stocks) {
    const row = document.createElement("li");
    row.className = "ticker-row";
    row.dataset.symbol = stock.symbol;
    row.innerHTML =
      '<span class="sym">' +
      '<span class="sym-ticker">' +
      stock.symbol +
      "</span>" +
      '<span class="sym-name">' +
      stock.name +
      "</span>" +
      "</span>" +
      '<span class="last num" data-role="last"></span>' +
      '<span class="chg num" data-role="chg"></span>';
    watchlist.append(row);
    updateRow(stock, "none");
  }
  highlightSelected();
}

// Update the price and change in one watchlist row.
function updateRow(stock, flash) {
  const row = watchlist.querySelector('[data-symbol="' + stock.symbol + '"]');
  if (!row) {
    return;
  }

  row.querySelector('[data-role="last"]').textContent = money(stock.price);

  const change = todayChange(stock);
  const chg = row.querySelector('[data-role="chg"]');
  chg.textContent = percent(change);
  if (change >= 0) {
    chg.className = "chg num up";
  } else {
    chg.className = "chg num down";
  }

  if (flash === "up") {
    row.classList.remove("flash-down");
    row.classList.add("flash-up");
  } else if (flash === "down") {
    row.classList.remove("flash-up");
    row.classList.add("flash-down");
  }
}

// Highlight the selected row and un-highlight the rest.
function highlightSelected() {
  for (const row of watchlist.children) {
    if (row.dataset.symbol === selectedSymbol) {
      row.classList.add("active");
    } else {
      row.classList.remove("active");
    }
  }
}

// Fill in the big quote panel for the selected stock.
function drawDetail() {
  const stock = findStock(selectedSymbol);
  if (!stock) {
    return;
  }

  detailSymbol.textContent = stock.symbol;
  detailName.textContent = stock.name;
  quotePrice.textContent = money(stock.price);

  const change = todayChange(stock);
  quoteChange.textContent = percent(change);
  if (change >= 0) {
    quoteChange.className = "quote-change up";
  } else {
    quoteChange.className = "quote-change down";
  }

  drawPosition(stock);
  drawEstimate();
}

// Show how many shares we own of the selected stock and the profit or loss.
function drawPosition(stock) {
  const h = holdings[stock.symbol];
  if (!h || h.shares === 0) {
    positionValue.textContent = "No open position";
    return;
  }
  const profit = (stock.price - h.avgCost) * h.shares;
  const sign = profit >= 0 ? "+" : "";
  positionValue.textContent =
    h.shares + " @ " + money(h.avgCost) + " · " + sign + money(profit);
}

// Update the cash, holdings and net worth numbers in the header.
function drawAccount() {
  cashValue.textContent = money(cash);
  holdingsValue.textContent = money(totalHoldings());
  netValue.textContent = money(cash + totalHoldings());
}

// Show the estimated cost of the order the user is typing.
function drawEstimate() {
  const stock = findStock(selectedSymbol);
  let qty = Math.floor(Number(orderQty.value));
  if (!qty || qty < 0) {
    qty = 0;
  }
  const price = stock ? stock.price : 0;
  orderEst.textContent = money(qty * price);
}

// Switch between the Buy and Sell tabs.
function setSide(newSide) {
  side = newSide;
  const buttons = orderForm.querySelectorAll(".side-btn");
  for (const btn of buttons) {
    if (btn.dataset.side === newSide) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  }
  orderSubmit.textContent = "Place " + newSide + " order";
}

// Show a short message under the order form.
function showOrderMsg(text, kind) {
  orderMsg.textContent = text;
  orderMsg.className = "order-msg " + kind;
  if (kind === "ok") {
    setTimeout(function () {
      if (orderMsg.textContent === text) {
        orderMsg.textContent = "";
        orderMsg.className = "order-msg";
      }
    }, 3000);
  }
}

// Add one finished trade to the top of the trade log.
function addTradeToLog(trade) {
  const empty = tradeLog.querySelector(".log-empty");
  if (empty) {
    empty.remove();
  }

  const row = document.createElement("li");
  row.className = "log-row";
  const time = new Date(trade.time).toLocaleTimeString("en-US", {
    hour12: false,
  });
  row.innerHTML =
    '<span class="log-side ' +
    trade.side +
    '">' +
    trade.side.toUpperCase() +
    "</span>" +
    '<span class="log-detail">' +
    "<strong>" +
    trade.shares +
    "</strong> " +
    trade.symbol +
    " @ " +
    money(trade.price) +
    "<br />" +
    money(trade.total) +
    "</span>" +
    '<span class="log-time">' +
    time +
    "</span>";
  tradeLog.prepend(row);

  if (trades.length === 1) {
    logCount.textContent = "1 fill";
  } else {
    logCount.textContent = trades.length + " fills";
  }
}

// Add one headline to the top of the news list.
function addNewsToFeed(news) {
  const empty = newsFeed.querySelector(".news-empty");
  if (empty) {
    empty.remove();
  }

  const row = document.createElement("li");
  row.className = "news-row";
  const time = new Date(news.time).toLocaleTimeString("en-US", {
    hour12: false,
  });
  row.innerHTML =
    '<span class="news-tag ' +
    news.sentiment +
    '">' +
    news.sentiment +
    "</span>" +
    '<span class="news-text">' +
    '<span class="news-sym">' +
    news.symbol +
    "</span> " +
    news.text +
    "</span>" +
    '<span class="news-time">' +
    time +
    "</span>";
  newsFeed.prepend(row);

  while (newsFeed.children.length > 30) {
    newsFeed.lastElementChild.remove();
  }
}

// Try to buy or sell shares, or throw an error we can show the user.
function doOrder(buyOrSell, stock, typedQty) {
  const qty = Math.floor(Number(typedQty));
  if (!qty || qty < 1) {
    throw new Error("Enter a whole quantity of 1 or more.");
  }

  const cost = qty * stock.price;
  const h = getHolding(stock.symbol);

  if (buyOrSell === "buy") {
    if (cost > cash) {
      throw new Error("Not enough cash for this order.");
    }
    cash = cash - cost;
    const spentBefore = h.avgCost * h.shares;
    h.shares = h.shares + qty;
    h.avgCost = (spentBefore + cost) / h.shares;
  } else {
    if (qty > h.shares) {
      throw new Error("You only hold " + h.shares + " share(s).");
    }
    cash = cash + cost;
    h.shares = h.shares - qty;
    if (h.shares === 0) {
      h.avgCost = 0;
    }
  }

  const trade = {
    side: buyOrSell,
    symbol: stock.symbol,
    shares: qty,
    price: stock.price,
    total: cost,
    time: Date.now(),
  };
  trades.push(trade);
  return trade;
}

// Round a price to cents and never let it drop below $1.
function tidyPrice(value) {
  if (value < 1) {
    value = 1 + Math.random();
  }
  return Math.round(value * 100) / 100;
}

// Set a new price for a stock and redraw everything it affects.
function setPrice(stock, newPrice) {
  const oldPrice = stock.price;
  stock.price = newPrice;

  let flash = "none";
  if (newPrice > oldPrice) {
    flash = "up";
  } else if (newPrice < oldPrice) {
    flash = "down";
  }

  updateRow(stock, flash);
  if (stock.symbol === selectedSymbol) {
    drawDetail();
  }
  drawAccount();
}

// Pick a random stock and move its price a little. Runs on a timer.
function priceTick() {
  const stock = stocks[Math.floor(Math.random() * stocks.length)];
  const move = (Math.random() - 0.5) * 2 * PRICE_MOVE;
  setPrice(stock, tidyPrice(stock.price * (1 + move)));
}

const headlines = {
  bullish: [
    "{name} beats quarterly earnings expectations",
    "Analysts upgrade {name} to 'strong buy'",
    "{name} announces record product pre-orders",
    "{name} lands major enterprise contract",
    "{name} raises full-year revenue guidance",
  ],
  bearish: [
    "{name} misses revenue targets, shares slip",
    "Regulators open probe into {name}",
    "{name} warns of supply-chain disruptions",
    "Analysts downgrade {name} on margin concerns",
    "{name} faces class-action lawsuit",
  ],
  neutral: [
    "{name} to present at industry conference",
    "{name} names new board member",
    "{name} schedules earnings call for next week",
    "Mixed reaction to {name}'s latest keynote",
  ],
};
const moods = ["bullish", "bearish", "neutral"];

// Build a random headline about a random stock.
function makeNews() {
  const stock = stocks[Math.floor(Math.random() * stocks.length)];
  const mood = moods[Math.floor(Math.random() * moods.length)];

  const pool = headlines[mood];
  const text = pool[Math.floor(Math.random() * pool.length)].replace(
    "{name}",
    stock.name,
  );

  let effect = 0;
  if (mood !== "neutral") {
    const strength = 0.3 + Math.random() * 0.7;
    effect = strength * 0.04;
    if (mood === "bearish") {
      effect = -effect;
    }
  }

  return {
    symbol: stock.symbol,
    text: text,
    sentiment: mood,
    effect: effect,
    time: Date.now(),
  };
}

// Post one headline, nudge its stock's price, then schedule the next one.
function newsTick() {
  const news = makeNews();
  addNewsToFeed(news);

  if (news.effect !== 0) {
    const stock = findStock(news.symbol);
    setPrice(stock, tidyPrice(stock.price * (1 + news.effect)));
  }

  if (newsTimer !== null) {
    const wait =
      NEWS_MIN_TIME + Math.random() * (NEWS_MAX_TIME - NEWS_MIN_TIME);
    newsTimer = setTimeout(newsTick, wait);
  }
}

// Show today's date and the current time in the navbar.
function drawClock() {
  const now = new Date();
  const date = now.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const time = now.toLocaleTimeString("en-US", { hour12: false });
  clock.textContent = date + " · " + time;
}

// Update the connection badge in the header.
function setBadge(state, label) {
  connBadge.dataset.state = state;
  connBadge.textContent = label;
}

// Start the price timer and the news wire.
function startFeed() {
  priceTimer = setInterval(priceTick, TICK_TIME);

  const wait = NEWS_MIN_TIME + Math.random() * (NEWS_MAX_TIME - NEWS_MIN_TIME);
  newsTimer = setTimeout(newsTick, wait);

  setBadge("on", "● live");
  feedBtn.dataset.state = "on";
  feedBtn.textContent = "Disconnect";
}

// Stop both timers.
function stopFeed() {
  clearInterval(priceTimer);
  clearTimeout(newsTimer);
  priceTimer = null;
  newsTimer = null;

  setBadge("off", "● offline");
  feedBtn.dataset.state = "off";
  feedBtn.textContent = "Connect feed";
}

watchlist.addEventListener("click", function (event) {
  const row = event.target.closest(".ticker-row");
  if (!row) {
    return;
  }
  selectedSymbol = row.dataset.symbol;
  highlightSelected();
  drawDetail();
});

orderForm.addEventListener("click", function (event) {
  const btn = event.target.closest(".side-btn");
  if (btn) {
    setSide(btn.dataset.side);
  }
});

orderQty.addEventListener("input", drawEstimate);

orderForm.addEventListener("submit", function (event) {
  event.preventDefault();
  const stock = findStock(selectedSymbol);
  if (!stock) {
    return;
  }
  try {
    const trade = doOrder(side, stock, orderQty.value);
    addTradeToLog(trade);
    drawAccount();
    drawPosition(stock);
    showOrderMsg(
      "Filled: " +
        trade.side +
        " " +
        trade.shares +
        " " +
        trade.symbol +
        " @ " +
        money(trade.price),
      "ok",
    );
  } catch (error) {
    showOrderMsg(error.message, "err");
  }
});

feedBtn.addEventListener("click", function () {
  if (priceTimer) {
    stopFeed();
  } else {
    startFeed();
  }
});

drawWatchlist();
setSide("buy");
drawDetail();
drawAccount();
drawClock();
setInterval(drawClock, 1000);