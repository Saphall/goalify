"use strict";

const $ = (selector, root = document) => root.querySelector(selector);
const content = $("#app-content");
const modal = $("#modal");
const state = { data: null, page: "overview", status: "active", search: "", category: "all", sort: "newest" };
const categories = {
  Learning: { icon: "book", bg: "#eef0e2", ink: "#8d9662", border: "#e3e8d2", bar: "#a1b378" },
  Health: { icon: "heart", bg: "#e8efe9", ink: "#769880", border: "#dae6dd", bar: "#81a88c" },
  Personal: { icon: "leaf", bg: "#f4eddf", ink: "#b19867", border: "#ede3cf", bar: "#c3ad7a" },
  Career: { icon: "case", bg: "#ececf2", ink: "#9493ad", border: "#e1e1eb", bar: "#a5a3bd" },
  Finance: { icon: "wallet", bg: "#e5efe9", ink: "#658d7a", border: "#d9e7de", bar: "#82a691" },
  Creative: { icon: "palette", bg: "#f3e9e4", ink: "#b18e7a", border: "#ebded5", bar: "#c4a08d" },
};
const pageInfo = {
  overview: ["Overview", "A LITTLE INTENTION GOES A LONG WAY", "Your next chapter starts here", "Make time for what matters. We’ll help you see how far you’ve come."],
  goals: ["My goals", "GIVE YOUR INTENTIONS A PLACE TO GROW", "Good things take a little intention", "Big dreams, small steps. This is where they come together."],
  insights: ["Insights", "THE BIGGER PICTURE", "Look at you, making progress", "Every check-in tells a story. Here’s a little perspective on yours."],
  journal: ["Progress journal", "A RECORD OF SHOWING UP", "Every little step has a story", "A place for your progress, reflections, and small wins."],
};
function escapeHTML(value) { return String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function icon(name, cls = "") { return `<svg class="icon ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`; }
function number(value) { return Number(value).toLocaleString(undefined, { maximumFractionDigits: 4 }); }
function plural(value, word) { return `${number(value)} ${word}${value === 1 ? "" : "s"}`; }
function dateLabel(iso, options = { month: "short", day: "numeric" }) { return new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString(undefined, options); }
function categoryStyle(category) { const c = categories[category] || categories.Personal; return `--cat-bg:${c.bg};--cat-ink:${c.ink};--cat-border:${c.border};--cat-bar:${c.bar}`; }
function goalById(id) { return state.data.goals.find(goal => goal.id === Number(id)); }
function titleButton(text, action, id = "") { return `<button class="text-button" data-action="${action}" ${id ? `data-id="${id}"` : ""}>${text}${icon("arrow")}</button>`; }

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { "Content-Type": "application/json", ...options.headers } });
  const data = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(data?.error || "Something didn’t save. Please try again.");
  return data;
}
async function refresh() {
  state.data = await api("/api/dashboard");
  $("#nav-count").textContent = state.data.stats.active;
  $("#topbar-date").textContent = dateLabel(state.data.today, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  $("#loading").hidden = true;
  content.hidden = false;
  render();
}
let toastTimeout;
function toast(message, error = false) {
  clearTimeout(toastTimeout);
  $("#toast-region").innerHTML = `<div class="toast ${error ? "error" : ""}">${icon(error ? "info" : "check")}<span>${escapeHTML(message)}</span></div>`;
  toastTimeout = setTimeout(() => { $("#toast-region").replaceChildren(); }, error ? 7000 : 4200);
}
function navigate() {
  const page = location.hash.slice(1);
  state.page = pageInfo[page] ? page : "overview";
  state.search = "";
  state.category = "all";
  state.status = state.page === "goals" ? "all" : "active";
  const [name, eyebrow, heading, description] = pageInfo[state.page];
  $("#breadcrumb-page").textContent = name;
  $("#page-eyebrow").textContent = eyebrow;
  $("#page-title").innerHTML = `${heading}<span>.</span>`;
  $("#page-description").textContent = description;
  document.title = `${name} · Goalify`;
  document.querySelectorAll(".nav-item").forEach(item => {
    const active = item.dataset.page === state.page;
    item.classList.toggle("active", active);
    if (active) item.setAttribute("aria-current", "page"); else item.removeAttribute("aria-current");
  });
  toggleSidebar(false);
  if (state.data) render();
  window.scrollTo({ top: 0, behavior: "instant" });
}
function render() {
  content.innerHTML = state.page === "overview" ? overview() : state.page === "goals" ? goalsPage() : state.page === "insights" ? insightsPage() : journalPage();
}

function hero() {
  const today = state.data.stats.today_entries;
  return `<section class="hero" aria-labelledby="hero-title"><div class="hero-label">${icon("spark")}GROW AT YOUR OWN PACE</div><h2 id="hero-title">Small steps.<br><em>Extraordinary things.</em></h2><p>You don’t need to change everything today.<br>Just move a little closer to what matters.</p><div class="hero-bottom"><span></span>${today ? `${plural(today, "check-in")} today. That’s how growth happens.` : "A fresh day. A little possibility. Your next step is waiting."}</div><div class="hero-art" aria-hidden="true"><div class="hero-orbit"></div><div class="glass-leaf"></div><div class="glass-leaf second"></div>${icon("spark", "hero-spark")}<div class="hero-pearl"></div></div></section>`;
}
function weeklyChart() {
  const max = Math.max(1, ...state.data.weekly.map(day => day.count));
  return `<div class="bar-chart" role="img" aria-label="Check-ins over the past seven days: ${state.data.weekly.map(d => `${dateLabel(d.date)}: ${d.count}`).join(", ")}">${state.data.weekly.map((d, i) => `<div class="bar-column ${i === 6 ? "today" : ""}" title="${dateLabel(d.date)}: ${plural(d.count, "check-in")}"><div class="bar-track"><div class="bar" style="height:${Math.max(5, d.count / max * 100)}%"></div></div><span>${escapeHTML(d.label)}</span></div>`).join("")}</div>`;
}
function weeklyCard() {
  return `<section class="glass-card weekly-card"><div class="card-heading"><h3>Your rhythm</h3><span class="subtle-tag">Last 7 days</span></div><div class="weekly-total"><strong>${state.data.stats.week_entries}</strong><span>little steps forward</span></div>${weeklyChart()}<div class="weekly-caption">${icon("leaf")}${state.data.stats.week_entries ? "Every time you show up, it adds up." : "Your first check-in starts the story."}</div></section>`;
}
function stats() {
  const s = state.data.stats;
  return `<section class="stats-row" aria-label="Your goal statistics">${[
    ["target", "Active goals", s.active, "", "Room to keep growing"],
    ["check", "Goals completed", s.completed, "", "Take a moment. You did that."],
    ["chart", "Overall progress", `${s.progress}%`, "", "Average across all your goals"],
    ["flame", "Current streak", s.streak, s.streak === 1 ? "day" : "days", "Days with a little progress"],
  ].map(([symbol, label, value, unit, meta]) => `<article class="stat-card"><div class="stat-icon">${icon(symbol)}</div><div><div class="stat-label">${label}</div><div class="stat-value">${value}${unit ? `<small>${unit}</small>` : ""}</div><div class="stat-meta">${meta}</div></div></article>`).join("")}</section>`;
}
function statusTabs() {
  return `<div class="tabs" role="group" aria-label="Filter by status">${[["active", "In progress"], ["completed", "Completed"], ["all", "All goals"]].map(([key, label]) => `<button class="tab ${state.status === key ? "active" : ""}" data-action="status" data-status="${key}" aria-pressed="${state.status === key}">${label}</button>`).join("")}</div>`;
}
function searchBox() { return `<label class="search-box">${icon("search")}<input type="search" id="goal-search" placeholder="Find a goal…" aria-label="Search goals" value="${escapeHTML(state.search)}" maxlength="100" autocomplete="off"></label>`; }
function filteredGoals() {
  const goals = state.data.goals.filter(g => (state.status === "all" || (state.status === "completed" ? g.completed : !g.completed)) && (state.category === "all" || g.category === state.category) && `${g.title} ${g.description} ${g.category}`.toLowerCase().includes(state.search.toLowerCase()));
  return goals.sort((a, b) => state.sort === "due" ? (a.due_date || "9999").localeCompare(b.due_date || "9999") : state.sort === "progress" ? b.progress - a.progress : b.id - a.id);
}
function dueText(goal) {
  if (goal.completed) return "A goal, made real";
  if (goal.days_left === null) return "At your own pace";
  if (goal.days_left < 0) return `${Math.abs(goal.days_left)}d past target`;
  if (goal.days_left === 0) return "Target: today";
  return `${goal.days_left} days to grow`;
}
function goalCard(goal) {
  const category = categories[goal.category];
  return `<article class="goal-card" style="${categoryStyle(goal.category)}"><div class="goal-top"><span class="category-icon">${icon(category.icon)}</span><span class="goal-category">${escapeHTML(goal.category)}</span><button class="icon-button" data-action="detail" data-id="${goal.id}" aria-label="Details for ${escapeHTML(goal.title)}">${icon("more")}</button></div><h3><button class="goal-title" data-action="detail" data-id="${goal.id}">${escapeHTML(goal.title)}</button></h3><p class="goal-description">${escapeHTML(goal.description || "A little intention. A little closer, every day.")}</p><div class="goal-progress-label"><span class="goal-counts">${number(goal.current)} <span>/ ${number(goal.target)} ${escapeHTML(goal.unit)}</span></span><strong>${goal.progress}%</strong></div><div class="progress-track" role="progressbar" aria-label="${escapeHTML(goal.title)}" aria-valuenow="${goal.current}" aria-valuemax="${goal.target}" aria-valuemin="0"><div class="progress-fill" style="--progress:${goal.progress}%"></div></div><div class="goal-footer"><span class="due-label ${goal.days_left < 0 && !goal.completed ? "overdue" : ""}">${icon(goal.completed ? "spark" : "calendar")}${dueText(goal)}</span>${goal.completed ? `<span class="completed-mark">${icon("check")}Completed</span>` : `<button class="goal-log" data-action="log" data-id="${goal.id}">${icon("plus")}Log progress</button>`}</div></article>`;
}
function emptyState() {
  const filtered = state.search || state.category !== "all";
  const isCompleted = state.status === "completed";
  return `<div class="empty-state"><div class="empty-icon">${icon(filtered ? "search" : isCompleted ? "spark" : "leaf")}</div><h3>${filtered ? "A little less specific?" : isCompleted ? "Good things are in the making" : "Make space for something good"}</h3><p>${filtered ? "No goals match those filters. Try another word or category." : isCompleted ? "Your completed goals will find a home here. Keep taking those little steps." : "What’s one thing you’d love to make happen? Give it a name. Start there."}</p>${filtered ? `<button class="button soft" data-action="reset-filters">Clear filters</button>` : `<button class="button primary" data-action="new">${icon("plus")}Plant a new goal</button>`}</div>`;
}
function goalGrid() {
  let goals = filteredGoals();
  if (state.page === "overview") goals = goals.slice(0, 4).sort((a, b) => a.id - b.id);
  return goals.length ? goals.map(goalCard).join("") : emptyState();
}
function todayCard() {
  const todayIds = new Set(state.data.entries.filter(e => e.logged_on === state.data.today).map(e => e.goal_id));
  const goals = state.data.goals.filter(g => !g.completed).slice(0, 4);
  return `<section class="today-card"><div class="card-heading"><h3>A little focus for today</h3><span class="tiny-dot"></span></div><p class="today-intro">No rush. Just a few things worth showing up for.</p><div class="today-goals">${goals.length ? goals.map(g => `<div class="today-item"><button class="today-check ${todayIds.has(g.id) ? "done" : ""}" data-action="${todayIds.has(g.id) ? "detail" : "log"}" data-id="${g.id}" aria-label="${todayIds.has(g.id) ? "View today’s progress for" : "Log progress for"} ${escapeHTML(g.title)}">${todayIds.has(g.id) ? icon("check") : ""}</button><div class="today-item-text ${todayIds.has(g.id) ? "done" : ""}"><strong>${escapeHTML(g.title)}</strong><span>${todayIds.has(g.id) ? "You showed up today" : `${number(Math.max(0, g.target - g.current))} ${escapeHTML(g.unit)} to your goal`}</span></div></div>`).join("") : `<p class="today-intro">${state.data.goals.length ? "All your goals are complete. Take a breath and celebrate." : "Your next chapter starts with a goal."}</p>`}</div><div class="today-bottom">${icon("heart")}Progress over perfection. Always.</div></section>`;
}
function relativeDay(day) {
  if (day === state.data.today) return "Today";
  const diff = Math.round((new Date(`${state.data.today}T12:00:00`) - new Date(`${day}T12:00:00`)) / 86400000);
  return diff === 1 ? "Yesterday" : dateLabel(day);
}
function activityPanel() {
  return `<section class="activity-panel"><div class="section-heading"><h2>Little wins, lately</h2><a class="text-button" href="#journal" aria-label="See all journal entries">${icon("diagonal")}</a></div>${state.data.entries.slice(0, 3).map(e => `<div class="activity-item"><div class="activity-icon">${icon("check")}</div><div class="activity-copy"><strong>+${number(e.amount)} ${escapeHTML(e.unit)}</strong> toward<br>${escapeHTML(e.title)}<time datetime="${e.logged_on}">${relativeDay(e.logged_on)}</time></div></div>`).join("") || `<p class="today-intro">Your small wins will show up here.<br>Every step counts.</p>`}</section>`;
}
function sampleBanner() {
  return state.data.stats.has_samples ? `<aside class="sample-banner">${icon("info")}<span>A little inspiration to get started. These sample goals are yours to explore.</span><button data-action="clear-samples">Clear samples</button></aside>` : "";
}
function overview() {
  return `<div class="intro-row">${hero()}${weeklyCard()}</div>${stats()}<div class="content-columns"><section class="goals-section"><div class="section-heading"><h2>Your goals <span>${state.data.stats.active}</span></h2><a class="text-button" href="#goals">View all goals ${icon("arrow")}</a></div><div class="goal-tools">${statusTabs()}${searchBox()}</div><div class="goals-grid" id="goals-grid">${goalGrid()}</div></section><aside class="side-panel">${todayCard()}${activityPanel()}</aside></div>${sampleBanner()}`;
}
function goalsPage() {
  return `<div class="all-goals-toolbar">${statusTabs()}${searchBox()}<div class="filter-controls"><select class="filter-select" id="category-filter" aria-label="Filter by category"><option value="all">All categories</option>${state.data.categories.map(c => `<option ${state.category === c ? "selected" : ""}>${c}</option>`).join("")}</select><select class="filter-select" id="sort-filter" aria-label="Sort goals"><option value="newest" ${state.sort === "newest" ? "selected" : ""}>Newest first</option><option value="due" ${state.sort === "due" ? "selected" : ""}>Target date</option><option value="progress" ${state.sort === "progress" ? "selected" : ""}>Most progress</option></select></div></div><p class="view-summary" id="goal-summary">${plural(filteredGoals().length, "goal")} · One small step at a time.</p><div class="goals-grid all-goals-grid" id="goals-grid">${goalGrid()}</div>${sampleBanner()}`;
}
function insightsPage() {
  const breakdown = state.data.categories.map(category => {
    const goals = state.data.goals.filter(g => g.category === category);
    return { category, count: goals.length, progress: goals.length ? Math.round(goals.reduce((s, g) => s + g.progress, 0) / goals.length) : 0 };
  }).filter(c => c.count);
  return `${stats()}<div class="insights-grid"><section class="glass-card insights-card"><div class="card-heading"><h2>Your weekly rhythm</h2><span class="subtle-tag">Last 7 days</span></div><p>${plural(state.data.stats.week_entries, "check-in")}. Each one a little promise kept.</p>${weeklyChart()}</section><section class="glass-card insights-card"><h2>A little growth in every direction</h2><p>Average progress for the goals in each part of your life.</p>${breakdown.length ? breakdown.map(c => `<div class="category-row" style="${categoryStyle(c.category)}"><div><span>${c.category} <small>· ${plural(c.count, "goal")}</small></span><strong>${c.progress}%</strong></div><div class="progress-track"><div class="progress-fill" style="--progress:${c.progress}%"></div></div></div>`).join("") : `<p class="today-intro">Set your first goal to start seeing the bigger picture.</p>`}</section></div><div class="insight-note">${icon("leaf")}<div><strong>Your pace is the right pace.</strong><p>A streak counts consecutive days with a check-in, including yesterday if you haven’t logged today. Overall progress gives every goal equal weight.</p></div></div>${sampleBanner()}`;
}
function journalPage() {
  const groups = Object.groupBy(state.data.entries, e => e.logged_on);
  return `<div class="journal-toolbar"><p>${plural(state.data.entries.length, "check-in")} along the way. Every one counts.</p><button class="button secondary" data-action="export">${icon("download")}Export JSON</button></div>${state.data.entries.length ? Object.entries(groups).map(([day, entries]) => `<section class="journal-day"><h2 class="journal-date">${relativeDay(day)} <span>· ${dateLabel(day, { month: "long", day: "numeric", year: "numeric" })}</span></h2>${entries.map(e => `<article class="journal-entry" style="${categoryStyle(e.category)}"><span class="category-icon">${icon(categories[e.category].icon)}</span><div class="journal-entry-body"><h3>+${number(e.amount)} ${escapeHTML(e.unit)} · ${escapeHTML(e.title)}</h3>${e.note ? `<p>${escapeHTML(e.note)}</p>` : ""}<small>${escapeHTML(e.category)}</small></div><time datetime="${escapeHTML(e.created_at)}">${new Date(e.created_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</time><button class="icon-button" data-action="undo" data-id="${e.id}" aria-label="Undo this ${escapeHTML(e.title)} entry">${icon("trash")}</button></article>`).join("")}</section>`).join("") : `<div class="empty-state"><div class="empty-icon">${icon("book")}</div><h3>Your story is just beginning</h3><p>Log progress on a goal and leave a little note. This is where your journey comes together.</p><a href="#goals" class="button primary">Go to my goals ${icon("arrow")}</a></div>`}`;
}

function showModal(title, body, { eyebrow = "A LITTLE CLOSER", intro = "" } = {}) {
  $("#modal-content").innerHTML = `<div class="modal-header"><div><div class="modal-eyebrow">${eyebrow}</div><h2 id="modal-title">${escapeHTML(title)}</h2></div><button class="icon-button" data-action="close" aria-label="Close dialog">${icon("close")}</button></div>${intro ? `<p class="modal-intro">${intro}</p>` : ""}<div class="modal-body">${body}</div>`;
  if (!modal.open) modal.showModal();
  document.body.style.overflow = "hidden";
  const focusTarget = $("[autofocus]", modal) || $("[data-action='close']", modal);
  focusTarget?.focus({ preventScroll: true });
}
function closeModal() { modal.close(); }
modal.addEventListener("close", () => { document.body.style.overflow = ""; });
function formError(message) { const error = $("#form-error"); if (error) { error.textContent = message; error.hidden = false; } else toast(message, true); }
function goalForm(goal = null) {
  showModal(goal ? "A little change of direction" : "What would you love to grow?", `<form id="goal-form" ${goal ? `data-id="${goal.id}"` : ""}><div id="form-error" class="form-error" role="alert" hidden></div><div class="field"><label for="title">Give your goal a name</label><input id="title" name="title" placeholder="e.g. Read 12 books this year" value="${escapeHTML(goal?.title || "")}" maxlength="100" required autofocus></div><div class="field"><label for="description">Your reason why <span>· optional</span></label><textarea id="description" name="description" maxlength="500" placeholder="What would making this happen mean to you?">${escapeHTML(goal?.description || "")}</textarea></div><div class="field-row"><div class="field"><label for="target">Your target</label><input type="number" inputmode="decimal" name="target" id="target" min="0.0001" max="1000000000" step="0.0001" placeholder="12" value="${goal?.target ?? ""}" required></div><div class="field"><label for="unit">Measured in</label><input id="unit" name="unit" placeholder="books, km, sessions…" value="${escapeHTML(goal?.unit || "")}" maxlength="30" required></div></div><div class="field-row"><div class="field"><label for="category">A part of your life</label><select id="category" name="category">${state.data.categories.map(c => `<option ${c === (goal?.category || "Personal") ? "selected" : ""}>${c}</option>`).join("")}</select></div><div class="field"><label for="due_date">Target date <span>· optional</span></label><input type="date" id="due_date" name="due_date" value="${escapeHTML(goal?.due_date || "")}"></div></div><p class="field-hint">Make it specific. Keep it kind. You can adjust your goal as you grow.</p><div class="modal-footer"><button type="button" class="button ghost" data-action="close">Cancel</button><button class="button primary" type="submit">${icon(goal ? "check" : "plus")}${goal ? "Save changes" : "Plant this goal"}</button></div></form>`, { intro: "Big or small, it starts with a little intention." });
}
function progressForm(goal) {
  const remaining = Math.max(0, Number((goal.target - goal.current).toFixed(4)));
  showModal("A little step worth celebrating", `<form id="progress-form" data-id="${goal.id}"><div id="form-error" class="form-error" role="alert" hidden></div><div class="detail-meta" style="${categoryStyle(goal.category)}"><span class="goal-category">${goal.category}</span><strong>${escapeHTML(goal.title)}</strong></div><div class="field"><label for="amount">How much progress did you make? <span>· ${escapeHTML(goal.unit)}</span></label><input type="number" inputmode="decimal" id="amount" name="amount" min="0.0001" max="${remaining}" step="0.0001" value="${Math.min(1, remaining)}" required autofocus><span class="field-hint">${number(goal.current)} of ${number(goal.target)} ${escapeHTML(goal.unit)} so far · ${number(remaining)} to go.</span></div><div class="field"><label for="note">Leave a little note <span>· optional</span></label><textarea id="note" name="note" placeholder="How did it feel? What did you learn?" maxlength="500"></textarea></div><p class="field-hint">This check-in will be saved for today, ${dateLabel(state.data.today, { month: "long", day: "numeric" })}.</p><div class="modal-footer"><button type="button" class="button ghost" data-action="close">Cancel</button><button type="submit" class="button primary">${icon("check")}Save my progress</button></div></form>`, { intro: "Showing up is what matters. Let’s make a note of it." });
}
function goalDetail(goal) {
  const entries = state.data.entries.filter(e => e.goal_id === goal.id);
  showModal(goal.title, `<div style="${categoryStyle(goal.category)}"><div class="detail-meta"><span class="goal-category">${goal.category}</span><span class="due-label">${icon("calendar")}${goal.due_date ? `Target: ${dateLabel(goal.due_date, { month: "short", day: "numeric", year: "numeric" })}` : "At your own pace"}</span>${goal.sample ? `<span class="subtle-tag">Sample goal</span>` : ""}</div><p class="detail-description">${escapeHTML(goal.description || "A little closer, every day.")}</p><div class="goal-detail-stats"><strong>${number(goal.current)}</strong><span>/ ${number(goal.target)} ${escapeHTML(goal.unit)} · ${goal.progress}%</span></div><div class="progress-track"><div class="progress-fill" style="--progress:${goal.progress}%"></div></div></div><div class="detail-actions">${goal.completed ? `<span class="button soft">${icon("spark")}You made it happen</span>` : `<button class="button primary" data-action="log" data-id="${goal.id}">${icon("plus")}Log progress</button>`}<button class="button secondary" data-action="edit" data-id="${goal.id}">${icon("edit")}Edit</button><button class="icon-button" data-action="delete" data-id="${goal.id}" aria-label="Delete goal">${icon("trash")}</button></div><div class="detail-history"><h3>The little steps along the way · ${entries.length}</h3>${entries.map(e => `<div class="detail-entry"><div><strong>+${number(e.amount)} ${escapeHTML(goal.unit)}</strong>${e.note ? `<p>${escapeHTML(e.note)}</p>` : ""}</div><time datetime="${e.logged_on}">${relativeDay(e.logged_on)}</time><button class="icon-button" data-action="undo" data-id="${e.id}" aria-label="Undo this entry">${icon("trash", "small")}</button></div>`).join("") || `<p class="today-intro">Your first step is waiting. Let’s make it a small one.</p>`}</div>`, { eyebrow: goal.completed ? "A MOMENT TO CELEBRATE" : "YOUR GOAL, YOUR PACE" });
}
function confirmDialog(title, message, action, label, id = "") {
  showModal(title, `<p class="confirm-copy">${message}</p><div id="form-error" class="form-error" role="alert" hidden></div><div class="modal-footer"><button class="button ghost" data-action="close">Keep it</button><button class="button danger" data-action="${action}" data-id="${id}">${label}</button></div>`, { eyebrow: "A MOMENT TO MAKE SURE" });
}
function about() {
  showModal("A calmer kind of ambition", `<div class="about-mark">${icon("leaf")}</div><div class="about-copy"><p>Goalify is a little space for the things that matter to you. <strong>Set a measurable goal, take a small step, and make a note of it.</strong></p><p>Your goals and check-ins are saved in a SQLite database on this computer. No account, no cloud sync, just your own space to grow. This version is a personal, local workspace.</p><p>Sample goals are here to help you explore. Clearing samples also clears their history, while keeping any goals you create.</p><p>The app is powered by Python. The goal service and JSON API are separate from the interface, ready to support another client later.</p></div><div class="modal-footer"><button class="button primary" data-action="close">Here’s to a little progress ${icon("leaf")}</button></div>`, { eyebrow: "MEET GOALIFY" });
}
function exportJournal() {
  const { goals, entries } = state.data;
  const blob = new Blob([JSON.stringify({ app: "Goalify", version: 1, exported_at: new Date().toISOString(), goals, entries }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `goalify-${state.data.today}.json`; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast("Your goals and journal, ready to keep.");
}
async function performAction(button) {
  const { action, id } = button.dataset;
  const goal = id ? goalById(id) : null;
  switch (action) {
    case "new": goalForm(); break;
    case "close": closeModal(); break;
    case "detail": if (goal) goalDetail(goal); break;
    case "log": if (goal && !goal.completed) progressForm(goal); break;
    case "edit": if (goal) goalForm(goal); break;
    case "status": state.status = button.dataset.status; render(); break;
    case "reset-filters": state.search = ""; state.category = "all"; render(); break;
    case "export": exportJournal(); break;
    case "delete": if (goal) confirmDialog("Let this goal go?", `“${escapeHTML(goal.title)}” and all its check-ins will be permanently deleted. It’s okay to make room for something else.`, "confirm-delete", "Delete goal", id); break;
    case "undo": confirmDialog("Undo this little step?", "This check-in and its note will be permanently removed. Your goal’s progress and insights will update too.", "confirm-undo", "Undo check-in", id); break;
    case "clear-samples": confirmDialog("Ready to make this space yours?", "All sample goals and their check-ins will be deleted, including any changes you’ve made to them. Goals you created will stay right here.", "confirm-samples", "Clear sample goals"); break;
    case "confirm-delete":
    case "confirm-undo":
    case "confirm-samples": {
      const path = action === "confirm-delete" ? `/api/goals/${id}` : action === "confirm-undo" ? `/api/entries/${id}` : "/api/samples";
      button.disabled = true;
      try { await api(path, { method: "DELETE" }); closeModal(); await refresh(); toast(action === "confirm-delete" ? "A little room for what comes next." : action === "confirm-undo" ? "Check-in removed. Your progress is up to date." : "A fresh space for your own goals."); }
      catch (error) { formError(error.message); }
      finally { button.disabled = false; }
      break;
    }
  }
}
document.addEventListener("click", event => {
  const button = event.target.closest("[data-action]");
  if (button) performAction(button).catch(error => toast(error.message, true));
});
document.addEventListener("submit", async event => {
  const form = event.target;
  if (!["goal-form", "progress-form"].includes(form.id)) return;
  event.preventDefault();
  const submit = $("button[type='submit']", form);
  submit.disabled = true;
  $("#form-error").hidden = true;
  const data = Object.fromEntries(new FormData(form));
  const isProgress = form.id === "progress-form";
  const id = form.dataset.id;
  const path = isProgress ? `/api/goals/${id}/entries` : id ? `/api/goals/${id}` : "/api/goals";
  try {
    await api(path, { method: isProgress || !id ? "POST" : "PATCH", body: JSON.stringify(data) });
    closeModal();
    await refresh();
    const completed = isProgress && goalById(id)?.completed;
    toast(completed ? "You did it. A whole goal, made real. ✨" : isProgress ? "A little closer. Your progress is saved." : id ? "A fresh direction. Changes saved." : "A new beginning. Your goal is planted.");
  } catch (error) { formError(error.message); }
  finally { submit.disabled = false; }
});
content.addEventListener("input", event => {
  if (event.target.id !== "goal-search") return;
  state.search = event.target.value;
  $("#goals-grid").innerHTML = goalGrid();
  if ($("#goal-summary")) $("#goal-summary").textContent = `${plural(filteredGoals().length, "goal")} · One small step at a time.`;
});
content.addEventListener("change", event => {
  if (event.target.id === "category-filter") state.category = event.target.value;
  else if (event.target.id === "sort-filter") state.sort = event.target.value;
  else return;
  render();
});
function toggleSidebar(open) {
  $("#sidebar").classList.toggle("open", open);
  $("#sidebar-scrim").classList.toggle("open", open);
  $("#menu-button").setAttribute("aria-expanded", String(open));
}
$("#menu-button").addEventListener("click", () => toggleSidebar(!$("#sidebar").classList.contains("open")));
$("#sidebar-scrim").addEventListener("click", () => toggleSidebar(false));
$("#new-goal").addEventListener("click", () => { if (state.data) goalForm(); });
$("#sidebar-new").addEventListener("click", () => { toggleSidebar(false); if (state.data) goalForm(); });
$("#about-button").addEventListener("click", about);
document.addEventListener("keydown", event => {
  if (event.key === "Escape") toggleSidebar(false);
  if ((event.ctrlKey || event.metaKey) && event.key === "k") { const search = $("#goal-search"); if (search && !modal.open) { event.preventDefault(); search.focus(); } }
});
window.addEventListener("hashchange", navigate);
navigate();
refresh().catch(() => {
  $("#loading").innerHTML = `<div class="empty-icon">${icon("leaf")}</div><h3>Let’s reconnect to your workspace</h3><p>The Python server isn’t responding. Make sure it’s running, then reload.</p><button class="button secondary" id="retry-button">Try again</button>`;
  $("#retry-button").addEventListener("click", () => location.reload());
  toast("Couldn’t load your goals. Your saved data is still on this computer.", true);
});
