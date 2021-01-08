require("dotenv").config();

var fs = require("fs"),
  telegram = require("telegram-bot-api"),
  Twitter = require("twitter"),
  web = require("puppeteer"),
  Binance = require("binance-api-node").default,
  api = Binance(),
  client = new Twitter({
    consumer_key: process.env.TWITTER_C_KEY,
    consumer_secret: process.env.TWITTER_C_SECRET,
    access_token_key: process.env.TWITTER_AT_KEY,
    access_token_secret: process.env.TWITTER_AT_SECRET,
  }),
  chat = new telegram({ token: process.env.TG_KEY }),
  NodeCache = require("node-cache"),
  cache = new NodeCache({ stdTTL: 1, checkperiod: 1 }),
  browser = undefined,
  page = undefined,
  data = {},
  queue = [];

cache.set("checkQueue", true);

cache.on("expired", async (key, value) => {
  if (key == "web") {
    await browser.close();
  } else if (key == "checkQueue") {
    if (queue.length > 0) getChart();
    else cache.set(key, true);
  }
});

const startBrowser = async () => {
  browser = await web.launch({
    headless: true,
    ignoreHTTPSErrors: true,
    defaultViewport: null,
    args: [`--window-size=${1920},${1080}`, "--no-sandbox"],
  });
  const context = await browser.createIncognitoBrowserContext();
  page = await context.newPage();
  await page.goto("https://tradingview.com");
  await page.click('span[class="tv-header__dropdown-text"]');
  await page.waitForSelector('span[class~="tv-signin-dialog__toggle-email"]');
  await page.click('span[class~="tv-signin-dialog__toggle-email"]');
  await page.type("input[name=username]", process.env.TV_EMAIL);
  await page.type("input[name=password]", process.env.TV_PASSWORD);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1000);
  cache.set("web", true, 200);
};

const getChart = async () => {
  const cachedData = cache.get("web");
  if (!cachedData) await startBrowser();

  while (queue.length > 0 && cachedData) {
    cache.set("web", true, 60);
    const symbol = queue[0];
    const item = data[symbol];
    delete data[symbol];
    queue.shift();

    await page.goto(
      "https://tradingview.com/chart?interval=240&symbol=BINANCE:" + symbol
    );
    await page.waitForTimeout(1500);
    const element = await page.$('table[class="chart-markup-table"]');

    try {
      sendMessage(
        await element.screenshot({ path: "image.png" }),
        symbol,
        item.type,
        item.price
      );
    } catch (e) {
      console.log(e);
    }
  }
  cache.set("checkQueue", true);
};

const sendMessage = (image, symbol, type, price) => {
  const message = `${type} ${symbol} at $${price}`;
  const imageStream = fs.createReadStream("image.png");
  console.log(message);

  chat
    .sendPhoto({
      chat_id: process.env.TG_CHAT,
      photo: imageStream,
      caption: message,
    })
    .then((result) => {
      client.post(
        "media/upload",
        { media: image },
        (error, media, response) => {
          if (error) {
            console.log(error);
          } else {
            const status = {
              status: message,
              media_ids: media.media_id_string,
            };
            client.post(
              "statuses/update",
              status,
              function (error, tweet, response) {
                if (error) {
                  console.log(error);
                }
              }
            );
          }
        }
      );
    })
    .catch((err) => {
      console.log(err);
    });
};

// #######################################################################
// HOURLY STRATEGY
// #######################################################################

var RSI = require("technicalindicators").RSI;
var AO = require("technicalindicators").AwesomeOscillator;
var EMA = require("technicalindicators").EMA;
var HIGHEST = require("technicalindicators").Highest;
var LOWEST = require("technicalindicators").Lowest;

var symbols = [];
var info = {};
var length = 225;
var interval = process.env.INTERVAL;
const intervals = [interval]; //, '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d']

function getCandles(symbol) {
  intervals.forEach((times) => {
    api
      .candles({ symbol: symbol, interval: times, limit: length })
      .then((result) => {
        info[symbol][times] = [];
        var i = 0;
        result.forEach((candle) => {
          if (i < length - 1)
            info[symbol][times].push([
              candle.openTime,
              parseFloat(candle.open),
              parseFloat(candle.high),
              parseFloat(candle.low),
              parseFloat(candle.close),
              parseFloat(candle.volume),
            ]);
          i++;
        });
        if (info[symbol][times].length != length - 1)
          delete info[symbol][times];
      })
      .catch((err) => console.log(err));
  });
}

api
  .dailyStats()
  .then((result) => {
    result.forEach((index) => {
      if (
        index.symbol.endsWith("USDT") &&
        !(
          index.symbol.startsWith("PAX") ||
          index.symbol.startsWith("USDC") ||
          index.symbol.startsWith("BUSD") ||
          index.symbol.startsWith("TUSD")
        ) &&
        index.quoteVolume > 500000
      ) {
        info[index.symbol] = {};
        symbols.push(index.symbol);
        getCandles(index.symbol);
      }
    });
    api.ws.candles(symbols, interval, (candle) => {
      if (
        candle.isFinal == true &&
        info[candle.symbol][interval] != undefined
      ) {
        info[candle.symbol][interval].shift();
        info[candle.symbol][interval].push([
          candle.startTime,
          parseFloat(candle.open),
          parseFloat(candle.high),
          parseFloat(candle.low),
          parseFloat(candle.close),
          parseFloat(candle.volume),
        ]);
        scan(candle.symbol);
      }
    });
  })
  .catch((err) => console.log(err));

