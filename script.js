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
function toNonNegativeInt(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.floor(n));
}
function parseChampionships(value) {
    if (Array.isArray(value)) {
        return value.map(v => String(v ?? "").trim()).filter(Boolean);
    }
    if (typeof value === "string") {
        return value.split(",").map(v => v.trim()).filter(Boolean);
    }
    return [];
}
function enrichChampionship(championship) {
    const name = typeof championship === "string"
        ? championship.trim()
        : String(championship?.name ?? "").trim();
    if (!name) return null;
    return {
        id: championship?.id || uid("title"),
        name,
    };
}
function enrichSuperstar(ss) {
    const showIds = Array.isArray(ss?.showIds)
        ? ss.showIds.map(x => String(x ?? "").trim()).filter(Boolean)
        : (ss?.showId ? [ss.showId] : []);
    const uniqueShowIds = Array.from(new Set(showIds));
    const championships = parseChampionships(ss?.championships);
    return {
        id: ss?.id || uid("ss"),
        name: String(ss?.name ?? "").trim(),
        showId: uniqueShowIds[0] ?? null, // legacy compatibility
        showIds: uniqueShowIds,
        division: String(ss?.division ?? "World").trim() || "World",
        isChampion: championships.length > 0,
        championships,
        faction: String(ss?.faction ?? "").trim(),
        manager: String(ss?.manager ?? "").trim(),
        photo: String(ss?.photo ?? ss?.image ?? ss?.picture ?? "").trim(),
        wins: toNonNegativeInt(ss?.wins),
        losses: toNonNegativeInt(ss?.losses),
    };
}
function normalizeStateData(sourceState) {
    const normalized = sourceState || defaultState();
    normalized.championships = Array.isArray(normalized.championships)
        ? normalized.championships.map(enrichChampionship).filter(Boolean)
        : [];

    const byId = new Map(normalized.championships.map(c => [c.id, c]));
    const byName = new Map(normalized.championships.map(c => [c.name.toLowerCase(), c]));

    const resolveChampionshipId = (ref) => {
        if (!ref) return null;
        const idMatch = byId.get(ref);
        if (idMatch) return idMatch.id;

        const nameRef = String(ref).trim();
        if (!nameRef) return null;
        const nameMatch = byName.get(nameRef.toLowerCase());
        if (nameMatch) return nameMatch.id;

        const created = enrichChampionship({ name: nameRef });
        if (!created) return null;
        normalized.championships.push(created);
        byId.set(created.id, created);
        byName.set(created.name.toLowerCase(), created);
        return created.id;
    };

    normalized.superstars = Array.isArray(normalized.superstars)
        ? normalized.superstars.map(enrichSuperstar).map(ss => {
            const validShowIds = ss.showIds.filter(showId => normalized.shows.some(s => s.id === showId));
            const championshipIds = parseChampionships(ss.championships)
                .map(resolveChampionshipId)
                .filter(Boolean);
            return {
                ...ss,
                showIds: validShowIds,
                showId: validShowIds[0] ?? null,
                championships: Array.from(new Set(championshipIds)),
                isChampion: championshipIds.length > 0,
            };
        })
        : [];

    normalized.weeklySchedule = Array.isArray(normalized.weeklySchedule)
        ? normalized.weeklySchedule
            .map(row => ({
                showId: String(row?.showId ?? "").trim(),
                weekday: Number(row?.weekday),
            }))
            .filter(row =>
                row.showId &&
                Number.isInteger(row.weekday) &&
                row.weekday >= 0 &&
                row.weekday <= 6 &&
                normalized.shows.some(s => s.id === row.showId)
            )
        : [];

    return normalized;
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
        championships: [], // {id, name}
        superstars: [],   // {id, name, showIds:[], showId(legacy), division}
        weeklySchedule: [], // [{showId, weekday}] where weekday is 0-6
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
state = normalizeStateData(state);

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
const WEEKDAY_OPTIONS = [
    { value: 0, label: "Sunday" },
    { value: 1, label: "Monday" },
    { value: 2, label: "Tuesday" },
    { value: 3, label: "Wednesday" },
    { value: 4, label: "Thursday" },
    { value: 5, label: "Friday" },
    { value: 6, label: "Saturday" },
];
function superstarOnShow(superstar, showId) {
    const ids = Array.isArray(superstar?.showIds) ? superstar.showIds : (superstar?.showId ? [superstar.showId] : []);
    return ids.includes(showId);
}
function superstarShowNames(superstar) {
    const ids = Array.isArray(superstar?.showIds) ? superstar.showIds : (superstar?.showId ? [superstar.showId] : []);
    return ids.map(showName).filter(n => n && n !== "Unknown show" && n !== "No show");
}
function getChampionship(championshipId) {
    return state.championships.find(c => c.id === championshipId) || null;
}
function championshipName(championshipId) {
    return getChampionship(championshipId)?.name || "";
}
function superstarChampionshipNames(superstar) {
    return parseChampionships(superstar?.championships)
        .map(championshipName)
        .filter(Boolean);
}
function superstarPhotoURL(superstar) {
    return String(superstar?.photo ?? "").trim();
}
function superstarInitials(name) {
    const parts = String(name ?? "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "?";
    return parts.slice(0, 2).map(p => p[0].toUpperCase()).join("");
}
function showName(showId) {
    if (!showId) return "No show";
    const s = getShow(showId);
    return s ? s.name : "Unknown show";
}
function showColor(showId) { return getShow(showId)?.color || "#888"; }
function addShowByNameColor(rawName, rawColor) {
    const name = String(rawName ?? "").trim();
    if (!name) return { ok: false, reason: "empty_name" };

    const duplicate = state.shows.some(s => s.name.toLowerCase() === name.toLowerCase());
    if (duplicate) return { ok: false, reason: "duplicate_name" };

    const color = normalizeHexColor(rawColor) || "#d00000";
    state.shows.push({ id: uid("show"), name, color });
    return { ok: true };
}
function deleteShowAndUnassign(showId) {
    state.superstars = state.superstars.map(ss => {
        const nextShowIds = (ss.showIds || []).filter(id => id !== showId);
        return { ...ss, showIds: nextShowIds, showId: nextShowIds[0] ?? null };
    });
    state.shows = state.shows.filter(x => x.id !== showId);
    state.weeklySchedule = (state.weeklySchedule || []).filter(row => row.showId !== showId);
}
function managerNameSet() {
    return new Set(
        state.superstars
            .map(ss => String(ss?.manager ?? "").trim().toLowerCase())
            .filter(Boolean)
    );
}
function rosterForShow(showId, { excludeManagers = false } = {}) {
    const managers = excludeManagers ? managerNameSet() : null;
    return state.superstars.filter(ss => {
        if (!superstarOnShow(ss, showId)) return false;
        if (managers && managers.has(ss.name.toLowerCase())) return false;
        return true;
    });
}
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
        settings: ["Settings", "Schedule weekly shows, manage data, import JSON"],
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

            deleteShowAndUnassign(id);
            saveSoon();
            renderAll();
        });
    });
}

