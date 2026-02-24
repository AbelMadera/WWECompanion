// Universe Booker - mobile-first, smooth LocalStorage MVP
// Storage isolated so you can swap to a DB later.

const STORAGE_KEY = "universeBooker.v2";
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function uid(prefix = "id") {
    return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}
function todayISO() {
    const d = new Date(); d.setHours(0, 0, 0, 0);
    return d.toISOString().slice(0, 10);
}
function parseISO(iso) {
    const [y, m, dd] = iso.split("-").map(Number);
    return new Date(y, m - 1, dd);
}
function formatMonthTitle(date) {
    return date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}
function safeJSONParse(txt) {
    try { return JSON.parse(txt); } catch { return null; }
}
function escapeHTML(str) {
    return String(str ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}
function escapeAttr(str) { return escapeHTML(str).replaceAll("\n", " "); }

// -------------------- DATA --------------------
function defaultState() {
    return {
        version: 2,
        shows: [],        // {id, name, color}
        superstars: [],   // {id, name, showId, division}
        events: [],       // {id, date, type:"weekly"|"ppv", showId|null, name, matches:[...], defaultRows?}
        createdAt: Date.now(),
        updatedAt: Date.now(),
    };
}

const store = {
    load() {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return defaultState();
        const parsed = safeJSONParse(raw);
        return parsed && parsed.version ? parsed : defaultState();
    },
    save(state) {
        state.updatedAt = Date.now();
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    },
    wipe() {
        localStorage.removeItem(STORAGE_KEY);
    }
};

let state = store.load();

// Debounced saving (smooth typing)
let saveTimer = null;
function saveSoon() {
    $("#saveState")?.classList.remove("muted");
    $("#saveState") && ($("#saveState").textContent = "Saving…");
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        store.save(state);
        $("#saveState") && ($("#saveState").textContent = "Saved");
        $("#saveState")?.classList.add("muted");
    }, 250);
}

// -------------------- HELPERS --------------------
function getShow(showId) { return state.shows.find(s => s.id === showId) || null; }
function showName(showId) {
    if (!showId) return "No show";
    const s = getShow(showId);
    return s ? s.name : "Unknown show";
}
function showColor(showId) { return getShow(showId)?.color || "#888"; }
function rosterForShow(showId) { return state.superstars.filter(ss => ss.showId === showId); }
function getEvent(eventId) { return state.events.find(e => e.id === eventId) || null; }
function upsertEvent(event) {
    const idx = state.events.findIndex(e => e.id === event.id);
    if (idx >= 0) state.events[idx] = event;
    else state.events.push(event);
    state.events.sort((a, b) => a.date.localeCompare(b.date));
    saveSoon();
}
function deleteEvent(eventId) {
    state.events = state.events.filter(e => e.id !== eventId);
    saveSoon();
}

// -------------------- ROUTER --------------------
const views = ["dashboard", "calendar", "planner", "shows", "roster", "settings"];
let currentView = "dashboard";

function setActiveNav(view) {
    $$(".nav-btn").forEach(b => b.classList.toggle("active", b.dataset.view === view));
    $$(".bnav-btn").forEach(b => b.classList.toggle("active", b.dataset.view === view));
}
function setView(view) {
    currentView = view;
    setActiveNav(view);

    views.forEach(v => $(`#view-${v}`).classList.toggle("hidden", v !== view));

    const titles = {
        dashboard: ["Dashboard", ""],
        calendar: ["Calendar", "Shows + PLEs on a timeline"],
        planner: ["Planner", "Book your cards like your spreadsheet"],
        shows: ["Shows", "Create/remove shows & colors"],
        roster: ["Roster", "Add superstars, assign shows + divisions"],
        settings: ["Settings", "Import shows, roster, and PLEs from JSON"],
    };
    $("#viewTitle").textContent = titles[view][0];
    $("#viewSubtitle").textContent = titles[view][1];

    renderAll();
}

// -------------------- MODAL --------------------
const modal = $("#modal");
let modalResolve = null;

function openModal({ title, bodyHTML, okText = "OK", cancelText = "Cancel" }) {
    $("#modalTitle").textContent = title;
    $("#modalBody").innerHTML = bodyHTML;
    $("#modalOk").textContent = okText;
    $("#modalCancel").textContent = cancelText;
    modal.classList.remove("hidden");
    modal.setAttribute("aria-hidden", "false");
    return new Promise(res => modalResolve = res);
}
function closeModal(result) {
    modal.classList.add("hidden");
    modal.setAttribute("aria-hidden", "true");
    if (modalResolve) modalResolve(result);
    modalResolve = null;
}
$("#modalCancel").addEventListener("click", () => closeModal({ ok: false }));
$("#modalOk").addEventListener("click", () => closeModal({ ok: true }));

