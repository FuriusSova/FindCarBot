require("dotenv").config();
const { Telegraf } = require("telegraf");
const bot = new Telegraf(process.env.BOT_TOKEN, { handlerTimeout: 86500000 });
const puppeteer = require("puppeteer-extra");
const chr = require("cheerio");
const util = require("util");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const opts = require("./config");
const vars = require("./variables");

const processedCars = new Set();
let setPriceFlag = false;
let setMileageFlag = false;
let parsingFlag = false;
let setPrice = "Не указано";
let setMileage = "Не указано";
let messageIdsToDelete = [];

puppeteer.use(StealthPlugin());

async function startBrowser(url) {
  const browser = await puppeteer.launch(opts.LAUNCH_PUPPETEER_OPTS);
  const page = await browser.newPage();
  await page.setViewport({
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
  });
  page.setDefaultNavigationTimeout(0);
  await page.goto(url);
  await page.waitForNavigation({ waitUntil: "load" });

  return { page, browser };
}

async function getHTML(page) {
  const content = await page.content();
  return chr.load(content);
}

async function getCars($) {
  const cars = $("#root > div > div.NGBg0 > div.leHcX > article");
  const carElements = cars.children().filter((index, element) => {
    return (
      $(element).is(".mN_WC") || $(element).children().first().is(".mN_WC")
    );
  });
  carObject = {};
  carsArr = [];

  carElements.each((index, element) => {
    firstChild = $(element).children().first();
    if (firstChild.get(0).tagName != "a") {
      firstChild = firstChild.children().first();
    }
    const link = "https://suchen.mobile.de" + firstChild.attr("href");

    const key = link.match(/id=([^&]+)/)[1];
    if (processedCars.has(key)) {
      return true;
    }
    processedCars.add(key);

    const info = firstChild.children(".K0qQI").children();
    const name = info.first().children(".QeGRL").text();
    const subInfo = info.eq(1).children().first().first().text();
    const mileage = subInfo.match(/•(.*?)•/)[1].trim(); // THE PROBLEM IS HERE
    let price = firstChild
      .children(".V7THI")
      .children()
      .first()
      .children(".fpviJ")
      .text();
    price = price.slice(0, price.indexOf("€") + 1);

    carObject.name = name;
    carObject.link = link;
    carObject.mileage = mileage;
    carObject.price = price;

    carsArr.push(carObject);
    carObject = {};
  });

  return carsArr;
}

