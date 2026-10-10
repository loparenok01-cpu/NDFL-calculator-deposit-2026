"use strict";

/* ============================================================
   Калькулятор НДФЛ с процентов по вкладам в 2026 году
   ============================================================ */

const CONFIG = {
  DEFAULT_KEY_RATE: "16,00",
  P1M: 1000000,          // 1 000 000 ₽
  HIGH_THRESHOLD: 2400000, // 2 400 000 ₽
  MAX_AMOUNT: 1e12,        // 1 трлн ₽ — разумный верх суммы процентов за год
  RATE_BASE: 0.13,
  RATE_HIGH: 0.15,
  LEAD_ENDPOINT: "",     // укажите URL эндпоинта; пусто = демо-режим (localStorage)
  DEMO_LEADS_KEY: "ndfl_leads_demo",
  DEMO_LEADS_TTL_MS: 72 * 60 * 60 * 1000 // демо-заявки хранятся 72 часа
};

// Абстрактный пример данных для заполнения формы
const SAMPLE_DEPOSITS = [
  { bank: "Абстрактный банк №1", amount: "100 000", exempt: false },
  { bank: "Абстрактный банк №2", amount: "90 000", exempt: false }
];

/* ---------- Утилиты ---------- */

const $ = (sel, root = document) => root.querySelector(sel);

function parseNum(value) {
  if (value == null) return NaN;
  const clean = String(value).replace(/\s+/g, "").replace(",", ".");
  if (clean === "") return NaN;
  return Number(clean);
}

const moneyFmt = new Intl.NumberFormat("ru-RU", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});
const intFmt = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });

function formatMoney(value) {
  return moneyFmt.format(round2(value)) + " \u20BD";
}

function formatInt(value) {
  return intFmt.format(value) + " \u20BD";
}

function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/* Живое форматирование суммы: разряды разделяются пробелом,
   дробная часть — через запятую. Caret восстанавливается по числу цифр. */
function formatAmountInput(input) {
  input.addEventListener("input", () => {
    const pos0 = input.selectionStart == null ? input.value.length : input.selectionStart;
    const digitsBefore = (input.value.slice(0, pos0).match(/\d/g) || []).length;

    let v = input.value.replace(/[^\d.,]/g, "");
    const sep = v.search(/[.,]/);
    let intPart = sep === -1 ? v : v.slice(0, sep);
    const fracPart = sep === -1 ? null : v.slice(sep + 1).replace(/[.,]/g, "");

    intPart = intPart.replace(/^0+(?=\d)/, "");
    let out = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
    if (fracPart !== null) out += "," + fracPart;

    input.value = out;

    let pos = 0;
    let seen = 0;
    while (pos < out.length && seen < digitsBefore) {
      if (out[pos] >= "0" && out[pos] <= "9") seen += 1;
      pos += 1;
    }
    if (typeof input.setSelectionRange === "function") {
      input.setSelectionRange(pos, pos);
    }
  });
}

/* ---------- Поля ключевой ставки ---------- */

const keyRateInput = $("#key-rate");
const depositsContainer = $("#deposits");
const depositTemplate = $("#deposit-template");
const formErrors = $("#form-errors");
const resultSection = $("#result");
const leadSection = $("#lead");

keyRateInput.value = CONFIG.DEFAULT_KEY_RATE;

/* ---------- Вклады ---------- */

let depositCounter = 0;

function createDepositBlock(data = {}) {
  depositCounter += 1;
  const node = depositTemplate.content.firstElementChild.cloneNode(true);

  node.dataset.index = String(depositCounter);
  $(".deposit__title", node).textContent = "Вклад";

  const bankInput = $(".d-bank", node);
  const amountInput = $(".d-amount", node);
  const exempt = $(".d-exempt", node);

  bankInput.value = data.bank || "";
  amountInput.value = data.amount || "";
  exempt.checked = Boolean(data.exempt);

  formatAmountInput(amountInput);

  $(".remove-deposit", node).addEventListener("click", () => {
    node.remove();
    depositCounter -= 1;
    refreshTitles();
    toggleRemoveButtons();
  });

  return node;
}

function refreshTitles() {
  [...depositsContainer.querySelectorAll(".deposit")].forEach((dep, i) => {
    $(".deposit__title", dep).textContent = "Вклад " + (i + 1);
  });
}

function toggleRemoveButtons() {
  const blocks = depositsContainer.querySelectorAll(".deposit");
  blocks.forEach((dep) => {
    $(".remove-deposit", dep).hidden = blocks.length <= 1;
  });
}