// -------------------- DASHBOARD --------------------
function renderDashboard() {
    const el = $("#nextEvent");
    const upcoming = state.events
        .filter(e => e.date >= todayISO())
        .sort((a, b) => a.date.localeCompare(b.date))[0];

    if (!upcoming) {
        el.innerHTML = `<div class="muted">No upcoming events. Add one from Calendar or Settings.</div>`;
    } else {
        const dot = `<span class="dot" style="background:${showColor(upcoming.showId)}"></span>`;
        el.innerHTML = `
      <div class="row gap wrap">
        <span class="badge">${dot}${escapeHTML(upcoming.type.toUpperCase())}</span>
        <span class="badge"><span class="dot" style="background:${showColor(upcoming.showId)}"></span>${escapeHTML(showName(upcoming.showId))}</span>
        <span class="badge">${upcoming.date}</span>
      </div>
      <div class="hr"></div>
      <div><b>${escapeHTML(upcoming.name || "(Unnamed Event)")}</b></div>
      <div class="muted">Rows: ${(upcoming.matches?.length || 0)}</div>
      <div class="item-actions">
        <button class="btn" data-open-planner="${upcoming.id}">Open Planner</button>
      </div>
    `;
        el.querySelector('[data-open-planner]')?.addEventListener("click", () => openPlanner(upcoming.id));
    }

    $("#stats").innerHTML = `
    <div class="row gap wrap">
      <span class="badge"><span class="dot"></span>Shows: <b>${state.shows.length}</b></span>
      <span class="badge"><span class="dot"></span>Superstars: <b>${state.superstars.length}</b></span>
      <span class="badge"><span class="dot"></span>Events: <b>${state.events.length}</b></span>
    </div>
  `;
}

// -------------------- SHOWS --------------------
function renderShows() {
    populateShowSelects();

    const list = $("#showsList");
    if (state.shows.length === 0) {
        list.innerHTML = `<div class="muted">No shows yet. Add RAW/SmackDown/NXT/etc.</div>`;
        return;
    }

    list.innerHTML = `
    <div class="list">
      ${state.shows.map(s => `
        <div class="item">
          <div class="item-title">
            <span class="badge"><span class="dot" style="background:${s.color}"></span>${escapeHTML(s.name)}</span>
          </div>
          <div class="item-sub">${rosterForShow(s.id).length} superstars</div>
          <div class="item-actions">
            <button class="btn danger" data-del-show="${s.id}">Delete</button>
          </div>
        </div>
      `).join("")}
    </div>
  `;

    $$("[data-del-show]").forEach(btn => {
        btn.addEventListener("click", async () => {
            const id = btn.dataset.delShow;
            const s = getShow(id);
            const ok = await openModal({
                title: "Delete show?",
                bodyHTML: `
          <div>Delete <b>${escapeHTML(s?.name || "this show")}</b>?</div>
          <div class="muted tiny">Superstars assigned to it become unassigned. Existing events keep their showId but will display as “Unknown”.</div>
        `,
                okText: "Delete"
            });
            if (!ok.ok) return;

            state.superstars = state.superstars.map(ss => ss.showId === id ? { ...ss, showId: null } : ss);
            state.shows = state.shows.filter(x => x.id !== id);
            saveSoon();
            renderAll();
        });
    });
}

