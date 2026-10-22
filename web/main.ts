import "./style.css";
import { Dice } from "./dice.js";
import { observeViewport } from "./viewport.js";
import type { Assignment, Roll, State } from "./types.js";

const root = document.querySelector<HTMLDivElement>("#app")!;
const telegram = window.Telegram?.WebApp;
const preview = new URLSearchParams(location.search).get("demo") === "1";
observeViewport(telegram);
let state: State;
let tab: "roll" | "owed" = "roll";
let targetId = Number(sessionStorage.getItem("dice-target")) || 0;
let filters: string[] = [];
let roll: Roll | null = null;
let result: Assignment | null = null;
let requestId: string | null = sessionStorage.getItem("dice-request");
let busy = false;
let error = "";
let notice = "";
let modal: "injury" | "dismiss" | null = null;
let dismissedId = 0;
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
let dice: Dice | undefined;
let diceSignature = "";

const escape = (value: unknown) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!));
const amount = (value: { amount: number; measurement: string }) => value.measurement === "reps" ? `${value.amount} reps` : `${value.amount}s`;
const exerciseOf = (key: string) => state.exercises.find((exercise) => exercise.key === key)!;
const eligible = (chosen = filters) => state.exercises.filter((exercise) => !state.injuries.some((filter) => chosen.includes(filter.key) && (filter.excludes as readonly string[]).includes(exercise.key)));
const haptic = (style = "light") => telegram?.HapticFeedback?.impactOccurred(style);
const icon = (name: "dice" | "owed" | "check" | "chevron" | "close" | "refresh" | "undo") => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${{
  dice: '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M8 8h.01M16 8h.01M12 12h.01M8 16h.01M16 16h.01" stroke-width="3"/>',
  owed: '<path d="m4 7 1.5 1.5L8 6m-4 9 1.5 1.5L8 14M12 7h8m-8 8h8"/>',
  check: '<path d="m6 12 4 4 8-8"/>',
  chevron: '<path d="m8 10 4 4 4-4"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.1 6.1A8 8 0 0 1 20 12M4 12a8 8 0 0 0 13.9 5.9"/>',
  undo: '<path d="M4 4v6h6"/><path d="M4 10a8 8 0 1 1 2.1 7.9"/>',
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
  if (roll) { targetId = roll.targetPlayerId; filters = []; }
  if (!roll) { requestId = null; sessionStorage.removeItem("dice-request"); }
}

function rollView() {
  const exercise = roll ? exerciseOf(roll.exerciseKey) : result ? exerciseOf(result.exerciseKey) : null;
  const chosenFilters = roll?.injuryFilters ?? filters;
  const filterLabel = chosenFilters.length ? state.injuries.filter((item) => chosenFilters.includes(item.key)).map((item) => item.name).join(", ") : "None";
  const locked = busy || !!roll;
  return `<section class="roll-page" aria-label="Dice rolls">
    <div class="roll-controls">
      <div class="player-control"><label for="target">Rolling for</label><div class="select-wrap"><select id="target" ${locked ? "disabled" : ""}>${state.players.filter((player) => player.active || player.id === targetId).map((player) => `<option value="${player.id}" ${player.id === targetId ? "selected" : ""}>${escape(player.name)}${player.id === state.me.id ? " (you)" : ""}</option>`).join("")}</select>${icon("chevron")}</div></div>
      <button class="injury-control ${chosenFilters.length ? "filter-on" : ""}" data-action="injury" ${locked ? "disabled" : ""} aria-haspopup="dialog"><span class="control-label">Injury</span><span class="control-value"><span>${escape(filterLabel)}</span>${icon("chevron")}</span></button>
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
  return `<section class="owed-page" aria-label="Owed exercises"><header class="page-heading"><h1>Owed</h1><button class="icon-button" data-action="refresh" aria-label="Refresh owed exercises" ${busy ? "disabled" : ""}>${icon("refresh")}</button></header><div class="owed-scroll">${players.map((player) => `<section class="player-owed" aria-labelledby="player-${player.id}"><h2 id="player-${player.id}">${escape(player.name)}<span>${player.owed.length}</span></h2>${player.owed.length ? `<ul class="owed-list">${player.owed.map((row) => `<li class="owed-item" data-assignment="${row.id}"><div class="owed-description"><strong>${escape(exerciseOf(row.exerciseKey).name)}</strong><span>${escape(amount(row))}</span></div><div class="owed-actions"><button class="dismiss-button" data-action="dismiss" data-assignment="${row.id}" aria-label="Undo roll: ${escape(exerciseOf(row.exerciseKey).name)}, ${escape(amount(row))}, for ${escape(player.name)}" title="Undo roll" ${busy ? "disabled" : ""}>${icon("undo")}</button><button class="complete-button" data-action="complete" data-target="${player.id}" data-assignment="${row.id}" aria-label="Complete ${escape(exerciseOf(row.exerciseKey).name)}, ${escape(amount(row))}, for ${escape(player.name)}" title="Complete" ${busy ? "disabled" : ""}>${icon("check")}</button></div></li>`).join("")}</ul>` : `<p class="all-done">${icon("check")} All done</p>`}</section>`).join("")}</div></section>`;
}

function dismissModal() {
  const player = state.players.find((item) => item.owed.some((row) => row.id === dismissedId));
  const row = player?.owed.find((item) => item.id === dismissedId);
  return `<div class="modal-backdrop" data-backdrop></div><dialog open aria-modal="true" aria-labelledby="dismiss-title" class="sheet dismiss-sheet"><header class="sheet-top"><h2 id="dismiss-title">Undo this roll?</h2><button class="icon-button" data-action="close-modal" aria-label="Cancel undo">${icon("close")}</button></header><div class="dismiss-copy"><p>${row ? `${escape(player!.name)} · ${escape(exerciseOf(row.exerciseKey).name)} · ${escape(amount(row))}` : "This exercise is no longer owed."}</p><small>Removed from owed. No completion credit.</small></div><footer class="sheet-footer"><button class="primary destructive" data-action="do-dismiss" ${!row || busy ? "disabled" : ""}>Undo roll</button><button class="cancel-button" data-action="close-modal">Cancel</button></footer></dialog>`;
}

function injuryModal() {
  const remaining = eligible().length;
  return `<div class="modal-backdrop" data-backdrop></div><dialog open aria-modal="true" aria-labelledby="injury-title" class="sheet"><header class="sheet-top"><div><h2 id="injury-title">Injury</h2><p>This roll only</p></div><button class="icon-button" data-action="close-modal" aria-label="Close injury filters">${icon("close")}</button></header><div class="sheet-scroll"><div class="injury-list">${state.injuries.map((injury) => `<label class="injury-option"><span><strong>${escape(injury.name)}</strong><small>${escape(injury.detail)}</small></span><input type="checkbox" value="${injury.key}" ${filters.includes(injury.key) ? "checked" : ""}></label>`).join("")}</div><p class="health-note">Skip anything that hurts.</p></div><footer class="sheet-footer"><p class="filter-summary ${remaining ? "" : "warning"}" role="status">${remaining ? `${remaining} activities available` : "No activities left. Remove a filter."}</p><button class="primary" data-action="close-modal">Done</button></footer></dialog>`;
}

function render() {
  const scrollTop = document.querySelector(".owed-scroll")?.scrollTop ?? 0;
  const focused = document.activeElement as HTMLInputElement | null;
  const focusedFilter = modal && focused?.type === "checkbox" ? focused.value : null;
  root.innerHTML = `${preview ? `<div class="preview-banner">Preview · sample data</div>` : ""}<main>${tab === "roll" ? rollView() : owedView()}</main><nav class="bottom-nav" aria-label="Game screens">${(["roll", "owed"] as const).map((name) => `<button data-action="${name}" aria-current="${tab === name ? "page" : "false"}" ${busy ? "disabled" : ""}>${icon(name === "roll" ? "dice" : "owed")}<span>${name === "roll" ? "Roll" : "Owed"}</span></button>`).join("")}</nav>${error ? `<div class="toast error-toast" role="alert"><span>${escape(error)}</span><button data-action="dismiss-error" aria-label="Dismiss error">${icon("close")}</button></div>` : notice ? `<div class="toast" role="status">${icon("check")}${escape(notice)}</div>` : ""}${modal === "injury" ? injuryModal() : modal === "dismiss" ? dismissModal() : ""}`;
  const scroller = document.querySelector(".owed-scroll");
  if (scroller) scroller.scrollTop = scrollTop;
  const stage = document.querySelector<HTMLElement>("#dice-stage");
  if (stage) {
    const exercise = roll ? exerciseOf(roll.exerciseKey) : result ? exerciseOf(result.exerciseKey) : null;
    const labels = exercise ? Array.from({ length: 6 }, (_, i) => amount(exercise.options.length === 6 ? exercise.options[i]! : exercise.options[Math.floor(i / 2)]!)) : eligible().map((item) => item.name);
    const signature = JSON.stringify([!!exercise, labels]);
    if (dice) {
      if (signature === diceSignature) dice.mount(stage); else dice.update(stage, labels, !!exercise);
    } else dice = new Dice(stage, labels, !!exercise);
    diceSignature = signature;
    if (result) dice.show(result.diceResult - 1, amount(result));
  } else { dice?.dispose(); dice = undefined; diceSignature = ""; }
  if (modal) {
    const inputs = [...document.querySelectorAll<HTMLInputElement>("dialog input")];
    (inputs.find((input) => input.value === focusedFilter) ?? document.querySelector<HTMLButtonElement>("dialog button"))?.focus();
  }
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
  const selector = modal === "injury" ? '[data-action="injury"]' : `[data-action="dismiss"][data-assignment="${dismissedId}"]`;
  modal = null; render(); document.querySelector<HTMLButtonElement>(selector)?.focus();
}

root.addEventListener("change", (event) => {
  const input = event.target as HTMLInputElement;
  if (input.id === "target") { targetId = Number(input.value); sessionStorage.setItem("dice-target", String(targetId)); filters = []; result = null; render(); }
  if (input.type === "checkbox" && modal === "injury") { filters = input.checked ? [...new Set([...filters, input.value])] : filters.filter((item) => item !== input.value); render(); }
});
root.addEventListener("click", async (event) => {
  if ((event.target as HTMLElement).hasAttribute("data-backdrop")) { closeModal(); return; }
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-action]");
  if (!button || button.disabled || busy) return;
  const action = button.dataset.action!;
  if (action === "roll" || action === "owed") {
    clearTimeout(noticeTimer); tab = action; error = ""; notice = ""; haptic();
    if (action === "owed") await perform(load); else render();
    return;
  }
  if (action === "injury") { clearTimeout(noticeTimer); notice = ""; result = null; modal = "injury"; render(); return; }
  if (action === "dismiss") { clearTimeout(noticeTimer); notice = ""; dismissedId = Number(button.dataset.assignment); modal = "dismiss"; render(); return; }
  if (action === "close-modal") { closeModal(); return; }
  if (action === "dismiss-error") { error = ""; render(); return; }
  // Clear the saved result before rendering the activity dice for the next roll.
  if (action === "activity") result = null;
  if (action === "do-dismiss") modal = null;
  await perform(async () => {
    if (action === "refresh") { await load(); notice = "Up to date"; return; }
    if (action === "activity") {
      requestId ||= crypto.randomUUID(); sessionStorage.setItem("dice-request", requestId);
      const response = await api<{ roll: Roll }>("/api/rolls", { id: requestId, targetPlayerId: targetId, injuryFilters: filters });
      const choices = eligible(response.roll.injuryFilters);
      const exercise = exerciseOf(response.roll.exerciseKey);
      await dice?.roll(Math.max(0, choices.findIndex((item) => item.key === exercise.key)), exercise.name);
      if (!matchMedia("(prefers-reduced-motion: reduce)").matches) await new Promise((resolve) => setTimeout(resolve, 260));
      roll = response.roll; targetId = roll.targetPlayerId; filters = [];
      if (roll.assignmentId) { await load(); result = state.history.find((item) => item.id === response.roll.assignmentId) ?? null; }
      haptic("medium"); return;
    }
    if (action === "amount" && roll) {
      const response = await api<{ assignment: Assignment }>(`/api/rolls/${roll.id}/finish`, {});
      await dice?.roll(response.assignment.diceResult - 1, amount(response.assignment));
      result = response.assignment; await load(); filters = [];
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
    const focusable = [...document.querySelectorAll<HTMLElement>("dialog button, dialog input")];
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
    lastRefresh = Date.now(); void load().then(render).catch(() => { /* Leave the current state available for a retry. */ });
  }
});
