"use strict";
const { JSDOM, VirtualConsole } = require("jsdom");
const fs = require("fs");
const path = require("path");
const PATH = path.resolve(__dirname, "..") + path.sep;

let failures = 0;
function check(name, actual, expected) {
  const a = String(actual).replace(/\s+/g, " ").trim();
  const e = String(expected).replace(/\s+/g, " ").trim();
  if (a === e) console.log("  PASS  " + name);
  else { failures++; console.log("  FAIL  " + name + "\n        got: " + a + "\n        exp: " + e); }
}
const digits = (s) => String(s).replace(/[^\d]/g, "");
const moneyNum = (s) => {
  const clean = String(s).replace(/[^\d,.-]/g, "").replace(",", ".");
  return clean === "" ? 0 : Number(clean);
};
const norm = (s) => String(s).replace(/[\s\u00A0\u202F]/g, "");

function load(file, js, errors) {
  let html = fs.readFileSync(PATH + file, "utf8");
  html = html
    .replace(/<link[^>]*stylesheet[^>]*>/g, "")
    .replace(/<script[^>]*src[^>]*><\/script>/g, "");
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => errors.push(e));
  vc.on("error", (e) => errors.push(e));
  const dom = new JSDOM(html, {
    url: "http://localhost/",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole: vc
  });
  dom.window.HTMLElement.prototype.scrollIntoView = function () {};
  if (js) dom.window.eval(fs.readFileSync(PATH + js, "utf8"));
  return dom;
}

function calcTax(dom, amounts, opts) {
  const doc = dom.window.document;
  const blocks = doc.querySelectorAll(".deposit");
  blocks.forEach((b, i) => {
    b.querySelector(".d-amount").value = amounts[i] || "";
    if (opts && opts[i] && opts[i].exempt) b.querySelector(".d-exempt").checked = true;
    else b.querySelector(".d-exempt").checked = false;
  });
  doc.getElementById("calculate").click();
  return {
    visible: !doc.getElementById("result").hidden,
    errors: doc.getElementById("form-errors").hidden ? [] :
      [...doc.querySelectorAll("#form-errors li")].map((li) => li.textContent),
    limit: doc.getElementById("r-limit").textContent,
    base: doc.getElementById("r-base").textContent,
    tax: doc.getElementById("r-tax").textContent,
    limitNote: doc.getElementById("r-limit-note").textContent,
    baseNote: doc.getElementById("r-base-note").textContent,
    taxNote: doc.getElementById("r-tax-note").textContent,
    split: doc.getElementById("r-tax-split").textContent,
    rows: [...doc.querySelectorAll("#r-breakdown tr:not(.is-total)")].length,
    explanation: doc.getElementById("r-explanation").textContent
  };
}

function sumTaxColumn(doc) {
  const sum = [...doc.querySelectorAll("#r-breakdown tr:not(.is-total)")]
    .reduce((s, tr) => s + moneyNum(tr.cells[3].textContent), 0);
  return Math.round(sum * 100) / 100;
}

const errors = [];
const dom = load("index.html", "app.js", errors);
const doc = dom.window.document;
const RUB = {};

console.log("\n== 1. Загрузка страницы ==");
check("ошибок при загрузке", errors.length, 0);
check("блоков вкладов (абстрактный пример)", doc.querySelectorAll(".deposit").length, 2);
check("банки предзаполнены", doc.querySelector(".d-bank").value, "Абстрактный банк №1");
check("ключевая ставка по умолчанию", doc.getElementById("key-rate").value, "16,00");

console.log("\n== 2. Тест 2 из ТЗ (два вклада, 13%) ==");
let r = calcTax(dom, ["100000", "90000"]);
check("результат виден", r.visible, "true");
check("лимит", r.limit, "160 000,00 ₽");
check("облагаемые проценты", moneyNum(doc.getElementById("r-taxable-interest").textContent), 190000);
check("облагаемая сумма", moneyNum(r.base), 30000);
check("налог", digits(r.tax), "3900");
check("строк в разбивке", r.rows, 2);
check("разбивка складывается в итог", sumTaxColumn(doc), 3900);
check("строка Итого присутствует",
  doc.querySelectorAll("#r-breakdown tr.is-total").length, 1);
check("в плитке лимита есть формула", r.limitNote.includes("1 000 000"), "true");
check("в плитке лимита есть ставка", r.limitNote.includes("16 %"), "true");
check("в плитке базы есть сумма процентов", norm(r.baseNote).includes("190000,00"), "true");
check("плитка базы пояснение «минус лимит»", r.baseNote.includes("минус необлагаемый лимит"), "true");
check("чип ставки в плите налога", r.split.includes("13 %"), "true");