// -------------------- ROSTER --------------------
function renderRoster() {
    populateShowSelects();

    const search = $("#rosterSearch").value.trim().toLowerCase();
    const showFilter = $("#rosterFilter").value || "all";

    const rows = state.superstars
        .filter(ss => showFilter === "all" ? true : (ss.showId === showFilter))
        .filter(ss => !search ? true : ss.name.toLowerCase().includes(search))
        .sort((a, b) => a.name.localeCompare(b.name));

    const list = $("#rosterList");
    if (rows.length === 0) {
        list.innerHTML = `<div class="muted">No superstars match your filters.</div>`;
        return;
    }

    list.innerHTML = `
    <div class="list">
      ${rows.map(ss => {
        const dot = `<span class="dot" style="background:${showColor(ss.showId)}"></span>`;
        return `
          <div class="item">
            <div class="item-title">${escapeHTML(ss.name)}</div>
            <div class="row gap wrap">
              <span class="badge">${dot}${escapeHTML(showName(ss.showId))}</span>
              <span class="badge">Division: <b>${escapeHTML(ss.division)}</b></span>
            </div>
            <div class="item-actions">
              <button class="btn secondary" data-edit-ss="${ss.id}">Edit</button>
              <button class="btn danger" data-del-ss="${ss.id}">Delete</button>
            </div>
          </div>
        `;
    }).join("")}
    </div>
  `;

    $$("[data-del-ss]").forEach(btn => {
        btn.addEventListener("click", async () => {
            const id = btn.dataset.delSs;
            const ss = state.superstars.find(x => x.id === id);
            const ok = await openModal({
                title: "Delete superstar?",
                bodyHTML: `<div>Delete <b>${escapeHTML(ss?.name || "this superstar")}</b>?</div>`,
                okText: "Delete"
            });
            if (!ok.ok) return;

            state.superstars = state.superstars.filter(x => x.id !== id);
            saveSoon();
            renderRoster();
            renderPlannerEventSelect();
        });
    });

    $$("[data-edit-ss]").forEach(btn => {
        btn.addEventListener("click", async () => {
            const id = btn.dataset.editSs;
            const ss = state.superstars.find(x => x.id === id);
            if (!ss) return;

            const showOptions = [
                `<option value="">Unassigned</option>`,
                ...state.shows.map(s => `<option value="${s.id}" ${s.id === ss.showId ? "selected" : ""}>${escapeHTML(s.name)}</option>`)
            ].join("");

            const bodyHTML = `
        <div class="stack">
          <input id="editSSName" class="input" value="${escapeAttr(ss.name)}" />
          <select id="editSSShow" class="input">${showOptions}</select>
          <select id="editSSDiv" class="input">
            ${["World", "Midcard", "Tag", "Women", "Other"].map(d => `<option value="${d}" ${d === ss.division ? "selected" : ""}>${d}</option>`).join("")}
          </select>
          <div class="muted tiny">Tip: Keep divisions consistent per show for future belts/rankings.</div>
        </div>
      `;

            const ok = await openModal({ title: "Edit Superstar", bodyHTML, okText: "Save" });
            if (!ok.ok) return;

            const newName = $("#editSSName").value.trim();
            const newShow = $("#editSSShow").value || null;
            const newDiv = $("#editSSDiv").value;

            if (!newName) return;

            state.superstars = state.superstars.map(x => x.id === id ? { ...x, name: newName, showId: newShow, division: newDiv } : x);
            saveSoon();
            renderRoster();
            renderPlanner();
        });
    });
}

// -------------------- CALENDAR --------------------
let calCursor = new Date(); calCursor.setDate(1);
let calSelectedISO = todayISO();

function renderCalendar() {
    populateShowSelects();
    $("#calendarTitle").textContent = formatMonthTitle(calCursor);

    const showFilter = $("#calShowFilter").value || "all";

    const first = new Date(calCursor);
    const dayOfWeek = first.getDay(); // 0 Sunday
    const gridStart = new Date(first);
    gridStart.setDate(first.getDate() - dayOfWeek);

    const cells = [];
    for (let i = 0; i < 42; i++) {
        const d = new Date(gridStart);
        d.setDate(gridStart.getDate() + i);
        const iso = d.toISOString().slice(0, 10);

        const inMonth = d.getMonth() === calCursor.getMonth();
        const day = d.getDate();

        const events = state.events
            .filter(e => e.date === iso)
            .filter(e => showFilter === "all" ? true : (e.showId === showFilter));

        const visibleEvents = events.slice(0, 2);
        const badges = visibleEvents.map(e => {
            const shortType = e.type === "ppv" ? "PLE" : "WK";
            return `<span class="cal-pill" title="${escapeAttr(e.name || "(Unnamed Event)")}">${shortType}</span>`;
        }).join("");
        const overflow = events.length > visibleEvents.length
            ? `<span class="cal-more">+${events.length - visibleEvents.length}</span>`
            : "";

        cells.push(`
      <div class="cal-cell" data-date="${iso}"
        style="opacity:${inMonth ? 1 : 0.45}; outline:${iso === calSelectedISO ? '2px solid rgba(255,255,255,.25)' : 'none'}">
        <div class="cal-date">${day}</div>
        <div class="cal-badges">${badges}${overflow}</div>
      </div>
    `);
    }

    $("#calendarGrid").innerHTML = cells.join("");

    $$("[data-date]", $("#calendarGrid")).forEach(cell => {
        cell.addEventListener("click", () => {
            calSelectedISO = cell.dataset.date;
            renderCalendar();
            renderEventsOnSelectedDate();
        });
    });

    renderEventsOnSelectedDate();
}

