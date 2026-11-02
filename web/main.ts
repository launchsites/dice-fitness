import "./style.css";
import { Dice } from "./dice.js";
import { observeViewport } from "./viewport.js";
import type { Assignment, HistoryPage, Roll, State } from "./types.js";
import { dayInZone, emptyRange, historyQuery, rangeLabel, relativeDay, shortDay, type HistoryRange } from "./history.js";
import { avatarMarkup, hydrateAvatars } from "./avatars.js";

const root = document.querySelector<HTMLDivElement>("#app")!;
const telegram = window.Telegram?.WebApp;
const preview = new URLSearchParams(location.search).get("demo") === "1";
observeViewport(telegram);
let state: State;
let tab: "roll" | "owed" = "roll";
let activityTab: "owed" | "history" = "owed";
let historyPlayer = 0;
let historyRange = emptyRange();
let rangeDraft: HistoryRange | null = null;
let historyPage: HistoryPage = { entries: [], nextCursor: null };
let historyLoaded = false;
let historyScrollTop = 0;
let targetId = Number(sessionStorage.getItem("dice-target")) || 0;
let filters: string[] = [];
let excludedExercises: string[] = [];
let exercisePickerOpen = false;
let roll: Roll | null = null;
let result: Assignment | null = null;
let requestId: string | null = sessionStorage.getItem("dice-request");
let busy = false;
let error = "";
let notice = "";
let modal: "injury" | "dismiss" | "entry" | "dates" | null = null;
let entryDraft: { id: string; targetPlayerId: number; exerciseKey: string; amount: string; measurement: "reps" | "seconds"; attempted: boolean } | null = null;
let dismissedId = 0;
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
let dice: Dice | undefined;
let diceSignature = "";

const escape = (value: unknown) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!));
const amount = (value: { amount: number; measurement: string }) => value.measurement === "reps" ? `${value.amount} reps` : `${value.amount}s`;
const exerciseOf = (key: string) => state.exercises.find((exercise) => exercise.key === key)!;
const eligible = (chosen = filters, manual = excludedExercises) => state.exercises.filter((exercise) => !manual.includes(exercise.key) && !state.injuries.some((filter) => chosen.includes(filter.key) && (filter.excludes as readonly string[]).includes(exercise.key)));
const haptic = (style = "light") => telegram?.HapticFeedback?.impactOccurred(style);
const icon = (name: "dice" | "owed" | "check" | "chevron" | "close" | "refresh" | "undo" | "calendar") => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${{
  dice: '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M8 8h.01M16 8h.01M12 12h.01M8 16h.01M16 16h.01" stroke-width="3"/>',
  owed: '<path d="m4 7 1.5 1.5L8 6m-4 9 1.5 1.5L8 14M12 7h8m-8 8h8"/>',
  check: '<path d="m6 12 4 4 8-8"/>',
  chevron: '<path d="m8 10 4 4 4-4"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.1 6.1A8 8 0 0 1 20 12M4 12a8 8 0 0 0 13.9 5.9"/>',
  undo: '<path d="M4 4v6h6"/><path d="M4 10a8 8 0 1 1 2.1 7.9"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18"/>',
}[name]}</svg>`;

async function api<T>(path: string, body?: Record<string, unknown>): Promise<T> {
  if (preview) return (await (await import("./demo.js")).demoRequest(path, body)) as T;
  const response = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `tma ${telegram?.initData || ""}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || "Could not connect. Try again.");
  return value as T;
}

async function load() {
  state = await api<State>("/api/state");
  if (!state.players.some((player) => player.id === targetId && player.active)) targetId = state.players.find((player) => player.active && player.id !== state.me.id)?.id ?? state.me.id;
  roll = state.pending;
  if (roll) { targetId = roll.targetPlayerId; filters = []; excludedExercises = []; }
  if (!roll) { requestId = null; sessionStorage.removeItem("dice-request"); }
}