function addDeposit(data) {
  depositsContainer.appendChild(createDepositBlock(data));
  refreshTitles();
  toggleRemoveButtons();
}

$("#add-deposit").addEventListener("click", () => addDeposit());

/* ---------- Инициализация абстрактным примером ---------- */

SAMPLE_DEPOSITS.forEach((d) => addDeposit(d));

/* ---------- Валидация ---------- */

function markInvalid(el, invalid) {
  el.classList.toggle("invalid", invalid);
}

function clearErrors() {
  formErrors.hidden = true;
  formErrors.innerHTML = "";
  document.querySelectorAll(".invalid").forEach((el) => el.classList.remove("invalid"));
}

function showErrors(messages) {
  formErrors.innerHTML =
    "<ul>" + messages.map((m) => "<li>" + m + "</li>").join("") + "</ul>";
  formErrors.hidden = false;
}

/* ---------- Расчёт ---------- */

function collectDeposits() {
  const blocks = [...depositsContainer.querySelectorAll(".deposit")];
  return blocks.map((block, i) => {
    const amountRaw = $(".d-amount", block).value;
    const exempt = $(".d-exempt", block).checked;
    return {
      index: i + 1,
      bank: $(".d-bank", block).value.trim() || "Вклад " + (i + 1),
      amountRaw,
      exempt,
      amount: parseNum(amountRaw)
    };
  });
}

function validate(K, deposits) {
  const messages = [];
  const keys = [];

  if (isNaN(K) || !isFinite(K) || K <= 0 || K > 100) {
    markInvalid(keyRateInput, true);
    messages.push("Ставка должна быть больше 0 и не больше 100.");
  } else {
    markInvalid(keyRateInput, false);
  }

  if (deposits.length === 0) {
    messages.push("Добавьте хотя бы один вклад.");
  }

  const blocks = [...depositsContainer.querySelectorAll(".deposit")];

  deposits.forEach((dep, i) => {
    const block = blocks[i];
    const amountInput = $(".d-amount", block);

    if (isNaN(dep.amount) || dep.amount < 0) {
      markInvalid(amountInput, true);
      messages.push("Вклад " + dep.index + ": введите неотрицательное число процентов.");
      keys.push("amount" + i);
    } else if (!isFinite(dep.amount) || dep.amount > CONFIG.MAX_AMOUNT) {
      markInvalid(amountInput, true);
      messages.push(
        "Вклад " + dep.index + ": сумма не должна превышать " +
        intFmt.format(CONFIG.MAX_AMOUNT) + " \u20BD."
      );
      keys.push("amount" + i);
    } else {
      markInvalid(amountInput, false);
    }
  });

  return { valid: messages.length === 0, messages };
}

function compute(K, deposits) {
  const limit = CONFIG.P1M * (K / 100);

  const rows = deposits.map((dep) => {
    let gross = dep.amount;
    if (isNaN(gross)) gross = 0;
    return { ...dep, rub_gross: gross, rub: dep.exempt ? 0 : gross };
  });

  const totalGrossRub = rows.reduce((sum, r) => sum + r.rub_gross, 0);
  const totalTaxable = rows.reduce((sum, r) => sum + r.rub, 0);
  const base = Math.max(0, totalTaxable - limit);

  let tax;
  if (base <= CONFIG.HIGH_THRESHOLD) {
    tax = base * CONFIG.RATE_BASE;
  } else {
    tax = CONFIG.HIGH_THRESHOLD * CONFIG.RATE_BASE +
      (base - CONFIG.HIGH_THRESHOLD) * CONFIG.RATE_HIGH;
  }
  tax = Math.round(tax); // итог округляем до целого рубля

  // суммы налога по ставкам (для отображения)
  const tax13 = Math.round(Math.min(base, CONFIG.HIGH_THRESHOLD) * CONFIG.RATE_BASE);
  const tax15 = tax - tax13;

  // разбивка налога пропорционально облагаемым процентам
  const taxableRows = rows.filter((r) => r.rub > 0);
  taxableRows.forEach((r) => {
    r.tax = totalTaxable > 0 ? round2(tax * (r.rub / totalTaxable)) : 0;
  });
  if (taxableRows.length > 0) {
    const allocated = taxableRows.reduce((s, r) => s + r.tax, 0);
    const diff = round2(tax - allocated);
    taxableRows[taxableRows.length - 1].tax = round2(
      taxableRows[taxableRows.length - 1].tax + diff
    );
  }
  rows.forEach((r) => {
    if (r.tax == null) r.tax = 0;
  });

  return { limit, rows, totalGrossRub, totalTaxable, base, tax, tax13, tax15 };
}