function renderEventsOnSelectedDate() {
    const showFilter = $("#calShowFilter").value || "all";
    const list = $("#eventsList");

    const events = state.events
        .filter(e => e.date === calSelectedISO)
        .filter(e => showFilter === "all" ? true : (e.showId === showFilter));

    if (events.length === 0) {
        list.innerHTML = `<div class="muted">No events on <b>${calSelectedISO}</b>.</div>`;
        return;
    }

    list.innerHTML = `
    <div class="list">
      ${events.map(e => {
        const dot = `<span class="dot" style="background:${showColor(e.showId)}"></span>`;
        return `
          <div class="item">
            <div class="item-title">${escapeHTML(e.name || "(Unnamed Event)")}</div>
            <div class="row gap wrap">
              <span class="badge">${dot}${escapeHTML(showName(e.showId))}</span>
              <span class="badge">${escapeHTML(e.type.toUpperCase())}</span>
              <span class="badge">${e.date}</span>
              <span class="badge">Rows: <b>${e.matches?.length || 0}</b></span>
            </div>
            <div class="item-actions">
              <button class="btn" data-open-planner="${e.id}">Open Planner</button>
              <button class="btn danger" data-del-event="${e.id}">Delete</button>
            </div>
          </div>
        `;
    }).join("")}
    </div>
  `;

    $$("[data-open-planner]").forEach(btn => {
        btn.addEventListener("click", () => openPlanner(btn.dataset.openPlanner));
    });

    $$("[data-del-event]").forEach(btn => {
        btn.addEventListener("click", async () => {
            const id = btn.dataset.delEvent;
            const ev = getEvent(id);
            const ok = await openModal({
                title: "Delete event?",
                bodyHTML: `<div>Delete <b>${escapeHTML(ev?.name || "this event")}</b> on ${ev?.date}?</div>`,
                okText: "Delete"
            });
            if (!ok.ok) return;

            deleteEvent(id);
            renderAll();
        });
    });
}

async function addEventFlow(dateISO = calSelectedISO) {
    const showOptions = [
        `<option value="">(No show)</option>`,
        ...state.shows.map(s => `<option value="${s.id}">${escapeHTML(s.name)}</option>`)
    ].join("");

    const bodyHTML = `
    <div class="stack">
      <input id="evDate" class="input" type="date" value="${dateISO}" />
      <select id="evType" class="input">
        <option value="weekly">Weekly</option>
        <option value="ppv">PLE / PPV</option>
      </select>
      <select id="evShow" class="input">${showOptions}</select>
      <input id="evName" class="input" placeholder="Event name (e.g., May - Week 1)" />
      <div class="muted tiny">Tip: You can bulk-create schedules in Settings.</div>
    </div>
  `;

    const ok = await openModal({ title: "Add Event", bodyHTML, okText: "Create" });
    if (!ok.ok) return;

    const date = $("#evDate").value;
    const type = $("#evType").value;
    const showId = $("#evShow").value || null;
    const name = $("#evName").value.trim() || (type === "ppv" ? "PLE / PPV" : "Weekly Show");

    const event = { id: uid("event"), date, type, showId, name, matches: [] };
    upsertEvent(event);

    calSelectedISO = date;
    openPlanner(event.id);
}

// -------------------- PLANNER (optimized, no full rerender on typing) --------------------
let plannerEventId = null;

function renderPlannerEventSelect() {
    const sel = $("#plannerEventSelect");
    if (!sel) return;

    const events = [...state.events].sort((a, b) => a.date.localeCompare(b.date));

    sel.innerHTML = events.length
        ? events.map(e => `<option value="${e.id}">${e.date} • ${escapeHTML(e.name || "(Unnamed)")} • ${escapeHTML(showName(e.showId))}</option>`).join("")
        : `<option value="">No events yet (create one)</option>`;

    if (!plannerEventId && events.length) plannerEventId = events[0].id;
    if (plannerEventId && events.some(e => e.id === plannerEventId)) sel.value = plannerEventId;

    sel.onchange = () => {
        plannerEventId = sel.value || null;
        renderPlanner(); // re-render on event switch only
    };
}

function plannerRosterOptions(ev) {
    const roster = ev.showId ? rosterForShow(ev.showId) : state.superstars;
    return roster
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(ss => `<option value="${ss.id}">${escapeHTML(ss.name)} (${escapeHTML(ss.division)})</option>`)
        .join("");
}