console.log("\n== 3. Тест 1 из ТЗ (вклад ниже лимита, налог 0) ==");
r = calcTax(dom, ["120000", "0"]);
check("налог", digits(r.tax), "0");
check("облагаемая сумма", moneyNum(r.base), 0);
check("в тексте есть «не превысил»", r.explanation.includes("не превысил"), "true");
check("чипы ставок пустые", r.split, "");
check("налог: примечание о нулевом начислении", r.taxNote.includes("не начисляется"), "true");

console.log("\n== 4. Тест 3 из ТЗ (превышение 2,4 млн, 15%) ==");
r = calcTax(dom, ["1500000", "1500000"]);
check("налог", digits(r.tax), "378000");
check("база", moneyNum(r.base), 2840000);
check("упомянут 15%", r.explanation.includes("15 %"), "true");
check("два чипа ставок", doc.querySelectorAll("#r-tax-split .split-chip").length, 2);
check("чип 13% = 312 000 ₽", norm(r.split).includes("312000₽"), "true");
check("чип 15% = 66 000 ₽", norm(r.split).includes("66000₽"), "true");

console.log("\n== 5. Форматирование суммы при вводе ==");
const amt0 = doc.querySelectorAll(".d-amount")[0];
function typeAmount(el, text) {
  el.value = text;
  if (el.setSelectionRange) el.setSelectionRange(text.length, text.length);
  el.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
}
typeAmount(amt0, "1500000");
check("разряды разделяются пробелом", amt0.value, "1 500 000");
typeAmount(amt0, "1234,56");
check("дробная часть через запятую", amt0.value, "1 234,56");
typeAmount(amt0, "abc1500000x");
check("лишние символы отбрасываются", amt0.value, "1 500 000");
check("каретка в конце", amt0.selectionStart, 9);
typeAmount(doc.querySelectorAll(".d-amount")[0], "100000");
typeAmount(doc.querySelectorAll(".d-amount")[1], "90000");
doc.getElementById("calculate").click();
check("расчёт по отформатированным суммам", digits(doc.getElementById("r-tax").textContent), "3900");

console.log("\n== 6. Тест 5 (чекбокс «≤1% / эскроу») ==");
r = calcTax(dom, ["5000000", "0"], [{ exempt: true }, RUB]);
check("налог", digits(r.tax), "0");

console.log("\n== 7. Тест 6 (ровно на лимите) ==");
r = calcTax(dom, ["160000", "0"], [null, RUB]);
check("налог", digits(r.tax), "0");

console.log("\n== 8. Изменение ключевой ставки ==");
doc.getElementById("key-rate").value = "20";
r = calcTax(dom, ["100000", "90000"], [RUB, RUB]);
check("лимит при 20%", r.limit, "200 000,00 ₽");
doc.getElementById("key-rate").value = "16";

console.log("\n== 9. Валидация ==");
r = calcTax(dom, ["", "90000"], [null, RUB]);
check("ошибки показаны", r.errors.length > 0, "true");
check("результат скрыт", r.visible, "false");
doc.getElementById("key-rate").value = "999";
r = calcTax(dom, ["100000", "90000"], [RUB, RUB]);
check("ошибка про ставку", r.errors.some((m) => m.includes("100")), "true");
doc.getElementById("key-rate").value = "16";

console.log("\n== 10. Добавление/удаление вклада ==");
doc.getElementById("add-deposit").click();
check("стало 3 вклада", doc.querySelectorAll(".deposit").length, 3);
check("заголовок «Вклад 3»", doc.querySelectorAll(".deposit__title")[2].textContent, "Вклад 3");
doc.querySelectorAll(".deposit")[2].querySelector(".remove-deposit").click();
check("вернулось 2", doc.querySelectorAll(".deposit").length, 2);

console.log("\n== 11. Валюта убрана, суммы в рублях ==");
check("нет выбора валюты", doc.querySelectorAll(".d-currency").length, 0);
check("нет поля курса", doc.querySelectorAll(".d-rate, .d-rate-field").length, 0);
check("подпись про рубли",
  doc.body.textContent.includes("Проценты по вкладам считаются в рублях."), "true");
check("в подписи суммы есть ₽",
  [...doc.querySelectorAll("label")].some((l) => l.textContent.includes("Сумма процентов за год, ₽")), "true");
