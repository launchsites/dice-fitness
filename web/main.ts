import "./style.css";
import { Dice } from "./dice.js";
import type { Assignment, Roll, State } from "./types.js";

const root = document.querySelector<HTMLDivElement>("#app")!;
const telegram = window.Telegram?.WebApp;
const preview = new URLSearchParams(location.search).get("demo") === "1";
let state: State;
let tab: "roll" | "owed" | "leaderboard" | "history" = "roll";
let targetId = Number(sessionStorage.getItem("dice-target")) || 0;
let owedTarget = 0;
let filters: string[] = [];
let roll: Roll | null = null;
let result: Assignment | null = null;
let requestId: string | null = sessionStorage.getItem("dice-request");
let busy = false;
let error = "";
let notice = "";
let modal = "";
let confirmedIds: number[] = [];
let confirmedTarget = 0;
let confirmedUndo = 0;
let dice: Dice | undefined;

const escape = (value: unknown) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!));
const amount = (value: { amount: number; measurement: string }) => value.measurement === "reps" ? `${value.amount} reps` : `${value.amount}s`;
const nameOf = (id: number) => state.players.find((player) => player.id === id)?.name || "Player";
const exerciseOf = (key: string) => state.exercises.find((exercise) => exercise.key === key)!;
const eligible = (chosen = filters) => state.exercises.filter((exercise) => !state.injuries.some((filter) => chosen.includes(filter.key) && (filter.excludes as readonly string[]).includes(exercise.key)));
const haptic = (style = "light") => telegram?.HapticFeedback?.impactOccurred(style);

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
  owedTarget ||= targetId;
  roll = state.pending;
  if (roll) { targetId = roll.targetPlayerId; filters = []; }
  if (!roll) { requestId = null; sessionStorage.removeItem("dice-request"); }
}

function playerSelect(id: string, selected: number, disabled = false) {
  return `<div class="select-wrap"><label for="${id}">${id === "target" ? "Rolling for" : "Owed by"}</label><select id="${id}" ${disabled ? "disabled" : ""}>${state.players.filter((player) => player.active || player.id === selected).map((player) => `<option value="${player.id}" ${player.id === selected ? "selected" : ""}>${escape(player.name)}${player.id === state.me.id ? " (you)" : ""}</option>`).join("")}</select><span aria-hidden="true">⌄</span></div>`;
}

function rollView() {
  const exercise = roll ? exerciseOf(roll.exerciseKey) : result ? exerciseOf(result.exerciseKey) : null;
  const optionsStage = Boolean(roll);
  const chosenFilters = roll?.injuryFilters ?? filters;
  const filterLabel = chosenFilters.length ? state.injuries.filter((item) => chosenFilters.includes(item.key)).map((item) => item.name).join(", ") : "None";
  return `<section class="roll-page" aria-label="Dice rolls">
    <div class="roll-controls">${playerSelect("target", targetId, busy || !!roll || !!result)}<button class="filter-button ${chosenFilters.length ? "filter-on" : ""}" data-action="injury" ${busy || roll || result ? "disabled" : ""}><span class="filter-cross" aria-hidden="true">+</span> Injury <span class="filter-count">${chosenFilters.length || ""}</span></button></div>
    <div class="step-strip"><span class="${!optionsStage && !result ? "active" : "done"}"><i>1</i> Activity</span><div></div><span class="${optionsStage || result ? "active" : ""}"><i>2</i> Reps or time</span></div>
    <div class="dice-heading"><p class="eyebrow">${result ? "YOUR ROLL IS SAVED" : optionsStage ? "ACTIVITY LOCKED IN" : "LET THE DICE DECIDE"}</p><h1>${escape(result ? amount(result) : optionsStage ? exercise!.name : "What’s the move?")}</h1><p class="subheading">${result ? `${escape(exercise!.name)} · ${escape(nameOf(result.targetPlayerId))}` : optionsStage ? `Now roll the amount for ${escape(nameOf(roll!.targetPlayerId))}.` : `${eligible().length} activities. Equal chance for each.`}</p></div>
    <div class="dice-stage ${result ? "saved-stage" : ""}" id="dice-stage"><span class="ground-shadow"></span></div>
    <div class="stage-caption"><span class="tiny-dot"></span>${result ? "Added to owed. Tick it off when it’s done." : optionsStage ? "Finish this roll before starting another." : `Injury filter: ${escape(filterLabel)} · this roll only`}</div>
    <div class="roll-footer"><button class="primary" data-action="${result ? "again" : optionsStage ? "amount" : "activity"}" ${busy || (!result && !optionsStage && !eligible().length) ? "disabled" : ""}>${busy ? "Rolling…" : result ? "Roll again" : optionsStage ? "Roll reps / time" : "Roll activity"}<span aria-hidden="true">${result ? "↻" : "↗"}</span></button>${result ? `<button class="text-button" data-action="owed">View ${escape(nameOf(result.targetPlayerId).split(" ")[0])}’s owed list <span aria-hidden="true">→</span></button>` : `<p class="quiet">${optionsStage ? "The result is already saved if you close the app." : "Two rolls. One challenge. Go."}</p>`}</div>
  </section>`;
}