function renderPlanner() {
    renderPlannerEventSelect();
    const meta = $("#plannerMeta");
    const body = $("#matchesBody");

    if (!plannerEventId) {
        meta.textContent = "Create an event to start planning.";
        body.innerHTML = "";
        return;
    }

    const ev = getEvent(plannerEventId);
    if (!ev) {
        meta.textContent = "Event not found.";
        body.innerHTML = "";
        return;
    }

    meta.textContent = `${ev.date} • ${ev.type.toUpperCase()} • ${showName(ev.showId)} • ${ev.matches.length} rows`;

    const optionsHTML = plannerRosterOptions(ev);

    body.innerHTML = ev.matches.map((m, idx) => {
        const p = m.participants || [];
        return `
      <tr data-row="${idx}">
        <td>
          <input class="cell-input small" data-field="num" inputmode="numeric" value="${escapeAttr(m.num ?? (idx + 1))}" />
        </td>
        <td>
          <div class="stack">
            <select class="cell-input small" data-field="p1">
              <option value="">(select)</option>
              ${optionsHTML}
            </select>
            <select class="cell-input small" data-field="p2">
              <option value="">(select)</option>
              ${optionsHTML}
            </select>
            <div class="row gap wrap">
              <select class="cell-input small" data-field="p3">
                <option value="">(optional)</option>
                ${optionsHTML}
              </select>
              <select class="cell-input small" data-field="p4">
                <option value="">(optional)</option>
                ${optionsHTML}
              </select>
            </div>
          </div>
        </td>
        <td>
          <input class="cell-input small" data-field="matchType" value="${escapeAttr(m.matchType || "")}" placeholder="1v1 / tag / promo…" />
        </td>
        <td>
          <textarea class="cell-input" data-field="storyline" placeholder="Storyline notes…">${escapeHTML(m.storyline || "")}</textarea>
        </td>
        <td>
          <input class="cell-input small" data-field="result" value="${escapeAttr(m.result || "")}" placeholder="Winner / finish…" />
        </td>
        <td>
          <textarea class="cell-input" data-field="rivalryNotes" placeholder="Rivalry notes…">${escapeHTML(m.rivalryNotes || "")}</textarea>
        </td>
        <td>
          <button class="btn danger" data-del-row="${idx}">X</button>
        </td>
      </tr>
    `;
    }).join("");

    // Set selected values after render (avoids brittle string replacement)
    $$("#matchesBody tr").forEach(tr => {
        const row = Number(tr.dataset.row);
        const match = ev.matches[row];
        const p = match.participants || [];

        tr.querySelector('[data-field="p1"]').value = p[0] || "";
        tr.querySelector('[data-field="p2"]').value = p[1] || "";
        tr.querySelector('[data-field="p3"]').value = p[2] || "";
        tr.querySelector('[data-field="p4"]').value = p[3] || "";
    });

    // One event listener for all inputs (event delegation)
    body.oninput = (e) => {
        const target = e.target;
        if (!target || !target.matches("[data-field]")) return;

        const tr = target.closest("tr");
        if (!tr) return;

        const row = Number(tr.dataset.row);
        const field = target.dataset.field;

        const ev2 = getEvent(plannerEventId);
        if (!ev2 || !ev2.matches[row]) return;

        if (field === "p1" || field === "p2" || field === "p3" || field === "p4") {
            const p1 = tr.querySelector('[data-field="p1"]').value;
            const p2 = tr.querySelector('[data-field="p2"]').value;
            const p3 = tr.querySelector('[data-field="p3"]').value;
            const p4 = tr.querySelector('[data-field="p4"]').value;
            ev2.matches[row].participants = [p1, p2, p3, p4].filter(Boolean);
        } else if (field === "num") {
            ev2.matches[row].num = Number(target.value) || (row + 1);
        } else {
            ev2.matches[row][field] = target.value;
        }

        upsertEvent(ev2); // debounced via saveSoon
    };

    // Delete row buttons
    $$("[data-del-row]").forEach(btn => {
        btn.addEventListener("click", () => {
            const idx = Number(btn.dataset.delRow);
            const ev2 = getEvent(plannerEventId);
            if (!ev2) return;
            ev2.matches.splice(idx, 1);
            ev2.matches = ev2.matches.map((m, i) => ({ ...m, num: m.num ?? (i + 1) }));
            upsertEvent(ev2);
            renderPlanner(); // re-render because rows changed
        });
    });
}

function addMatchRow() {
    if (!plannerEventId) return;
    const ev = getEvent(plannerEventId);
    if (!ev) return;

    ev.matches.push({
        num: ev.matches.length + 1,
        participants: [],
        matchType: "",
        storyline: "",
        result: "",
        rivalryNotes: "",
    });

    upsertEvent(ev);
    renderPlanner(); // re-render because rows changed
}

async function newEventFromPlanner() {
    if (state.shows.length === 0) {
        await openModal({
            title: "Add a show first",
            bodyHTML: `<div class="muted">Create at least one show (RAW/SD/etc.) so events can be assigned.</div>`,
            okText: "OK",
            cancelText: "Close"
        });
        return;
    }
    await addEventFlow(todayISO());
}

function openPlanner(eventId) {
    plannerEventId = eventId;
    setView("planner");
    renderPlanner();
}

// -------------------- SETTINGS: POPULATE / GENERATE --------------------
function renderSettingsTools() {
    // Settings view is static; nothing to hydrate on each render for now.
}

function createShowsFromBulk(text) {
    const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
    for (const line of lines) {
        const parts = line.split("|").map(p => p.trim());
        const name = parts[0];
        if (!name) continue;
        const color = parts[1]?.startsWith("#") ? parts[1] : randomShowColor(name);
        state.shows.push({ id: uid("show"), name, color });
    }
    saveSoon();
}