/* ---------- Рендер результата ---------- */

function renderResult(K, calc) {
  $("#r-limit").textContent = formatMoney(calc.limit);
  $("#r-limit-note").textContent =
    "1 000 000 \u20BD \u00D7 ключевая ставка " + numToRu(K) +
    " % — эта сумма процентов налогом не облагается.";
  $("#r-base").textContent = formatMoney(calc.base);
  $("#r-base-note").textContent =
    "Ваши проценты за год (" + formatMoney(calc.totalTaxable) +
    ") минус необлагаемый лимит.";
  $("#r-tax").textContent = formatInt(calc.tax);
  $("#r-tax-note").textContent =
    calc.tax > 0 ? "К уплате по уведомлению ФНС" : "Налог не начисляется";

  const split = $("#r-tax-split");
  if (calc.tax === 0) {
    split.innerHTML = "";
  } else if (calc.tax15 > 0) {
    split.innerHTML =
      '<span class="split-chip">13 % — ' + formatInt(calc.tax13) + "</span>" +
      '<span class="split-chip">15 % — ' + formatInt(calc.tax15) + "</span>";
  } else {
    split.innerHTML = '<span class="split-chip">Ставка 13 %</span>';
  }

  const tbody = $("#r-breakdown");
  const totalRow = tbody.querySelector("tr.is-total");
  [...tbody.querySelectorAll("tr:not(.is-total)")].forEach((tr) => tr.remove());

  calc.rows.forEach((r) => {
    const note = r.exempt ? "не облагается" : "";
    const gross = formatMoney(r.amount);

    const tr = document.createElement("tr");
    tr.innerHTML =
      "<td>" + escapeHtml(r.bank) +
      (note ? "<div class='row-note'>" + escapeHtml(note) + "</div>" : "") +
      "</td>" +
      "<td class='num'>" + gross + "</td>" +
      "<td class='num'>" + formatMoney(r.rub) + "</td>" +
      "<td class='num'>" + (r.rub > 0 ? formatMoney(r.tax) : "\u2014") + "</td>";
    tbody.insertBefore(tr, totalRow);
  });

  $("#r-total-gross").textContent = formatMoney(calc.totalGrossRub);
  $("#r-taxable-interest").textContent = formatMoney(calc.totalTaxable);
  $("#r-total-tax").textContent = formatInt(calc.tax);

  renderExplanation(K, calc);
}

function renderExplanation(K, calc) {
  const box = $("#r-explanation");
  let html = "";

  if (calc.base === 0) {
    html =
      "<p>Ваш доход по процентам за год (" + formatMoney(calc.totalTaxable) +
      ") не превысил необлагаемый лимит (" + formatMoney(calc.limit) +
      "), поэтому налог платить не нужно.</p>" +
      "<p>Лимит рассчитан как 1 000 000 \u20BD \u00D7 " + numToRu(K) + " %.</p>";
  } else if (calc.base <= CONFIG.HIGH_THRESHOLD) {
    html =
      "<p>Государство не облагает налогом проценты в пределах лимита " +
      formatMoney(calc.limit) + " (1 000 000 \u20BD \u00D7 " + numToRu(K) + " %). " +
      "Всё, что выше лимита, — это облагаемая сумма " + formatMoney(calc.base) +
      ". С неё налог 13 % = <strong>" + formatInt(calc.tax) + "</strong>.</p>" +
      "<p>Вклады со ставкой \u2264 1 % годовых и счета эскроу в расчёт не входят.</p>";
  } else {
    const highPart = calc.base - CONFIG.HIGH_THRESHOLD;
    html =
      "<p>Необлагаемый лимит — " + formatMoney(calc.limit) + ". Ваша облагаемая сумма " +
      formatMoney(calc.base) + " превысила 2 400 000 \u20BD. С первых 2 400 000 \u20BD налог 13 % " +
      "(= " + formatMoney(CONFIG.HIGH_THRESHOLD * CONFIG.RATE_BASE) + "), с превышения (" +
      formatMoney(highPart) + ") — 15 %. Итого налог <strong>" + formatInt(calc.tax) + "</strong>.</p>";
  }

  box.innerHTML = html;
}

