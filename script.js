// Universe Booker - mobile-first, smooth LocalStorage MVP
// Storage isolated so you can swap to a DB later.

const STORAGE_KEY = "universeBooker.v2";
const STORAGE_BACKUP_PREFIX = "universeBooker.v2.corrupt-";
const STORAGE_AUTOEXPORT_KEY = "universeBooker.v2.lastReminder";
const STORAGE_RECOVERY_KEY = "universeBooker.v2.sessionRecovery";
const UI_SESSION_KEY = "universeBooker.v2.uiSession";
const PHOTO_DB_NAME = "universeBooker.photoVault.v1";
const PHOTO_DB_STORE = "photos";
const PHOTO_REF_PREFIX = "idb-photo:";
const CALENDAR_DAYS_PER_MONTH = 28;
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// -------------------- DERIVED-DATA CACHE --------------------
// Every mutation goes through saveSoon(), which bumps dataVersion. Expensive
// derived data (records, rankings, streaks, lookups) is memoised against it so
// re-rendering a view never re-walks the whole universe history twice.
let dataVersion = 0;
const memoCache = new Map();
function memo(name, keyParts, compute) {
    const entry = memoCache.get(name);
    if (entry && entry.key.length === keyParts.length && entry.key.every((part, i) => part === keyParts[i])) {
        return entry.value;
    }
    const value = compute();
    memoCache.set(name, { key: keyParts, value });
    return value;
}
function bumpDataVersion() {
    dataVersion += 1;
}

function uid(prefix = "id") {
    return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}
function toISODateLocal(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}
function todayISO() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return toISODateLocal(d);
}
function isISODate(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
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
function parseShowRefs(value) {
    if (Array.isArray(value)) {
        return value
            .flatMap(v => String(v ?? "").split(","))
            .map(v => v.trim())
            .filter(Boolean);
    }
    if (typeof value === "string") {
        return value.split(",").map(v => v.trim()).filter(Boolean);
    }
    return [];
}
const CHAMPIONSHIP_GENDER_OPTIONS = ["Male", "Female", "Intergender"];
const CHAMPIONSHIP_DIVISION_OPTIONS = ["World", "Women", "Midcard", "Tag"];
function normalizeChampionshipGender(value) {
    const normalized = normalizeNameForCompare(value);
    if (!normalized) return "Intergender";
    if (normalized === "male" || normalized === "men" || normalized === "mens") return "Male";
    if (normalized === "female" || normalized === "women" || normalized === "womens") return "Female";
    if (normalized === "intergender" || normalized === "mixed" || normalized === "open" || normalized === "any") return "Intergender";
    return "Intergender";
}
function normalizeSuperstarDivision(value) {
    const normalized = normalizeNameForCompare(value);
    if (!normalized) return "World";
    if (normalized === "women" || normalized === "womens" || normalized === "female") return "Women";
    if (normalized === "midcard") return "Midcard";
    if (normalized === "tag" || normalized === "tagteam" || normalized === "team") return "Tag";
    if (normalized === "world" || normalized === "main" || normalized === "mainevent") return "World";
    return "Other";
}
function championshipDivisionLabel(value) {
    return value === "Women" ? "Women's" : value;
}
function championshipNameLooksMidcard(name) {
    const normalizedName = normalizeNameForCompare(name);
    return /intercontinental|united states|unitedstates|\bus\b|north american|northamerican|television|heritage cup|heritagecup|cruiserweight|european|continental|national/.test(normalizedName);
}
function inferChampionshipDivisionFromName(name, gender = "Intergender") {
    const normalizedName = normalizeNameForCompare(name);
    if (/tag|team/.test(normalizedName)) return "Tag";
    if (championshipNameLooksMidcard(normalizedName)) {
        return "Midcard";
    }
    if (/women|womens|divas/.test(normalizedName)) return "Women";
    if (normalizeChampionshipGender(gender) === "Female") return "Women";
    return "World";
}
function normalizeChampionshipDivision(value, name = "", gender = "Intergender") {
    const normalized = normalizeNameForCompare(value);
    if (normalized === "women" || normalized === "womens" || normalized === "female") return "Women";
    if (normalized === "midcard") return "Midcard";
    if (normalized === "tag" || normalized === "tagteam" || normalized === "team") return "Tag";
    if (normalized === "world" || normalized === "main" || normalized === "mainevent") return "World";
    return inferChampionshipDivisionFromName(name, gender);
}
function enrichChampionship(championship) {
    const name = typeof championship === "string"
        ? championship.trim()
        : String(championship?.name ?? "").trim();
    if (!name) return null;
    const gender = normalizeChampionshipGender(championship?.gender);
    const rawShowRefs = Array.from(new Set([
        ...parseShowRefs(championship?.showIds),
        ...parseShowRefs(championship?.shows),
        ...parseShowRefs(championship?.showId),
        ...parseShowRefs(championship?.show),
        ...parseShowRefs(championship?.showName),
    ]));
    return {
        id: championship?.id || uid("title"),
        name,
        gender,
        division: normalizeChampionshipDivision(championship?.division, name, gender),
        showIds: rawShowRefs,
        showId: rawShowRefs[0] ?? null, // legacy compatibility
    };
}
function enrichSuperstar(ss) {
    const rawShowRefs = Array.from(new Set([
        ...parseShowRefs(ss?.showIds),
        ...parseShowRefs(ss?.shows),
        ...parseShowRefs(ss?.showId),
        ...parseShowRefs(ss?.show),
        ...parseShowRefs(ss?.showName),
    ]));
    const championships = parseChampionships(ss?.championships);
    return {
        id: ss?.id || uid("ss"),
        name: String(ss?.name ?? "").trim(),
        showId: rawShowRefs[0] ?? null, // legacy compatibility
        showIds: rawShowRefs,
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
    normalized.universeStartDate = isISODate(normalized.universeStartDate) ? normalized.universeStartDate : todayISO();
    normalized.completedDates = Array.isArray(normalized.completedDates)
        ? Array.from(new Set(normalized.completedDates.filter(isISODate))).sort()
        : [];
    normalized.shows = Array.isArray(normalized.shows)
        ? normalized.shows
            .map(s => {
                const id = String(s?.id ?? "").trim() || uid("show");
                const name = String(s?.name ?? "").trim();
                if (!name) return null;
                return {
                    id,
                    name,
                    color: normalizeHexColor(s?.color) || randomShowColor(name),
                };
            })
            .filter(Boolean)
        : [];

    const validShowIds = new Set(normalized.shows.map(s => s.id));
    const showNameToId = new Map(normalized.shows.map(s => [s.name.toLowerCase(), s.id]));
    const resolveShowRefs = (refs) => Array.from(new Set(
        parseShowRefs(refs)
            .map(ref => validShowIds.has(ref) ? ref : (showNameToId.get(String(ref).toLowerCase()) || null))
            .filter(Boolean)
    ));
    normalized.championships = Array.isArray(normalized.championships)
        ? normalized.championships
            .map(enrichChampionship)
            .filter(Boolean)
            .map(c => {
                const resolvedShowIds = resolveShowRefs(c?.showIds);
                return {
                    ...c,
                    showIds: resolvedShowIds,
                    showId: resolvedShowIds[0] ?? null,
                };
            })
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
            const validShowIds = resolveShowRefs(ss.showIds);
            const championshipIds = parseChampionships(ss.championships)
                .map(resolveChampionshipId)
                .filter(Boolean)
                .filter(championshipId => {
                    const championship = byId.get(championshipId);
                    return championshipEligibleForSuperstar(championship, {
                        ...ss,
                        showIds: validShowIds,
                        showId: validShowIds[0] ?? null,
                    });
                });
            return {
                ...ss,
                showIds: validShowIds,
                showId: validShowIds[0] ?? null,
                championships: Array.from(new Set(championshipIds)),
                isChampion: championshipIds.length > 0,
            };
        })
        : [];

    const validSuperstarIds = new Set(normalized.superstars.map(ss => ss.id));
    const superstarNameToId = new Map(normalized.superstars.map(ss => [ss.name.toLowerCase(), ss.id]));
    normalized.rivalries = Array.isArray(normalized.rivalries)
        ? normalized.rivalries
            .map(row => {
                const title = String(row?.title ?? row?.name ?? "").trim();
                const participantIds = Array.from(new Set(
                    parseShowRefs(row?.participantIds ?? row?.participants ?? row?.superstars)
                        .map(ref => validSuperstarIds.has(ref) ? ref : (superstarNameToId.get(String(ref).toLowerCase()) || null))
                        .filter(Boolean)
                ));
                if (!title && !participantIds.length) return null;
                const showIds = resolveShowRefs([
                    ...parseShowRefs(row?.showIds),
                    ...parseShowRefs(row?.showId),
                    ...parseShowRefs(row?.show),
                    ...parseShowRefs(row?.showName),
                ]);
                return {
                    id: row?.id || uid("riv"),
                    title: title || participantIds.map(id => normalized.superstars.find(ss => ss.id === id)?.name).filter(Boolean).join(" vs "),
                    showIds,
                    showId: showIds[0] ?? null,
                    participantIds,
                    status: normalizeRivalryStatus(row?.status),
                    startDate: isISODate(row?.startDate) ? row.startDate : "",
                    endDate: isISODate(row?.endDate) ? row.endDate : "",
                    summary: String(row?.summary ?? row?.storyline ?? "").trim(),
                    notes: String(row?.notes ?? "").trim(),
                };
            })
            .filter(Boolean)
        : [];

    // === Title reign records (stored, set in stone, manually editable) ===
    // Each reign is an immutable snapshot of a championship being held:
    //   { id, championshipId, holderIds[], holderNames[], startDate, endDate (null = current), eventId?, isInitial }
    // Migration: if no titleReigns array exists in saved state, we'll seed it
    // from match history on first save (see seedTitleReignsFromHistory below).
    normalized.titleReigns = Array.isArray(normalized.titleReigns)
        ? normalized.titleReigns
            .map(r => {
                const championshipId = String(r?.championshipId || "").trim();
                if (!championshipId) return null;
                const holderIds = Array.isArray(r?.holderIds)
                    ? r.holderIds.map(String).filter(Boolean)
                    : (r?.holderId ? [String(r.holderId)] : []);
                if (!holderIds.length) return null;
                // Holder names are snapshot at time of reign — preserve even if wrestler is deleted later.
                const holderNames = Array.isArray(r?.holderNames) && r.holderNames.length
                    ? r.holderNames.map(String)
                    : holderIds.map(id => {
                        const ss = normalized.superstars.find(s => s.id === id);
                        return ss?.name || "(unknown)";
                    });
                return {
                    id: String(r?.id || uid("rgn")),
                    championshipId,
                    holderIds,
                    holderNames,
                    startDate: isISODate(r?.startDate) ? r.startDate : (normalized.universeStartDate || todayISO()),
                    endDate: isISODate(r?.endDate) ? r.endDate : null,
                    eventId: String(r?.eventId || "") || null,
                    isInitial: !!r?.isInitial,
                };
            })
            .filter(Boolean)
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

    normalized.events = Array.isArray(normalized.events)
        ? normalized.events.map(ev => {
            const type = String(ev?.type ?? "weekly").trim().toLowerCase() === "ppv" ? "ppv" : "weekly";
            const showIds = resolveShowRefs([
                ...parseShowRefs(ev?.showIds),
                ...parseShowRefs(ev?.showId),
                ...parseShowRefs(ev?.show),
                ...parseShowRefs(ev?.showName),
            ]);
            return {
                ...ev,
                type,
                showIds,
                showId: showIds[0] ?? null,
            };
        })
        : [];

    // The universe calendar only has days 1–28. PLEs dated on the 29th–31st
    // (e.g. a Jan 31 Royal Rumble) move to the 28th — the last Sunday of the
    // universe month — so they show up. Empty weekly shows that an older
    // version generated on those days are dropped; booked ones are kept.
    normalized.events = normalized.events.filter(ev => {
        if (!isISODate(ev?.date) || isUniverseCalendarDay(ev.date)) return true;
        if (ev.type === "ppv") {
            ev.date = clampToUniverseDay(ev.date);
            return true;
        }
        return (Array.isArray(ev.matches) ? ev.matches : []).some(m => matchParticipantRefs(m).length || String(m?.result || "").trim());
    });

    return normalized;
}
function clampToUniverseDay(iso) {
    if (!isISODate(iso) || isUniverseCalendarDay(iso)) return iso;
    return `${String(iso).slice(0, 8)}${String(CALENDAR_DAYS_PER_MONTH).padStart(2, "0")}`;
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
        championships: [], // {id, name, division?, gender?, showIds:[], showId(legacy)}
        superstars: [],   // {id, name, showIds:[], showId(legacy), division}
        rivalries: [],    // {id, title, showIds:[], participantIds:[], status, startDate, endDate, summary, notes}
        weeklySchedule: [], // [{showId, weekday}] where weekday is 0-6
        events: [],       // {id, date, type:"weekly"|"ppv", showId|null, name, matches:[...], defaultRows?}
        universeStartDate: todayISO(),
        completedDates: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
    };
}

function storageSafeSnapshot(sourceState) {
    const snapshot = safeJSONParse(JSON.stringify(sourceState)) || defaultState();
    snapshot.superstars = (snapshot.superstars || []).map(superstar => {
        const photo = String(superstar?.photo || "");
        // Embedded photos are kept in IndexedDB. Dropping only an embedded image
        // is safer than losing the entire universe when browser storage is full.
        return /^data:image\//i.test(photo) ? { ...superstar, photo: "" } : superstar;
    });
    return snapshot;
}

const store = {
    lastSaveError: null,
    saveCount: 0,
    load() {
        const primaryRaw = localStorage.getItem(STORAGE_KEY);
        const recoveryRaw = (() => {
            try { return sessionStorage.getItem(STORAGE_RECOVERY_KEY); } catch { return null; }
        })();
        const primary = safeJSONParse(primaryRaw);
        const recovery = safeJSONParse(recoveryRaw);
        const validPrimary = primary && primary.version ? primary : null;
        const validRecovery = recovery && recovery.version ? recovery : null;

        if (validPrimary && validRecovery) {
            return Number(validRecovery.updatedAt || 0) > Number(validPrimary.updatedAt || 0)
                ? validRecovery
                : validPrimary;
        }
        if (validPrimary) return validPrimary;
        if (validRecovery) return validRecovery;

        // Corrupt or unrecognized — back it up before falling back to defaults.
        if (primaryRaw) {
            try {
                const backupKey = `${STORAGE_BACKUP_PREFIX}${Date.now()}`;
                localStorage.setItem(backupKey, primaryRaw);
            } catch (e) { /* ignore — at least we tried */ }
        }
        return defaultState();
    },
    save(state) {
        state.updatedAt = Date.now();
        let serialized = "";
        try {
            serialized = JSON.stringify(state);
            localStorage.setItem(STORAGE_KEY, serialized);
            try { sessionStorage.setItem(STORAGE_RECOVERY_KEY, serialized); } catch { /* optional recovery */ }
            this.lastSaveError = null;
            this.saveCount += 1;
            return { ok: true, degraded: false };
        } catch (err) {
            // Quota failures used to make the next browser reload look like a full
            // reset. Keep the core universe safe even if an embedded photo is huge.
            try {
                const compact = storageSafeSnapshot(state);
                compact.updatedAt = state.updatedAt;
                serialized = JSON.stringify(compact);
                localStorage.setItem(STORAGE_KEY, serialized);
                try { sessionStorage.setItem(STORAGE_RECOVERY_KEY, serialized); } catch { /* optional recovery */ }
                this.lastSaveError = err;
                this.saveCount += 1;
                return { ok: true, degraded: true, error: err };
            } catch (fallbackError) {
                this.lastSaveError = fallbackError;
                return { ok: false, error: fallbackError };
            }
        }
    },
    wipe() {
        localStorage.removeItem(STORAGE_KEY);
        try { sessionStorage.removeItem(STORAGE_RECOVERY_KEY); } catch { /* ignore */ }
    },
    listCorruptBackups() {
        const keys = [];
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.startsWith(STORAGE_BACKUP_PREFIX)) keys.push(k);
        }
        return keys;
    }
};

let state = store.load();
state = normalizeStateData(state);

// One-time migration: if we have a started universe but no stored reigns,
// derive them from history once and save them as set-in-stone records.
(function migrateTitleReignsOnce() {
    if (!Array.isArray(state.titleReigns)) state.titleReigns = [];
    if (state.titleReigns.length > 0) return; // already migrated
    const hasHistory = (state.completedDates || []).length > 0 || (state.events || []).some(e => Array.isArray(e?.matches) && e.matches.length);
    const hasChampionships = (state.championships || []).length > 0;
    if (!hasHistory || !hasChampionships) return;
    try {
        state.titleReigns = seedTitleReignsFromHistory();
        state.updatedAt = Date.now();
    } catch (e) {
        console.error("Title reign migration failed:", e);
        state.titleReigns = [];
    }
})();

let addSuperstarShowIds = new Set();

// Debounced saving (smooth typing)
let saveTimer = null;
let pendingSave = false;
function flushSaveNow() {
    if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
    }
    if (!pendingSave) return;
    pendingSave = false;
    const result = store.save(state);
    const indicator = $("#saveState");
    if (indicator) {
        if (result.ok) {
            indicator.textContent = result.degraded ? "Saved • photos pending" : "Saved";
            indicator.classList.toggle("muted", !result.degraded);
            indicator.classList.toggle("save-state-error", !!result.degraded);
        } else {
            indicator.textContent = "Save failed";
            indicator.classList.remove("muted");
            indicator.classList.add("save-state-error");
        }
    }
    // Periodic backup nudge — every 50 successful saves
    if (result.ok && store.saveCount > 0 && store.saveCount % 50 === 0) {
        showBackupReminderToast();
    }
    if (result.degraded) {
        showToast({
            message: "Your universe was saved safely, but one or more embedded photos were too large for browser storage.",
            tone: "info",
            duration: 5200,
        });
    } else if (!result.ok) {
        showSaveErrorToast();
    }
}
function saveSoon() {
    bumpDataVersion();
    pendingSave = true;
    const indicator = $("#saveState");
    if (indicator) {
        indicator.classList.remove("muted");
        indicator.classList.remove("save-state-error");
        indicator.textContent = "Saving…";
    }
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSaveNow, 250);
}
window.addEventListener("beforeunload", () => {
    if (pendingSave) flushSaveNow();
});
// Also flush on page hide (mobile Safari may not fire beforeunload reliably)
document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && pendingSave) flushSaveNow();
});

// -------------------- HELPERS --------------------
function getShow(showId) { return state.shows.find(s => s.id === showId) || null; }
function getUniverseStartISO() {
    if (!isISODate(state.universeStartDate)) state.universeStartDate = todayISO();
    return state.universeStartDate;
}
// Read-only: the returned Set is shared, never mutate it.
function completedDateSet() {
    if (!Array.isArray(state.completedDates)) state.completedDates = [];
    const dates = state.completedDates;
    return memo("completedDates", [dates, dates.length], () => new Set(dates.filter(isISODate)));
}
function isUniverseDateCompleted(iso) {
    return completedDateSet().has(iso);
}
function setUniverseDateCompleted(iso, done) {
    if (!isISODate(iso)) return;
    const set = new Set(completedDateSet());
    if (done) set.add(iso);
    else set.delete(iso);
    state.completedDates = Array.from(set).sort();
}

// The universe uses 2K-style 4-week months: only days 1–28 exist on the
// calendar. Days 29–31 are skipped everywhere (progression, generation, "now").
function isUniverseCalendarDay(iso) {
    return isISODate(iso) && Number(String(iso).slice(8, 10)) <= CALENDAR_DAYS_PER_MONTH;
}
function nextUniverseDayISO(iso) {
    const d = parseISO(iso);
    if (d.getDate() >= CALENDAR_DAYS_PER_MONTH) d.setMonth(d.getMonth() + 1, 1);
    else d.setDate(d.getDate() + 1);
    return toISODateLocal(d);
}
function firstUniverseDayOnOrAfter(iso) {
    return isUniverseCalendarDay(iso) ? iso : nextUniverseDayISO(iso);
}

// Mark a day done and lock in any title changes from its championship matches.
// Returns the list of { championship, holders } changes for feedback.
function completeUniverseDay(iso) {
    if (!isISODate(iso)) return [];
    const before = new Set((state.titleReigns || []).map(r => r.id));
    setUniverseDateCompleted(iso, true);
    applyReignChangesForDate(iso);
    return (state.titleReigns || [])
        .filter(r => !before.has(r.id))
        .map(r => ({ championship: championshipName(r.championshipId), holders: (r.holderNames || []).join(" & ") }));
}
function announceTitleChanges(changes) {
    (changes || []).forEach(change => {
        showToast({ message: `🏆 New champion: ${change.holders} — ${change.championship}`, tone: "info", duration: 5200 });
    });
}

// When a day is marked done, walk all championship matches on that date and
// record reign changes into state.titleReigns. This is the only "live" path
// that creates reigns — once a reign exists, it stays until manually edited.
//
// Unmarking a day does NOT roll back its reigns automatically. That preserves
// the "set in stone" guarantee. To roll back, the user must edit/delete the
// reign manually in the championship editor.
function applyReignChangesForDate(iso) {
    if (!isISODate(iso)) return 0;
    let recorded = 0;
    const evs = state.events
        .filter(e => e.date === iso && Array.isArray(e.matches))
        .sort((a, b) => String(a.id).localeCompare(String(b.id))); // stable order
    for (const ev of evs) {
        // Process matches in their planner order (top to bottom)
        for (const match of ev.matches) {
            if (maybeRecordReignChangeFromMatch(match, ev)) recorded += 1;
        }
    }
    return recorded;
}
function getUniverseCurrentISO() {
    const startISO = getUniverseStartISO();
    const done = completedDateSet();
    return memo("universeNow", [done, startISO], () => {
        let iso = firstUniverseDayOnOrAfter(startISO);
        for (let i = 0; i < 36600; i++) {
            if (!done.has(iso)) return iso;
            iso = nextUniverseDayISO(iso);
        }
        return startISO;
    });
}
function nextUniverseEvent() {
    const startISO = getUniverseStartISO();
    const done = completedDateSet();
    return state.events
        .filter(e => isUniverseCalendarDay(e?.date))
        .filter(e => e.date >= startISO)
        .filter(e => !done.has(e.date))
        .sort((a, b) => a.date.localeCompare(b.date))[0] || null;
}
const WEEKDAY_OPTIONS = [
    { value: 1, label: "Monday" },
    { value: 2, label: "Tuesday" },
    { value: 3, label: "Wednesday" },
    { value: 4, label: "Thursday" },
    { value: 5, label: "Friday" },
    { value: 6, label: "Saturday" },
    { value: 0, label: "Sunday" },
];
const RIVALRY_STATUS_OPTIONS = ["Active", "Heating Up", "Blowoff Ready", "Paused", "Ended"];
function normalizeRivalryStatus(value) {
    const raw = String(value ?? "").trim();
    const statuses = ["Active", "Heating Up", "Blowoff Ready", "Paused", "Ended"];
    const found = statuses.find(status => status.toLowerCase() === raw.toLowerCase());
    return found || "Active";
}
function rivalryShowNames(rivalry) {
    const ids = Array.isArray(rivalry?.showIds) ? rivalry.showIds : (rivalry?.showId ? [rivalry.showId] : []);
    return ids.map(showName).filter(name => name && name !== "Unknown show" && name !== "No show");
}
function rivalryParticipantNames(rivalry) {
    return (Array.isArray(rivalry?.participantIds) ? rivalry.participantIds : [])
        .map(id => state.superstars.find(ss => ss.id === id)?.name)
        .filter(Boolean);
}
function rivalryParticipants(rivalry) {
    return (Array.isArray(rivalry?.participantIds) ? rivalry.participantIds : [])
        .map(id => state.superstars.find(ss => ss.id === id))
        .filter(Boolean);
}
function rivalryDisplayTitle(rivalry) {
    const names = rivalryParticipantNames(rivalry);
    return names.length >= 2 ? names.join(" vs ") : String(rivalry?.title || "Untitled Rivalry").trim();
}
function calendarWeekdaySundayZero(date) {
    // In the custom 28-day calendar, day 1 is Monday.
    // Maps day-of-month to 0-6 using Sunday=0, Monday=1 ... Saturday=6.
    return date.getDate() % 7;
}
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
function superstarGender(superstar) {
    return normalizeSuperstarDivision(superstar?.division) === "Women" ? "Female" : "Male";
}
function championshipEligibleForGenders(championship, genders) {
    const requiredGenders = Array.from(new Set(
        (Array.isArray(genders) ? genders : [genders])
            .map(gender => normalizeChampionshipGender(gender))
            .filter(Boolean)
    ));
    if (!requiredGenders.length) return true;
    const titleGender = normalizeChampionshipGender(championship?.gender);
    if (titleGender === "Intergender") return true;
    return requiredGenders.length === 1 && requiredGenders[0] === titleGender;
}
function championshipAvailableForShowIds(championship, showIds) {
    const eventOrRosterShowIds = Array.isArray(showIds) ? showIds.filter(Boolean) : [];
    if (!eventOrRosterShowIds.length) return true;
    const champShowIds = Array.isArray(championship?.showIds) ? championship.showIds.filter(Boolean) : [];
    if (!champShowIds.length) return true;
    return champShowIds.some(showId => eventOrRosterShowIds.includes(showId));
}
function championshipEligibleForDivision(championship, division) {
    return true;
}
function championshipEligibleForSuperstar(championship, superstar) {
    if (!championship || !superstar) return true;
    const showIds = Array.isArray(superstar?.showIds) && superstar.showIds.length
        ? superstar.showIds
        : (superstar?.showId ? [superstar.showId] : []);
    return championshipAvailableForShowIds(championship, showIds);
}
function championshipEligibleForParticipantIds(championship, participantIds) {
    const participants = (Array.isArray(participantIds) ? participantIds : [])
        .map(id => state.superstars.find(ss => ss.id === id))
        .filter(Boolean);
    if (!participants.length) return true;
    return participants.every(participant => championshipEligibleForSuperstar(championship, participant));
}
function championshipEligibleForMatch(championship, match, showIds) {
    if (!championshipAvailableForShowIds(championship, showIds)) return false;
    const participantIds = Array.isArray(match?.participants) ? match.participants.filter(Boolean) : [];
    return championshipEligibleForParticipantIds(championship, participantIds);
}
function eligibleChampionshipsForShowIds(showIds, options = {}) {
    const participantIds = Array.isArray(options?.participantIds) ? options.participantIds.filter(Boolean) : [];
    const superstar = options?.superstar || null;
    return state.championships.filter(c => {
        if (!championshipAvailableForShowIds(c, showIds)) return false;
        if (participantIds.length && !championshipEligibleForParticipantIds(c, participantIds)) return false;
        if (superstar && !championshipEligibleForSuperstar(c, superstar)) return false;
        return true;
    });
}
function championshipShowNames(championship) {
    const showIds = Array.isArray(championship?.showIds) ? championship.showIds : [];
    return showIds.map(showName).filter(name => name && name !== "Unknown show" && name !== "No show");
}
function championshipScopeSummary(championship) {
    const shows = championshipShowNames(championship);
    const showSummary = shows.length ? shows.join(", ") : "Any show";
    return `${championshipDivisionLabel(normalizeChampionshipDivision(championship?.division, championship?.name, championship?.gender))} • ${normalizeChampionshipGender(championship?.gender)} • ${showSummary}`;
}
function superstarChampionshipNames(superstar) {
    return parseChampionships(superstar?.championships)
        .map(championshipName)
        .filter(Boolean);
}
const photoVaultCache = new Map();
let photoVaultDbPromise = null;

function photoVaultRef(superstarId) {
    return `${PHOTO_REF_PREFIX}${superstarId}`;
}
function photoVaultIdFromRef(value) {
    const raw = String(value || "");
    return raw.startsWith(PHOTO_REF_PREFIX) ? raw.slice(PHOTO_REF_PREFIX.length) : "";
}
function openPhotoVaultDB() {
    if (!("indexedDB" in window)) return Promise.reject(new Error("IndexedDB is unavailable."));
    if (photoVaultDbPromise) return photoVaultDbPromise;
    photoVaultDbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(PHOTO_DB_NAME, 1);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(PHOTO_DB_STORE)) db.createObjectStore(PHOTO_DB_STORE);
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("Could not open the photo vault."));
    });
    return photoVaultDbPromise;
}
async function savePhotoToVault(superstarId, dataURL) {
    const db = await openPhotoVaultDB();
    await new Promise((resolve, reject) => {
        const tx = db.transaction(PHOTO_DB_STORE, "readwrite");
        tx.objectStore(PHOTO_DB_STORE).put(String(dataURL || ""), superstarId);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error("Could not save that photo."));
        tx.onabort = () => reject(tx.error || new Error("Photo save was interrupted."));
    });
    photoVaultCache.set(superstarId, String(dataURL || ""));
    return photoVaultRef(superstarId);
}
async function loadPhotoFromVault(superstarId) {
    if (photoVaultCache.has(superstarId)) return photoVaultCache.get(superstarId) || "";
    const db = await openPhotoVaultDB();
    const value = await new Promise((resolve, reject) => {
        const tx = db.transaction(PHOTO_DB_STORE, "readonly");
        const request = tx.objectStore(PHOTO_DB_STORE).get(superstarId);
        request.onsuccess = () => resolve(String(request.result || ""));
        request.onerror = () => reject(request.error || new Error("Could not load that photo."));
    });
    if (value) photoVaultCache.set(superstarId, value);
    return value;
}
async function deletePhotoFromVault(superstarId) {
    photoVaultCache.delete(superstarId);
    if (!("indexedDB" in window)) return;
    const db = await openPhotoVaultDB();
    await new Promise((resolve, reject) => {
        const tx = db.transaction(PHOTO_DB_STORE, "readwrite");
        tx.objectStore(PHOTO_DB_STORE).delete(superstarId);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error("Could not remove that photo."));
    });
}
async function clearPhotoVault() {
    photoVaultCache.clear();
    if (!("indexedDB" in window)) return;
    const db = await openPhotoVaultDB();
    await new Promise((resolve, reject) => {
        const tx = db.transaction(PHOTO_DB_STORE, "readwrite");
        tx.objectStore(PHOTO_DB_STORE).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error("Could not clear the photo vault."));
    });
}
function rerenderCurrentViewPreservingScroll() {
    const x = window.scrollX || 0;
    const y = window.scrollY || 0;
    renderAll();
    requestAnimationFrame(() => window.scrollTo(x, y));
}
async function initializePhotoVault() {
    if (!("indexedDB" in window)) return;
    let migrated = false;
    let loaded = false;
    for (const superstar of state.superstars) {
        const raw = String(superstar?.photo || "").trim();
        try {
            if (/^data:image\//i.test(raw)) {
                superstar.photo = await savePhotoToVault(superstar.id, raw);
                migrated = true;
                loaded = true;
            } else {
                const vaultId = photoVaultIdFromRef(raw);
                if (vaultId && await loadPhotoFromVault(vaultId)) loaded = true;
            }
        } catch (error) {
            console.warn("Photo vault initialization skipped a photo:", error);
        }
    }
    if (migrated) store.save(state);
    if (loaded) rerenderCurrentViewPreservingScroll();
}

function superstarPhotoURL(superstar) {
    const raw = String(superstar?.photo ?? "").trim();
    if (!raw) return "";
    const vaultId = photoVaultIdFromRef(raw);
    if (vaultId) return photoVaultCache.get(vaultId) || "";
    // Reject dangerous schemes outright (javascript:, vbscript:, file:, non-image data:)
    if (/^javascript:/i.test(raw)) return "";
    if (/^vbscript:/i.test(raw)) return "";
    if (/^file:/i.test(raw)) return "";
    if (/^data:/i.test(raw) && !/^data:image\//i.test(raw)) return "";
    // http(s) and data:image/ are explicitly allowed
    if (/^(https?:\/\/|data:image\/)/i.test(raw)) return raw;
    // Any other string with no scheme is treated as a relative path (e.g. images/superstars/cody.png)
    if (!/^[a-z][a-z0-9+.-]*:/i.test(raw)) return raw;
    return "";
}
function superstarInitials(name) {
    const parts = String(name ?? "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "?";
    return parts.slice(0, 2).map(p => p[0].toUpperCase()).join("");
}
// O(1) superstar lookups by id / name (rebuilt only when the roster changes).
function superstarLookup() {
    const roster = state.superstars;
    return memo("superstarLookup", [roster, roster.length, dataVersion], () => {
        const byId = new Map();
        const byName = new Map();
        roster.forEach(ss => {
            byId.set(ss.id, ss);
            const key = normalizeNameForCompare(ss.name);
            if (key && !byName.has(key)) byName.set(key, ss);
        });
        return { byId, byName };
    });
}
function getSuperstar(id) {
    return superstarLookup().byId.get(String(id ?? "").trim()) || null;
}
function superstarNameById(id) {
    return getSuperstar(id)?.name || "";
}
function resolveSuperstarFromRef(ref) {
    const raw = String(ref ?? "").trim();
    if (!raw) return null;
    const lookup = superstarLookup();
    return lookup.byId.get(raw) || lookup.byName.get(normalizeNameForCompare(raw)) || null;
}
function resolveSuperstarIdFromRef(ref) {
    return resolveSuperstarFromRef(ref)?.id || "";
}
// Participants are stored positionally (one entry per slot, "" = open slot).
function matchParticipantRefs(match) {
    return (Array.isArray(match?.participants) ? match.participants : [])
        .map(ref => String(ref ?? "").trim())
        .filter(Boolean);
}
function isDQResult(resultValue) {
    const normalized = normalizeNameForCompare(resultValue);
    return normalized === "dq" || normalized.includes("disqualification");
}
function isDrawRecordResult(resultValue) {
    const normalized = normalizeNameForCompare(resultValue);
    return normalized === "draw" || normalized === "tie";
}
function isPromoResult(resultValue) {
    const normalized = normalizeNameForCompare(resultValue);
    return normalized === "promo";
}
function isSpecialMatchResult(resultValue) {
    const normalized = normalizeNameForCompare(resultValue);
    return isDQResult(resultValue)
        || isDrawRecordResult(resultValue)
        || normalized === "no contest"
        || normalized === "nc"
        || normalized === "no result"
        || normalized === "promo";
}
function computeSuperstarRecords() {
    return memo("records", [state.events, state.superstars, dataVersion], computeSuperstarRecordsUncached);
}
function computeSuperstarRecordsUncached() {
    const records = new Map();
    state.superstars.forEach(ss => {
        records.set(ss.id, { wins: 0, losses: 0, draws: 0 });
    });

    state.events.forEach(ev => {
        const matches = Array.isArray(ev?.matches) ? ev.matches : [];
        matches.forEach(match => {
            const participantIds = Array.from(new Set(
                (Array.isArray(match?.participants) ? match.participants : [])
                    .map(resolveSuperstarIdFromRef)
                    .filter(Boolean)
            ));
            if (participantIds.length < 2) return;

            const resultValue = String(match?.result ?? "").trim();
            // Empty result = "(no winner yet)" — match hasn't been booked with an outcome.
            // Do nothing. Match doesn't affect anyone's W/L record.
            if (!resultValue) return;
            if (normalizeNameForCompare(resultValue) === "no result") return;
            if (isPromoResult(resultValue)) return; // Promo does not affect W/L/D
            if (isDQResult(resultValue)) return; // DQ does not affect W/L/D
            // Draw results are not used in this universe — skip without affecting records.
            if (isDrawRecordResult(resultValue)) return;

            if (isTeamResultValue(resultValue)) {
                const teams = inferMatchTeams(match?.matchType, participantIds, normalizedParticipantTeams(match));
                const winningTeamKey = parseTeamResultValue(resultValue);
                const winningTeam = teams.find(group => group.key === winningTeamKey);
                const winners = winningTeam?.participants || [];
                const losers = teams
                    .filter(group => group.key !== winningTeamKey)
                    .flatMap(group => group.participants);
                if (!winners.length || !losers.length) return;
                winners.forEach(pid => {
                    const rec = records.get(pid);
                    if (!rec) return;
                    rec.wins += 1;
                });
                losers.forEach(pid => {
                    const rec = records.get(pid);
                    if (!rec) return;
                    rec.losses += 1;
                });
                return;
            }

            const winnerId = resolveSuperstarIdFromRef(resultValue);
            if (!winnerId || !participantIds.includes(winnerId)) return;
            participantIds.forEach(pid => {
                const rec = records.get(pid);
                if (!rec) return;
                if (pid === winnerId) rec.wins += 1;
                else rec.losses += 1;
            });
        });
    });

    return records;
}
function superstarRecordById(superstarId, recordMap = null) {
    const records = recordMap || computeSuperstarRecords();
    return records.get(superstarId) || { wins: 0, losses: 0, draws: 0 };
}
function formatRecord(record) {
    const wins = toNonNegativeInt(record?.wins);
    const losses = toNonNegativeInt(record?.losses);
    const draws = toNonNegativeInt(record?.draws);
    return draws > 0 ? `${wins}-${draws}-${losses}` : `${wins}-${losses}`;
}
function isTeamOrHandicapMatch(matchType, participantCount) {
    const t = String(matchType || "").toLowerCase();
    if (participantCount < 3) return false;
    return /tag|handicap/.test(t);
}
function isTagTeamMatchType(matchType) {
    const t = String(matchType || "").toLowerCase();
    return t.includes("tag");
}
function normalizeTeamKey(value) {
    const raw = String(value || "").trim().toUpperCase();
    if (!raw) return "";
    if (raw === "A") return "T1";
    if (raw === "B") return "T2";
    if (/^TEAM:\s*[AB]$/.test(raw)) return normalizeTeamKey(raw.slice(5));
    if (/^TEAM:\s*T\d+$/.test(raw)) return normalizeTeamKey(raw.slice(5));
    if (/^T\d+$/.test(raw)) return raw;
    if (/^\d+$/.test(raw)) return `T${Math.max(1, Number(raw))}`;
    return "";
}
function teamKeyIndex(teamKey) {
    const normalized = normalizeTeamKey(teamKey);
    if (!normalized) return 0;
    return Math.max(1, Number(normalized.slice(1)) || 1);
}
function compareTeamKeys(a, b) {
    return teamKeyIndex(a) - teamKeyIndex(b);
}
function teamLabel(teamKey) {
    return `Team ${teamKeyIndex(teamKey) || 1}`;
}
function teamResultValue(teamKey) {
    const normalized = normalizeTeamKey(teamKey);
    return normalized ? `TEAM:${normalized}` : "";
}
function parseTeamResultValue(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    if (raw === "TEAM:A") return "T1";
    if (raw === "TEAM:B") return "T2";
    if (!raw.toUpperCase().startsWith("TEAM:")) return "";
    return normalizeTeamKey(raw.slice(5));
}
function isTeamResultValue(value) {
    return Boolean(parseTeamResultValue(value));
}
function normalizedParticipantTeams(match) {
    const raw = match?.participantTeams;
    if (!raw || typeof raw !== "object") return {};
    const out = {};
    Object.entries(raw).forEach(([participantId, team]) => {
        const pid = String(participantId || "").trim();
        const t = normalizeTeamKey(team);
        if (!pid) return;
        if (!t) return;
        out[pid] = t;
    });
    return out;
}
function normalizedTeamNames(match) {
    const raw = match?.teamNames;
    if (!raw || typeof raw !== "object") return {};
    const out = {};
    Object.entries(raw).forEach(([teamKey, name]) => {
        const normalized = normalizeTeamKey(teamKey);
        const nextName = String(name ?? "").trim();
        if (!normalized || !nextName) return;
        out[normalized] = nextName;
    });
    if (!Object.keys(out).length) {
        const legacyA = String(raw.A ?? "").trim();
        const legacyB = String(raw.B ?? "").trim();
        if (legacyA) out.T1 = legacyA;
        if (legacyB) out.T2 = legacyB;
    }
    return out;
}
function normalizedParticipantEscorts(match) {
    const raw = match?.participantEscorts;
    if (!raw || typeof raw !== "object") return {};
    const out = {};
    Object.entries(raw).forEach(([participantId, escortRef]) => {
        const pid = String(participantId || "").trim();
        const ref = String(escortRef || "").trim();
        if (!pid || !ref) return;
        out[pid] = ref;
    });
    return out;
}
function escortRefForSuperstar(superstarId) {
    return `SS:${String(superstarId || "").trim()}`;
}
function escortRefForManager(managerName) {
    return `MGR:${String(managerName || "").trim()}`;
}
function escortDisplayNameFromRef(escortRef) {
    const raw = String(escortRef || "").trim();
    if (!raw) return "";
    if (raw.startsWith("SS:")) {
        const superstarId = raw.slice(3).trim();
        return superstarNameById(superstarId) || "";
    }
    if (raw.startsWith("MGR:")) {
        return raw.slice(4).trim();
    }
    // Legacy fallback: raw might be stored as superstar id
    return superstarNameById(raw) || raw;
}
function participantEscortName(match, participantRef) {
    const participantId = resolveSuperstarIdFromRef(participantRef);
    if (!participantId) return "";
    const escorts = normalizedParticipantEscorts(match);
    return escortDisplayNameFromRef(escorts[participantId] || "");
}
function factionOptionsForParticipants(participantRefs = []) {
    const options = new Set();
    participantRefs.forEach(ref => {
        const superstarId = resolveSuperstarIdFromRef(ref);
        if (!superstarId) return;
        const superstar = state.superstars.find(ss => ss.id === superstarId);
        const faction = String(superstar?.faction ?? "").trim();
        if (faction) options.add(faction);
    });
    return Array.from(options).sort((a, b) => a.localeCompare(b));
}
function teamDisplayName(match, teamKey, participantRefs = []) {
    const names = normalizedTeamNames(match);
    const normalized = normalizeTeamKey(teamKey);
    const custom = String(names?.[normalized] ?? "").trim();
    if (custom) return custom;
    return teamLabel(normalized);
}
function teamNameInitial(name, fallback = "?") {
    const value = String(name ?? "").trim();
    if (!value) return fallback;
    return value[0].toUpperCase();
}
function multiTeamFightHTML(teamGroups, renderTeamBlockHTML, extraVsClass = "") {
    const count = Array.isArray(teamGroups) ? teamGroups.length : 0;
    if (count <= 2) return "";
    const vsClass = ["event-vs", "event-fight-cluster-vs", extraVsClass].filter(Boolean).join(" ");
    return `
      <div class="event-fight-cluster team-count-${count}">
        ${teamGroups.map((group, idx) => `
          <div class="event-fight-cluster-team team-index-${idx + 1}">
            ${renderTeamBlockHTML(group)}
          </div>
        `).join("")}
        <div class="${vsClass}">VS</div>
      </div>
    `;
}
function inferTagTeamCount(matchType, participantCount) {
    const t = String(matchType || "").toLowerCase();
    if (!t.includes("tag")) return 0;
    if (t.includes("triple threat")) return 3;
    if (t.includes("fatal 4") || t.includes("fatal four") || t.includes("4-way") || t.includes("four way")) return 4;
    const teamMatch = t.match(/(\d+)\s*team/);
    if (teamMatch) return Math.max(2, Number(teamMatch[1]) || 0);
    const wayMatch = t.match(/(\d+)\s*way/);
    if (wayMatch) return Math.max(2, Number(wayMatch[1]) || 0);
    if (participantCount === 4) return 2;
    return 0;
}
function inferMatchTeams(matchType, participantIds, participantTeams = {}) {
    const ids = Array.isArray(participantIds) ? participantIds.filter(Boolean) : [];
    if (ids.length < 3) return [];

    const explicitMap = new Map();
    ids.forEach(id => {
        const teamKey = normalizeTeamKey(participantTeams[id]);
        if (!teamKey) return;
        if (!explicitMap.has(teamKey)) explicitMap.set(teamKey, []);
        explicitMap.get(teamKey).push(id);
    });
    if (explicitMap.size >= 2) {
        const groups = Array.from(explicitMap.entries())
            .sort(([a], [b]) => compareTeamKeys(a, b))
            .map(([key, participants]) => ({ key, participants: [...participants] }));
        const assigned = new Set(groups.flatMap(group => group.participants));
        ids.filter(id => !assigned.has(id)).forEach(id => {
            groups.sort((a, b) => {
                const sizeDiff = a.participants.length - b.participants.length;
                if (sizeDiff !== 0) return sizeDiff;
                return compareTeamKeys(a.key, b.key);
            });
            groups[0]?.participants.push(id);
        });
        return groups.filter(group => group.participants.length);
    }

    const t = String(matchType || "").toLowerCase();
    if (t.includes("handicap")) {
        return [
            { key: "T1", participants: ids.slice(0, 1) },
            { key: "T2", participants: ids.slice(1) },
        ].filter(group => group.participants.length);
    }
    if (t.includes("tag")) {
        const inferredTeamCount = inferTagTeamCount(matchType, ids.length);
        if (inferredTeamCount >= 2 && ids.length % inferredTeamCount === 0) {
            const teamSize = ids.length / inferredTeamCount;
            return Array.from({ length: inferredTeamCount }, (_, idx) => ({
                key: `T${idx + 1}`,
                participants: ids.slice(idx * teamSize, (idx + 1) * teamSize),
            })).filter(group => group.participants.length);
        }
        const split = Math.ceil(ids.length / 2);
        return [
            { key: "T1", participants: ids.slice(0, split) },
            { key: "T2", participants: ids.slice(split) },
        ].filter(group => group.participants.length);
    }
    return [];
}
function normalizeNameForCompare(value) {
    return String(value ?? "")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}
function ordinal(n) {
    const mod100 = n % 100;
    if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
    const mod10 = n % 10;
    if (mod10 === 1) return `${n}st`;
    if (mod10 === 2) return `${n}nd`;
    if (mod10 === 3) return `${n}rd`;
    return `${n}th`;
}
function toISODateDaysAgo(daysAgo) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - daysAgo);
    return toISODateLocal(d);
}
// === Weekly rankings: momentum model ===
// Replaces the old Elo system. Each match contributes points that DECAY with age
// (half-life in weeks), scaled by match importance (title / main event / PLE).
// Every point contribution is recorded with a human-readable label so the
// superstar info modal (opened from the rankings table) can explain the ranking.
const WEEKLY_RANKING_POINTS = {
    baseScore: 100,           // everyone starts here so numbers stay readable
    championBonus: 20,        // flat bonus for currently holding a title
    activeChampionBonus: 12,  // extra if they've defended within the recency window
    winPoints: 12,
    lossPoints: -5,
    drawPoints: 0,            // draws don't exist in this universe, but guard anyway
    dqWinPoints: 4,           // winning by DQ — less than a clean win
    dqLossPoints: -2,
    promoPoints: 3,
    appearancePoints: 1,
    pinBonus: 3,              // scoring the pin/submission yourself
    mainEventBonus: 5,        // being in the main event
    titleMatchBonus: 8,       // competing in a championship match
    beatTop5Bonus: 10,        // defeated a current top-5 ranked wrestler
    beatTop10Bonus: 5,        // defeated a current top-10 ranked wrestler
    streakBonusPerWin: 2,     // momentum from a win streak
    maxStreakBonus: 12,
    // Recency: a match's contribution is multiplied by 0.5^(weeksAgo / halfLifeWeeks)
    halfLifeWeeks: 5,
    // Importance multipliers (applied on top of base points)
    ppvMultiplier: 1.4,
    titleMultiplier: 1.0,     // title handled via flat bonus instead now
    teamMatchMultiplier: 0.8, // team match points are slightly diluted per person
};
function resolveMatchParticipantIds(match, superstarNameToId) {
    const ids = [];
    const participants = Array.isArray(match?.participants) ? match.participants : [];
    for (const ref of participants) {
        const raw = String(ref ?? "").trim();
        if (!raw) continue;
        const byId = getSuperstar(raw);
        if (byId) {
            ids.push(byId.id);
            continue;
        }
        const byNameId = superstarNameToId.get(normalizeNameForCompare(raw));
        if (byNameId) ids.push(byNameId);
    }
    return Array.from(new Set(ids));
}
function resolveMatchWinnerId(match, participantIds, superstarNameById) {
    const rawResult = String(match?.result ?? "").trim();
    if (!rawResult || participantIds.length === 0) return null;
    if (isTeamResultValue(rawResult)) return parseTeamResultValue(rawResult);
    if (participantIds.includes(rawResult)) return rawResult;
    const result = normalizeNameForCompare(rawResult);
    for (const pid of participantIds) {
        const participantName = normalizeNameForCompare(superstarNameById.get(pid) || "");
        if (!participantName) continue;
        if (result.includes(participantName)) return pid;
    }
    return null;
}
function teamResultLabel(match, teamKey, participantRefs = []) {
    return teamDisplayName(match, teamKey, participantRefs);
}
function winningTeamFromMatch(match, teamGroups, winnerId) {
    const winnerTeamKey = parseTeamResultValue(winnerId) || normalizeTeamKey(winnerId);
    if (winnerTeamKey) {
        return teamGroups.find(group => group.key === winnerTeamKey) || null;
    }
    if (!winnerId) return null;
    return teamGroups.find(group => group.participants.includes(winnerId)) || null;
}
function losingParticipantsFromTeamGroups(teamGroups, winningTeam) {
    return teamGroups
        .filter(group => group !== winningTeam)
        .flatMap(group => group.participants);
}
function forEachTeamPairing(teamGroups, callback) {
    for (let i = 0; i < teamGroups.length; i++) {
        for (let j = i + 1; j < teamGroups.length; j++) {
            callback(teamGroups[i], teamGroups[j]);
        }
    }
}
function matchImportanceMultiplier(event, matchIndex, matchesLength, match) {
    const isPpv = event.type === "ppv";
    let multiplier = 1.0;
    if (isPpv) multiplier = WEEKLY_RANKING_POINTS.ppvMultiplier;
    return multiplier;
}
// True if a match is a championship match (real championship attached).
function matchIsTitleMatch(match) {
    return !!String(match?.championshipId || "").trim();
}
// True if a match is the main event (last match on the card).
function matchIsMainEvent(matchIndex, matchesLength) {
    return matchIndex === (matchesLength - 1);
}
// Recency decay factor for a match on `dateISO`, relative to the universe's
// current day. Half-life is configurable. Returns a value in (0, 1].
function rankingRecencyWeight(dateISO) {
    const current = parseISO(getUniverseCurrentISO());
    const matchDate = parseISO(dateISO);
    if (!current || !matchDate) return 1;
    const msPerWeek = 7 * 24 * 60 * 60 * 1000;
    const weeksAgo = Math.max(0, (current - matchDate) / msPerWeek);
    const halfLife = WEEKLY_RANKING_POINTS.halfLifeWeeks || 5;
    return Math.pow(0.5, weeksAgo / halfLife);
}
// === Momentum-based weekly rankings ===
// Walks completed match history. Each contribution is recency-decayed and
// importance-scaled. Every contribution is recorded per-superstar in a breakdown
// list so the info modal can explain the ranking.
//
// Returns: Map<showId, Array<{ superstar, score, breakdown, wins, losses, streak }>>
// breakdown entries: { label, points, date }
let _weeklyRankingsCache = null;
let _weeklyRankingsCacheKey = "";
function weeklyRankingsCacheKey() {
    return `${dataVersion}:${state.events.length}:${state.superstars.length}:${getUniverseCurrentISO()}`;
}

function computeWeeklyRankingsFull() {
    const key = weeklyRankingsCacheKey();
    if (_weeklyRankingsCache && _weeklyRankingsCacheKey === key) return _weeklyRankingsCache;

    const rules = WEEKLY_RANKING_POINTS;
    const superstarNameToId = new Map(state.superstars.map(ss => [normalizeNameForCompare(ss.name), ss.id]));
    const superstarNameById = new Map(state.superstars.map(ss => [ss.id, ss.name]));

    // Per-superstar accumulators
    const scores = new Map();      // id -> running score
    const breakdowns = new Map();  // id -> [{label, points, date}]
    const wins = new Map();
    const losses = new Map();
    const streaks = new Map();      // current win streak (chronological)
    const lastTitleDefenseISO = new Map(); // id -> most recent date they were in a title match

    state.superstars.forEach(ss => {
        scores.set(ss.id, rules.baseScore);
        breakdowns.set(ss.id, []);
        wins.set(ss.id, 0);
        losses.set(ss.id, 0);
        streaks.set(ss.id, 0);
    });

    const addPoints = (id, rawPoints, label, dateISO, recencyWeight) => {
        if (!scores.has(id)) return;
        const final = Math.round(rawPoints * recencyWeight * 10) / 10;
        if (final === 0 && rawPoints === 0) return;
        scores.set(id, (scores.get(id) || 0) + final);
        breakdowns.get(id).push({ label, points: final, date: dateISO });
    };

    // Chronologically ordered completed events
    const universeCurrentISO = getUniverseCurrentISO();
    const processedEvents = state.events
        .filter(e => /^\d{4}-\d{2}-\d{2}$/.test(String(e?.date || "")))
        .filter(e => e.date < universeCurrentISO || isUniverseDateCompleted(e.date))
        .slice()
        .sort((a, b) => a.date.localeCompare(b.date));

    // First pass: we need a provisional ranking to award "beat a top-N" bonuses.
    // We compute scores in one chronological pass; for the top-N opponent check we
    // use the running score AT THE TIME of the match (good enough and avoids a
    // second full pass).
    const runningRankAtShow = (showId) => {
        const rows = state.superstars
            .filter(ss => superstarOnShow(ss, showId))
            .map(ss => ({ id: ss.id, score: scores.get(ss.id) || 0 }))
            .sort((a, b) => b.score - a.score);
        const pos = new Map();
        rows.forEach((r, i) => pos.set(r.id, i + 1));
        return { pos, size: rows.length };
    };

    const showIdsBySuperstar = new Map(state.superstars.map(ss => {
        const ids = Array.isArray(ss?.showIds) && ss.showIds.length
            ? ss.showIds.map(id => String(id ?? "").trim()).filter(Boolean)
            : (ss?.showId ? [String(ss.showId).trim()] : []);
        return [ss.id, Array.from(new Set(ids))];
    }));

    const opponentTierBonus = (defeatedIds) => {
        // Returns the best bonus available from beating any of the defeated wrestlers.
        let best = 0;
        let bestLabel = "";
        defeatedIds.forEach(did => {
            const showIds = showIdsBySuperstar.get(did) || [];
            showIds.forEach(showId => {
                const { pos, size } = runningRankAtShow(showId);
                const rank = pos.get(did);
                if (!rank) return;
                if (size >= 5 && rank <= 5 && rules.beatTop5Bonus > best) {
                    best = rules.beatTop5Bonus;
                    bestLabel = `Defeated a top-5 ranked opponent`;
                } else if (size >= 10 && rank <= 10 && rules.beatTop10Bonus > best) {
                    best = rules.beatTop10Bonus;
                    bestLabel = `Defeated a top-10 ranked opponent`;
                }
            });
        });
        return { bonus: best, label: bestLabel };
    };

    for (const ev of processedEvents) {
        const matches = Array.isArray(ev.matches) ? ev.matches : [];
        const recency = rankingRecencyWeight(ev.date);
        matches.forEach((match, idx) => {
            const participantIds = resolveMatchParticipantIds(match, superstarNameToId);
            const resultValue = String(match?.result ?? "").trim();
            const normalizedResult = normalizeNameForCompare(resultValue);
            const isTitle = matchIsTitleMatch(match);
            const isMainEvent = matchIsMainEvent(idx, matches.length);
            const importance = matchImportanceMultiplier(ev, idx, matches.length, match);
            const pinById = resolveSuperstarIdFromRef(String(match?.pinBy ?? "").trim());
            const eventLabel = ev.type === "ppv" ? "PLE" : "show";

            // Promo: small points, no W/L impact
            if (isPromoResult(resultValue)) {
                participantIds.forEach(id => addPoints(id, rules.promoPoints * importance, `Promo segment on a ${eventLabel}`, ev.date, recency));
                return;
            }
            if (participantIds.length < 2) return;

            // A match with no result ("(no winner yet)") hasn't happened yet.
            // It contributes NOTHING to rankings — no appearance points, no bonuses.
            if (!resultValue || normalizedResult === "no result") {
                return;
            }

            // Everyone in a title match gets a flat title-match bonus + records a defense date
            if (isTitle) {
                participantIds.forEach(id => {
                    addPoints(id, rules.titleMatchBonus * importance, `Competed in a championship match`, ev.date, recency);
                    lastTitleDefenseISO.set(id, ev.date);
                });
            }
            // Main event bonus
            if (isMainEvent) {
                participantIds.forEach(id => addPoints(id, rules.mainEventBonus * importance, `Main-evented a ${eventLabel}`, ev.date, recency));
            }
            // Appearance points
            participantIds.forEach(id => addPoints(id, rules.appearancePoints * importance, `Appeared on a ${eventLabel}`, ev.date, recency));

            // Draw-like / no contest — no W/L, reset streaks
            if (isDrawRecordResult(resultValue) || normalizedResult === "no contest" || normalizedResult === "nc") {
                participantIds.forEach(id => streaks.set(id, 0));
                return;
            }

            // Determine winners / losers (handles team + singles)
            const participantTeams = normalizedParticipantTeams(match);
            const teams = inferMatchTeams(match?.matchType, participantIds, participantTeams);
            const hasTeams = teams.length >= 2 && teams.every(g => g.participants.length);
            const teamMult = hasTeams ? rules.teamMatchMultiplier : 1;

            let winners = [];
            let losers = [];
            if (hasTeams) {
                const winnerId = resolveMatchWinnerId(match, participantIds, superstarNameById);
                const winningTeam = winningTeamFromMatch(match, teams, winnerId);
                if (winningTeam) {
                    winners = winningTeam.participants.slice();
                    losers = losingParticipantsFromTeamGroups(teams, winningTeam);
                }
            } else {
                const winnerId = resolveMatchWinnerId(match, participantIds, superstarNameById);
                if (winnerId && participantIds.includes(winnerId)) {
                    winners = [winnerId];
                    losers = participantIds.filter(id => id !== winnerId);
                }
            }

            // DQ: reduced win/loss, streaks reset
            const isDQ = isDQResult(resultValue);

            if (!winners.length || !losers.length) {
                participantIds.forEach(id => streaks.set(id, 0));
                return;
            }

            // Opponent tier bonus is computed BEFORE we mutate scores this match
            const tier = opponentTierBonus(losers);

            winners.forEach(id => {
                if (isDQ) {
                    addPoints(id, rules.dqWinPoints * importance * teamMult, `Won by DQ`, ev.date, recency);
                    streaks.set(id, 0);
                } else {
                    addPoints(id, rules.winPoints * importance * teamMult, `Won a match`, ev.date, recency);
                    wins.set(id, (wins.get(id) || 0) + 1);
                    const newStreak = (streaks.get(id) || 0) + 1;
                    streaks.set(id, newStreak);
                    if (newStreak >= 2) {
                        const streakBonus = Math.min(rules.maxStreakBonus, newStreak * rules.streakBonusPerWin);
                        addPoints(id, streakBonus, `On a ${newStreak}-match win streak`, ev.date, recency);
                    }
                    if (tier.bonus > 0) {
                        addPoints(id, tier.bonus * importance, tier.label, ev.date, recency);
                    }
                    if (pinById && pinById === id) {
                        addPoints(id, rules.pinBonus * importance, `Scored the pin/submission`, ev.date, recency);
                    }
                }
            });
            losers.forEach(id => {
                if (isDQ) {
                    addPoints(id, rules.dqLossPoints * importance * teamMult, `Lost by DQ`, ev.date, recency);
                } else {
                    addPoints(id, rules.lossPoints * importance * teamMult, `Lost a match`, ev.date, recency);
                    losses.set(id, (losses.get(id) || 0) + 1);
                }
                streaks.set(id, 0);
            });
        });
    }

    // Champion bonuses (flat — applied last so they're visible in the breakdown)
    const recencyWindowStartISO = (() => {
        const cur = parseISO(universeCurrentISO);
        if (!cur) return null;
        cur.setDate(cur.getDate() - (rules.halfLifeWeeks * 7));
        return toISODateLocal(cur);
    })();
    state.superstars.forEach(ss => {
        if (!ss.isChampion) return;
        scores.set(ss.id, (scores.get(ss.id) || 0) + rules.championBonus);
        breakdowns.get(ss.id).push({ label: "Currently holds a championship", points: rules.championBonus, date: null });
        const lastDefense = lastTitleDefenseISO.get(ss.id);
        if (lastDefense && recencyWindowStartISO && lastDefense >= recencyWindowStartISO) {
            scores.set(ss.id, (scores.get(ss.id) || 0) + rules.activeChampionBonus);
            breakdowns.get(ss.id).push({ label: "Active champion — defended recently", points: rules.activeChampionBonus, date: null });
        }
    });

    // Group + sort per show
    const byShow = new Map();
    for (const show of state.shows) {
        const rows = state.superstars
            .filter(ss => superstarOnShow(ss, show.id))
            .map(ss => ({
                superstar: ss,
                score: Math.round((scores.get(ss.id) || 0) * 10) / 10,
                breakdown: breakdowns.get(ss.id) || [],
                wins: wins.get(ss.id) || 0,
                losses: losses.get(ss.id) || 0,
                streak: streaks.get(ss.id) || 0,
            }))
            .sort((a, b) => {
                if (b.score !== a.score) return b.score - a.score;
                if (b.wins !== a.wins) return b.wins - a.wins;
                return a.superstar.name.localeCompare(b.superstar.name);
            });
        byShow.set(show.id, rows);
    }

    _weeklyRankingsCache = byShow;
    _weeklyRankingsCacheKey = key;
    return byShow;
}

// Back-compat wrapper: returns top-N rows per show (used by the dashboard card).
function computeWeeklyRankings(topN = 3) {
    const full = computeWeeklyRankingsFull();
    const limited = new Map();
    const n = Math.max(1, Number(topN) || 3);
    for (const [showId, rows] of full.entries()) {
        limited.set(showId, rows.slice(0, n));
    }
    return limited;
}

// Look up a single superstar's ranking row (with breakdown) for the info modal.
// Returns { rank, size, row } or null.
function rankingInfoForSuperstar(superstarId) {
    const full = computeWeeklyRankingsFull();
    for (const [showId, rows] of full.entries()) {
        const idx = rows.findIndex(r => r.superstar.id === superstarId);
        if (idx >= 0) {
            return { showId, rank: idx + 1, size: rows.length, row: rows[idx] };
        }
    }
    return null;
}

// -------------------- TITLE REIGN HISTORY (derived) --------------------
// Walk every match across already-completed events in chronological order.
// Whenever a championship match has a winner different from the current
// holder of that title, log a title change.
// === Title reign storage (set in stone) ===
// state.titleReigns is the source of truth for who held what and when. Reigns are
// created when a championship match completes with a winner that differs from the
// current holder(s), or manually via the championship editor. They are NEVER
// silently recomputed from match history — once stored, they stay until manually
// edited or deleted.

let _titleReignsCache = null;
let _titleReignsCacheKey = "";
function titleReignsCacheKey() {
    return `${dataVersion}:${(state.titleReigns || []).length}:${state.championships.length}`;
}
function computeTitleReigns() {
    const key = titleReignsCacheKey();
    if (_titleReignsCache && _titleReignsCacheKey === key) return _titleReignsCache;
    const reignsByChampionship = new Map();
    state.championships.forEach(c => reignsByChampionship.set(c.id, []));
    const reigns = Array.isArray(state.titleReigns) ? state.titleReigns : [];
    // Sort by startDate ascending so reign 1 = first chronologically, last = most recent.
    const sorted = reigns.slice().sort((a, b) => {
        const cmp = String(a.startDate).localeCompare(String(b.startDate));
        if (cmp !== 0) return cmp;
        // Same date: initial reigns first, then by id stability
        if (a.isInitial && !b.isInitial) return -1;
        if (!a.isInitial && b.isInitial) return 1;
        return String(a.id).localeCompare(String(b.id));
    });
    for (const r of sorted) {
        const bucket = reignsByChampionship.get(r.championshipId);
        if (bucket) bucket.push(r);
    }
    _titleReignsCache = reignsByChampionship;
    _titleReignsCacheKey = key;
    return reignsByChampionship;
}

// === Seeding migration ===
// Runs once when the app loads with an empty state.titleReigns but pre-existing
// universe history. Walks every completed match and produces reign records that
// match the old derivation logic. After this, state.titleReigns is the truth.
function seedTitleReignsFromHistory() {
    const out = [];
    const universeCurrentISO = getUniverseCurrentISO();
    const processedEvents = state.events
        .filter(e => isISODate(e?.date))
        .filter(e => e.date < universeCurrentISO || isUniverseDateCompleted(e.date))
        .slice()
        .sort((a, b) => a.date.localeCompare(b.date));

    const startingHolders = new Map();
    state.championships.forEach(c => {
        const holders = state.superstars.filter(ss => parseChampionships(ss.championships).includes(c.id));
        if (holders.length) startingHolders.set(c.id, holders.map(h => h.id));
    });

    const superstarNameToId = new Map(state.superstars.map(ss => [normalizeNameForCompare(ss.name), ss.id]));
    const superstarNameById = new Map(state.superstars.map(ss => [ss.id, ss.name]));

    const currentHolders = new Map();
    const openReignByChamp = new Map(); // championshipId -> last open reign object
    const startISO = getUniverseStartISO();
    state.championships.forEach(c => {
        const initial = startingHolders.get(c.id) || [];
        if (initial.length) {
            currentHolders.set(c.id, initial.slice());
            const reign = {
                id: uid("rgn"),
                championshipId: c.id,
                holderIds: initial.slice(),
                holderNames: initial.map(id => superstarNameById.get(id)).filter(Boolean),
                startDate: startISO,
                endDate: null,
                eventId: null,
                isInitial: true,
            };
            out.push(reign);
            openReignByChamp.set(c.id, reign);
        }
    });

    for (const ev of processedEvents) {
        const matches = Array.isArray(ev.matches) ? ev.matches : [];
        for (const match of matches) {
            const championshipId = String(match?.championshipId || "").trim();
            if (!championshipId) continue;
            const championship = state.championships.find(c => c.id === championshipId);
            if (!championship) continue;
            const resultValue = String(match?.result || "").trim();
            if (!resultValue) continue;
            if (isPromoResult(resultValue)) continue;
            if (isDQResult(resultValue)) continue;
            if (isDrawRecordResult(resultValue)) continue;
            if (normalizeNameForCompare(resultValue) === "no result") continue;

            const participantIds = resolveMatchParticipantIds(match, superstarNameToId);
            if (!participantIds.length) continue;

            let newHolderIds = [];
            if (isTeamResultValue(resultValue)) {
                const teams = inferMatchTeams(match?.matchType, participantIds, normalizedParticipantTeams(match));
                const winningTeamKey = parseTeamResultValue(resultValue);
                const winningTeam = teams.find(g => g.key === winningTeamKey);
                if (winningTeam) newHolderIds = winningTeam.participants.slice();
            } else {
                const winId = resolveMatchWinnerId(match, participantIds, superstarNameById);
                if (winId) newHolderIds = [winId];
            }
            if (!newHolderIds.length) continue;

            const prevHolders = currentHolders.get(championshipId) || [];
            const prevSet = new Set(prevHolders);
            const newSet = new Set(newHolderIds);
            const sameHolders = prevSet.size === newSet.size && [...prevSet].every(x => newSet.has(x));
            if (sameHolders) continue;

            // Close out previous open reign
            const prev = openReignByChamp.get(championshipId);
            if (prev && !prev.endDate) {
                prev.endDate = ev.date;
            }
            // Open new reign
            const reign = {
                id: uid("rgn"),
                championshipId,
                holderIds: newHolderIds.slice(),
                holderNames: newHolderIds.map(id => superstarNameById.get(id)).filter(Boolean),
                startDate: ev.date,
                endDate: null,
                eventId: ev.id,
                isInitial: false,
            };
            out.push(reign);
            openReignByChamp.set(championshipId, reign);
            currentHolders.set(championshipId, newHolderIds.slice());
        }
    }
    return out;
}

// === Live reign maintenance ===
// Call this whenever a championship match's result changes. It compares the match's
// outcome to the latest known reign for that championship and either:
//   - Opens a new reign + closes the previous one (title change), or
//   - Does nothing (successful defence / no result / etc.)
// IMPORTANT: This is called from completion paths. It does NOT retroactively walk
// history — that's seedTitleReignsFromHistory's job (one-time only).
function maybeRecordReignChangeFromMatch(match, event) {
    if (!match || !event) return false;
    const championshipId = String(match?.championshipId || "").trim();
    if (!championshipId) return false;
    const championship = state.championships.find(c => c.id === championshipId);
    if (!championship) return false;
    const resultValue = String(match?.result || "").trim();
    if (!resultValue) return false;
    if (isPromoResult(resultValue)) return false;
    if (isDQResult(resultValue)) return false;
    if (isDrawRecordResult(resultValue)) return false;
    if (normalizeNameForCompare(resultValue) === "no result") return false;

    const superstarNameToId = new Map(state.superstars.map(ss => [normalizeNameForCompare(ss.name), ss.id]));
    const superstarNameById = new Map(state.superstars.map(ss => [ss.id, ss.name]));
    const participantIds = resolveMatchParticipantIds(match, superstarNameToId);
    if (!participantIds.length) return false;

    let newHolderIds = [];
    if (isTeamResultValue(resultValue)) {
        const teams = inferMatchTeams(match?.matchType, participantIds, normalizedParticipantTeams(match));
        const winningTeamKey = parseTeamResultValue(resultValue);
        const winningTeam = teams.find(g => g.key === winningTeamKey);
        if (winningTeam) newHolderIds = winningTeam.participants.slice();
    } else {
        const winId = resolveMatchWinnerId(match, participantIds, superstarNameById);
        if (winId) newHolderIds = [winId];
    }
    if (!newHolderIds.length) return false;

    // Latest reign for this championship
    const allReigns = (state.titleReigns || []).filter(r => r.championshipId === championshipId);
    const latestOpen = allReigns.filter(r => !r.endDate).sort((a, b) => String(b.startDate).localeCompare(String(a.startDate)))[0];
    const prevHolders = latestOpen ? latestOpen.holderIds : [];
    const prevSet = new Set(prevHolders);
    const newSet = new Set(newHolderIds);
    const sameHolders = prevSet.size === newSet.size && [...prevSet].every(x => newSet.has(x));
    if (sameHolders) return false;

    // Close out previous open reign on this date
    if (latestOpen) {
        latestOpen.endDate = event.date;
    }
    // Add new reign
    state.titleReigns.push({
        id: uid("rgn"),
        championshipId,
        holderIds: newHolderIds.slice(),
        holderNames: newHolderIds.map(id => superstarNameById.get(id) || "(unknown)"),
        startDate: event.date,
        endDate: null,
        eventId: event.id,
        isInitial: false,
    });
    // Update superstars' championships field to reflect new holder
    state.superstars.forEach(ss => {
        const has = parseChampionships(ss.championships).includes(championshipId);
        const shouldHave = newHolderIds.includes(ss.id);
        if (has && !shouldHave) {
            ss.championships = parseChampionships(ss.championships).filter(cid => cid !== championshipId);
            ss.isChampion = (ss.championships || []).length > 0;
        } else if (!has && shouldHave) {
            ss.championships = [...new Set([...parseChampionships(ss.championships), championshipId])];
            ss.isChampion = true;
        }
    });
    return true;
}
function reignsForChampionship(championshipId) {
    return computeTitleReigns().get(championshipId) || [];
}
function reignsForSuperstar(superstarId) {
    const map = computeTitleReigns();
    const out = [];
    for (const [, reigns] of map) {
        for (const reign of reigns) {
            if (reign.holderIds.includes(superstarId)) out.push(reign);
        }
    }
    return out.sort((a, b) => String(a.startDate || "").localeCompare(String(b.startDate || "")));
}
function reignDayLength(reign) {
    const start = reign.startDate;
    const end = reign.endDate || getUniverseCurrentISO();
    if (!isISODate(start) || !isISODate(end)) return 0;
    const ms = parseISO(end) - parseISO(start);
    return Math.max(0, Math.round(ms / (1000 * 60 * 60 * 24)));
}
function longestActiveReigns(limit = 5) {
    const map = computeTitleReigns();
    const out = [];
    for (const [championshipId, reigns] of map) {
        if (!reigns.length) continue;
        const last = reigns[reigns.length - 1];
        if (last.endDate) continue;
        out.push({ championshipId, reign: last, days: reignDayLength(last) });
    }
    return out.sort((a, b) => b.days - a.days).slice(0, limit);
}

// -------------------- RIVALRY MATCH TIMELINE (derived) --------------------
// For each rivalry, find all completed-event matches whose participant set
// is a subset of the rivalry's participants (i.e. the match is "between" the rivalry's people).
function matchesForRivalry(rivalry) {
    const participantIds = new Set((rivalry?.participantIds || []).filter(Boolean));
    if (participantIds.size < 2) return [];
    const universeCurrentISO = getUniverseCurrentISO();
    const eventsAsc = state.events
        .filter(e => isISODate(e?.date))
        .filter(e => e.date < universeCurrentISO || isUniverseDateCompleted(e.date))
        .slice()
        .sort((a, b) => a.date.localeCompare(b.date));
    const out = [];
    const superstarNameToId = new Map(state.superstars.map(ss => [normalizeNameForCompare(ss.name), ss.id]));
    const superstarNameById = new Map(state.superstars.map(ss => [ss.id, ss.name]));
    for (const ev of eventsAsc) {
        const matches = Array.isArray(ev.matches) ? ev.matches : [];
        for (const match of matches) {
            const matchPids = new Set(resolveMatchParticipantIds(match, superstarNameToId));
            if (matchPids.size < 2) continue;
            // Match counts if at least 2 of the rivalry's participants are in it,
            // AND every match participant is in the rivalry (no random extras).
            let overlap = 0;
            let allIn = true;
            for (const pid of matchPids) {
                if (participantIds.has(pid)) overlap += 1;
                else allIn = false;
            }
            if (overlap < 2 || !allIn) continue;
            const result = String(match?.result || "").trim();
            let winnerLabel = "";
            if (result && !isPromoResult(result)) {
                if (isDrawRecordResult(result)) winnerLabel = "Draw";
                else if (isDQResult(result)) winnerLabel = "DQ";
                else if (isTeamResultValue(result)) {
                    const teams = inferMatchTeams(match?.matchType, [...matchPids], normalizedParticipantTeams(match));
                    const winning = teams.find(g => g.key === parseTeamResultValue(result));
                    winnerLabel = winning ? teamDisplayName(match, winning.key, winning.participants) : "";
                } else {
                    const winId = resolveMatchWinnerId(match, [...matchPids], superstarNameById);
                    winnerLabel = winId ? superstarNameById.get(winId) || "" : "";
                }
            }
            out.push({
                eventId: ev.id,
                eventName: ev.name,
                eventType: ev.type,
                date: ev.date,
                matchType: match.matchType || "",
                participants: [...matchPids].map(pid => superstarNameById.get(pid) || ""),
                winnerLabel,
                isPromo: isPromoResult(result),
            });
        }
    }
    return out;
}

// -------------------- BOOKING ASSISTANT (derived) --------------------
// Surface actionable suggestions on the dashboard.
function computeBookingSuggestions() {
    const suggestions = [];
    const universeCurrentISO = getUniverseCurrentISO();
    const records = computeSuperstarRecords();
    const rankings = computeWeeklyRankings(10);
    const reignsByChampionship = computeTitleReigns();

    // Last-appeared map: superstarId -> ISO date
    const lastAppeared = new Map();
    state.events
        .filter(e => isISODate(e?.date))
        .filter(e => e.date < universeCurrentISO || isUniverseDateCompleted(e.date))
        .slice()
        .sort((a, b) => a.date.localeCompare(b.date))
        .forEach(ev => {
            (Array.isArray(ev.matches) ? ev.matches : []).forEach(m => {
                (Array.isArray(m.participants) ? m.participants : []).forEach(ref => {
                    const pid = resolveSuperstarIdFromRef(ref);
                    if (pid) lastAppeared.set(pid, ev.date);
                });
            });
        });

    const daysBetween = (isoA, isoB) => {
        if (!isISODate(isoA) || !isISODate(isoB)) return 0;
        return Math.round((parseISO(isoB) - parseISO(isoA)) / 86400000);
    };

    // Suggestion 1: Hot contenders who haven't faced the champion
    for (const [showId, rows] of rankings) {
        if (!rows.length) continue;
        const showName_ = showName(showId);
        // Find each title scoped to this show with an active singles holder
        state.championships.forEach(championship => {
            if (!championshipAvailableForShowIds(championship, [showId])) return;
            const reigns = reignsByChampionship.get(championship.id) || [];
            const lastReign = reigns[reigns.length - 1];
            if (!lastReign || lastReign.endDate) return; // vacant
            if (lastReign.holderIds.length !== 1) return; // skip tag for this rule
            const champId = lastReign.holderIds[0];
            const champName = superstarNameById(champId);
            if (!champName) return;
            // Look at top-5 contenders on this show in same gender as title
            const titleGender = normalizeChampionshipGender(championship.gender);
            const contenders = rows.slice(0, 5)
                .map(r => r.superstar)
                .filter(ss => ss.id !== champId)
                .filter(ss => {
                    if (titleGender === "Intergender") return true;
                    return superstarGender(ss) === titleGender;
                });
            for (const contender of contenders) {
                // Has contender ever faced champ? Search completed events
                const facedBefore = (function () {
                    for (const ev of state.events) {
                        if (!isISODate(ev?.date)) continue;
                        if (ev.date >= universeCurrentISO && !isUniverseDateCompleted(ev.date)) continue;
                        for (const m of (ev.matches || [])) {
                            const pids = (m.participants || []).map(resolveSuperstarIdFromRef).filter(Boolean);
                            if (pids.includes(champId) && pids.includes(contender.id)) return true;
                        }
                    }
                    return false;
                })();
                if (facedBefore) continue;
                suggestions.push({
                    kind: "fresh_matchup",
                    priority: 5,
                    title: `${contender.name} vs ${champName}`,
                    detail: `${contender.name} is a top-5 contender on ${showName_} and has never faced the ${championship.name} holder.`,
                    superstarIds: [contender.id, champId],
                    championshipId: championship.id,
                });
                break; // one per title
            }
        });
    }

    // Suggestion 2: Stale active rivalries (no booked match in 30+ days while Active/Heating Up/Blowoff Ready)
    (state.rivalries || []).forEach(rivalry => {
        const status = normalizeRivalryStatus(rivalry.status);
        if (status === "Ended" || status === "Paused") return;
        const matches = matchesForRivalry(rivalry);
        const lastMatchDate = matches.length ? matches[matches.length - 1].date : (rivalry.startDate || "");
        if (!isISODate(lastMatchDate)) return;
        const daysSince = daysBetween(lastMatchDate, universeCurrentISO);
        if (daysSince < 30) return;
        suggestions.push({
            kind: "stalled_rivalry",
            priority: status === "Blowoff Ready" ? 8 : 6,
            title: `${rivalryDisplayTitle(rivalry)} needs a match`,
            detail: `${status} for ${daysSince} days with no booked match. ${status === "Blowoff Ready" ? "Time for the blowoff." : ""}`.trim(),
            rivalryId: rivalry.id,
        });
    });

    // Suggestion 3: Missing-from-TV — superstars who haven't appeared in 21+ days
    state.superstars.forEach(ss => {
        const last = lastAppeared.get(ss.id);
        if (!last) return; // never appeared = exclude (probably new)
        const days = daysBetween(last, universeCurrentISO);
        if (days < 21) return;
        // Only flag for top-tier or champion superstars (avoids spam)
        const isChamp = !!ss.isChampion;
        let isTopTen = false;
        for (const [, rows] of rankings) {
            if (rows.some(r => r.superstar.id === ss.id)) { isTopTen = true; break; }
        }
        if (!isChamp && !isTopTen) return;
        suggestions.push({
            kind: "missing_from_tv",
            priority: isChamp ? 7 : 4,
            title: `${ss.name} hasn't appeared in ${days} days`,
            detail: `${isChamp ? "Champion " : ""}${ss.name} is missing from TV.`,
            superstarIds: [ss.id],
        });
    });

    // Suggestion 4: Title not defended in 60+ days (active reign)
    state.championships.forEach(championship => {
        const reigns = reignsByChampionship.get(championship.id) || [];
        const lastReign = reigns[reigns.length - 1];
        if (!lastReign || lastReign.endDate) return;
        // Find the most recent match that featured this championship
        let lastDefenceDate = lastReign.startDate;
        for (const ev of state.events) {
            if (!isISODate(ev?.date)) continue;
            if (ev.date >= universeCurrentISO && !isUniverseDateCompleted(ev.date)) continue;
            for (const m of (ev.matches || [])) {
                if (String(m.championshipId || "") === championship.id) {
                    if (!isISODate(lastDefenceDate) || ev.date > lastDefenceDate) lastDefenceDate = ev.date;
                }
            }
        }
        const days = daysBetween(lastDefenceDate, universeCurrentISO);
        if (days < 60) return;
        suggestions.push({
            kind: "stale_title",
            priority: 6,
            title: `${championship.name} not defended in ${days} days`,
            detail: `Book a defence to keep the title hot.`,
            championshipId: championship.id,
        });
    });

    // Suggestion 5: Hot streak that deserves a title shot — 5+ wins in a row, not currently a champ
    const streakByPerson = new Map();
    state.superstars.forEach(ss => streakByPerson.set(ss.id, 0));
    state.events
        .filter(e => isISODate(e?.date))
        .filter(e => e.date < universeCurrentISO || isUniverseDateCompleted(e.date))
        .slice()
        .sort((a, b) => a.date.localeCompare(b.date))
        .forEach(ev => {
            (ev.matches || []).forEach(m => {
                const result = String(m.result || "").trim();
                const pids = (m.participants || []).map(resolveSuperstarIdFromRef).filter(Boolean);
                if (pids.length < 2 || !result || isPromoResult(result)) return;
                if (isDQResult(result) || isDrawRecordResult(result)) {
                    pids.forEach(id => streakByPerson.set(id, 0));
                    return;
                }
                let winners = [], losers = [];
                if (isTeamResultValue(result)) {
                    const teams = inferMatchTeams(m.matchType, pids, normalizedParticipantTeams(m));
                    const winningKey = parseTeamResultValue(result);
                    const winning = teams.find(g => g.key === winningKey);
                    winners = winning?.participants || [];
                    losers = pids.filter(p => !winners.includes(p));
                } else {
                    const winId = resolveSuperstarIdFromRef(result);
                    if (!winId || !pids.includes(winId)) return;
                    winners = [winId];
                    losers = pids.filter(p => p !== winId);
                }
                winners.forEach(id => streakByPerson.set(id, (streakByPerson.get(id) || 0) + 1));
                losers.forEach(id => streakByPerson.set(id, 0));
            });
        });
    state.superstars.forEach(ss => {
        const streak = streakByPerson.get(ss.id) || 0;
        if (streak < 5) return;
        if (ss.isChampion) return;
        suggestions.push({
            kind: "hot_streak",
            priority: 5,
            title: `${ss.name} on a ${streak}-match win streak`,
            detail: `Title shot territory. Book a #1 contender match or a championship match.`,
            superstarIds: [ss.id],
        });
    });

    // Sort by priority desc, then title alpha for stability
    return suggestions.sort((a, b) => (b.priority - a.priority) || a.title.localeCompare(b.title));
}

// -------------------- MOMENTUM SPARKLINE (derived) --------------------
// Returns an array of recent score deltas per booked match for a superstar (last N matches).
// One pass over completed history → per-superstar ordered outcome list.
// Momentum sparklines and win/loss streaks both read from this index, so the
// roster no longer re-walks every event once per superstar.
function superstarOutcomeIndex() {
    const universeCurrentISO = getUniverseCurrentISO();
    return memo("outcomeIndex", [state.events, dataVersion, universeCurrentISO], () => {
        const index = new Map();
        const push = (id, kind) => {
            if (!index.has(id)) index.set(id, []);
            index.get(id).push(kind);
        };
        state.events
            .filter(e => isISODate(e?.date))
            .filter(e => e.date < universeCurrentISO || isUniverseDateCompleted(e.date))
            .slice()
            .sort((a, b) => a.date.localeCompare(b.date))
            .forEach(ev => {
                (ev.matches || []).forEach(m => {
                    const pids = Array.from(new Set(matchParticipantRefs(m).map(resolveSuperstarIdFromRef).filter(Boolean)));
                    if (!pids.length) return;
                    const result = String(m.result || "").trim();
                    if (!result || normalizeNameForCompare(result) === "no result") return; // not happened yet
                    if (isPromoResult(result)) { pids.forEach(id => push(id, "promo")); return; }
                    if (isDQResult(result) || isDrawRecordResult(result)) { pids.forEach(id => push(id, "neutral")); return; }
                    let winners = [];
                    if (isTeamResultValue(result)) {
                        const teams = inferMatchTeams(m.matchType, pids, normalizedParticipantTeams(m));
                        winners = teams.find(g => g.key === parseTeamResultValue(result))?.participants || [];
                    } else {
                        const winId = resolveSuperstarIdFromRef(result);
                        if (winId && pids.includes(winId)) winners = [winId];
                    }
                    pids.forEach(id => {
                        if (!winners.length) push(id, "neutral");
                        else push(id, winners.includes(id) ? "win" : "loss");
                    });
                });
            });
        return index;
    });
}
function superstarMomentumPoints(superstarId, n = 12) {
    const outcomes = superstarOutcomeIndex().get(superstarId) || [];
    const points = [];
    let running = 0;
    outcomes.forEach(kind => {
        if (kind === "promo") running += 0.3;
        else if (kind === "win") running += 1;
        else if (kind === "loss") running -= 1;
        points.push(running);
    });
    return points.slice(-n);
}

function sparklineSVG(points, { width = 80, height = 24, stroke = "#9b9bff" } = {}) {
    if (!points || points.length < 2) {
        return `<svg class="sparkline" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true"><line x1="2" y1="${height / 2}" x2="${width - 2}" y2="${height / 2}" stroke="rgba(255,255,255,.18)" stroke-width="1"/></svg>`;
    }
    const min = Math.min(...points);
    const max = Math.max(...points);
    const range = (max - min) || 1;
    const step = (width - 4) / (points.length - 1);
    const coords = points.map((p, i) => {
        const x = 2 + i * step;
        const y = height - 2 - ((p - min) / range) * (height - 4);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
    const last = points[points.length - 1];
    const first = points[0];
    const trendingUp = last >= first;
    const color = trendingUp ? "#4dd6a8" : "#ff7676";
    return `<svg class="sparkline" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true">
        <polyline fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" points="${coords}" />
    </svg>`;
}

// -------------------- STREAK / DROUGHT BADGES --------------------
function superstarCurrentStreak(superstarId) {
    const outcomes = superstarOutcomeIndex().get(superstarId) || [];
    let kind = null;
    let count = 0;
    for (let i = outcomes.length - 1; i >= 0; i--) {
        const outcome = outcomes[i];
        if (outcome !== "win" && outcome !== "loss") {
            if (kind) break;
            continue;
        }
        if (!kind) { kind = outcome; count = 1; continue; }
        if (outcome === kind) count += 1;
        else break;
    }
    return { kind, count };
}

function rankingRowsHTML(rows, startRank = 1) {
    return rows.map((entry, idx) => {
        const ss = entry.superstar;
        const photo = superstarPhotoURL(ss);
        const rank = startRank + idx;
        return `
          <div class="rank-row" data-open-ss="${ss.id}" role="button" tabindex="0" aria-label="Open ${escapeAttr(ss.name)} details">
            <div class="rank-left">
              ${photo
                ? `<img class="rank-photo" src="${escapeAttr(photo)}" alt="${escapeAttr(ss.name)}" />`
                : `<div class="rank-photo-fallback">${escapeHTML(superstarInitials(ss.name))}</div>`
            }
              <div class="rank-name-wrap">
                <div class="rank-name">${escapeHTML(ss.name)}</div>
                ${ss.isChampion ? `<span class="rank-champ">C</span>` : ``}
              </div>
            </div>
            <div class="rank-pos">${ordinal(rank)}</div>
          </div>
        `;
    }).join("");
}
async function openShowTopTenModal(showId) {
    const show = getShow(showId);
    if (!show) return;
    const rows = computeWeeklyRankings(10).get(showId) || [];
    const bodyHTML = rows.length
        ? `<div class="rankings-list">${rankingRowsHTML(rows, 1)}</div>`
        : `<div class="muted">No ranked superstars on this show yet.</div>`;
    const modalPromise = openModal({
        title: `${show.name} Top 10`,
        bodyHTML,
        okText: "Close",
        cancelText: "Close",
        hideCancel: true,
    });

    let selectedSuperstarId = "";
    $$("[data-open-ss]", $("#modalBody")).forEach(el => {
        const open = () => {
            selectedSuperstarId = String(el.dataset.openSs || "").trim();
            closeModal({ ok: false });
        };
        el.addEventListener("click", open);
        el.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                open();
            }
        });
    });

    await modalPromise;
    if (selectedSuperstarId) {
        await openSuperstarDetails(selectedSuperstarId, { readOnly: true, fromRankings: true });
    }
}
function championshipHolderSuperstars(championshipId, showId = "") {
    return state.superstars
        .filter(ss => parseChampionships(ss.championships).includes(championshipId))
        .sort((a, b) => {
            const aOnShow = showId ? Number(superstarOnShow(a, showId)) : 0;
            const bOnShow = showId ? Number(superstarOnShow(b, showId)) : 0;
            if (aOnShow !== bOnShow) return bOnShow - aOnShow;
            return a.name.localeCompare(b.name);
        });
}
function championshipDashboardCategory(championship) {
    const division = normalizeChampionshipDivision(championship?.division, championship?.name, championship?.gender);
    if (division === "World") {
        const gender = normalizeChampionshipGender(championship?.gender);
        if (gender === "Female") return "Women's World Championship";
        if (gender === "Male") return "Men's World Championship";
        return "World Championship";
    }
    if (division === "Women") return "Women's World Championship";
    if (division === "Midcard") return "Midcard Championship";
    if (division === "Tag") return "Tag Team Championship";
    return "Championship";
}
function sortChampionshipsForDashboard(a, b) {
    const divisionOrder = { World: 0, Women: 1, Midcard: 2, Tag: 3, Other: 4 };
    const aDivision = normalizeChampionshipDivision(a?.division, a?.name, a?.gender);
    const bDivision = normalizeChampionshipDivision(b?.division, b?.name, b?.gender);
    const divisionDelta = (divisionOrder[aDivision] ?? 9) - (divisionOrder[bDivision] ?? 9);
    if (divisionDelta !== 0) return divisionDelta;
    const genderOrder = { Male: 0, Female: 1, Intergender: 2 };
    const genderDelta = (genderOrder[normalizeChampionshipGender(a?.gender)] ?? 9) - (genderOrder[normalizeChampionshipGender(b?.gender)] ?? 9);
    if (genderDelta !== 0) return genderDelta;
    return String(a?.name || "").localeCompare(String(b?.name || ""));
}
function championshipBoardSlotKey(championship) {
    const name = normalizeNameForCompare(championship?.name);
    const gender = normalizeChampionshipGender(championship?.gender);
    const savedDivision = normalizeChampionshipDivision(championship?.division, championship?.name, championship?.gender);
    const isWomenNamed = /women|womens/.test(name);
    const isTagNamed = /tag|team/.test(name);
    const isMidcardNamed = championshipNameLooksMidcard(name) || /\bus championship\b|\bus title\b/.test(name);

    if (savedDivision === "Tag" || isTagNamed) {
        return gender === "Female" || isWomenNamed ? "women_tag" : "men_tag";
    }
    if (savedDivision === "Midcard" || isMidcardNamed) {
        return gender === "Female" || isWomenNamed ? "women_midcard" : "men_midcard";
    }
    if (savedDivision === "Women" || gender === "Female" || isWomenNamed) {
        return "women_world";
    }
    return "men_world";
}

function prepareShowBoardPhoto(img) {
    if (!img) return;

    const markShape = () => {
        if (!img.naturalWidth || !img.naturalHeight) return;
        const ratio = img.naturalWidth / img.naturalHeight;
        img.dataset.boardShape = ratio < 0.82 ? "portrait" : (ratio > 1.18 ? "landscape" : "square");
    };

    const useFallbackFit = () => {
        markShape();
        img.classList.remove("is-board-normalized", "is-alpha-trimmed");
        img.classList.add("is-board-fallback-fit");
    };

    const analyze = () => {
        markShape();
        if (img.dataset.boardNormalized === "1" || !img.naturalWidth || !img.naturalHeight) return;

        try {
            // Work on a reasonably small copy so opening the board stays smooth on phones.
            const maxDimension = 560;
            const sourceScale = Math.min(1, maxDimension / Math.max(img.naturalWidth, img.naturalHeight));
            const width = Math.max(1, Math.round(img.naturalWidth * sourceScale));
            const height = Math.max(1, Math.round(img.naturalHeight * sourceScale));
            const sourceCanvas = document.createElement("canvas");
            sourceCanvas.width = width;
            sourceCanvas.height = height;
            const context = sourceCanvas.getContext("2d", { willReadFrequently: true });
            if (!context) {
                useFallbackFit();
                return;
            }
            context.imageSmoothingEnabled = true;
            context.imageSmoothingQuality = "high";
            context.clearRect(0, 0, width, height);
            context.drawImage(img, 0, 0, width, height);
            const imageData = context.getImageData(0, 0, width, height);
            const pixels = imageData.data;
            const totalPixels = width * height;

            const emptyBounds = () => ({ minX: width, minY: height, maxX: -1, maxY: -1, count: 0 });
            const includePixel = (bounds, x, y) => {
                if (x < bounds.minX) bounds.minX = x;
                if (x > bounds.maxX) bounds.maxX = x;
                if (y < bounds.minY) bounds.minY = y;
                if (y > bounds.maxY) bounds.maxY = y;
                bounds.count += 1;
            };
            const boundsAreUseful = bounds => bounds && bounds.maxX >= bounds.minX && bounds.maxY >= bounds.minY && bounds.count > totalPixels * 0.006;

            // Transparent renders are the most reliable case: use every visible pixel to
            // discover the wrestler's real bounds, ignoring empty padding in the file.
            let transparentCount = 0;
            const alphaBounds = emptyBounds();
            for (let y = 0; y < height; y += 1) {
                for (let x = 0; x < width; x += 1) {
                    const alpha = pixels[((y * width) + x) * 4 + 3];
                    if (alpha < 245) transparentCount += 1;
                    if (alpha > 18) includePixel(alphaBounds, x, y);
                }
            }

            let subjectBounds = null;
            let transparentSource = transparentCount > totalPixels * 0.004;
            if (transparentSource && boundsAreUseful(alphaBounds)) {
                subjectBounds = alphaBounds;
            }

            // Some renders have a baked-in dark or colored background. For those, flood
            // the connected background inward from the outer edges, then keep the largest
            // remaining connected region as the wrestler. This normalizes large, small,
            // square, portrait, and landscape source files into the same visual crop.
            if (!subjectBounds) {
                transparentSource = false;
                const background = new Uint8Array(totalPixels);
                const queue = new Int32Array(totalPixels);
                let queueStart = 0;
                let queueEnd = 0;
                const palette = [];
                const paletteStep = Math.max(3, Math.floor(Math.min(width, height) / 30));

                const colorAt = index => {
                    const offset = index * 4;
                    return [pixels[offset], pixels[offset + 1], pixels[offset + 2]];
                };
                const colorDistanceSq = (a, b) => {
                    const dr = a[0] - b[0];
                    const dg = a[1] - b[1];
                    const db = a[2] - b[2];
                    return (dr * dr) + (dg * dg) + (db * db);
                };
                const addPalette = (x, y) => {
                    const index = (y * width) + x;
                    const alpha = pixels[(index * 4) + 3];
                    if (alpha > 12) palette.push(colorAt(index));
                };
                for (let x = 0; x < width; x += paletteStep) {
                    addPalette(x, 0);
                    if (x < width * 0.18 || x > width * 0.82) addPalette(x, height - 1);
                }
                for (let y = 0; y < height; y += paletteStep) {
                    addPalette(0, y);
                    addPalette(width - 1, y);
                }

                const seed = (x, y) => {
                    if (x < 0 || x >= width || y < 0 || y >= height) return;
                    const index = (y * width) + x;
                    if (background[index]) return;
                    background[index] = 1;
                    queue[queueEnd++] = index;
                };
                for (let x = 0; x < width; x += 2) seed(x, 0);
                for (let y = 0; y < height; y += 2) {
                    seed(0, y);
                    seed(width - 1, y);
                }
                for (let x = 0; x < Math.max(1, Math.floor(width * 0.16)); x += 2) {
                    seed(x, height - 1);
                    seed(width - 1 - x, height - 1);
                }

                const paletteDistanceSq = color => {
                    let closest = Infinity;
                    for (let i = 0; i < palette.length; i += 1) {
                        const distance = colorDistanceSq(color, palette[i]);
                        if (distance < closest) closest = distance;
                    }
                    return closest;
                };
                const directPaletteThreshold = 35 * 35;
                const gradientPaletteThreshold = 66 * 66;
                const neighborThreshold = 23 * 23;
                const tryBackgroundNeighbor = (fromIndex, nextIndex) => {
                    if (nextIndex < 0 || nextIndex >= totalPixels || background[nextIndex]) return;
                    const alpha = pixels[(nextIndex * 4) + 3];
                    if (alpha <= 12) {
                        background[nextIndex] = 1;
                        queue[queueEnd++] = nextIndex;
                        return;
                    }
                    const nextColor = colorAt(nextIndex);
                    const paletteDistance = paletteDistanceSq(nextColor);
                    const localDistance = colorDistanceSq(colorAt(fromIndex), nextColor);
                    if (paletteDistance <= directPaletteThreshold ||
                        (paletteDistance <= gradientPaletteThreshold && localDistance <= neighborThreshold)) {
                        background[nextIndex] = 1;
                        queue[queueEnd++] = nextIndex;
                    }
                };

                while (queueStart < queueEnd) {
                    const index = queue[queueStart++];
                    const x = index % width;
                    const y = Math.floor(index / width);
                    if (x > 0) tryBackgroundNeighbor(index, index - 1);
                    if (x + 1 < width) tryBackgroundNeighbor(index, index + 1);
                    if (y > 0) tryBackgroundNeighbor(index, index - width);
                    if (y + 1 < height) tryBackgroundNeighbor(index, index + width);
                }

                // Keep the largest foreground component so borders, logos, and small bits of
                // compression noise do not force the crop to include the whole source image.
                const visited = new Uint8Array(totalPixels);
                const componentQueue = new Int32Array(totalPixels);
                let largestBounds = null;
                for (let startIndex = 0; startIndex < totalPixels; startIndex += 1) {
                    if (visited[startIndex] || background[startIndex] || pixels[(startIndex * 4) + 3] <= 18) continue;
                    let componentStart = 0;
                    let componentEnd = 0;
                    componentQueue[componentEnd++] = startIndex;
                    visited[startIndex] = 1;
                    const bounds = emptyBounds();
                    while (componentStart < componentEnd) {
                        const index = componentQueue[componentStart++];
                        const x = index % width;
                        const y = Math.floor(index / width);
                        includePixel(bounds, x, y);
                        const visit = nextIndex => {
                            if (nextIndex < 0 || nextIndex >= totalPixels || visited[nextIndex] || background[nextIndex] || pixels[(nextIndex * 4) + 3] <= 18) return;
                            visited[nextIndex] = 1;
                            componentQueue[componentEnd++] = nextIndex;
                        };
                        if (x > 0) visit(index - 1);
                        if (x + 1 < width) visit(index + 1);
                        if (y > 0) visit(index - width);
                        if (y + 1 < height) visit(index + width);
                    }
                    if (!largestBounds || bounds.count > largestBounds.count) largestBounds = bounds;
                }
                if (boundsAreUseful(largestBounds)) subjectBounds = largestBounds;
            }

            if (!subjectBounds) {
                useFallbackFit();
                return;
            }

            const subjectWidth = subjectBounds.maxX - subjectBounds.minX + 1;
            const subjectHeight = subjectBounds.maxY - subjectBounds.minY + 1;
            if (subjectWidth < 5 || subjectHeight < 5) {
                useFallbackFit();
                return;
            }

            // Very tall full-body artwork is reframed to an upper-body portrait so every
            // champion reads like the Jordynne reference instead of becoming a tiny figure.
            const subjectRatio = subjectHeight / Math.max(1, subjectWidth);
            let visibleHeightRatio = 1;
            if (subjectRatio > 2.25) visibleHeightRatio = 0.64;
            else if (subjectRatio > 1.85) visibleHeightRatio = 0.72;
            else if (subjectRatio > 1.55) visibleHeightRatio = 0.83;
            const focusedBottom = Math.min(subjectBounds.maxY, Math.round(subjectBounds.minY + (subjectHeight * visibleHeightRatio)));
            const focusedHeight = focusedBottom - subjectBounds.minY + 1;

            const sidePadding = Math.max(4, Math.round(subjectWidth * 0.075));
            const topPadding = Math.max(4, Math.round(focusedHeight * 0.075));
            const bottomPadding = Math.max(2, Math.round(focusedHeight * 0.018));
            let cropX = Math.max(0, subjectBounds.minX - sidePadding);
            let cropY = Math.max(0, subjectBounds.minY - topPadding);
            let cropRight = Math.min(width, subjectBounds.maxX + sidePadding + 1);
            let cropBottom = Math.min(height, focusedBottom + bottomPadding + 1);
            let cropWidth = cropRight - cropX;
            let cropHeight = cropBottom - cropY;

            if (cropWidth < 8 || cropHeight < 8) {
                useFallbackFit();
                return;
            }

            // Output the exact same 6:7 aspect ratio used by every dashboard portrait.
            // Because each generated image already matches its frame, CSS never has to
            // guess between contain/cover or zoom differently for different source sizes.
            const targetWidth = 600;
            const targetHeight = 700;
            const output = document.createElement("canvas");
            output.width = targetWidth;
            output.height = targetHeight;
            const outputContext = output.getContext("2d");
            if (!outputContext) {
                useFallbackFit();
                return;
            }
            outputContext.imageSmoothingEnabled = true;
            outputContext.imageSmoothingQuality = "high";
            outputContext.clearRect(0, 0, targetWidth, targetHeight);

            // Fill the portrait consistently instead of preserving every edge of the
            // source image. A cover-style scale gives broad renders (jackets, raised arms,
            // tag poses, etc.) the same close upper-body framing as narrower portraits.
            // The crop is anchored near the top so the face always stays visible while any
            // necessary overflow is taken from the lower body and outer shoulders.
            const heightScale = (targetHeight * 1.01) / cropHeight;
            const widthScale = (targetWidth * 1.015) / cropWidth;
            let drawScale = Math.max(heightScale, widthScale);

            // Avoid an extreme zoom when a source has a very narrow silhouette. The focused
            // crop above already removes most full-body space, so this cap still produces a
            // strong upper-body portrait while protecting the face and shoulders.
            const fitScale = Math.min(targetWidth / cropWidth, targetHeight / cropHeight);
            drawScale = Math.min(drawScale, fitScale * 1.42);

            const drawWidth = cropWidth * drawScale;
            const drawHeight = cropHeight * drawScale;
            const drawX = (targetWidth - drawWidth) / 2;
            const drawY = targetHeight * 0.012;
            outputContext.drawImage(
                sourceCanvas,
                cropX, cropY, cropWidth, cropHeight,
                drawX, drawY, drawWidth, drawHeight
            );

            img.dataset.boardNormalized = "1";
            img.classList.remove("is-alpha-trimmed", "is-board-fallback-fit");
            img.classList.add("is-board-normalized");
            img.addEventListener("load", markShape, { once: true });
            img.src = output.toDataURL("image/png");
        } catch {
            // Cross-origin images cannot be inspected in canvas. They use a consistent
            // upper-body CSS crop instead of reverting to the browser's natural sizing.
            useFallbackFit();
        }
    };

    if (img.complete && img.naturalWidth) analyze();
    else img.addEventListener("load", analyze, { once: true });
}

async function openShowChampionsModal(showId) {
    const show = getShow(showId);
    if (!show) return;

    const championships = state.championships
        .filter(championship => championshipAvailableForShowIds(championship, [showId]))
        .sort(sortChampionshipsForDashboard);

    const usedChampionshipIds = new Set();
    const takeChampionship = (predicate) => {
        const championship = championships.find(item => !usedChampionshipIds.has(item.id) && predicate(item));
        if (championship) usedChampionshipIds.add(championship.id);
        return championship || null;
    };

    const activeReignForChampionship = (championshipId) => {
        if (!championshipId) return null;
        return (state.titleReigns || [])
            .filter(reign => reign.championshipId === championshipId && !reign.endDate)
            .slice()
            .sort((a, b) => String(b.startDate || "").localeCompare(String(a.startDate || "")))[0] || null;
    };

    const defenseCountForReign = (championshipId, reign) => {
        if (!championshipId || !reign || !isISODate(reign.startDate)) return 0;
        const universeCurrentISO = getUniverseCurrentISO();
        return state.events.reduce((total, event) => {
            if (!isISODate(event?.date)) return total;
            if (event.date <= reign.startDate || event.date > universeCurrentISO) return total;
            if (!(event.date < universeCurrentISO || isUniverseDateCompleted(event.date))) return total;
            const defenses = (Array.isArray(event.matches) ? event.matches : []).filter(match => {
                if (String(match?.championshipId || "").trim() !== championshipId) return false;
                const result = normalizeNameForCompare(match?.result);
                return !!result && result !== "no result";
            }).length;
            return total + defenses;
        }, 0);
    };

    const championshipView = (championship) => {
        if (!championship) {
            return {
                championship: null,
                holders: [],
                holderNames: [],
                reign: null,
                days: 0,
                defenses: 0,
                held: false,
            };
        }
        const reign = activeReignForChampionship(championship.id);
        const rosterHolders = championshipHolderSuperstars(championship.id, showId);
        const reignHolders = (reign?.holderIds || [])
            .map(id => state.superstars.find(superstar => superstar.id === id))
            .filter(Boolean);
        const holders = reignHolders.length ? reignHolders : rosterHolders;
        const holderNames = holders.length
            ? holders.map(holder => holder.name)
            : (reign?.holderNames || []);
        return {
            championship,
            holders,
            holderNames,
            reign,
            days: reign ? reignDayLength(reign) : 0,
            defenses: reign ? defenseCountForReign(championship.id, reign) : 0,
            held: !!(holderNames.length || holders.length),
        };
    };

    const tagTeamLabelForHolders = (holders, fallbackNames = []) => {
        const factions = Array.from(new Set(holders.map(holder => String(holder?.faction || "").trim()).filter(Boolean)));
        if (factions.length === 1) return factions[0];
        const names = holders.length ? holders.map(holder => holder.name) : fallbackNames;
        return names.join(" / ");
    };

    const holderPortraitHTML = (holder, variant = "row") => {
        const name = String(holder?.name || "Unknown");
        const photo = holder ? superstarPhotoURL(holder) : "";
        const initials = superstarInitials(name) || "?";
        return `
          <span class="show-board-portrait show-board-portrait-${variant}${photo ? " has-photo" : " is-broken"}">
            ${photo ? `<img data-show-board-photo src="${escapeAttr(photo)}" alt="${escapeAttr(name)}" />` : ""}
            <span class="show-board-portrait-fallback">${escapeHTML(initials)}</span>
          </span>
        `;
    };

    const vacantPortraitHTML = (variant = "row") => `
      <span class="show-board-portrait show-board-portrait-${variant} is-vacant">
        <span class="show-board-portrait-fallback">?</span>
      </span>
    `;

    const buildFeaturedChampionshipHTML = (championship, emptyLabel) => {
        const view = championshipView(championship);
        const titleName = championship?.name || emptyLabel;
        const holderName = view.held
            ? tagTeamLabelForHolders(view.holders, view.holderNames)
            : "VACANT";
        const primaryHolder = view.holders[0] || null;
        const portraits = view.held && view.holders.length
            ? view.holders.slice(0, 2).map(holder => holderPortraitHTML(holder, view.holders.length > 1 ? "featured-tag" : "featured")).join("")
            : vacantPortraitHTML("featured");
        const content = `
            <div class="show-board-featured-title">${escapeHTML(titleName)}</div>
            <div class="show-board-featured-holder">${escapeHTML(holderName)}</div>
            <div class="show-board-featured-meta ${view.held ? "" : "is-vacant"}">
              ${view.held
                  ? `<span class="show-board-status-dot"></span><span>${view.days} ${view.days === 1 ? "DAY" : "DAYS"}</span>`
                  : `<span>—</span><span>OPEN</span>`}
            </div>
            <div class="show-board-featured-render ${view.holders.length > 1 ? "is-tag" : ""}">
              ${portraits}
              ${view.held ? "" : `<span class="show-board-render-label">OPEN</span>`}
            </div>
        `;
        return primaryHolder
            ? `<button type="button" class="show-board-featured-card is-held" data-open-ss="${escapeAttr(primaryHolder.id)}">${content}</button>`
            : `<div class="show-board-featured-card is-vacant">${content}</div>`;
    };

    const buildChampionshipRowHTML = (championship) => {
        const view = championshipView(championship);
        const isTag = championshipBoardSlotKey(championship).includes("tag");
        const label = view.held
            ? (isTag ? tagTeamLabelForHolders(view.holders, view.holderNames) : (view.holderNames[0] || view.holders[0]?.name || "Champion"))
            : "VACANT";
        const primaryHolder = view.holders[0] || null;
        const portraits = view.held && view.holders.length
            ? view.holders.slice(0, isTag ? 2 : 1).map(holder => holderPortraitHTML(holder, "row")).join("")
            : Array.from({ length: isTag ? 2 : 1 }, () => vacantPortraitHTML("row")).join("");
        const body = `
            <span class="show-board-row-accent" aria-hidden="true"></span>
            <span class="show-board-row-portraits ${isTag ? "is-tag" : ""}">${portraits}</span>
            <span class="show-board-row-copy">
              <span class="show-board-row-title">${escapeHTML(championship.name)}</span>
              <span class="show-board-row-holder">${escapeHTML(label)}</span>
              ${view.held && isTag && view.holderNames.length > 1 ? `<span class="show-board-row-team-members">${escapeHTML(view.holderNames.join(" · "))}</span>` : ""}
            </span>
            <span class="show-board-row-stat ${view.held ? "" : "is-vacant"}">
              <span class="show-board-row-stat-value">${view.held ? view.days : "—"}</span>
              <span class="show-board-row-stat-label">${view.held ? "DAYS" : "OPEN"}</span>
            </span>
        `;
        return primaryHolder
            ? `<button type="button" class="show-board-row is-held" data-open-ss="${escapeAttr(primaryHolder.id)}">${body}</button>`
            : `<div class="show-board-row is-vacant">${body}</div>`;
    };

    const mensWorldChampionship = takeChampionship(championship => championshipBoardSlotKey(championship) === "men_world");
    const womensWorldChampionship = takeChampionship(championship => championshipBoardSlotKey(championship) === "women_world");
    const lowerChampionships = [
        takeChampionship(championship => championshipBoardSlotKey(championship) === "men_midcard"),
        takeChampionship(championship => championshipBoardSlotKey(championship) === "women_midcard"),
        takeChampionship(championship => championshipBoardSlotKey(championship) === "men_tag"),
        takeChampionship(championship => championshipBoardSlotKey(championship) === "women_tag"),
        ...championships.filter(championship => !usedChampionshipIds.has(championship.id)),
    ].filter(Boolean);

    const bodyHTML = championships.length
        ? `
            <div class="show-board-modal" style="--show-board-accent:${escapeAttr(show.color)};">
              <div class="show-board-shell">
                <header class="show-board-hero">
                  <div class="show-board-hero-stripes" aria-hidden="true"></div>
                  <div class="show-board-show-name">${escapeHTML(show.name)}</div>
                </header>
                <div class="show-board-featured-grid">
                  ${buildFeaturedChampionshipHTML(mensWorldChampionship, "Men's World Championship")}
                  ${buildFeaturedChampionshipHTML(womensWorldChampionship, "Women's World Championship")}
                </div>
                <div class="show-board-section">
                  ${lowerChampionships.length
                      ? lowerChampionships.map(buildChampionshipRowHTML).join("")
                      : `<div class="show-board-empty">No additional championships are assigned to this show.</div>`}
                </div>
              </div>
            </div>
          `
        : `<div class="muted">No championships are assigned to ${escapeHTML(show.name)} yet.</div>`;

    const modalPromise = openModal({
        title: `${show.name} Champions`,
        bodyHTML,
        okText: "Close",
        cancelText: "Close",
        hideCancel: true,
        variant: "show-champions-modal",
    });

    $$('[data-show-board-photo]', $("#modalBody")).forEach(img => {
        img.addEventListener("error", () => img.closest(".show-board-portrait")?.classList.add("is-broken"), { once: true });
        prepareShowBoardPhoto(img);
    });

    let selectedSuperstarId = "";
    $$('[data-open-ss]', $("#modalBody")).forEach(element => {
        const open = () => {
            selectedSuperstarId = String(element.dataset.openSs || "").trim();
            closeModal({ ok: false });
        };
        element.addEventListener("click", open);
        element.addEventListener("keydown", event => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                open();
            }
        });
    });

    await modalPromise;
    if (selectedSuperstarId) {
        await openSuperstarDetails(selectedSuperstarId, { readOnly: true });
    }
}

function showName(showId) {
    if (!showId) return "No show";
    const s = getShow(showId);
    return s ? s.name : "Unknown show";
}
function showColor(showId) { return getShow(showId)?.color || "#888"; }
function eventShowIds(event) {
    const ids = Array.isArray(event?.showIds)
        ? event.showIds.map(id => String(id ?? "").trim()).filter(Boolean)
        : [];
    if (ids.length) return Array.from(new Set(ids));
    const legacy = String(event?.showId ?? "").trim();
    return legacy ? [legacy] : [];
}
function eventHasShow(event, showId) {
    if (!showId) return false;
    return eventShowIds(event).includes(showId);
}
function eventShowNames(event) {
    const names = eventShowIds(event)
        .map(showName)
        .filter(n => n && n !== "Unknown show" && n !== "No show");
    return Array.from(new Set(names));
}
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
        const nextChampionships = parseChampionships(ss.championships).filter(championshipId => {
            const championship = getChampionship(championshipId);
            return championshipAvailableForShowIds(championship, nextShowIds);
        });
        return {
            ...ss,
            showIds: nextShowIds,
            showId: nextShowIds[0] ?? null,
            championships: nextChampionships,
            isChampion: nextChampionships.length > 0,
        };
    });
    state.championships = state.championships.map(c => {
        const nextShowIds = Array.isArray(c?.showIds) ? c.showIds.filter(id => id !== showId) : [];
        return { ...c, showIds: nextShowIds, showId: nextShowIds[0] ?? null };
    });
    state.rivalries = (Array.isArray(state.rivalries) ? state.rivalries : []).map(rivalry => {
        const nextShowIds = (Array.isArray(rivalry?.showIds) ? rivalry.showIds : []).filter(id => id !== showId);
        return { ...rivalry, showIds: nextShowIds, showId: nextShowIds[0] ?? null };
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
    const type = String(event?.type ?? "weekly").toLowerCase() === "ppv" ? "ppv" : "weekly";
    const rawShowIds = Array.isArray(event?.showIds)
        ? event.showIds.map(id => String(id ?? "").trim()).filter(Boolean)
        : [];
    const mergedShowIds = rawShowIds.length
        ? rawShowIds
        : (event?.showId ? [String(event.showId).trim()] : []);
    const showIds = Array.from(new Set(mergedShowIds));
    const normalizedEvent = {
        ...event,
        type,
        showIds,
        showId: showIds[0] ?? null,
    };

    const idx = state.events.findIndex(e => e.id === event.id);
    if (idx >= 0) state.events[idx] = normalizedEvent;
    else state.events.push(normalizedEvent);
    state.events.sort((a, b) => a.date.localeCompare(b.date));
    saveSoon();
}
function deleteEvent(eventId) {
    const ev = state.events.find(e => e.id === eventId);
    const snapshot = snapshotState();
    state.events = state.events.filter(e => e.id !== eventId);
    saveSoon();
    if (ev) offerUndo(`${ev.name || "Event"} deleted.`, snapshot);
}

// -------------------- ROUTER --------------------
const views = ["dashboard", "calendar", "planner", "roster", "settings"];
let currentView = "dashboard";
let uiSessionSaveTimer = null;

function readUiSessionState() {
    try {
        const parsed = safeJSONParse(sessionStorage.getItem(UI_SESSION_KEY));
        return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
        return {};
    }
}
function saveUiSessionState() {
    if (document.body.classList.contains("modal-open")) return;
    try {
        sessionStorage.setItem(UI_SESSION_KEY, JSON.stringify({
            view: currentView,
            plannerEventId,
            scrollX: window.scrollX || 0,
            scrollY: window.scrollY || 0,
            savedAt: Date.now(),
        }));
    } catch { /* session persistence is optional */ }
}
function scheduleUiSessionSave() {
    clearTimeout(uiSessionSaveTimer);
    uiSessionSaveTimer = setTimeout(saveUiSessionState, 120);
}
function restoreUiSessionScroll(session) {
    const x = Number(session?.scrollX || 0);
    const y = Number(session?.scrollY || 0);
    const restore = () => window.scrollTo({ left: x, top: y, behavior: "instant" });
    requestAnimationFrame(() => {
        restore();
        requestAnimationFrame(restore);
    });
}

function setActiveNav(view) {
    $$(".nav-btn").forEach(b => b.classList.toggle("active", b.dataset.view === view));
    $$(".bnav-btn").forEach(b => b.classList.toggle("active", b.dataset.view === view));
}
const viewScrollPositions = {};
function prettyUniverseDate(iso) {
    if (!isISODate(iso)) return "";
    return parseISO(iso).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}
function viewSubtitle(view) {
    if (view === "dashboard") return `Universe day · ${prettyUniverseDate(getUniverseCurrentISO())}`;
    return "";
}
function showView(view) {
    currentView = view;
    setActiveNav(view);
    views.forEach(v => $(`#view-${v}`).classList.toggle("hidden", v !== view));
    const titles = { dashboard: "Dashboard", calendar: "Calendar", planner: "Planner", roster: "Roster", settings: "Settings" };
    $("#viewTitle").textContent = titles[view];
    document.title = `${titles[view]} · 2K Universe`;
    renderAll();
    scheduleUiSessionSave();
}
function setView(view) {
    if (!views.includes(view)) return;
    const previousView = currentView;
    if (previousView === view) {
        // Tapping the active tab again scrolls back to the top, like iOS/Android.
        window.scrollTo({ top: 0, behavior: "smooth" });
        renderAll();
        return;
    }
    viewScrollPositions[previousView] = window.scrollY || 0;
    const applyView = () => {
        showView(view);
        window.scrollTo({ top: viewScrollPositions[view] || 0, behavior: "instant" });
    };

    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    if (document.startViewTransition && !reduceMotion && !document.hidden) {
        document.startViewTransition(applyView);
    } else {
        applyView();
    }
}

// Broken photo URLs fall back to initials instead of the browser's broken
// image icon with the alt text spilling out of a tiny box.
document.addEventListener("error", e => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || img.dataset.fallbackDone) return;
    img.dataset.fallbackDone = "1";
    const layered = img.closest(".planner-participant-avatar, .picker-superstar-visual, .picker-matchup-avatar, .show-board-portrait");
    if (layered) {
        img.classList.add("is-broken");
        img.closest(".picker-superstar-visual")?.classList.remove("has-photo");
        img.closest(".show-board-portrait")?.classList.add("is-broken");
        return;
    }
    const fallback = document.createElement("span");
    fallback.className = `${img.className} img-fallback`;
    fallback.setAttribute("aria-hidden", "true");
    fallback.textContent = superstarInitials(img.getAttribute("alt") || "");
    img.replaceWith(fallback);
}, true);

function optimizeImages(root = document) {
    const images = root?.matches?.("img") ? [root] : Array.from(root?.querySelectorAll?.("img") || []);
    images.forEach(img => {
        if (!img.hasAttribute("loading")) img.loading = "lazy";
        if (!img.hasAttribute("decoding")) img.decoding = "async";
        img.draggable = false;
    });
}

// -------------------- MODAL --------------------
// One shared dialog. On phones it is a bottom sheet (grabber, swipe down or tap
// the backdrop to dismiss); on larger screens a centred card (Esc to close).
const modal = $("#modal");
const modalCard = $(".modal-card");
const MODAL_VARIANTS = ["superstar-picker-modal", "photo-crop-modal", "show-champions-modal"];
let modalResolve = null;
let modalScrollLock = null;

// Locking the page with overflow (instead of position:fixed) means the page
// never moves underneath a sheet, so closing one can't jump or "refresh".
function lockDocumentScroll() {
    if (modalScrollLock) return;
    modalScrollLock = { x: window.scrollX || 0, y: window.scrollY || 0 };
    document.documentElement.classList.add("is-scroll-locked");
}
function unlockDocumentScroll() {
    if (!modalScrollLock) return;
    const { x, y } = modalScrollLock;
    modalScrollLock = null;
    document.documentElement.classList.remove("is-scroll-locked");
    if (Math.abs((window.scrollY || 0) - y) > 1 || Math.abs((window.scrollX || 0) - x) > 1) {
        window.scrollTo({ left: x, top: y, behavior: "instant" });
    }
}

function resetModalScrollPosition() {
    const body = $("#modalBody");
    modal.scrollTop = 0;
    if (body) body.scrollTop = 0;
    if (modalCard) modalCard.scrollTop = 0;
}

// Footer buttons that a caller injected for one dialog (Edit, Delete, Clear
// slot…) must never leak into the next dialog.
function clearModalExtras() {
    $$(".modal-actions > :not(#modalCancel):not(#modalOk)").forEach(el => el.remove());
}

function openModal({ title, bodyHTML, okText = "OK", cancelText = "Cancel", hideCancel = false, hideOk = false, variant = "" }) {
    // Opening a dialog from inside another one replaces it. Settle the previous
    // caller's promise so its code can finish instead of hanging forever.
    if (modalResolve) {
        const previous = modalResolve;
        modalResolve = null;
        previous({ ok: false, superseded: true });
    }
    clearModalExtras();
    const body = $("#modalBody");
    $("#modalTitle").textContent = title;
    body.innerHTML = bodyHTML;
    $("#modalOk").textContent = okText;
    $("#modalCancel").textContent = cancelText;
    $("#modalOk").classList.toggle("hidden", !!hideOk);
    $("#modalCancel").classList.toggle("hidden", !!hideCancel);
    modalCard.classList.remove(...MODAL_VARIANTS, "is-dragging");
    modalCard.style.transform = "";
    if (variant) modalCard.classList.add(variant);
    resetModalScrollPosition();
    lockDocumentScroll();
    modal.classList.remove("hidden");
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
    optimizeImages(body);
    requestAnimationFrame(resetModalScrollPosition);
    return new Promise(res => { modalResolve = res; });
}
function closeModal(result = { ok: false }) {
    modal.classList.add("hidden");
    modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");
    clearModalExtras();
    modalCard.classList.remove(...MODAL_VARIANTS, "is-dragging");
    modalCard.style.transform = "";
    $("#modalOk").classList.remove("hidden");
    $("#modalCancel").classList.remove("hidden");
    unlockDocumentScroll();
    const resolve = modalResolve;
    modalResolve = null;
    if (resolve) resolve(result);
}
function isModalOpen() {
    return !modal.classList.contains("hidden");
}
$("#modalCancel").addEventListener("click", () => closeModal({ ok: false }));
$("#modalOk").addEventListener("click", () => closeModal({ ok: true }));
// Tap outside the sheet / press Esc to dismiss (same as Cancel).
let modalBackdropPress = false;
modal.addEventListener("pointerdown", e => { modalBackdropPress = e.target === modal; });
modal.addEventListener("click", e => {
    // Only a press that starts AND ends on the backdrop dismisses (a text
    // selection dragged out of the sheet must not close it).
    if (e.target === modal && modalBackdropPress) closeModal({ ok: false });
    modalBackdropPress = false;
});
document.addEventListener("keydown", e => {
    if (e.key === "Escape" && isModalOpen()) closeModal({ ok: false });
});
// Swipe the sheet down by its grabber/title to dismiss (phones).
(function enableSheetSwipe() {
    const sheetMQ = window.matchMedia("(max-width: 720px)");
    let drag = null;
    const handles = [$(".modal-grabber"), $("#modalTitle")].filter(Boolean);
    const end = (e) => {
        if (!drag || drag.pointerId !== e.pointerId) return;
        const dy = Math.max(0, e.clientY - drag.startY);
        const velocity = dy / Math.max(1, performance.now() - drag.t0);
        const shouldClose = dy > 110 || (dy > 40 && velocity > 0.6);
        modalCard.classList.remove("is-dragging");
        drag = null;
        if (shouldClose) {
            modalCard.style.transform = "";
            closeModal({ ok: false });
        } else {
            modalCard.style.transform = "";
        }
    };
    handles.forEach(handle => {
        handle.addEventListener("pointerdown", e => {
            if (!sheetMQ.matches || e.pointerType === "mouse") return;
            drag = { pointerId: e.pointerId, startY: e.clientY, t0: performance.now() };
            modalCard.classList.add("is-dragging");
            try { handle.setPointerCapture(e.pointerId); } catch { /* ignore */ }
        });
        handle.addEventListener("pointermove", e => {
            if (!drag || drag.pointerId !== e.pointerId) return;
            const dy = Math.max(0, e.clientY - drag.startY);
            modalCard.style.transform = `translateY(${dy}px)`;
        });
        handle.addEventListener("pointerup", end);
        handle.addEventListener("pointercancel", end);
    });
})();

// -------------------- TOAST + UNDO --------------------
let toastContainer = null;
function ensureToastContainer() {
    if (toastContainer && document.body.contains(toastContainer)) return toastContainer;
    toastContainer = document.createElement("div");
    toastContainer.className = "toast-stack";
    toastContainer.setAttribute("aria-live", "polite");
    document.body.appendChild(toastContainer);
    return toastContainer;
}
function showToast({ message, tone = "info", actionLabel = "", onAction = null, duration = 4200 }) {
    const root = ensureToastContainer();
    const toast = document.createElement("div");
    toast.className = `toast toast-${tone}`;
    const msgEl = document.createElement("div");
    msgEl.className = "toast-message";
    msgEl.textContent = message;
    toast.appendChild(msgEl);
    if (actionLabel && onAction) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "toast-action";
        btn.textContent = actionLabel;
        btn.addEventListener("click", () => {
            try { onAction(); } finally { dismiss(); }
        });
        toast.appendChild(btn);
    }
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "toast-close";
    closeBtn.setAttribute("aria-label", "Dismiss");
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", () => dismiss());
    toast.appendChild(closeBtn);
    root.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add("is-visible"));
    let dismissed = false;
    let dismissTimer = null;
    function dismiss() {
        if (dismissed) return;
        dismissed = true;
        clearTimeout(dismissTimer);
        toast.classList.remove("is-visible");
        toast.classList.add("is-leaving");
        setTimeout(() => toast.remove(), 240);
    }
    if (duration > 0) dismissTimer = setTimeout(dismiss, duration);
    return { dismiss };
}
function showSaveErrorToast() {
    showToast({
        message: "Couldn't save to local storage. Export your universe now to avoid losing data.",
        tone: "danger",
        actionLabel: "Export",
        duration: 9000,
        onAction: () => { try { exportUniverseJSON(); } catch (e) { /* noop */ } }
    });
}
function showBackupReminderToast() {
    showToast({
        message: "You've made a lot of changes. Want to back up your universe?",
        tone: "info",
        actionLabel: "Export",
        duration: 7000,
        onAction: () => { try { exportUniverseJSON(); } catch (e) { /* noop */ } }
    });
}

// Snapshot-based undo. snapshot() before destructive op, then offer Undo to restore.
function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
}
function snapshotState() {
    return deepClone(state);
}
function restoreFromSnapshot(snapshot) {
    if (!snapshot) return;
    state = normalizeStateData(snapshot);
    saveSoon();
    renderAll();
}
function offerUndo(message, snapshot) {
    showToast({
        message,
        tone: "info",
        actionLabel: "Undo",
        duration: 6000,
        onAction: () => restoreFromSnapshot(snapshot),
    });
}

// -------------------- DASHBOARD --------------------
// -------------------- DASHBOARD: HERO + BOOKING ASSIST + TITLE REIGNS --------------------
function renderUniverseDayHero() {
    const root = $("#universeDayBody");
    if (!root) return;
    const universeISO = getUniverseCurrentISO();
    const start = parseISO(universeISO);
    const dayName = start.toLocaleDateString(undefined, { weekday: "long" });
    const dateLabel = start.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

    // Find shows scheduled for today
    const dow = universeISO ? parseISO(universeISO).getDay() : -1; // Sun=0..Sat=6
    const todaysShows = (state.weeklySchedule || [])
        .filter(row => row.weekday === dow)
        .map(row => getShow(row.showId))
        .filter(Boolean);
    const todaysEvents = state.events.filter(e => e.date === universeISO);

    const eventsLine = todaysEvents.length
        ? todaysEvents.map(e => {
            const ids = eventShowIds(e);
            const tag = e.type === "ppv" ? "PLE" : "WK";
            return `<span class="universe-day-event-pill" data-open-event-detail="${e.id}">
                <span class="universe-day-event-tag">${tag}</span>
                <span>${escapeHTML(e.name || "(Unnamed)")}</span>
            </span>`;
        }).join("")
        : (todaysShows.length
            ? `<span class="muted tiny">${todaysShows.map(s => escapeHTML(s.name)).join(" • ")} scheduled today, no events booked yet.</span>`
            : `<span class="muted tiny">No shows scheduled for ${dayName}.</span>`);

    const startISO = getUniverseStartISO();
    const startDays = startISO ? Math.max(0, Math.round((parseISO(universeISO) - parseISO(startISO)) / 86400000)) : 0;

    root.innerHTML = `
        <div class="universe-day-grid">
            <div class="universe-day-meta">
                <div class="universe-day-label">Universe Day</div>
                <div class="universe-day-date">${escapeHTML(dayName)}</div>
                <div class="universe-day-sub">${escapeHTML(dateLabel)} • Day ${startDays} of your universe</div>
            </div>
            <div class="universe-day-events">${eventsLine}</div>
            <div class="universe-day-actions">
                <button type="button" class="btn universe-day-progress" id="universeDayProgress">
                    <span>Progress to Next Day</span>
                </button>
                <button type="button" class="btn secondary" id="universeDayOpenToday">Open Today's Events</button>
            </div>
        </div>
    `;

    $("#universeDayProgress")?.addEventListener("click", () => {
        const changes = completeUniverseDay(universeISO);
        calSelectedISO = nextUniverseDayISO(universeISO);
        setCalendarMonthFor(calSelectedISO);
        saveSoon();
        renderAll();
        announceTitleChanges(changes);
        // Smooth pulse on the hero card to acknowledge the action
        const card = $("#universeDayCard");
        if (card) {
            card.classList.remove("is-just-progressed");
            void card.offsetWidth; // restart animation
            card.classList.add("is-just-progressed");
        }
    });
    $("#universeDayOpenToday")?.addEventListener("click", () => {
        if (todaysEvents[0]) openPlanner(todaysEvents[0].id);
        else addEventFlow(universeISO);
    });
    $$("[data-open-event-detail]", root).forEach(el => {
        el.addEventListener("click", () => {
            openCalendarEventDetails(el.dataset.openEventDetail);
        });
    });
}

function renderBookingAssistant() {
    const root = $("#bookingAssistant");
    const hint = $("#bookingAssistantHint");
    if (!root) return;
    const suggestions = computeBookingSuggestions();
    if (hint) hint.textContent = suggestions.length ? `${suggestions.length} idea${suggestions.length === 1 ? "" : "s"}` : "";
    if (!suggestions.length) {
        root.innerHTML = `<div class="muted tiny">No booking suggestions right now. Keep advancing the universe to see ideas appear.</div>`;
        return;
    }
    root.innerHTML = `
        <div class="booking-suggestions">
            ${suggestions.slice(0, 6).map(s => {
                const iconClass = `booking-icon booking-icon-${s.kind}`;
                const symbol = ({
                    fresh_matchup: "✨",
                    stalled_rivalry: "⚡",
                    missing_from_tv: "👁",
                    stale_title: "🏆",
                    hot_streak: "🔥",
                })[s.kind] || "•";
                const refs = [];
                if (s.rivalryId) refs.push(`<button type="button" class="booking-ref" data-open-rivalry="${escapeAttr(s.rivalryId)}">View rivalry</button>`);
                if (s.championshipId) refs.push(`<button type="button" class="booking-ref" data-open-championship="${escapeAttr(s.championshipId)}">View title</button>`);
                if (Array.isArray(s.superstarIds)) {
                    s.superstarIds.forEach(id => {
                        const ss = state.superstars.find(x => x.id === id);
                        if (!ss) return;
                        refs.push(`<button type="button" class="booking-ref" data-open-ss="${escapeAttr(id)}">${escapeHTML(ss.name)}</button>`);
                    });
                }
                return `
                    <div class="booking-suggestion">
                        <div class="${iconClass}">${symbol}</div>
                        <div class="booking-body">
                            <div class="booking-title">${escapeHTML(s.title)}</div>
                            <div class="booking-detail">${escapeHTML(s.detail)}</div>
                            ${refs.length ? `<div class="booking-refs">${refs.join("")}</div>` : ""}
                        </div>
                    </div>
                `;
            }).join("")}
        </div>
    `;
    $$("[data-open-rivalry]", root).forEach(btn => {
        btn.addEventListener("click", () => {
            setView("settings");
            // open settings rivalries panel after a tick
            setTimeout(() => openSettingsPanel("rivalries"), 50);
        });
    });
    $$("[data-open-championship]", root).forEach(btn => {
        btn.addEventListener("click", () => {
            openChampionshipDetailsModal(btn.dataset.openChampionship);
        });
    });
    $$("[data-open-ss]", root).forEach(btn => {
        btn.addEventListener("click", () => {
            openSuperstarDetails(btn.dataset.openSs);
        });
    });
}

function renderTitleReignsCard() {
    const root = $("#titleReignsList");
    if (!root) return;
    // Show every current (active) championship reign — not just the top 5.
    const current = longestActiveReigns(999);
    if (!current.length) {
        root.innerHTML = `<div class="muted tiny">No active title reigns yet. Set a champion in Settings → Championships.</div>`;
        return;
    }
    root.innerHTML = `
        <div class="title-reigns-list">
            ${current.map(({ championshipId, reign, days }) => {
                const championship = state.championships.find(c => c.id === championshipId);
                if (!championship) return "";
                const holders = reign.holderIds.map(id => state.superstars.find(s => s.id === id)).filter(Boolean);
                const photos = holders.slice(0, 2).map(h => {
                    const photo = superstarPhotoURL(h);
                    return photo
                        ? `<img class="reign-photo" src="${escapeAttr(photo)}" alt="${escapeAttr(h.name)}" />`
                        : `<div class="reign-photo-fallback">${escapeHTML(superstarInitials(h.name))}</div>`;
                }).join("");
                // Fall back to stored snapshot names if a holder was deleted
                const names = holders.length
                    ? holders.map(h => h.name).join(" & ")
                    : (reign.holderNames || []).join(" & ");
                return `
                    <button type="button" class="reign-row" data-open-championship="${escapeAttr(championshipId)}">
                        <div class="reign-photos">${photos || `<div class="reign-photo-fallback">?</div>`}</div>
                        <div class="reign-body">
                            <div class="reign-name">${escapeHTML(names || "Vacant")}</div>
                            <div class="reign-belt muted tiny">${escapeHTML(championship.name)}</div>
                        </div>
                        <div class="reign-days">
                            <div class="reign-days-num">${days}</div>
                            <div class="reign-days-label">${days === 1 ? "day" : "days"}</div>
                        </div>
                    </button>
                `;
            }).join("")}
        </div>
    `;
    $$("[data-open-championship]", root).forEach(btn => {
        btn.addEventListener("click", () => openChampionshipHistoryModal(btn.dataset.openChampionship));
    });
}

// Editable reign history for a single championship. Opened from Settings →
// Championships → "View History". Lists every reign for that belt with
// Edit / Delete, plus an Add Reign button to insert historical reigns manually.
async function openChampionshipHistoryModal(championshipId) {
    const championship = state.championships.find(c => c.id === championshipId);
    if (!championship) return;

    const renderBody = () => {
        const reigns = (state.titleReigns || [])
            .filter(r => r.championshipId === championshipId)
            .slice()
            .sort((a, b) => String(b.startDate).localeCompare(String(a.startDate))); // newest first
        const rows = reigns.length
            ? reigns.map(reign => {
                const storedNames = (reign.holderNames && reign.holderNames.length)
                    ? reign.holderNames
                    : reign.holderIds.map(id => state.superstars.find(s => s.id === id)?.name).filter(Boolean);
                const holderNames = storedNames.join(" & ") || "Vacant";
                const days = reignDayLength(reign);
                const dateRange = reign.endDate
                    ? `${reign.startDate} → ${reign.endDate}`
                    : `${reign.startDate} → present`;
                return `
                    <div class="reign-history-row ${reign.endDate ? "" : "is-active"}">
                        <div class="reign-history-name">${escapeHTML(holderNames)}${reign.isInitial ? ` <span class="muted tiny">(start)</span>` : ""}${reign.endDate ? "" : ` <span class="reign-active-badge">ACTIVE</span>`}</div>
                        <div class="reign-history-meta muted tiny">${escapeHTML(dateRange)} • ${days} days</div>
                        <div class="reign-history-actions">
                            <button type="button" class="btn secondary tiny" data-edit-reign="${escapeAttr(reign.id)}">Edit</button>
                            <button type="button" class="btn danger tiny" data-delete-reign="${escapeAttr(reign.id)}">Delete</button>
                        </div>
                    </div>
                `;
            }).join("")
            : `<div class="muted tiny">No reigns recorded for this championship yet.</div>`;
        return `
            <div class="stack" style="gap:10px;">
                <div class="muted tiny">Full reign history for ${escapeHTML(championship.name)}. Newest first.</div>
                <div class="stack" style="gap:6px;">${rows}</div>
                <button type="button" class="btn secondary" id="addReignBtn">+ Add Reign</button>
            </div>
        `;
    };

    const reopen = () => {
        closeModal({ ok: false });
        setTimeout(() => openChampionshipHistoryModal(championshipId), 0);
    };

    const wireButtons = () => {
        const body = $("#modalBody");
        if (!body) return;
        $$("[data-edit-reign]", body).forEach(btn => {
            btn.addEventListener("click", async () => {
                await openEditReignModal(btn.dataset.editReign);
                reopen();
            });
        });
        $$("[data-delete-reign]", body).forEach(btn => {
            btn.addEventListener("click", () => {
                const reignId = btn.dataset.deleteReign;
                const reign = state.titleReigns.find(r => r.id === reignId);
                if (!reign) return;
                const names = (reign.holderNames || []).join(" & ") || "Vacant";
                if (!confirm(`Delete this reign?\n\n${names} (${reign.startDate} → ${reign.endDate || "present"})\n\nUse the undo toast immediately if this was a mistake.`)) return;
                const snapshot = snapshotState();
                state.titleReigns = state.titleReigns.filter(r => r.id !== reignId);
                if (!reign.endDate) {
                    reign.holderIds.forEach(holderId => {
                        const ss = state.superstars.find(s => s.id === holderId);
                        if (!ss) return;
                        const champs = parseChampionships(ss.championships).filter(cid => cid !== reign.championshipId);
                        ss.championships = champs;
                        ss.isChampion = champs.length > 0;
                    });
                }
                state.updatedAt = Date.now();
                saveSoon();
                offerUndo("Reign deleted.", snapshot);
                reopen();
            });
        });
        $("#addReignBtn", body)?.addEventListener("click", async () => {
            await openAddReignModal(championshipId);
            reopen();
        });
    };

    const modalPromise = openModal({
        title: `${championship.name} — History`,
        bodyHTML: renderBody(),
        okText: "Close",
        hideCancel: true,
    });
    wireButtons();
    await modalPromise;
}

// Add a new reign record manually (for filling in historical reigns).
async function openAddReignModal(championshipId) {
    const championship = state.championships.find(c => c.id === championshipId);
    if (!championship) return false;
    const eligible = state.superstars.slice().sort((a, b) => a.name.localeCompare(b.name));
    const holderOptions = eligible.map(ss => `
        <label class="row gap" style="align-items:center;">
            <input type="checkbox" class="add-reign-holder" value="${escapeAttr(ss.id)}"/>
            <span>${escapeHTML(ss.name)}</span>
        </label>
    `).join("");

    const bodyHTML = `
        <div class="stack">
            <div class="muted tiny">New reign for ${escapeHTML(championship.name)}</div>
            <label class="muted tiny">Start date</label>
            <input id="addReignStart" class="input" type="date" value="${escapeAttr(getUniverseCurrentISO())}" />
            <label class="reign-status-toggle">
                <input type="checkbox" id="addReignActive" checked />
                <span>Reign is ongoing (still champion)</span>
            </label>
            <div id="addReignEndWrap" class="stack" style="display:none;">
                <label class="muted tiny">End date</label>
                <input id="addReignEnd" class="input" type="date" />
            </div>
            <label class="muted tiny">Holder(s)</label>
            <div class="stack" style="gap:4px;max-height:240px;overflow:auto;padding:8px;background:rgba(0,0,0,.15);border-radius:8px;">
                ${holderOptions}
            </div>
        </div>
    `;
    const modalPromise = openModal({ title: "Add Reign", bodyHTML, okText: "Add" });
    (() => {
        const activeToggle = $("#addReignActive");
        const endWrap = $("#addReignEndWrap");
        const endInput = $("#addReignEnd");
        if (activeToggle && endWrap) {
            activeToggle.addEventListener("change", () => {
                const ongoing = activeToggle.checked;
                endWrap.style.display = ongoing ? "none" : "";
                if (!ongoing && endInput && !endInput.value) endInput.value = getUniverseCurrentISO();
            });
        }
    })();
    const result = await modalPromise;
    if (!result.ok) return false;

    const newStart = String($("#addReignStart")?.value || "").trim();
    const isOngoing = !!$("#addReignActive")?.checked;
    const newEnd = isOngoing ? "" : String($("#addReignEnd")?.value || "").trim();
    const holderIds = $$(".add-reign-holder:checked").map(el => el.value);

    if (!isISODate(newStart)) {
        showToast({ message: "Start date is required.", tone: "danger" });
        return false;
    }
    if (!isOngoing && !isISODate(newEnd)) {
        showToast({ message: "Pick an end date, or mark the reign as ongoing.", tone: "danger" });
        return false;
    }
    if (newEnd && newEnd < newStart) {
        showToast({ message: "End date must be on or after start date.", tone: "danger" });
        return false;
    }
    if (!holderIds.length) {
        showToast({ message: "Pick at least one holder.", tone: "danger" });
        return false;
    }

    const snapshot = snapshotState();
    // If this new reign is ongoing, close any other open reign for this belt
    if (isOngoing) {
        state.titleReigns
            .filter(r => r.championshipId === championshipId && !r.endDate)
            .forEach(r => { r.endDate = newStart; });
    }
    state.titleReigns.push({
        id: uid("rgn"),
        championshipId,
        holderIds: holderIds.slice(),
        holderNames: holderIds.map(id => state.superstars.find(s => s.id === id)?.name || "(unknown)"),
        startDate: newStart,
        endDate: newEnd || null,
        eventId: null,
        isInitial: false,
    });
    // If ongoing, sync the holders' championship field
    if (isOngoing) {
        state.superstars.forEach(ss => {
            const has = parseChampionships(ss.championships).includes(championshipId);
            const shouldHave = holderIds.includes(ss.id);
            if (has && !shouldHave) {
                ss.championships = parseChampionships(ss.championships).filter(cid => cid !== championshipId);
                ss.isChampion = (ss.championships || []).length > 0;
            } else if (!has && shouldHave) {
                ss.championships = [...new Set([...parseChampionships(ss.championships), championshipId])];
                ss.isChampion = true;
            }
        });
    }
    state.updatedAt = Date.now();
    saveSoon();
    offerUndo("Reign added.", snapshot);
    return true;
}

async function openChampionshipDetailsModal(championshipId) {
    const championship = state.championships.find(c => c.id === championshipId);
    if (!championship) return;
    const reigns = reignsForChampionship(championshipId).slice().reverse(); // newest first
    const totalReigns = reigns.length;
    const activeReign = reigns.find(r => !r.endDate);
    const longestReign = reigns.reduce((max, r) => {
        const days = reignDayLength(r);
        return (!max || days > max.days) ? { reign: r, days } : max;
    }, null);

    const reignRowsHTML = reigns.length
        ? reigns.map(reign => {
            const days = reignDayLength(reign);
            // Use stored holderNames so reigns survive wrestler deletion / show changes
            const storedNames = (reign.holderNames && reign.holderNames.length)
                ? reign.holderNames
                : reign.holderIds.map(id => state.superstars.find(s => s.id === id)?.name).filter(Boolean);
            const holderNames = storedNames.join(" & ") || "Vacant";
            const dateRange = reign.endDate
                ? `${reign.startDate} → ${reign.endDate}`
                : `${reign.startDate} → present`;
            return `
                <div class="reign-history-row ${reign.endDate ? "" : "is-active"}">
                    <div class="reign-history-name">${escapeHTML(holderNames)}${reign.isInitial ? ` <span class="muted tiny">(at universe start)</span>` : ""}</div>
                    <div class="reign-history-meta muted tiny">${escapeHTML(dateRange)} • ${days} days</div>
                    <div class="reign-history-actions">
                        <button type="button" class="btn secondary tiny" data-edit-reign="${escapeAttr(reign.id)}">Edit</button>
                        <button type="button" class="btn danger tiny" data-delete-reign="${escapeAttr(reign.id)}">Delete</button>
                    </div>
                </div>
            `;
        }).join("")
        : `<div class="muted tiny">No reigns recorded yet.</div>`;

    const bodyHTML = `
        <div class="stack">
            <div class="row gap wrap">
                <span class="badge">${escapeHTML(championshipScopeSummary(championship))}</span>
                <span class="badge">${totalReigns} reign${totalReigns === 1 ? "" : "s"}</span>
                ${longestReign ? `<span class="badge">Longest: ${longestReign.days} days</span>` : ""}
            </div>
            ${activeReign ? `
                <div class="card" style="padding:10px;">
                    <div class="muted tiny">Current holder</div>
                    <div class="item-title">${escapeHTML(((activeReign.holderNames && activeReign.holderNames.length) ? activeReign.holderNames : activeReign.holderIds.map(id => state.superstars.find(s => s.id === id)?.name).filter(Boolean)).join(" & ") || "Vacant")}</div>
                    <div class="muted tiny">Reign: ${reignDayLength(activeReign)} days (since ${activeReign.startDate})</div>
                </div>
            ` : `<div class="muted tiny">Title is currently vacant or has no recorded holder.</div>`}
            <div class="h3">Reign history</div>
            <div class="stack" style="gap:6px;">${reignRowsHTML}</div>
        </div>
    `;

    const modalPromise = openModal({
        title: championship.name,
        bodyHTML,
        okText: "Close",
        hideCancel: true,
    });

    // Wire up reign edit/delete buttons
    const body = $("#modalBody");
    if (body) {
        $$("[data-edit-reign]", body).forEach(btn => {
            btn.addEventListener("click", async () => {
                const reignId = btn.dataset.editReign;
                await openEditReignModal(reignId);
                // Re-open the championship details to show the updated list
                closeModal({ ok: false });
                setTimeout(() => openChampionshipDetailsModal(championshipId), 0);
            });
        });
        $$("[data-delete-reign]", body).forEach(btn => {
            btn.addEventListener("click", () => {
                const reignId = btn.dataset.deleteReign;
                const reign = state.titleReigns.find(r => r.id === reignId);
                if (!reign) return;
                const names = (reign.holderNames || []).join(" & ") || "Vacant";
                if (!confirm(`Delete this reign?\n\n${names} (${reign.startDate} → ${reign.endDate || "present"})\n\nThis cannot be undone via this dialog — use the undo toast immediately if needed.`)) return;
                const snapshot = snapshotState();
                state.titleReigns = state.titleReigns.filter(r => r.id !== reignId);
                // If we just deleted an active reign, also strip the championship from the holder
                if (!reign.endDate) {
                    reign.holderIds.forEach(holderId => {
                        const ss = state.superstars.find(s => s.id === holderId);
                        if (!ss) return;
                        const champs = parseChampionships(ss.championships).filter(cid => cid !== reign.championshipId);
                        ss.championships = champs;
                        ss.isChampion = champs.length > 0;
                    });
                }
                state.updatedAt = Date.now();
                saveSoon();
                offerUndo("Reign deleted.", snapshot);
                closeModal({ ok: false });
                setTimeout(() => openChampionshipDetailsModal(championshipId), 0);
            });
        });
    }

    await modalPromise;
}

// Edit a reign: change start date, end date, holder.
// Returns true if changes were saved, false on cancel.
async function openEditReignModal(reignId) {
    const reign = state.titleReigns.find(r => r.id === reignId);
    if (!reign) return false;
    const championship = state.championships.find(c => c.id === reign.championshipId);
    const eligibleHolders = state.superstars.slice().sort((a, b) => a.name.localeCompare(b.name));

    const holdersOptions = eligibleHolders.map(ss => `
        <label class="row gap" style="align-items:center;">
            <input type="checkbox" class="edit-reign-holder" value="${escapeAttr(ss.id)}" ${reign.holderIds.includes(ss.id) ? "checked" : ""}/>
            <span>${escapeHTML(ss.name)}</span>
        </label>
    `).join("");

    const bodyHTML = `
        <div class="stack">
            <div class="muted tiny">Editing reign for ${escapeHTML(championship?.name || "championship")}</div>
            <label class="muted tiny">Start date</label>
            <input id="editReignStart" class="input" type="date" value="${escapeAttr(reign.startDate || "")}" />

            <label class="reign-status-toggle">
                <input type="checkbox" id="editReignActive" ${reign.endDate ? "" : "checked"} />
                <span>Reign is ongoing (still champion)</span>
            </label>

            <div id="editReignEndWrap" class="stack" style="${reign.endDate ? "" : "display:none;"}">
                <label class="muted tiny">End date</label>
                <input id="editReignEnd" class="input" type="date" value="${escapeAttr(reign.endDate || "")}" />
            </div>

            <label class="muted tiny">Holder(s)</label>
            <div class="stack" style="gap:4px;max-height:240px;overflow:auto;padding:8px;background:rgba(0,0,0,.15);border-radius:8px;">
                ${holdersOptions}
            </div>
        </div>
    `;
    const modalPromise = openModal({
        title: "Edit Reign",
        bodyHTML,
        okText: "Save",
    });
    // openModal injects bodyHTML synchronously, so the elements exist now.
    (() => {
        const activeToggle = $("#editReignActive");
        const endWrap = $("#editReignEndWrap");
        const endInput = $("#editReignEnd");
        if (activeToggle && endWrap) {
            activeToggle.addEventListener("change", () => {
                const ongoing = activeToggle.checked;
                endWrap.style.display = ongoing ? "none" : "";
                if (!ongoing && endInput && !endInput.value) {
                    endInput.value = getUniverseCurrentISO();
                }
            });
        }
    })();
    const result = await modalPromise;
    if (!result.ok) return false;

    const startEl = $("#editReignStart");
    const activeEl = $("#editReignActive");
    const endEl = $("#editReignEnd");
    const newStart = String(startEl?.value || "").trim();
    const isOngoing = !!activeEl?.checked;
    const newEnd = isOngoing ? "" : String(endEl?.value || "").trim();
    const newHolderIds = $$(".edit-reign-holder:checked").map(el => el.value);

    if (!isISODate(newStart)) {
        showToast({ message: "Start date is required.", tone: "danger" });
        return false;
    }
    if (!isOngoing && !isISODate(newEnd)) {
        showToast({ message: "Pick an end date, or mark the reign as ongoing.", tone: "danger" });
        return false;
    }
    if (newEnd && !isISODate(newEnd)) {
        showToast({ message: "End date isn't valid.", tone: "danger" });
        return false;
    }
    if (newEnd && newEnd < newStart) {
        showToast({ message: "End date must be on or after start date.", tone: "danger" });
        return false;
    }
    if (!newHolderIds.length) {
        showToast({ message: "Pick at least one holder.", tone: "danger" });
        return false;
    }

    const snapshot = snapshotState();
    const wasActive = !reign.endDate;
    const target = state.titleReigns.find(r => r.id === reignId);
    if (!target) return false;
    target.startDate = newStart;
    target.endDate = newEnd || null;
    target.holderIds = newHolderIds.slice();
    target.holderNames = newHolderIds.map(id => state.superstars.find(s => s.id === id)?.name || "(unknown)");

    // If this reign is active, sync superstar.championships to match
    if (!target.endDate) {
        // Anyone who currently has this championship but isn't in the new holder list — remove
        state.superstars.forEach(ss => {
            const has = parseChampionships(ss.championships).includes(target.championshipId);
            const shouldHave = newHolderIds.includes(ss.id);
            if (has && !shouldHave) {
                ss.championships = parseChampionships(ss.championships).filter(cid => cid !== target.championshipId);
                ss.isChampion = (ss.championships || []).length > 0;
            } else if (!has && shouldHave) {
                ss.championships = [...new Set([...parseChampionships(ss.championships), target.championshipId])];
                ss.isChampion = true;
            }
        });
    } else if (wasActive && newEnd) {
        // Was active, now closed — remove championship from all holders
        target.holderIds.forEach(holderId => {
            const ss = state.superstars.find(s => s.id === holderId);
            if (!ss) return;
            ss.championships = parseChampionships(ss.championships).filter(cid => cid !== target.championshipId);
            ss.isChampion = (ss.championships || []).length > 0;
        });
    }

    state.updatedAt = Date.now();
    saveSoon();
    offerUndo("Reign updated.", snapshot);
    return true;
}

function renderDashboard() {
    renderTitleReignsCard();
    const tabsEl = $("#dashboardShowTabs");
    const el = $("#nextEvent");
    const rankingsEl = $("#weeklyRankings");
    const universeToday = getUniverseCurrentISO();
    const upcoming = nextUniverseEvent();

    if (tabsEl) {
        tabsEl.innerHTML = state.shows.length
            ? state.shows.map(show => `
                <button type="button" class="dashboard-show-tab" data-dashboard-show="${show.id}">
                  <span class="dashboard-show-tab-dot" style="background:${show.color}"></span>
                  <span>${escapeHTML(show.name)}</span>
                </button>
              `).join("")
            : `<div class="muted tiny">Add shows to see champion tabs here.</div>`;
        $$("[data-dashboard-show]", tabsEl).forEach(btn => {
            btn.addEventListener("click", () => openShowChampionsModal(btn.dataset.dashboardShow));
        });
    }

    if (!upcoming) {
        el.innerHTML = `<div class="muted">No upcoming events after universe day <b>${universeToday}</b>. Add one from Calendar or Settings.</div>`;
    } else {
        const matches = Array.isArray(upcoming.matches) ? upcoming.matches : [];
        const mainEvent = matches.length ? matches[matches.length - 1] : null;
        const mainEventParticipants = Array.isArray(mainEvent?.participants) ? mainEvent.participants.filter(Boolean) : [];
        const mainEventDisplayParticipants = mainEventParticipants.length >= 2
            ? mainEventParticipants
            : [mainEventParticipants[0] || "", ""];
        const mainEventIsMultiPreview = mainEventDisplayParticipants.length > 2;
        const hideVsForMatch = mainEventIsMultiPreview && !isTagTeamMatchType(mainEvent?.matchType);
        const mainEventType = String(mainEvent?.matchType || "").trim();
        const mainEventTitle = mainEventType || `Match ${mainEvent?.num ?? (matches.length || 1)}`;
        const mainEventChampionshipName = championshipName(String(mainEvent?.championshipId || "").trim());
        const mainEventTeams = inferMatchTeams(mainEvent?.matchType, mainEventDisplayParticipants, normalizedParticipantTeams(mainEvent));
        const mainEventUseTeamFormat = isTagTeamMatchType(mainEvent?.matchType) && mainEventTeams.length >= 2 && mainEventTeams.every(group => group.participants.length);
        const mainEventFighterHTML = (participantRef) => {
            const fighter = participantInfo(participantRef);
            const escortName = participantEscortName(mainEvent, participantRef);
            return `
              <div class="event-fighter">
                ${fighter.photo
                    ? `<img class="event-fighter-photo event-fighter-photo-main" src="${escapeAttr(fighter.photo)}" alt="${escapeAttr(fighter.name)}" />`
                    : `<div class="event-fighter-fallback event-fighter-photo-main">${fighter.name === "TBD" ? "?" : escapeHTML(superstarInitials(fighter.name))}</div>`
                }
                <div class="tiny event-fighter-name">${escapeHTML(fighter.name)}${fighter.isChampion ? ` <span class="event-champ">C</span>` : ``}</div>
                ${escortName ? `<div class="tiny muted event-fighter-with">With ${escapeHTML(escortName)}</div>` : ""}
              </div>
            `;
        };
        const teamBlockHTML = (label, participantRefs) => {
            const memberNames = participantRefs.map(ref => {
                const name = participantInfo(ref).name;
                const escortName = participantEscortName(mainEvent, ref);
                if (!name) return "";
                return escortName ? `${name} (With ${escortName})` : name;
            }).filter(Boolean);
            return `
              <div class="event-fighter event-team-block">
                <div class="event-fighter-fallback event-fighter-photo-main">${escapeHTML(teamNameInitial(label, "?"))}</div>
                <div class="tiny event-fighter-name">${label}</div>
                ${memberNames.length ? `<div class="tiny muted event-team-members">${escapeHTML(memberNames.join(", "))}</div>` : ""}
              </div>
            `;
        };
        const mainEventFightRowHTML = mainEventUseTeamFormat
            ? mainEventTeams.length > 2
                ? multiTeamFightHTML(
                    mainEventTeams,
                    (group) => teamBlockHTML(teamDisplayName(mainEvent, group.key, group.participants), group.participants),
                    "event-vs-main"
                )
                : mainEventTeams.map((group, idx) => {
                    const blockHTML = teamBlockHTML(teamDisplayName(mainEvent, group.key, group.participants), group.participants);
                    if (idx >= mainEventTeams.length - 1) return blockHTML;
                    return `${blockHTML}<div class="event-vs event-fight-separator event-vs-main">VS</div>`;
                }).join("")
            : mainEventDisplayParticipants.map((participantRef, idx) => {
                const fighterHTML = mainEventFighterHTML(participantRef);
                if (idx >= mainEventDisplayParticipants.length - 1) return fighterHTML;
                if (hideVsForMatch) return fighterHTML;
                return `${fighterHTML}<div class="event-vs event-fight-separator event-vs-main">VS</div>`;
            }).join("");
        const upcomingShowIds = eventShowIds(upcoming);
        const showBadges = upcomingShowIds.length
            ? upcomingShowIds.map(showId => `<span class="badge"><span class="dot" style="background:${showColor(showId)}"></span>${escapeHTML(showName(showId))}</span>`).join("")
            : `<span class="badge"><span class="dot" style="background:${showColor(upcoming.showId)}"></span>${escapeHTML(showName(upcoming.showId))}</span>`;
        const typeTag = upcoming.type === "ppv" ? "PLE" : "WEEKLY";
        el.innerHTML = `
      <div class="stack" style="gap:10px;">
        <div class="h2" style="margin:0;text-align:center;">${escapeHTML(upcoming.name || "(Unnamed Event)")}</div>
        <div class="row gap wrap" style="justify-content:center;">
          ${showBadges}
          <span class="badge">${typeTag}</span>
          <span class="badge">${upcoming.date}</span>
          <span class="badge">Rows: <b>${matches.length}</b></span>
        </div>
        ${mainEvent ? `
          <div class="event-match-list">
            <div class="event-match-card main-event-card ${mainEventChampionshipName ? "has-championship-badge" : ""}">
              ${mainEventChampionshipName ? `<div class="event-match-corner-title">${escapeHTML(mainEventChampionshipName)}</div>` : ""}
              <div class="event-main-label">Main Event</div>
              <div class="event-match-title">${escapeHTML(mainEventTitle)}</div>
              <div class="event-fight-row">
                ${mainEventFightRowHTML}
              </div>
            </div>
          </div>
        ` : `<div class="muted tiny" style="text-align:center;">No matches scheduled yet for this event.</div>`}
        <div class="item-actions" style="justify-content:center;">
          <button class="btn secondary" data-view-event="${upcoming.id}">View</button>
          <button class="btn" data-open-planner="${upcoming.id}">Open Planner</button>
        </div>
      </div>
    `;
        el.querySelector('[data-view-event]')?.addEventListener("click", () => openCalendarEventDetails(upcoming.id));
        el.querySelector('[data-open-planner]')?.addEventListener("click", () => openPlanner(upcoming.id));
    }

    if (!rankingsEl) return;
    if (!state.shows.length) {
        rankingsEl.innerHTML = `<div class="muted">Add shows to start weekly rankings.</div>`;
        return;
    }
    if (!state.superstars.length) {
        rankingsEl.innerHTML = `<div class="muted">Add superstars to generate rankings.</div>`;
        return;
    }

    const rankingsByShow = computeWeeklyRankings(3);
    rankingsEl.innerHTML = `
      <div class="rankings-shows">
        ${state.shows.map(show => {
            const rows = rankingsByShow.get(show.id) || [];
            return `
              <div class="rankings-show-card">
                <div class="item-title">
                  <span class="badge"><span class="dot" style="background:${show.color}"></span>${escapeHTML(show.name)}</span>
                </div>
                ${rows.length
                    ? `<div class="rankings-list">${rankingRowsHTML(rows, 1)}</div>`
                    : `<div class="muted tiny">No ranked superstars on this show yet.</div>`
                }
                <div class="item-actions">
                  <button class="btn secondary" data-show-more="${show.id}">Show More</button>
                </div>
              </div>
            `;
        }).join("")}
      </div>
    `;

    $$("[data-show-more]", rankingsEl).forEach(btn => {
        btn.addEventListener("click", () => openShowTopTenModal(btn.dataset.showMore));
    });
    $$("[data-open-ss]", rankingsEl).forEach(el => {
        const open = () => {
            el.blur();
            openSuperstarDetails(el.dataset.openSs, { readOnly: true, fromRankings: true });
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


// -------------------- ROSTER --------------------
async function deleteSuperstarFlow(id) {
    const ss = state.superstars.find(x => x.id === id);
    const ok = await openModal({
        title: "Delete superstar?",
        bodyHTML: `<div>Delete <b>${escapeHTML(ss?.name || "this superstar")}</b>?</div>`,
        okText: "Delete"
    });
    if (!ok.ok) return false;

    const snapshot = snapshotState();
    const ssName = ss?.name || "Superstar";
    state.superstars = state.superstars.filter(x => x.id !== id);
    state.rivalries = (Array.isArray(state.rivalries) ? state.rivalries : []).map(rivalry => ({
        ...rivalry,
        participantIds: (Array.isArray(rivalry?.participantIds) ? rivalry.participantIds : []).filter(participantId => participantId !== id),
    }));
    saveSoon();
    renderRoster();
    renderRivalries();
    renderPlannerEventSelect();
    offerUndo(`${ssName} deleted.`, snapshot);
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
    const availableChampionships = eligibleChampionshipsForShowIds(Array.from(selectedShows), { superstar: ss });
    const championshipOptions = availableChampionships.length
        ? availableChampionships.map(c => `
            <label class="edit-ss-check-item">
              <input class="editSSChampItem" type="checkbox" value="${c.id}" ${selectedChampionships.has(c.id) ? "checked" : ""} />
              <span>${escapeHTML(c.name)}</span>
            </label>
          `).join("")
        : `<div class="muted tiny">No championships available for the selected show(s).</div>`;

    const photo = superstarPhotoURL(ss);
    const bodyHTML = `
      <div class="stack edit-ss-form">
        <div class="edit-ss-header">
          ${photo
            ? `<img class="edit-ss-avatar" src="${escapeAttr(photo)}" alt="${escapeAttr(ss.name)}" />`
            : `<div class="edit-ss-avatar-fallback">${escapeHTML(superstarInitials(ss.name))}</div>`
        }
          <div class="muted tiny">Update profile details, shows, and titles.</div>
        </div>

        <div class="edit-ss-section">
          <label class="edit-ss-label" for="editSSName">Name</label>
          <input id="editSSName" class="input" value="${escapeAttr(ss.name)}" />
          <label class="edit-ss-label" for="editSSPhoto" style="margin-top:10px;">Photo URL</label>
          <input id="editSSPhoto" class="input" value="${escapeAttr(photo)}" placeholder="Photo URL (https://...)" />
          <div class="muted tiny" style="margin-top:8px;">To choose and crop a photo from your device, open Settings → Superstar Photos.</div>
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

      </div>
    `;

    const ok = await openModal({ title: "Edit Superstar", bodyHTML, okText: "Save" });
    if (!ok.ok) return false;

    const newName = $("#editSSName").value.trim();
    const newPhoto = $("#editSSPhoto").value.trim();
    const newShowIds = Array.from(new Set($$(".editSSShowItem:checked").map(el => el.value)));
    const newDiv = $("#editSSDiv").value;
    const allowedChampionshipIds = new Set(eligibleChampionshipsForShowIds(newShowIds, {
        superstar: {
            ...ss,
            showIds: newShowIds,
            showId: newShowIds[0] ?? null,
            division: newDiv,
        },
    }).map(c => c.id));
    const newChamps = $$(".editSSChampItem:checked")
        .map(el => el.value)
        .filter(championshipId => allowedChampionshipIds.has(championshipId));
    const newFaction = $("#editSSFaction").value.trim();
    const newManager = $("#editSSManager").value.trim();

    if (!newName) return false;

    // Snapshot championship holdings before applying the edit so we can detect
    // which championships changed for this superstar and update reigns.
    const oldChamps = new Set(parseChampionships(ss.championships));
    const newChampsSet = new Set(newChamps);

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
    } : x);

    // Reconcile reigns with the new holdings — only when there's a real change.
    const universeISO = getUniverseCurrentISO();
    const addedChamps = [...newChampsSet].filter(c => !oldChamps.has(c));
    const removedChamps = [...oldChamps].filter(c => !newChampsSet.has(c));
    for (const championshipId of addedChamps) {
        // Close any existing open reign for this championship
        const open = state.titleReigns.filter(r => r.championshipId === championshipId && !r.endDate);
        open.forEach(r => { r.endDate = universeISO; });
        // Open a new reign for this superstar starting today (universe current)
        state.titleReigns.push({
            id: uid("rgn"),
            championshipId,
            holderIds: [id],
            holderNames: [newName],
            startDate: universeISO,
            endDate: null,
            eventId: null,
            isInitial: false,
        });
    }
    for (const championshipId of removedChamps) {
        // Close their open reign for this championship if any
        const open = state.titleReigns
            .filter(r => r.championshipId === championshipId && !r.endDate && r.holderIds.includes(id));
        open.forEach(r => { r.endDate = universeISO; });
    }

    saveSoon();
    renderRoster();
    renderPlanner();
    return true;
}

// Renders the "Why this ranking" breakdown for the superstar info modal.
// Only shown when the modal is opened from the rankings table.
function renderRankingBreakdownSection(superstarId) {
    const info = rankingInfoForSuperstar(superstarId);
    if (!info) return "";
    const { rank, size, row } = info;
    // Aggregate breakdown entries by label, summing points
    const grouped = new Map();
    (row.breakdown || []).forEach(entry => {
        const cur = grouped.get(entry.label) || { label: entry.label, total: 0, count: 0 };
        cur.total += entry.points;
        cur.count += 1;
        grouped.set(entry.label, cur);
    });
    // Sort by absolute impact, biggest first
    const rows = Array.from(grouped.values())
        .map(g => ({ ...g, total: Math.round(g.total * 10) / 10 }))
        .filter(g => g.total !== 0)
        .sort((a, b) => Math.abs(b.total) - Math.abs(a.total));

    const ordinal = (n) => {
        const s = ["th", "st", "nd", "rd"];
        const v = n % 100;
        return n + (s[(v - 20) % 10] || s[v] || s[0]);
    };

    return `
      <div class="ranking-breakdown">
        <div class="ranking-breakdown-head">
          <div class="h3" style="margin:0;">Ranking Breakdown</div>
          <div class="ranking-breakdown-rank">${ordinal(rank)}<span class="muted tiny"> of ${size}</span></div>
        </div>
        <div class="ranking-breakdown-score muted tiny">Momentum score: <b>${row.score}</b> • ${row.wins}W ${row.losses}L${row.streak >= 2 ? ` • 🔥 ${row.streak}-match streak` : ""}</div>
        <div class="ranking-breakdown-list">
          ${rows.length
            ? rows.map(g => `
              <div class="ranking-breakdown-row">
                <span class="ranking-breakdown-label">${escapeHTML(g.label)}${g.count > 1 ? ` <span class="muted tiny">×${g.count}</span>` : ""}</span>
                <span class="ranking-breakdown-points ${g.total >= 0 ? "is-positive" : "is-negative"}">${g.total >= 0 ? "+" : ""}${g.total}</span>
              </div>
            `).join("")
            : `<div class="muted tiny">No scored activity yet — this wrestler is at the base score.</div>`
          }
        </div>
        <div class="muted tiny ranking-breakdown-note">Recent matches count for more — older results fade over time.</div>
      </div>
    `;
}

async function openSuperstarDetails(id, { readOnly = false, fromRankings = false } = {}) {
    const ss = state.superstars.find(x => x.id === id);
    if (!ss) return;
    const recordMap = computeSuperstarRecords();

    const isDisqualificationResult = (resultValue) => {
        const normalized = normalizeNameForCompare(resultValue);
        return normalized === "dq" || normalized.includes("disqualification");
    };
    const isDrawResult = (resultValue) => {
        const normalized = normalizeNameForCompare(resultValue);
        return normalized === "draw"
            || normalized === "tie"
            || normalized === "no contest"
            || normalized === "nc";
    };
    const isSpecialOutcomeResult = (resultValue) => {
        const normalized = normalizeNameForCompare(resultValue);
        return isDisqualificationResult(resultValue)
            || isDrawResult(resultValue)
            || normalized === "no result"
            || normalized === "promo";
    };
    const participantIdFromRef = (participantRef) => {
        const raw = String(participantRef ?? "").trim();
        if (!raw) return "";
        const byId = state.superstars.find(star => star.id === raw);
        if (byId) return byId.id;
        const byName = state.superstars.find(star => normalizeNameForCompare(star.name) === normalizeNameForCompare(raw));
        return byName?.id || "";
    };
    const participantRefMatchesSuperstar = (participantRef) => {
        const raw = String(participantRef ?? "").trim();
        if (!raw) return false;
        if (raw === ss.id) return true;
        const info = participantInfo(raw);
        return normalizeNameForCompare(info.name) === normalizeNameForCompare(ss.name);
    };
    const resultParticipantId = (resultValue) => {
        const raw = String(resultValue ?? "").trim();
        if (!raw || isTeamResultValue(raw)) return "";
        const byId = state.superstars.find(star => star.id === raw);
        if (byId) return byId.id;
        const normalizedRaw = normalizeNameForCompare(raw);
        const byName = state.superstars.find(star => normalizeNameForCompare(star.name) === normalizedRaw);
        return byName?.id || "";
    };
    const matchOutcomeForSuperstar = (match, participantRefs) => {
        const resultValue = String(match?.result ?? "").trim();
        if (isDisqualificationResult(resultValue)) return "DQ";
        if (isDrawResult(resultValue)) return "Draw";

        const participantIds = participantRefs
            .map(participantIdFromRef)
            .filter(Boolean);
        const selectedIds = participantRefs
            .filter(participantRefMatchesSuperstar)
            .map(participantIdFromRef)
            .filter(Boolean);
        const selectedIdSet = new Set(selectedIds);
        const selectedInMatch = selectedIdSet.size > 0 || participantRefs.some(participantRefMatchesSuperstar);
        if (!selectedInMatch) return "";

        if (!resultValue || normalizeNameForCompare(resultValue) === "no result") return "Draw";

        if (isTeamResultValue(resultValue)) {
            const teams = inferMatchTeams(match?.matchType, participantIds, normalizedParticipantTeams(match));
            const winningTeamKey = parseTeamResultValue(resultValue);
            const winningTeam = teams.find(group => group.key === winningTeamKey);
            const won = Boolean(winningTeam?.participants.some(pid => selectedIdSet.has(pid)));
            return won ? "Win" : "Loss";
        }

        const winnerId = resultParticipantId(resultValue);
        if (winnerId) return selectedIdSet.has(winnerId) ? "Win" : "Loss";
        if (isSpecialOutcomeResult(resultValue)) return "Draw";
        return "Loss";
    };

    const recentMatches = [];
    const eventsDesc = [...state.events].sort((a, b) => b.date.localeCompare(a.date));
    for (const ev of eventsDesc) {
        const matchesDesc = (Array.isArray(ev.matches) ? ev.matches : []).slice().reverse();
        for (const match of matchesDesc) {
            const participantRefs = matchParticipantRefs(match);
            const participants = participantRefs
                .map(ref => participantInfo(ref).name)
                .filter(Boolean);
            if (!participants.length) continue;

            const includesSelected = participantRefs.some(ref => {
                const raw = String(ref ?? "").trim();
                if (!raw) return false;
                if (raw === ss.id) return true;
                return normalizeNameForCompare(participantInfo(raw).name) === normalizeNameForCompare(ss.name);
            });
            if (!includesSelected) continue;
            if (isPromoResult(match?.result)) continue;

            // A match with no result ("(no winner yet)") hasn't happened yet —
            // don't show it in match history.
            const resultValue = String(match?.result ?? "").trim();
            if (!resultValue) continue;
            if (normalizeNameForCompare(resultValue) === "no result") continue;

            recentMatches.push({
                matchup: participants.join(" vs "),
                outcome: matchOutcomeForSuperstar(match, participantRefs) || "Draw",
            });
            if (recentMatches.length >= 5) break;
        }
        if (recentMatches.length >= 5) break;
    }

    const ssShows = superstarShowNames(ss);
    const champs = superstarChampionshipNames(ss);
    const titleText = champs.join(", ");
    const record = formatRecord(superstarRecordById(ss.id, recordMap));
    const photo = superstarPhotoURL(ss);
    const streak = superstarCurrentStreak(ss.id);
    const sparkPoints = superstarMomentumPoints(ss.id, 14);
    const sparkSVG = sparkPoints.length >= 2 ? sparklineSVG(sparkPoints, { width: 120, height: 28 }) : "";
    const ssReigns = reignsForSuperstar(ss.id);

    const bodyHTML = `
      <div class="stack">
        <div class="ss-profile-head">
          ${photo
            ? `<img class="ss-profile-photo" src="${escapeAttr(photo)}" alt="${escapeAttr(ss.name)}" />`
            : `<div class="ss-profile-fallback">${escapeHTML(superstarInitials(ss.name))}</div>`
        }
          <div class="stack" style="gap:6px;">
            <div class="h3" style="margin:0;">${escapeHTML(ss.name)}${ss.isChampion ? ` <span class="champ-inline">C</span>` : ``}</div>
            <div class="muted tiny">${escapeHTML(ssShows.join(", ") || "Unassigned")}${titleText ? ` • ${escapeHTML(titleText)}` : ``}</div>
          </div>
        </div>
        <div class="row gap wrap">
          <span class="badge">Record: <b>${record}</b></span>
          <span class="badge">Division: <b>${escapeHTML(ss.division)}</b></span>
          ${ss.faction ? `<span class="badge">Faction: <b>${escapeHTML(ss.faction)}</b></span>` : ""}
          ${ss.manager ? `<span class="badge">Manager: <b>${escapeHTML(ss.manager)}</b></span>` : ""}
          ${streak.kind && streak.count >= 2 ? `<span class="badge streak-badge streak-${streak.kind}">${streak.kind === "win" ? "🔥" : "❄"} ${streak.count} ${streak.kind === "win" ? "wins" : "losses"}</span>` : ""}
        </div>
        ${sparkSVG ? `
          <div class="ss-momentum">
            <div class="ss-momentum-head">
              <span class="muted tiny">Recent momentum</span>
              <span class="ss-momentum-detail muted tiny">Last ${sparkPoints.length} matches</span>
            </div>
            <div class="ss-momentum-spark">${sparkSVG}</div>
          </div>
        ` : ""}
        ${fromRankings ? renderRankingBreakdownSection(ss.id) : ""}
        ${ssReigns.length ? `
          <div class="ss-title-history">
            <button type="button" class="ss-title-history-toggle" id="ssTitleHistoryToggle" aria-expanded="false">
              <span>🏆 Title History (${ssReigns.length})</span>
              <span class="ss-title-history-chevron">▾</span>
            </button>
            <div class="ss-title-history-body hidden" id="ssTitleHistoryBody">
              ${ssReigns.slice().reverse().map(r => {
                const c = state.championships.find(x => x.id === r.championshipId);
                const beltName = c ? c.name : "(deleted championship)";
                const days = reignDayLength(r);
                const range = r.endDate ? `${r.startDate} → ${r.endDate}` : `${r.startDate} → present`;
                return `
                  <div class="ss-reign-row ${r.endDate ? "" : "is-active"}">
                    <div class="ss-reign-name">${escapeHTML(beltName)}${r.endDate ? "" : ' <span class="champ-inline">C</span>'}</div>
                    <div class="ss-reign-meta muted tiny">${escapeHTML(range)} • ${days} days</div>
                    <div class="ss-reign-actions">
                      <button type="button" class="btn secondary tiny" data-ss-edit-reign="${escapeAttr(r.id)}">Edit</button>
                      <button type="button" class="btn danger tiny" data-ss-delete-reign="${escapeAttr(r.id)}">Delete</button>
                    </div>
                  </div>
                `;
              }).join("")}
            </div>
          </div>
        ` : ""}
        <div class="ss-recent-matches">
          <div class="h3">Last 5 Matches</div>
          ${recentMatches.length
            ? `<div class="stack" style="gap:6px;">${recentMatches.map(match => `
                <div class="ss-recent-match-row">
                  <div class="item-sub">${escapeHTML(match.matchup)}</div>
                  <div class="ss-recent-result ${match.outcome === "Win" ? "ss-recent-result-win" : match.outcome === "Loss" ? "ss-recent-result-loss" : match.outcome === "Draw" ? "ss-recent-result-draw" : "ss-recent-result-dq"}">${escapeHTML(match.outcome)}</div>
                </div>
            `).join("")}</div>`
            : `<div class="item-sub">No recent matches</div>`
        }
        </div>
      </div>
    `;

    const modalPromise = openModal({ title: "Superstar Details", bodyHTML, okText: "Close", cancelText: "Close", hideCancel: true });

    const modalActions = $(".modal-actions");
    const modalOkBtn = $("#modalOk");

    // Title history collapse/expand toggle (works in both readOnly and editable modes)
    const wireTitleHistory = () => {
        const toggle = $("#ssTitleHistoryToggle");
        const body = $("#ssTitleHistoryBody");
        if (toggle && body) {
            toggle.addEventListener("click", () => {
                const isHidden = body.classList.toggle("hidden");
                toggle.setAttribute("aria-expanded", String(!isHidden));
                const chevron = toggle.querySelector(".ss-title-history-chevron");
                if (chevron) chevron.textContent = isHidden ? "▾" : "▴";
            });
        }
        // Reign edit/delete buttons inside the title history
        $$("[data-ss-edit-reign]").forEach(btn => {
            btn.addEventListener("click", async () => {
                await openEditReignModal(btn.dataset.ssEditReign);
                closeModal({ ok: false });
                setTimeout(() => openSuperstarDetails(id, { readOnly, fromRankings }), 0);
            });
        });
        $$("[data-ss-delete-reign]").forEach(btn => {
            btn.addEventListener("click", () => {
                const reignId = btn.dataset.ssDeleteReign;
                const reign = state.titleReigns.find(r => r.id === reignId);
                if (!reign) return;
                const names = (reign.holderNames || []).join(" & ") || "Vacant";
                if (!confirm(`Delete this reign?\n\n${names} (${reign.startDate} → ${reign.endDate || "present"})\n\nUse the undo toast immediately if this was a mistake.`)) return;
                const snapshot = snapshotState();
                state.titleReigns = state.titleReigns.filter(r => r.id !== reignId);
                if (!reign.endDate) {
                    reign.holderIds.forEach(holderId => {
                        const s = state.superstars.find(x => x.id === holderId);
                        if (!s) return;
                        const champs = parseChampionships(s.championships).filter(cid => cid !== reign.championshipId);
                        s.championships = champs;
                        s.isChampion = champs.length > 0;
                    });
                }
                state.updatedAt = Date.now();
                saveSoon();
                offerUndo("Reign deleted.", snapshot);
                closeModal({ ok: false });
                setTimeout(() => openSuperstarDetails(id, { readOnly, fromRankings }), 0);
            });
        });
    };
    wireTitleHistory();

    if (readOnly) {
        await modalPromise;
        return;
    }

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

    modalActions.insertBefore(footerEditBtn, modalOkBtn);
    modalActions.insertBefore(footerDeleteBtn, modalOkBtn);

    footerEditBtn.addEventListener("click", async () => {
        closeModal({ ok: false });
        await editSuperstarFlow(id);
        // Saved or cancelled, land back on the profile (like a native "Back").
        if (state.superstars.some(ss => ss.id === id)) await openSuperstarDetails(id);
    });
    footerDeleteBtn.addEventListener("click", async () => {
        closeModal({ ok: false });
        await deleteSuperstarFlow(id);
    });

    await modalPromise;
}

function renderRoster() {
    populateShowSelects();
    const recordMap = computeSuperstarRecords();

    const search = $("#rosterSearch").value.trim().toLowerCase();
    const showFilter = $("#rosterFilter").value || "all";
    const divisionFilter = $("#rosterDivisionFilter")?.value || "all";
    const statusFilter = $("#rosterStatusFilter")?.value || "all";

    const rows = state.superstars
        .filter(ss => showFilter === "all" ? true : superstarOnShow(ss, showFilter))
        .filter(ss => {
            if (divisionFilter === "all") return true;
            return normalizeSuperstarDivision(ss.division) === divisionFilter
                || (divisionFilter === "Other" && !["World", "Midcard", "Tag", "Women"].includes(normalizeSuperstarDivision(ss.division)));
        })
        .filter(ss => {
            if (statusFilter === "champions") return !!ss.isChampion;
            if (statusFilter === "non-champions") return !ss.isChampion;
            return true;
        })
        .filter(ss => !search ? true : ss.name.toLowerCase().includes(search))
        .sort((a, b) => a.name.localeCompare(b.name));

    const list = $("#rosterList");
    const count = $("#rosterCount");
    if (count) count.textContent = `${rows.length} of ${state.superstars.length}`;
    if (rows.length === 0) {
        list.innerHTML = `<div class="roster-empty muted">No superstars match your filters.</div>`;
        return;
    }

    list.innerHTML = `
    <div class="list roster-list">
      ${rows.map(ss => {
        const ssShows = superstarShowNames(ss);
        const record = formatRecord(superstarRecordById(ss.id, recordMap));
        const photo = superstarPhotoURL(ss);
        const streak = superstarCurrentStreak(ss.id);
        const streakBadge = streak.kind && streak.count >= 3
            ? `<span class="badge streak-badge streak-${streak.kind}">${streak.kind === "win" ? "🔥" : "❄"} ${streak.count} ${streak.kind === "win" ? "wins" : "losses"}</span>`
            : "";
        const sparkPoints = superstarMomentumPoints(ss.id, 10);
        const spark = sparkPoints.length >= 2 ? sparklineSVG(sparkPoints, { width: 64, height: 18 }) : "";
        return `
          <div class="item roster-item" data-open-ss="${ss.id}" role="button" tabindex="0" aria-label="Open ${escapeAttr(ss.name)} details">
            <div class="row gap roster-item-main">
              ${photo
                ? `<img class="ss-card-photo" src="${escapeAttr(photo)}" alt="${escapeAttr(ss.name)}" />`
                : `<div class="ss-card-fallback">${escapeHTML(superstarInitials(ss.name))}</div>`
            }
              <div class="roster-item-text">
                <div class="item-title">${escapeHTML(ss.name)}${ss.isChampion ? ` <span class="champ-inline">C</span>` : ``}</div>
                <div class="item-sub">${escapeHTML(ssShows.join(", ") || "Unassigned")} • ${escapeHTML(ss.division)} • ${record}</div>
                <div class="roster-item-meta">
                  ${streakBadge}
                  ${spark ? `<span class="roster-item-spark">${spark}</span>` : ""}
                </div>
              </div>
            </div>
          </div>
        `;
    }).join("")}
    </div>
  `;

}
// Roster rows are opened through one delegated listener (bound once).
(function bindRosterList() {
    const list = $("#rosterList");
    if (!list) return;
    const open = el => openSuperstarDetails(el.dataset.openSs);
    list.addEventListener("click", e => {
        const el = e.target.closest("[data-open-ss]");
        if (el) open(el);
    });
    list.addEventListener("keydown", e => {
        const el = e.target.closest("[data-open-ss]");
        if (el && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); open(el); }
    });
})();

function rivalryFormHTML(rivalry = {}) {
    const selectedShowIds = new Set(Array.isArray(rivalry?.showIds) ? rivalry.showIds : []);
    const selectedParticipantIds = new Set(Array.isArray(rivalry?.participantIds) ? rivalry.participantIds : []);
    const showOptions = state.shows.length
        ? state.shows.map(show => `
            <label class="edit-ss-check-item">
              <input class="rivalryShowItem" type="checkbox" value="${show.id}" ${selectedShowIds.has(show.id) ? "checked" : ""} />
              <span>${escapeHTML(show.name)}</span>
            </label>
          `).join("")
        : `<div class="muted tiny">No shows created yet.</div>`;
    const participantOptions = state.superstars.length
        ? state.superstars
            .slice()
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(ss => {
                const shows = superstarShowNames(ss).join(", ") || "Unassigned";
                const photo = superstarPhotoURL(ss);
                return `
                  <label class="edit-ss-check-item rivalry-participant-option">
                    <input class="rivalryParticipantItem" type="checkbox" value="${ss.id}" ${selectedParticipantIds.has(ss.id) ? "checked" : ""} />
                    ${photo
                        ? `<img class="rivalry-picker-photo" src="${escapeAttr(photo)}" alt="${escapeAttr(ss.name)}" />`
                        : `<span class="rivalry-picker-fallback">${escapeHTML(superstarInitials(ss.name))}</span>`
                    }
                    <span>
                      <b>${escapeHTML(ss.name)}</b>
                      <span class="muted tiny">${escapeHTML(shows)}</span>
                    </span>
                  </label>
                `;
            }).join("")
        : `<div class="muted tiny">Add superstars before creating rivalries.</div>`;
    const status = normalizeRivalryStatus(rivalry?.status);

    return `
      <div class="stack rivalry-form">
        <div class="edit-ss-section">
          <label class="edit-ss-label">People Feuding</label>
          <div class="edit-ss-check-grid rivalry-participant-grid">${participantOptions}</div>
        </div>

        <div class="grid2">
          <label>
            <span class="edit-ss-label">Status</span>
            <select id="rivalryStatusInput" class="input">
              ${RIVALRY_STATUS_OPTIONS.map(option => `<option value="${option}" ${option === status ? "selected" : ""}>${option}</option>`).join("")}
            </select>
          </label>
          <label>
            <span class="edit-ss-label">Start Date</span>
            <input id="rivalryStartDateInput" class="input" type="date" value="${escapeAttr(rivalry?.startDate || "")}" />
          </label>
        </div>

        <div class="edit-ss-section">
          <label class="edit-ss-label">Shows</label>
          <div class="edit-ss-check-grid">${showOptions}</div>
        </div>

        <label class="edit-ss-label" for="rivalrySummaryInput">Storyline</label>
        <textarea id="rivalrySummaryInput" class="input textarea" placeholder="Current story beat, motivation, or end goal">${escapeHTML(rivalry?.summary || "")}</textarea>

        <details class="rivalry-advanced" ${rivalry?.notes || rivalry?.endDate ? "open" : ""}>
          <summary>More details</summary>
          <div class="stack">
            <label>
              <span class="edit-ss-label">End Date</span>
              <input id="rivalryEndDateInput" class="input" type="date" value="${escapeAttr(rivalry?.endDate || "")}" />
            </label>
            <label class="edit-ss-label" for="rivalryNotesInput">Notes</label>
            <textarea id="rivalryNotesInput" class="input textarea" placeholder="Key beats, planned matches, promos, turns...">${escapeHTML(rivalry?.notes || "")}</textarea>
          </div>
        </details>
      </div>
    `;
}

async function openRivalryEditor(rivalryId = "", draft = null) {
    const existing = rivalryId ? state.rivalries.find(rivalry => rivalry.id === rivalryId) : null;
    const formRivalry = draft || existing || {};
    const modalResult = await openModal({
        title: existing ? "Edit Rivalry" : "Add Rivalry",
        bodyHTML: rivalryFormHTML(formRivalry),
        okText: existing ? "Save Rivalry" : "Add Rivalry",
    });
    if (!modalResult?.ok) return false;

    const participantIds = Array.from(new Set($$(".rivalryParticipantItem:checked").map(el => el.value)));
    const showIds = Array.from(new Set($$(".rivalryShowItem:checked").map(el => el.value)));
    const draftRivalry = {
        title: "",
        showIds,
        participantIds,
        status: normalizeRivalryStatus($("#rivalryStatusInput")?.value),
        startDate: $("#rivalryStartDateInput")?.value || "",
        endDate: $("#rivalryEndDateInput")?.value || "",
        summary: $("#rivalrySummaryInput")?.value.trim() || "",
        notes: $("#rivalryNotesInput")?.value.trim() || "",
    };
    if (participantIds.length < 2) {
        await openModal({
            title: "Pick at least two people",
            bodyHTML: `<div class="muted">A rivalry needs at least two selected superstars.</div>`,
            okText: "OK",
            cancelText: "Close",
        });
        return openRivalryEditor(rivalryId, draftRivalry);
    }

    const nextRivalry = {
        id: existing?.id || uid("riv"),
        title: participantIds.map(id => state.superstars.find(ss => ss.id === id)?.name).filter(Boolean).join(" vs "),
        showIds,
        showId: showIds[0] ?? null,
        participantIds,
        status: draftRivalry.status,
        startDate: isISODate(draftRivalry.startDate) ? draftRivalry.startDate : "",
        endDate: isISODate(draftRivalry.endDate) ? draftRivalry.endDate : "",
        summary: draftRivalry.summary,
        notes: draftRivalry.notes,
    };

    if (existing) {
        state.rivalries = state.rivalries.map(rivalry => rivalry.id === existing.id ? nextRivalry : rivalry);
    } else {
        state.rivalries.push(nextRivalry);
    }
    saveSoon();
    renderRivalries();
    return true;
}

async function deleteRivalryFlow(rivalryId) {
    const rivalry = state.rivalries.find(row => row.id === rivalryId);
    if (!rivalry) return;
    const result = await openModal({
        title: "Delete rivalry?",
        bodyHTML: `<div>Delete <b>${escapeHTML(rivalry.title)}</b>?</div>`,
        okText: "Delete",
    });
    if (!result?.ok) return;
    const snapshot = snapshotState();
    state.rivalries = state.rivalries.filter(row => row.id !== rivalryId);
    saveSoon();
    renderRivalries();
    offerUndo(`${rivalryDisplayTitle(rivalry)} deleted.`, snapshot);
}

function renderRivalries() {
    populateShowSelects();

    const list = $("#rivalriesList");
    if (!list) return;

    const inSettingsPanel = Boolean($("#settingsRivalriesPanel"));
    const deletingId = inSettingsPanel ? settingsUiState.rivalries.deletingId : null;
    const search = ($("#rivalrySearch")?.value || "").trim().toLowerCase();
    const showFilter = $("#rivalryShowFilter")?.value || "all";
    const statusFilter = $("#rivalryStatusFilter")?.value || "all";

    const rows = (Array.isArray(state.rivalries) ? state.rivalries : [])
        .filter(rivalry => {
            if (showFilter === "all") return true;
            const ids = Array.isArray(rivalry?.showIds) ? rivalry.showIds : [];
            return !ids.length || ids.includes(showFilter);
        })
        .filter(rivalry => statusFilter === "all" ? true : normalizeRivalryStatus(rivalry.status) === statusFilter)
        .filter(rivalry => {
            if (!search) return true;
            const haystack = [
                rivalryDisplayTitle(rivalry),
                rivalry.summary,
                rivalry.notes,
                normalizeRivalryStatus(rivalry.status),
                ...rivalryShowNames(rivalry),
                ...rivalryParticipantNames(rivalry),
            ].join(" ").toLowerCase();
            return haystack.includes(search);
        })
        .sort((a, b) => {
            const statusOrder = { "Active": 0, "Heating Up": 1, "Blowoff Ready": 2, "Paused": 3, "Ended": 4 };
            const statusDelta = (statusOrder[normalizeRivalryStatus(a.status)] ?? 9) - (statusOrder[normalizeRivalryStatus(b.status)] ?? 9);
            if (statusDelta !== 0) return statusDelta;
            return String(b.startDate || "").localeCompare(String(a.startDate || ""));
        });

    if (!rows.length) {
        list.innerHTML = `
          <div class="rivalry-empty-state">
            <div class="rivalry-empty-title">No rivalries match your filters.</div>
            <div class="muted tiny">Change the filters or add a rivalry from the button above.</div>
          </div>
        `;
        return;
    }

    list.innerHTML = `
      <div class="rivalry-list-head">
        <span>${rows.length} ${rows.length === 1 ? "rivalry" : "rivalries"}</span>
        <span class="muted tiny">Sorted by status and start date</span>
      </div>
      <div class="list rivalry-list">
        ${rows.map(rivalry => {
            const shows = rivalryShowNames(rivalry);
            const participants = rivalryParticipants(rivalry);
            const dateRange = [rivalry.startDate, rivalry.endDate].filter(Boolean).join(" to ");
            return `
              <div class="item rivalry-item">
                <div class="rivalry-card-head">
                  <div class="rivalry-render-row">
                    ${participants.length
                        ? participants.map(ss => {
                            const photo = superstarPhotoURL(ss);
                            return `
                              <div class="rivalry-render">
                                ${photo
                                    ? `<img class="rivalry-render-photo" src="${escapeAttr(photo)}" alt="${escapeAttr(ss.name)}" />`
                                    : `<div class="rivalry-render-fallback">${escapeHTML(superstarInitials(ss.name))}</div>`
                                }
                                <div class="rivalry-render-name">${escapeHTML(ss.name)}</div>
                              </div>
                            `;
                        }).join(`<div class="rivalry-vs">VS</div>`)
                        : `<div class="muted tiny">No participants selected</div>`
                    }
                  </div>
                  <span class="rivalry-status rivalry-status-${escapeAttr(normalizeRivalryStatus(rivalry.status).toLowerCase().replaceAll(" ", "-"))}">${escapeHTML(normalizeRivalryStatus(rivalry.status))}</span>
                </div>
                <div class="item-title rivalry-title">${escapeHTML(rivalryDisplayTitle(rivalry))}</div>
                <div class="row gap wrap rivalry-meta">
                  ${shows.length ? shows.map(name => `<span class="badge">${escapeHTML(name)}</span>`).join("") : `<span class="badge">All shows</span>`}
                  ${dateRange ? `<span class="badge">${escapeHTML(dateRange)}</span>` : ""}
                </div>
                ${rivalry.summary ? `<div class="rivalry-story">${escapeHTML(rivalry.summary).replace(/\n/g, "<br>")}</div>` : ""}
                ${rivalry.notes ? `<div class="rivalry-notes">${escapeHTML(rivalry.notes).replace(/\n/g, "<br>")}</div>` : ""}
                ${(() => {
                    const timeline = matchesForRivalry(rivalry);
                    if (!timeline.length) return "";
                    const score = (() => {
                        const wins = new Map();
                        timeline.forEach(t => {
                            if (!t.winnerLabel || t.winnerLabel === "Draw" || t.winnerLabel === "DQ") return;
                            wins.set(t.winnerLabel, (wins.get(t.winnerLabel) || 0) + 1);
                        });
                        const arr = [...wins.entries()];
                        if (!arr.length) return "";
                        return arr.map(([n, w]) => `${n}: ${w}`).join(" • ");
                    })();
                    return `
                        <div class="rivalry-timeline">
                            <div class="rivalry-timeline-head">
                                <span class="rivalry-timeline-title">Series so far</span>
                                ${score ? `<span class="rivalry-timeline-score">${escapeHTML(score)}</span>` : ""}
                            </div>
                            <ol class="rivalry-timeline-list">
                                ${timeline.slice(-5).map(t => `
                                    <li class="rivalry-timeline-row" data-open-event-detail="${escapeAttr(t.eventId)}">
                                        <span class="rivalry-timeline-date">${escapeHTML(t.date)}</span>
                                        <span class="rivalry-timeline-winner">${t.isPromo ? "Promo" : (t.winnerLabel ? `Winner: ${escapeHTML(t.winnerLabel)}` : "TBD")}</span>
                                        <span class="rivalry-timeline-event muted tiny">${escapeHTML(t.eventName || "")}</span>
                                    </li>
                                `).join("")}
                            </ol>
                        </div>
                    `;
                })()}
                <div class="item-actions rivalry-actions">
                  <button class="btn secondary" data-edit-rivalry="${rivalry.id}">Edit</button>
                  <button class="btn danger" data-delete-rivalry="${rivalry.id}">${deletingId === rivalry.id ? "Cancel Delete" : "Delete"}</button>
                </div>
                ${deletingId === rivalry.id ? `
                  <div class="settings-confirm-row">
                    <div class="muted tiny">Delete ${escapeHTML(rivalryDisplayTitle(rivalry))}?</div>
                    <div class="row gap wrap">
                      <button class="btn danger" data-confirm-delete-rivalry="${rivalry.id}">Confirm Delete</button>
                      <button class="btn secondary" data-cancel-delete-rivalry="${rivalry.id}">Keep Rivalry</button>
                    </div>
                  </div>
                ` : ""}
              </div>
            `;
        }).join("")}
      </div>
    `;

    $$("[data-edit-rivalry]", list).forEach(btn => {
        btn.addEventListener("click", () => {
            if ($("#settingsRivalriesPanel")) {
                settingsUiState.rivalries.message = null;
                settingsUiState.rivalries.adding = false;
                settingsUiState.rivalries.editingId = btn.dataset.editRivalry;
                settingsUiState.rivalries.deletingId = null;
                settingsUiState.rivalries.draft = null;
                renderRivalriesSettingsPanel();
                return;
            }
            openRivalryEditor(btn.dataset.editRivalry);
        });
    });
    $$("[data-delete-rivalry]", list).forEach(btn => {
        btn.addEventListener("click", () => {
            if ($("#settingsRivalriesPanel")) {
                const id = btn.dataset.deleteRivalry;
                settingsUiState.rivalries.message = null;
                settingsUiState.rivalries.adding = false;
                settingsUiState.rivalries.editingId = null;
                settingsUiState.rivalries.deletingId = settingsUiState.rivalries.deletingId === id ? null : id;
                settingsUiState.rivalries.draft = null;
                renderRivalriesSettingsPanel();
                return;
            }
            deleteRivalryFlow(btn.dataset.deleteRivalry);
        });
    });
    $$("[data-confirm-delete-rivalry]", list).forEach(btn => {
        btn.addEventListener("click", () => {
            const rivalry = state.rivalries.find(row => row.id === btn.dataset.confirmDeleteRivalry);
            if (!rivalry) return;
            state.rivalries = state.rivalries.filter(row => row.id !== rivalry.id);
            settingsUiState.rivalries.message = { tone: "success", text: `${rivalryDisplayTitle(rivalry)} deleted.` };
            settingsUiState.rivalries.adding = false;
            settingsUiState.rivalries.editingId = null;
            settingsUiState.rivalries.deletingId = null;
            settingsUiState.rivalries.draft = null;
            saveSoon();
            renderRivalriesSettingsPanel();
        });
    });
    $$("[data-cancel-delete-rivalry]", list).forEach(btn => {
        btn.addEventListener("click", () => {
            settingsUiState.rivalries.deletingId = null;
            renderRivalriesSettingsPanel();
        });
    });
    $$("[data-open-event-detail]", list).forEach(el => {
        el.addEventListener("click", (e) => {
            e.stopPropagation();
            openCalendarEventDetails(el.dataset.openEventDetail);
        });
    });
}

async function openAddSuperstarFlow(draft = null) {
    const nextDraft = {
        name: String(draft?.name ?? "").trim(),
        photo: String(draft?.photo ?? "").trim(),
        division: String(draft?.division ?? "World").trim() || "World",
        error: String(draft?.error ?? "").trim(),
    };

    const bodyHTML = `
      <div class="stack roster-add-form">
        ${nextDraft.error ? `<div class="settings-status danger">${escapeHTML(nextDraft.error)}</div>` : ""}
        <input id="ssName" class="input" placeholder="Superstar name" value="${escapeAttr(nextDraft.name)}" />
        <input id="ssPhoto" class="input" placeholder="Photo URL (optional)" value="${escapeAttr(nextDraft.photo)}" />
        <div id="ssShows" class="show-tag-picker" aria-label="Assign one or more shows"></div>
        <select id="ssDivision" class="input">
          ${["World", "Midcard", "Tag", "Women", "Other"].map(div => `<option value="${div}" ${div === nextDraft.division ? "selected" : ""}>${div}</option>`).join("")}
        </select>
      </div>
    `;

    const modalPromise = openModal({
        title: "Add Superstar",
        bodyHTML,
        okText: "Add Superstar",
        cancelText: "Cancel",
    });

    populateShowSelects();
    $("#ssName")?.focus();

    const result = await modalPromise;
    if (!result?.ok) {
        addSuperstarShowIds = new Set();
        return false;
    }

    const name = $("#ssName")?.value.trim() || "";
    const photo = $("#ssPhoto")?.value.trim() || "";
    const showIds = Array.from(addSuperstarShowIds);
    const division = $("#ssDivision")?.value || "World";

    if (!name) {
        return openAddSuperstarFlow({
            name,
            photo,
            division,
            error: "Enter a superstar name before saving.",
        });
    }

    state.superstars.push(enrichSuperstar({
        id: uid("ss"),
        name,
        photo,
        showIds,
        showId: showIds[0] ?? null,
        division,
    }));
    saveSoon();
    addSuperstarShowIds = new Set();
    populateShowSelects();
    renderRoster();
    return true;
}

// -------------------- CALENDAR --------------------
let calSelectedISO = getUniverseCurrentISO();
let calCursor = new Date(parseISO(calSelectedISO).getFullYear(), parseISO(calSelectedISO).getMonth(), 1);

function calendarEventsByDate(showFilter) {
    return memo(`calEvents:${showFilter}`, [state.events, dataVersion], () => {
        const map = new Map();
        state.events.forEach(e => {
            if (showFilter !== "all" && !eventHasShow(e, showFilter)) return;
            if (!map.has(e.date)) map.set(e.date, []);
            map.get(e.date).push(e);
        });
        return map;
    });
}

function renderCalendar() {
    populateShowSelects();
    if (!isUniverseCalendarDay(calSelectedISO)) calSelectedISO = firstUniverseDayOnOrAfter(calSelectedISO);
    $("#calendarTitle").textContent = formatMonthTitle(calCursor);
    const startISO = getUniverseStartISO();
    const universeCurrentISO = getUniverseCurrentISO();
    const doneDates = completedDateSet();
    const startInput = $("#calUniverseStartDate");
    if (startInput && startInput.value !== startISO) startInput.value = startISO;

    const showFilter = $("#calShowFilter").value || "all";
    const byDate = calendarEventsByDate(showFilter);

    const cells = [];
    for (let day = 1; day <= CALENDAR_DAYS_PER_MONTH; day++) {
        const d = new Date(calCursor.getFullYear(), calCursor.getMonth(), day);
        const iso = toISODateLocal(d);
        const done = doneDates.has(iso);
        const events = byDate.get(iso) || [];
        const visibleEvents = events.slice(0, 2);
        const badges = visibleEvents.map(e => {
            const shortType = e.type === "ppv" ? "PLE" : "WK";
            const color = showColor(eventShowIds(e)[0] || e.showId);
            const pillStyle = done
                ? "background:rgba(159,159,170,.18);color:#c8c8d3;border-color:rgba(159,159,170,.32);"
                : e.type === "ppv"
                    ? "background:#ffffff;color:#111111;border-color:#ffffff;"
                    : `background:${color};color:#ffffff;border-color:${color};`;
            return `<span class="cal-pill" style="${pillStyle}">${shortType}</span>`;
        }).join("");
        const overflow = events.length > visibleEvents.length
            ? `<span class="cal-more">+${events.length - visibleEvents.length}</span>`
            : "";
        const isStart = iso === startISO;
        const isNow = iso === universeCurrentISO;
        const cellClasses = [
            "cal-cell",
            done ? "is-done" : "",
            iso === calSelectedISO ? "is-selected" : "",
            isNow ? "is-universe-now" : "",
            events.length ? "has-events" : "",
        ].filter(Boolean).join(" ");
        const label = `${parseISO(iso).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}${events.length ? `, ${events.length} event${events.length === 1 ? "" : "s"}` : ""}${done ? ", done" : ""}${isNow ? ", today in universe" : ""}`;
        cells.push(`
      <button type="button" class="${cellClasses}" data-date="${iso}" aria-label="${escapeAttr(label)}"${iso === calSelectedISO ? ' aria-pressed="true"' : ""}>
        <span class="cal-date"><span class="cal-num">${day}</span>${isNow ? `<span class="cal-day-state">NOW</span>` : isStart ? `<span class="cal-day-state">START</span>` : ``}</span>
        <span class="cal-badges">${badges}${overflow}</span>
      </button>
    `);
    }

    $("#calendarGrid").innerHTML = cells.join("");
    renderEventsOnSelectedDate();
}

// Selecting a day only moves the highlight — no full calendar redraw.
function selectCalendarDay(iso) {
    if (!isISODate(iso)) return;
    calSelectedISO = iso;
    $$("#calendarGrid .cal-cell").forEach(cell => {
        const selected = cell.dataset.date === iso;
        cell.classList.toggle("is-selected", selected);
        if (selected) cell.setAttribute("aria-pressed", "true");
        else cell.removeAttribute("aria-pressed");
    });
    renderEventsOnSelectedDate();
}

function renderEventsOnSelectedDate() {
    const showFilter = $("#calShowFilter").value || "all";
    const list = $("#eventsList");
    const dayDone = isUniverseDateCompleted(calSelectedISO);
    const title = $("#calSelectedTitle");
    if (title) title.textContent = prettyUniverseDate(calSelectedISO) || "Selected day";
    const toggleDoneBtn = $("#calToggleDone");
    if (toggleDoneBtn) toggleDoneBtn.textContent = dayDone ? "Unmark Done" : "Mark Done";
    const status = $("#calSelectedStatus");
    if (status) {
        const isNow = calSelectedISO === getUniverseCurrentISO();
        status.textContent = dayDone ? "Done" : isNow ? "Today" : (calSelectedISO < getUniverseCurrentISO() ? "Skipped" : "Upcoming");
        status.dataset.state = dayDone ? "done" : isNow ? "now" : "upcoming";
    }

    const events = calendarEventsByDate(showFilter).get(calSelectedISO) || [];
    if (events.length === 0) {
        list.innerHTML = `<div class="cal-empty muted">No events on this day.</div>`;
        return;
    }

    list.innerHTML = `
    <div class="list">
      ${events.map(e => {
        const ids = eventShowIds(e);
        const showBadges = ids.length
            ? ids.map(id => `<span class="badge"><span class="dot" style="background:${showColor(id)}"></span>${escapeHTML(showName(id))}</span>`).join("")
            : `<span class="badge">No show</span>`;
        const matches = Array.isArray(e.matches) ? e.matches : [];
        const booked = matches.filter(m => matchParticipantRefs(m).length).length;
        return `
          <button type="button" class="item cal-event-item" data-open-event="${escapeAttr(e.id)}">
            <span class="cal-event-copy">
              <span class="item-title">${escapeHTML(e.name || "(Unnamed Event)")}</span>
              <span class="row gap wrap">
                ${showBadges}
                <span class="badge">${e.type === "ppv" ? "PLE" : "Weekly"}</span>
                <span class="badge">${booked}/${matches.length} booked</span>
              </span>
            </span>
            <span class="cal-event-chevron" aria-hidden="true">›</span>
          </button>
        `;
    }).join("")}
    </div>
  `;
}

function participantInfo(participantRef) {
    const ref = String(participantRef ?? "").trim();
    if (!ref) {
        return { name: "TBD", photo: "", isChampion: false };
    }
    const superstar = resolveSuperstarFromRef(ref);
    if (superstar) {
        return {
            name: superstar.name || "TBD",
            photo: superstarPhotoURL(superstar),
            isChampion: !!superstar.isChampion,
        };
    }
    return { name: ref || "TBD", photo: "", isChampion: false };
}

async function editPleDetailsFlow(eventId) {
    const ev = getEvent(eventId);
    if (!ev || ev.type !== "ppv") return false;

    const selectedShowIds = new Set(eventShowIds(ev));
    const bodyHTML = `
      <div class="stack">
        <label class="muted tiny" for="editPleName">PLE Name</label>
        <input id="editPleName" class="input" value="${escapeAttr(ev.name || "")}" placeholder="Event name" />
        <label class="muted tiny" for="editPleDate">Date</label>
        <input id="editPleDate" class="input" type="date" value="${escapeAttr(ev.date || "")}" />
        <div class="muted tiny">Host Shows</div>
        <div id="editPleShows" class="show-tag-picker"></div>
      </div>
    `;

    const modalPromise = openModal({ title: "Edit PLE", bodyHTML, okText: "Save" });
    const showsEl = $("#editPleShows");
    const renderShowPicker = () => {
        if (!showsEl) return;
        if (!state.shows.length) {
            showsEl.innerHTML = `<div class="muted tiny">No shows created yet.</div>`;
            return;
        }
        showsEl.innerHTML = state.shows.map(s => {
            const active = selectedShowIds.has(s.id);
            const bg = active ? `${s.color}33` : "rgba(255,255,255,.03)";
            const border = active ? s.color : "var(--line)";
            return `
              <button type="button" class="show-tag-btn ${active ? "active" : ""}" data-edit-ple-show="${s.id}"
                style="border-color:${border};background:${bg};">
                <span class="dot" style="background:${s.color}"></span>
                <span>${escapeHTML(s.name)}</span>
              </button>
            `;
        }).join("");
        $$("[data-edit-ple-show]", showsEl).forEach(btn => {
            btn.addEventListener("click", () => {
                const showId = btn.dataset.editPleShow;
                if (!showId) return;
                if (selectedShowIds.has(showId)) selectedShowIds.delete(showId);
                else selectedShowIds.add(showId);
                renderShowPicker();
            });
        });
    };

    renderShowPicker();
    const ok = await modalPromise;
    if (!ok.ok) return false;

    const nextName = $("#editPleName").value.trim() || "PLE / PPV";
    const nextDate = $("#editPleDate").value;
    if (!isUniverseCalendarDay(nextDate)) {
        showToast({ message: "Pick a valid day from 1 to 28 for this PLE.", tone: "danger" });
        return false;
    }

    const showIds = Array.from(selectedShowIds);
    upsertEvent({
        ...ev,
        type: "ppv",
        name: nextName,
        date: nextDate,
        showIds,
        showId: showIds[0] ?? null,
    });

    calSelectedISO = nextDate;
    calCursor = parseISO(nextDate);
    calCursor.setDate(1);
    calCursor.setHours(0, 0, 0, 0);
    renderAll();
    return true;
}

async function openCalendarEventDetails(eventId, { fromCalendar = false } = {}) {
    const ev = getEvent(eventId);
    if (!ev) return;

    const showIds = eventShowIds(ev);
    const showBadges = showIds.length
        ? showIds.map(showId => `<span class="badge"><span class="dot" style="background:${showColor(showId)}"></span>${escapeHTML(showName(showId))}</span>`).join("")
        : `<span class="badge"><span class="dot" style="background:${showColor(ev.showId)}"></span>${escapeHTML(showName(ev.showId))}</span>`;
    const matches = Array.isArray(ev.matches) ? ev.matches : [];
    const orderedMatches = matches.map((m, idx) => ({ ...m, _idx: idx })).reverse();

    const matchesHTML = orderedMatches.length
        ? orderedMatches.map((m, renderIdx) => {
            const isMainEvent = renderIdx === 0;
            const participants = matchParticipantRefs(m);
            const displayParticipants = participants.length >= 2
                ? participants
                : [participants[0] || "", ""];
            const hideVsForMatch = displayParticipants.length > 2 && !isTagTeamMatchType(m?.matchType);
            const matchTeams = inferMatchTeams(m?.matchType, displayParticipants, normalizedParticipantTeams(m));
            const useTeamFormat = isTagTeamMatchType(m?.matchType) && matchTeams.length >= 2 && matchTeams.every(group => group.participants.length);
            const championshipOnTheLine = championshipName(String(m?.championshipId || "").trim());
            const title = m.matchType?.trim() || `Match ${m.num ?? (m._idx + 1)}`;
            const winnerRef = String(m.result ?? "").trim();
            const isPromo = normalizeNameForCompare(winnerRef) === "promo";
            const winningTeamKey = parseTeamResultValue(winnerRef);
            const winnerName = winningTeamKey
                ? teamResultLabel(m, winningTeamKey, matchTeams.find(group => group.key === winningTeamKey)?.participants || [])
                : superstarNameById(winnerRef);
            const pinByName = superstarNameById(String(m.pinBy ?? "").trim());
            const resultText = isPromo ? "" : (winnerName || winnerRef);
            const pinText = pinByName ? ` • Pin by: ${pinByName}` : "";
            const fighterBlockHTML = (participantRef) => {
                const fighter = participantInfo(participantRef);
                const escortName = participantEscortName(m, participantRef);
                return `
                  <div class="event-fighter">
                    ${fighter.photo
                        ? `<img class="event-fighter-photo ${isMainEvent ? "event-fighter-photo-main" : ""}" src="${escapeAttr(fighter.photo)}" alt="${escapeAttr(fighter.name)}" />`
                        : `<div class="event-fighter-fallback ${isMainEvent ? "event-fighter-photo-main" : ""}">${fighter.name === "TBD" ? "?" : escapeHTML(superstarInitials(fighter.name))}</div>`
                    }
                    <div class="tiny event-fighter-name">${escapeHTML(fighter.name)}${fighter.isChampion ? ` <span class="event-champ">C</span>` : ``}</div>
                    ${escortName ? `<div class="tiny muted event-fighter-with">With ${escapeHTML(escortName)}</div>` : ""}
                  </div>
                `;
            };
            const teamBlockHTML = (label, participantRefs) => {
                const memberNames = participantRefs.map(ref => {
                    const name = participantInfo(ref).name;
                    const escortName = participantEscortName(m, ref);
                    if (!name) return "";
                    return escortName ? `${name} (With ${escortName})` : name;
                }).filter(Boolean);
                return `
                  <div class="event-fighter event-team-block">
                    <div class="event-fighter-fallback ${isMainEvent ? "event-fighter-photo-main" : ""}">${escapeHTML(teamNameInitial(label, "?"))}</div>
                    <div class="tiny event-fighter-name">${label}</div>
                    ${memberNames.length ? `<div class="tiny muted event-team-members">${escapeHTML(memberNames.join(", "))}</div>` : ""}
                  </div>
                `;
            };
            const fightRowHTML = useTeamFormat
                ? matchTeams.length > 2
                    ? multiTeamFightHTML(
                        matchTeams,
                        (group) => teamBlockHTML(teamDisplayName(m, group.key, group.participants), group.participants),
                        isMainEvent ? "event-vs-main" : ""
                    )
                    : matchTeams.map((group, idx) => {
                        const blockHTML = teamBlockHTML(teamDisplayName(m, group.key, group.participants), group.participants);
                        if (idx >= matchTeams.length - 1) return blockHTML;
                        return `${blockHTML}<div class="event-vs event-fight-separator ${isMainEvent ? "event-vs-main" : ""}">VS</div>`;
                    }).join("")
                : displayParticipants.map((participantRef, idx) => {
                    const fighterHTML = fighterBlockHTML(participantRef);
                    if (idx >= displayParticipants.length - 1) return fighterHTML;
                    if (hideVsForMatch) return fighterHTML;
                    return `${fighterHTML}<div class="event-vs event-fight-separator ${isMainEvent ? "event-vs-main" : ""}">VS</div>`;
                }).join("");

            return `
              <div class="event-match-card ${isMainEvent ? "main-event-card" : ""} ${championshipOnTheLine ? "has-championship-badge" : ""}">
                ${championshipOnTheLine ? `<div class="event-match-corner-title">${escapeHTML(championshipOnTheLine)}</div>` : ""}
                ${isMainEvent ? `<div class="event-main-label">Main Event</div>` : ""}
                <div class="event-match-title">${escapeHTML(title)}</div>
                ${resultText ? `<div class="muted tiny event-match-result">Result: ${escapeHTML(resultText)}${escapeHTML(pinText)}</div>` : ``}
                <div class="event-fight-row">
                  ${fightRowHTML}
                </div>
              </div>
            `;
        }).join("")
        : `<div class="muted">No matches scheduled yet for this event.</div>`;

    const bodyHTML = `
      <div class="stack">
        <div class="row gap wrap">
          ${showBadges}
          <span class="badge">${escapeHTML(ev.type.toUpperCase())}</span>
          <span class="badge">${ev.date}</span>
          <span class="badge">Rows: <b>${matches.length}</b></span>
        </div>
        <div class="event-match-list">${matchesHTML}</div>
      </div>
    `;

    const modalPromise = openModal({
        title: ev.name || "(Unnamed Event)",
        bodyHTML,
        okText: "Close",
        cancelText: "Close",
        hideCancel: true,
    });

    const modalActions = $(".modal-actions");
    const modalOkBtn = $("#modalOk");
    const plannerBtn = document.createElement("button");
    plannerBtn.className = "btn";
    plannerBtn.type = "button";
    plannerBtn.textContent = "Open Planner";
    const shouldShowEditPleBtn = fromCalendar && ev.type === "ppv";
    const editPleBtn = shouldShowEditPleBtn ? document.createElement("button") : null;
    if (editPleBtn) {
        editPleBtn.className = "btn secondary";
        editPleBtn.type = "button";
        editPleBtn.textContent = "Edit PLE";
    }
    const deleteBtn = document.createElement("button");
    deleteBtn.className = "btn danger";
    deleteBtn.type = "button";
    deleteBtn.textContent = "Delete";

    if (editPleBtn) modalActions.insertBefore(editPleBtn, modalOkBtn);
    modalActions.insertBefore(plannerBtn, modalOkBtn);
    modalActions.insertBefore(deleteBtn, modalOkBtn);

    editPleBtn?.addEventListener("click", async () => {
        closeModal({ ok: false });
        await editPleDetailsFlow(eventId);
    });
    plannerBtn.addEventListener("click", () => {
        closeModal({ ok: false });
        openPlanner(eventId);
    });
    deleteBtn.addEventListener("click", async () => {
        closeModal({ ok: false });
        const ev2 = getEvent(eventId);
        const ok = await openModal({
            title: "Delete event?",
            bodyHTML: `<div>Delete <b>${escapeHTML(ev2?.name || "this event")}</b> on ${ev2?.date}?</div>`,
            okText: "Delete"
        });
        if (!ok.ok) return;
        deleteEvent(eventId);
        renderAll();
    });

    await modalPromise;
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
      <div id="evShowsWrap" class="stack hidden">
        <div class="muted tiny">Shows included in this PLE / PPV</div>
        <div id="evShows" class="show-tag-picker"></div>
      </div>
      <input id="evName" class="input" placeholder="Event name (e.g., May - Week 1)" />
    </div>
  `;

    const modalPromise = openModal({ title: "Add Event", bodyHTML, okText: "Create" });
    const typeEl = $("#evType");
    const showEl = $("#evShow");
    const showsWrapEl = $("#evShowsWrap");
    const showsEl = $("#evShows");
    const selectedPpvShowIds = new Set();

    const renderPpvShowPicker = () => {
        if (!showsEl) return;
        if (!state.shows.length) {
            showsEl.innerHTML = `<div class="muted tiny">No shows created yet.</div>`;
            return;
        }
        showsEl.innerHTML = state.shows.map(s => {
            const active = selectedPpvShowIds.has(s.id);
            const bg = active ? `${s.color}33` : "rgba(255,255,255,.03)";
            const border = active ? s.color : "var(--line)";
            return `
              <button type="button" class="show-tag-btn ${active ? "active" : ""}" data-ev-show="${s.id}"
                style="border-color:${border};background:${bg};">
                <span class="dot" style="background:${s.color}"></span>
                <span>${escapeHTML(s.name)}</span>
              </button>
            `;
        }).join("");
        $$("[data-ev-show]", showsEl).forEach(btn => {
            btn.addEventListener("click", () => {
                const showId = btn.dataset.evShow;
                if (!showId) return;
                if (selectedPpvShowIds.has(showId)) selectedPpvShowIds.delete(showId);
                else selectedPpvShowIds.add(showId);
                renderPpvShowPicker();
            });
        });
    };

    const syncEventTypeFields = () => {
        const isPpv = typeEl?.value === "ppv";
        if (showEl) {
            showEl.classList.toggle("hidden", isPpv);
            showEl.disabled = isPpv;
            showEl.style.display = isPpv ? "none" : "";
        }
        if (showsWrapEl) {
            showsWrapEl.classList.toggle("hidden", !isPpv);
            showsWrapEl.style.display = isPpv ? "" : "none";
        }
        if (!isPpv) {
            selectedPpvShowIds.clear();
            if (showsEl) showsEl.innerHTML = "";
            return;
        }
        renderPpvShowPicker();
    };

    syncEventTypeFields();
    typeEl?.addEventListener("change", syncEventTypeFields);

    const ok = await modalPromise;
    if (!ok.ok) return;

    const date = $("#evDate").value;
    if (!isUniverseCalendarDay(date)) {
        showToast({
            message: isISODate(date) ? "Universe months have 4 weeks — pick a day from 1 to 28." : "Pick a date for the event.",
            tone: "danger",
        });
        return;
    }
    const type = $("#evType").value;
    const showId = $("#evShow").value || null;
    let showIds = type === "ppv"
        ? Array.from(selectedPpvShowIds)
        : (showId ? [showId] : []);
    // A PLE with zero shows selected defaults to every show — friendlier than failing silently
    if (type === "ppv" && showIds.length === 0) {
        showIds = state.shows.map(s => s.id);
        if (showIds.length === 0) {
            showToast({
                message: "Add at least one show before creating a PLE.",
                tone: "danger",
                duration: 5000,
            });
            return;
        }
    }
    const fallbackWeeklyShowName = (() => {
        const label = showName(showId);
        if (!label || label === "No show" || label === "Unknown show") return "Weekly Show";
        return label;
    })();
    const [year = "", month = "", day = ""] = String(date || "").split("-");
    const prettyDate = (month && day && year) ? `${month}-${day}-${year}` : String(date || "");
    const defaultName = type === "ppv"
        ? "PLE / PPV"
        : `${fallbackWeeklyShowName} • ${prettyDate}`;
    const name = $("#evName").value.trim() || defaultName;

    const event = { id: uid("event"), date, type, showId: showIds[0] ?? null, showIds, name, matches: [] };
    upsertEvent(event);

    calSelectedISO = date;
    openPlanner(event.id);
}

// -------------------- PLANNER --------------------
// One card layout for every screen size (single column on phones, a grid on
// tablets and desktop). Editing a match re-renders only that card, so changing
// a participant never redraws, re-decodes images or scrolls the rest of the card.
let plannerEventId = null;
const MIN_PARTICIPANT_SLOTS = 2;
const MAX_PARTICIPANT_SLOTS = 30;
let plannerDrag = null;

const ICONS = {
    grip: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>`,
    close: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>`,
    plus: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>`,
    minus: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/></svg>`,
    chevron: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>`,
    manager: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3.2"/><path d="M3.5 19c.8-3.2 3-5 5.5-5s4.7 1.8 5.5 5"/><path d="M18 8v6M15 11h6"/></svg>`,
    belt: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9h3l2-2h8l2 2h3v6h-3l-2 2H8l-2-2H3z"/><circle cx="12" cy="12" r="2.2"/></svg>`,
    lock: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>`,
};

function participantSlotCount(match) {
    const participants = Array.isArray(match?.participants) ? match.participants : [];
    const configured = Math.floor(Number(match?.participantSlots) || 0);
    return Math.max(MIN_PARTICIPANT_SLOTS, participants.length, configured);
}
// Positional slot list: index = slot on screen, "" = open slot.
function matchSlotIds(match) {
    const raw = Array.isArray(match?.participants) ? match.participants : [];
    return Array.from({ length: participantSlotCount(match) }, (_, i) => {
        const ref = String(raw[i] ?? "").trim();
        return ref ? (resolveSuperstarIdFromRef(ref) || ref) : "";
    });
}
function setMatchSlotIds(match, slots, slotCount = slots.length) {
    const next = slots.map(v => String(v ?? "").trim());
    while (next.length && !next[next.length - 1]) next.pop();
    match.participants = next;
    match.participantSlots = Math.max(MIN_PARTICIPANT_SLOTS, slotCount, next.length);
}

function ensurePlannerMatchIds(ev) {
    if (!ev || !Array.isArray(ev.matches)) return false;
    let changed = false;
    ev.matches = ev.matches.map(match => {
        const existing = String(match?.id || "").trim();
        if (existing) return match;
        changed = true;
        return { ...match, id: uid("match") };
    });
    return changed;
}

function renumberPlannerMatches(matches) {
    if (!Array.isArray(matches)) return;
    matches.forEach((match, idx) => {
        if (match && typeof match === "object") match.num = idx + 1;
    });
}

function movePlannerMatch(matches, fromIndex, toIndex) {
    if (!Array.isArray(matches)) return false;
    if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex)) return false;
    if (fromIndex === toIndex) return false;
    if (fromIndex < 0 || fromIndex >= matches.length) return false;
    if (toIndex < 0 || toIndex >= matches.length) return false;
    const [movedMatch] = matches.splice(fromIndex, 1);
    matches.splice(toIndex, 0, movedMatch);
    return true;
}

function capturePlannerCardPositions() {
    const positions = new Map();
    $$("#plannerCardList .planner-card[data-match-id]").forEach(el => {
        positions.set(el.dataset.matchId, el.getBoundingClientRect());
    });
    return positions;
}
function animatePlannerCards(fromPositions) {
    if (!(fromPositions instanceof Map) || !fromPositions.size) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return;
    $$("#plannerCardList .planner-card[data-match-id]").forEach(el => {
        const old = fromPositions.get(el.dataset.matchId);
        if (!old) return;
        const now = el.getBoundingClientRect();
        const dx = old.left - now.left;
        const dy = old.top - now.top;
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
        el.animate(
            [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0, 0)" }],
            { duration: 240, easing: "cubic-bezier(.22, 1, .36, 1)" }
        );
    });
}

function plannerSortedEvents() {
    return [...state.events].sort((a, b) => a.date.localeCompare(b.date));
}
function plannerEventLabel(e) {
    const done = isUniverseDateCompleted(e.date) ? "✓ " : "";
    const date = isISODate(e.date)
        ? parseISO(e.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })
        : e.date;
    const name = String(e.name || "(Unnamed)").replace(` • ${e.date}`, "").trim() || "(Unnamed)";
    const shows = eventShowNames(e);
    const showSuffix = shows.length && !shows.every(show => name.toLowerCase().includes(show.toLowerCase()))
        ? ` (${shows.join(" + ")})`
        : "";
    return `${done}${date} · ${name}${showSuffix}`;
}

function renderPlannerEventSelect() {
    const sel = $("#plannerEventSelect");
    if (!sel) return;
    const events = plannerSortedEvents();
    if (!plannerEventId && events.length) {
        plannerEventId = (nextUniverseEvent() || events[0]).id;
    }
    if (plannerEventId && !events.some(e => e.id === plannerEventId)) {
        plannerEventId = events[0]?.id || null;
    }
    // Only rebuild the (long) option list when the events actually changed.
    const signature = `${dataVersion}:${events.length}`;
    if (sel.dataset.signature !== signature) {
        sel.innerHTML = events.length
            ? events.map(e => `<option value="${escapeAttr(e.id)}">${escapeHTML(plannerEventLabel(e))}</option>`).join("")
            : `<option value="">No events yet</option>`;
        sel.dataset.signature = signature;
    }
    if (plannerEventId) sel.value = plannerEventId;
    const index = events.findIndex(e => e.id === plannerEventId);
    const prev = $("#plannerPrevEvent");
    const next = $("#plannerNextEvent");
    if (prev) prev.disabled = index <= 0;
    if (next) next.disabled = index < 0 || index >= events.length - 1;
}
function stepPlannerEvent(delta) {
    const events = plannerSortedEvents();
    const index = events.findIndex(e => e.id === plannerEventId);
    const target = events[index + delta];
    if (!target) return;
    plannerEventId = target.id;
    renderPlanner();
    window.scrollTo({ top: 0, behavior: "instant" });
    scheduleUiSessionSave();
}

function plannerBookedSuperstarIds(ev, exceptRow = -1) {
    const booked = new Set();
    (ev?.matches || []).forEach((match, rowIndex) => {
        if (rowIndex === exceptRow) return;
        matchParticipantRefs(match).map(resolveSuperstarIdFromRef).filter(Boolean).forEach(id => booked.add(id));
    });
    return booked;
}

function plannerRankMapForEvent(ev) {
    const map = new Map();
    const rankings = computeWeeklyRankings(3);
    const relevantShowIds = eventShowIds(ev);
    const showIds = relevantShowIds.length ? relevantShowIds : state.shows.map(show => show.id);
    showIds.forEach(showId => {
        const rows = rankings.get(showId) || [];
        rows.forEach((row, index) => {
            if (!map.has(row.superstar.id)) map.set(row.superstar.id, index + 1);
        });
    });
    return map;
}

function defaultTeamForSlot(match, slot) {
    const type = String(match?.matchType || "").toLowerCase();
    const slotCount = participantSlotCount(match);
    if (type.includes("handicap")) return slot === 0 ? "T1" : "T2";
    const teamCount = inferTagTeamCount(match?.matchType, slotCount) || 2;
    const teamSize = slotCount % teamCount === 0 ? slotCount / teamCount : Math.ceil(slotCount / 2);
    return `T${Math.min(teamCount, Math.floor(slot / Math.max(1, teamSize)) + 1)}`;
}
function matchTypeIsTeamBased(matchType) {
    return /tag|handicap/i.test(String(matchType || ""));
}

// Keeps teams, escorts, winner and pin consistent with the current participants.
function reconcilePlannerMatchTeams(match) {
    const slots = matchSlotIds(match);
    const participants = slots.filter(Boolean);
    const present = new Set(participants);
    const typeIsTeam = matchTypeIsTeamBased(match?.matchType);

    const escorts = {};
    Object.entries(normalizedParticipantEscorts(match)).forEach(([pid, ref]) => {
        if (present.has(pid)) escorts[pid] = ref;
    });
    match.participantEscorts = escorts;

    if (typeIsTeam) {
        const teams = {};
        const previous = normalizedParticipantTeams(match);
        slots.forEach((pid, slot) => {
            if (!pid) return;
            teams[pid] = previous[pid] || defaultTeamForSlot(match, slot);
        });
        match.participantTeams = teams;
    } else {
        match.participantTeams = {};
        match.teamNames = {};
    }

    const isTeamBased = isTeamOrHandicapMatch(match?.matchType, participants.length);
    if (!isTeamBased) {
        if (match.result && !participants.includes(match.result) && !isSpecialMatchResult(match.result)) {
            const resolved = resolveSuperstarIdFromRef(match.result);
            match.result = resolved && participants.includes(resolved) ? resolved : "";
        }
        if (match.pinBy && (!participants.includes(match.pinBy) || isSpecialMatchResult(match.result))) {
            match.pinBy = "";
        }
        return;
    }

    const teamGroups = inferMatchTeams(match?.matchType, participants, normalizedParticipantTeams(match));
    match.teamNames = pruneMatchTeamNames(match, teamGroups);
    if (!isTeamResultValue(match.result) && !isSpecialMatchResult(match.result)) {
        match.result = "";
    }
    const winningTeam = winningTeamFromMatch(match, teamGroups, String(match.result || ""));
    if (isTeamResultValue(match.result) && !winningTeam?.participants?.length) {
        match.result = "";
    }
    const winningPool = winningTeam?.participants || [];
    if (match.pinBy && (!winningPool.length || !winningPool.includes(match.pinBy))) {
        match.pinBy = "";
    }
}

function pruneMatchTeamNames(match, teamGroups) {
    const validKeys = new Set(teamGroups.map(group => group.key));
    const nextNames = {};
    Object.entries(normalizedTeamNames(match)).forEach(([teamKey, name]) => {
        if (!validKeys.has(teamKey)) return;
        nextNames[teamKey] = name;
    });
    return nextNames;
}

// ---------- card rendering ----------
function selectOptionsHTML(options, currentValue) {
    const current = String(currentValue ?? "");
    const list = options.slice();
    // Never silently drop a stored value just because it isn't in today's list.
    if (current && !list.some(opt => opt.value === current)) {
        list.push({ value: current, label: `${current}` });
    }
    return list.map(opt => `<option value="${escapeAttr(opt.value)}"${opt.value === current ? " selected" : ""}>${escapeHTML(opt.label)}</option>`).join("");
}

function plannerContext(ev) {
    return {
        ev,
        eventShows: eventShowIds(ev),
        locked: isUniverseDateCompleted(ev.date),
        recordMap: computeSuperstarRecords(),
    };
}

function plannerAvatarHTML(superstar, className) {
    const photo = superstarPhotoURL(superstar);
    const initials = escapeHTML(superstarInitials(superstar?.name));
    return `<span class="${className}"><span class="avatar-initials">${initials}</span>${photo ? `<img src="${escapeAttr(photo)}" alt="" decoding="sync" loading="eager" draggable="false" />` : ""}</span>`;
}

function plannerSlotHTML(match, slot, participantId, view, ctx) {
    const disabled = ctx.locked ? " disabled" : "";
    const superstar = participantId ? (getSuperstar(participantId) || null) : null;
    if (!participantId) {
        return `
          <div class="pm-slot is-empty">
            <button type="button" class="planner-participant-pick is-empty" data-pick-participant data-slot="${slot}"${disabled}>
              <span class="planner-participant-avatar is-plus">${ICONS.plus}</span>
              <span class="planner-participant-copy">
                <span class="planner-participant-name">${slot >= 2 ? "Add superstar" : "Pick a superstar"}</span>
                <span class="planner-participant-meta">Slot ${slot + 1}</span>
              </span>
              <span class="planner-participant-chevron">${ICONS.chevron}</span>
            </button>
          </div>`;
    }
    const name = superstar?.name || participantId;
    const record = superstarRecordById(superstar?.id || participantId, ctx.recordMap);
    const escortName = participantEscortName(match, participantId);
    const meta = [superstar?.division || "Roster", `${record.wins}-${record.losses}`];
    const teamKey = view.participantTeams[participantId] || "";
    const teamSelect = view.isTeamBased ? `
        <select class="cell-input pm-team" data-field="participantTeam" data-slot="${slot}" aria-label="Team for ${escapeAttr(name)}"${disabled}>
          ${selectOptionsHTML(view.teamOptions, teamKey)}
        </select>` : "";
    return `
      <div class="pm-slot${view.isTeamBased ? ` team-${escapeAttr(teamKey || "T1")}` : ""}">
        <button type="button" class="planner-participant-pick" data-pick-participant data-slot="${slot}"${disabled}>
          ${plannerAvatarHTML(superstar || { name }, "planner-participant-avatar")}
          <span class="planner-participant-copy">
            <span class="planner-participant-name"><span class="pm-name-text">${escapeHTML(name)}</span>${superstar?.isChampion ? `<span class="champ-inline">C</span>` : ""}</span>
            <span class="planner-participant-meta">${escapeHTML(meta.join(" • "))}${escortName ? ` • <span class="pm-escort">w/ ${escapeHTML(escortName)}</span>` : ""}</span>
          </span>
          <span class="planner-participant-chevron">${ICONS.chevron}</span>
        </button>
        ${teamSelect}
        <button type="button" class="pm-icon-btn${escortName ? " is-active" : ""}" data-open-escort="${slot}" aria-label="Ringside accompaniment for ${escapeAttr(name)}" title="Manager / accompaniment"${disabled}>${ICONS.manager}</button>
      </div>`;
}

function plannerMatchView(match, ctx) {
    const slots = matchSlotIds(match);
    const participants = slots.filter(Boolean);
    const participantTeams = normalizedParticipantTeams(match);
    const teamGroups = inferMatchTeams(match.matchType, participants, participantTeams);
    const isTeamBased = isTeamOrHandicapMatch(match.matchType, participants.length);
    const teamOptionCount = Math.max(2, Math.min(slots.length, 8),
        ...Object.values(participantTeams).map(teamKeyIndex),
        ...teamGroups.map(group => teamKeyIndex(group.key)));
    const teamOptions = Array.from({ length: teamOptionCount }, (_, i) => ({ value: `T${i + 1}`, label: `T${i + 1}` }));
    return { slots, participants, participantTeams, teamGroups, isTeamBased, teamOptions };
}

function plannerCardHTML(match, idx, ctx) {
    const view = plannerMatchView(match, ctx);
    const disabled = ctx.locked ? " disabled" : "";
    const total = ctx.ev.matches.length;
    const isMain = total > 1 && idx === total - 1;

    // Championship: titles available to this show (+ whatever is already booked).
    const champs = eligibleChampionshipsForShowIds(ctx.eventShows, { participantIds: view.participants });
    const currentChampId = String(match.championshipId || "");
    const champOptions = [{ value: "", label: "No title on the line" }, ...champs.map(c => ({ value: c.id, label: c.name }))];
    if (currentChampId && !champOptions.some(opt => opt.value === currentChampId)) {
        const champ = getChampionship(currentChampId);
        if (champ) champOptions.push({ value: champ.id, label: `${champ.name} (other brand)` });
    }

    // Result options.
    const winnerOptions = view.isTeamBased
        ? view.teamGroups.map(group => ({ value: teamResultValue(group.key), label: teamDisplayName(match, group.key, group.participants) }))
        : view.participants.map(pid => ({ value: pid, label: superstarNameById(pid) || pid }));
    const resultOptions = [{ value: "", label: "No winner yet" }, ...winnerOptions, { value: "DQ", label: "DQ" }, { value: "Promo", label: "Promo" }];
    const rawResult = String(match.result || "");
    const teamKey = parseTeamResultValue(rawResult);
    const resultValue = teamKey ? teamResultValue(teamKey) : (resolveSuperstarIdFromRef(rawResult) && view.participants.includes(resolveSuperstarIdFromRef(rawResult)) ? resolveSuperstarIdFromRef(rawResult) : rawResult);

    let pinHTML = "";
    if (view.isTeamBased) {
        const winningTeam = view.teamGroups.find(group => group.key === teamKey) || null;
        const pool = winningTeam?.participants?.length ? winningTeam.participants : view.participants;
        pinHTML = `
          <label class="pm-field">
            <span class="planner-card-label">Pinfall / submission by</span>
            <select class="cell-input" data-field="pinBy"${disabled}>
              ${selectOptionsHTML([{ value: "", label: "—" }, ...pool.map(pid => ({ value: pid, label: superstarNameById(pid) || pid }))], String(match.pinBy || ""))}
            </select>
          </label>`;
    }

    let teamNamesHTML = "";
    if (isTagTeamMatchType(match.matchType) && view.teamGroups.length && view.isTeamBased) {
        const names = normalizedTeamNames(match);
        teamNamesHTML = view.teamGroups.map(group => {
            const factions = factionOptionsForParticipants(group.participants);
            const current = String(names[group.key] || "");
            return `
              <label class="pm-field">
                <span class="planner-card-label">${escapeHTML(teamLabel(group.key))} name</span>
                <select class="cell-input" data-field="teamName" data-team-key="${escapeAttr(group.key)}"${disabled}>
                  ${selectOptionsHTML([{ value: "", label: teamLabel(group.key) }, ...factions.map(f => ({ value: f, label: f }))], current)}
                </select>
              </label>`;
        }).join("");
    }

    const storyline = String(match.storyline || "");
    const rivalryNotes = String(match.rivalryNotes || "");
    const preview = (text, empty) => text.trim()
        ? escapeHTML(text.length > 90 ? `${text.slice(0, 90)}…` : text)
        : empty;
    const beltName = currentChampId ? championshipName(currentChampId) : "";
    const slotCount = view.slots.length;

    return `
      <article class="planner-card${ctx.locked ? " is-locked" : ""}${isMain ? " is-main-event" : ""}" data-row="${idx}" data-match-id="${escapeAttr(match.id || "")}">
        <header class="planner-card-head">
          <button type="button" class="planner-card-drag" data-drag-handle aria-label="Drag to reorder match ${idx + 1}"${disabled}>${ICONS.grip}</button>
          <div class="planner-card-num">Match ${idx + 1}${isMain ? `<span class="planner-main-tag">Main Event</span>` : ""}</div>
          <div class="planner-card-spacer"></div>
          ${beltName ? `<div class="planner-card-belt" title="${escapeAttr(beltName)}">${ICONS.belt}<span>${escapeHTML(beltName)}</span></div>` : ""}
          <button type="button" class="planner-card-iconbtn danger" data-del-row="${idx}" aria-label="Delete match ${idx + 1}"${disabled}>${ICONS.close}</button>
        </header>

        <section class="planner-card-section">
          <div class="planner-card-section-head">
            <span class="planner-card-label">Participants · ${view.participants.length}/${slotCount}</span>
            <div class="planner-card-section-actions">
              <button type="button" class="planner-card-iconbtn small" data-remove-participant aria-label="Remove last slot"${ctx.locked || slotCount <= MIN_PARTICIPANT_SLOTS ? " disabled" : ""}>${ICONS.minus}</button>
              <button type="button" class="planner-card-iconbtn small" data-add-participant aria-label="Add a slot"${ctx.locked || slotCount >= MAX_PARTICIPANT_SLOTS ? " disabled" : ""}>${ICONS.plus}</button>
            </div>
          </div>
          <div class="planner-card-participants">
            ${view.slots.map((pid, slot) => plannerSlotHTML(match, slot, pid, view, ctx)).join("")}
          </div>
        </section>

        <div class="planner-card-fields">
          <label class="pm-field">
            <span class="planner-card-label">Match type</span>
            <input class="cell-input" data-field="matchType" value="${escapeAttr(match.matchType || "")}" placeholder="1v1, Tag Team, Ladder…" list="matchTypePresets" autocomplete="off" enterkeyhint="done"${disabled} />
          </label>
          <label class="pm-field">
            <span class="planner-card-label">Championship</span>
            <select class="cell-input" data-field="championshipId"${disabled}>${selectOptionsHTML(champOptions, currentChampId)}</select>
          </label>
          ${teamNamesHTML}
          <label class="pm-field">
            <span class="planner-card-label">Result</span>
            <select class="cell-input" data-field="result"${disabled}>${selectOptionsHTML(resultOptions, resultValue)}</select>
          </label>
          ${pinHTML}
        </div>

        <div class="planner-card-notes">
          <button type="button" class="planner-card-note" data-open-note="storyline">
            <span class="planner-card-note-label">Storyline</span>
            <span class="planner-card-note-preview${storyline.trim() ? "" : " is-empty"}">${preview(storyline, ctx.locked ? "No storyline" : "Add storyline")}</span>
          </button>
          <button type="button" class="planner-card-note" data-open-note="rivalryNotes">
            <span class="planner-card-note-label">Rivalry notes</span>
            <span class="planner-card-note-preview${rivalryNotes.trim() ? "" : " is-empty"}">${preview(rivalryNotes, ctx.locked ? "No notes" : "Add rivalry notes")}</span>
          </button>
        </div>
      </article>`;
}

function updatePlannerMeta(ev) {
    const meta = $("#plannerMeta");
    const lockBanner = $("#plannerLockBanner");
    if (!ev) {
        if (lockBanner) lockBanner.classList.add("hidden");
        return;
    }
    const locked = isUniverseDateCompleted(ev.date);
    const shows = eventShowNames(ev);
    const showBadges = shows.length
        ? eventShowIds(ev).map(id => `<span class="badge"><span class="dot" style="background:${escapeAttr(showColor(id))}"></span>${escapeHTML(showName(id))}</span>`).join("")
        : "";
    const date = isISODate(ev.date)
        ? parseISO(ev.date).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" })
        : ev.date;
    if (meta) {
        meta.innerHTML = `
          ${showBadges}
          <span class="badge">${ev.type === "ppv" ? "PLE" : "Weekly"}</span>
          <span class="badge">${escapeHTML(date)}</span>
          <span class="badge">${ev.matches.length} ${ev.matches.length === 1 ? "match" : "matches"}</span>`;
    }
    if (lockBanner) lockBanner.classList.toggle("hidden", !locked);
    const addBtn = $("#addMatchRow");
    if (addBtn) addBtn.disabled = locked;
}

function renderPlanner(fromPositions = null) {
    renderPlannerEventSelect();
    const list = $("#plannerCardList");
    if (!list) return;

    const ev = plannerEventId ? getEvent(plannerEventId) : null;
    if (!ev) {
        updatePlannerMeta(null);
        $("#plannerMeta").innerHTML = "";
        list.innerHTML = `
          <div class="planner-empty">
            <div class="planner-empty-title">${state.events.length ? "Pick an event to plan" : "No events yet"}</div>
            <div class="muted tiny">Create a weekly show or PLE, then book the card here.</div>
            <button type="button" class="btn" data-planner-new-event>Create Event</button>
          </div>`;
        return;
    }
    if (ensurePlannerMatchIds(ev)) upsertEvent(ev);
    if (!Array.isArray(ev.matches)) ev.matches = [];

    updatePlannerMeta(ev);
    const ctx = plannerContext(ev);
    list.innerHTML = ev.matches.map((m, idx) => plannerCardHTML(m, idx, ctx)).join("")
        + (ctx.locked ? "" : `<button type="button" class="planner-add-card" data-planner-add-match>${ICONS.plus}<span>Add match</span></button>`);
    optimizeImages(list);
    animatePlannerCards(fromPositions);
}

// Re-render a single match card in place (keeps scroll position & focus).
function refreshPlannerMatch(row) {
    const ev = getEvent(plannerEventId);
    const list = $("#plannerCardList");
    if (!ev || !list) return;
    const old = list.querySelector(`.planner-card[data-row="${row}"]`);
    if (!old || !ev.matches[row]) { renderPlanner(); return; }

    const active = document.activeElement;
    const focusKey = active && old.contains(active)
        ? (active.dataset.field ? `[data-field="${active.dataset.field}"]${active.dataset.slot ? `[data-slot="${active.dataset.slot}"]` : ""}${active.dataset.teamKey ? `[data-team-key="${active.dataset.teamKey}"]` : ""}` : "")
        : "";

    const holder = document.createElement("div");
    holder.innerHTML = plannerCardHTML(ev.matches[row], row, plannerContext(ev));
    const next = holder.firstElementChild;
    old.replaceWith(next);
    optimizeImages(next);
    updatePlannerMeta(ev);
    if (focusKey) {
        try { next.querySelector(focusKey)?.focus({ preventScroll: true }); } catch { /* ignore */ }
    }
}

function plannerTarget(el) {
    const card = el?.closest?.(".planner-card[data-row]");
    if (!card) return null;
    const ev = getEvent(plannerEventId);
    const row = Number(card.dataset.row);
    const match = ev?.matches?.[row];
    return match ? { ev, row, match, card } : null;
}
function plannerLockedToast(ev) {
    if (!isUniverseDateCompleted(ev.date)) return false;
    showToast({ message: "This day is marked done — unmark it on the calendar to edit.", tone: "danger" });
    return true;
}
function commitPlannerMatch(ev, row, { reconcile = true, refresh = true } = {}) {
    if (reconcile) reconcilePlannerMatchTeams(ev.matches[row]);
    upsertEvent(ev);
    if (refresh) refreshPlannerMatch(row);
}

function updatePlannerParticipantSlot({ row, slot, superstarId = "" }) {
    const ev = getEvent(plannerEventId);
    if (!ev || !ev.matches[row]) return false;
    if (plannerLockedToast(ev)) return false;

    const match = ev.matches[row];
    const slots = matchSlotIds(match);
    const oldId = slots[slot] || "";
    const teams = normalizedParticipantTeams(match);
    if (superstarId) {
        // A superstar can only be in one slot per match.
        slots.forEach((pid, i) => { if (pid === superstarId && i !== slot) slots[i] = ""; });
        slots[slot] = superstarId;
        if (oldId && oldId !== superstarId && teams[oldId] && !teams[superstarId]) {
            teams[superstarId] = teams[oldId];
        }
        if (oldId && oldId !== superstarId && match.result === oldId) match.result = "";
    } else {
        slots[slot] = ""; // leave the slot open — nobody else moves
    }
    match.participantTeams = teams;
    setMatchSlotIds(match, slots, slots.length);
    commitPlannerMatch(ev, row);
    return true;
}

async function openPlannerSuperstarPicker({ row, slot }) {
    const ev = getEvent(plannerEventId);
    if (!ev || !ev.matches[row]) return;
    if (plannerLockedToast(ev)) return;

    const match = ev.matches[row];
    const slots = matchSlotIds(match);
    const currentId = slots[slot] || "";
    const selectedElsewhereInMatch = new Set(slots.filter((pid, index) => pid && index !== slot));
    const bookedElsewhere = plannerBookedSuperstarIds(ev, row);
    const eventShows = eventShowIds(ev);
    const rankMap = plannerRankMapForEvent(ev);
    const pickerRecordMap = computeSuperstarRecords();
    const pickerState = {
        query: "",
        brandOnly: eventShows.length > 0,
        championsOnly: false,
        freeTonight: false,
        division: "all",
    };

    const matchupHTML = slots.map((participantId, index) => {
        const superstar = participantId ? getSuperstar(participantId) : null;
        const isTarget = index === slot;
        if (!superstar || isTarget) {
            return `<div class="picker-matchup-chip ${isTarget ? "is-target" : ""}"><span class="picker-matchup-number">${index + 1}</span><span>${isTarget ? "Choosing…" : "Open slot"}</span></div>`;
        }
        return `<div class="picker-matchup-chip">${plannerAvatarHTML(superstar, "picker-matchup-avatar")}<span class="picker-matchup-label">${escapeHTML(superstar.name)}</span></div>`;
    }).join(`<span class="picker-matchup-vs">vs</span>`);

    const bodyHTML = `
      <div class="superstar-picker-shell">
        <div class="picker-context">Match ${row + 1} • Slot ${slot + 1}</div>
        <div class="picker-matchup">${matchupHTML}</div>
        <div class="picker-search-row">
          <input id="pickerSearch" class="input picker-search" type="search" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search" placeholder="Search the roster…" />
        </div>
        <div class="picker-filter-strip" aria-label="Roster filters">
          <button type="button" class="picker-filter${pickerState.brandOnly ? " is-active" : ""}" data-picker-filter="brand"${eventShows.length ? "" : " hidden"}>This brand only</button>
          <button type="button" class="picker-filter" data-picker-filter="champions">Champions</button>
          <button type="button" class="picker-filter" data-picker-filter="free">Free tonight</button>
          <select id="pickerDivision" class="picker-filter picker-filter-select" aria-label="Division filter">
            <option value="all">All divisions</option>
            <option value="World">World</option>
            <option value="Midcard">Midcard</option>
            <option value="Tag">Tag</option>
            <option value="Women">Women</option>
            <option value="Other">Other</option>
          </select>
        </div>
        <div class="picker-roster-head"><span>Roster</span><span id="pickerRosterCount" class="muted tiny"></span></div>
        <div id="pickerRosterGrid" class="picker-roster-grid"></div>
      </div>
    `;

    const modalPromise = openModal({
        title: "Pick a Superstar",
        bodyHTML,
        okText: "Done",
        cancelText: "Close",
        hideOk: true,
        variant: "superstar-picker-modal",
    });
    let clearButton = null;
    if (currentId) {
        clearButton = document.createElement("button");
        clearButton.type = "button";
        clearButton.className = "btn danger picker-clear-slot";
        clearButton.textContent = "Remove from slot";
        $(".modal-actions")?.insertBefore(clearButton, $("#modalCancel"));
    }

    const rosterGrid = $("#pickerRosterGrid");
    const rosterCount = $("#pickerRosterCount");
    const normalizeQuery = value => normalizeNameForCompare(String(value || ""));
    const searchText = new Map(state.superstars.map(ss => [ss.id, normalizeQuery([ss.name, ss.division, ss.faction, ss.manager, ...superstarShowNames(ss)].join(" "))]));

    const rosterForPicker = () => {
        const query = normalizeQuery(pickerState.query);
        return state.superstars
            .filter(superstar => {
                if (selectedElsewhereInMatch.has(superstar.id)) return false;
                if (pickerState.brandOnly && eventShows.length && !eventShows.some(showId => superstarOnShow(superstar, showId))) return false;
                if (pickerState.championsOnly && !superstar.isChampion) return false;
                if (pickerState.freeTonight && bookedElsewhere.has(superstar.id) && superstar.id !== currentId) return false;
                if (pickerState.division !== "all" && normalizeSuperstarDivision(superstar.division) !== pickerState.division) return false;
                if (query && !searchText.get(superstar.id)?.includes(query)) return false;
                return true;
            })
            .sort((a, b) => {
                const rankA = rankMap.get(a.id) || Number.MAX_SAFE_INTEGER;
                const rankB = rankMap.get(b.id) || Number.MAX_SAFE_INTEGER;
                return (rankA - rankB) || a.name.localeCompare(b.name);
            });
    };

    const renderPickerRoster = () => {
        const roster = rosterForPicker();
        if (rosterCount) rosterCount.textContent = `${roster.length} available`;
        if (!rosterGrid) return;
        rosterGrid.innerHTML = roster.length ? roster.map(superstar => {
            const photo = superstarPhotoURL(superstar);
            const record = superstarRecordById(superstar.id, pickerRecordMap);
            const rank = rankMap.get(superstar.id);
            const booked = bookedElsewhere.has(superstar.id) && superstar.id !== currentId;
            const active = superstar.id === currentId;
            return `
              <button type="button" class="picker-superstar-card ${active ? "is-selected" : ""}${booked ? " is-booked" : ""}" data-picker-superstar="${escapeAttr(superstar.id)}" aria-label="Select ${escapeAttr(superstar.name)}">
                <span class="picker-superstar-visual${photo ? " has-photo" : ""}">
                  <span class="picker-superstar-fallback">${escapeHTML(superstarInitials(superstar.name))}</span>
                  ${photo ? `<img class="picker-superstar-photo" src="${escapeAttr(photo)}" alt="" loading="lazy" decoding="async" draggable="false" />` : ""}
                  ${superstar.isChampion ? `<span class="picker-title-badge">TITLE</span>` : ""}
                  ${rank ? `<span class="picker-rank-badge">#${rank}</span>` : ""}
                </span>
                <span class="picker-superstar-name">${escapeHTML(superstar.name)}</span>
                <span class="picker-superstar-meta">${escapeHTML(superstar.division || "Roster")} • ${record.wins}-${record.losses}${booked ? " • Booked" : ""}</span>
              </button>
            `;
        }).join("") : `<div class="picker-empty"><b>No superstars found.</b><span>Try clearing a filter or searching another name.</span></div>`;
        rosterGrid.scrollTop = 0;
    };

    let searchFrame = 0;
    $("#pickerSearch")?.addEventListener("input", e => {
        pickerState.query = e.target.value;
        cancelAnimationFrame(searchFrame);
        searchFrame = requestAnimationFrame(renderPickerRoster);
    });
    $("#pickerDivision")?.addEventListener("change", e => {
        pickerState.division = e.target.value;
        renderPickerRoster();
    });
    $$("[data-picker-filter]").forEach(button => {
        button.addEventListener("click", () => {
            const filter = button.dataset.pickerFilter;
            if (filter === "brand") pickerState.brandOnly = !pickerState.brandOnly;
            if (filter === "champions") pickerState.championsOnly = !pickerState.championsOnly;
            if (filter === "free") pickerState.freeTonight = !pickerState.freeTonight;
            const active = filter === "brand" ? pickerState.brandOnly : filter === "champions" ? pickerState.championsOnly : pickerState.freeTonight;
            button.classList.toggle("is-active", active);
            renderPickerRoster();
        });
    });
    rosterGrid?.addEventListener("click", e => {
        const card = e.target.closest("[data-picker-superstar]");
        if (!card || card.dataset.selecting === "true") return;
        e.preventDefault();
        card.dataset.selecting = "true";
        closeModal({ ok: true, selected: card.dataset.pickerSuperstar });
    });
    clearButton?.addEventListener("click", e => {
        e.preventDefault();
        closeModal({ ok: true, cleared: true });
    });

    renderPickerRoster();
    const modalResult = await modalPromise;
    // Apply after the sheet is gone so only this one card updates underneath.
    if (modalResult?.selected) updatePlannerParticipantSlot({ row, slot, superstarId: modalResult.selected });
    else if (modalResult?.cleared) updatePlannerParticipantSlot({ row, slot, superstarId: "" });
}

function plannerNoteDisplayHTML(noteValue, emptyText) {
    const value = String(noteValue ?? "");
    if (!value.trim()) return `<div class="muted tiny">${escapeHTML(emptyText)}</div>`;
    return `<div class="planner-note-display">${escapeHTML(value).replace(/\n/g, "<br>")}</div>`;
}

async function openPlannerNoteModal({ row, field }) {
    const ev = getEvent(plannerEventId);
    if (!ev || !ev.matches[row]) return;
    const isStoryline = field === "storyline";
    if (!isStoryline && field !== "rivalryNotes") return;
    const locked = isUniverseDateCompleted(ev.date);

    const title = isStoryline ? "Storyline" : "Rivalry Notes";
    const placeholder = isStoryline ? "What's the story going into this match?" : "History, stakes, what happens next…";
    const currentValue = String(ev.matches[row]?.[field] ?? "");
    const bodyHTML = locked
        ? `<div class="stack">${plannerNoteDisplayHTML(currentValue, isStoryline ? "No storyline notes." : "No rivalry notes.")}<div class="muted tiny">🔒 This day is marked done, so notes are read-only.</div></div>`
        : `<textarea id="plannerNoteEdit" class="input textarea planner-note-textarea" placeholder="${escapeAttr(placeholder)}">${escapeHTML(currentValue)}</textarea>`;

    const modalPromise = openModal({
        title: `Match ${row + 1} • ${title}`,
        bodyHTML,
        okText: locked ? "Close" : "Save",
        cancelText: "Cancel",
        hideCancel: locked,
    });
    const editEl = $("#plannerNoteEdit");
    const modalResult = await modalPromise;
    if (locked || !modalResult?.ok || !editEl) return;

    const ev2 = getEvent(plannerEventId);
    if (!ev2 || !ev2.matches[row]) return;
    ev2.matches[row][field] = String(editEl.value ?? "");
    commitPlannerMatch(ev2, row, { reconcile: false });
}

async function openPlannerEscortModal({ row, slot }) {
    const ev = getEvent(plannerEventId);
    if (!ev || !ev.matches[row]) return;
    if (plannerLockedToast(ev)) return;
    const match = ev.matches[row];
    const participantId = matchSlotIds(match)[slot] || "";
    if (!participantId) return;

    const participant = participantInfo(participantId);
    const managers = Array.from(new Set(
        state.superstars.map(ss => String(ss?.manager || "").trim()).filter(Boolean)
    )).sort((a, b) => a.localeCompare(b));
    const currentValue = String(normalizedParticipantEscorts(match)[participantId] || "");
    const options = [
        { value: "", label: "Nobody" },
        ...managers.map(name => ({ value: escortRefForManager(name), label: `Manager: ${name}` })),
        ...state.superstars
            .filter(ss => ss.id !== participantId)
            .slice()
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(ss => ({ value: escortRefForSuperstar(ss.id), label: ss.name })),
    ];

    const bodyHTML = `
      <div class="stack" style="gap:10px;">
        <div class="muted">Who walks out with <b>${escapeHTML(participant.name)}</b>?</div>
        <select id="plannerEscortSelect" class="input">${selectOptionsHTML(options, currentValue)}</select>
      </div>
    `;
    const modalPromise = openModal({ title: `Match ${row + 1} • Accompaniment`, bodyHTML, okText: "Save" });
    const ok = await modalPromise;
    if (!ok?.ok) return;

    const selected = String($("#plannerEscortSelect")?.value || "").trim();
    const ev2 = getEvent(plannerEventId);
    if (!ev2 || !ev2.matches[row]) return;
    const escorts = normalizedParticipantEscorts(ev2.matches[row]);
    if (!selected) delete escorts[participantId];
    else escorts[participantId] = selected;
    ev2.matches[row].participantEscorts = escorts;
    commitPlannerMatch(ev2, row, { reconcile: false });
}

// ---------- delegated planner events (bound once) ----------
function onPlannerClick(e) {
    if (e.target.closest("[data-planner-add-match]")) { addMatchRow(); return; }
    if (e.target.closest("[data-planner-new-event]")) { newEventFromPlanner(); return; }
    const btn = e.target.closest("button");
    if (!btn || btn.disabled || btn.matches("[data-drag-handle]")) return;
    const target = plannerTarget(btn);
    if (!target) return;
    const { ev, row, match } = target;

    if (btn.matches("[data-pick-participant]")) {
        openPlannerSuperstarPicker({ row, slot: Number(btn.dataset.slot) });
    } else if (btn.matches("[data-open-escort]")) {
        openPlannerEscortModal({ row, slot: Number(btn.dataset.openEscort) });
    } else if (btn.matches("[data-open-note]")) {
        openPlannerNoteModal({ row, field: btn.dataset.openNote });
    } else if (btn.matches("[data-add-participant]")) {
        if (plannerLockedToast(ev)) return;
        const slots = matchSlotIds(match);
        setMatchSlotIds(match, slots, Math.min(MAX_PARTICIPANT_SLOTS, slots.length + 1));
        commitPlannerMatch(ev, row);
    } else if (btn.matches("[data-remove-participant]")) {
        if (plannerLockedToast(ev)) return;
        const slots = matchSlotIds(match);
        if (slots.length <= MIN_PARTICIPANT_SLOTS) return;
        const removed = slots[slots.length - 1];
        const nextSlots = slots.slice(0, -1);
        setMatchSlotIds(match, nextSlots, nextSlots.length);
        commitPlannerMatch(ev, row);
        if (removed) showToast({ message: `${superstarNameById(removed) || "Superstar"} removed with the slot.`, tone: "info", duration: 2600 });
    } else if (btn.matches("[data-del-row]")) {
        if (plannerLockedToast(ev)) return;
        const snapshot = snapshotState();
        ev.matches.splice(row, 1);
        renumberPlannerMatches(ev.matches);
        upsertEvent(ev);
        renderPlanner(capturePlannerCardPositions());
        offerUndo(`Match ${row + 1} deleted.`, snapshot);
    }
}

function onPlannerFieldChange(e) {
    const field = e.target?.dataset?.field;
    if (!field) return;
    const target = plannerTarget(e.target);
    if (!target) return;
    const { ev, row, match } = target;
    if (plannerLockedToast(ev)) { refreshPlannerMatch(row); return; }
    const value = String(e.target.value ?? "");

    switch (field) {
        case "matchType":
            match.matchType = value;
            if (e.type === "input") { upsertEvent(ev); return; } // typing: save quietly
            commitPlannerMatch(ev, row);
            return;
        case "participantTeam": {
            const pid = matchSlotIds(match)[Number(e.target.dataset.slot)] || "";
            if (!pid) return;
            const teams = normalizedParticipantTeams(match);
            const team = normalizeTeamKey(value);
            if (team) teams[pid] = team; else delete teams[pid];
            match.participantTeams = teams;
            commitPlannerMatch(ev, row);
            return;
        }
        case "result":
            match.result = value;
            commitPlannerMatch(ev, row);
            return;
        case "pinBy":
            match.pinBy = value;
            commitPlannerMatch(ev, row, { reconcile: false, refresh: false });
            return;
        case "championshipId":
            match.championshipId = value;
            commitPlannerMatch(ev, row, { reconcile: false });
            return;
        case "teamName": {
            const names = normalizedTeamNames(match);
            const key = normalizeTeamKey(e.target.dataset.teamKey);
            if (!key) return;
            if (value.trim()) names[key] = value.trim(); else delete names[key];
            match.teamNames = names;
            commitPlannerMatch(ev, row, { reconcile: false });
            return;
        }
        default:
            return;
    }
}

// Drag to reorder: works with mouse, pen and touch via the grip handle.
function onPlannerPointerDown(e) {
    const handle = e.target.closest("[data-drag-handle]");
    if (!handle || handle.disabled) return;
    const target = plannerTarget(handle);
    if (!target || isUniverseDateCompleted(target.ev.date)) return;
    e.preventDefault();
    plannerDrag = { pointerId: e.pointerId, fromIndex: target.row, overIndex: target.row, handle, lastY: e.clientY };
    target.card.classList.add("planner-row-dragging");
    document.body.classList.add("is-reordering");
    try { handle.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    handle.addEventListener("pointermove", onPlannerPointerMove);
    handle.addEventListener("pointerup", onPlannerPointerUp);
    handle.addEventListener("pointercancel", onPlannerPointerUp);
}
function onPlannerPointerMove(e) {
    if (!plannerDrag || plannerDrag.pointerId !== e.pointerId) return;
    plannerDrag.lastY = e.clientY;
    // Auto-scroll near the edges so long cards can still be reordered.
    const edge = 90;
    if (e.clientY < edge) window.scrollBy(0, -14);
    else if (e.clientY > window.innerHeight - edge - 70) window.scrollBy(0, 14);
    const over = document.elementFromPoint(e.clientX, e.clientY)?.closest?.("#plannerCardList .planner-card[data-row]");
    $$("#plannerCardList .planner-row-drop-target").forEach(el => el.classList.remove("planner-row-drop-target"));
    if (!over) return;
    plannerDrag.overIndex = Number(over.dataset.row);
    if (plannerDrag.overIndex !== plannerDrag.fromIndex) over.classList.add("planner-row-drop-target");
}
function onPlannerPointerUp(e) {
    if (!plannerDrag || plannerDrag.pointerId !== e.pointerId) return;
    const { fromIndex, overIndex, handle } = plannerDrag;
    plannerDrag = null;
    document.body.classList.remove("is-reordering");
    handle.removeEventListener("pointermove", onPlannerPointerMove);
    handle.removeEventListener("pointerup", onPlannerPointerUp);
    handle.removeEventListener("pointercancel", onPlannerPointerUp);
    $$("#plannerCardList .planner-row-dragging, #plannerCardList .planner-row-drop-target").forEach(el => {
        el.classList.remove("planner-row-dragging", "planner-row-drop-target");
    });
    if (fromIndex === overIndex) return;
    const ev = getEvent(plannerEventId);
    if (!ev) return;
    const positions = capturePlannerCardPositions();
    if (!movePlannerMatch(ev.matches, fromIndex, overIndex)) return;
    renumberPlannerMatches(ev.matches);
    upsertEvent(ev);
    renderPlanner(positions);
}

(function bindPlannerEvents() {
    const list = $("#plannerCardList");
    if (list) {
        list.addEventListener("click", onPlannerClick);
        list.addEventListener("change", onPlannerFieldChange);
        list.addEventListener("input", e => { if (e.target?.dataset?.field === "matchType") onPlannerFieldChange(e); });
        list.addEventListener("pointerdown", onPlannerPointerDown);
        list.addEventListener("keydown", e => {
            if (e.key === "Enter" && e.target?.dataset?.field === "matchType") e.target.blur();
        });
    }
    $("#plannerEventSelect")?.addEventListener("change", e => {
        plannerEventId = e.target.value || null;
        renderPlanner();
        scheduleUiSessionSave();
    });
    $("#plannerPrevEvent")?.addEventListener("click", () => stepPlannerEvent(-1));
    $("#plannerNextEvent")?.addEventListener("click", () => stepPlannerEvent(1));
    $("#plannerMeta")?.addEventListener("click", () => {
        if (plannerEventId) openCalendarEventDetails(plannerEventId);
    });
})();

function addMatchRow() {
    if (!plannerEventId) return;
    const ev = getEvent(plannerEventId);
    if (!ev) return;
    if (plannerLockedToast(ev)) return;

    ev.matches.push({
        id: uid("match"),
        num: ev.matches.length + 1,
        participants: [],
        participantTeams: {},
        participantEscorts: {},
        teamNames: {},
        participantSlots: MIN_PARTICIPANT_SLOTS,
        matchType: "",
        storyline: "",
        championshipId: "",
        result: "",
        pinBy: "",
        rivalryNotes: "",
    });

    upsertEvent(ev);
    renderPlanner();
    const card = $(`#plannerCardList .planner-card[data-row="${ev.matches.length - 1}"]`);
    card?.scrollIntoView({ behavior: "smooth", block: "center" });
    card?.classList.add("is-new");
}

async function newEventFromPlanner() {
    if (state.shows.length === 0) {
        await openModal({
            title: "Add a show first",
            bodyHTML: `<div class="muted">Create at least one show (RAW/SD/etc.) in Settings so events can be assigned.</div>`,
            okText: "OK",
            hideCancel: true,
        });
        return;
    }
    await addEventFlow(getUniverseCurrentISO());
}

function openPlanner(eventId) {
    plannerEventId = eventId;
    if (currentView === "planner") renderPlanner();
    else setView("planner");
    window.scrollTo({ top: 0, behavior: "instant" });
}

// -------------------- SETTINGS: POPULATE / GENERATE --------------------
const SETTINGS_JSON_EXAMPLE = `{
  "championships": [
    { "name": "World Heavyweight Championship", "division": "World", "gender": "Male", "shows": ["RAW"] },
    { "name": "Women's World Championship", "division": "Women", "gender": "Female", "shows": ["RAW", "SmackDown"] }
  ],
  "shows": [
    { "name": "RAW", "color": "#d00000" },
    { "name": "SmackDown", "color": "#1b5cff" }
  ],
  "roster": [
    { "name": "Gunther", "show": "RAW", "division": "World", "championships": ["World Heavyweight Championship"] },
    { "name": "Becky Lynch", "show": "RAW", "division": "Women" }
  ],
  "ples": [
    { "name": "Backlash", "date": "2026-05-10", "show": "RAW" },
    { "name": "SummerSlam", "date": "2026-08-09" }
  ]
}`;

function looksLikeUniverseSnapshot(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
    const hasCoreStateArrays = Array.isArray(payload.shows)
        && Array.isArray(payload.superstars)
        && Array.isArray(payload.events);
    const hasUniverseProgress = Array.isArray(payload.completedDates)
        || Array.isArray(payload.weeklySchedule)
        || isISODate(payload.universeStartDate);
    return Boolean(payload.version) && hasCoreStateArrays && hasUniverseProgress;
}

function syncUniverseUiState() {
    const universeCurrentISO = getUniverseCurrentISO();
    calSelectedISO = universeCurrentISO;
    calCursor = parseISO(universeCurrentISO);
    calCursor.setDate(1);
    calCursor.setHours(0, 0, 0, 0);
    const sortedEvents = [...state.events].sort((a, b) => a.date.localeCompare(b.date));
    plannerEventId = sortedEvents[0]?.id || null;
}

const settingsUiState = {
    weekly: {
        message: null,
        startDate: "",
        months: "3",
        rows: "6",
    },
    shows: {
        message: null,
        editingId: null,
        deletingId: null,
    },
    championships: {
        message: null,
        editingId: null,
        deletingId: null,
    },
    rivalries: {
        message: null,
        adding: false,
        editingId: null,
        deletingId: null,
        draft: null,
    },
    photos: {
        selectedId: null,
        message: null,
        crop: null,
    },
    bulkPhotos: {
        results: null,
        scanning: false,
        message: null,
    },
};

function settingsStatusHTML(id, message) {
    if (!message?.text) return `<div id="${id}" class="settings-status hidden"></div>`;
    const toneClass = message.tone ? ` ${message.tone}` : "";
    return `<div id="${id}" class="settings-status${toneClass}">${escapeHTML(message.text)}</div>`;
}

function setSettingsStatus(el, text, tone = "info") {
    if (!el) return;
    el.className = `settings-status${tone ? ` ${tone}` : ""}`;
    el.textContent = text;
}

function resetSettingsPanelState(panelKey) {
    if (panelKey === "weekly") {
        settingsUiState.weekly.message = null;
        settingsUiState.weekly.startDate = settingsUiState.weekly.startDate || getUniverseStartISO();
        settingsUiState.weekly.months = settingsUiState.weekly.months || "3";
        settingsUiState.weekly.rows = settingsUiState.weekly.rows || "6";
        return;
    }

    if (panelKey === "shows") {
        settingsUiState.shows.message = null;
        settingsUiState.shows.editingId = null;
        settingsUiState.shows.deletingId = null;
        return;
    }

    if (panelKey === "championships") {
        settingsUiState.championships.message = null;
        settingsUiState.championships.editingId = null;
        settingsUiState.championships.deletingId = null;
        return;
    }

    if (panelKey === "rivalries") {
        settingsUiState.rivalries.message = null;
        settingsUiState.rivalries.adding = false;
        settingsUiState.rivalries.editingId = null;
        settingsUiState.rivalries.deletingId = null;
        settingsUiState.rivalries.draft = null;
    }

    if (panelKey === "photos") {
        settingsUiState.photos = settingsUiState.photos || {};
        settingsUiState.photos.selectedId = state.superstars.some(ss => ss.id === settingsUiState.photos.selectedId)
            ? settingsUiState.photos.selectedId
            : (state.superstars[0]?.id || null);
        settingsUiState.photos.message = null;
        settingsUiState.photos.crop = null;
        return;
    }

    if (panelKey === "bulkPhotos") {
        settingsUiState.bulkPhotos = settingsUiState.bulkPhotos || {};
        settingsUiState.bulkPhotos.results = null;
        settingsUiState.bulkPhotos.scanning = false;
        settingsUiState.bulkPhotos.message = null;
    }
}

async function openSettingsPanel(panelKey) {
    const panels = {
        weekly: { title: "Weekly Calendar Setup", render: renderWeeklySettingsPanel },
        shows: { title: "Manage Shows", render: renderShowsSettingsPanel },
        championships: { title: "Manage Championships", render: renderChampionshipSettingsPanel },
        rivalries: { title: "Rivalries & Storylines", render: renderRivalriesSettingsPanel },
        photos: { title: "Superstar Photos", render: renderSuperstarPhotoSettingsPanel },
        bulkPhotos: { title: "Bulk Photo Scan", render: renderBulkPhotosPanel },
        data: { title: "Import, Export, and Reset", render: renderDataSettingsPanel },
    };
    const panel = panels[panelKey];
    if (!panel) return;

    resetSettingsPanelState(panelKey);
    const modalPromise = openModal({
        title: panel.title,
        bodyHTML: "",
        okText: "Close",
        cancelText: "Close",
        hideCancel: true,
    });
    panel.render();
    await modalPromise;
    renderSettingsTools();
}

function renderSettingsTools() {
    const panels = $("#settingsPanels");
    if (!panels) return;

    const weeklyCount = (state.weeklySchedule || []).filter(row =>
        state.shows.some(s => s.id === row.showId) &&
        Number.isInteger(Number(row.weekday))
    ).length;
    const pleCount = state.events.filter(ev => String(ev?.type || "").toLowerCase() === "ppv").length;
    const activeRivalryCount = (Array.isArray(state.rivalries) ? state.rivalries : [])
        .filter(rivalry => normalizeRivalryStatus(rivalry.status) !== "Ended").length;

    panels.innerHTML = `
      <button class="settings-launch" data-settings-open="weekly">
        <span class="settings-launch-title">Weekly Calendar</span>
        <span class="settings-launch-copy">Assign weekdays to shows and bulk-generate upcoming weekly events.</span>
        <span class="settings-launch-meta">
          <span class="pill">${weeklyCount} scheduled</span>
          <span class="pill">${state.events.length} total events</span>
        </span>
      </button>
      <button class="settings-launch" data-settings-open="shows">
        <span class="settings-launch-title">Shows</span>
        <span class="settings-launch-copy">Add, edit, and remove brands without keeping the full list expanded.</span>
        <span class="settings-launch-meta">
          <span class="pill">${state.shows.length} shows</span>
        </span>
      </button>
      <button class="settings-launch" data-settings-open="championships">
        <span class="settings-launch-title">Championships</span>
        <span class="settings-launch-copy">Manage your active titles in a dedicated panel.</span>
        <span class="settings-launch-meta">
          <span class="pill">${state.championships.length} championships</span>
        </span>
      </button>
      <button class="settings-launch" data-settings-open="rivalries">
        <span class="settings-launch-title">Rivalries & Storylines</span>
        <span class="settings-launch-copy">Track who is feuding, story beats, status, and brand scope.</span>
        <span class="settings-launch-meta">
          <span class="pill">${state.rivalries.length} total</span>
          <span class="pill">${activeRivalryCount} active</span>
        </span>
      </button>
      <button class="settings-launch" data-settings-open="photos">
        <span class="settings-launch-title">Superstar Photos</span>
        <span class="settings-launch-copy">Choose a photo from your device, zoom it, and reposition it to fit the superstar frame.</span>
        <span class="settings-launch-meta">
          <span class="pill">Photo library</span>
          <span class="pill">Crop & resize</span>
        </span>
      </button>
      <button class="settings-launch" data-settings-open="bulkPhotos">
        <span class="settings-launch-title">Bulk Photo Scan</span>
        <span class="settings-launch-copy">Auto-assign superstar photos from your local <code>images/superstars/</code> folder in one tap.</span>
        <span class="settings-launch-meta">
          <span class="pill">${state.superstars.length} superstars</span>
        </span>
      </button>
      <button class="settings-launch" data-settings-open="data">
        <span class="settings-launch-title">Data Tools</span>
        <span class="settings-launch-copy">Import JSON, export backups, and reset the universe when needed.</span>
        <span class="settings-launch-meta">
          <span class="pill">${state.superstars.length} roster</span>
          <span class="pill">${pleCount} PLEs</span>
        </span>
      </button>
    `;

    $$("[data-settings-open]", panels).forEach(btn => {
        btn.onclick = () => {
            openSettingsPanel(btn.dataset.settingsOpen);
        };
    });
}


function readImageFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(reader.error || new Error("Could not read image."));
        reader.readAsDataURL(file);
    });
}

function loadCropImage(source) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("Could not open that image."));
        image.src = source;
    });
}

function drawSuperstarPhotoCrop(canvas, crop) {
    if (!canvas || !crop?.image) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;
    const width = canvas.width;
    const height = canvas.height;
    const image = crop.image;
    const baseScale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
    const scale = baseScale * Number(crop.zoom || 1);
    const drawWidth = image.naturalWidth * scale;
    const drawHeight = image.naturalHeight * scale;
    const maxOffsetX = Math.max(0, (drawWidth - width) / 2);
    const maxOffsetY = Math.max(0, (drawHeight - height) / 2);
    const offsetX = (Number(crop.x || 0) / 100) * maxOffsetX;
    const offsetY = (Number(crop.y || 0) / 100) * maxOffsetY;
    const dx = (width - drawWidth) / 2 + offsetX;
    const dy = (height - drawHeight) / 2 + offsetY;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#111118";
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, dx, dy, drawWidth, drawHeight);
}

function cropCanvasToDataURL(crop) {
    const output = document.createElement("canvas");
    output.width = 512;
    output.height = 512;
    drawSuperstarPhotoCrop(output, crop);
    const webp = output.toDataURL("image/webp", .82);
    return webp.startsWith("data:image/webp") ? webp : output.toDataURL("image/jpeg", .84);
}

async function beginSuperstarPhotoCrop(superstarId, source) {
    try {
        const image = await loadCropImage(source);
        settingsUiState.photos.crop = {
            superstarId,
            source,
            image,
            zoom: 1,
            x: 0,
            y: 0,
        };
        renderSuperstarPhotoCropPanel();
    } catch (error) {
        settingsUiState.photos.message = { tone: "danger", text: error?.message || "Could not open that image." };
        renderSuperstarPhotoSettingsPanel();
    }
}

function renderSuperstarPhotoCropPanel() {
    const crop = settingsUiState.photos.crop;
    const superstar = state.superstars.find(ss => ss.id === crop?.superstarId);
    if (!crop || !superstar) {
        renderSuperstarPhotoSettingsPanel();
        return;
    }

    $(".modal-card")?.classList.add("photo-crop-modal");
    $("#modalBody").innerHTML = `
      <div class="photo-crop-shell">
        <button type="button" class="photo-crop-back" id="photoCropBack">← Back</button>
        <div class="photo-crop-copy">
          <div class="h3" style="margin:0;">Fit ${escapeHTML(superstar.name)} to the frame</div>
          <div class="muted tiny">Use size to zoom, then move the photo horizontally or vertically.</div>
        </div>
        <div class="photo-crop-preview-wrap">
          <canvas id="superstarPhotoCropCanvas" class="photo-crop-canvas" width="640" height="640" aria-label="Photo crop preview"></canvas>
          <div class="photo-crop-frame" aria-hidden="true"></div>
        </div>
        <div class="photo-crop-controls">
          <label class="photo-crop-control"><span>Size</span><input id="photoCropZoom" type="range" min="0.65" max="3" step="0.01" value="${crop.zoom}"></label>
          <label class="photo-crop-control"><span>Horizontal</span><input id="photoCropX" type="range" min="-100" max="100" step="1" value="${crop.x}"></label>
          <label class="photo-crop-control"><span>Vertical</span><input id="photoCropY" type="range" min="-100" max="100" step="1" value="${crop.y}"></label>
        </div>
        <div class="photo-crop-actions">
          <button type="button" class="btn secondary" id="photoCropReset">Reset</button>
          <button type="button" class="btn" id="photoCropSave">Save Photo</button>
        </div>
      </div>
    `;

    const canvas = $("#superstarPhotoCropCanvas");
    let drawPending = false;
    const scheduleDraw = () => {
        if (drawPending) return;
        drawPending = true;
        requestAnimationFrame(() => {
            drawPending = false;
            drawSuperstarPhotoCrop(canvas, crop);
        });
    };
    const bindRange = (selector, key) => {
        $(selector)?.addEventListener("input", e => {
            crop[key] = Number(e.target.value);
            scheduleDraw();
        });
    };
    bindRange("#photoCropZoom", "zoom");
    bindRange("#photoCropX", "x");
    bindRange("#photoCropY", "y");

    $("#photoCropReset")?.addEventListener("click", () => {
        crop.zoom = 1;
        crop.x = 0;
        crop.y = 0;
        $("#photoCropZoom").value = "1";
        $("#photoCropX").value = "0";
        $("#photoCropY").value = "0";
        scheduleDraw();
    });
    $("#photoCropBack")?.addEventListener("click", () => {
        settingsUiState.photos.crop = null;
        $(".modal-card")?.classList.remove("photo-crop-modal");
        renderSuperstarPhotoSettingsPanel();
    });
    $("#photoCropSave")?.addEventListener("click", async e => {
        const button = e.currentTarget;
        button.disabled = true;
        button.textContent = "Saving…";
        const dataURL = cropCanvasToDataURL(crop);
        let storedPhoto = dataURL;
        try {
            storedPhoto = await savePhotoToVault(superstar.id, dataURL);
        } catch (error) {
            console.warn("Photo vault unavailable; using local save fallback.", error);
        }
        state.superstars = state.superstars.map(ss => ss.id === superstar.id ? { ...ss, photo: storedPhoto } : ss);
        settingsUiState.photos.crop = null;
        settingsUiState.photos.selectedId = superstar.id;
        settingsUiState.photos.message = { tone: "success", text: `Photo saved for ${superstar.name}.` };
        saveSoon();
        renderRoster();
        renderDashboard();
        renderPlanner();
        $(".modal-card")?.classList.remove("photo-crop-modal");
        renderSuperstarPhotoSettingsPanel();
    });
    scheduleDraw();
}

function renderSuperstarPhotoSettingsPanel() {
    const modalBody = $("#modalBody");
    if (!modalBody) return;
    $(".modal-card")?.classList.remove("photo-crop-modal");
    if (!state.superstars.length) {
        modalBody.innerHTML = `<div class="settings-status info">Add a superstar to the roster before assigning photos.</div>`;
        return;
    }

    const selectedId = state.superstars.some(ss => ss.id === settingsUiState.photos.selectedId)
        ? settingsUiState.photos.selectedId
        : state.superstars[0].id;
    settingsUiState.photos.selectedId = selectedId;
    const superstar = state.superstars.find(ss => ss.id === selectedId);
    const photo = superstarPhotoURL(superstar);
    const canAdjustCurrent = photo.startsWith("data:image/");

    modalBody.innerHTML = `
      <div class="superstar-photo-settings">
        ${settingsStatusHTML("superstarPhotoStatus", settingsUiState.photos.message)}
        <div class="superstar-photo-picker-row">
          <label class="edit-ss-label" for="settingsPhotoSuperstar">Superstar</label>
          <select id="settingsPhotoSuperstar" class="input">
            ${state.superstars.slice().sort((a, b) => a.name.localeCompare(b.name)).map(ss => `<option value="${escapeAttr(ss.id)}" ${ss.id === selectedId ? "selected" : ""}>${escapeHTML(ss.name)}</option>`).join("")}
          </select>
        </div>
        <div class="superstar-photo-current-card">
          <div class="superstar-photo-current-frame">
            ${photo
              ? `<img src="${escapeAttr(photo)}" alt="${escapeAttr(superstar.name)}" loading="eager" decoding="async" />`
              : `<div class="superstar-photo-current-fallback">${escapeHTML(superstarInitials(superstar.name))}</div>`}
          </div>
          <div class="superstar-photo-current-copy">
            <div class="item-title">${escapeHTML(superstar.name)}</div>
            <div class="muted tiny">Photos chosen here are cropped to a square, compressed for mobile, and saved with your local universe data.</div>
          </div>
        </div>
        <div class="superstar-photo-actions">
          <label class="btn superstar-photo-library-btn">
            Choose from Photo Library
            <input id="settingsPhotoLibraryInput" type="file" accept="image/*" />
          </label>
          ${canAdjustCurrent ? `<button type="button" class="btn secondary" id="settingsPhotoAdjustCurrent">Adjust current photo</button>` : ""}
          ${photo ? `<button type="button" class="btn danger" id="settingsPhotoRemove">Remove photo</button>` : ""}
        </div>
        <div class="settings-status info">Tip: pinch gestures are not required. Use the Size, Horizontal, and Vertical sliders for precise framing.</div>
      </div>
    `;
    optimizeImages(modalBody);

    $("#settingsPhotoSuperstar")?.addEventListener("change", e => {
        settingsUiState.photos.selectedId = e.target.value;
        settingsUiState.photos.message = null;
        renderSuperstarPhotoSettingsPanel();
    });
    $("#settingsPhotoLibraryInput")?.addEventListener("change", async e => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (!String(file.type || "").startsWith("image/")) {
            settingsUiState.photos.message = { tone: "danger", text: "Choose an image file." };
            renderSuperstarPhotoSettingsPanel();
            return;
        }
        if (file.size > 15 * 1024 * 1024) {
            settingsUiState.photos.message = { tone: "danger", text: "That photo is too large. Choose an image under 15 MB." };
            renderSuperstarPhotoSettingsPanel();
            return;
        }
        settingsUiState.photos.message = { tone: "info", text: "Opening photo editor…" };
        const source = await readImageFileAsDataURL(file);
        await beginSuperstarPhotoCrop(selectedId, source);
    });
    $("#settingsPhotoAdjustCurrent")?.addEventListener("click", () => beginSuperstarPhotoCrop(selectedId, photo));
    $("#settingsPhotoRemove")?.addEventListener("click", async () => {
        await deletePhotoFromVault(selectedId).catch(() => {});
        state.superstars = state.superstars.map(ss => ss.id === selectedId ? { ...ss, photo: "" } : ss);
        settingsUiState.photos.message = { tone: "success", text: `Photo removed from ${superstar.name}.` };
        saveSoon();
        renderRoster();
        renderDashboard();
        renderPlanner();
        renderSuperstarPhotoSettingsPanel();
    });
}

function readRivalryFormDraft() {
    const participantIds = Array.from(new Set($$(".rivalryParticipantItem:checked").map(el => el.value)));
    const showIds = Array.from(new Set($$(".rivalryShowItem:checked").map(el => el.value)));
    return {
        title: "",
        showIds,
        participantIds,
        status: normalizeRivalryStatus($("#rivalryStatusInput")?.value),
        startDate: $("#rivalryStartDateInput")?.value || "",
        endDate: $("#rivalryEndDateInput")?.value || "",
        summary: $("#rivalrySummaryInput")?.value.trim() || "",
        notes: $("#rivalryNotesInput")?.value.trim() || "",
    };
}

function saveRivalryFromSettingsForm() {
    const existingId = settingsUiState.rivalries.editingId;
    const existing = existingId ? state.rivalries.find(rivalry => rivalry.id === existingId) : null;
    const draft = readRivalryFormDraft();

    if (draft.participantIds.length < 2) {
        settingsUiState.rivalries.message = { tone: "danger", text: "Pick at least two superstars before saving a rivalry." };
        settingsUiState.rivalries.draft = draft;
        renderRivalriesSettingsPanel();
        return false;
    }

    const nextRivalry = {
        id: existing?.id || uid("riv"),
        title: draft.participantIds.map(id => state.superstars.find(ss => ss.id === id)?.name).filter(Boolean).join(" vs "),
        showIds: draft.showIds,
        showId: draft.showIds[0] ?? null,
        participantIds: draft.participantIds,
        status: draft.status,
        startDate: isISODate(draft.startDate) ? draft.startDate : "",
        endDate: isISODate(draft.endDate) ? draft.endDate : "",
        summary: draft.summary,
        notes: draft.notes,
    };

    if (existing) {
        state.rivalries = state.rivalries.map(rivalry => rivalry.id === existing.id ? nextRivalry : rivalry);
    } else {
        state.rivalries.push(nextRivalry);
    }

    settingsUiState.rivalries.message = { tone: "success", text: `${rivalryDisplayTitle(nextRivalry)} saved.` };
    settingsUiState.rivalries.adding = false;
    settingsUiState.rivalries.editingId = null;
    settingsUiState.rivalries.deletingId = null;
    settingsUiState.rivalries.draft = null;
    saveSoon();
    renderRivalriesSettingsPanel();
    return true;
}

function renderRivalriesSettingsPanel() {
    const root = $("#modalBody");
    if (!root) return;

    const editingRivalry = settingsUiState.rivalries.editingId
        ? state.rivalries.find(rivalry => rivalry.id === settingsUiState.rivalries.editingId)
        : null;
    const showEditor = settingsUiState.rivalries.adding || Boolean(editingRivalry);
    const editorRivalry = settingsUiState.rivalries.draft || editingRivalry || {};

    root.innerHTML = `
      <div id="settingsRivalriesPanel" class="stack rivalry-view">
        <div class="muted tiny">Open rivalries from Settings, then track the people feuding, their status, story beats, and assigned show.</div>
        ${settingsStatusHTML("settingsRivalriesStatus", settingsUiState.rivalries.message)}
        <div class="card rivalry-toolbar-card">
          <div class="card-body rivalry-toolbar">
            <div class="rivalry-filters">
              <select id="rivalryShowFilter" class="input"></select>
              <select id="rivalryStatusFilter" class="input">
                <option value="all">All statuses</option>
                ${RIVALRY_STATUS_OPTIONS.map(status => `<option value="${status}">${status}</option>`).join("")}
              </select>
              <input id="rivalrySearch" class="input" placeholder="Search..." />
            </div>
            <button id="openAddRivalryModal" class="btn">Add Rivalry</button>
          </div>
        </div>
        ${showEditor ? `
          <div class="card rivalry-editor-card">
            <div class="card-title">${editingRivalry ? "Edit Rivalry" : "Add Rivalry"}</div>
            <div class="card-body stack">
              ${rivalryFormHTML(editorRivalry)}
              <div class="item-actions rivalry-actions">
                <button class="btn" id="settingsSaveRivalry">${editingRivalry ? "Save Rivalry" : "Add Rivalry"}</button>
                <button class="btn secondary" id="settingsCancelRivalry">Cancel</button>
              </div>
            </div>
          </div>
        ` : ""}
        <div class="card rivalry-board-card">
          <div class="card-title">Rivalries & Storylines</div>
          <div id="rivalriesList" class="card-body"></div>
        </div>
      </div>
    `;

    renderRivalries();

    $("#openAddRivalryModal", root)?.addEventListener("click", () => {
        settingsUiState.rivalries.message = null;
        settingsUiState.rivalries.adding = true;
        settingsUiState.rivalries.editingId = null;
        settingsUiState.rivalries.deletingId = null;
        settingsUiState.rivalries.draft = null;
        renderRivalriesSettingsPanel();
    });
    $("#settingsSaveRivalry", root)?.addEventListener("click", saveRivalryFromSettingsForm);
    $("#settingsCancelRivalry", root)?.addEventListener("click", () => {
        settingsUiState.rivalries.message = null;
        settingsUiState.rivalries.adding = false;
        settingsUiState.rivalries.editingId = null;
        settingsUiState.rivalries.deletingId = null;
        settingsUiState.rivalries.draft = null;
        renderRivalriesSettingsPanel();
    });
    $("#rivalrySearch", root)?.addEventListener("input", () => renderRivalries());
    $("#rivalryStatusFilter", root)?.addEventListener("change", () => renderRivalries());
}

function renderWeeklySettingsPanel() {
    const root = $("#modalBody");
    if (!root) return;

    settingsUiState.weekly.startDate = settingsUiState.weekly.startDate || getUniverseStartISO();
    settingsUiState.weekly.months = settingsUiState.weekly.months || "3";
    settingsUiState.weekly.rows = settingsUiState.weekly.rows || "6";

    const weeklyMap = new Map((state.weeklySchedule || []).map(row => [row.showId, row.weekday]));
    const weeklyListHTML = !state.shows.length
        ? `<div class="item"><div class="muted tiny">Add shows first, then assign each show to a weekday here.</div></div>`
        : `
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

    root.innerHTML = `
      <div class="stack">
        <div class="muted tiny">Pick a weekday for each show, then generate weekly events onto the calendar.</div>
        ${settingsStatusHTML("settingsWeeklyStatus", settingsUiState.weekly.message)}
        ${weeklyListHTML}
        <div class="weekly-controls">
          <label class="stack weekly-control weekly-control-date">
            <span class="muted tiny">Start date</span>
            <input id="settingsWeeklyStartDate" class="input" type="date" value="${escapeAttr(settingsUiState.weekly.startDate)}" />
          </label>
          <label class="stack weekly-control weekly-control-months">
            <span class="muted tiny">Months</span>
            <input id="settingsWeeklyMonths" class="input" type="number" min="1" max="24" value="${escapeAttr(settingsUiState.weekly.months)}" />
          </label>
          <label class="stack weekly-control weekly-control-rows">
            <span class="muted tiny">Rows per show</span>
            <input id="settingsWeeklyRows" class="input" type="number" min="0" max="20" value="${escapeAttr(settingsUiState.weekly.rows)}" />
          </label>
          <button class="btn weekly-generate-btn" id="settingsGenerateWeeklyBtn">Populate Calendar</button>
        </div>
      </div>
    `;

    $$("[data-weekly-show]", root).forEach(sel => {
        sel.onchange = () => {
            const showId = sel.dataset.weeklyShow;
            const weekday = Number(sel.value);
            state.weeklySchedule = (state.weeklySchedule || []).filter(row => row.showId !== showId);
            if (weekday >= 0 && weekday <= 6) {
                state.weeklySchedule.push({ showId, weekday });
            }
            saveSoon();
            renderSettingsTools();
        };
    });

    const weeklyStartDate = $("#settingsWeeklyStartDate", root);
    const weeklyMonths = $("#settingsWeeklyMonths", root);
    const weeklyRows = $("#settingsWeeklyRows", root);
    const generateWeeklyBtn = $("#settingsGenerateWeeklyBtn", root);

    weeklyStartDate.oninput = () => {
        settingsUiState.weekly.startDate = weeklyStartDate.value || getUniverseStartISO();
    };
    weeklyMonths.oninput = () => {
        settingsUiState.weekly.months = weeklyMonths.value || "3";
    };
    weeklyRows.oninput = () => {
        settingsUiState.weekly.rows = weeklyRows.value || "6";
    };

    generateWeeklyBtn.onclick = () => {
        settingsUiState.weekly.startDate = weeklyStartDate.value || getUniverseStartISO();
        settingsUiState.weekly.months = weeklyMonths.value || "3";
        settingsUiState.weekly.rows = weeklyRows.value || "6";

        const rules = (state.weeklySchedule || []).filter(row =>
            state.shows.some(s => s.id === row.showId) &&
            Number.isInteger(Number(row.weekday)) &&
            Number(row.weekday) >= 0 &&
            Number(row.weekday) <= 6
        ).map(row => ({ showId: row.showId, weekday: Number(row.weekday) }));

        if (!rules.length) {
            settingsUiState.weekly.message = {
                tone: "danger",
                text: "Set at least one show to a weekday first.",
            };
            renderWeeklySettingsPanel();
            return;
        }

        const startISO = settingsUiState.weekly.startDate || getUniverseStartISO();
        const months = Math.max(1, Math.min(24, Number(settingsUiState.weekly.months) || 3));
        const defaultRows = Math.max(0, Math.min(20, Number(settingsUiState.weekly.rows) || 6));
        const beforeCount = state.events.length;

        generateWeeklyEvents({ startISO, months, rules, defaultRows });
        const added = state.events.length - beforeCount;
        settingsUiState.weekly.message = {
            tone: "success",
            text: `Added ${added} weekly events from ${startISO} for ${months} month(s).`,
        };
        renderAll();
        renderWeeklySettingsPanel();
    };
}

function renderShowsSettingsPanel() {
    const root = $("#modalBody");
    if (!root) return;

    root.innerHTML = `
      <div class="stack">
        <div class="row gap wrap">
          <input id="settingsShowNameInput" class="input grow" placeholder="Show name (RAW, SmackDown, NXT…)" />
          <input id="settingsShowColorInput" class="input" type="color" value="#d00000" title="Show Color" />
          <button class="btn" id="settingsAddShowBtn">Add Show</button>
        </div>
        ${settingsStatusHTML("settingsShowsStatus", settingsUiState.shows.message)}
        <div id="settingsShowsList" class="stack">
          ${!state.shows.length ? `<div class="item"><div class="muted tiny">No shows yet. Add one above.</div></div>` : `
            <div class="list">
              ${state.shows.map(show => {
                const isEditing = settingsUiState.shows.editingId === show.id;
                const isDeleting = settingsUiState.shows.deletingId === show.id;
                return `
                  <div class="item">
                    <div class="item-title">
                      <span class="badge"><span class="dot" style="background:${show.color}"></span>${escapeHTML(show.name)}</span>
                    </div>
                    <div class="item-sub">Color: ${escapeHTML(show.color)}</div>
                    <div class="item-actions">
                      <button class="btn secondary" data-settings-edit-show="${show.id}">${isEditing ? "Cancel" : "Edit"}</button>
                      <button class="btn danger" data-settings-del-show="${show.id}">${isDeleting ? "Cancel Delete" : "Delete"}</button>
                    </div>
                    ${isEditing ? `
                      <div class="settings-inline-edit stack">
                        <div class="row gap wrap">
                          <input class="input grow" data-settings-show-name="${show.id}" value="${escapeAttr(show.name)}" placeholder="Show name" />
                          <input class="input" type="color" data-settings-show-color="${show.id}" value="${escapeAttr(show.color || "#d00000")}" />
                        </div>
                        <div class="row gap wrap">
                          <button class="btn" data-settings-save-show="${show.id}">Save</button>
                        </div>
                      </div>
                    ` : ""}
                    ${isDeleting ? `
                      <div class="settings-confirm-row">
                        <div class="muted tiny">Delete ${escapeHTML(show.name)}? Superstars become unassigned and old events keep the show reference.</div>
                        <div class="row gap wrap">
                          <button class="btn danger" data-settings-confirm-del-show="${show.id}">Confirm Delete</button>
                          <button class="btn secondary" data-settings-cancel-del-show="${show.id}">Keep Show</button>
                        </div>
                      </div>
                    ` : ""}
                  </div>
                `;
              }).join("")}
            </div>
          `}
        </div>
      </div>
    `;

    const status = $("#settingsShowsStatus", root);
    $("#settingsAddShowBtn", root).onclick = () => {
        const nameInput = $("#settingsShowNameInput", root);
        const colorInput = $("#settingsShowColorInput", root);
        const name = nameInput.value.trim();
        const color = colorInput.value || "#d00000";

        const result = addShowByNameColor(name, color);
        if (!result.ok) {
            if (result.reason === "duplicate_name") {
                setSettingsStatus(status, "A show with that name already exists.", "danger");
            } else if (!name) {
                setSettingsStatus(status, "Enter a show name before adding it.", "danger");
            }
            return;
        }

        settingsUiState.shows.message = { tone: "success", text: `${name} added.` };
        settingsUiState.shows.editingId = null;
        settingsUiState.shows.deletingId = null;
        saveSoon();
        renderAll();
        renderShowsSettingsPanel();
    };

    $$("[data-settings-edit-show]", root).forEach(btn => {
        btn.onclick = () => {
            const id = btn.dataset.settingsEditShow;
            settingsUiState.shows.editingId = settingsUiState.shows.editingId === id ? null : id;
            settingsUiState.shows.deletingId = null;
            settingsUiState.shows.message = null;
            renderShowsSettingsPanel();
        };
    });

    $$("[data-settings-save-show]", root).forEach(btn => {
        btn.onclick = () => {
            const id = btn.dataset.settingsSaveShow;
            const show = getShow(id);
            if (!show) return;

            const nameInput = $(`[data-settings-show-name="${id}"]`, root);
            const colorInput = $(`[data-settings-show-color="${id}"]`, root);
            const nextName = nameInput.value.trim();
            const nextColor = normalizeHexColor(colorInput.value) || "#d00000";

            if (!nextName) {
                setSettingsStatus(status, "Show name cannot be empty.", "danger");
                return;
            }

            const duplicate = state.shows.find(s => s.id !== id && s.name.toLowerCase() === nextName.toLowerCase());
            if (duplicate) {
                setSettingsStatus(status, "A show with that name already exists.", "danger");
                return;
            }

            state.shows = state.shows.map(s => s.id === id ? { ...s, name: nextName, color: nextColor } : s);
            settingsUiState.shows.message = { tone: "success", text: `${nextName} updated.` };
            settingsUiState.shows.editingId = null;
            saveSoon();
            renderAll();
            renderShowsSettingsPanel();
        };
    });

    $$("[data-settings-del-show]", root).forEach(btn => {
        btn.onclick = () => {
            const id = btn.dataset.settingsDelShow;
            settingsUiState.shows.deletingId = settingsUiState.shows.deletingId === id ? null : id;
            settingsUiState.shows.editingId = null;
            settingsUiState.shows.message = null;
            renderShowsSettingsPanel();
        };
    });

    $$("[data-settings-cancel-del-show]", root).forEach(btn => {
        btn.onclick = () => {
            settingsUiState.shows.deletingId = null;
            renderShowsSettingsPanel();
        };
    });

    $$("[data-settings-confirm-del-show]", root).forEach(btn => {
        btn.onclick = () => {
            const id = btn.dataset.settingsConfirmDelShow;
            const show = getShow(id);
            if (!show) return;

            deleteShowAndUnassign(id);
            settingsUiState.shows.message = { tone: "success", text: `${show.name} deleted.` };
            settingsUiState.shows.deletingId = null;
            saveSoon();
            renderAll();
            renderShowsSettingsPanel();
        };
    });
}

function renderChampionshipSettingsPanel() {
    const root = $("#modalBody");
    if (!root) return;
    const renderShowAssignmentOptions = ({ inputClass, selectedShowIds = [], dataTitleId = "" } = {}) => {
        if (!state.shows.length) {
            return `<div class="muted tiny">No shows created yet. Leave this unassigned to keep it available everywhere.</div>`;
        }
        const selected = new Set(selectedShowIds);
        return state.shows.map(show => `
            <label class="championship-settings-show-option">
              <input
                class="${escapeAttr(inputClass)}"
                ${dataTitleId ? `data-title-id="${escapeAttr(dataTitleId)}"` : ""}
                type="checkbox"
                value="${show.id}"
                ${selected.has(show.id) ? "checked" : ""}
              />
              <span>${escapeHTML(show.name)}</span>
            </label>
          `).join("");
    };
    const renderShowScopeText = (championship) => {
        const shows = championshipShowNames(championship);
        return shows.length ? shows.join(", ") : "All shows";
    };
    const renderScopePills = (championship) => `
        <div class="championship-settings-pills">
          <span class="championship-settings-pill">${escapeHTML(championshipDivisionLabel(normalizeChampionshipDivision(championship.division, championship.name, championship.gender)))}</span>
          <span class="championship-settings-pill">${escapeHTML(normalizeChampionshipGender(championship.gender))}</span>
          <span class="championship-settings-pill">${escapeHTML(renderShowScopeText(championship))}</span>
        </div>
    `;

    root.innerHTML = `
      <div class="stack championship-settings-panel">
        <div class="championship-settings-shell">
          <div class="championship-settings-header">
            <div>
              <div class="h3">Add Championship</div>
              <div class="muted tiny">Create a title, classify it for display, and decide which shows can book it.</div>
            </div>
            <button class="btn" id="addChampionshipBtn">Add Championship</button>
          </div>
          <div class="championship-settings-grid">
            <label class="championship-settings-field">
              <span class="championship-settings-label">Championship Name</span>
              <input id="championshipNameInput" class="input" placeholder="Intercontinental Championship" />
            </label>
            <label class="championship-settings-field championship-settings-field-compact">
              <span class="championship-settings-label">Board Division</span>
              <select id="championshipDivisionInput" class="input">
                ${CHAMPIONSHIP_DIVISION_OPTIONS.map(division => `<option value="${division}">${escapeHTML(championshipDivisionLabel(division))}</option>`).join("")}
              </select>
            </label>
            <label class="championship-settings-field championship-settings-field-compact">
              <span class="championship-settings-label">Display Gender</span>
              <select id="championshipGenderInput" class="input">
                ${CHAMPIONSHIP_GENDER_OPTIONS.map(gender => `<option value="${gender}">${gender}</option>`).join("")}
              </select>
            </label>
          </div>
          <div class="championship-settings-scope">
            <div class="championship-settings-scope-head">
              <div class="championship-settings-label">Assigned Shows</div>
              <div class="muted tiny">Leave all shows unchecked to allow every brand.</div>
            </div>
            <div class="championship-settings-show-grid">
              ${renderShowAssignmentOptions({ inputClass: "settingsChampionshipShowItem" })}
            </div>
          </div>
        </div>
        ${settingsStatusHTML("settingsChampionshipStatus", settingsUiState.championships.message)}
        <div id="championshipsList" class="stack">
          ${!state.championships.length ? `<div class="item"><div class="muted tiny">No championships yet. Add one above.</div></div>` : `
            <div class="list championship-settings-list">
              ${state.championships.map(championship => {
                const isEditing = settingsUiState.championships.editingId === championship.id;
                const isDeleting = settingsUiState.championships.deletingId === championship.id;
                return `
                  <div class="item championship-settings-item ${isEditing ? "is-editing" : ""}">
                    <div class="championship-settings-item-head">
                      <div class="championship-settings-item-copy">
                        <div class="item-title">${escapeHTML(championship.name)}</div>
                        <div class="item-sub">${escapeHTML(championshipScopeSummary(championship))}</div>
                        ${renderScopePills(championship)}
                      </div>
                      <div class="item-actions championship-settings-actions">
                        <button class="btn secondary" data-champ-history="${championship.id}">View History</button>
                        <button class="btn secondary" data-edit-title="${championship.id}">${isEditing ? "Cancel" : "Edit"}</button>
                        <button class="btn danger" data-del-title="${championship.id}">${isDeleting ? "Cancel Delete" : "Delete"}</button>
                      </div>
                    </div>
                    ${isEditing ? `
                      <div class="settings-inline-edit championship-settings-editor">
                        <div class="championship-settings-grid">
                          <label class="championship-settings-field">
                            <span class="championship-settings-label">Championship Name</span>
                            <input class="input" data-settings-title-name="${championship.id}" value="${escapeAttr(championship.name)}" />
                          </label>
                          <label class="championship-settings-field championship-settings-field-compact">
                            <span class="championship-settings-label">Board Division</span>
                            <select class="input" data-settings-title-division="${championship.id}">
                              ${CHAMPIONSHIP_DIVISION_OPTIONS.map(division => `<option value="${division}" ${division === normalizeChampionshipDivision(championship.division, championship.name, championship.gender) ? "selected" : ""}>${escapeHTML(championshipDivisionLabel(division))}</option>`).join("")}
                            </select>
                          </label>
                          <label class="championship-settings-field championship-settings-field-compact">
                            <span class="championship-settings-label">Display Gender</span>
                            <select class="input" data-settings-title-gender="${championship.id}">
                              ${CHAMPIONSHIP_GENDER_OPTIONS.map(gender => `<option value="${gender}" ${gender === normalizeChampionshipGender(championship.gender) ? "selected" : ""}>${gender}</option>`).join("")}
                            </select>
                          </label>
                        </div>
                        <div class="championship-settings-scope">
                          <div class="championship-settings-scope-head">
                            <div class="championship-settings-label">Assigned Shows</div>
                            <div class="muted tiny">Leave all shows unchecked to keep this title available on every show.</div>
                          </div>
                          <div class="championship-settings-show-grid">
                            ${renderShowAssignmentOptions({
                                inputClass: "settingsEditTitleShowItem",
                                selectedShowIds: Array.isArray(championship.showIds) ? championship.showIds : [],
                                dataTitleId: championship.id,
                            })}
                          </div>
                        </div>
                        <div class="championship-settings-editor-actions">
                          <button class="btn" data-settings-save-title="${championship.id}">Save Changes</button>
                        </div>
                      </div>
                    ` : ""}
                    ${isDeleting ? `
                      <div class="settings-confirm-row">
                        <div class="muted tiny">Delete ${escapeHTML(championship.name)}? This removes it from every superstar.</div>
                        <div class="row gap wrap">
                          <button class="btn danger" data-settings-confirm-del-title="${championship.id}">Confirm Delete</button>
                          <button class="btn secondary" data-settings-cancel-del-title="${championship.id}">Keep Championship</button>
                        </div>
                      </div>
                    ` : ""}
                  </div>
                `;
              }).join("")}
            </div>
          `}
        </div>
      </div>
    `;

    const status = $("#settingsChampionshipStatus", root);
    $("#addChampionshipBtn", root).onclick = () => {
        const input = $("#championshipNameInput", root);
        const divisionInput = $("#championshipDivisionInput", root);
        const genderInput = $("#championshipGenderInput", root);
        const name = input.value.trim();
        if (!name) {
            setSettingsStatus(status, "Enter a championship name before adding it.", "danger");
            return;
        }

        const added = addChampionshipByName(name, {
            division: divisionInput?.value || "World",
            gender: genderInput?.value || "Intergender",
            showIds: $$(".settingsChampionshipShowItem:checked", root).map(el => el.value),
        });
        if (!added) {
            setSettingsStatus(status, "A championship with that name already exists.", "danger");
            return;
        }

        settingsUiState.championships.message = { tone: "success", text: `${name} added.` };
        settingsUiState.championships.editingId = null;
        settingsUiState.championships.deletingId = null;
        saveSoon();
        renderAll();
        renderChampionshipSettingsPanel();
    };

    $$("[data-edit-title]", root).forEach(btn => {
        btn.onclick = () => {
            const id = btn.dataset.editTitle;
            settingsUiState.championships.editingId = settingsUiState.championships.editingId === id ? null : id;
            settingsUiState.championships.deletingId = null;
            settingsUiState.championships.message = null;
            renderChampionshipSettingsPanel();
        };
    });

    $$("[data-champ-history]", root).forEach(btn => {
        btn.onclick = () => openChampionshipHistoryModal(btn.dataset.champHistory);
    });

    $$("[data-settings-save-title]", root).forEach(btn => {
        btn.onclick = () => {
            const id = btn.dataset.settingsSaveTitle;
            const championship = getChampionship(id);
            if (!championship) return;

            const nameInput = $(`[data-settings-title-name="${id}"]`, root);
            const divisionInput = $(`[data-settings-title-division="${id}"]`, root);
            const genderInput = $(`[data-settings-title-gender="${id}"]`, root);
            const nextName = nameInput.value.trim();
            const nextDivision = normalizeChampionshipDivision(divisionInput?.value, nextName, genderInput?.value);
            const nextGender = normalizeChampionshipGender(genderInput?.value);
            const nextShowIds = sanitizeShowIds(
                $$(`.settingsEditTitleShowItem[data-title-id="${id}"]:checked`, root).map(el => el.value)
            );
            if (!nextName) {
                setSettingsStatus(status, "Championship name cannot be empty.", "danger");
                return;
            }

            const duplicate = state.championships.find(c => c.id !== id && c.name.toLowerCase() === nextName.toLowerCase());
            if (duplicate) {
                setSettingsStatus(status, "A championship with that name already exists.", "danger");
                return;
            }

            state.championships = state.championships.map(c => c.id === id ? {
                ...c,
                name: nextName,
                division: nextDivision,
                gender: nextGender,
                showIds: nextShowIds,
                showId: nextShowIds[0] ?? null,
            } : c);
            const scrubbedAssignments = scrubIneligibleChampionshipAssignments();
            settingsUiState.championships.message = {
                tone: "success",
                text: scrubbedAssignments
                    ? `${nextName} updated. Ineligible holders or booked title matches were cleared.`
                    : `${nextName} updated.`,
            };
            settingsUiState.championships.editingId = null;
            saveSoon();
            renderAll();
            renderChampionshipSettingsPanel();
        };
    });

    $$("[data-del-title]", root).forEach(btn => {
        btn.onclick = () => {
            const id = btn.dataset.delTitle;
            settingsUiState.championships.deletingId = settingsUiState.championships.deletingId === id ? null : id;
            settingsUiState.championships.editingId = null;
            settingsUiState.championships.message = null;
            renderChampionshipSettingsPanel();
        };
    });

    $$("[data-settings-cancel-del-title]", root).forEach(btn => {
        btn.onclick = () => {
            settingsUiState.championships.deletingId = null;
            renderChampionshipSettingsPanel();
        };
    });

    $$("[data-settings-confirm-del-title]", root).forEach(btn => {
        btn.onclick = () => {
            const id = btn.dataset.settingsConfirmDelTitle;
            const championship = getChampionship(id);
            if (!championship) return;

            state.championships = state.championships.filter(c => c.id !== id);
            state.superstars = state.superstars.map(ss => {
                const nextChamps = parseChampionships(ss.championships).filter(chId => chId !== id);
                return { ...ss, championships: nextChamps, isChampion: nextChamps.length > 0 };
            });
            settingsUiState.championships.message = { tone: "success", text: `${championship.name} deleted.` };
            settingsUiState.championships.deletingId = null;
            saveSoon();
            renderAll();
            renderChampionshipSettingsPanel();
        };
    });
}

// -------------------- BULK PHOTO SCAN --------------------
// Generates many candidate filename slugs per name and tests each via fetch HEAD.
// File found = assign. The folder is treated as the source of truth: existing
// path values are overwritten when the scan finds a match. External http(s) URLs
// without a local match are preserved.

const SUPERSTAR_PHOTO_FOLDER = "images/superstars/";
const SCAN_EXTENSIONS = ["png", "jpg", "jpeg", "webp"];

// Strip diacritics: "Andradé" → "Andrade"
function stripDiacritics(s) {
    return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

// Generate a comprehensive set of candidate filename stems for a name.
// Returns an ordered list (most-specific first).
// Generate filename candidates following the convention:
//   - Single-word name → "Name.png" (try a few case variants)
//   - Multi-word name  → "First-Last.png" (kebab, try a few case variants)
//
// We only try case variants — the structure itself is locked. If your file
// doesn't match the convention, rename the file.
function generateFilenameCandidates(name) {
    const cleaned = stripDiacritics(String(name || "")).trim();
    if (!cleaned) return [];
    const words = cleaned.split(/\s+/).map(w => w.replace(/['.,!?"]/g, "")).filter(Boolean);
    if (!words.length) return [];

    const out = [];
    const add = (s) => { if (s && !out.includes(s)) out.push(s); };

    if (words.length === 1) {
        const w = words[0];
        // "Name.png" — lowercase, Title-case, UPPERCASE, original-case
        add(w.toLowerCase());
        add(w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
        add(w.toUpperCase());
        add(w); // original
    } else {
        // "First-Last.png" — join all words with hyphens, try a few case variants
        const lower = words.map(w => w.toLowerCase()).join("-");
        const title = words.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join("-");
        const upper = words.map(w => w.toUpperCase()).join("-");
        const original = words.join("-"); // preserves original case
        add(lower);
        add(title);
        add(upper);
        add(original);
    }
    return out;
}

// Test whether a candidate image exists. Image loading is used instead of HEAD
// because many local development servers return 404/405 for HEAD even when a
// normal browser image request succeeds.
const superstarPhotoProbeCache = new Map();
function probeFile(url) {
    const cleanUrl = String(url || "").trim();
    if (!cleanUrl) return Promise.resolve("");
    if (superstarPhotoProbeCache.has(cleanUrl)) return superstarPhotoProbeCache.get(cleanUrl);

    const pending = new Promise(resolve => {
        const image = new Image();
        let settled = false;
        const finish = value => {
            if (settled) return;
            settled = true;
            clearTimeout(timeoutId);
            image.onload = null;
            image.onerror = null;
            resolve(value);
        };
        const timeoutId = setTimeout(() => finish(""), 4500);
        image.onload = () => finish(cleanUrl);
        image.onerror = () => finish("");
        image.decoding = "async";
        image.src = cleanUrl;
    });

    superstarPhotoProbeCache.set(cleanUrl, pending);
    return pending;
}

function isLocalSuperstarPhotoPath(value) {
    const path = String(value || "")
        .split(/[?#]/)[0]
        .replace(/^\.\//, "")
        .trim()
        .toLowerCase();
    return path.startsWith(SUPERSTAR_PHOTO_FOLDER.toLowerCase());
}

// Try every (candidate × extension) combination for a single name in the given folder.
async function findFileForName(name, folder) {
    const candidates = generateFilenameCandidates(name);
    for (const stem of candidates) {
        for (const ext of SCAN_EXTENSIONS) {
            const url = `${folder}${stem}.${ext}`;
            const found = await probeFile(url);
            if (found) return found;
        }
    }
    return "";
}

async function scanSuperstarPhotos() {
    const results = {
        found: [],   // { id, name, previousPath, newPath }
        missing: [], // { id, name, previousPath }
    };
    const total = state.superstars.length;
    let completed = 0;

    const updateProgress = () => {
        const el = document.getElementById("bulkPhotoProgress");
        if (el) el.textContent = `Scanning ${completed} of ${total}…`;
    };
    updateProgress();

    // Run in batches of 4 in parallel to avoid hammering the server
    const queue = state.superstars.slice();
    while (queue.length) {
        const batch = queue.splice(0, 4);
        await Promise.all(batch.map(async (ss) => {
            const previousPath = String(ss.photo || "").trim();
            // Verify an already configured local path first. This is both faster
            // and supports filenames that do not follow the generated convention.
            const verifiedExistingPath = isLocalSuperstarPhotoPath(previousPath)
                ? await probeFile(previousPath)
                : "";
            const newPath = verifiedExistingPath || await findFileForName(ss.name, SUPERSTAR_PHOTO_FOLDER);
            if (newPath) {
                results.found.push({ id: ss.id, name: ss.name, previousPath, newPath });
            } else {
                results.missing.push({ id: ss.id, name: ss.name, previousPath });
            }
            completed += 1;
            updateProgress();
        }));
    }
    return results;
}

function renderBulkPhotosPanel() {
    const body = $("#modalBody");
    if (!body) return;
    const state_ = settingsUiState.bulkPhotos;

    body.innerHTML = `
        <div class="stack">
            <div class="muted tiny">
                Scans your local <code>${SUPERSTAR_PHOTO_FOLDER}</code> folder and auto-assigns matching photos. The folder is treated as the source of truth — any superstar with a matching file gets that path. Unmatched superstars keep their existing photo URL (so external http URLs are preserved).
            </div>

            <div class="bulk-scan-card">
                <div class="bulk-scan-head">
                    <div>
                        <div class="bulk-scan-title">Superstar Photos</div>
                        <div class="muted tiny">Scans <code>${SUPERSTAR_PHOTO_FOLDER}</code> for ${state.superstars.length} superstars.</div>
                    </div>
                    <button class="btn" id="bulkScanSuperstars" ${state_.scanning ? "disabled" : ""}>
                        ${state_.scanning ? "Scanning…" : "Scan Superstars"}
                    </button>
                </div>
                ${state_.scanning ? `<div id="bulkPhotoProgress" class="muted tiny">Starting scan…</div>` : ""}
                ${state_.results?.superstars ? renderSuperstarScanResults(state_.results.superstars) : ""}
            </div>

            <div class="muted tiny">
                Tip: Filenames must match one of these formats — <code>firstName-lastName.png</code> for multi-word names (e.g. <code>cody-rhodes.png</code>) or <code>Name.png</code> for single-word names (e.g. <code>Bayley.png</code>). Case-insensitive. Files that don't match the convention need to be renamed.
            </div>
        </div>
    `;

    $("#bulkScanSuperstars")?.addEventListener("click", async () => {
        settingsUiState.bulkPhotos.scanning = true;
        settingsUiState.bulkPhotos.results = null;
        superstarPhotoProbeCache.clear();
        renderBulkPhotosPanel();
        try {
            const results = await scanSuperstarPhotos();
            results.applied = false;
            settingsUiState.bulkPhotos.results = settingsUiState.bulkPhotos.results || {};
            settingsUiState.bulkPhotos.results.superstars = results;
        } catch (e) {
            showToast({ message: "Scan failed: " + (e?.message || "unknown error"), tone: "danger" });
        }
        settingsUiState.bulkPhotos.scanning = false;
        renderBulkPhotosPanel();
    });

    $("#bulkApplySuperstars")?.addEventListener("click", () => {
        const results = settingsUiState.bulkPhotos.results?.superstars;
        if (!results || !results.found.length || results.applied) return;
        const snapshot = snapshotState();
        let changed = 0;
        results.found.forEach(({ id, newPath }) => {
            const ss = state.superstars.find(x => x.id === id);
            if (!ss) return;
            if (ss.photo !== newPath) changed += 1;
            ss.photo = newPath;
        });
        results.applied = true;
        results.appliedCount = results.found.length;
        saveSoon();
        renderAll();
        offerUndo(`${results.found.length} scanned superstar photo${results.found.length === 1 ? "" : "s"} set.`, snapshot);
        showToast({ message: `${results.found.length} scanned photo${results.found.length === 1 ? "" : "s"} set on the roster.`, tone: "success" });
        renderBulkPhotosPanel();
    });
}

function renderSuperstarScanResults(results) {
    const foundCount = results.found.length;
    const missingCount = results.missing.length;
    const applied = !!results.applied;
    const applyLabel = applied
        ? `✓ ${foundCount} Photo${foundCount === 1 ? "" : "s"} Set`
        : foundCount > 0
            ? `Set ${foundCount} Scanned Photo${foundCount === 1 ? "" : "s"}`
            : "Set Scanned Photos";
    return `
        <div class="bulk-scan-results">
            <div class="bulk-scan-summary">
                <span class="pill bulk-pill-found">${foundCount} found</span>
                <span class="pill bulk-pill-missing">${missingCount} missing</span>
            </div>
            <div class="bulk-scan-actions">
                <button class="btn bulk-apply-btn ${applied ? "is-complete" : ""}" id="bulkApplySuperstars" ${foundCount === 0 || applied ? "disabled" : ""}>${applyLabel}</button>
                <span class="muted tiny">${foundCount > 0 ? (applied ? "The scanned paths are now assigned to your roster." : "Review the matches below, then set them on the roster.") : "No matching local files were detected. Check the folder and filenames, then scan again."}</span>
            </div>
            ${foundCount > 0 ? `
                <details class="bulk-scan-details">
                    <summary>Show found (${foundCount})</summary>
                    <ul class="bulk-scan-list">
                        ${results.found.slice(0, 100).map(r => `
                            <li class="bulk-scan-list-row">
                                <span class="bulk-scan-name">${escapeHTML(r.name)}</span>
                                <span class="bulk-scan-path muted tiny">${escapeHTML(r.newPath)}</span>
                            </li>
                        `).join("")}
                        ${results.found.length > 100 ? `<li class="muted tiny">… and ${results.found.length - 100} more</li>` : ""}
                    </ul>
                </details>
            ` : ""}
            ${missingCount > 0 ? `
                <details class="bulk-scan-details" open>
                    <summary>Needs manual setup (${missingCount})</summary>
                    <ul class="bulk-scan-list">
                        ${results.missing.slice(0, 100).map(r => `
                            <li class="bulk-scan-list-row">
                                <span class="bulk-scan-name">${escapeHTML(r.name)}</span>
                                <span class="bulk-scan-path muted tiny">${r.previousPath ? escapeHTML(r.previousPath) : "<em>no photo</em>"}</span>
                            </li>
                        `).join("")}
                        ${results.missing.length > 100 ? `<li class="muted tiny">… and ${results.missing.length - 100} more</li>` : ""}
                    </ul>
                </details>
            ` : ""}
        </div>
    `;
}


function renderDataSettingsPanel() {
    const root = $("#modalBody");
    if (!root) return;

    root.innerHTML = `
      <div class="stack">
        <div class="muted">Import a full exported backup to restore your universe exactly where you left it, or use a smaller JSON file to populate championships, shows, roster, and PLEs.</div>
        <div id="settingsDataStatus" class="settings-status hidden"></div>
        <div class="row gap wrap">
          <label class="btn secondary file-btn">
            Choose JSON
            <input id="settingsImportInput" type="file" accept="application/json" />
          </label>
          <button class="btn" id="settingsImportBtn">Import Data</button>
          <button class="btn secondary" id="settingsClearFileBtn">Clear Selected File</button>
        </div>
        <label class="row gap settings-checkbox-row">
          <input id="settingsReplaceData" type="checkbox" checked />
          <span class="muted tiny">Replace existing data before import</span>
        </label>
        <div class="h3">Populate JSON Example</div>
        <pre class="json-example">${escapeHTML(SETTINGS_JSON_EXAMPLE)}</pre>
        <div class="hr"></div>
        <div class="h3">Backup and Reset</div>
        <div class="row gap wrap">
          <button class="btn" id="settingsExportBtn">Export Full Universe Backup</button>
        </div>
        <div class="settings-danger-box stack">
          <label class="row gap settings-checkbox-row">
            <input id="settingsWipeConfirm" type="checkbox" />
            <span class="muted tiny">I understand this deletes all shows, roster data, rivalries, and events.</span>
          </label>
          <button class="btn danger" id="wipeBtn">Wipe Everything</button>
        </div>
      </div>
    `;

    const status = $("#settingsDataStatus", root);
    const fileInput = $("#settingsImportInput", root);
    const replaceInput = $("#settingsReplaceData", root);
    const wipeConfirm = $("#settingsWipeConfirm", root);

    fileInput.onchange = () => {
        const file = fileInput.files?.[0];
        if (!file) {
            setSettingsStatus(status, "No file selected.", "info");
            return;
        }
        setSettingsStatus(status, `${file.name} selected.`, "info");
    };

    $("#settingsClearFileBtn", root).onclick = () => {
        fileInput.value = "";
        setSettingsStatus(status, "Selected file cleared.", "info");
    };

    $("#settingsExportBtn", root).onclick = async () => {
        await exportUniverseJSON();
        setSettingsStatus(status, "Full universe backup exported.", "success");
    };

    $("#settingsImportBtn", root).onclick = async () => {
        const file = fileInput.files?.[0];
        if (!file) {
            setSettingsStatus(status, "Choose a JSON file first.", "danger");
            return;
        }

        const text = await file.text();
        const payload = safeJSONParse(text);
        if (!payload) {
            setSettingsStatus(status, "The selected file is not valid JSON.", "danger");
            return;
        }

        try {
            const result = importPopulateJSON(payload, { replace: replaceInput.checked });
            await initializePhotoVault().catch(error => console.warn("Imported photo migration skipped:", error));
            fileInput.value = "";
            renderAll();
            setSettingsStatus(
                status,
                result.mode === "snapshot"
                    ? `Universe restored: ${result.roster} roster entries, ${result.championships} championships, ${result.shows} shows, ${result.rivalries} rivalries, ${result.events} events, ${result.weeklySchedule} weekly rules, and ${result.completedDates} completed days loaded.`
                    : `Added ${result.championships} championships, ${result.shows} shows, ${result.roster} roster entries, and ${result.ples} PLEs.`,
                "success"
            );
        } catch (err) {
            setSettingsStatus(status, err?.message || "Could not import this file.", "danger");
        }
    };

    $("#wipeBtn", root).onclick = () => {
        if (!wipeConfirm.checked) {
            setSettingsStatus(status, "Check the confirmation box before wiping everything.", "danger");
            return;
        }

        store.wipe();
        clearPhotoVault().catch(() => {});
        state = normalizeStateData(store.load());
        bumpDataVersion();
        plannerEventId = null;
        renderAll();
        wipeConfirm.checked = false;
        setSettingsStatus(status, "All local universe data was cleared.", "success");
    };
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

function sanitizeShowIds(showIds) {
    const validShowIds = new Set(state.shows.map(show => show.id));
    return Array.from(new Set(
        (Array.isArray(showIds) ? showIds : [])
            .map(showId => String(showId ?? "").trim())
            .filter(showId => validShowIds.has(showId))
    ));
}

function scrubIneligibleChampionshipAssignments() {
    let changed = false;

    state.superstars = state.superstars.map(ss => {
        const nextChamps = parseChampionships(ss.championships).filter(championshipId => {
            const championship = getChampionship(championshipId);
            return championshipEligibleForSuperstar(championship, ss);
        });
        if (nextChamps.length === parseChampionships(ss.championships).length) return ss;
        changed = true;
        return { ...ss, championships: nextChamps, isChampion: nextChamps.length > 0 };
    });

    state.events = state.events.map(event => {
        const showIds = eventShowIds(event);
        let eventChanged = false;
        const nextMatches = (Array.isArray(event?.matches) ? event.matches : []).map(match => {
            const championshipId = String(match?.championshipId || "").trim();
            const championship = getChampionship(championshipId);
            if (!championshipId || championshipEligibleForMatch(championship, match, showIds)) return match;
            eventChanged = true;
            changed = true;
            return { ...match, championshipId: "" };
        });
        return eventChanged ? { ...event, matches: nextMatches } : event;
    });

    return changed;
}

function addChampionshipByName(rawName, { division = "World", gender = "Intergender", showIds = [] } = {}) {
    const name = String(rawName ?? "").trim();
    if (!name) return false;
    const exists = state.championships.some(c => c.name.toLowerCase() === name.toLowerCase());
    if (exists) return false;
    const validShowIds = sanitizeShowIds(showIds);
    state.championships.push(enrichChampionship({
        name,
        division: normalizeChampionshipDivision(division, name, gender),
        gender: normalizeChampionshipGender(gender),
        showIds: validShowIds,
        showId: validShowIds[0] ?? null,
    }));
    return true;
}

function importPopulateJSON(payload, { replace = true } = {}) {
    if (!payload || typeof payload !== "object") {
        throw new Error("Invalid JSON root. Expected an object.");
    }

    if (looksLikeUniverseSnapshot(payload)) {
        if (!replace) {
            throw new Error("Full universe backups restore the entire save. Leave replace enabled to import this file.");
        }
        state = normalizeStateData(payload);
        addSuperstarShowIds = new Set();
        syncUniverseUiState();
        saveSoon();
        return {
            mode: "snapshot",
            championships: state.championships.length,
            shows: state.shows.length,
            roster: state.superstars.length,
            rivalries: state.rivalries.length,
            ples: state.events.filter(event => event.type === "ppv").length,
            events: state.events.length,
            completedDates: state.completedDates.length,
            weeklySchedule: state.weeklySchedule.length,
        };
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

    for (const row of championshipsInput) {
        const normalized = enrichChampionship(row);
        if (!normalized) continue;
        if (championshipByName.has(normalized.name.toLowerCase())) continue;
        const resolvedShowIds = Array.from(new Set(
            parseShowRefs(normalized.showIds)
                .map(ref => showIdSet.has(ref) ? ref : (showNameToId.get(String(ref).toLowerCase()) || null))
                .filter(Boolean)
        ));
        state.championships.push({
            ...normalized,
            showIds: resolvedShowIds,
            showId: resolvedShowIds[0] ?? null,
        });
        championshipByName.set(normalized.name.toLowerCase(), normalized.id);
        result.championships += 1;
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
        const championshipShowFiltered = championships.filter(championshipId => {
            const championship = getChampionship(championshipId);
            return championshipEligibleForSuperstar(championship, {
                showIds,
                showId: showIds[0] ?? null,
                division,
            });
        });
        state.superstars.push(enrichSuperstar({
            id: uid("ss"),
            name,
            showId: showIds[0] ?? null,
            showIds,
            division,
            championships: championshipShowFiltered,
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
        const date = clampToUniverseDay(String(row?.date ?? "").trim());
        if (!name || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;

        const showFromName = String(row?.show ?? row?.showName ?? "").trim().toLowerCase();
        let showIds = [];
        if (Array.isArray(row?.showIds)) {
            showIds = row.showIds.map(x => String(x ?? "").trim()).filter(x => showIdSet.has(x));
        } else if (Array.isArray(row?.shows)) {
            showIds = row.shows
                .map(x => showNameToId.get(String(x ?? "").trim().toLowerCase()) || null)
                .filter(Boolean);
        } else if (showFromName) {
            showIds = parseShowRefs(showFromName)
                .map(x => showNameToId.get(String(x ?? "").trim().toLowerCase()) || null)
                .filter(Boolean);
        }
        let showId = row?.showId ?? null;
        if (showId && showIdSet.has(showId)) showIds.unshift(showId);
        showIds = Array.from(new Set(showIds));
        showId = showIds[0] ?? null;

        state.events.push({
            id: uid("event"),
            date,
            type: "ppv",
            showId,
            showIds,
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
        // Days 29–31 don't exist in the 4-week universe calendar.
        if (cur.getDate() > CALENDAR_DAYS_PER_MONTH) {
            cur.setDate(cur.getDate() + 1);
            continue;
        }
        const iso = toISODateLocal(cur);
        const dow = calendarWeekdaySundayZero(cur);

        for (const rule of rules) {
            if (rule.weekday === dow) {
                const key = `${iso}|${rule.showId}|weekly`;
                if (existing.has(key)) continue;

                const show = getShow(rule.showId);
                const name = `${show?.name || "Weekly"} • ${iso}`;
                const matches = Array.from({ length: Number(defaultRows) || 0 }).map((_, i) => ({
                    id: uid("match"),
                    num: i + 1,
                    participants: [],
                    participantTeams: {},
                    participantEscorts: {},
                    teamNames: {},
                    participantSlots: MIN_PARTICIPANT_SLOTS,
                    matchType: "",
                    storyline: "",
                    championshipId: "",
                    result: "",
                    pinBy: "",
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
            num: i + 1, participants: [], participantTeams: {}, participantEscorts: {}, teamNames: {}, participantSlots: MIN_PARTICIPANT_SLOTS, matchType: "", storyline: "", championshipId: "", result: "", pinBy: "", rivalryNotes: ""
        }))
    });

    saveSoon();
}

// -------------------- SELECT POPULATION --------------------
function populateShowSelects() {
    // add-superstar show picker
    const ssShows = $("#ssShows");
    if (ssShows) {
        const validIds = new Set(state.shows.map(s => s.id));
        addSuperstarShowIds = new Set(Array.from(addSuperstarShowIds).filter(id => validIds.has(id)));
        if (!state.shows.length) {
            ssShows.innerHTML = `<div class="muted tiny">No shows yet. Add shows in Settings first.</div>`;
        } else {
            ssShows.innerHTML = state.shows.map(s => {
                const active = addSuperstarShowIds.has(s.id);
                const bg = active ? `${s.color}33` : "rgba(255,255,255,.03)";
                const border = active ? s.color : "var(--line)";
                return `
                  <button type="button" class="show-tag-btn ${active ? "active" : ""}" data-ss-show="${s.id}"
                    style="border-color:${border};background:${bg};">
                    <span class="dot" style="background:${s.color}"></span>
                    <span>${escapeHTML(s.name)}</span>
                  </button>
                `;
            }).join("");
            $$("[data-ss-show]", ssShows).forEach(btn => {
                btn.addEventListener("click", () => {
                    const showId = btn.dataset.ssShow;
                    if (!showId) return;
                    if (addSuperstarShowIds.has(showId)) addSuperstarShowIds.delete(showId);
                    else addSuperstarShowIds.add(showId);
                    populateShowSelects();
                });
            });
        }
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

    // rivalry show filter
    const rivalryShowFilter = $("#rivalryShowFilter");
    if (rivalryShowFilter) {
        const prev = rivalryShowFilter.value || "all";
        rivalryShowFilter.innerHTML = [
            `<option value="all">All shows</option>`,
            ...state.shows.map(s => `<option value="${s.id}">${escapeHTML(s.name)}</option>`)
        ].join("");
        rivalryShowFilter.value = (state.shows.some(s => s.id === prev) || prev === "all") ? prev : "all";
        rivalryShowFilter.onchange = () => renderRivalries();
    }
}

// -------------------- RENDER ALL --------------------
function renderAll() {
    populateShowSelects();
    const subtitle = $("#viewSubtitle");
    if (subtitle) subtitle.textContent = viewSubtitle(currentView);

    if (currentView === "dashboard") renderDashboard();
    if (currentView === "calendar") renderCalendar();
    if (currentView === "planner") renderPlanner();
    if (currentView === "roster") renderRoster();
    if (currentView === "settings") renderSettingsTools();

    requestAnimationFrame(() => optimizeImages($(`#view-${currentView}`)));
}

// -------------------- UI BINDINGS --------------------
// Desktop nav
$$(".nav-btn").forEach(btn => btn.addEventListener("click", () => setView(btn.dataset.view)));
// Mobile bottom nav
$$(".bnav-btn").forEach(btn => btn.addEventListener("click", () => setView(btn.dataset.view)));

$("#openAddSSModal").addEventListener("click", () => {
    addSuperstarShowIds = new Set();
    openAddSuperstarFlow();
});

let rosterSearchFrame = 0;
$("#rosterSearch").addEventListener("input", () => {
    cancelAnimationFrame(rosterSearchFrame);
    rosterSearchFrame = requestAnimationFrame(renderRoster);
});
$("#rosterDivisionFilter")?.addEventListener("change", () => renderRoster());
$("#rosterStatusFilter")?.addEventListener("change", () => renderRoster());
function setCalendarMonthFor(iso) {
    const d = parseISO(iso);
    calCursor = new Date(d.getFullYear(), d.getMonth(), 1);
}
$("#calPrev").addEventListener("click", () => { calCursor.setMonth(calCursor.getMonth() - 1); renderCalendar(); });
$("#calNext").addEventListener("click", () => { calCursor.setMonth(calCursor.getMonth() + 1); renderCalendar(); });
$("#calendarGrid").addEventListener("click", e => {
    const cell = e.target.closest(".cal-cell[data-date]");
    if (cell) selectCalendarDay(cell.dataset.date);
});
$("#eventsList").addEventListener("click", e => {
    const item = e.target.closest("[data-open-event]");
    if (item) openCalendarEventDetails(item.dataset.openEvent, { fromCalendar: true });
});
// Swipe left/right on the month grid to change month.
(function enableCalendarSwipe() {
    const grid = $("#calendarGrid");
    let start = null;
    grid.addEventListener("touchstart", e => {
        const t = e.touches[0];
        start = { x: t.clientX, y: t.clientY, t: performance.now() };
    }, { passive: true });
    grid.addEventListener("touchend", e => {
        if (!start) return;
        const t = e.changedTouches[0];
        const dx = t.clientX - start.x;
        const dy = t.clientY - start.y;
        const quick = performance.now() - start.t < 600;
        start = null;
        if (!quick || Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
        calCursor.setMonth(calCursor.getMonth() + (dx < 0 ? 1 : -1));
        renderCalendar();
    }, { passive: true });
})();
$("#calToday").addEventListener("click", () => {
    const now = getUniverseCurrentISO();
    setCalendarMonthFor(now);
    calSelectedISO = now;
    renderCalendar();
});
$("#calUniverseStartDate")?.addEventListener("change", (e) => {
    const iso = String(e.target.value || "");
    if (!isISODate(iso)) return;
    state.universeStartDate = iso;
    setCalendarMonthFor(iso);
    calSelectedISO = firstUniverseDayOnOrAfter(iso);
    saveSoon();
    renderAll();
});
$("#calSetStartFromSelected")?.addEventListener("click", () => {
    if (!isISODate(calSelectedISO)) return;
    state.universeStartDate = calSelectedISO;
    saveSoon();
    renderAll();
    showToast({ message: `Universe now starts on ${prettyUniverseDate(calSelectedISO)}.`, tone: "info", duration: 2600 });
});
$("#calToggleDone")?.addEventListener("click", () => {
    if (!isISODate(calSelectedISO)) return;
    let changes = [];
    if (isUniverseDateCompleted(calSelectedISO)) setUniverseDateCompleted(calSelectedISO, false);
    else changes = completeUniverseDay(calSelectedISO);
    saveSoon();
    renderAll();
    announceTitleChanges(changes);
});
$("#calProgressDay")?.addEventListener("click", () => {
    if (!isISODate(calSelectedISO)) return;
    const changes = completeUniverseDay(calSelectedISO);
    calSelectedISO = nextUniverseDayISO(calSelectedISO);
    setCalendarMonthFor(calSelectedISO);
    saveSoon();
    renderAll();
    announceTitleChanges(changes);
});

$("#addEventBtn").addEventListener("click", () => addEventFlow(calSelectedISO));

$("#addMatchRow").addEventListener("click", addMatchRow);

$("#quickAddEvent")?.addEventListener("click", () => addEventFlow(getUniverseCurrentISO()));
$("#quickOpenToday")?.addEventListener("click", () => {
    const iso = getUniverseCurrentISO();
    const todayEvents = state.events.filter(e => e.date === iso).sort((a, b) => a.type.localeCompare(b.type));
    if (todayEvents[0]) openPlanner(todayEvents[0].id);
    else addEventFlow(iso);
});

// Export/Import/Reset
async function exportUniverseJSON() {
    const snapshot = safeJSONParse(JSON.stringify(state)) || state;
    for (const superstar of snapshot.superstars || []) {
        const vaultId = photoVaultIdFromRef(superstar.photo);
        if (!vaultId) continue;
        try {
            superstar.photo = photoVaultCache.get(vaultId) || await loadPhotoFromVault(vaultId) || "";
        } catch {
            superstar.photo = "";
        }
    }
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `universe-booker-backup-${todayISO()}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

// -------------------- INIT --------------------
// Native-style header: hairline divider once content scrolls under it, and
// expose the header height so sticky panels can sit right below it.
function updateScrolledState() {
    document.body.classList.toggle("is-scrolled", (window.scrollY || 0) > 4);
}
window.addEventListener("scroll", () => {
    scheduleUiSessionSave();
    updateScrolledState();
}, { passive: true });
(function trackTopbarHeight() {
    const topbar = $(".topbar");
    if (!topbar || !("ResizeObserver" in window)) return;
    new ResizeObserver(() => {
        document.documentElement.style.setProperty("--topbar-h", `${topbar.offsetHeight}px`);
    }).observe(topbar);
})();
window.addEventListener("pagehide", () => {
    if (pendingSave) flushSaveNow();
    saveUiSessionState();
});
window.addEventListener("pageshow", event => {
    if (event.persisted) restoreUiSessionScroll(readUiSessionState());
});

(function init() {
    const session = readUiSessionState();
    if (session.plannerEventId && state.events.some(event => event.id === session.plannerEventId)) {
        plannerEventId = session.plannerEventId;
    }
    const initialView = views.includes(session.view) ? session.view : "dashboard";
    showView(initialView);
    restoreUiSessionScroll(session);
    initializePhotoVault().catch(error => console.warn("Photo vault unavailable:", error));
})();