function randomShowColor(seed) {
    // deterministic-ish from seed
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
    const r = 80 + (h % 150);
    const g = 80 + ((h >> 8) % 150);
    const b = 80 + ((h >> 16) % 150);
    return `#${[r, g, b].map(x => x.toString(16).padStart(2, "0")).join("")}`;
}

function createRosterFromBulk(text, defaultShowId = null, defaultDiv = "World") {
    const lines = text.split("\n").map(l => l.trim()).filter(Boolean);

    // Map show name -> showId for quick matching
    const showMap = new Map(state.shows.map(s => [s.name.toLowerCase(), s.id]));

    for (const line of lines) {
        const parts = line.split("|").map(p => p.trim()).filter(Boolean);
        const name = parts[0];
        if (!name) continue;

        let showId = defaultShowId;
        let division = defaultDiv;

        if (parts[1]) {
            const showNameText = parts[1].toLowerCase();
            showId = showMap.get(showNameText) ?? defaultShowId;
        }
        if (parts[2]) {
            division = parts[2];
        }

        state.superstars.push({ id: uid("ss"), name, showId, division });
    }
    saveSoon();
}

function createPPVsFromBulk(text) {
    const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
    const showMap = new Map(state.shows.map(s => [s.name.toLowerCase(), s.id]));

    for (const line of lines) {
        const parts = line.split("|").map(p => p.trim()).filter(Boolean);
        const name = parts[0];
        const date = parts[1];
        if (!name || !date) continue;

        const maybeShowName = parts[2]?.toLowerCase();
        const showId = maybeShowName ? (showMap.get(maybeShowName) ?? null) : null;

        state.events.push({
            id: uid("event"),
            date,
            type: "ppv",
            showId,
            name,
            matches: []
        });
    }

    state.events.sort((a, b) => a.date.localeCompare(b.date));
    saveSoon();
}

function normalizeHexColor(color) {
    if (typeof color !== "string") return null;
    const c = color.trim();
    return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c) ? c : null;
}