async function startParsing(ctx) {
  try {
    let { page, browser } = await startBrowser(
      `https://suchen.mobile.de/fahrzeuge/search.html?dam=false&isSearchRequest=true&ml=%3A${setMileage}&ms=3500%3B52%3B%3B&p=%3A${setPrice}&ref=dsp&s=Car&sb=rel&tr=AUTOMATIC_GEAR&vat=1&vc=Car`
    );
    let $ = await getHTML(page);
    if (
      parseInt(
        $(
          "#root > div > div.NGBg0 > div.leHcX > article > section.HaBLt.ku0Os.WPqkQ > div > h1"
        )
          .text()
          .match(/^\d+/)[0]
      ) == 0
    ) {
      ctx.reply("Ничего не найдено по указанным параметрам");
      page.close();
      browser.close();
      parsingFlag = false;
      return;
    }

    let numberOfPages = $(
      "#root > div > div.NGBg0 > div.leHcX > article > section.HaBLt.ku0Os.ctcQH > div > div.Fqi7C > ul > li:nth-child(8) > button > span > span"
    ).text();
    if (!parseInt(numberOfPages)) numberOfPages = 1;
    for (let i = 1; i <= numberOfPages; i++) {
      let link = `https://suchen.mobile.de/fahrzeuge/search.html?dam=false&isSearchRequest=true&ml=%3A${setMileage}&ms=3500%3B52%3B%3B&p=%3A${setPrice}&pageNumber=${i}&ref=srpNextPage&refId=a217d3fa-9756-03b7-9778-338219003b47&s=Car&sb=rel&tr=AUTOMATIC_GEAR&vat=1&vc=Car`;
      await page.goto(link);
      try {
        await page.waitForSelector("#root > div > div.NGBg0 > div.leHcX");
      } catch (error) {
        await page.close();
        await browser.close();
        let envInternet = await startBrowser(link);
        page = envInternet.page;
        browser = envInternet.browser;
        i--;
        continue;
      }
      $ = await getHTML(page);
      numberOfPages = $(
        "#root > div > div.NGBg0 > div.leHcX > article > section.HaBLt.ku0Os.ctcQH > div > div.Fqi7C > ul > li:nth-child(8) > button > span > span"
      ).text();
      if (!parseInt(numberOfPages)) numberOfPages = 1;

      carsArr = await getCars($);
      for (const car of carsArr) {
        await ctx.replyWithMarkdown(
          `[${car.name}](${car.link})\n${car.price}\n${car.mileage}`
        );
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      if (i == numberOfPages) {
        i = 0;
      }
    }
  } catch (error) {
    console.log(error);
  }
}

bot.start(async (ctx) => {
  if (
    ctx.message.from.username == "dream_161" ||
    ctx.message.from.username == "Furius16" ||
    ctx.message.from.username == "Richard9994"
  ) {
    await ctx
      .reply(util.format(vars.configureText, setPrice, setMileage), {
        reply_markup: {
          inline_keyboard: [
            [
              { text: "Указать цену", callback_data: "price_option" },
              { text: "Указать пробег", callback_data: "mileage_option" },
            ],
            parseInt(setPrice) && parseInt(setMileage)
              ? [{ text: "Начать парсинг", callback_data: "start_scraping" }]
              : [],
          ],
        },
      })
      .catch((err) => console.log(err));
  } else {
    await ctx
      .reply("Ты не начальник")
      .then((sentMessage) => {
        messageIdsToDelete.push(sentMessage.message_id);
      })
      .catch((err) => console.log(err));
  }
});

bot.on("callback_query", async (ctx) => {
  const query = ctx.callbackQuery.data;
  if (query == "price_option" && !setPriceFlag && !setMileageFlag) {
    setPriceFlag = true;
    await ctx
      .reply("Отправь боту цену в евро (только цифры)")
      .then((sentMessage) => {
        messageIdsToDelete.push(sentMessage.message_id);
      })
      .catch((err) => console.log(err));
  } else if (query == "mileage_option" && !setPriceFlag && !setMileageFlag) {
    setMileageFlag = true;
    await ctx
      .reply("Отправь боту пробег в км (только цифры)")
      .then((sentMessage) => {
        messageIdsToDelete.push(sentMessage.message_id);
      })
      .catch((err) => console.log(err));
  } else if (query == "start_scraping" && !parsingFlag) {
    await ctx
      .reply("Начинаем парсинг...")
      .then((sentMessage) => {
        messageIdsToDelete.push(sentMessage.message_id);
      })
      .catch((err) => console.log(err));
    await startParsing(ctx);
  } else if (query == "start_scraping" && parsingFlag) {
    await ctx
      .reply("Парсинг уже начат")
      .then((sentMessage) => {
        messageIdsToDelete.push(sentMessage.message_id);
      })
      .catch((err) => console.log(err));
  }
  ctx.answerCbQuery();
});

bot.on("message", async (ctx) => {
  const message = ctx.message.text;
  if (setPriceFlag && !/[^\d]/.test(message)) {
    setPrice = parseInt(message);
    await ctx.deleteMessages(messageIdsToDelete);
    await ctx
      .reply(util.format(vars.configureText, setPrice, setMileage), {
        reply_markup: {
          inline_keyboard: [
            [
              { text: "Указать цену", callback_data: "price_option" },
              { text: "Указать пробег", callback_data: "mileage_option" },
            ],
            parseInt(setPrice) && parseInt(setMileage)
              ? [{ text: "Начать парсинг", callback_data: "start_scraping" }]
              : [],
          ],
        },
      })
      .catch((err) => console.log(err));
    setPriceFlag = false;
  } else if (setMileageFlag && !/[^\d]/.test(message)) {
    setMileage = parseInt(message);
    await ctx.deleteMessages(messageIdsToDelete);
    await ctx
      .reply(util.format(vars.configureText, setPrice, setMileage), {
        reply_markup: {
          inline_keyboard: [
            [
              { text: "Указать цену", callback_data: "price_option" },
              { text: "Указать пробег", callback_data: "mileage_option" },
            ],
            parseInt(setPrice) && parseInt(setMileage)
              ? [{ text: "Начать парсинг", callback_data: "start_scraping" }]
              : [],
          ],
        },
      })
      .catch((err) => console.log(err));
    setMileageFlag = false;
  } else {
    await ctx
      .reply("Неверно указанные данные или не выбрана опция")
      .then((sentMessage) => {
        messageIdsToDelete.push(sentMessage.message_id);
      })
      .catch((err) => console.log(err));
  }
});

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
bot.launch();