// -------------------- ROSTER --------------------
async function deleteSuperstarFlow(id) {
    const ss = state.superstars.find(x => x.id === id);
    const ok = await openModal({
        title: "Delete superstar?",
        bodyHTML: `<div>Delete <b>${escapeHTML(ss?.name || "this superstar")}</b>?</div>`,
        okText: "Delete"
    });
    if (!ok.ok) return false;

    state.superstars = state.superstars.filter(x => x.id !== id);
    saveSoon();
    renderRoster();
    renderPlannerEventSelect();
    return true;
}

async function editSuperstarFlow(id) {
    const ss = state.superstars.find(x => x.id === id);
    if (!ss) return false;

    const selectedShows = new Set(ss.showIds || []);
    const showOptions = state.shows.length
        ? state.shows.map(s => `
            <label class="edit-ss-check-item">
              <input class="editSSShowItem" type="checkbox" value="${s.id}" ${selectedShows.has(s.id) ? "checked" : ""} />
              <span>${escapeHTML(s.name)}</span>
            </label>
          `).join("")
        : `<div class="muted tiny">No shows created yet.</div>`;
    const selectedChampionships = new Set(parseChampionships(ss.championships));
    const championshipOptions = state.championships.length
        ? state.championships.map(c => `
            <label class="edit-ss-check-item">
              <input class="editSSChampItem" type="checkbox" value="${c.id}" ${selectedChampionships.has(c.id) ? "checked" : ""} />
              <span>${escapeHTML(c.name)}</span>
            </label>
          `).join("")
        : `<div class="muted tiny">No championships created yet. Add them in Settings first.</div>`;

    const photo = superstarPhotoURL(ss);
    const bodyHTML = `
      <div class="stack edit-ss-form">
        <div class="edit-ss-header">
          ${photo
            ? `<img class="edit-ss-avatar" src="${escapeAttr(photo)}" alt="${escapeAttr(ss.name)}" />`
            : `<div class="edit-ss-avatar-fallback">${escapeHTML(superstarInitials(ss.name))}</div>`
        }
          <div class="muted tiny">Update profile details, shows, titles, and record.</div>
        </div>

        <div class="edit-ss-section">
          <label class="edit-ss-label" for="editSSName">Name</label>
          <input id="editSSName" class="input" value="${escapeAttr(ss.name)}" />
          <label class="edit-ss-label" for="editSSPhoto" style="margin-top:10px;">Photo URL</label>
          <input id="editSSPhoto" class="input" value="${escapeAttr(photo)}" placeholder="Photo URL (https://...)" />
        </div>

        <div class="edit-ss-section">
          <label class="edit-ss-label">Shows</label>
          <div class="edit-ss-check-grid">${showOptions}</div>
          <label class="edit-ss-label" for="editSSDiv" style="margin-top:10px;">Division</label>
          <select id="editSSDiv" class="input">
            ${["World", "Midcard", "Tag", "Women", "Other"].map(d => `<option value="${d}" ${d === ss.division ? "selected" : ""}>${d}</option>`).join("")}
          </select>
        </div>

        <div class="edit-ss-section">
          <label class="edit-ss-label">Championships</label>
          <div class="edit-ss-check-grid">${championshipOptions}</div>
        </div>

        <div class="edit-ss-section">
          <label class="edit-ss-label" for="editSSFaction">Faction / Group affiliation</label>
          <input id="editSSFaction" class="input" value="${escapeAttr(ss.faction || "")}" placeholder="Faction / Group affiliation" />
          <label class="edit-ss-label" for="editSSManager" style="margin-top:10px;">Manager</label>
          <input id="editSSManager" class="input" value="${escapeAttr(ss.manager || "")}" placeholder="Manager" />
        </div>

        <div class="edit-ss-section">
          <label class="edit-ss-label">Record</label>
          <div class="edit-ss-inline">
            <input id="editSSWins" class="input" type="number" min="0" value="${toNonNegativeInt(ss.wins)}" placeholder="Wins" />
            <input id="editSSLosses" class="input" type="number" min="0" value="${toNonNegativeInt(ss.losses)}" placeholder="Losses" />
          </div>
        </div>

        <div class="muted tiny">Tip: Champion status is automatic when at least one championship is selected.</div>
      </div>
    `;

    const ok = await openModal({ title: "Edit Superstar", bodyHTML, okText: "Save" });
    if (!ok.ok) return false;

    const newName = $("#editSSName").value.trim();
    const newPhoto = $("#editSSPhoto").value.trim();
    const newShowIds = $$(".editSSShowItem:checked").map(el => el.value);
    const newDiv = $("#editSSDiv").value;
    const newChamps = $$(".editSSChampItem:checked").map(el => el.value);
    const newFaction = $("#editSSFaction").value.trim();
    const newManager = $("#editSSManager").value.trim();
    const newWins = toNonNegativeInt($("#editSSWins").value);
    const newLosses = toNonNegativeInt($("#editSSLosses").value);

    if (!newName) return false;

    state.superstars = state.superstars.map(x => x.id === id ? {
        ...x,
        name: newName,
        photo: newPhoto,
        showIds: Array.from(new Set(newShowIds)),
        showId: newShowIds[0] ?? null,
        division: newDiv,
        isChampion: newChamps.length > 0,
        championships: Array.from(new Set(newChamps)),
        faction: newFaction,
        manager: newManager,
        wins: newWins,
        losses: newLosses,
    } : x);
    saveSoon();
    renderRoster();
    renderPlanner();
    return true;
}