const scan = (symbol) => {
  var closei = [];
  var highi = [];
  var lowi = [];
  var openi = [];

  info[symbol][interval].forEach((index) => {
    closei.push(index[4]);
    highi.push(index[2]);
    lowi.push(index[3]);
    openi.push(index[1]);
  });

  var pointsRSI = {
    values: closei,
    period: 14,
  };

  var pointsEMA55 = {
    values: closei,
    period: 55,
  };

  var pointsEMA200 = {
    values: closei,
    period: 200,
  };

  var pointsAO = {
    high: highi,
    low: lowi,
    fastPeriod: 5,
    slowPeriod: 34,
    format: (a) => parseFloat(a.toFixed(7)),
  };

  var pivotclose = {
    values: closei,
    period: 90,
  };

  var rsii = new RSI(pointsRSI);

  var pivot = {
    values: rsii.result,
    period: 90,
  };

  var ao = new AO(pointsAO);
  var ema200i = new EMA(pointsEMA200);
  var ema55i = new EMA(pointsEMA55);
  var maxRSI = new HIGHEST(pivot);
  var minRSI = new LOWEST(pivot);
  var maxCLOSE = new HIGHEST(pivotclose);
  var minCLOSE = new LOWEST(pivotclose);

  var td = 0;
  const rsi71 = 71;
  const rsi29 = 29;
  const rsi49 = 49;
  const rsi50 = 50;
  const rsi61 = 61;
  var rsiDivBull = [];
  var rsiDivBear = [];
  var rsiPivotH = [];
  var rsiPivotL = [];
  var tdseq = [];
  var aoBullCross = [];
  var aoBearCross = [];
  var ema200 = ema200i.result.reverse();
  var ema55 = ema55i.result.reverse();
  var open = openi.reverse();
  var close = [...closei];
  close.reverse();
  var low = lowi.reverse();
  var rsi = rsii.result.reverse();

  //can apply another filter
  if (true) {
    //////////////////////////////////////////////////////////////////////////////////////
    // TD SEQUENTIAL (last 15 bars) tdsec
    for (var i = 20; i > 0; i--) {
      //Bullish
      if (
        closei[closei.length - i] > closei[closei.length - i - 4] &&
        closei[closei.length - i - 1] < closei[closei.length - i - 4 - 1]
      )
        td = 1;
      else if (
        closei[closei.length - i] > closei[closei.length - i - 4] &&
        td > 0
      )
        td++;
      //Bearish
      if (
        closei[closei.length - i] < closei[closei.length - i - 4] &&
        closei[closei.length - i - 1] > closei[closei.length - i - 4 - 1]
      )
        td = -1;
      else if (
        closei[closei.length - i] < closei[closei.length - i - 4] &&
        td < 0
      )
        td--;
      tdseq.push(td);
    }
    tdseq.reverse();
    //////////////////////////////////////////////////////////////////////////////////////
    //      //      //      //      //      //      //      //
    //////////////////////////////////////////////////////////////////////////////////////
    // RSI Divs and Pivots (last 10 bars) rsiDivBear, rsiDivBull, rsiPivotH, rsiPivotL
    for (var i = 20; i > 0; i--) {
      //+2 for 2 bar offset
      if (
        maxRSI.result[maxRSI.result.length - i + 2] ==
          maxRSI.result[maxRSI.result.length - i - 2 + 2] &&
        maxRSI.result[maxRSI.result.length - i - 2 + 2] >
          maxRSI.result[maxRSI.result.length - i - 3 + 2]
      ) {
        rsiPivotH.push(true);
      } else rsiPivotH.push(false);

      if (
        minRSI.result[minRSI.result.length - i + 2] ==
          minRSI.result[minRSI.result.length - i - 2 + 2] &&
        minRSI.result[minRSI.result.length - i - 2 + 2] <
          minRSI.result[minRSI.result.length - i - 3 + 2]
      ) {
        rsiPivotL.push(true);
      } else rsiPivotL.push(false);
      // +1 for 1 bar offset
      if (
        maxCLOSE.result[maxCLOSE.result.length - i - 1 + 1] >
          maxCLOSE.result[maxCLOSE.result.length - i - 2 + 1] &&
        rsii.result[rsii.result.length - i - 1 + 1] <
          maxRSI.result[maxRSI.result.length - i + 1] &&
        rsii.result[rsii.result.length - i + 1] <
          rsii.result[rsii.result.length - i - 1 + 1]
      ) {
        rsiDivBear.push(true);
      } else rsiDivBear.push(false);

      if (
        minCLOSE.result[minCLOSE.result.length - i - 1 + 1] <
          minCLOSE.result[minCLOSE.result.length - i - 2 + 1] &&
        rsii.result[rsii.result.length - i - 1 + 1] >
          minRSI.result[minRSI.result.length - i + 1] &&
        rsii.result[rsii.result.length - i + 1] >
          rsii.result[rsii.result.length - i - 1 + 1]
      ) {
        rsiDivBull.push(true);
      } else rsiDivBull.push(false);
    }
    rsiDivBear.reverse();
    rsiDivBull.reverse();
    rsiPivotH.reverse();
    rsiPivotL.reverse();
    //////////////////////////////////////////////////////////////////////////////////////
    //      //      //      //      //      //      //      //
    //////////////////////////////////////////////////////////////////////////////////////
    // AO crosses (last 2 bars) aoBullCross, aoBearCross
    for (var i = 20; i > 0; i--) {
      if (
        ao.result[ao.result.length - i] > ao.result[ao.result.length - i - 1] &&
        ao.result[ao.result.length - i] < 0 &&
        ao.result[ao.result.length - i - 1] <
          ao.result[ao.result.length - i - 2]
      )
        aoBullCross.push(true);
      else aoBullCross.push(false);

      if (
        ao.result[ao.result.length - i] < ao.result[ao.result.length - i - 1] &&
        ao.result[ao.result.length - i] > 0 &&
        ao.result[ao.result.length - i - 1] >
          ao.result[ao.result.length - i - 2]
      )
        aoBearCross.push(true);
      else aoBearCross.push(false);
    }
    aoBullCross.reverse();
    aoBearCross.reverse();
    //////////////////////////////////////////////////////////////////////////////////////
    //      //      //      //      //      //      //      //
    //////////////////////////////////////////////////////////////////////////////////////
    // AO Strategy

    //BOTTOM
    if (
      aoBullCross[0] &&
      //red candle or rsi > 29
      (close[0] < open[0] || rsi[0] > rsi29) &&
      //below emas or undefined
      ((ema200[0] > close[0] && ema55[0] > close[0]) ||
        ema200[0] == undefined) &&
      //between 1 and 2, or -9, -10...
      ((tdseq[0] > 0 && tdseq[0] < 3) || tdseq[0] < -8) &&
      //has diverging rsi in 4 most recent bars
      (rsiDivBull[0] ||
        rsiDivBull[1] ||
        rsiDivBull[2] ||
        rsiDivBull[3] ||
        (rsiDivBull[4] && rsi[0] < rsi50) ||
        rsi[1] < rsi29 ||
        rsi[2] < rsi29 ||
        rsi[3] < rsi29 ||
        rsi[4] < rsi29 ||
        rsiPivotL[0] ||
        rsiPivotL[1] ||
        rsiPivotL[2] ||
        rsiPivotL[3] ||
        rsiPivotL[4] ||
        rsiPivotL[5])
    ) {
      data[symbol] = { type: "BOTTOM", price: close[0] };
      queue.push(symbol);
    }
    //TOP
    else if (
      aoBearCross[0] &&
      //green candle or rsi < 71
      (close[0] > open[0] || rsi[0] < rsi71) &&
      //below emas or undefined
      ((ema200[0] < close[0] && ema55[0] < close[0]) ||
        ema200[0] == undefined) &&
      //between -1 and -2, or 9, 10...
      ((tdseq[0] < 0 && tdseq[0] > -3) || tdseq[0] > 8) &&
      //has diverging rsi in 4 most recent bars
      (rsiDivBear[0] ||
        rsiDivBear[1] ||
        rsiDivBear[2] ||
        rsiDivBear[3] ||
        (rsiDivBear[4] && rsi[0] > rsi50) ||
        rsi[1] > rsi71 ||
        rsi[2] > rsi71 ||
        rsi[3] > rsi71 ||
        rsi[4] > rsi71 ||
        rsiPivotH[0] ||
        rsiPivotH[1] ||
        rsiPivotH[2] ||
        rsiPivotH[3] ||
        rsiPivotH[4] ||
        rsiPivotH[5])
    ) {
      data[symbol] = { type: "TOP", price: close[0] };
      queue.push(symbol);
    }
    //SELL
    else if (
      aoBearCross[0] &&
      rsi[0] < rsi61 &&
      //below emas or undefined
      (ema200[0] > close[0] || ema200[0] == undefined) &&
      //has diverging rsi in 4 most recent bars
      (rsiDivBear[0] ||
        rsiDivBear[1] ||
        rsiDivBear[2] ||
        rsiDivBear[3] ||
        rsiDivBear[4] ||
        rsi[0] > rsi29)
    ) {
      data[symbol] = { type: "SELL", price: close[0] };
      queue.push(symbol);
    }
    //BUY
    else if (
      aoBullCross[0] &&
      rsi[0] > rsi49 &&
      //below emas or undefined
      (ema200[0] < close[0] || ema200[0] == undefined) &&
      //has diverging rsi in 4 most recent bars
      (rsiDivBull[0] ||
        rsiDivBull[1] ||
        rsiDivBull[2] ||
        rsiDivBull[3] ||
        rsiDivBull[4] ||
        rsi[0] < rsi71)
    ) {
      data[symbol] = { type: "BUY", price: close[0] };
      queue.push(symbol);
    }
  }
};
