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

    const validShowIds = new Set(
        Array.isArray(normalized.shows)
            ? normalized.shows.map(s => String(s?.id ?? "").trim()).filter(Boolean)
            : []
    );
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
            if (isDQResult(resultValue)) return; // DQ does not affect W/L/D

            if (isDrawRecordResult(resultValue)) {
                participantIds.forEach(pid => {
                    const rec = records.get(pid);
                    if (!rec) return;
                    rec.draws += 1;
                });
                return;
            }

            if (resultValue === "TEAM:A" || resultValue === "TEAM:B") {
                const teams = inferMatchTeams(match?.matchType, participantIds, normalizedParticipantTeams(match));
                const winners = resultValue === "TEAM:A" ? (teams?.[0] || []) : (teams?.[1] || []);
                const losers = resultValue === "TEAM:A" ? (teams?.[1] || []) : (teams?.[0] || []);
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
function normalizedParticipantTeams(match) {
    const raw = match?.participantTeams;
    if (!raw || typeof raw !== "object") return {};
    const out = {};
    Object.entries(raw).forEach(([participantId, team]) => {
        const pid = String(participantId || "").trim();
        const t = String(team || "").trim().toUpperCase();
        if (!pid) return;
        if (t !== "A" && t !== "B") return;
        out[pid] = t;
    });
    return out;
}
function inferMatchTeams(matchType, participantIds, participantTeams = {}) {
    const ids = Array.isArray(participantIds) ? participantIds.filter(Boolean) : [];
    if (ids.length < 3) return null;
    const teamAExplicit = ids.filter(id => participantTeams[id] === "A");
    const teamBExplicit = ids.filter(id => participantTeams[id] === "B");
    if (teamAExplicit.length && teamBExplicit.length) {
        return [teamAExplicit, teamBExplicit];
    }
    const t = String(matchType || "").toLowerCase();
    if (t.includes("handicap")) {
        return [ids.slice(0, 1), ids.slice(1)];
    }
    if (t.includes("tag")) {
        const split = Math.ceil(ids.length / 2);
        return [ids.slice(0, split), ids.slice(split)];
    }
    return null;
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
    return d.toISOString().slice(0, 10);
}
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
    if (rawResult === "TEAM:A" || rawResult === "TEAM:B") return rawResult;
    if (participantIds.includes(rawResult)) return rawResult;
    const result = normalizeNameForCompare(rawResult);
    for (const pid of participantIds) {
        const participantName = normalizeNameForCompare(superstarNameById.get(pid) || "");
        if (!participantName) continue;
        if (result.includes(participantName)) return pid;
    }
    return null;
}
function matchImportanceMultiplier(event, matchIndex, matchesLength, match) {
    const isMainEvent = matchIndex === (matchesLength - 1);
    const isPpv = event.type === "ppv";
    const titleHint = `${match?.matchType || ""} ${match?.storyline || ""}`.toLowerCase();
    const isTitle = /title|championship|champ\b/.test(titleHint);
    if (isTitle && isPpv) return 1.85;
    if (isTitle) return 1.6;
    if (isPpv) return 1.35;
    if (isMainEvent) return 1.15;
    return 1.0;
}
function computeWeeklyRankings(topN = 3) {
    const baseRating = 1500;
    const kBase = 24;
    const weekStartISO = toISODateDaysAgo(6);
    const records = computeSuperstarRecords();

    const superstarNameToId = new Map(
        state.superstars.map(ss => [normalizeNameForCompare(ss.name), ss.id])
    );
    const superstarNameById = new Map(
        state.superstars.map(ss => [ss.id, ss.name])
    );
    const ratings = new Map();
    const recentForm = new Map();

    state.superstars.forEach(ss => {
        const record = superstarRecordById(ss.id, records);
        const winLossBonus = (toNonNegativeInt(record.wins) - toNonNegativeInt(record.losses)) * 8;
        const championBonus = ss.isChampion ? 35 : 0;
        const titleDepthBonus = parseChampionships(ss.championships).length * 10;
        ratings.set(ss.id, baseRating + winLossBonus + championBonus + titleDepthBonus);
        recentForm.set(ss.id, 0);
    });

    const processedEvents = state.events
        .filter(e => /^\d{4}-\d{2}-\d{2}$/.test(String(e?.date || "")))
        .filter(e => e.date <= todayISO())
        .slice()
        .sort((a, b) => a.date.localeCompare(b.date));

    for (const ev of processedEvents) {
        const matches = Array.isArray(ev.matches) ? ev.matches : [];
        matches.forEach((match, idx) => {
            const participantIds = resolveMatchParticipantIds(match, superstarNameToId);
            if (participantIds.length < 2) return;

            const winnerId = resolveMatchWinnerId(match, participantIds, superstarNameById);
            const pinById = String(match?.pinBy ?? "").trim();
            const m = matchImportanceMultiplier(ev, idx, matches.length, match);
            const kEff = kBase * m;

            const deltas = new Map();
            participantIds.forEach(id => deltas.set(id, 0));

            const participantTeams = normalizedParticipantTeams(match);
            const teams = inferMatchTeams(match?.matchType, participantIds, participantTeams);
            if (teams && teams[0].length && teams[1].length) {
                const winningTeam = winnerId === "TEAM:A"
                    ? teams[0]
                    : winnerId === "TEAM:B"
                        ? teams[1]
                        : winnerId
                            ? (teams[0].includes(winnerId) ? teams[0] : (teams[1].includes(winnerId) ? teams[1] : []))
                            : [];
                const teamA = teams[0];
                const teamB = teams[1];

                for (const a of teamA) {
                    for (const b of teamB) {
                        const ra = ratings.get(a) ?? baseRating;
                        const rb = ratings.get(b) ?? baseRating;
                        const ea = 1 / (1 + Math.pow(10, (rb - ra) / 400));
                        const eb = 1 - ea;
                        let sa = 0.5;
                        let sb = 0.5;
                        if (winningTeam.length) {
                            if (winningTeam.includes(a)) {
                                sa = 1;
                                sb = 0;
                            } else if (winningTeam.includes(b)) {
                                sa = 0;
                                sb = 1;
                            }
                        }
                        deltas.set(a, (deltas.get(a) || 0) + (kEff * (sa - ea)));
                        deltas.set(b, (deltas.get(b) || 0) + (kEff * (sb - eb)));
                    }
                }

                // Slight extra reward for the pinfall scorer in tag/handicap matches
                if (pinById && winningTeam.includes(pinById)) {
                    deltas.set(pinById, (deltas.get(pinById) || 0) + (4 * m));
                }

                participantIds.forEach(id => {
                    ratings.set(id, (ratings.get(id) ?? baseRating) + (deltas.get(id) || 0));
                });

                if (ev.date >= weekStartISO) {
                    participantIds.forEach(id => {
                        let formDelta = 1.5 * m;
                        if (winningTeam.length) {
                            if (winningTeam.includes(id)) formDelta += 8 * m;
                            else formDelta -= 4 * m;
                        }
                        if (pinById && id === pinById && winningTeam.includes(id)) {
                            formDelta += 2 * m;
                        }
                        recentForm.set(id, (recentForm.get(id) || 0) + formDelta);
                    });
                }
                return;
            }

            for (let i = 0; i < participantIds.length; i++) {
                for (let j = i + 1; j < participantIds.length; j++) {
                    const a = participantIds[i];
                    const b = participantIds[j];
                    const ra = ratings.get(a) ?? baseRating;
                    const rb = ratings.get(b) ?? baseRating;
                    const ea = 1 / (1 + Math.pow(10, (rb - ra) / 400));
                    const eb = 1 - ea;
                    let sa = 0.5;
                    let sb = 0.5;
                    if (winnerId === a) {
                        sa = 1;
                        sb = 0;
                    } else if (winnerId === b) {
                        sa = 0;
                        sb = 1;
                    }
                    deltas.set(a, (deltas.get(a) || 0) + (kEff * (sa - ea)));
                    deltas.set(b, (deltas.get(b) || 0) + (kEff * (sb - eb)));
                }
            }

            participantIds.forEach(id => {
                ratings.set(id, (ratings.get(id) ?? baseRating) + (deltas.get(id) || 0));
            });

            if (ev.date >= weekStartISO) {
                participantIds.forEach(id => {
                    let formDelta = 1.5 * m;
                    if (winnerId === id) formDelta += 8 * m;
                    else if (winnerId) formDelta -= 4 * m;
                    recentForm.set(id, (recentForm.get(id) || 0) + formDelta);
                });
            }
        });
    }

    const byShow = new Map();
    for (const show of state.shows) {
        const rows = state.superstars
            .filter(ss => superstarOnShow(ss, show.id))
            .map(ss => ({
                superstar: ss,
                score: (ratings.get(ss.id) ?? baseRating) + (recentForm.get(ss.id) ?? 0),
            }))
            .sort((a, b) => {
                if (b.score !== a.score) return b.score - a.score;
                const bWins = toNonNegativeInt(superstarRecordById(b.superstar.id, records).wins);
                const aWins = toNonNegativeInt(superstarRecordById(a.superstar.id, records).wins);
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
    const upcoming = state.events
        .filter(e => e.date >= todayISO())
        .sort((a, b) => a.date.localeCompare(b.date))[0];

    if (!upcoming) {
        el.innerHTML = `<div class="muted">No upcoming events. Add one from Calendar or Settings.</div>`;
    } else {
        const typeTag = upcoming.type === "ppv" ? "PLE" : "WEEKLY";
        const ppvShows = eventShowNames(upcoming).join(" + ");
        const matches = Array.isArray(upcoming.matches) ? upcoming.matches : [];
        const mainEvent = matches.length ? matches[matches.length - 1] : null;
        const mainEventParticipants = Array.isArray(mainEvent?.participants) ? mainEvent.participants : [];
        const mainEventLeft = participantInfo(mainEventParticipants[0] || "");
        const mainEventRight = participantInfo(mainEventParticipants[1] || "");
        const mainEventType = String(mainEvent?.matchType || "").trim();
        const mainEventChampionshipName = championshipName(String(mainEvent?.championshipId || "").trim());
        const mainEventTitleHint = `${mainEvent?.matchType || ""} ${mainEvent?.storyline || ""} ${mainEvent?.rivalryNotes || ""}`.toLowerCase();
        const isChampionshipMainEvent = !!mainEventChampionshipName
            || /title|championship|champ\b/.test(mainEventTitleHint);
        const showTagText = upcoming.type === "ppv"
            ? (ppvShows || "PLE")
            : showName(upcoming.showId);
        const showTagStyle = upcoming.type === "ppv"
            ? "background:rgba(255,255,255,.14);border-color:rgba(255,255,255,.28);"
            : `background:rgba(255,255,255,.08);border-color:${showColor(upcoming.showId)};`;
        el.innerHTML = `
      <div class="stack" style="align-items:center;text-align:center;gap:8px;">
      <div><b>${escapeHTML(upcoming.name || "(Unnamed Event)")}</b></div>
      <div class="muted tiny">${upcoming.date}</div>
      <div class="row gap wrap" style="margin-top:2px;justify-content:center;">
        <span class="badge">${typeTag}</span>
        <span class="badge" style="${showTagStyle}">${escapeHTML(showTagText)}</span>
      </div>
      <div style="margin-top:4px;">
        ${mainEvent && isChampionshipMainEvent
                ? `<div class="event-championship-label">${escapeHTML(mainEventChampionshipName || "Championship")}</div>`
                : ``}
        ${mainEvent ? `
          <div class="event-fight-row" style="margin-top:6px;justify-content:center;">
            <div class="event-fighter">
              ${mainEventLeft.photo
                ? `<img class="event-fighter-photo" src="${escapeAttr(mainEventLeft.photo)}" alt="${escapeAttr(mainEventLeft.name)}" />`
                : `<div class="event-fighter-fallback">${mainEventLeft.name === "TBD" ? "?" : escapeHTML(superstarInitials(mainEventLeft.name))}</div>`
            }
              <div class="tiny event-fighter-name">${escapeHTML(mainEventLeft.name)}${mainEventLeft.isChampion ? ` <span class="event-champ">C</span>` : ``}</div>
            </div>
            <div class="event-vs">VS</div>
            <div class="event-fighter">
              ${mainEventRight.photo
                ? `<img class="event-fighter-photo" src="${escapeAttr(mainEventRight.photo)}" alt="${escapeAttr(mainEventRight.name)}" />`
                : `<div class="event-fighter-fallback">${mainEventRight.name === "TBD" ? "?" : escapeHTML(superstarInitials(mainEventRight.name))}</div>`
            }
              <div class="tiny event-fighter-name">${escapeHTML(mainEventRight.name)}${mainEventRight.isChampion ? ` <span class="event-champ">C</span>` : ``}</div>
            </div>
          </div>
          ${mainEventType ? `<div class="muted tiny" style="margin-top:6px;">${escapeHTML(mainEventType)}</div>` : ``}
        ` : `<div class="muted tiny">Not planned yet</div>`}
      </div>
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
            || normalized === "no result";
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
        if (!raw || raw === "TEAM:A" || raw === "TEAM:B") return "";
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

        if (resultValue === "TEAM:A" || resultValue === "TEAM:B") {
            const teams = inferMatchTeams(match?.matchType, participantIds, normalizedParticipantTeams(match));
            const winningTeam = resultValue === "TEAM:A" ? (teams?.[0] || []) : (teams?.[1] || []);
            const won = winningTeam.some(pid => selectedIdSet.has(pid));
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
            .filter(e => showFilter === "all" ? true : eventHasShow(e, showFilter));

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
        .filter(e => showFilter === "all" ? true : eventHasShow(e, showFilter));

    if (events.length === 0) {
        list.innerHTML = `<div class="muted">No events on <b>${calSelectedISO}</b>.</div>`;
        return;
    }

    list.innerHTML = `
    <div class="list">
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
            openCalendarEventDetails(el.dataset.openEvent);
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

async function openCalendarEventDetails(eventId) {
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
            const left = participantInfo(participants[0]);
            const right = participantInfo(participants[1]);
            const championshipOnTheLine = championshipName(String(m?.championshipId || "").trim());
            const title = m.matchType?.trim() || `Match ${m.num ?? (m._idx + 1)}`;
            const winnerRef = String(m.result ?? "").trim();
            const winnerName = winnerRef === "TEAM:A"
                ? "Team A"
                : winnerRef === "TEAM:B"
                    ? "Team B"
                    : superstarNameById(winnerRef);
            const pinByName = superstarNameById(String(m.pinBy ?? "").trim());
            const resultText = winnerName || winnerRef;
            const pinText = pinByName ? ` • Pin by: ${pinByName}` : "";

            return `
              <div class="event-match-card ${isMainEvent ? "main-event-card" : ""} ${championshipOnTheLine ? "has-championship-badge" : ""}">
                ${championshipOnTheLine ? `<div class="event-match-corner-title">${escapeHTML(championshipOnTheLine)}</div>` : ""}
                ${isMainEvent ? `<div class="event-main-label">Main Event</div>` : ""}
                <div class="event-match-title">${escapeHTML(title)}</div>
                <div class="event-fight-row">
                  <div class="event-fighter">
                    ${left.photo
                    ? `<img class="event-fighter-photo ${isMainEvent ? "event-fighter-photo-main" : ""}" src="${escapeAttr(left.photo)}" alt="${escapeAttr(left.name)}" />`
                    : `<div class="event-fighter-fallback ${isMainEvent ? "event-fighter-photo-main" : ""}">${left.name === "TBD" ? "?" : escapeHTML(superstarInitials(left.name))}</div>`
                }
                    <div class="tiny event-fighter-name">${escapeHTML(left.name)}${left.isChampion ? ` <span class="event-champ">C</span>` : ``}</div>
                  </div>
                  <div class="event-vs ${isMainEvent ? "event-vs-main" : ""}">VS</div>
                  <div class="event-fighter">
                    ${right.photo
                    ? `<img class="event-fighter-photo ${isMainEvent ? "event-fighter-photo-main" : ""}" src="${escapeAttr(right.photo)}" alt="${escapeAttr(right.name)}" />`
                    : `<div class="event-fighter-fallback ${isMainEvent ? "event-fighter-photo-main" : ""}">${right.name === "TBD" ? "?" : escapeHTML(superstarInitials(right.name))}</div>`
                }
                    <div class="tiny event-fighter-name">${escapeHTML(right.name)}${right.isChampion ? ` <span class="event-champ">C</span>` : ``}</div>
                  </div>
                </div>
                ${resultText ? `<div class="muted tiny">Result: ${escapeHTML(resultText)}${escapeHTML(pinText)}</div>` : ``}
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
    const deleteBtn = document.createElement("button");
    deleteBtn.className = "btn danger";
    deleteBtn.type = "button";
    deleteBtn.textContent = "Delete";

    modalCancelBtn.classList.add("hidden");
    modalActions.insertBefore(plannerBtn, modalOkBtn);
    modalActions.insertBefore(deleteBtn, modalOkBtn);

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
    const managers = managerNameSet();
    const roster = eventShows.length
        ? state.superstars.filter(ss => {
            if (managers.has(ss.name.toLowerCase())) return false;
            const ids = Array.isArray(ss?.showIds) ? ss.showIds : (ss?.showId ? [ss.showId] : []);
            return ids.some(showId => eventShows.includes(showId));
        })
        : state.superstars.filter(ss => !managers.has(ss.name.toLowerCase()));
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

    const metaShows = eventShowNames(ev);
    meta.textContent = `${ev.date} • ${ev.type.toUpperCase()} • ${metaShows.length ? metaShows.join(" + ") : showName(ev.showId)} • ${ev.matches.length} rows`;

    const optionsHTML = plannerRosterOptions(ev);
    const championshipOptionsHTML = [
        `<option value="">None</option>`,
        ...state.championships.map(c => `<option value="${escapeAttr(c.id)}">${escapeHTML(c.name)}</option>`)
    ].join("");

    body.innerHTML = ev.matches.map((m, idx) => {
        const slotCount = participantSlotCount(m);
        const participants = Array.isArray(m.participants) ? m.participants.filter(Boolean) : [];
        const participantTeams = normalizedParticipantTeams(m);
        const teams = inferMatchTeams(m.matchType, participants, participantTeams);
        const teamA = teams?.[0] || [];
        const teamB = teams?.[1] || [];
        const isTeamBased = isTeamOrHandicapMatch(m.matchType, participants.length);
        const winningTeam = m.result === "TEAM:A" ? teamA : m.result === "TEAM:B" ? teamB : [];
        const specialResultOptions = `
            <option value="DQ">DQ</option>
        `;
        const winnerOptions = isTeamBased
            ? [
                teamA.length ? `<option value="TEAM:A">Team A</option>` : "",
                teamB.length ? `<option value="TEAM:B">Team B</option>` : "",
                specialResultOptions,
            ].join("")
            : [
                ...participants.map(pid => {
                    const name = superstarNameById(pid) || pid;
                    return `<option value="${escapeAttr(pid)}">${escapeHTML(name)}</option>`;
                }),
                specialResultOptions,
            ].join("");
        const showPinBy = isTeamOrHandicapMatch(m.matchType, participants.length);
        const pinPool = showPinBy ? (winningTeam.length ? winningTeam : participants) : participants;
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
            ${isTeamBased ? `
              <select class="cell-input small" data-field="participantTeam" data-slot="${slotIdx}" style="max-width:110px;">
                <option value="">(team)</option>
                <option value="A">Team A</option>
                <option value="B">Team B</option>
              </select>
            ` : ``}
          </div>
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
          <select class="cell-input small" data-field="championshipId">
            ${championshipOptionsHTML}
          </select>
        </td>
        <td>
          <div class="stack" style="gap:6px;">
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
            if (!resultValue) {
                resultSelect.value = "";
            } else if (Array.from(resultSelect.options).some(opt => opt.value === resultValue)) {
                resultSelect.value = resultValue;
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
            const prevTeams = normalizedParticipantTeams(ev2.matches[row]);
            const nextTeams = {};
            deduped.forEach((participantId, slotIdx) => {
                if (!participantId) return;
                const teamFromUi = teamInputs[slotIdx]?.value || "";
                const team = (teamFromUi === "A" || teamFromUi === "B")
                    ? teamFromUi
                    : (prevTeams[participantId] || "");
                if (team === "A" || team === "B") nextTeams[participantId] = team;
            });
            ev2.matches[row].participantTeams = nextTeams;
            ev2.matches[row].participantSlots = participantSlotCount(ev2.matches[row]);
            const isTeamBased = isTeamOrHandicapMatch(ev2.matches[row].matchType, ev2.matches[row].participants.length);
            if (isTeamBased) {
                const teams = inferMatchTeams(ev2.matches[row].matchType, ev2.matches[row].participants, ev2.matches[row].participantTeams);
                const teamA = teams?.[0] || [];
                const teamB = teams?.[1] || [];
                if (ev2.matches[row].result !== "TEAM:A" && ev2.matches[row].result !== "TEAM:B") {
                    const normalizedResult = normalizeNameForCompare(ev2.matches[row].result);
                    const isSpecial = normalizedResult === "dq"
                        || normalizedResult.includes("disqualification")
                        || normalizedResult === "draw"
                        || normalizedResult === "tie"
                        || normalizedResult === "no contest"
                        || normalizedResult === "nc"
                        || normalizedResult === "no result";
                    if (!isSpecial) ev2.matches[row].result = "";
                }
                if (ev2.matches[row].result === "TEAM:A" && !teamA.length) ev2.matches[row].result = "";
                if (ev2.matches[row].result === "TEAM:B" && !teamB.length) ev2.matches[row].result = "";
                const winningPool = ev2.matches[row].result === "TEAM:A" ? teamA : ev2.matches[row].result === "TEAM:B" ? teamB : [];
                if (ev2.matches[row].pinBy && (!winningPool.length || !winningPool.includes(ev2.matches[row].pinBy))) {
                    ev2.matches[row].pinBy = "";
                }
            } else {
                if (!ev2.matches[row].participants.includes(ev2.matches[row].result)) {
                    ev2.matches[row].result = "";
                }
                if (!ev2.matches[row].participants.includes(ev2.matches[row].pinBy)) {
                    ev2.matches[row].pinBy = "";
                }
                ev2.matches[row].participantTeams = {};
            }
            upsertEvent(ev2); // debounced via saveSoon
            renderPlanner();
            return;
        } else if (field === "participantTeam") {
            const slot = Number(target.dataset.slot);
            const participantInputs = $$('[data-field="participant"]', tr);
            const participantId = participantInputs[slot]?.value || "";
            const teams = normalizedParticipantTeams(ev2.matches[row]);
            if (participantId && (target.value === "A" || target.value === "B")) {
                teams[participantId] = target.value;
            } else if (participantId) {
                delete teams[participantId];
            }
            ev2.matches[row].participantTeams = teams;
            const teamGroups = inferMatchTeams(ev2.matches[row].matchType, ev2.matches[row].participants || [], teams);
            const teamA = teamGroups?.[0] || [];
            const teamB = teamGroups?.[1] || [];
            if (ev2.matches[row].result === "TEAM:A" && !teamA.length) ev2.matches[row].result = "";
            if (ev2.matches[row].result === "TEAM:B" && !teamB.length) ev2.matches[row].result = "";
            const winningPool = ev2.matches[row].result === "TEAM:A" ? teamA : ev2.matches[row].result === "TEAM:B" ? teamB : [];
            if (ev2.matches[row].pinBy && (!winningPool.length || !winningPool.includes(ev2.matches[row].pinBy))) {
                ev2.matches[row].pinBy = "";
            }
            upsertEvent(ev2); // debounced via saveSoon
            renderPlanner();
            return;
        } else if (field === "num") {
            ev2.matches[row].num = Number(target.value) || (row + 1);
        } else if (field === "result") {
            ev2.matches[row].result = target.value;
            const isTeamBased = isTeamOrHandicapMatch(ev2.matches[row].matchType, (ev2.matches[row].participants || []).length);
            if (isTeamBased) {
                const teams = inferMatchTeams(ev2.matches[row].matchType, ev2.matches[row].participants || [], normalizedParticipantTeams(ev2.matches[row]));
                const teamA = teams?.[0] || [];
                const teamB = teams?.[1] || [];
                const winningPool = ev2.matches[row].result === "TEAM:A" ? teamA : ev2.matches[row].result === "TEAM:B" ? teamB : [];
                if (ev2.matches[row].pinBy && (!winningPool.length || !winningPool.includes(ev2.matches[row].pinBy))) {
                    ev2.matches[row].pinBy = "";
                }
            } else if (!ev2.matches[row].participants.includes(ev2.matches[row].pinBy)) {
                ev2.matches[row].pinBy = "";
            }
            upsertEvent(ev2); // debounced via saveSoon
            renderPlanner();
            return;
        } else if (field === "pinBy") {
            ev2.matches[row].pinBy = target.value;
        } else {
            ev2.matches[row][field] = target.value;
            if (field === "matchType") {
                const isTeamBased = isTeamOrHandicapMatch(ev2.matches[row].matchType, (ev2.matches[row].participants || []).length);
                if (!isTeamBased) {
                    ev2.matches[row].participantTeams = {};
                    if (ev2.matches[row].result && String(ev2.matches[row].result).startsWith("TEAM:")) {
                        ev2.matches[row].result = "";
                    }
                    if (ev2.matches[row].pinBy && !ev2.matches[row].participants.includes(ev2.matches[row].pinBy)) {
                        ev2.matches[row].pinBy = "";
                    }
                } else if (ev2.matches[row].result && !String(ev2.matches[row].result).startsWith("TEAM:")) {
                    const normalizedResult = normalizeNameForCompare(ev2.matches[row].result);
                    const isSpecial = normalizedResult === "dq"
                        || normalizedResult.includes("disqualification")
                        || normalizedResult === "draw"
                        || normalizedResult === "tie"
                        || normalizedResult === "no contest"
                        || normalizedResult === "nc"
                        || normalizedResult === "no result";
                    if (!isSpecial) ev2.matches[row].result = "";
                }
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
        participantTeams: {},
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
                    participantTeams: {},
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
            num: i + 1, participants: [], participantTeams: {}, participantSlots: MIN_PARTICIPANT_SLOTS, matchType: "", storyline: "", championshipId: "", result: "", pinBy: "", rivalryNotes: ""
        }))
    });

    saveSoon();
}

// -------------------- SELECT POPULATION --------------------
function populateShowSelects() {
    // roster form show select
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

$("#addSS").addEventListener("click", () => {
    const name = $("#ssName").value.trim();
    const photo = $("#ssPhoto").value.trim();
    const showIds = Array.from(addSuperstarShowIds);
    const division = $("#ssDivision").value;
    if (!name) return;

    state.superstars.push(enrichSuperstar({ id: uid("ss"), name, photo, showIds, showId: showIds[0] ?? null, division }));
    saveSoon();
    $("#ssName").value = "";
    $("#ssPhoto").value = "";
    addSuperstarShowIds = new Set();
    populateShowSelects();
    renderRoster();
});

$("#rosterSearch").addEventListener("input", () => renderRoster());

$("#calPrev").addEventListener("click", () => { calCursor.setMonth(calCursor.getMonth() - 1); renderCalendar(); });
$("#calNext").addEventListener("click", () => { calCursor.setMonth(calCursor.getMonth() + 1); renderCalendar(); });
$("#calToday").addEventListener("click", () => { calCursor = new Date(); calCursor.setDate(1); calSelectedISO = todayISO(); renderCalendar(); });

$("#addEventBtn").addEventListener("click", () => addEventFlow(calSelectedISO));

$("#addMatchRow").addEventListener("click", addMatchRow);
$("#plannerNewEvent").addEventListener("click", newEventFromPlanner);

$("#quickAddEvent")?.addEventListener("click", () => addEventFlow(todayISO()));
$("#quickOpenToday")?.addEventListener("click", () => {
    const iso = todayISO();
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
    a.download = `universe-booker-export-${todayISO()}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

$("#settingsExportBtn").addEventListener("click", exportUniverseJSON);

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