async function openSuperstarDetails(id) {
    const ss = state.superstars.find(x => x.id === id);
    if (!ss) return;

    const ssShows = superstarShowNames(ss);
    const champs = superstarChampionshipNames(ss);
    const record = `${toNonNegativeInt(ss.wins)}-${toNonNegativeInt(ss.losses)}`;
    const photo = superstarPhotoURL(ss);

    const bodyHTML = `
      <div class="stack">
        <div class="ss-profile-head">
          ${photo
            ? `<img class="ss-profile-photo" src="${escapeAttr(photo)}" alt="${escapeAttr(ss.name)}" />`
            : `<div class="ss-profile-fallback">${escapeHTML(superstarInitials(ss.name))}</div>`
        }
          <div class="stack" style="gap:6px;">
            <div class="h3" style="margin:0;">${escapeHTML(ss.name)}</div>
            <div class="muted tiny">${escapeHTML(ssShows.join(", ") || "Unassigned")} • ${escapeHTML(ss.division)} Division</div>
          </div>
        </div>
        <div class="row gap wrap">
          <span class="badge">Record: <b>${record}</b></span>
          <span class="badge">${champs.length ? "Champion" : "Not Champion"}</span>
          ${champs.length ? `<span class="badge">Titles: <b>${escapeHTML(champs.join(", "))}</b></span>` : ""}
          ${ss.faction ? `<span class="badge">Faction: <b>${escapeHTML(ss.faction)}</b></span>` : ""}
          ${ss.manager ? `<span class="badge">Manager: <b>${escapeHTML(ss.manager)}</b></span>` : ""}
        </div>
      </div>
    `;

    const modalPromise = openModal({ title: "Superstar Details", bodyHTML, okText: "Close", cancelText: "Close" });

    const modalActions = $(".modal-actions");
    const modalCancelBtn = $("#modalCancel");
    const modalOkBtn = $("#modalOk");
    const footerEditBtn = document.createElement("button");
    footerEditBtn.id = "ssDetailEdit";
    footerEditBtn.className = "btn secondary";
    footerEditBtn.type = "button";
    footerEditBtn.textContent = "Edit Superstar";
    const footerDeleteBtn = document.createElement("button");
    footerDeleteBtn.id = "ssDetailDelete";
    footerDeleteBtn.className = "btn danger";
    footerDeleteBtn.type = "button";
    footerDeleteBtn.textContent = "Delete Superstar";

    modalCancelBtn.classList.add("hidden");
    modalActions.insertBefore(footerEditBtn, modalOkBtn);
    modalActions.insertBefore(footerDeleteBtn, modalOkBtn);

    footerEditBtn.addEventListener("click", async () => {
        closeModal({ ok: false });
        const didSave = await editSuperstarFlow(id);
        if (didSave) {
            await openSuperstarDetails(id);
        }
    });
    footerDeleteBtn.addEventListener("click", async () => {
        closeModal({ ok: false });
        await deleteSuperstarFlow(id);
    });

    await modalPromise;

    footerEditBtn.remove();
    footerDeleteBtn.remove();
    modalCancelBtn.classList.remove("hidden");
}

