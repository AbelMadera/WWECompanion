// Universe Booker - mobile-first, smooth LocalStorage MVP
// Storage isolated so you can swap to a DB later.

const STORAGE_KEY = "universeBooker.v2";
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

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
function enrichChampionship(championship) {
    const name = typeof championship === "string"
        ? championship.trim()
        : String(championship?.name ?? "").trim();
    if (!name) return null;
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
        gender: String(championship?.gender ?? "").trim(),
        showIds: rawShowRefs,
        showId: rawShowRefs[0] ?? null, // legacy compatibility
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
    normalized.championships = Array.isArray(normalized.championships)
        ? normalized.championships
            .map(enrichChampionship)
            .filter(Boolean)
            .map(c => {
                const resolvedShowIds = Array.from(new Set(
                    parseShowRefs(c?.showIds)
                        .map(ref => validShowIds.has(ref) ? ref : (showNameToId.get(String(ref).toLowerCase()) || null))
                        .filter(Boolean)
                ));
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
            const validShowIds = ss.showIds.filter(showId => normalized.shows.some(s => s.id === showId));
            const championshipIds = parseChampionships(ss.championships)
                .map(resolveChampionshipId)
                .filter(Boolean)
                .filter(championshipId => {
                    const championship = byId.get(championshipId);
                    return championshipAvailableForShowIds(championship, validShowIds);
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
            const ids = Array.isArray(ev?.showIds)
                ? ev.showIds.map(id => String(id ?? "").trim()).filter(id => validShowIds.has(id))
                : [];
            const legacyShowId = String(ev?.showId ?? "").trim();
            if (legacyShowId && validShowIds.has(legacyShowId)) ids.unshift(legacyShowId);
            const showIds = Array.from(new Set(ids));
            return {
                ...ev,
                type,
                showIds,
                showId: showIds[0] ?? null,
            };
        })
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
        championships: [], // {id, name, gender?, showIds:[], showId(legacy)}
        superstars: [],   // {id, name, showIds:[], showId(legacy), division}
        weeklySchedule: [], // [{showId, weekday}] where weekday is 0-6
        events: [],       // {id, date, type:"weekly"|"ppv", showId|null, name, matches:[...], defaultRows?}
        universeStartDate: todayISO(),
        completedDates: [],
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
let addSuperstarShowIds = new Set();

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
function getUniverseStartISO() {
    if (!isISODate(state.universeStartDate)) state.universeStartDate = todayISO();
    return state.universeStartDate;
}
function completedDateSet() {
    if (!Array.isArray(state.completedDates)) state.completedDates = [];
    return new Set(state.completedDates.filter(isISODate));
}
function isUniverseDateCompleted(iso) {
    return completedDateSet().has(iso);
}
function setUniverseDateCompleted(iso, done) {
    if (!isISODate(iso)) return;
    const set = completedDateSet();
    if (done) set.add(iso);
    else set.delete(iso);
    state.completedDates = Array.from(set).sort();
}
function getUniverseCurrentISO() {
    const startISO = getUniverseStartISO();
    const done = completedDateSet();
    const cursor = parseISO(startISO);
    for (let i = 0; i < 36600; i++) {
        const iso = toISODateLocal(cursor);
        if (!done.has(iso)) return iso;
        cursor.setDate(cursor.getDate() + 1);
    }
    return startISO;
}
function nextUniverseEvent() {
    const startISO = getUniverseStartISO();
    const done = completedDateSet();
    return state.events
        .filter(e => isISODate(e?.date))
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
function calendarWeekdaySundayZero(date) {
    // In the custom 28-day calendar, day 1 is Monday.
    // This maps day-of-month to 0-6 using Sunday=0, Monday=1 ... Saturday=6.
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
function championshipAvailableForShowIds(championship, showIds) {
    const eventOrRosterShowIds = Array.isArray(showIds) ? showIds.filter(Boolean) : [];
    if (!eventOrRosterShowIds.length) return true;
    const champShowIds = Array.isArray(championship?.showIds) ? championship.showIds.filter(Boolean) : [];
    if (!champShowIds.length) return true;
    return champShowIds.some(showId => eventOrRosterShowIds.includes(showId));
}
function eligibleChampionshipsForShowIds(showIds) {
    return state.championships.filter(c => championshipAvailableForShowIds(c, showIds));
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
function superstarNameById(id) {
    return state.superstars.find(ss => ss.id === id)?.name || "";
}
function resolveSuperstarIdFromRef(ref) {
    const raw = String(ref ?? "").trim();
    if (!raw) return "";
    const byId = state.superstars.find(ss => ss.id === raw);
    if (byId) return byId.id;
    const normalizedRaw = normalizeNameForCompare(raw);
    const byName = state.superstars.find(ss => normalizeNameForCompare(ss.name) === normalizedRaw);
    return byName?.id || "";
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
            if (!resultValue) {
                // "(winner)" placeholder counts as a draw for all participants
                participantIds.forEach(pid => {
                    const rec = records.get(pid);
                    if (!rec) return;
                    rec.draws += 1;
                });
                return;
            }
            if (normalizeNameForCompare(resultValue) === "no result") return;
            if (isPromoResult(resultValue)) return; // Promo does not affect W/L/D
            if (isDQResult(resultValue)) return; // DQ does not affect W/L/D

            if (isDrawRecordResult(resultValue)) {
                participantIds.forEach(pid => {
                    const rec = records.get(pid);
                    if (!rec) return;
                    rec.draws += 1;
                });
                return;
            }

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
const WEEKLY_RANKING_POINTS = {
    baseScore: 1000,
    championStartBonus: 15,
    eloK: 20,
    winPoints: 12,
    appearancePoints: 1.5,
    drawPoints: 4,
    dqPoints: 2,
    promoPoints: 3,
    lossPoints: 0.75,
    pinBonus: 2,
    top10WinBonus: 4,
    top5WinBonus: 7,
    streakBonusPerWin: 2,
    maxStreakBonus: 8,
    mainEventBonus: 0.25,
    ppvMultiplier: 1.3,
    titleMultiplier: 1.55,
    titlePpvMultiplier: 1.75,
    teamMatchPointMultiplier: 0.72,
    teamMatchEloMultiplier: 0.42,
};
function resolveMatchParticipantIds(match, superstarNameToId) {
    const ids = [];
    const participants = Array.isArray(match?.participants) ? match.participants : [];
    for (const ref of participants) {
        const raw = String(ref ?? "").trim();
        if (!raw) continue;
        const byId = state.superstars.find(ss => ss.id === raw);
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
    const isMainEvent = matchIndex === (matchesLength - 1);
    const isPpv = event.type === "ppv";
    const titleHint = `${match?.matchType || ""} ${match?.storyline || ""}`.toLowerCase();
    const isTitle = /title|championship|champ\b/.test(titleHint);
    let multiplier = 1.0;
    if (isTitle && isPpv) multiplier = WEEKLY_RANKING_POINTS.titlePpvMultiplier;
    else if (isTitle) multiplier = WEEKLY_RANKING_POINTS.titleMultiplier;
    else if (isPpv) multiplier = WEEKLY_RANKING_POINTS.ppvMultiplier;
    if (isMainEvent) multiplier += WEEKLY_RANKING_POINTS.mainEventBonus;
    return multiplier;
}
function computeWeeklyRankings(topN = 3) {
    const rules = WEEKLY_RANKING_POINTS;
    const records = computeSuperstarRecords();

    const superstarNameToId = new Map(
        state.superstars.map(ss => [normalizeNameForCompare(ss.name), ss.id])
    );
    const superstarNameById = new Map(
        state.superstars.map(ss => [ss.id, ss.name])
    );
    const showIdsBySuperstar = new Map(
        state.superstars.map(ss => {
            const ids = Array.isArray(ss?.showIds) && ss.showIds.length
                ? ss.showIds.map(id => String(id ?? "").trim()).filter(Boolean)
                : (ss?.showId ? [String(ss.showId).trim()] : []);
            return [ss.id, Array.from(new Set(ids))];
        })
    );
    const eloRatings = new Map();
    const bonusPoints = new Map();
    const wins = new Map();
    const appearances = new Map();
    const winStreaks = new Map();

    state.superstars.forEach(ss => {
        eloRatings.set(
            ss.id,
            rules.baseScore + (ss.isChampion ? rules.championStartBonus : 0)
        );
        bonusPoints.set(ss.id, 0);
        wins.set(ss.id, 0);
        appearances.set(ss.id, 0);
        winStreaks.set(ss.id, 0);
    });

    const compositeScore = (superstarId) => {
        if (!eloRatings.has(superstarId)) return rules.baseScore;
        return (eloRatings.get(superstarId) ?? rules.baseScore) + (bonusPoints.get(superstarId) ?? 0);
    };
    const addBonusPoints = (superstarId, points) => {
        if (!bonusPoints.has(superstarId)) return;
        bonusPoints.set(superstarId, (bonusPoints.get(superstarId) || 0) + points);
    };
    const scaledBonus = (points, multiplier = 1) => points * multiplier;
    const addEloDelta = (superstarId, delta) => {
        if (!eloRatings.has(superstarId)) return;
        eloRatings.set(superstarId, (eloRatings.get(superstarId) ?? rules.baseScore) + delta);
    };
    const applyHeadToHeadElo = (a, b, scoreA, scoreB, multiplier = 1) => {
        if (!eloRatings.has(a) || !eloRatings.has(b)) return;
        const ra = eloRatings.get(a) ?? rules.baseScore;
        const rb = eloRatings.get(b) ?? rules.baseScore;
        const ea = 1 / (1 + Math.pow(10, (rb - ra) / 400));
        const eb = 1 - ea;
        const kEff = rules.eloK * multiplier;
        addEloDelta(a, kEff * (scoreA - ea));
        addEloDelta(b, kEff * (scoreB - eb));
    };
    const noteAppearance = (participantIds) => {
        participantIds.forEach(id => {
            appearances.set(id, (appearances.get(id) || 0) + 1);
        });
    };
    const teamScoreMultiplier = (teamGroups, matchMultiplier) => {
        if (!(Array.isArray(teamGroups) && teamGroups.length >= 2)) return matchMultiplier;
        return matchMultiplier * rules.teamMatchPointMultiplier;
    };
    const teamEloMultiplier = (teamGroups, matchMultiplier) => {
        if (!(Array.isArray(teamGroups) && teamGroups.length >= 2)) return matchMultiplier;
        return matchMultiplier * rules.teamMatchEloMultiplier / Math.max(1, teamGroups.length - 1);
    };
    const awardParticipationPoints = (participantIds, matchMultiplier, teamGroups = []) => {
        const effectiveMultiplier = teamScoreMultiplier(teamGroups, matchMultiplier);
        participantIds.forEach(id => addBonusPoints(id, scaledBonus(rules.appearancePoints, effectiveMultiplier)));
    };
    const buildShowRankContext = () => {
        const byShow = new Map();
        state.shows.forEach(show => {
            const rows = state.superstars
                .filter(ss => superstarOnShow(ss, show.id))
                .slice()
                .sort((a, b) => {
                    const scoreDiff = compositeScore(b.id) - compositeScore(a.id);
                    if (scoreDiff !== 0) return scoreDiff;
                    const winDiff = (wins.get(b.id) ?? 0) - (wins.get(a.id) ?? 0);
                    if (winDiff !== 0) return winDiff;
                    return a.name.localeCompare(b.name);
                });

            const positions = new Map();
            rows.forEach((ss, idx) => positions.set(ss.id, idx + 1));
            byShow.set(show.id, { positions, size: rows.length });
        });
        return byShow;
    };
    const defeatedOpponentBonuses = (defeatedIds, rankContext) => {
        let bestRankBonus = 0;
        let bestStreakBonus = 0;

        defeatedIds.forEach(defeatedId => {
            if ((appearances.get(defeatedId) || 0) > 0) {
                const showIds = showIdsBySuperstar.get(defeatedId) || [];
                showIds.forEach(showId => {
                    const context = rankContext.get(showId);
                    const rank = context?.positions.get(defeatedId);
                    if (!rank || !context) return;
                    if (context.size >= 5 && rank <= 5) {
                        bestRankBonus = Math.max(bestRankBonus, rules.top5WinBonus);
                    } else if (context.size >= 10 && rank <= 10) {
                        bestRankBonus = Math.max(bestRankBonus, rules.top10WinBonus);
                    }
                });
            }

            const streak = winStreaks.get(defeatedId) || 0;
            if (streak >= 2) {
                bestStreakBonus = Math.max(
                    bestStreakBonus,
                    Math.min(rules.maxStreakBonus, streak * rules.streakBonusPerWin)
                );
            }
        });

        return {
            rankBonus: bestRankBonus,
            streakBonus: bestStreakBonus,
        };
    };

    const universeCurrentISO = getUniverseCurrentISO();
    const processedEvents = state.events
        .filter(e => /^\d{4}-\d{2}-\d{2}$/.test(String(e?.date || "")))
        .filter(e => e.date < universeCurrentISO || isUniverseDateCompleted(e.date))
        .slice()
        .sort((a, b) => a.date.localeCompare(b.date));

    for (const ev of processedEvents) {
        const matches = Array.isArray(ev.matches) ? ev.matches : [];
        matches.forEach((match, idx) => {
            const participantIds = resolveMatchParticipantIds(match, superstarNameToId);
            const winnerId = resolveMatchWinnerId(match, participantIds, superstarNameById);
            const pinById = resolveSuperstarIdFromRef(String(match?.pinBy ?? "").trim());
            const resultValue = String(match?.result ?? "").trim();
            const normalizedResult = normalizeNameForCompare(resultValue);
            const isDrawLikeResult = isDrawRecordResult(resultValue)
                || normalizedResult === "no contest"
                || normalizedResult === "nc";
            const matchMultiplier = matchImportanceMultiplier(ev, idx, matches.length, match);

            if (isPromoResult(resultValue)) {
                if (!participantIds.length) return;
                noteAppearance(participantIds);
                participantIds.forEach(id => addBonusPoints(id, scaledBonus(rules.promoPoints, matchMultiplier)));
                return;
            }

            if (participantIds.length < 2) return;

            const participantTeams = normalizedParticipantTeams(match);
            const teams = inferMatchTeams(match?.matchType, participantIds, participantTeams);
            const hasTeams = teams.length >= 2 && teams.every(group => group.participants.length);
            const rankContext = buildShowRankContext();
            const scoreMultiplier = hasTeams ? teamScoreMultiplier(teams, matchMultiplier) : matchMultiplier;
            const eloMultiplier = hasTeams ? teamEloMultiplier(teams, matchMultiplier) : matchMultiplier;

            if (isDrawLikeResult) {
                noteAppearance(participantIds);
                awardParticipationPoints(participantIds, matchMultiplier, hasTeams ? teams : []);
                participantIds.forEach(id => {
                    addBonusPoints(id, scaledBonus(rules.drawPoints, scoreMultiplier));
                    winStreaks.set(id, 0);
                });
                if (hasTeams) {
                    forEachTeamPairing(teams, (teamA, teamB) => {
                        for (const a of teamA.participants) {
                            for (const b of teamB.participants) {
                                applyHeadToHeadElo(a, b, 0.5, 0.5, eloMultiplier);
                            }
                        }
                    });
                } else {
                    for (let i = 0; i < participantIds.length; i++) {
                        for (let j = i + 1; j < participantIds.length; j++) {
                            applyHeadToHeadElo(participantIds[i], participantIds[j], 0.5, 0.5, eloMultiplier);
                        }
                    }
                }
                return;
            }

            if (isDQResult(resultValue)) {
                noteAppearance(participantIds);
                awardParticipationPoints(participantIds, matchMultiplier, hasTeams ? teams : []);
                participantIds.forEach(id => {
                    addBonusPoints(id, scaledBonus(rules.dqPoints, scoreMultiplier));
                    winStreaks.set(id, 0);
                });
                return;
            }

            if (!resultValue || normalizedResult === "no result") {
                noteAppearance(participantIds);
                awardParticipationPoints(participantIds, matchMultiplier, hasTeams ? teams : []);
                participantIds.forEach(id => winStreaks.set(id, 0));
                return;
            }

            if (hasTeams) {
                const winningTeam = winningTeamFromMatch(match, teams, winnerId);
                const winners = winningTeam?.participants || [];
                const losers = losingParticipantsFromTeamGroups(teams, winningTeam);
                if (!winners.length || !losers.length) {
                    noteAppearance(participantIds);
                    participantIds.forEach(id => winStreaks.set(id, 0));
                    return;
                }

                const bonuses = defeatedOpponentBonuses(losers, rankContext);
                noteAppearance(participantIds);
                awardParticipationPoints(participantIds, matchMultiplier, teams);
                winners.forEach(id => {
                    addBonusPoints(id, scaledBonus(rules.winPoints + bonuses.rankBonus + bonuses.streakBonus, scoreMultiplier));
                    wins.set(id, (wins.get(id) || 0) + 1);
                    winStreaks.set(id, (winStreaks.get(id) || 0) + 1);
                });
                losers.forEach(id => {
                    addBonusPoints(id, scaledBonus(rules.lossPoints, scoreMultiplier));
                    winStreaks.set(id, 0);
                });
                if (pinById && winners.includes(pinById)) {
                    addBonusPoints(pinById, scaledBonus(rules.pinBonus, scoreMultiplier));
                }
                winners.forEach(a => {
                    losers.forEach(b => {
                        applyHeadToHeadElo(a, b, 1, 0, eloMultiplier);
                    });
                });
                return;
            }

            if (!winnerId || !participantIds.includes(winnerId)) {
                noteAppearance(participantIds);
                participantIds.forEach(id => winStreaks.set(id, 0));
                return;
            }

            const losers = participantIds.filter(id => id !== winnerId);
            const bonuses = defeatedOpponentBonuses(losers, rankContext);
            noteAppearance(participantIds);
            awardParticipationPoints(participantIds, matchMultiplier);
            addBonusPoints(winnerId, scaledBonus(rules.winPoints + bonuses.rankBonus + bonuses.streakBonus, scoreMultiplier));
            wins.set(winnerId, (wins.get(winnerId) || 0) + 1);
            winStreaks.set(winnerId, (winStreaks.get(winnerId) || 0) + 1);
            losers.forEach(id => {
                addBonusPoints(id, scaledBonus(rules.lossPoints, scoreMultiplier));
                winStreaks.set(id, 0);
            });
            if (pinById && pinById === winnerId) {
                addBonusPoints(winnerId, scaledBonus(rules.pinBonus, scoreMultiplier));
            }
            for (let i = 0; i < participantIds.length; i++) {
                for (let j = i + 1; j < participantIds.length; j++) {
                    const a = participantIds[i];
                    const b = participantIds[j];
                    if (winnerId === a) {
                        applyHeadToHeadElo(a, b, 1, 0, eloMultiplier);
                    } else if (winnerId === b) {
                        applyHeadToHeadElo(a, b, 0, 1, eloMultiplier);
                    } else {
                        applyHeadToHeadElo(a, b, 0.5, 0.5, eloMultiplier);
                    }
                }
            }
        });
    }

    const byShow = new Map();
    for (const show of state.shows) {
        const rows = state.superstars
            .filter(ss => superstarOnShow(ss, show.id))
            .map(ss => ({
                superstar: ss,
                score: compositeScore(ss.id),
            }))
            .sort((a, b) => {
                if (b.score !== a.score) return b.score - a.score;
                const bWins = wins.get(b.superstar.id) ?? toNonNegativeInt(superstarRecordById(b.superstar.id, records).wins);
                const aWins = wins.get(a.superstar.id) ?? toNonNegativeInt(superstarRecordById(a.superstar.id, records).wins);
                if (bWins !== aWins) {
                    return bWins - aWins;
                }
                return a.superstar.name.localeCompare(b.superstar.name);
            })
            .slice(0, Math.max(1, Number(topN) || 3));
        byShow.set(show.id, rows);
    }
    return byShow;
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
        cancelText: "Close"
    });

    const modalCancelBtn = $("#modalCancel");
    modalCancelBtn.classList.add("hidden");
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
    modalCancelBtn.classList.remove("hidden");
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
        calendar: ["Calendar", ""],
        planner: ["Planner", ""],
        shows: ["Shows", "Create/remove shows & colors"],
        roster: ["Roster", ""],
        settings: ["Settings", ""],
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
    const rankingsEl = $("#weeklyRankings");
    const universeToday = getUniverseCurrentISO();
    const upcoming = nextUniverseEvent();

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
            openSuperstarDetails(el.dataset.openSs, { readOnly: true });
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
    const availableChampionships = eligibleChampionshipsForShowIds(Array.from(selectedShows));
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
    const allowedChampionshipIds = new Set(eligibleChampionshipsForShowIds(newShowIds).map(c => c.id));
    const newChamps = $$(".editSSChampItem:checked")
        .map(el => el.value)
        .filter(championshipId => allowedChampionshipIds.has(championshipId));
    const newFaction = $("#editSSFaction").value.trim();
    const newManager = $("#editSSManager").value.trim();

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
    } : x);
    saveSoon();
    renderRoster();
    renderPlanner();
    return true;
}

async function openSuperstarDetails(id, { readOnly = false } = {}) {
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
            const participantRefs = Array.isArray(match?.participants) ? match.participants : [];
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
        </div>
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

    const modalPromise = openModal({ title: "Superstar Details", bodyHTML, okText: "Close", cancelText: "Close" });

    const modalActions = $(".modal-actions");
    const modalCancelBtn = $("#modalCancel");
    const modalOkBtn = $("#modalOk");

    if (readOnly) {
        modalCancelBtn.classList.add("hidden");
        await modalPromise;
        modalCancelBtn.classList.remove("hidden");
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
    const recordMap = computeSuperstarRecords();

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
        const record = formatRecord(superstarRecordById(ss.id, recordMap));
        const photo = superstarPhotoURL(ss);
        return `
          <div class="item roster-item" data-open-ss="${ss.id}" role="button" tabindex="0" aria-label="Open ${escapeAttr(ss.name)} details">
            <div class="row gap wrap">
              ${photo
                ? `<img class="ss-card-photo" src="${escapeAttr(photo)}" alt="${escapeAttr(ss.name)}" />`
                : `<div class="ss-card-fallback">${escapeHTML(superstarInitials(ss.name))}</div>`
            }
              <div>
                <div class="item-title">${escapeHTML(ss.name)}${ss.isChampion ? ` <span class="champ-inline">C</span>` : ``}</div>
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
const CALENDAR_DAYS_PER_MONTH = 28;
let calSelectedISO = getUniverseCurrentISO();
let calCursor = parseISO(calSelectedISO); calCursor.setDate(1); calCursor.setHours(0, 0, 0, 0);

function renderCalendar() {
    populateShowSelects();
    $("#calendarTitle").textContent = formatMonthTitle(calCursor);
    const startISO = getUniverseStartISO();
    const universeCurrentISO = getUniverseCurrentISO();
    const doneDates = completedDateSet();
    const startInput = $("#calUniverseStartDate");
    if (startInput && startInput.value !== startISO) startInput.value = startISO;
    const toggleDoneBtn = $("#calToggleDone");
    if (toggleDoneBtn) {
        toggleDoneBtn.textContent = doneDates.has(calSelectedISO) ? "Unmark Day Done" : "Mark Day Done";
    }

    const showFilter = $("#calShowFilter").value || "all";

    const cells = [];
    for (let day = 1; day <= CALENDAR_DAYS_PER_MONTH; day++) {
        const d = new Date(calCursor.getFullYear(), calCursor.getMonth(), day);
        const iso = toISODateLocal(d);
        const done = doneDates.has(iso);

        const events = state.events
            .filter(e => e.date === iso)
            .filter(e => showFilter === "all" ? true : eventHasShow(e, showFilter));

        const visibleEvents = events.slice(0, 2);
        const badges = visibleEvents.map(e => {
            const shortType = e.type === "ppv" ? "PLE" : "WK";
            const pillStyle = done
                ? "background:rgba(159,159,170,.18);color:#c8c8d3;border-color:rgba(159,159,170,.32);"
                : e.type === "ppv"
                    ? "background:#ffffff;color:#111111;border-color:#ffffff;"
                    : `background:${showColor(e.showId)};color:#ffffff;border-color:${showColor(e.showId)};`;
            return `<span class="cal-pill" style="${pillStyle}" title="${escapeAttr(e.name || "(Unnamed Event)")}">${shortType}</span>`;
        }).join("");
        const overflow = events.length > visibleEvents.length
            ? `<span class="cal-more">+${events.length - visibleEvents.length}</span>`
            : "";

        cells.push(`
      <div class="cal-cell ${done ? "is-done" : ""}" data-date="${iso}"
        style="outline:${iso === calSelectedISO ? '2px solid rgba(255,255,255,.25)' : 'none'}">
        <div class="cal-date">${day}${iso === startISO ? ` <span class="cal-day-state">START</span>` : ``}${iso === universeCurrentISO ? ` <span class="cal-day-state">NOW</span>` : ``}</div>
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
    const dayDone = isUniverseDateCompleted(calSelectedISO);

    const events = state.events
        .filter(e => e.date === calSelectedISO)
        .filter(e => showFilter === "all" ? true : eventHasShow(e, showFilter));

    if (events.length === 0) {
        list.innerHTML = `<div class="muted">No events on <b>${calSelectedISO}</b>. ${dayDone ? "This day is marked done." : ""}</div>`;
        return;
    }

    list.innerHTML = `
    <div class="list">
      <div class="muted tiny">${dayDone ? "This day is marked done and counts as passed." : "This day is not marked done yet."}</div>
      ${events.map(e => {
        const ids = eventShowIds(e);
        const showBadges = ids.length
            ? ids.map(id => `<span class="badge"><span class="dot" style="background:${showColor(id)}"></span>${escapeHTML(showName(id))}</span>`).join("")
            : `<span class="badge"><span class="dot" style="background:${showColor(e.showId)}"></span>${escapeHTML(showName(e.showId))}</span>`;
        return `
          <div class="item cal-event-item" data-open-event="${e.id}" role="button" tabindex="0" aria-label="Open ${escapeAttr(e.name || "(Unnamed Event)")} details">
            <div class="item-title">${escapeHTML(e.name || "(Unnamed Event)")}</div>
            <div class="row gap wrap">
              ${showBadges}
              <span class="badge">${escapeHTML(e.type.toUpperCase())}</span>
              <span class="badge">${e.date}</span>
              <span class="badge">Rows: <b>${e.matches?.length || 0}</b></span>
            </div>
            <div class="row gap wrap" style="margin-top:10px;">
              <span class="badge">Tap to view card</span>
            </div>
          </div>
        `;
    }).join("")}
    </div>
  `;

    $$("[data-open-event]").forEach(el => {
        const open = () => {
            el.blur();
            openCalendarEventDetails(el.dataset.openEvent, { fromCalendar: true });
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

function participantInfo(participantRef) {
    const ref = String(participantRef ?? "").trim();
    if (!ref) {
        return { name: "TBD", photo: "", isChampion: false };
    }
    const byId = state.superstars.find(ss => ss.id === ref);
    if (byId) {
        return {
            name: byId.name || "TBD",
            photo: superstarPhotoURL(byId),
            isChampion: !!byId.isChampion,
        };
    }
    const byName = state.superstars.find(ss => ss.name.toLowerCase() === ref.toLowerCase());
    if (byName) {
        return {
            name: byName.name || "TBD",
            photo: superstarPhotoURL(byName),
            isChampion: !!byName.isChampion,
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
    if (!isISODate(nextDate)) {
        await openModal({
            title: "Invalid date",
            bodyHTML: `<div class="muted">Please choose a valid date for this PLE.</div>`,
            okText: "OK",
            cancelText: "Close"
        });
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
            const participants = Array.isArray(m.participants) ? m.participants : [];
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
        cancelText: "Close"
    });

    const modalActions = $(".modal-actions");
    const modalCancelBtn = $("#modalCancel");
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

    modalCancelBtn.classList.add("hidden");
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
    editPleBtn?.remove();
    plannerBtn.remove();
    deleteBtn.remove();
    modalCancelBtn.classList.remove("hidden");
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
    const type = $("#evType").value;
    const showId = $("#evShow").value || null;
    const showIds = type === "ppv"
        ? Array.from(selectedPpvShowIds)
        : (showId ? [showId] : []);
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

// -------------------- PLANNER (optimized, no full rerender on typing) --------------------
let plannerEventId = null;
const MIN_PARTICIPANT_SLOTS = 2;
let plannerDragSourceRow = null;
let plannerTouchDragState = null;

function participantSlotCount(match) {
    const participants = Array.isArray(match?.participants) ? match.participants : [];
    const configured = Math.floor(Number(match?.participantSlots) || 0);
    return Math.max(MIN_PARTICIPANT_SLOTS, participants.length, configured);
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

function capturePlannerRowPositions() {
    const positions = new Map();
    $$("#matchesBody tr[data-match-id]").forEach(tr => {
        const matchId = String(tr.dataset.matchId || "");
        if (!matchId) return;
        positions.set(matchId, tr.getBoundingClientRect().top);
    });
    return positions;
}

function animatePlannerRows(fromPositions) {
    if (!(fromPositions instanceof Map) || fromPositions.size === 0) return;
    const rows = $$("#matchesBody tr[data-match-id]");
    rows.forEach(tr => {
        const matchId = String(tr.dataset.matchId || "");
        const oldTop = fromPositions.get(matchId);
        if (typeof oldTop !== "number") return;
        const newTop = tr.getBoundingClientRect().top;
        const deltaY = oldTop - newTop;
        if (Math.abs(deltaY) < 1) return;
        tr.style.transition = "none";
        tr.style.transform = `translateY(${deltaY}px)`;
        requestAnimationFrame(() => {
            tr.style.transition = "transform 220ms cubic-bezier(0.22, 1, 0.36, 1)";
            tr.style.transform = "translateY(0)";
            const clear = () => {
                tr.style.transition = "";
                tr.style.transform = "";
                tr.removeEventListener("transitionend", clear);
            };
            tr.addEventListener("transitionend", clear);
        });
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

function renderPlannerEventSelect() {
    const sel = $("#plannerEventSelect");
    if (!sel) return;

    const events = [...state.events].sort((a, b) => a.date.localeCompare(b.date));

    sel.innerHTML = events.length
        ? events.map(e => {
            const names = eventShowNames(e);
            const label = names.length ? names.join(" + ") : showName(e.showId);
            return `<option value="${e.id}">${e.date} • ${escapeHTML(e.name || "(Unnamed)")} • ${escapeHTML(label)}</option>`;
        }).join("")
        : `<option value="">No events yet (create one)</option>`;

    if (!plannerEventId && events.length) plannerEventId = events[0].id;
    if (plannerEventId && events.some(e => e.id === plannerEventId)) sel.value = plannerEventId;

    sel.onchange = () => {
        plannerEventId = sel.value || null;
        renderPlanner(); // re-render on event switch only
    };
}

function plannerRosterOptions(ev) {
    const eventShows = eventShowIds(ev);
    const roster = eventShows.length
        ? state.superstars.filter(ss => {
            const ids = Array.isArray(ss?.showIds) ? ss.showIds : (ss?.showId ? [ss.showId] : []);
            return ids.some(showId => eventShows.includes(showId));
        })
        : state.superstars;
    return roster
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(ss => `<option value="${ss.id}">${escapeHTML(ss.name)} (${escapeHTML(ss.division)})</option>`)
        .join("");
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
    const isRivalryNotes = field === "rivalryNotes";
    if (!isStoryline && !isRivalryNotes) return;

    const title = isStoryline ? "Storyline Notes" : "Rivalry Notes";
    const emptyText = isStoryline ? "No storyline notes yet." : "No rivalry notes yet.";
    const placeholder = isStoryline ? "Write storyline notes..." : "Write rivalry notes...";
    const currentValue = String(ev.matches[row]?.[field] ?? "");
    const bodyHTML = `
      <div class="stack" style="gap:10px;">
        <div id="plannerNoteRead">${plannerNoteDisplayHTML(currentValue, emptyText)}</div>
        <textarea id="plannerNoteEdit" class="cell-input hidden" style="min-height:180px;" placeholder="${escapeAttr(placeholder)}">${escapeHTML(currentValue)}</textarea>
      </div>
    `;
    const modalPromise = openModal({
        title: `Match ${row + 1} • ${title}`,
        bodyHTML,
        okText: "Done",
        cancelText: "Close",
    });

    const modalActions = $(".modal-actions");
    const modalCancelBtn = $("#modalCancel");
    const modalOkBtn = $("#modalOk");
    const editBtn = document.createElement("button");
    editBtn.className = "btn secondary";
    editBtn.type = "button";
    editBtn.textContent = "Edit";

    modalCancelBtn.classList.add("hidden");
    modalActions.insertBefore(editBtn, modalOkBtn);

    const readEl = $("#plannerNoteRead");
    const editEl = $("#plannerNoteEdit");
    editBtn.addEventListener("click", () => {
        if (!readEl || !editEl) return;
        readEl.classList.add("hidden");
        editEl.classList.remove("hidden");
        editEl.focus();
        editEl.setSelectionRange(editEl.value.length, editEl.value.length);
    });

    const modalResult = await modalPromise;

    editBtn.remove();
    modalCancelBtn.classList.remove("hidden");

    if (!modalResult?.ok) return;

    const ev2 = getEvent(plannerEventId);
    if (!ev2 || !ev2.matches[row]) return;
    ev2.matches[row][field] = String(editEl?.value ?? "");
    upsertEvent(ev2);
    renderPlanner();
}

async function openPlannerEscortModal({ row, slot }) {
    const ev = getEvent(plannerEventId);
    if (!ev || !ev.matches[row]) return;
    const match = ev.matches[row];
    const participants = Array.isArray(match?.participants) ? match.participants : [];
    const participantId = String(participants[slot] || "").trim();
    if (!participantId) return;

    const participant = participantInfo(participantId);
    const managers = Array.from(new Set(
        state.superstars
            .map(ss => String(ss?.manager || "").trim())
            .filter(Boolean)
    )).sort((a, b) => a.localeCompare(b));
    const superstarOptions = state.superstars
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(ss => `<option value="${escapeAttr(escortRefForSuperstar(ss.id))}">Superstar: ${escapeHTML(ss.name)}</option>`)
        .join("");
    const managerOptions = managers
        .map(name => `<option value="${escapeAttr(escortRefForManager(name))}">Manager: ${escapeHTML(name)}</option>`)
        .join("");
    const currentEscorts = normalizedParticipantEscorts(match);
    const currentValue = String(currentEscorts[participantId] || "");

    const bodyHTML = `
      <div class="stack" style="gap:10px;">
        <div class="muted">Set ringside accompaniment for <b>${escapeHTML(participant.name)}</b>.</div>
        <select id="plannerEscortSelect" class="input">
          <option value="">None</option>
          ${superstarOptions}
          ${managerOptions}
        </select>
      </div>
    `;
    const modalPromise = openModal({
        title: `Match ${row + 1} • Accompaniment`,
        bodyHTML,
        okText: "Save",
    });
    const escortSelect = $("#plannerEscortSelect");
    if (escortSelect) {
        const options = Array.from(escortSelect.options).map(opt => opt.value);
        escortSelect.value = options.includes(currentValue) ? currentValue : "";
    }
    const ok = await modalPromise;
    if (!ok?.ok) return;

    const selected = String($("#plannerEscortSelect")?.value || "").trim();
    const ev2 = getEvent(plannerEventId);
    if (!ev2 || !ev2.matches[row]) return;
    const escorts = normalizedParticipantEscorts(ev2.matches[row]);
    if (!selected) delete escorts[participantId];
    else escorts[participantId] = selected;
    ev2.matches[row].participantEscorts = escorts;
    upsertEvent(ev2);
    renderPlanner();
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

function reconcilePlannerMatchTeams(match) {
    const participants = Array.isArray(match?.participants) ? match.participants.filter(Boolean) : [];
    const isTeamBased = isTeamOrHandicapMatch(match?.matchType, participants.length);
    if (!isTeamBased) {
        match.participantTeams = {};
        match.teamNames = {};
        if (!participants.includes(match.result)) match.result = "";
        if (!participants.includes(match.pinBy)) match.pinBy = "";
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

function renderPlanner(fromPositions = null) {
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
    if (ensurePlannerMatchIds(ev)) upsertEvent(ev);

    const metaShows = eventShowNames(ev);
    meta.textContent = `${ev.date} • ${ev.type.toUpperCase()} • ${metaShows.length ? metaShows.join(" + ") : showName(ev.showId)} • ${ev.matches.length} rows`;

    const optionsHTML = plannerRosterOptions(ev);
    const eventShows = eventShowIds(ev);
    const availableChampionships = eligibleChampionshipsForShowIds(eventShows);
    const availableChampionshipIdSet = new Set(availableChampionships.map(c => c.id));
    let clearedUnavailableChampionship = false;
    ev.matches = ev.matches.map(match => {
        const championshipId = String(match?.championshipId || "").trim();
        if (championshipId && !availableChampionshipIdSet.has(championshipId)) {
            clearedUnavailableChampionship = true;
            return { ...match, championshipId: "" };
        }
        return match;
    });
    if (clearedUnavailableChampionship) upsertEvent(ev);
    const championshipOptionsHTML = [
        `<option value="">None</option>`,
        ...availableChampionships.map(c => `<option value="${escapeAttr(c.id)}">${escapeHTML(c.name)}</option>`)
    ].join("");

    body.innerHTML = ev.matches.map((m, idx) => {
        const slotCount = participantSlotCount(m);
        const participants = Array.isArray(m.participants) ? m.participants.filter(Boolean) : [];
        const participantTeams = normalizedParticipantTeams(m);
        const teamGroups = inferMatchTeams(m.matchType, participants, participantTeams);
        const isTeamBased = isTeamOrHandicapMatch(m.matchType, participants.length);
        const isTagTeam = isTagTeamMatchType(m.matchType);
        const teamNameMap = normalizedTeamNames(m);
        const winningTeamKey = parseTeamResultValue(m.result);
        const winningTeam = teamGroups.find(group => group.key === winningTeamKey) || null;
        const teamOptionCount = Math.max(
            2,
            slotCount,
            ...Object.values(participantTeams).map(teamKeyIndex),
            ...teamGroups.map(group => teamKeyIndex(group.key)),
        );
        const participantTeamOptions = Array.from({ length: teamOptionCount }, (_, teamIdx) => {
            const teamKey = `T${teamIdx + 1}`;
            return `<option value="${teamKey}">${escapeHTML(teamLabel(teamKey))}</option>`;
        }).join("");
        const specialResultOptions = `
            <option value="DQ">DQ</option>
            <option value="Promo">Promo</option>
        `;
        const winnerOptions = isTeamBased
            ? [
                ...teamGroups.map(group => `<option value="${escapeAttr(teamResultValue(group.key))}">${escapeHTML(teamDisplayName(m, group.key, group.participants))}</option>`),
                specialResultOptions,
            ].join("")
            : [
                ...participants.map(pid => {
                    const name = superstarNameById(pid) || pid;
                    return `<option value="${escapeAttr(pid)}">${escapeHTML(name)}</option>`;
                }),
                specialResultOptions,
            ].join("");
        const showPinBy = isTeamBased;
        const pinPool = showPinBy
            ? (winningTeam?.participants?.length ? winningTeam.participants : participants)
            : participants;
        const pinByOptions = pinPool.map(pid => {
            const name = superstarNameById(pid) || pid;
            return `<option value="${escapeAttr(pid)}">${escapeHTML(name)}</option>`;
        }).join("");
        const participantFields = Array.from({ length: slotCount }).map((_, slotIdx) => `
          <div class="row gap wrap">
            <select class="cell-input small" data-field="participant" data-slot="${slotIdx}">
              <option value="">${slotIdx < 2 ? "(select)" : "(optional)"}</option>
              ${optionsHTML}
            </select>
            <button
              type="button"
              class="btn secondary participant-add-btn"
              data-open-escort="${slotIdx}"
              title="Add ringside accompaniment"
              aria-label="Add ringside accompaniment"
            >+</button>
            ${isTeamBased ? `
              <select class="cell-input small" data-field="participantTeam" data-slot="${slotIdx}" style="max-width:120px;">
                <option value="">(team)</option>
                ${participantTeamOptions}
              </select>
            ` : ``}
          </div>
        `).join("");
        const teamNameFields = isTagTeam && teamGroups.length
            ? `
              <div class="stack" style="gap:6px;">
                ${teamGroups.map(group => {
                    const teamLabelValue = teamLabel(group.key);
                    const optionValues = factionOptionsForParticipants(group.participants);
                    const currentName = String(teamNameMap[group.key] || "");
                    if (currentName && !optionValues.includes(currentName)) optionValues.push(currentName);
                    optionValues.sort((a, b) => a.localeCompare(b));
                    return `
                      <select class="cell-input small" data-field="teamName" data-team-key="${escapeAttr(group.key)}">
                        <option value="">${escapeHTML(teamLabelValue)}</option>
                        ${optionValues.map(name => `<option value="${escapeAttr(name)}">${escapeHTML(name)}</option>`).join("")}
                      </select>
                    `;
                }).join("")}
              </div>
            `
            : "";
        const removeParticipantBtn = slotCount > MIN_PARTICIPANT_SLOTS
            ? `<button type="button" class="btn secondary participant-add-btn" data-remove-participant="${idx}">-</button>`
            : "";

        return `
      <tr data-row="${idx}" data-match-id="${escapeAttr(m.id || "")}" draggable="true">
        <td>
          <div class="stack" style="gap:6px;">
            <button
              type="button"
              class="planner-drag-handle"
              data-drag-handle
              title="Drag to reorder match"
              aria-label="Drag to reorder match"
            >&#8942;&#8942;</button>
            <div class="row gap">
              <button type="button" class="btn secondary participant-add-btn" data-add-participant="${idx}">+</button>
              ${removeParticipantBtn}
            </div>
          </div>
        </td>
        <td>
          <div class="stack">
            ${participantFields}
          </div>
        </td>
        <td>
          <input class="cell-input small" data-field="matchType" value="${escapeAttr(m.matchType || "")}" placeholder="1v1 / tag / promo…" />
        </td>
        <td>
          <div class="planner-note-cell">
            <button type="button" class="btn secondary planner-note-btn" data-open-note="storyline">View</button>
          </div>
        </td>
        <td>
          <select class="cell-input small" data-field="championshipId">
            ${championshipOptionsHTML}
          </select>
        </td>
        <td>
          <div class="stack" style="gap:6px;">
            ${teamNameFields}
            <select class="cell-input small" data-field="result">
              <option value="">(winner)</option>
              ${winnerOptions}
            </select>
            ${showPinBy ? `
              <select class="cell-input small" data-field="pinBy">
                <option value="">(who got the pin)</option>
                ${pinByOptions}
              </select>
            ` : ``}
          </div>
        </td>
        <td>
          <div class="planner-note-cell">
            <button type="button" class="btn secondary planner-note-btn" data-open-note="rivalryNotes">View</button>
          </div>
        </td>
        <td>
          <button class="btn danger" data-del-row="${idx}">X</button>
        </td>
      </tr>
    `;
    }).join("");
    animatePlannerRows(fromPositions);

    // Set selected values after render (avoids brittle string replacement)
    $$("#matchesBody tr").forEach(tr => {
        const row = Number(tr.dataset.row);
        const match = ev.matches[row];
        const p = match.participants || [];
        const participantTeams = normalizedParticipantTeams(match);
        $$('[data-field="participant"]', tr).forEach((el, slotIdx) => {
            el.value = p[slotIdx] || "";
        });
        $$('[data-field="participantTeam"]', tr).forEach((el, slotIdx) => {
            const participantId = p[slotIdx] || "";
            el.value = participantId ? (participantTeams[participantId] || "") : "";
        });
        const resultSelect = tr.querySelector('[data-field="result"]');
        if (resultSelect) {
            const resultValue = String(match.result || "");
            const normalizedTeamResult = parseTeamResultValue(resultValue);
            const normalizedResultValue = normalizedTeamResult ? teamResultValue(normalizedTeamResult) : resultValue;
            if (!resultValue) {
                resultSelect.value = "";
            } else if (Array.from(resultSelect.options).some(opt => opt.value === normalizedResultValue)) {
                resultSelect.value = normalizedResultValue;
            } else {
                const normalizedResult = normalizeNameForCompare(resultValue);
                const matchedOption = Array.from(resultSelect.options).find(opt => {
                    if (!opt.value) return false;
                    return normalizeNameForCompare(superstarNameById(opt.value)) === normalizedResult;
                });
                if (matchedOption) {
                    resultSelect.value = matchedOption.value;
                } else {
                    resultSelect.value = "";
                }
            }
        }
        $$('[data-field="teamName"]', tr).forEach(select => {
            const teamKey = normalizeTeamKey(select.dataset.teamKey);
            const teamNameValue = String(normalizedTeamNames(match)[teamKey] || "");
            const options = Array.from(select.options).map(opt => opt.value);
            const nextValue = options.includes(teamNameValue) ? teamNameValue : "";
            select.value = nextValue;
        });
        $$('[data-open-escort]', tr).forEach((btn, slotIdx) => {
            const participantId = p[slotIdx] || "";
            btn.disabled = !participantId;
            btn.title = participantId ? "Add ringside accompaniment" : "Select a superstar first";
        });
        const pinBySelect = tr.querySelector('[data-field="pinBy"]');
        if (pinBySelect) {
            const pinByValue = String(match.pinBy || "");
            if (pinByValue && Array.from(pinBySelect.options).some(opt => opt.value === pinByValue)) {
                pinBySelect.value = pinByValue;
            } else {
                pinBySelect.value = "";
            }
        }
        const championshipSelect = tr.querySelector('[data-field="championshipId"]');
        if (championshipSelect) {
            const championshipId = String(match.championshipId || "");
            championshipSelect.value = Array.from(championshipSelect.options).some(opt => opt.value === championshipId)
                ? championshipId
                : "";
        }
    });

    $$("#matchesBody tr").forEach(tr => {
        tr.addEventListener("dragstart", (e) => {
            if (!e.target.closest("[data-drag-handle]")) {
                e.preventDefault();
                return;
            }
            plannerDragSourceRow = Number(tr.dataset.row);
            tr.classList.add("planner-row-dragging");
            if (e.dataTransfer) {
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", String(plannerDragSourceRow));
            }
        });

        tr.addEventListener("dragover", (e) => {
            if (plannerDragSourceRow === null) return;
            e.preventDefault();
            tr.classList.add("planner-row-drop-target");
            if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
        });

        tr.addEventListener("dragleave", () => {
            tr.classList.remove("planner-row-drop-target");
        });

        tr.addEventListener("drop", (e) => {
            e.preventDefault();
            tr.classList.remove("planner-row-drop-target");

            const toIndex = Number(tr.dataset.row);
            const fromIndex = plannerDragSourceRow;
            plannerDragSourceRow = null;
            if (!Number.isInteger(fromIndex)) return;

            const ev2 = getEvent(plannerEventId);
            if (!ev2) return;

            const oldPositions = capturePlannerRowPositions();
            const moved = movePlannerMatch(ev2.matches, fromIndex, toIndex);
            if (!moved) return;
            renumberPlannerMatches(ev2.matches);
            upsertEvent(ev2);
            renderPlanner(oldPositions);
        });

        tr.addEventListener("dragend", () => {
            plannerDragSourceRow = null;
            $$("#matchesBody tr").forEach(rowEl => {
                rowEl.classList.remove("planner-row-dragging");
                rowEl.classList.remove("planner-row-drop-target");
            });
        });
    });

    const clearTouchDragClasses = () => {
        $$("#matchesBody tr").forEach(rowEl => {
            rowEl.classList.remove("planner-row-dragging");
            rowEl.classList.remove("planner-row-drop-target");
        });
    };

    const getTouchDropRow = (x, y) => {
        const target = document.elementFromPoint(x, y);
        if (!target) return null;
        return target.closest("#matchesBody tr");
    };

    $$("[data-drag-handle]").forEach(handle => {
        handle.addEventListener("pointerdown", (e) => {
            if (e.pointerType !== "touch") return;
            const tr = handle.closest("tr");
            if (!tr) return;
            e.preventDefault();
            plannerTouchDragState = {
                pointerId: e.pointerId,
                fromIndex: Number(tr.dataset.row),
                overIndex: Number(tr.dataset.row),
            };
            clearTouchDragClasses();
            tr.classList.add("planner-row-dragging");
            handle.setPointerCapture(e.pointerId);
        });

        handle.addEventListener("pointermove", (e) => {
            if (!plannerTouchDragState) return;
            if (plannerTouchDragState.pointerId !== e.pointerId) return;
            const overRow = getTouchDropRow(e.clientX, e.clientY);
            if (!overRow) return;
            const overIndex = Number(overRow.dataset.row);
            if (!Number.isInteger(overIndex)) return;
            plannerTouchDragState.overIndex = overIndex;
            clearTouchDragClasses();
            overRow.classList.add("planner-row-drop-target");
            const sourceRow = $(`#matchesBody tr[data-row="${plannerTouchDragState.fromIndex}"]`);
            sourceRow?.classList.add("planner-row-dragging");
        });

        const finishTouchDrag = (e) => {
            if (!plannerTouchDragState) return;
            if (plannerTouchDragState.pointerId !== e.pointerId) return;
            const { fromIndex, overIndex } = plannerTouchDragState;
            plannerTouchDragState = null;
            clearTouchDragClasses();
            if (!Number.isInteger(fromIndex) || !Number.isInteger(overIndex) || fromIndex === overIndex) return;
            const ev2 = getEvent(plannerEventId);
            if (!ev2) return;
            const oldPositions = capturePlannerRowPositions();
            const moved = movePlannerMatch(ev2.matches, fromIndex, overIndex);
            if (!moved) return;
            renumberPlannerMatches(ev2.matches);
            upsertEvent(ev2);
            renderPlanner(oldPositions);
        };

        handle.addEventListener("pointerup", finishTouchDrag);
        handle.addEventListener("pointercancel", finishTouchDrag);
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
            const teamInputs = $$('[data-field="participantTeam"]', tr);
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
            const prevEscorts = normalizedParticipantEscorts(ev2.matches[row]);
            const nextEscorts = {};
            ev2.matches[row].participants.forEach(participantId => {
                if (prevEscorts[participantId]) nextEscorts[participantId] = prevEscorts[participantId];
            });
            ev2.matches[row].participantEscorts = nextEscorts;
            const prevTeams = normalizedParticipantTeams(ev2.matches[row]);
            const nextTeams = {};
            deduped.forEach((participantId, slotIdx) => {
                if (!participantId) return;
                const teamFromUi = teamInputs[slotIdx]?.value || "";
                const team = normalizeTeamKey(teamFromUi || prevTeams[participantId] || "");
                if (team) nextTeams[participantId] = team;
            });
            ev2.matches[row].participantTeams = nextTeams;
            ev2.matches[row].participantSlots = participantSlotCount(ev2.matches[row]);
            reconcilePlannerMatchTeams(ev2.matches[row]);
            upsertEvent(ev2); // debounced via saveSoon
            renderPlanner();
            return;
        } else if (field === "participantTeam") {
            const slot = Number(target.dataset.slot);
            const participantInputs = $$('[data-field="participant"]', tr);
            const participantId = participantInputs[slot]?.value || "";
            const teams = normalizedParticipantTeams(ev2.matches[row]);
            const nextTeam = normalizeTeamKey(target.value);
            if (participantId && nextTeam) {
                teams[participantId] = nextTeam;
            } else if (participantId) {
                delete teams[participantId];
            }
            ev2.matches[row].participantTeams = teams;
            reconcilePlannerMatchTeams(ev2.matches[row]);
            upsertEvent(ev2); // debounced via saveSoon
            renderPlanner();
            return;
        } else if (field === "result") {
            ev2.matches[row].result = target.value;
            reconcilePlannerMatchTeams(ev2.matches[row]);
            upsertEvent(ev2); // debounced via saveSoon
            renderPlanner();
            return;
        } else if (field === "teamName") {
            const names = normalizedTeamNames(ev2.matches[row]);
            const key = normalizeTeamKey(target.dataset.teamKey);
            if (!key) return;
            const nextName = String(target.value || "").trim();
            if (!nextName) delete names[key];
            else names[key] = nextName;
            ev2.matches[row].teamNames = names;
            upsertEvent(ev2);
            renderPlanner();
            return;
        } else if (field === "pinBy") {
            ev2.matches[row].pinBy = target.value;
        } else {
            ev2.matches[row][field] = target.value;
            if (field === "matchType") {
                reconcilePlannerMatchTeams(ev2.matches[row]);
                upsertEvent(ev2); // debounced via saveSoon
                // Avoid re-rendering on every keystroke on mobile; refresh once field is committed.
                if (e.type === "change") renderPlanner();
                return;
            }
        }

        upsertEvent(ev2); // debounced via saveSoon
    };
    body.oninput = handlePlannerRowEdit;
    body.onchange = handlePlannerRowEdit;

    // Note editor buttons
    $$("[data-open-note]").forEach(btn => {
        btn.addEventListener("click", async () => {
            const tr = btn.closest("tr");
            if (!tr) return;
            const row = Number(tr.dataset.row);
            const field = String(btn.dataset.openNote || "");
            await openPlannerNoteModal({ row, field });
        });
    });
    $$("[data-open-escort]").forEach(btn => {
        btn.addEventListener("click", async () => {
            const tr = btn.closest("tr");
            if (!tr) return;
            const row = Number(tr.dataset.row);
            const slot = Number(btn.dataset.openEscort);
            await openPlannerEscortModal({ row, slot });
        });
    });

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
            const remaining = new Set(ev2.matches[idx].participants || []);
            const nextEscorts = {};
            Object.entries(normalizedParticipantEscorts(ev2.matches[idx])).forEach(([participantId, escortRef]) => {
                if (!remaining.has(participantId)) return;
                nextEscorts[participantId] = escortRef;
            });
            ev2.matches[idx].participantEscorts = nextEscorts;
            const nextTeams = {};
            Object.entries(normalizedParticipantTeams(ev2.matches[idx])).forEach(([participantId, teamKey]) => {
                if (!remaining.has(participantId)) return;
                nextTeams[participantId] = teamKey;
            });
            ev2.matches[idx].participantTeams = nextTeams;
            reconcilePlannerMatchTeams(ev2.matches[idx]);
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
            renumberPlannerMatches(ev2.matches);
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
    await addEventFlow(getUniverseCurrentISO());
}