check("чекбокс эскроу активен и подсказки про валюту нет",
  doc.querySelector(".d-exempt").disabled + "/" +
  (doc.querySelector(".d-exempt-hint") === null), "false/true");

console.log("\n== 12. Сбор лида (демо-режим) ==");
r = calcTax(dom, ["100000", "90000"], [RUB, RUB]);
check("налог перед отправкой", digits(r.tax), "3900");

const leadForm = doc.getElementById("lead-form");
leadForm.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
check("валидация лида сработала", doc.getElementById("lead-errors").hidden, "false");

doc.getElementById("lead-name").value = "Иван Иванов";
doc.getElementById("lead-phone").value = "+7 (999) 123-45-67";
doc.getElementById("lead-consent").checked = true;
leadForm.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
check("форма скрыта после отправки", doc.getElementById("lead-form").hidden, "true");
check("успех показан", doc.getElementById("lead-success").hidden, "false");

const stored = JSON.parse(dom.window.localStorage.getItem("ndfl_leads_demo") || "[]");
check("лид сохранён", stored.length, 1);
check("имя лида", stored[0] && stored[0].name, "Иван Иванов");
check("телефон лида", stored[0] && stored[0].phone, "+7 (999) 123-45-67");
check("налог в лиде", stored[0] && stored[0].calc_result.tax, 3900);
check("лимит в лиде", stored[0] && stored[0].calc_result.limit, 160000);
check("страница лида", stored[0] && stored[0].page, "ndfl-interest-2026");

console.log("\n== 13. Страница заявок leads.html ==");
const leadErrors2 = [];
const dom2 = load("leads.html", null, leadErrors2);
const w2 = dom2.window;
w2.localStorage.setItem("ndfl_leads_demo", JSON.stringify(stored));
w2.eval(fs.readFileSync(PATH + "leads.js", "utf8"));
const doc2 = w2.document;
check("ошибок на странице", leadErrors2.length, 0);
check("строка в таблице", doc2.querySelectorAll("#leads-body tr").length, 1);
check("счётчик", doc2.getElementById("leads-count").textContent, "1");
check("имя в таблице", doc2.querySelector("#leads-body td:nth-child(2)").textContent, "Иван Иванов");
check("налог в таблице", moneyNum(doc2.querySelector("#leads-body td:nth-child(6)").textContent), 3900);
check("пустое состояние скрыто", doc2.getElementById("leads-empty").hidden, "true");

w2.confirm = () => true;
doc2.getElementById("clear-leads").dispatchEvent(new w2.Event("click", { bubbles: true }));
check("после очистки таблица пуста", doc2.querySelectorAll("#leads-body tr").length, 0);
check("пустое состояние показано", doc2.getElementById("leads-empty").hidden, "false");
check("хранилище очищено", w2.localStorage.getItem("ndfl_leads_demo"), "null");

console.log("\n== 14. Ссылки и ресурсы ==");
check("ссылка на leads.html в index.html",
  fs.readFileSync(PATH + "index.html", "utf8").includes("leads.html"), "true");
["index.html", "app.js", "leads.html", "leads.js", "styles.css", "ТЗ.md"].forEach((f) => {
  check("файл существует: " + f, fs.existsSync(PATH + f), "true");
});

console.log("\n== 15. Печать отчёта в отдельном окне ==");
let reportHtml = null;
let printCalled = false;
dom.window.open = function () {
  return {
    document: {
      open() {},
      write(h) { reportHtml = h; },
      close() {},
      title: ""
    },
    focus() {},
    print() { printCalled = true; }
  };
};
doc.getElementById("print-report").click();
check("отчёт сформирован", reportHtml !== null, "true");
if (reportHtml) {
  check("в отчёте лимит", norm(reportHtml).includes("160000,00"), "true");
  check("в отчёте облагаемая сумма", norm(reportHtml).includes("30000,00"), "true");
  check("в отчёте налог", norm(reportHtml).includes("3900₽"), "true");
  check("в отчёте разбивка с Итого", reportHtml.includes("Итого"), "true");
  check("в отчёте срок уплаты", reportHtml.includes("1 декабря 2027 года"), "true");
  check("в отчёте объяснение", reportHtml.includes("Простыми словами"), "true");
  check("в отчёте ключевая ставка", norm(reportHtml).includes("Ключеваяставка16%"), "true");
}

setTimeout(() => {
  check("вызов печати в новом окне", printCalled, "true");
  console.log("\n" + (failures === 0 ? "ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ" : "ПРОВАЛЕНО: " + failures));
  process.exit(failures ? 1 : 0);
}, 700);
