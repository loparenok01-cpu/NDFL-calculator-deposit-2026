"use strict";
const fs = require("fs");
const { JSDOM } = require("jsdom");
const path = require("path");
const p = path.resolve(__dirname, "..", "Chellenge") + path.sep;
const html = fs.readFileSync(p + "case-template.html", "utf8");

const ph = html.match(/\[[^\]]{2,}\]/g) || [];
console.log("1. плейсхолдеров [.] осталось:", ph.length, ph.length ? JSON.stringify(ph) : "");

const dom = new JSDOM(html);
const d = dom.window.document;
console.log("2. заголовок:", d.querySelector("h1").textContent);
console.log("3. ссылка на проект:", d.querySelector(".project-link").getAttribute("href"));
console.log("4. блоков case-block:", d.querySelectorAll(".case-block").length);
console.log("5. секций case-section:", d.querySelectorAll(".case-section").length);
console.log("6. заглушек скриншотов:", d.querySelectorAll(".img-placeholder").length);
console.log("7. mailto:", d.querySelector(".case-cta a").getAttribute("href"));
console.log("8. style.css подключён:", !!d.querySelector('link[href="style.css"]'));
console.log("9. цветов гаммы в inline-стиле:", (html.match(/2f7a3e|43a047|f7e37e|e7f3dc/g) || []).length);
console.log("10. ../index.html существует:", fs.existsSync(p + "../index.html"));
console.log("11. style.css существует:", fs.existsSync(p + "style.css"));

["Задача", "Целевая аудитория", "Проблема", "Решение", "Основные функции", "Использованные инструменты"].forEach((t) => {
  const h3 = [...d.querySelectorAll("h3")].find((x) => x.textContent.trim() === t);
  const len = h3 && h3.nextElementSibling.textContent.trim().length;
  console.log("    блок «" + t + "»:", len > 50 ? "заполнен, " + len + " симв." : "ПУСТОЙ!");
});