function importPopulateJSON(payload, { replace = true } = {}) {
    if (!payload || typeof payload !== "object") {
        throw new Error("Invalid JSON root. Expected an object.");
    }

    if (replace) {
        state = defaultState();
        plannerEventId = null;
    }

    const showsInput = Array.isArray(payload.shows) ? payload.shows : [];
    const rosterInput = Array.isArray(payload.roster)
        ? payload.roster
        : (Array.isArray(payload.superstars) ? payload.superstars : []);
    const plesInput = Array.isArray(payload.ples)
        ? payload.ples
        : (Array.isArray(payload.ppvs) ? payload.ppvs : []);

    const showNameToId = new Map(state.shows.map(s => [s.name.toLowerCase(), s.id]));
    const showIdSet = new Set(state.shows.map(s => s.id));

    const result = { shows: 0, roster: 0, ples: 0 };

    for (const row of showsInput) {
        const name = typeof row === "string" ? row.trim() : String(row?.name ?? "").trim();
        if (!name) continue;

        const existingId = showNameToId.get(name.toLowerCase());
        if (existingId) continue;

        const color = normalizeHexColor(row?.color) || randomShowColor(name);
        const id = uid("show");
        state.shows.push({ id, name, color });
        showNameToId.set(name.toLowerCase(), id);
        showIdSet.add(id);
        result.shows += 1;
    }

    for (const row of rosterInput) {
        const name = typeof row === "string" ? row.trim() : String(row?.name ?? "").trim();
        if (!name) continue;

        const showFromName = String(row?.show ?? row?.showName ?? "").trim().toLowerCase();
        let showId = row?.showId ?? null;
        if (showFromName) showId = showNameToId.get(showFromName) ?? showId;
        if (showId && !showIdSet.has(showId)) showId = null;

        const division = String(row?.division ?? "World").trim() || "World";
        state.superstars.push({ id: uid("ss"), name, showId, division });
        result.roster += 1;
    }

    for (const row of plesInput) {
        const name = String(row?.name ?? "").trim();
        const date = String(row?.date ?? "").trim();
        if (!name || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;

        const showFromName = String(row?.show ?? row?.showName ?? "").trim().toLowerCase();
        let showId = row?.showId ?? null;
        if (showFromName) showId = showNameToId.get(showFromName) ?? showId;
        if (showId && !showIdSet.has(showId)) showId = null;

        state.events.push({
            id: uid("event"),
            date,
            type: "ppv",
            showId,
            name,
            matches: Array.isArray(row?.matches) ? row.matches : []
        });
        result.ples += 1;
    }

    state.events.sort((a, b) => a.date.localeCompare(b.date));
    saveSoon();
    return result;
}

function generateWeeklyEvents({ startISO, months, rules, defaultRows = 6 }) {
    // rules: [{showId, weekday}] where weekday is 0-6
    const start = parseISO(startISO);
    const end = new Date(start);
    end.setMonth(end.getMonth() + months);

    // Build a set of (date|showId) to avoid duplicates
    const existing = new Set(state.events.map(e => `${e.date}|${e.showId || ""}|${e.type}`));

    // Walk day by day
    let cur = new Date(start);
    while (cur <= end) {
        const iso = cur.toISOString().slice(0, 10);
        const dow = cur.getDay();

        for (const rule of rules) {
            if (rule.weekday === dow) {
                const key = `${iso}|${rule.showId}|weekly`;
                if (existing.has(key)) continue;

                const show = getShow(rule.showId);
                const name = `${show?.name || "Weekly"} • ${iso}`;
                const matches = Array.from({ length: Number(defaultRows) || 0 }).map((_, i) => ({
                    num: i + 1,
                    participants: [],
                    matchType: "",
                    storyline: "",
                    result: "",
                    rivalryNotes: "",
                }));

                state.events.push({
                    id: uid("event"),
                    date: iso,
                    type: "weekly",
                    showId: rule.showId,
                    name,
                    matches
                });

                existing.add(key);
            }
        }

        cur.setDate(cur.getDate() + 1);
    }

    state.events.sort((a, b) => a.date.localeCompare(b.date));
    saveSoon();
}

// Starter seed
function seedStarterUniverse() {
    state = defaultState();

    const raw = { id: uid("show"), name: "RAW", color: "#d00000" };
    const sd = { id: uid("show"), name: "SmackDown", color: "#1b5cff" };
    state.shows.push(raw, sd);

    const roster = [
        ["Gunther", raw.id, "World"],
        ["Sami Zayn", raw.id, "World"],
        ["Becky Lynch", raw.id, "Women"],
        ["Carmella", sd.id, "Women"],
        ["Shayna Baszler", sd.id, "Women"],
        ["Kevin Owens", raw.id, "World"],
        ["Jey Uso", raw.id, "World"],
        ["LA Knight", sd.id, "Midcard"],
    ];
    roster.forEach(([name, showId, division]) => {
        state.superstars.push({ id: uid("ss"), name, showId, division });
    });

    // Add one weekly today for RAW with 6 rows
    const iso = todayISO();
    state.events.push({
        id: uid("event"),
        date: iso,
        type: "weekly",
        showId: raw.id,
        name: `RAW • ${iso}`,
        matches: Array.from({ length: 6 }).map((_, i) => ({
            num: i + 1, participants: [], matchType: "", storyline: "", result: "", rivalryNotes: ""
        }))
    });

    saveSoon();
}

// -------------------- SELECT POPULATION --------------------
function populateShowSelects() {
    // roster form show select
    const ssShow = $("#ssShow");
    if (ssShow) {
        ssShow.innerHTML = [
            `<option value="">Unassigned</option>`,
            ...state.shows.map(s => `<option value="${s.id}">${escapeHTML(s.name)}</option>`)
        ].join("");
    }

    // roster filter
    const rosterFilter = $("#rosterFilter");
    if (rosterFilter) {
        const prev = rosterFilter.value || "all";
        rosterFilter.innerHTML = [
            `<option value="all">All shows</option>`,
            ...state.shows.map(s => `<option value="${s.id}">${escapeHTML(s.name)}</option>`)
        ].join("");
        rosterFilter.value = (state.shows.some(s => s.id === prev) || prev === "all") ? prev : "all";
        rosterFilter.onchange = () => renderRoster();
    }

    // calendar show filter
    const calShowFilter = $("#calShowFilter");
    if (calShowFilter) {
        const prev = calShowFilter.value || "all";
        calShowFilter.innerHTML = [
            `<option value="all">All shows</option>`,
            ...state.shows.map(s => `<option value="${s.id}">${escapeHTML(s.name)}</option>`)
        ].join("");
        calShowFilter.value = (state.shows.some(s => s.id === prev) || prev === "all") ? prev : "all";
        calShowFilter.onchange = () => renderCalendar();
    }
}

// -------------------- RENDER ALL --------------------
function renderAll() {
    populateShowSelects();

    if (currentView === "dashboard") renderDashboard();
    if (currentView === "calendar") renderCalendar();
    if (currentView === "planner") renderPlanner();
    if (currentView === "shows") renderShows();
    if (currentView === "roster") renderRoster();
    if (currentView === "settings") renderSettingsTools();
}

// -------------------- UI BINDINGS --------------------
// Desktop nav
$$(".nav-btn").forEach(btn => btn.addEventListener("click", () => setView(btn.dataset.view)));
// Mobile bottom nav
$$(".bnav-btn").forEach(btn => btn.addEventListener("click", () => setView(btn.dataset.view)));

$("#addShow").addEventListener("click", () => {
    const name = $("#showName").value.trim();
    const color = $("#showColor").value || "#d00000";
    if (!name) return;
    state.shows.push({ id: uid("show"), name, color });
    saveSoon();
    $("#showName").value = "";
    renderAll();
});

$("#addSS").addEventListener("click", () => {
    const name = $("#ssName").value.trim();
    const showId = $("#ssShow").value || null;
    const division = $("#ssDivision").value;
    if (!name) return;

    state.superstars.push({ id: uid("ss"), name, showId, division });
    saveSoon();
    $("#ssName").value = "";
    renderRoster();
});

$("#rosterSearch").addEventListener("input", () => renderRoster());

$("#calPrev").addEventListener("click", () => { calCursor.setMonth(calCursor.getMonth() - 1); renderCalendar(); });
$("#calNext").addEventListener("click", () => { calCursor.setMonth(calCursor.getMonth() + 1); renderCalendar(); });
$("#calToday").addEventListener("click", () => { calCursor = new Date(); calCursor.setDate(1); calSelectedISO = todayISO(); renderCalendar(); });

$("#addEventBtn").addEventListener("click", () => addEventFlow(calSelectedISO));

$("#addMatchRow").addEventListener("click", addMatchRow);
$("#plannerNewEvent").addEventListener("click", newEventFromPlanner);

$("#quickAddEvent").addEventListener("click", () => addEventFlow(todayISO()));
$("#quickOpenToday").addEventListener("click", () => {
    const iso = todayISO();
    const todayEvents = state.events.filter(e => e.date === iso).sort((a, b) => a.type.localeCompare(b.type));
    if (todayEvents[0]) openPlanner(todayEvents[0].id);
    else addEventFlow(iso);
});

// Export/Import/Reset
$("#exportBtn").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `universe-booker-export-${todayISO()}.json`;
    a.click();
    URL.revokeObjectURL(url);
});