function openPlanner(eventId) {
    plannerEventId = eventId;
    setView("planner");
    renderPlanner();
}

// -------------------- SETTINGS: POPULATE / GENERATE --------------------
const SETTINGS_JSON_EXAMPLE = `{
  "championships": [
    { "name": "World Heavyweight Championship" },
    { "name": "Intercontinental Championship" }
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
    }
}

async function openSettingsPanel(panelKey) {
    const panels = {
        weekly: { title: "Weekly Calendar Setup", render: renderWeeklySettingsPanel },
        shows: { title: "Manage Shows", render: renderShowsSettingsPanel },
        championships: { title: "Manage Championships", render: renderChampionshipSettingsPanel },
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
    });
    $("#modalCancel").classList.add("hidden");
    panel.render();
    await modalPromise;
    $("#modalCancel").classList.remove("hidden");
}

function renderSettingsTools() {
    const panels = $("#settingsPanels");
    if (!panels) return;

    const weeklyCount = (state.weeklySchedule || []).filter(row =>
        state.shows.some(s => s.id === row.showId) &&
        Number.isInteger(Number(row.weekday))
    ).length;
    const pleCount = state.events.filter(ev => String(ev?.type || "").toLowerCase() === "ppv").length;

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
                      <div class="settings-inline-edit">
                        <div class="row gap wrap">
                          <input class="input grow" data-settings-show-name="${show.id}" value="${escapeAttr(show.name)}" />
                          <input class="input" type="color" data-settings-show-color="${show.id}" value="${escapeAttr(show.color || "#d00000")}" />
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

    root.innerHTML = `
      <div class="stack">
        <div class="row gap wrap">
          <input id="championshipNameInput" class="input grow" placeholder="Championship name (e.g., Intercontinental Championship)" />
          <button class="btn" id="addChampionshipBtn">Add Championship</button>
        </div>
        ${settingsStatusHTML("settingsChampionshipStatus", settingsUiState.championships.message)}
        <div id="championshipsList" class="stack">
          ${!state.championships.length ? `<div class="item"><div class="muted tiny">No championships yet. Add one above.</div></div>` : `
            <div class="list">
              ${state.championships.map(championship => {
                const isEditing = settingsUiState.championships.editingId === championship.id;
                const isDeleting = settingsUiState.championships.deletingId === championship.id;
                return `
                  <div class="item">
                    <div class="item-title">${escapeHTML(championship.name)}</div>
                    <div class="item-actions">
                      <button class="btn secondary" data-edit-title="${championship.id}">${isEditing ? "Cancel" : "Edit"}</button>
                      <button class="btn danger" data-del-title="${championship.id}">${isDeleting ? "Cancel Delete" : "Delete"}</button>
                    </div>
                    ${isEditing ? `
                      <div class="settings-inline-edit">
                        <div class="row gap wrap">
                          <input class="input grow" data-settings-title-name="${championship.id}" value="${escapeAttr(championship.name)}" />
                          <button class="btn" data-settings-save-title="${championship.id}">Save</button>
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
        const name = input.value.trim();
        if (!name) {
            setSettingsStatus(status, "Enter a championship name before adding it.", "danger");
            return;
        }

        const added = addChampionshipByName(name);
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

    $$("[data-settings-save-title]", root).forEach(btn => {
        btn.onclick = () => {
            const id = btn.dataset.settingsSaveTitle;
            const championship = getChampionship(id);
            if (!championship) return;

            const nameInput = $(`[data-settings-title-name="${id}"]`, root);
            const nextName = nameInput.value.trim();
            if (!nextName) {
                setSettingsStatus(status, "Championship name cannot be empty.", "danger");
                return;
            }

            const duplicate = state.championships.find(c => c.id !== id && c.name.toLowerCase() === nextName.toLowerCase());
            if (duplicate) {
                setSettingsStatus(status, "A championship with that name already exists.", "danger");
                return;
            }

            state.championships = state.championships.map(c => c.id === id ? { ...c, name: nextName } : c);
            settingsUiState.championships.message = { tone: "success", text: `${nextName} updated.` };
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
            <span class="muted tiny">I understand this deletes all shows, roster data, and events.</span>
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

    $("#settingsExportBtn", root).onclick = () => {
        exportUniverseJSON();
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
            fileInput.value = "";
            renderAll();
            setSettingsStatus(
                status,
                result.mode === "snapshot"
                    ? `Universe restored: ${result.roster} roster entries, ${result.championships} championships, ${result.shows} shows, ${result.events} events, ${result.weeklySchedule} weekly rules, and ${result.completedDates} completed days loaded.`
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
        state = normalizeStateData(store.load());
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

function addChampionshipByName(rawName) {
    const name = String(rawName ?? "").trim();
    if (!name) return false;
    const exists = state.championships.some(c => c.name.toLowerCase() === name.toLowerCase());
    if (exists) return false;
    state.championships.push(enrichChampionship({ name }));
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
            return championshipAvailableForShowIds(championship, showIds);
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
        const date = String(row?.date ?? "").trim();
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
        const iso = toISODateLocal(cur);
        const dow = calendarWeekdaySundayZero(cur);

        for (const rule of rules) {
            if (rule.weekday === dow) {
                const key = `${iso}|${rule.showId}|weekly`;
                if (existing.has(key)) continue;

                const show = getShow(rule.showId);
                const name = `${show?.name || "Weekly"} • ${iso}`;
                const matches = Array.from({ length: Number(defaultRows) || 0 }).map((_, i) => ({
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

$("#openAddSSModal").addEventListener("click", () => {
    addSuperstarShowIds = new Set();
    openAddSuperstarFlow();
});

$("#rosterSearch").addEventListener("input", () => renderRoster());

$("#calPrev").addEventListener("click", () => { calCursor.setMonth(calCursor.getMonth() - 1); renderCalendar(); });
$("#calNext").addEventListener("click", () => { calCursor.setMonth(calCursor.getMonth() + 1); renderCalendar(); });
$("#calToday").addEventListener("click", () => {
    const now = parseISO(getUniverseCurrentISO());
    calCursor = new Date(now);
    calCursor.setDate(1);
    calCursor.setHours(0, 0, 0, 0);
    calSelectedISO = toISODateLocal(now);
    renderCalendar();
});
$("#calUniverseStartDate")?.addEventListener("change", (e) => {
    const iso = String(e.target.value || "");
    if (!isISODate(iso)) return;
    state.universeStartDate = iso;
    const startDate = parseISO(iso);
    calCursor = new Date(startDate);
    calCursor.setDate(1);
    calCursor.setHours(0, 0, 0, 0);
    calSelectedISO = iso;
    saveSoon();
    renderCalendar();
    renderDashboard();
});
$("#calSetStartFromSelected")?.addEventListener("click", () => {
    if (!isISODate(calSelectedISO)) return;
    state.universeStartDate = calSelectedISO;
    saveSoon();
    renderCalendar();
    renderDashboard();
});
$("#calToggleDone")?.addEventListener("click", () => {
    if (!isISODate(calSelectedISO)) return;
    const done = isUniverseDateCompleted(calSelectedISO);
    setUniverseDateCompleted(calSelectedISO, !done);
    saveSoon();
    renderCalendar();
    renderDashboard();
});
$("#calProgressDay")?.addEventListener("click", () => {
    if (!isISODate(calSelectedISO)) return;
    setUniverseDateCompleted(calSelectedISO, true);
    const next = parseISO(calSelectedISO);
    next.setDate(next.getDate() + 1);
    calSelectedISO = toISODateLocal(next);
    calCursor = new Date(next);
    calCursor.setDate(1);
    calCursor.setHours(0, 0, 0, 0);
    saveSoon();
    renderCalendar();
    renderDashboard();
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
function exportUniverseJSON() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `universe-booker-backup-${todayISO()}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

// -------------------- INIT --------------------
(function init() {
    setView("dashboard");
})();