function numToRu(n) {
  return (Math.round(n * 100) / 100).toString().replace(".", ",");
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* ---------- Кнопка «Рассчитать» ---------- */

$("#calculate").addEventListener("click", () => {
  clearErrors();
  const K = parseNum(keyRateInput.value);
  const deposits = collectDeposits();
  const check = validate(K, deposits);

  if (!check.valid) {
    showErrors(check.messages);
    resultSection.hidden = true;
    leadSection.hidden = true;
    return;
  }

  const calc = compute(K, deposits);
  renderResult(K, calc);
  lastCalc = { K: K, calc: calc };

  resultSection.hidden = false;
  leadSection.hidden = false;
  resultSection.scrollIntoView({ behavior: "smooth", block: "start" });
});

/* ---------- Печать отчёта ---------- */

let lastCalc = null;

$("#print-report").addEventListener("click", () => {
  if (!lastCalc) return;
  printReport(lastCalc.K, lastCalc.calc);
});

function printReport(K, calc) {
  const rowsHtml = calc.rows
    .map((r) => {
      const gross = formatMoney(r.amount);
      const counted = r.rub > 0 ? formatMoney(r.rub) : "\u2014";
      const taxCell = r.rub > 0 ? formatMoney(r.tax) : "\u2014";
      return (
        "<tr><td>" + escapeHtml(r.bank) + "</td>" +
        "<td>" + gross + "</td>" +
        "<td>" + counted + "</td>" +
        "<td>" + taxCell + "</td></tr>"
      );
    })
    .join("");

  const ratesLine =
    calc.tax15 > 0
      ? "Ставка 13 % — " + formatMoney(calc.tax13) +
        "; ставка 15 % — " + formatMoney(calc.tax15)
      : "Ставка 13 %";

  const html =
    "<!DOCTYPE html><html lang='ru'><head><meta charset='utf-8'>" +
    "<title>Расчёт НДФЛ с процентов по вкладам за 2026 год</title>" +
    "<style>" +
    "body{font-family:Arial,sans-serif;color:#3b4a3e;margin:24px;max-width:760px}" +
    "h1{font-size:20px;margin:0 0 4px;color:#2f7a3e}" +
    "h2{color:#2f7a3e}" +
    ".meta{color:#7c8b7e;font-size:13px;margin-bottom:16px}" +
    "table{width:100%;border-collapse:collapse;margin:12px 0 20px}" +
    "td,th{border-bottom:1px solid #e3ebd7;padding:8px 10px;text-align:left;font-size:14px}" +
    "th{color:#7c8b7e;font-weight:500;background:#f2f9ea}" +
    "tr.total td{font-weight:700;border-top:2px solid #e3ebd7;background:#f2f9ea;color:#2f7a3e}" +
    ".figures td:first-child{color:#7c8b7e}" +
    ".tax{font-size:18px;font-weight:700}" +
    ".note{font-size:12px;color:#7c8b7e}" +
    "@media print{body{margin:10mm}}" +
    "</style></head><body>" +
    "<h1>Расчёт НДФЛ с процентов по вкладам за 2026 год</h1>" +
    "<div class='meta'>Ключевая ставка " + numToRu(K) +
    " % · подготовлено калькулятором бухгалтерской компании</div>" +
    "<table class='figures'>" +
    "<tr><td>Необлагаемый лимит</td><td>" + formatMoney(calc.limit) + "</td></tr>" +
    "<tr><td>Облагаемые проценты за год</td><td>" + formatMoney(calc.totalTaxable) + "</td></tr>" +
    "<tr><td>Облагаемая сумма</td><td>" + formatMoney(calc.base) + "</td></tr>" +
    "<tr class='total'><td>Налог к уплате</td><td class='tax'>" + formatInt(calc.tax) +
    " <span class='note'>(" + ratesLine + ")</span></td></tr>" +
    "</table>" +
    "<h2 style='font-size:16px'>Разбивка по вкладам</h2>" +
    "<table><tr><th>Вклад</th><th>Проценты за год</th><th>Учтено в расчёте</th><th>Налог по вкладу</th></tr>" +
    rowsHtml +
    "<tr class='total'><td>Итого</td><td>" + formatMoney(calc.totalGrossRub) +
    "</td><td>" + formatMoney(calc.totalTaxable) + "</td><td>" + formatInt(calc.tax) + "</td></tr>" +
    "</table>" +
    "<h2 style='font-size:16px'>Простыми словами</h2>" +
    $("#r-explanation").innerHTML +
    "<h2 style='font-size:16px'>Когда платить?</h2>" +
    "<p>Налог платится по уведомлению ФНС — не позднее 1 декабря года, следующего за отчётным. " +
    "Налог за проценты 2026 года — до 1 декабря 2027 года. Налог рассчитывает сама ФНС и " +
    "присылает уведомление в личный кабинет; подавать декларацию по вкладам не нужно.</p>" +
    "<p class='note'>Документ носит информационный характер и не является налоговым уведомлением ФНС.</p>" +
    "</body></html>";

  const win = window.open("", "_blank");
  if (!win) return;
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(function () {
    win.print();
  }, 300);
}

/* ---------- Сбор лида ---------- */

const leadForm = $("#lead-form");
const leadName = $("#lead-name");
const leadPhone = $("#lead-phone");
const leadConsent = $("#lead-consent");
const leadErrors = $("#lead-errors");
const leadSuccess = $("#lead-success");
const leadSubmit = $("#lead-submit");

leadPhone.addEventListener("input", () => {
  const digits = leadPhone.value.replace(/\D/g, "").replace(/^8/, "7").slice(0, 11);
  leadPhone.value = formatPhone(digits);
});

function formatPhone(digits) {
  if (!digits) return "";
  let out = "+7";
  if (digits.length > 1) out += " (" + digits.slice(1, 4);
  if (digits.length >= 5) out += ") " + digits.slice(4, 7);
  if (digits.length >= 8) out += "-" + digits.slice(7, 9);
  if (digits.length >= 10) out += "-" + digits.slice(9, 11);
  return out;
}

leadForm.addEventListener("submit", (e) => {
  e.preventDefault();
  leadErrors.hidden = true;
  leadErrors.innerHTML = "";

  const name = leadName.value.trim();
  const digits = leadPhone.value.replace(/\D/g, "");
  const errors = [];

  if (name.length < 2 || name.length > 50) {
    leadName.classList.add("invalid");
    errors.push("Укажите имя (от 2 до 50 символов).");
  } else {
    leadName.classList.remove("invalid");
  }

  if (digits.length !== 11) {
    leadPhone.classList.add("invalid");
    errors.push("Укажите телефон в формате +7 (___) ___-__-__.");
  } else {
    leadPhone.classList.remove("invalid");
  }

  if (!leadConsent.checked) {
    errors.push("Нужно согласие на обработку персональных данных.");
  }

  if (errors.length) {
    leadErrors.innerHTML = "<ul>" + errors.map((m) => "<li>" + m + "</li>").join("") + "</ul>";
    leadErrors.hidden = false;
    return;
  }

  const payload = {
    name: name,
    phone: leadPhone.value,
    calc_result: {
      limit: round2(parseNum($("#r-limit").textContent.replace(/[^\d,.-]/g, "").replace(",", "."))),
      taxable_base: round2(parseNum($("#r-base").textContent.replace(/[^\d,.-]/g, "").replace(",", "."))),
      tax: parseNum($("#r-tax").textContent.replace(/[^\d,.-]/g, ""))
    },
    page: "ndfl-interest-2026",
    created_at: new Date().toISOString()
  };

  leadSubmit.disabled = true;

  if (!CONFIG.LEAD_ENDPOINT) {
    // демо-режим: эндпоинт не задан, сохраняем заявку локально
    if (saveDemoLead(payload)) {
      onLeadSuccess();
    } else {
      leadSubmit.disabled = false;
      leadErrors.innerHTML = "<ul><li>Не удалось сохранить заявку на этом устройстве. Освободите место в браузере и попробуйте ещё раз или позвоните нам.</li></ul>";
      leadErrors.hidden = false;
    }
    return;
  }

  fetch(CONFIG.LEAD_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  })
    .then((res) => {
      if (!res.ok) throw new Error("bad status");
      onLeadSuccess();
    })
    .catch(() => {
      leadSubmit.disabled = false;
      leadErrors.innerHTML = "<ul><li>Не удалось отправить. Попробуйте ещё раз или позвоните нам.</li></ul>";
      leadErrors.hidden = false;
    });
});

function onLeadSuccess() {
  leadForm.hidden = true;
  leadSuccess.hidden = false;
}

/* ---------- Сохранение заявок (демо, localStorage) ---------- */

function isLeadFresh(lead, now) {
  if (!lead) return false;
  const ts = Date.parse(lead.created_at);
  return Number.isFinite(ts) && now - ts <= CONFIG.DEMO_LEADS_TTL_MS;
}

function getDemoLeads() {
  try {
    const leads = JSON.parse(localStorage.getItem(CONFIG.DEMO_LEADS_KEY)) || [];
    const now = Date.now();
    return leads.filter((lead) => isLeadFresh(lead, now));
  } catch (e) {
    return [];
  }
}

function saveDemoLead(payload) {
  try {
    const leads = getDemoLeads();
    leads.unshift(payload);
    localStorage.setItem(CONFIG.DEMO_LEADS_KEY, JSON.stringify(leads));
    return true;
  } catch (e) {
    console.error("Не удалось сохранить заявку (localStorage):", e);
    return false;
  }
}