function owedView() {
  const player = state.players.find((item) => item.id === owedTarget) ?? state.players[0]!;
  const owed = player?.owed ?? [];
  return `<section class="list-page">${playerSelect("owed-target", player.id, busy)}<div class="section-heading"><div><p class="eyebrow">ONE AT A TIME</p><h1>Still to do<span class="count">${owed.length}</span></h1></div></div>
  ${owed.length ? `<ol class="owed-list">${owed.map((row, index) => `<li class="owed-item ${index === 0 ? "up-next" : ""}"><span class="queue-number">${String(index + 1).padStart(2, "0")}</span><div><strong>${escape(exerciseOf(row.exerciseKey).name)}</strong><span>${escape(amount(row))}${index === 0 ? " · Up next" : ""}</span></div><span class="empty-check" aria-hidden="true"></span></li>`).join("")}</ol><div class="sticky-actions"><button class="primary" data-action="complete-next" ${busy ? "disabled" : ""}>${busy ? "Saving…" : "Tick 1 off"}<span aria-hidden="true">✓</span></button><button class="text-button" data-action="complete-all" ${busy ? "disabled" : ""}>Mark all ${owed.length} as done</button></div>` : `<div class="empty-state"><div class="empty-symbol">✓</div><h2>All caught up.</h2><p>${escape(player.name.split(" ")[0])} has nothing left to tick off.</p><button class="secondary" data-action="roll">Back to the dice →</button></div>`}</section>`;
}

function leaderboardView() {
  const ranked = [...state.players].sort((a, b) => b.completed - a.completed || a.name.localeCompare(b.name));
  return `<section class="list-page"><div class="section-heading"><div><p class="eyebrow">EVERY REP COUNTS</p><h1>The leaderboard</h1><p class="subheading">All time. Completed exercises.</p></div></div><div class="rankings">${ranked.map((player, index) => `<details class="ranking"><summary><span class="rank">${String(index + 1).padStart(2, "0")}</span><div class="rank-person"><strong>${escape(player.name)}</strong><span>${player.owed.length} owed${player.active ? "" : " · inactive"}</span></div><div class="rank-score"><strong>${player.completed}</strong><span>done</span></div><span class="expand-indicator">+</span></summary><div class="totals">${player.totals.length ? player.totals.map((total) => `<div><span>${escape(total.name)}</span><strong>${[total.reps ? `${total.reps} reps` : "", total.seconds ? `${total.seconds}s` : ""].filter(Boolean).join(" · ")}</strong></div>`).join("") : `<p class="quiet">First completion still to come.</p>`}</div></details>`).join("")}</div></section>`;
}