function renderRoster() {
    populateShowSelects();

    const search = $("#rosterSearch").value.trim().toLowerCase();
    const showFilter = $("#rosterFilter").value || "all";

    const rows = state.superstars
        .filter(ss => showFilter === "all" ? true : superstarOnShow(ss, showFilter))
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
        const ssShows = superstarShowNames(ss);
        const record = `${toNonNegativeInt(ss.wins)}-${toNonNegativeInt(ss.losses)}`;
        const photo = superstarPhotoURL(ss);
        return `
          <div class="item roster-item" data-open-ss="${ss.id}" role="button" tabindex="0" aria-label="Open ${escapeAttr(ss.name)} details">
            <div class="row gap wrap">
              ${photo
                ? `<img class="ss-card-photo" src="${escapeAttr(photo)}" alt="${escapeAttr(ss.name)}" />`
                : `<div class="ss-card-fallback">${escapeHTML(superstarInitials(ss.name))}</div>`
            }
              <div>
                <div class="item-title">${escapeHTML(ss.name)}</div>
                <div class="item-sub">${escapeHTML(ssShows.join(", ") || "Unassigned")} • ${escapeHTML(ss.division)} • ${record}</div>
              </div>
            </div>
            <div class="row gap wrap">
              <span class="badge">Tap for details</span>
            </div>
          </div>
        `;
    }).join("")}
    </div>
  `;

    $$("[data-open-ss]").forEach(el => {
        const open = () => {
            el.blur();
            openSuperstarDetails(el.dataset.openSs);
        };
        el.addEventListener("click", open);
        el.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                open();
            }
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
            const pillStyle = e.type === "ppv"
                ? "background:#ffffff;color:#111111;border-color:#ffffff;"
                : `background:${showColor(e.showId)};color:#ffffff;border-color:${showColor(e.showId)};`;
            return `<span class="cal-pill" style="${pillStyle}" title="${escapeAttr(e.name || "(Unnamed Event)")}">${shortType}</span>`;
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
const MIN_PARTICIPANT_SLOTS = 2;