$("#importInput").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const imported = safeJSONParse(text);
    if (!imported || !imported.version) {
        await openModal({
            title: "Import failed",
            bodyHTML: `<div class="muted">That file doesn't look like a Universe Booker export.</div>`,
            okText: "OK",
            cancelText: "Close"
        });
        return;
    }
    state = imported;
    store.save(state);
    renderAll();
    e.target.value = "";
});

$("#resetBtn").addEventListener("click", async () => {
    const ok = await openModal({
        title: "Reset app?",
        bodyHTML: `<div>Reset will clear LocalStorage and return to empty state.</div>`,
        okText: "Reset"
    });
    if (!ok.ok) return;
    store.wipe();
    state = store.load();
    plannerEventId = null;
    renderAll();
});

// Settings: Populate / Generate
$("#wipeBtn").addEventListener("click", async () => {
    const ok = await openModal({
        title: "Wipe everything?",
        bodyHTML: `<div>This deletes all shows, roster, and events.</div>`,
        okText: "Wipe"
    });
    if (!ok.ok) return;
    store.wipe();
    state = store.load();
    plannerEventId = null;
    renderAll();
});

$("#settingsClearFileBtn").addEventListener("click", () => {
    $("#settingsImportInput").value = "";
});

$("#settingsImportBtn").addEventListener("click", async () => {
    const input = $("#settingsImportInput");
    const file = input.files?.[0];
    if (!file) {
        await openModal({
            title: "No file selected",
            bodyHTML: `<div class="muted">Choose a JSON file first.</div>`,
            okText: "OK",
            cancelText: "Close"
        });
        return;
    }

    const text = await file.text();
    const payload = safeJSONParse(text);
    if (!payload) {
        await openModal({
            title: "Invalid JSON",
            bodyHTML: `<div class="muted">The selected file is not valid JSON.</div>`,
            okText: "OK",
            cancelText: "Close"
        });
        return;
    }

    const replace = $("#settingsReplaceData").checked;
    const ok = await openModal({
        title: "Import populate file?",
        bodyHTML: `<div>This will import shows, roster, and PLEs from <b>${escapeHTML(file.name)}</b>.</div>
        <div class="muted tiny">${replace ? "Existing data will be replaced." : "Existing data will be kept and new rows will be added."}</div>`,
        okText: "Import"
    });
    if (!ok.ok) return;

    try {
        const result = importPopulateJSON(payload, { replace });
        renderAll();
        input.value = "";
        await openModal({
            title: "Import complete",
            bodyHTML: `<div class="muted">Added ${result.shows} shows, ${result.roster} roster entries, and ${result.ples} PLEs.</div>`,
            okText: "Done",
            cancelText: "Close"
        });
    } catch (err) {
        await openModal({
            title: "Import failed",
            bodyHTML: `<div class="muted">${escapeHTML(err?.message || "Could not import this file.")}</div>`,
            okText: "OK",
            cancelText: "Close"
        });
    }
});

// -------------------- INIT --------------------
(function init() {
    setView("dashboard");
})();