async function loadHistory(append = false) {
  const page = await api<HistoryPage>(`/api/history?${historyQuery(historyPlayer, historyRange, state.timezone, append ? historyPage.nextCursor : null)}`);
  historyPage = append ? { ...page, entries: [...historyPage.entries, ...page.entries.filter((row) => !historyPage.entries.some((old) => old.id === row.id))] } : page;
  historyLoaded = true;
}
function resetHistory() {
  historyPage = { entries: [], nextCursor: null }; historyLoaded = false; historyScrollTop = 0;
  const scroller = document.querySelector(".history-scroll"); if (scroller) scroller.scrollTop = 0;
}
async function reloadActivity() {
  await load();
  if (tab === "owed" && activityTab === "history") await loadHistory();
}

function historyView() {
  const days = new Map<string, Assignment[]>();
  for (const row of historyPage.entries) {
    const day = dayInZone(row.completedAt!, state.timezone);
    const entries = days.get(day) ?? []; entries.push(row); days.set(day, entries);
  }
  const rows = [...days].map(([day, entries]) => {
    const title = day === relativeDay(state.timezone) ? "Today" : day === relativeDay(state.timezone, -1) ? "Yesterday" : shortDay(day);
    const cards = entries.map((row) => {
      const person = state.players.find((player) => player.id === row.targetPlayerId), name = person?.name ?? "Former player";
      const time = new Intl.DateTimeFormat("en-GB", { timeZone: state.timezone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(row.completedAt!));
      return `<article class="history-item" data-assignment="${row.id}"><div class="history-item-top"><div class="history-person-name">${avatarMarkup(row.targetPlayerId, name)}<span>${escape(name)}</span></div><time datetime="${escape(row.completedAt)}">${time}</time></div><div class="history-item-main"><div><strong>${escape(exerciseOf(row.exerciseKey).name)}</strong><span>${escape(amount(row))}${row.entryType === "manual" ? " · Added manually" : ""}</span></div></div></article>`;
    }).join("");
    return `<section class="history-day-group" aria-labelledby="day-${day}" data-day="${day}"><h2 class="history-day" id="day-${day}"><span>${escape(title)}</span></h2>${cards}</section>`;
  }).join("");
  return `<div class="history-filters"><div class="history-person select-wrap"><label class="sr-only" for="history-person">Filter by person</label><select id="history-person" ${busy ? "disabled" : ""}><option value="0">Everyone</option>${state.players.map((player) => `<option value="${player.id}" ${player.id === historyPlayer ? "selected" : ""}>${escape(player.name)}</option>`).join("")}</select>${icon("chevron")}</div><button class="history-date ${historyRange.mode !== "all" ? "filter-active" : ""}" data-action="history-dates" aria-label="Filter by date: ${escape(rangeLabel(historyRange))}" ${busy ? "disabled" : ""}>${icon("calendar")}<span>${escape(rangeLabel(historyRange))}</span></button></div>
    ${historyPlayer || historyRange.mode !== "all" ? `<div class="history-filter-summary"><span>${escape(historyRange.mode === "custom" ? `${historyRange.from ? shortDay(historyRange.from) + (historyRange.withTimes ? ` ${historyRange.fromTime}` : "") : "Any start"} – ${historyRange.to ? shortDay(historyRange.to) + (historyRange.withTimes ? ` ${historyRange.toTime}` : "") : "Any end"}` : "Filtered history")}</span><button data-action="history-clear" ${busy ? "disabled" : ""}>Reset</button></div>` : ""}
    <div class="history-scroll" aria-busy="${busy}">${!historyLoaded ? `<div class="history-empty" role="status">${error ? "Couldn’t load history. Tap refresh to retry." : "Loading history…"}</div>` : rows || `<div class="history-empty"><span class="empty-check">${icon("check")}</span><strong>${historyPlayer || historyRange.mode !== "all" ? "No matches" : "No completed exercises yet"}</strong><p>${historyPlayer || historyRange.mode !== "all" ? "Try another person or date." : "Completed exercises will appear here."}</p></div>`}${historyPage.nextCursor ? `<button class="history-more" data-action="history-more" ${busy ? "disabled" : ""}>${busy ? "Loading…" : "Load earlier"}</button>` : ""}</div>`;
}

function activityView() {
  return `<section class="owed-page" aria-label="Activity"><header class="activity-toolbar"><div class="activity-tabs" role="group" aria-label="Activity view"><button data-action="show-owed" aria-pressed="${activityTab === "owed"}" ${busy ? "disabled" : ""}>Owed</button><button data-action="show-history" aria-pressed="${activityTab === "history"}" ${busy ? "disabled" : ""}>History</button></div><button class="icon-button" data-action="refresh" aria-label="Refresh ${activityTab === "history" ? "history" : "owed exercises"}" ${busy ? "disabled" : ""}>${icon("refresh")}</button></header>${activityTab === "owed" ? owedView() : historyView()}</section>`;
}

function datesModal() {
  const draft = rangeDraft!;
  return `<div class="modal-backdrop" data-backdrop></div><dialog open aria-modal="true" aria-labelledby="dates-title" class="sheet"><header class="sheet-top"><div><h2 id="dates-title">Completed when?</h2><p>Times in ${escape(state.timezone)}</p></div><button class="icon-button" data-action="close-modal" aria-label="Cancel date filter">${icon("close")}</button></header><div class="sheet-scroll"><form id="history-dates" class="date-fields"><div class="date-presets" role="group" aria-label="Date shortcuts">${([['all', 'All dates'], ['today', 'Today'], ['yesterday', 'Yesterday']] as const).map(([mode, label]) => `<button type="button" data-action="date-preset" data-mode="${mode}" aria-pressed="${draft.mode === mode}">${label}</button>`).join("")}</div><div class="date-range-fields"><label>From<input id="history-from" type="date" value="${escape(draft.from)}"></label><label>To<input id="history-to" type="date" value="${escape(draft.to)}"></label></div><label class="time-toggle"><span>Include times</span><input id="history-times" type="checkbox" ${draft.withTimes ? "checked" : ""}></label>${draft.withTimes ? `<div class="date-range-fields"><label>Start time<input id="history-from-time" type="time" value="${escape(draft.fromTime)}" required></label><label>End time<input id="history-to-time" type="time" value="${escape(draft.toTime)}" required></label></div>` : ""}${error ? `<p class="entry-error" role="alert">${escape(error)}</p>` : ""}</form></div><footer class="sheet-footer"><button class="primary" type="submit" form="history-dates" ${busy ? "disabled" : ""}>${busy ? "Loading…" : "Apply filter"}</button></footer></dialog>`;
}

function rollView() {
  const exercise = roll ? exerciseOf(roll.exerciseKey) : result ? exerciseOf(result.exerciseKey) : null;
  const chosenFilters = roll?.injuryFilters ?? filters;
  const chosenExercises = roll?.exerciseExclusions ?? excludedExercises;
  const filterLabel = [...state.injuries.filter((item) => chosenFilters.includes(item.key)).map((item) => item.name), ...(chosenExercises.length ? [`${chosenExercises.length} exercises`] : [])].join(", ") || "None";
  const locked = busy || !!roll;
  return `<section class="roll-page" aria-label="Dice rolls">
    <div class="roll-controls">
      <div class="player-control"><label for="target">Rolling for</label><div class="select-wrap"><select id="target" ${locked ? "disabled" : ""}>${state.players.filter((player) => player.active || player.id === targetId).map((player) => `<option value="${player.id}" ${player.id === targetId ? "selected" : ""}>${escape(player.name)}${player.id === state.me.id ? " (you)" : ""}</option>`).join("")}</select>${icon("chevron")}</div></div>
      <button class="injury-control ${chosenFilters.length || chosenExercises.length ? "filter-on" : ""}" data-action="injury" ${locked ? "disabled" : ""} aria-haspopup="dialog"><span class="control-label">Injury</span><span class="control-value"><span>${escape(filterLabel)}</span>${icon("chevron")}</span></button>
    </div>
    <div class="dice-area">
      <div class="roll-result" role="status">${exercise ? `<span>${escape(exercise.name)}</span>${result ? `<strong>${escape(amount(result))}<span class="saved-check" aria-label="Saved">${icon("check")}</span></strong>` : `<small>Roll for reps or time</small>`}` : ""}</div>
      <div class="dice-stage" id="dice-stage" role="img" aria-label="${escape(exercise ? `${exercise.name}${result ? `, ${amount(result)}` : ", amount dice"}` : "Activity dice")}"></div>
    </div>
    <button class="primary roll-button" data-action="${roll ? "amount" : "activity"}" ${busy || (!roll && !eligible().length) ? "disabled" : ""}>${busy ? "Rolling…" : roll ? "Roll amount" : result ? "Roll again" : "Roll"}</button>
  </section>`;
}

function owedView() {
  const players = state.players.filter((player) => player.active || player.owed.length);
  return `<div class="owed-scroll" aria-label="Owed exercises">${players.map((player) => `<section class="player-owed" aria-labelledby="player-${player.id}"><div class="owed-person-heading"><h2 id="player-${player.id}">${escape(player.name)}<span>${player.owed.length}</span></h2>${player.active ? `<button class="add-exercise-button" data-action="add-entry" data-target="${player.id}" aria-label="Add exercise for ${escape(player.name)}" ${busy ? "disabled" : ""}>+ Add</button>` : ""}</div>${player.owed.length ? `<ul class="owed-list">${player.owed.map((row) => `<li class="owed-item" data-assignment="${row.id}"><div class="owed-description"><strong>${escape(exerciseOf(row.exerciseKey).name)}</strong><span>${escape(amount(row))}${row.entryType === "manual" ? " · Added manually" : ""}</span></div><div class="owed-actions"><button class="dismiss-button" data-action="dismiss" data-assignment="${row.id}" aria-label="${row.entryType === "roll" ? "Undo roll" : "Remove exercise"}: ${escape(exerciseOf(row.exerciseKey).name)}, ${escape(amount(row))}, for ${escape(player.name)}" title="Remove exercise" ${busy ? "disabled" : ""}>${icon("undo")}</button><button class="complete-button" data-action="complete" data-target="${player.id}" data-assignment="${row.id}" aria-label="Complete ${escape(exerciseOf(row.exerciseKey).name)}, ${escape(amount(row))}, for ${escape(player.name)}" title="Complete" ${busy ? "disabled" : ""}>${icon("check")}</button></div></li>`).join("")}</ul>` : `<p class="all-done">${icon("check")} All done</p>`}</section>`).join("")}</div>`;
}

function dismissModal() {
  const player = state.players.find((item) => item.owed.some((row) => row.id === dismissedId));
  const row = player?.owed.find((item) => item.id === dismissedId);
  const manual = row?.entryType !== "roll";
  return `<div class="modal-backdrop" data-backdrop></div><dialog open aria-modal="true" aria-labelledby="dismiss-title" class="sheet dismiss-sheet"><header class="sheet-top"><h2 id="dismiss-title">${manual ? "Remove this exercise?" : "Undo this roll?"}</h2><button class="icon-button" data-action="close-modal" aria-label="Cancel undo">${icon("close")}</button></header><div class="dismiss-copy"><p>${row ? `${escape(player!.name)} · ${escape(exerciseOf(row.exerciseKey).name)} · ${escape(amount(row))}` : "This exercise is no longer owed."}</p><small>Removed from owed. No completion credit.</small></div><footer class="sheet-footer"><button class="primary destructive" data-action="do-dismiss" ${!row || busy ? "disabled" : ""}>${manual ? "Remove exercise" : "Undo roll"}</button><button class="cancel-button" data-action="close-modal">Cancel</button></footer></dialog>`;
}

function injuryModal() {
  const remaining = eligible().length;
  return `<div class="modal-backdrop" data-backdrop></div><dialog open aria-modal="true" aria-labelledby="injury-title" class="sheet"><header class="sheet-top"><div><h2 id="injury-title">Injury</h2><p>This roll only</p></div><button class="icon-button" data-action="close-modal" aria-label="Close injury filters">${icon("close")}</button></header><div class="sheet-scroll"><div class="injury-list">${state.injuries.map((injury) => `<label class="injury-option"><span><strong>${escape(injury.name)}</strong><small>${escape(injury.detail)}</small></span><input type="checkbox" value="${injury.key}" ${filters.includes(injury.key) ? "checked" : ""}></label>`).join("")}</div><button class="exercise-picker-toggle" data-action="toggle-exercises" aria-expanded="${exercisePickerOpen}">Exclude exercises <span>${excludedExercises.length || ""}</span>${icon("chevron")}</button>${exercisePickerOpen ? `<div class="injury-list">${state.exercises.map((exercise) => `<label class="injury-option exercise-option"><span><strong>${escape(exercise.name)}</strong></span><input type="checkbox" data-kind="exercise" value="${exercise.key}" ${excludedExercises.includes(exercise.key) ? "checked" : ""}></label>`).join("")}</div>` : ""}<p class="health-note">Skip anything that hurts.</p></div><footer class="sheet-footer"><p class="filter-summary ${remaining ? "" : "warning"}" role="status">${remaining ? `${remaining} activities available` : "No activities left. Remove a filter."}</p><button class="primary" data-action="close-modal">Done</button></footer></dialog>`;
}

function entryModal() {
  const draft = entryDraft!, exercise = exerciseOf(draft.exerciseKey);
  const player = state.players.find((item) => item.id === draft.targetPlayerId)!;
  return `<div class="modal-backdrop" data-backdrop></div><dialog open aria-modal="true" aria-labelledby="entry-title" class="sheet"><header class="sheet-top"><div><h2 id="entry-title">Add exercise</h2><p>${escape(player.name)}</p></div><button class="icon-button" data-action="close-modal" aria-label="Close Add exercise" ${busy ? "disabled" : ""}>${icon("close")}</button></header><div class="sheet-scroll"><form id="manual-entry" class="entry-fields"><label for="entry-exercise">Exercise</label><select id="entry-exercise" ${busy ? "disabled" : ""}>${state.exercises.map((item) => `<option value="${item.key}" ${item.key === draft.exerciseKey ? "selected" : ""}>${escape(item.name)}</option>`).join("")}</select><div class="entry-presets">${exercise.options.map((option, i) => `<button type="button" data-action="entry-preset" data-index="${i}" ${busy ? "disabled" : ""}>${escape(amount(option))}</button>`).join("")}</div><div class="entry-quantity"><div><label for="entry-amount">Amount</label><input id="entry-amount" type="number" inputmode="numeric" min="1" max="10000" step="1" required value="${escape(draft.amount)}" ${busy ? "disabled" : ""}></div><div><label for="entry-measurement">Unit</label><select id="entry-measurement" ${busy ? "disabled" : ""}><option value="reps" ${draft.measurement === "reps" ? "selected" : ""}>Reps</option><option value="seconds" ${draft.measurement === "seconds" ? "selected" : ""}>Seconds</option></select></div></div>${error ? `<p class="entry-error" role="alert">${escape(error)}</p>` : ""}</form></div><footer class="sheet-footer"><button class="primary" type="submit" form="manual-entry" ${busy ? "disabled" : ""}>${busy ? "Adding…" : "Add to owed"}</button></footer></dialog>`;
}

function render() {
  const scrollTop = document.querySelector(".owed-scroll")?.scrollTop ?? 0;
  const sheetScrollTop = document.querySelector(".sheet-scroll")?.scrollTop ?? 0;
  historyScrollTop = document.querySelector(".history-scroll")?.scrollTop ?? historyScrollTop;
  const focused = document.activeElement as HTMLInputElement | null;
  const focusedFilter = modal && focused?.type === "checkbox" ? focused.value : null;
  const focusedId = focused?.id;
  root.innerHTML = `${preview ? `<div class="preview-banner">Preview · sample data</div>` : ""}<main>${tab === "roll" ? rollView() : activityView()}</main><nav class="bottom-nav" aria-label="Game screens">${(["roll", "owed"] as const).map((name) => `<button data-action="${name}" aria-current="${tab === name ? "page" : "false"}" ${busy ? "disabled" : ""}>${icon(name === "roll" ? "dice" : "owed")}<span>${name === "roll" ? "Roll" : "Activity"}</span></button>`).join("")}</nav>${error && !modal ? `<div class="toast error-toast" role="alert"><span>${escape(error)}</span><button data-action="dismiss-error" aria-label="Dismiss error">${icon("close")}</button></div>` : notice ? `<div class="toast" role="status">${icon("check")}${escape(notice)}</div>` : ""}${modal === "injury" ? injuryModal() : modal === "dismiss" ? dismissModal() : modal === "entry" ? entryModal() : modal === "dates" ? datesModal() : ""}`;
  const scroller = document.querySelector(".owed-scroll");
  if (scroller) scroller.scrollTop = scrollTop;
  const historyScroller = document.querySelector(".history-scroll");
  if (historyScroller) historyScroller.scrollTop = historyScrollTop;
  const sheetScroller = document.querySelector(".sheet-scroll");
  if (sheetScroller) sheetScroller.scrollTop = sheetScrollTop;
  const stage = document.querySelector<HTMLElement>("#dice-stage");
  if (stage) {
    const exercise = roll ? exerciseOf(roll.exerciseKey) : result ? exerciseOf(result.exerciseKey) : null;
    const labels = exercise ? Array.from({ length: 6 }, (_, i) => amount(exercise.options.length === 6 ? exercise.options[i]! : exercise.options[Math.floor(i / 2)]!)) : eligible().map((item) => item.name);
    const signature = JSON.stringify([!!exercise, labels]);
    if (!labels.length) {
      dice?.dispose(); dice = undefined; diceSignature = "";
      stage.dataset.faceCount = "0"; stage.innerHTML = '<span class="dice-unavailable">No activities</span>';
    } else if (dice) {
      if (signature === diceSignature) dice.mount(stage); else dice.update(stage, labels, !!exercise);
    } else dice = new Dice(stage, labels, !!exercise);
    if (dice) {
      diceSignature = signature;
      if (result) dice.show((result.diceResult ?? 1) - 1, amount(result));
      dice.setInspectable(!busy && !result && !modal);
    }
  } else { dice?.dispose(); dice = undefined; diceSignature = ""; }
  if (modal) {
    const inputs = [...document.querySelectorAll<HTMLInputElement>("dialog input")];
    (inputs.find((input) => input.value === focusedFilter) ?? (focusedId ? document.getElementById(focusedId) : null) ?? document.querySelector<HTMLButtonElement>("dialog button"))?.focus();
  } else if (focusedId === "history-person") document.getElementById(focusedId)?.focus({ preventScroll: true });
  hydrateAvatars(root, telegram?.initData ?? "", preview);
}

async function perform(work: () => Promise<void>) {
  if (busy) return;
  clearTimeout(noticeTimer); error = ""; notice = ""; busy = true; render();
  try { await work(); }
  catch (err) { error = err instanceof Error ? err.message : "Connection interrupted. Try again."; telegram?.HapticFeedback?.notificationOccurred("error"); }
  finally {
    busy = false; render();
    if (notice) noticeTimer = setTimeout(() => { if (notice) { notice = ""; render(); } }, 2200);
  }
}

function closeModal() {
  if (busy) return;
  const selector = modal === "injury" ? '[data-action="injury"]' : modal === "entry" ? `[data-action="add-entry"][data-target="${entryDraft?.targetPlayerId}"]` : modal === "dates" ? '[data-action="history-dates"]' : `[data-action="dismiss"][data-assignment="${dismissedId}"]`;
  if (modal === "dates") error = "";
  modal = null; render(); document.querySelector<HTMLButtonElement>(selector)?.focus();
}

root.addEventListener("change", (event) => {
  const input = event.target as HTMLInputElement;
  if (busy) return;
  if (input.id === "history-person") { historyPlayer = Number(input.value); resetHistory(); void perform(() => loadHistory()); return; }
  if (modal === "dates" && rangeDraft) {
    if (input.id === "history-times") {
      rangeDraft.withTimes = input.checked; rangeDraft.mode = "custom";
      rangeDraft.from ||= relativeDay(state.timezone); rangeDraft.to ||= rangeDraft.from; render();
    }
    if (input.id === "history-from") { rangeDraft.from = input.value; rangeDraft.mode = "custom"; render(); }
    if (input.id === "history-to") { rangeDraft.to = input.value; rangeDraft.mode = "custom"; render(); }
    if (input.id === "history-from-time") { rangeDraft.fromTime = input.value; rangeDraft.mode = "custom"; }
    if (input.id === "history-to-time") { rangeDraft.toTime = input.value; rangeDraft.mode = "custom"; }
  }
  if (input.id === "target") { targetId = Number(input.value); sessionStorage.setItem("dice-target", String(targetId)); filters = []; excludedExercises = []; result = null; render(); }
  if (input.type === "checkbox" && modal === "injury") {
    if (input.dataset.kind === "exercise") excludedExercises = input.checked ? [...new Set([...excludedExercises, input.value])] : excludedExercises.filter((item) => item !== input.value);
    else filters = input.checked ? [...new Set([...filters, input.value])] : filters.filter((item) => item !== input.value);
    render();
  }
  if (modal === "entry" && entryDraft) {
    if (input.id === "entry-exercise") { const option = exerciseOf(input.value).options[0]!; entryDraft.exerciseKey = input.value; entryDraft.amount = String(option.amount); entryDraft.measurement = option.measurement; render(); }
    if (input.id === "entry-measurement") { entryDraft.measurement = input.value as "reps" | "seconds"; render(); }
  }
});
root.addEventListener("input", (event) => { const input = event.target as HTMLInputElement; if (input.id === "entry-amount" && entryDraft) entryDraft.amount = input.value; });
root.addEventListener("submit", (event) => {
  if ((event.target as HTMLElement).id === "history-dates") {
    event.preventDefault(); if (busy || !rangeDraft) return;
    const candidate = { ...rangeDraft };
    void perform(async () => {
      if (candidate.mode === "custom" && !candidate.from && !candidate.to) throw new Error("Choose a date, or select All dates.");
      if (candidate.from && candidate.to && `${candidate.from}T${candidate.withTimes ? candidate.fromTime : "00:00"}` > `${candidate.to}T${candidate.withTimes ? candidate.toTime : "23:59"}`) throw new Error("The end must be on or after the start.");
      const page = await api<HistoryPage>(`/api/history?${historyQuery(historyPlayer, candidate, state.timezone)}`);
      resetHistory(); historyRange = candidate; historyPage = page; historyLoaded = true; modal = null; haptic();
    }); return;
  }
  if ((event.target as HTMLElement).id !== "manual-entry") return;
  event.preventDefault(); if (busy || !entryDraft) return;
  const draft = { ...entryDraft }; entryDraft.attempted = true;
  void perform(async () => {
    await api("/api/assignments", { id: draft.id, targetPlayerId: draft.targetPlayerId, exerciseKey: draft.exerciseKey, amount: Number(draft.amount), measurement: draft.measurement });
    await load(); modal = null; entryDraft = null; notice = "Exercise added"; haptic("medium");
  });
});
root.addEventListener("click", async (event) => {
  if ((event.target as HTMLElement).hasAttribute("data-backdrop")) { closeModal(); return; }
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-action]");
  if (!button || button.disabled || busy) return;
  const action = button.dataset.action!;
  if (action === "roll" || action === "owed") {
    clearTimeout(noticeTimer); tab = action; error = ""; notice = ""; haptic();
    if (action === "owed") { activityTab = "owed"; await perform(load); } else render();
    return;
  }
  if (action === "show-owed") { activityTab = "owed"; render(); haptic(); return; }
  if (action === "show-history") { activityTab = "history"; resetHistory(); await perform(() => loadHistory()); haptic(); return; }
  if (action === "history-more") { await perform(() => loadHistory(true)); return; }
  if (action === "history-clear") { historyPlayer = 0; historyRange = emptyRange(); resetHistory(); await perform(() => loadHistory()); return; }
  if (action === "history-dates") { error = ""; notice = ""; rangeDraft = { ...historyRange }; modal = "dates"; render(); return; }
  if (action === "date-preset" && rangeDraft) {
    const mode = button.dataset.mode as "all" | "today" | "yesterday";
    rangeDraft = { ...emptyRange(), mode, from: mode === "all" ? "" : relativeDay(state.timezone, mode === "yesterday" ? -1 : 0), to: mode === "all" ? "" : relativeDay(state.timezone, mode === "yesterday" ? -1 : 0) };
    error = ""; render(); return;
  }
  if (action === "injury") { clearTimeout(noticeTimer); notice = ""; result = null; modal = "injury"; render(); return; }
  if (action === "toggle-exercises") { exercisePickerOpen = !exercisePickerOpen; render(); return; }
  if (action === "add-entry") {
    clearTimeout(noticeTimer); notice = ""; error = "";
    const playerId = Number(button.dataset.target), exercise = state.exercises[0]!, option = exercise.options[0]!;
    if (!entryDraft?.attempted || entryDraft.targetPlayerId !== playerId) entryDraft = { id: crypto.randomUUID(), targetPlayerId: playerId, exerciseKey: exercise.key, amount: String(option.amount), measurement: option.measurement, attempted: false };
    modal = "entry"; render(); return;
  }
  if (action === "entry-preset" && entryDraft) { const option = exerciseOf(entryDraft.exerciseKey).options[Number(button.dataset.index)]!; entryDraft.amount = String(option.amount); entryDraft.measurement = option.measurement; render(); return; }
  if (action === "dismiss") { clearTimeout(noticeTimer); notice = ""; dismissedId = Number(button.dataset.assignment); modal = "dismiss"; render(); return; }
  if (action === "close-modal") { closeModal(); return; }
  if (action === "dismiss-error") { error = ""; render(); return; }
  // Clear the saved result before rendering the activity dice for the next roll.
  if (action === "activity") result = null;
  if (action === "do-dismiss") modal = null;
  await perform(async () => {
    if (action === "refresh") { await reloadActivity(); notice = "Up to date"; return; }
    if (action === "activity") {
      requestId ||= crypto.randomUUID(); sessionStorage.setItem("dice-request", requestId);
      const response = await api<{ roll: Roll }>("/api/rolls", { id: requestId, targetPlayerId: targetId, injuryFilters: filters, exerciseExclusions: excludedExercises });
      const choices = eligible(response.roll.injuryFilters, response.roll.exerciseExclusions);
      const exercise = exerciseOf(response.roll.exerciseKey);
      await dice?.roll(Math.max(0, choices.findIndex((item) => item.key === exercise.key)), exercise.name);
      if (!matchMedia("(prefers-reduced-motion: reduce)").matches) await new Promise((resolve) => setTimeout(resolve, 260));
      roll = response.roll; targetId = roll.targetPlayerId; filters = []; excludedExercises = [];
      if (roll.assignmentId) { await load(); result = state.history.find((item) => item.id === response.roll.assignmentId) ?? null; }
      haptic("medium"); return;
    }
    if (action === "amount" && roll) {
      const response = await api<{ assignment: Assignment }>(`/api/rolls/${roll.id}/finish`, {});
      await dice?.roll((response.assignment.diceResult ?? 1) - 1, amount(response.assignment));
      result = response.assignment; await load(); filters = []; excludedExercises = [];
      telegram?.HapticFeedback?.notificationOccurred("success"); return;
    }
    if (action === "complete") {
      const assignmentId = Number(button.dataset.assignment), playerId = Number(button.dataset.target);
      const response = await api<{ completed: number }>("/api/complete", { targetPlayerId: playerId, assignmentIds: [assignmentId], nextOnly: false });
      await load(); notice = response.completed ? "Completed" : "Already completed"; haptic("medium");
    }
    if (action === "do-dismiss") {
      await api("/api/dismiss", { assignmentId: dismissedId });
      if (result?.id === dismissedId) result = null;
      await load(); notice = "Roll dismissed"; haptic("medium");
    }
  });
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && modal) { event.preventDefault(); closeModal(); }
  if (event.key === "Tab" && modal) {
    const focusable = [...document.querySelectorAll<HTMLElement>("dialog button:not(:disabled), dialog input:not(:disabled), dialog select:not(:disabled)")];
    const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
});

async function boot() {
  telegram?.ready(); telegram?.expand();
  try { telegram?.setHeaderColor("#0e1621"); telegram?.setBackgroundColor("#0e1621"); telegram?.setBottomBarColor?.("#17212b"); } catch { /* Older Telegram clients still work. */ }
  if (!preview && !telegram?.initData) {
    root.innerHTML = `<main class="welcome"><h1>Dice Fitness</h1><a class="primary" href="https://t.me/dicefitnessbot?startapp=rolls">Open in Telegram</a><a class="preview-link" href="?demo=1">Try a preview</a></main>`; return;
  }
  try { await load(); render(); }
  catch (err) { root.innerHTML = `<main class="welcome"><h1>Can’t open the game</h1><p role="alert">${escape((err as Error).message)}</p><button class="primary" id="retry-open">Try again</button></main>`; document.querySelector("#retry-open")?.addEventListener("click", () => void boot()); }
}
void boot();
let lastRefresh = 0;
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && state && !busy && !modal && Date.now() - lastRefresh > 10_000) {
    lastRefresh = Date.now(); void reloadActivity().then(render).catch(() => { /* Leave the current state available for a retry. */ });
  }
});