function participantSlotCount(match) {
    const participants = Array.isArray(match?.participants) ? match.participants : [];
    const configured = Math.floor(Number(match?.participantSlots) || 0);
    return Math.max(MIN_PARTICIPANT_SLOTS, participants.length, configured);
}

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
    const roster = ev.showId
        ? rosterForShow(ev.showId, { excludeManagers: true })
        : state.superstars.filter(ss => !managerNameSet().has(ss.name.toLowerCase()));
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
        const slotCount = participantSlotCount(m);
        const participantFields = Array.from({ length: slotCount }).map((_, slotIdx) => `
          <select class="cell-input small" data-field="participant" data-slot="${slotIdx}">
            <option value="">${slotIdx < 2 ? "(select)" : "(optional)"}</option>
            ${optionsHTML}
          </select>
        `).join("");
        const removeParticipantBtn = slotCount > MIN_PARTICIPANT_SLOTS
            ? `<button type="button" class="btn secondary participant-add-btn" data-remove-participant="${idx}">- Participant</button>`
            : "";

        return `
      <tr data-row="${idx}">
        <td>
          <input class="cell-input small" data-field="num" inputmode="numeric" value="${escapeAttr(m.num ?? (idx + 1))}" />
        </td>
        <td>
          <div class="stack">
            ${participantFields}
            <div class="row gap wrap">
              <button type="button" class="btn secondary participant-add-btn" data-add-participant="${idx}">+ Participant</button>
              ${removeParticipantBtn}
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
        $$('[data-field="participant"]', tr).forEach((el, slotIdx) => {
            el.value = p[slotIdx] || "";
        });
    });

    // One event listener for all row edits (event delegation)
    const handlePlannerRowEdit = (e) => {
        const target = e.target;
        if (!target || !target.matches("[data-field]")) return;

        const tr = target.closest("tr");
        if (!tr) return;

        const row = Number(tr.dataset.row);
        const field = target.dataset.field;

        const ev2 = getEvent(plannerEventId);
        if (!ev2 || !ev2.matches[row]) return;

        if (field === "participant") {
            const participantInputs = $$('[data-field="participant"]', tr);
            const selected = participantInputs.map(input => input.value);
            const seen = new Set();
            const deduped = selected.map(v => {
                if (!v || seen.has(v)) return "";
                seen.add(v);
                return v;
            });
            participantInputs.forEach((input, slotIdx) => {
                input.value = deduped[slotIdx] || "";
            });
            ev2.matches[row].participants = deduped.filter(Boolean);
            ev2.matches[row].participantSlots = participantSlotCount(ev2.matches[row]);
        } else if (field === "num") {
            ev2.matches[row].num = Number(target.value) || (row + 1);
        } else {
            ev2.matches[row][field] = target.value;
        }

        upsertEvent(ev2); // debounced via saveSoon
    };
    body.oninput = handlePlannerRowEdit;
    body.onchange = handlePlannerRowEdit;

    // Add participant slot button
    $$("[data-add-participant]").forEach(btn => {
        btn.addEventListener("click", () => {
            const idx = Number(btn.dataset.addParticipant);
            const ev2 = getEvent(plannerEventId);
            if (!ev2 || !ev2.matches[idx]) return;
            ev2.matches[idx].participantSlots = participantSlotCount(ev2.matches[idx]) + 1;
            upsertEvent(ev2);
            renderPlanner();
        });
    });

    $$("[data-remove-participant]").forEach(btn => {
        btn.addEventListener("click", () => {
            const idx = Number(btn.dataset.removeParticipant);
            const ev2 = getEvent(plannerEventId);
            if (!ev2 || !ev2.matches[idx]) return;

            const currentCount = participantSlotCount(ev2.matches[idx]);
            if (currentCount <= MIN_PARTICIPANT_SLOTS) return;

            const nextCount = currentCount - 1;
            ev2.matches[idx].participantSlots = nextCount;
            ev2.matches[idx].participants = (ev2.matches[idx].participants || []).slice(0, nextCount);
            upsertEvent(ev2);
            renderPlanner();
        });
    });

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
        participantSlots: MIN_PARTICIPANT_SLOTS,
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
    const weeklyList = $("#settingsWeeklyScheduleList");
    const weeklyStartDate = $("#settingsWeeklyStartDate");
    const weeklyMonths = $("#settingsWeeklyMonths");
    const weeklyRows = $("#settingsWeeklyRows");
    const generateWeeklyBtn = $("#settingsGenerateWeeklyBtn");
    const showsList = $("#settingsShowsList");
    const list = $("#championshipsList");
    if (!weeklyList || !weeklyStartDate || !weeklyMonths || !weeklyRows || !generateWeeklyBtn || !showsList || !list) return;

    const weeklyMap = new Map((state.weeklySchedule || []).map(row => [row.showId, row.weekday]));
    if (!state.shows.length) {
        weeklyList.innerHTML = `<div class="muted tiny">Add shows first, then set their weekly day here.</div>`;
    } else {
        weeklyList.innerHTML = `
          <div class="list">
            ${state.shows.map(s => {
            const selected = weeklyMap.has(s.id) ? String(weeklyMap.get(s.id)) : "-1";
            return `
                <div class="item">
                  <div class="row space gap wrap">
                    <span class="badge"><span class="dot" style="background:${s.color}"></span>${escapeHTML(s.name)}</span>
                    <select class="input" data-weekly-show="${s.id}" style="max-width:220px;">
                      <option value="-1" ${selected === "-1" ? "selected" : ""}>Not scheduled</option>
                      ${WEEKDAY_OPTIONS.map(day => `<option value="${day.value}" ${selected === String(day.value) ? "selected" : ""}>${day.label}</option>`).join("")}
                    </select>
                  </div>
                </div>
              `;
        }).join("")}
          </div>
        `;
    }

    if (!weeklyStartDate.value) weeklyStartDate.value = todayISO();
    if (!weeklyMonths.value) weeklyMonths.value = "3";
    if (!weeklyRows.value) weeklyRows.value = "6";

    $$("[data-weekly-show]").forEach(sel => {
        sel.onchange = () => {
            const showId = sel.dataset.weeklyShow;
            const weekday = Number(sel.value);
            state.weeklySchedule = (state.weeklySchedule || []).filter(row => row.showId !== showId);
            if (weekday >= 0 && weekday <= 6) {
                state.weeklySchedule.push({ showId, weekday });
            }
            saveSoon();
        };
    });

    generateWeeklyBtn.onclick = async () => {
        const rules = (state.weeklySchedule || []).filter(row =>
            state.shows.some(s => s.id === row.showId) &&
            Number.isInteger(Number(row.weekday)) &&
            Number(row.weekday) >= 0 &&
            Number(row.weekday) <= 6
        ).map(row => ({ showId: row.showId, weekday: Number(row.weekday) }));

        if (!rules.length) {
            await openModal({
                title: "No weekly shows set",
                bodyHTML: `<div class="muted">Set at least one show to a weekday first.</div>`,
                okText: "OK",
                cancelText: "Close"
            });
            return;
        }

        const startISO = weeklyStartDate.value || todayISO();
        const months = Math.max(1, Math.min(24, Number(weeklyMonths.value) || 3));
        const defaultRows = Math.max(0, Math.min(20, Number(weeklyRows.value) || 6));
        const beforeCount = state.events.length;

        generateWeeklyEvents({ startISO, months, rules, defaultRows });
        const added = state.events.length - beforeCount;
        renderAll();

        await openModal({
            title: "Calendar populated",
            bodyHTML: `<div class="muted">Added ${added} weekly events from ${startISO} for ${months} month(s).</div>`,
            okText: "Done",
            cancelText: "Close"
        });
    };

    if (!state.shows.length) {
        showsList.innerHTML = `<div class="muted tiny">No shows yet. Add one above.</div>`;
    } else {
        showsList.innerHTML = `
          <div class="list">
            ${state.shows.map(s => `
              <div class="item">
                <div class="item-title">
                  <span class="badge"><span class="dot" style="background:${s.color}"></span>${escapeHTML(s.name)}</span>
                </div>
                <div class="item-sub">Color: ${escapeHTML(s.color)}</div>
                <div class="item-actions">
                  <button class="btn secondary" data-settings-edit-show="${s.id}">Edit</button>
                  <button class="btn danger" data-settings-del-show="${s.id}">Delete</button>
                </div>
              </div>
            `).join("")}
          </div>
        `;
    }

    $$("[data-settings-edit-show]").forEach(btn => {
        btn.addEventListener("click", async () => {
            const id = btn.dataset.settingsEditShow;
            const show = getShow(id);
            if (!show) return;

            const ok = await openModal({
                title: "Edit show",
                bodyHTML: `
                  <div class="stack">
                    <input id="editShowName" class="input" value="${escapeAttr(show.name)}" />
                    <input id="editShowColor" class="input" type="color" value="${escapeAttr(show.color || "#d00000")}" />
                  </div>
                `,
                okText: "Save"
            });
            if (!ok.ok) return;

            const nextName = $("#editShowName").value.trim();
            const nextColor = normalizeHexColor($("#editShowColor").value) || "#d00000";
            if (!nextName) return;

            const duplicate = state.shows.find(s => s.id !== id && s.name.toLowerCase() === nextName.toLowerCase());
            if (duplicate) {
                await openModal({
                    title: "Duplicate show name",
                    bodyHTML: `<div class="muted">A show with that name already exists.</div>`,
                    okText: "OK",
                    cancelText: "Close"
                });
                return;
            }

            state.shows = state.shows.map(s => s.id === id ? { ...s, name: nextName, color: nextColor } : s);
            saveSoon();
            renderAll();
        });
    });

    $$("[data-settings-del-show]").forEach(btn => {
        btn.addEventListener("click", async () => {
            const id = btn.dataset.settingsDelShow;
            const s = getShow(id);
            if (!s) return;

            const ok = await openModal({
                title: "Delete show?",
                bodyHTML: `
                  <div>Delete <b>${escapeHTML(s.name)}</b>?</div>
                  <div class="muted tiny">Superstars assigned to it become unassigned. Existing events keep their showId but will display as “Unknown”.</div>
                `,
                okText: "Delete"
            });
            if (!ok.ok) return;

            deleteShowAndUnassign(id);
            saveSoon();
            renderAll();
        });
    });

    if (!state.championships.length) {
        list.innerHTML = `<div class="muted tiny">No championships yet. Add one above.</div>`;
    } else {
        list.innerHTML = `
          <div class="list">
            ${state.championships.map(c => `
              <div class="item">
                <div class="item-title">${escapeHTML(c.name)}</div>
                <div class="item-actions">
                  <button class="btn secondary" data-edit-title="${c.id}">Edit</button>
                  <button class="btn danger" data-del-title="${c.id}">Delete</button>
                </div>
              </div>
            `).join("")}
          </div>
        `;
    }

    $$("[data-edit-title]").forEach(btn => {
        btn.addEventListener("click", async () => {
            const id = btn.dataset.editTitle;
            const championship = getChampionship(id);
            if (!championship) return;

            const ok = await openModal({
                title: "Edit championship",
                bodyHTML: `<input id="editChampionshipName" class="input" value="${escapeAttr(championship.name)}" />`,
                okText: "Save"
            });
            if (!ok.ok) return;

            const nextName = $("#editChampionshipName").value.trim();
            if (!nextName) return;

            const duplicate = state.championships.find(c => c.id !== id && c.name.toLowerCase() === nextName.toLowerCase());
            if (duplicate) {
                await openModal({
                    title: "Duplicate championship",
                    bodyHTML: `<div class="muted">A championship with that name already exists.</div>`,
                    okText: "OK",
                    cancelText: "Close"
                });
                return;
            }

            state.championships = state.championships.map(c => c.id === id ? { ...c, name: nextName } : c);
            saveSoon();
            renderSettingsTools();
            renderRoster();
        });
    });

    $$("[data-del-title]").forEach(btn => {
        btn.addEventListener("click", async () => {
            const id = btn.dataset.delTitle;
            const championship = getChampionship(id);
            if (!championship) return;

            const ok = await openModal({
                title: "Delete championship?",
                bodyHTML: `<div>Delete <b>${escapeHTML(championship.name)}</b>?</div>
                <div class="muted tiny">This removes it from every superstar.</div>`,
                okText: "Delete"
            });
            if (!ok.ok) return;

            state.championships = state.championships.filter(c => c.id !== id);
            state.superstars = state.superstars.map(ss => {
                const nextChamps = parseChampionships(ss.championships).filter(chId => chId !== id);
                return { ...ss, championships: nextChamps, isChampion: nextChamps.length > 0 };
            });
            saveSoon();
            renderSettingsTools();
            renderRoster();
        });
    });
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

        state.superstars.push(enrichSuperstar({ id: uid("ss"), name, showId, division }));
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

function addChampionshipByName(rawName) {
    const name = String(rawName ?? "").trim();
    if (!name) return false;
    const exists = state.championships.some(c => c.name.toLowerCase() === name.toLowerCase());
    if (exists) return false;
    state.championships.push({ id: uid("title"), name });
    return true;
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
    const championshipsInput = Array.isArray(payload.championships) ? payload.championships : [];
    const rosterInput = Array.isArray(payload.roster)
        ? payload.roster
        : (Array.isArray(payload.superstars) ? payload.superstars : []);
    const plesInput = Array.isArray(payload.ples)
        ? payload.ples
        : (Array.isArray(payload.ppvs) ? payload.ppvs : []);

    const showNameToId = new Map(state.shows.map(s => [s.name.toLowerCase(), s.id]));
    const championshipByName = new Map(state.championships.map(c => [c.name.toLowerCase(), c.id]));
    const showIdSet = new Set(state.shows.map(s => s.id));

    const result = { championships: 0, shows: 0, roster: 0, ples: 0 };

    for (const row of championshipsInput) {
        const normalized = enrichChampionship(row);
        if (!normalized) continue;
        if (championshipByName.has(normalized.name.toLowerCase())) continue;
        state.championships.push(normalized);
        championshipByName.set(normalized.name.toLowerCase(), normalized.id);
        result.championships += 1;
    }

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
        let showIds = [];
        if (Array.isArray(row?.showIds)) {
            showIds = row.showIds.map(x => String(x ?? "").trim()).filter(x => showIdSet.has(x));
        } else if (Array.isArray(row?.shows)) {
            showIds = row.shows
                .map(x => showNameToId.get(String(x ?? "").trim().toLowerCase()) || null)
                .filter(Boolean);
        }
        let showId = row?.showId ?? null;
        if (showFromName) showId = showNameToId.get(showFromName) ?? showId;
        if (showId && showIdSet.has(showId)) showIds.unshift(showId);
        showIds = Array.from(new Set(showIds));

        const division = String(row?.division ?? "World").trim() || "World";
        const championships = parseChampionships(row?.championships ?? row?.championship ?? [])
            .map(ref => {
                if (state.championships.some(c => c.id === ref)) return ref;
                const nameRef = String(ref).trim();
                if (!nameRef) return null;
                const existingId = championshipByName.get(nameRef.toLowerCase());
                if (existingId) return existingId;
                const created = enrichChampionship({ name: nameRef });
                if (!created) return null;
                state.championships.push(created);
                championshipByName.set(created.name.toLowerCase(), created.id);
                result.championships += 1;
                return created.id;
            })
            .filter(Boolean);
        state.superstars.push(enrichSuperstar({
            id: uid("ss"),
            name,
            showId: showIds[0] ?? null,
            showIds,
            division,
            championships,
            faction: row?.faction,
            manager: row?.manager,
            photo: row?.photo ?? row?.image ?? row?.picture,
            wins: row?.wins,
            losses: row?.losses,
        }));
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
                    participantSlots: MIN_PARTICIPANT_SLOTS,
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
        state.superstars.push(enrichSuperstar({ id: uid("ss"), name, showId, division }));
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
            num: i + 1, participants: [], participantSlots: MIN_PARTICIPANT_SLOTS, matchType: "", storyline: "", result: "", rivalryNotes: ""
        }))
    });

    saveSoon();
}

// -------------------- SELECT POPULATION --------------------
function populateShowSelects() {
    // roster form show select
    const ssShows = $("#ssShows");
    if (ssShows) {
        ssShows.innerHTML = state.shows.map(s => `<option value="${s.id}">${escapeHTML(s.name)}</option>`).join("");
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
    const result = addShowByNameColor(name, color);
    if (!result.ok) return;
    saveSoon();
    $("#showName").value = "";
    renderAll();
});

$("#addSS").addEventListener("click", () => {
    const name = $("#ssName").value.trim();
    const photo = $("#ssPhoto").value.trim();
    const showIds = Array.from($("#ssShows").selectedOptions).map(o => o.value);
    const division = $("#ssDivision").value;
    if (!name) return;

    state.superstars.push(enrichSuperstar({ id: uid("ss"), name, photo, showIds, showId: showIds[0] ?? null, division }));
    saveSoon();
    $("#ssName").value = "";
    $("#ssPhoto").value = "";
    $("#ssShows").selectedIndex = -1;
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
    state = normalizeStateData(imported);
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
    state = normalizeStateData(store.load());
    plannerEventId = null;
    renderAll();
});

// Settings: Populate / Generate
$("#addChampionshipBtn").addEventListener("click", async () => {
    const input = $("#championshipNameInput");
    const name = input.value.trim();
    if (!name) return;

    const added = addChampionshipByName(name);
    if (!added) {
        await openModal({
            title: "Duplicate championship",
            bodyHTML: `<div class="muted">A championship with that name already exists.</div>`,
            okText: "OK",
            cancelText: "Close"
        });
        return;
    }

    input.value = "";
    saveSoon();
    renderSettingsTools();
});

$("#settingsAddShowBtn").addEventListener("click", async () => {
    const nameInput = $("#settingsShowNameInput");
    const colorInput = $("#settingsShowColorInput");
    const name = nameInput.value.trim();
    const color = colorInput.value || "#d00000";

    const result = addShowByNameColor(name, color);
    if (!result.ok) {
        if (result.reason === "duplicate_name") {
            await openModal({
                title: "Duplicate show name",
                bodyHTML: `<div class="muted">A show with that name already exists.</div>`,
                okText: "OK",
                cancelText: "Close"
            });
        }
        return;
    }

    nameInput.value = "";
    saveSoon();
    renderAll();
});

$("#wipeBtn").addEventListener("click", async () => {
    const ok = await openModal({
        title: "Wipe everything?",
        bodyHTML: `<div>This deletes all shows, roster, and events.</div>`,
        okText: "Wipe"
    });
    if (!ok.ok) return;
    store.wipe();
    state = normalizeStateData(store.load());
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
            bodyHTML: `<div class="muted">Added ${result.championships} championships, ${result.shows} shows, ${result.roster} roster entries, and ${result.ples} PLEs.</div>`,
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