function historyView() {
  return `<section class="list-page"><div class="section-heading"><div><p class="eyebrow">THE PAPER TRAIL</p><h1>Recent rolls</h1><p class="subheading">Latest 100 rolls, newest first.</p></div></div>${state.lastRoll ? `<button class="undo-button" data-action="confirm-undo" ${busy ? "disabled" : ""}>↶ Undo your last roll · ${escape(exerciseOf(state.lastRoll.exerciseKey).name)}</button>` : ""}<ol class="history-list">${state.history.map((row) => `<li><span class="history-status ${row.completedAt ? "complete" : ""}">${row.completedAt ? "✓" : "·"}</span><div><strong>${escape(exerciseOf(row.exerciseKey).name)} <span class="inline-amount">${escape(amount(row))}</span></strong><p>${escape(nameOf(row.targetPlayerId))} · ${escape(new Date(row.assignedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" }))}</p></div><span class="status-label">${row.completedAt ? "Done" : "Owed"}</span></li>`).join("") || `<li class="quiet">No rolls yet. Yours can be the first.</li>`}</ol></section>`;
}

function injuryModal() {
  const remaining = eligible();
  const excluded = state.exercises.filter((exercise) => !remaining.includes(exercise));
  return `<dialog open aria-labelledby="injury-title" class="sheet"><div class="sheet-top"><div><p class="eyebrow">JUST THIS ROLL</p><h2 id="injury-title">Work around an injury</h2></div><button class="icon-button" data-action="close-modal" aria-label="Close injury filters">×</button></div><p class="sheet-copy">Hide movements before rolling. This resets after the roll and isn’t saved to anyone’s profile.</p><div class="injury-list">${state.injuries.map((injury) => `<label class="injury-option"><input type="checkbox" value="${injury.key}" ${filters.includes(injury.key) ? "checked" : ""}><span><strong>${escape(injury.name)}</strong><small>${escape(injury.detail)}</small></span></label>`).join("")}</div><div class="filter-summary ${!remaining.length ? "warning" : ""}"><strong>${remaining.length} of ${state.exercises.length} activities available</strong><p>${remaining.length ? (excluded.length ? `Excluded: ${excluded.map((exercise) => escape(exercise.name)).join(", ")}.` : "All activities are in the draw.") : "No activities remain. Remove a filter before rolling."}</p></div><p class="health-note">Filters describe movements, not what is suitable for an injury. Skip anything that hurts.</p><button class="primary" data-action="close-modal">Use ${filters.length ? "these filters" : "no filter"}<span aria-hidden="true">✓</span></button></dialog>`;
}

function confirmModal(type: string) {
  const player = state.players.find((item) => item.id === owedTarget)!;
  return `<dialog open aria-labelledby="confirm-title" class="sheet compact-sheet"><p class="eyebrow">QUICK CHECK</p><h2 id="confirm-title">${type === "confirm-all" ? `Completed all ${confirmedIds.length}?` : "Undo your last roll?"}</h2><p class="sheet-copy">${type === "confirm-all" ? `Mark the currently displayed exercises as done for ${escape(player.name)}.` : "This removes your latest assignment and updates the leaderboard. Its audit record is kept."}</p><button class="primary" data-action="${type === "confirm-all" ? "do-complete-all" : "undo"}">${type === "confirm-all" ? "Yes, all done" : "Undo roll"}<span>✓</span></button><button class="text-button" data-action="close-modal">Cancel</button></dialog>`;
}

function render() {
  dice?.dispose(); dice = undefined;
  root.innerHTML = `${preview ? `<div class="preview-banner">Preview · sample players · nothing is saved to your game</div>` : ""}<header class="app-header"><div class="wordmark"><span class="brand-mark" aria-hidden="true">df<span>·</span></span><span>DICE<br>FITNESS</span></div><button class="refresh-button" data-action="refresh" aria-label="Refresh game" ${busy ? "disabled" : ""}>↻</button></header><main>${error ? `<div class="alert" role="alert">${escape(error)}<button data-action="dismiss-error" aria-label="Dismiss error">×</button></div>` : ""}${notice ? `<div class="notice" role="status">${escape(notice)}</div>` : ""}${tab === "roll" ? rollView() : tab === "owed" ? owedView() : tab === "leaderboard" ? leaderboardView() : historyView()}</main><nav class="bottom-nav" aria-label="Game screens">${(["roll", "owed", "leaderboard", "history"] as const).map((name, index) => `<button data-action="${name}" aria-current="${tab === name ? "page" : "false"}" ${busy ? "disabled" : ""}><span aria-hidden="true">${["◇", "☷", "▥", "◷"][index]}</span>${["Roll", "Owed", "Leaderboard", "History"][index]}</button>`).join("")}</nav>${modal ? `<div class="modal-backdrop"></div>${modal === "injury" ? injuryModal() : confirmModal(modal)}` : ""}`;
  const stage = document.querySelector<HTMLElement>("#dice-stage");
  if (stage) {
    const exercise = roll ? exerciseOf(roll.exerciseKey) : result ? exerciseOf(result.exerciseKey) : null;
    const labels = exercise ? Array.from({ length: 6 }, (_, i) => amount(exercise.options.length === 6 ? exercise.options[i]! : exercise.options[Math.floor(i / 2)]!)) : eligible().map((item) => item.name);
    dice = new Dice(stage, labels, !!exercise);
    if (result) dice.show(result.diceResult - 1, amount(result));
  }
  if (modal) document.querySelector<HTMLButtonElement>("dialog button")?.focus();
}

async function perform(work: () => Promise<void>) {
  if (busy) return;
  error = ""; notice = ""; busy = true; render();
  try { await work(); }
  catch (err) { error = err instanceof Error ? err.message : "Connection interrupted. Try again."; telegram?.HapticFeedback?.notificationOccurred("error"); }
  finally { busy = false; render(); }
}

root.addEventListener("change", (event) => {
  const input = event.target as HTMLInputElement;
  if (input.id === "target") { targetId = Number(input.value); sessionStorage.setItem("dice-target", String(targetId)); filters = []; render(); }
  if (input.id === "owed-target") { owedTarget = Number(input.value); render(); }
  if (input.type === "checkbox" && modal === "injury") { filters = input.checked ? [...filters, input.value] : filters.filter((item) => item !== input.value); render(); }
});
root.addEventListener("click", async (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-action]");
  if (!button || button.disabled || busy) return;
  const action = button.dataset.action!;
  if (["roll", "owed", "leaderboard", "history"].includes(action)) {
    tab = action as typeof tab;
    if (action === "owed" && result) owedTarget = result.targetPlayerId;
    error = ""; notice = ""; haptic(); render(); return;
  }
  if (action === "injury") { modal = "injury"; render(); return; }
  if (action === "close-modal") { modal = ""; render(); return; }
  if (action === "dismiss-error") { error = ""; render(); return; }
  if (action === "complete-all" || action === "confirm-undo") {
    confirmedTarget = owedTarget;
    confirmedIds = state.players.find((player) => player.id === owedTarget)?.owed.map((item) => item.id) ?? [];
    confirmedUndo = state.lastRoll?.id ?? 0;
    modal = action === "complete-all" ? "confirm-all" : "confirm-undo"; render(); return;
  }
  if (action === "again") { result = null; roll = null; filters = []; requestId = null; render(); return; }
  await perform(async () => {
    if (action === "refresh") { await load(); notice = "Up to date."; return; }
    if (action === "activity") {
      requestId ||= crypto.randomUUID(); sessionStorage.setItem("dice-request", requestId);
      const response = await api<{ roll: Roll }>("/api/rolls", { id: requestId, targetPlayerId: targetId, injuryFilters: filters });
      const choices = eligible(response.roll.injuryFilters);
      const exercise = exerciseOf(response.roll.exerciseKey);
      await dice?.roll(Math.max(0, choices.findIndex((item) => item.key === exercise.key)), exercise.name);
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
    if (action === "complete-next" || action === "do-complete-all") {
      const player = state.players.find((item) => item.id === owedTarget)!;
      const ids = action === "complete-next" ? player.owed.slice(0, 1).map((item) => item.id) : confirmedIds;
      modal = "";
      const response = await api<{ completed: number }>("/api/complete", { targetPlayerId: action === "complete-next" ? owedTarget : confirmedTarget, assignmentIds: ids, nextOnly: action === "complete-next" });
      await load(); notice = response.completed ? `${response.completed === 1 ? "Top exercise" : `${response.completed} exercises`} ticked off.` : "Already ticked off.";
      haptic("medium"); return;
    }
    if (action === "undo" && confirmedUndo) {
      modal = ""; await api("/api/undo", { assignmentId: confirmedUndo }); result = null;
      await load(); notice = "Your last roll was undone.";
    }
  });
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && modal) { event.preventDefault(); modal = ""; render(); }
  if (event.key === "Tab" && modal) {
    const focusable = [...document.querySelectorAll<HTMLElement>("dialog button, dialog input")];
    const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
});

async function boot() {
  telegram?.ready(); telegram?.expand();
  try { telegram?.setHeaderColor("#f4f5f2"); telegram?.setBackgroundColor("#f4f5f2"); } catch { /* Older Telegram clients still work. */ }
  if (!preview && !telegram?.initData) {
    root.innerHTML = `<main class="welcome"><div class="brand-mark">df<span>·</span></div><p class="eyebrow">YOUR GROUP. YOUR NEXT CHALLENGE.</p><h1>Leave it<br>to the dice.</h1><p>Choose a person. Roll an activity.<br>Then roll the reps or time.</p><a class="primary" href="https://t.me/dicefitnessbot">Open Dice Fitness in Telegram <span>↗</span></a><a class="text-button" href="?demo=1">Try a preview with sample players</a></main>`; return;
  }
  try { await load(); render(); }
  catch (err) { root.innerHTML = `<main class="welcome"><h1>Can’t open the game yet.</h1><p role="alert">${escape((err as Error).message)}</p><button class="primary" id="retry-open">Try again <span>↻</span></button></main>`; document.querySelector("#retry-open")?.addEventListener("click", () => void boot()); }
}
void boot();
let lastRefresh = 0;
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && state && !busy && Date.now() - lastRefresh > 10_000) {
    lastRefresh = Date.now(); void load().then(render).catch(() => { /* Leave the current state available for a retry. */ });
  }
});
