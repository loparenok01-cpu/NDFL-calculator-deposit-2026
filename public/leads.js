"use strict";

/* Страница просмотра сохранённых заявок (демо-режим, localStorage) */

const DEMO_LEADS_KEY = "ndfl_leads_demo";
const DEMO_LEADS_TTL_MS = 72 * 60 * 60 * 1000; // демо-заявки хранятся 72 часа

const moneyFmt = new Intl.NumberFormat("ru-RU", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});
const intFmt = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });

function formatMoney(value) {
  const n = Number(value) || 0;
  return moneyFmt.format(Math.round((n + Number.EPSILON) * 100) / 100) + " \u20BD";
}

function formatInt(value) {
  return intFmt.format(Number(value) || 0) + " \u20BD";
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isLeadFresh(lead, now) {
  if (!lead) return false;
  const ts = Date.parse(lead.created_at);
  return Number.isFinite(ts) && now - ts <= DEMO_LEADS_TTL_MS;
}

function getLeads() {
  try {
    const raw = JSON.parse(localStorage.getItem(DEMO_LEADS_KEY)) || [];
    const now = Date.now();
    const fresh = raw.filter((lead) => isLeadFresh(lead, now));
    if (fresh.length !== raw.length) {
      // физически удаляем просроченные заявки из хранилища
      localStorage.setItem(DEMO_LEADS_KEY, JSON.stringify(fresh));
    }
    return fresh;
  } catch (e) {
    return [];
  }
}

const tbody = document.getElementById("leads-body");
const countEl = document.getElementById("leads-count");
const emptyEl = document.getElementById("leads-empty");
const tableEl = document.getElementById("leads-table");

function render() {
  const leads = getLeads();
  tbody.innerHTML = "";
  countEl.textContent = String(leads.length);
  emptyEl.hidden = leads.length !== 0;
  tableEl.hidden = leads.length === 0;

  leads.forEach((lead) => {
    const c = lead.calc_result || {};
    const when = lead.created_at
      ? new Date(lead.created_at).toLocaleString("ru-RU")
      : "\u2014";

    const tr = document.createElement("tr");
    tr.innerHTML =
      "<td class='num'>" + escapeHtml(when) + "</td>" +
      "<td>" + escapeHtml(lead.name || "") + "</td>" +
      "<td>" + escapeHtml(lead.phone || "") + "</td>" +
      "<td class='num'>" + formatMoney(c.limit) + "</td>" +
      "<td class='num'>" + formatMoney(c.taxable_base) + "</td>" +
      "<td class='num'>" + formatInt(c.tax) + "</td>";
    tbody.appendChild(tr);
  });
}

document.getElementById("clear-leads").addEventListener("click", () => {
  if (!confirm("Удалить все сохранённые заявки?")) return;
  try {
    localStorage.removeItem(DEMO_LEADS_KEY);
  } catch (e) {
    /* ignore */
  }
  render();
});

render();
