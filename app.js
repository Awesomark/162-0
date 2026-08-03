const slots = [
  { id: "SP", label: "Starting Pitcher" },
  { id: "RP", label: "Relief Pitcher" },
  { id: "C", label: "Catcher" },
  { id: "1B", label: "First Base" },
  { id: "2B", label: "Second Base" },
  { id: "3B", label: "Third Base" },
  { id: "SS", label: "Shortstop" },
  { id: "LF", label: "Left Field" },
  { id: "CF", label: "Center Field" },
  { id: "RF", label: "Right Field" },
  { id: "DH", label: "Designated Hitter" },
];

const eraRanges = [
  { id: "all", label: "All Eras", shortLabel: "All Time", minYear: null },
  { id: "live", label: "Live-Ball Era", shortLabel: "1920-Today", minYear: 1920 },
  { id: "expansion", label: "Expansion Era", shortLabel: "1960-Today", minYear: 1960 },
  { id: "current", label: "Current Era", shortLabel: "1990-Today", minYear: 1990 },
];

const minTeamEraSeasons = 5;

const perfectCutoffs = {
  impact: 101,
  pitch: 98,
  overall: 102,
};

const state = {
  teamSkips: 1,
  eraSkips: 1,
  eraRangeId: "all",
  currentTeam: null,
  currentEra: null,
  lastTeamId: null,
  lastEraId: null,
  roster: Array(slots.length).fill(null),
  rolled: false,
  searchQuery: "",
  selectedPlayerID: null,
  seasonSort: "opsPlus",
  positionFilter: "all",
  loaded: false,
  dragFromIndex: null,
};

let teams = [];
let players = [];
let eras = [];
let teamEraYearCounts = new Map();
let rollForwardTeamEras = new Map();

const el = {
  roundLabel: document.querySelector("#roundLabel"),
  skipLabel: document.querySelector("#skipLabel"),
  projectionStatus: document.querySelector("#projectionStatus"),
  projectionLabel: document.querySelector("#projectionLabel"),
  fieldProjection: document.querySelector("#fieldProjection"),
  recordBig: document.querySelector("#recordBig"),
  roster: document.querySelector("#roster"),
  rosterDetails: document.querySelector("#rosterDetails"),
  slotTitle: document.querySelector("#slotTitle"),
  teamSkipButton: document.querySelector("#teamSkipButton"),
  eraSkipButton: document.querySelector("#eraSkipButton"),
  rollButton: document.querySelector("#rollButton"),
  eraSetup: document.querySelector("#eraSetup"),
  teamMark: document.querySelector("#teamMark"),
  teamName: document.querySelector("#teamName"),
  eraName: document.querySelector("#eraName"),
  playerSearch: document.querySelector("#playerSearch"),
  choices: document.querySelector("#choices"),
  resultPanel: document.querySelector("#resultPanel"),
  resultTitle: document.querySelector("#resultTitle"),
  resultCopy: document.querySelector("#resultCopy"),
  resultScorecard: document.querySelector("#resultScorecard"),
  newGameButton: document.querySelector("#newGameButton"),
};

function sample(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function selectedEraRange() {
  return eraRanges.find((range) => range.id === state.eraRangeId) ?? eraRanges[0];
}

function eraStartYear(era) {
  if (era.id === "pre1900") return 0;
  return Number(era.id.slice(0, 4));
}

function isEraInSelectedRange(era) {
  const range = selectedEraRange();
  return range.minYear === null || eraStartYear(era) >= range.minYear;
}

function teamEraKey(teamId, eraId) {
  return `${teamId}|${eraId}`;
}

function buildTeamEraYearCounts() {
  const yearsByTeamEra = new Map();
  for (const player of players) {
    const key = teamEraKey(player.team, player.era);
    const years = yearsByTeamEra.get(key) ?? new Set();
    years.add(player.year);
    yearsByTeamEra.set(key, years);
  }
  teamEraYearCounts = new Map([...yearsByTeamEra].map(([key, years]) => [key, years.size]));
  rollForwardTeamEras = new Map();
  for (const [key, yearCount] of teamEraYearCounts) {
    if (yearCount >= minTeamEraSeasons) continue;
    const [teamId, eraId] = key.split("|");
    const eraIndex = eras.findIndex((era) => era.id === eraId);
    const nextEra = eras[eraIndex + 1];
    if (eraIndex === -1 || !nextEra) continue;
    rollForwardTeamEras.set(key, nextEra.id);
  }
}

function isAbsorbedTeamEra(teamId, eraId) {
  return rollForwardTeamEras.has(teamEraKey(teamId, eraId));
}

function isPlayerInRolledPool(player, teamId, eraId) {
  if (player.team !== teamId) return false;
  if (player.era === eraId) return true;
  return rollForwardTeamEras.get(teamEraKey(player.team, player.era)) === eraId;
}

function filledCount() {
  return state.roster.filter(Boolean).length;
}

function canPlayPosition(playerPick, slotId) {
  if (!playerPick) return false;
  if (slotId === "DH") return !playerPick.positions.includes("SP") && !playerPick.positions.includes("RP");
  if (playerPick.positions.includes(slotId)) return true;
  return ["LF", "CF", "RF"].includes(slotId) && playerPick.positions.includes("OF");
}

function openSlotsFor(playerPick) {
  return slots.filter(
    (slot, index) => !state.roster[index] && canPlayPosition(playerPick, slot.id),
  );
}

function hasOpenPosition(playerPick) {
  return openSlotsFor(playerPick).length > 0;
}

function canPlaySlot(playerPick, slotIndex) {
  return Boolean(playerPick && slots[slotIndex] && canPlayPosition(playerPick, slots[slotIndex].id));
}

function playerInitials(name) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 3)
    .toUpperCase();
}

function moveRosterPlayer(fromIndex, toIndex) {
  if (fromIndex === toIndex || !state.roster[fromIndex] || !canPlaySlot(state.roster[fromIndex], toIndex)) return false;
  const movingPlayer = state.roster[fromIndex];
  const targetPlayer = state.roster[toIndex];
  if (targetPlayer && !canPlaySlot(targetPlayer, fromIndex)) return false;
  state.roster[toIndex] = movingPlayer;
  state.roster[fromIndex] = targetPlayer || null;
  render();
  return true;
}

function getAvailablePlayers() {
  if (!state.currentTeam || !state.currentEra || filledCount() >= slots.length) return [];
  const draftedPlayerIds = new Set(state.roster.filter(Boolean).map((p) => p.playerID));
  return players.filter(
    (p) =>
      isPlayerInRolledPool(p, state.currentTeam.id, state.currentEra.id) &&
      !draftedPlayerIds.has(p.playerID) &&
      hasOpenPosition(p),
  );
}

function getEraTeamIdentity() {
  if (!state.currentTeam || !state.currentEra) return null;
  const counts = new Map();
  for (const entry of players) {
    if (!isPlayerInRolledPool(entry, state.currentTeam.id, state.currentEra.id)) continue;
    const key = `${entry.teamName}|${entry.teamMark}`;
    const current = counts.get(key) ?? { name: entry.teamName, mark: entry.teamMark, count: 0 };
    current.count += 1;
    counts.set(key, current);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count)[0] ?? state.currentTeam;
}

function getPlayerMatches() {
  const query = state.searchQuery.trim().toLowerCase();
  if (!query) return [];
  const byPlayer = new Map();
  for (const entry of getAvailablePlayers()) {
    if (!entry.name.toLowerCase().includes(query)) continue;
    const current = byPlayer.get(entry.playerID) ?? {
      playerID: entry.playerID,
      name: entry.name,
      teamName: entry.teamName,
      positions: new Set(),
      seasons: 0,
      bestYear: entry.year,
    };
    entry.positions.forEach((position) => current.positions.add(position));
    current.seasons += 1;
    current.bestYear = Math.max(current.bestYear, entry.year);
    byPlayer.set(entry.playerID, current);
  }
  return [...byPlayer.values()]
    .map((player) => ({ ...player, positions: [...player.positions] }))
    .sort((a, b) => {
      const queryText = state.searchQuery.trim().toLowerCase();
      const aExact = a.name.toLowerCase().startsWith(queryText) ? 0 : 1;
      const bExact = b.name.toLowerCase().startsWith(queryText) ? 0 : 1;
      return aExact - bExact || a.name.localeCompare(b.name);
    })
    .slice(0, 10);
}

const sortOptions = {
  year: { label: "Year", direction: "desc", value: (entry) => entry.year },
  ba: { label: "BA", direction: "desc", value: (entry) => statNumber(entry.stats, /([.\d]+)\s+BA/) },
  obp: { label: "OBP", direction: "desc", value: (entry) => statNumber(entry.stats, /([.\d]+)\s+OBP/) },
  slg: { label: "SLG", direction: "desc", value: (entry) => statNumber(entry.stats, /([.\d]+)\s+SLG/) },
  opsPlus: { label: "OPS+", direction: "desc", value: (entry) => entry.metrics?.opsPlus ?? null },
  ab: { label: "AB", direction: "desc", value: (entry) => entry.metrics?.atBats ?? statNumber(entry.stats, /(\d+)\s+AB/) },
  hr: { label: "HR", direction: "desc", value: (entry) => statNumber(entry.stats, /(\d+)\s+HR/) },
  rbi: { label: "RBI", direction: "desc", value: (entry) => statNumber(entry.stats, /(\d+)\s+RBI/) },
  runs: { label: "R", direction: "desc", value: (entry) => statNumber(entry.stats, /(\d+)\s+R,/) },
  sb: { label: "SB", direction: "desc", value: (entry) => statNumber(entry.stats, /(\d+)\s+SB/) },
  rdef: { label: "rDEF", direction: "desc", value: (entry) => statNumber(entry.stats, /([+-]?\d+(?:\.\d+)?)\s+rDEF/) },
  era: { label: "ERA", direction: "asc", value: (entry) => statNumber(entry.stats, /([\d.]+)\s+ERA/) },
  k: { label: "K", direction: "desc", value: (entry) => statNumber(entry.stats, /(\d+)\s+K,/) },
  whip: { label: "WHIP", direction: "asc", value: (entry) => statNumber(entry.stats, /([\d.]+)\s+WHIP/) },
  ip: { label: "IP", direction: "desc", value: (entry) => statNumber(entry.stats, /([\d.]+)\s+IP/) },
  kpct: { label: "K%", direction: "desc", value: (entry) => statNumber(entry.stats, /([\d.]+)\s+K%/) },
  bbpct: { label: "BB%", direction: "asc", value: (entry) => statNumber(entry.stats, /([\d.]+)\s+BB%/) },
};

function statNumber(stats, pattern) {
  const match = stats.match(pattern);
  if (!match) return null;
  return Number(match[1]);
}

function seasonSortOptions(seasons) {
  const hasPitching = seasons.some((entry) => entry.positions.some((position) => ["SP", "RP"].includes(position)));
  const hasHitting = seasons.some((entry) => entry.positions.some((position) => !["SP", "RP"].includes(position)));
  const keys = ["year"];
  if (hasHitting) keys.push("ba", "obp", "slg", "opsPlus", "ab", "hr", "rbi", "runs", "sb", "rdef");
  if (hasPitching) keys.push("era", "k", "whip", "ip", "kpct", "bbpct");
  return keys.map((key) => ({ key, ...sortOptions[key] }));
}

function defaultSortForPosition(positionId) {
  return ["SP", "RP"].includes(positionId) ? "era" : "opsPlus";
}

function positionFilterOptions() {
  return [
    { id: "all", label: "All" },
    ...slots
      .filter((slot, index) => !state.roster[index])
      .map((slot) => ({ id: slot.id, label: slot.id })),
  ];
}

function sortSeasons(choices) {
  const option = sortOptions[state.seasonSort] ?? sortOptions.year;
  return choices.sort((a, b) => {
    const aValue = option.value(a);
    const bValue = option.value(b);
    if (aValue === null && bValue !== null) return 1;
    if (bValue === null && aValue !== null) return -1;
    if (aValue === null && bValue === null) return b.year - a.year;
    const statOrder = option.direction === "asc" ? aValue - bValue : bValue - aValue;
    return statOrder || b.year - a.year || b.bat + b.pitch - (a.bat + a.pitch);
  });
}

function getSeasonChoices() {
  if (!state.selectedPlayerID) return [];
  return sortSeasons(getAvailablePlayers().filter((entry) => entry.playerID === state.selectedPlayerID));
}

function getTeamSeasonChoices() {
  const query = state.searchQuery.trim().toLowerCase();
  const choices = getAvailablePlayers().filter(
    (entry) =>
      (!query || entry.name.toLowerCase().includes(query)) &&
      (state.positionFilter === "all" || canPlayPosition(entry, state.positionFilter)),
  );
  return sortSeasons(choices);
}

function assignableSlotsFor(player) {
  const playerSlots = openSlotsFor(player);
  if (state.positionFilter === "all") return playerSlots;
  return playerSlots.filter((slot) => slot.id === state.positionFilter);
}

function getRollOptions(keepTeam = false, keepEra = false, avoidRepeat = true) {
  const draftedPlayerIds = new Set(state.roster.filter(Boolean).map((p) => p.playerID));
  const repeatTeamId = state.currentTeam?.id ?? state.lastTeamId;
  const repeatEraId = state.currentEra?.id ?? state.lastEraId;
  const rollEras = eras.filter(isEraInSelectedRange);
  const options = [];
  for (const nextTeam of teams) {
    if (keepTeam && state.currentTeam && nextTeam.id !== state.currentTeam.id) continue;
    if (!keepTeam && avoidRepeat && repeatTeamId && nextTeam.id === repeatTeamId) continue;
    for (const nextEra of rollEras) {
      if (keepEra && state.currentEra && nextEra.id !== state.currentEra.id) continue;
      if (!keepEra && avoidRepeat && repeatEraId && nextEra.id === repeatEraId) continue;
      if (isAbsorbedTeamEra(nextTeam.id, nextEra.id)) continue;

      const hasPlayers = players.some(
        (p) =>
          isPlayerInRolledPool(p, nextTeam.id, nextEra.id) &&
          !draftedPlayerIds.has(p.playerID) &&
          hasOpenPosition(p),
      );
      if (hasPlayers) options.push({ team: nextTeam, era: nextEra });
    }
  }
  return options;
}

function rollSlot(keepTeam = false, keepEra = false) {
  const options = getRollOptions(keepTeam, keepEra, true);
  const fallbackOptions = options.length > 0 ? options : getRollOptions(keepTeam, keepEra, false);
  const next = sample(fallbackOptions);
  if (!next) return false;
  state.currentTeam = next.team;
  state.currentEra = next.era;
  state.lastTeamId = next.team.id;
  state.lastEraId = next.era.id;
  state.searchQuery = "";
  state.selectedPlayerID = null;
  state.seasonSort = "opsPlus";
  state.positionFilter = "all";
  state.rolled = true;
  render();
  el.playerSearch.focus();
  return true;
}

function draft(playerPick, slotId) {
  const slotIndex = slots.findIndex((slot) => slot.id === slotId);
  if (slotIndex === -1 || state.roster[slotIndex] || !canPlayPosition(playerPick, slotId)) return;
  state.roster[slotIndex] = { ...playerPick, slot: slots[slotIndex].label };
  state.currentTeam = null;
  state.currentEra = null;
  state.rolled = false;
  state.searchQuery = "";
  state.selectedPlayerID = null;
  state.seasonSort = "opsPlus";
  state.positionFilter = "all";
  if (filledCount() >= slots.length) finishSeason();
  render();
}

function totals() {
  const starter = state.roster[0];
  const reliever = state.roster[1];
  const hitters = state.roster
    .slice(2)
    .map((player, index) => {
      if (!player) return null;
      const slotId = slots[index + 2].id;
      const speedBonus = Math.max(0, player.speed - 60) * 0.2;
      const fieldBonus = slotId === "DH" ? 0 : Math.max(0, player.field - 80) * 0.4;
      return {
        ...player,
        impact: player.bat + speedBonus + fieldBonus,
      };
    })
    .filter(Boolean);
  const fielders = state.roster.filter((player, index) => player && !["SP", "RP", "DH"].includes(slots[index].id));
  const average = (list, key, fallback = 62) => {
    if (list.length === 0) return fallback;
    return list.reduce((total, player) => total + player[key], 0) / list.length;
  };
  const starterPitch = starter ? starter.pitch : 62;
  const relieverPitch = reliever ? reliever.pitch : 62;
  return {
    bat: average(hitters, "bat"),
    impact: average(hitters, "impact"),
    pitch: starterPitch * 0.72 + relieverPitch * 0.28,
    speed: average(hitters, "speed"),
    field: average(fielders, "field"),
  };
}

function projectWins() {
  if (filledCount() === 0) return null;
  const t = totals();
  const balancePenalty = Math.max(0, 84 - Math.min(t.impact, t.pitch)) * 0.25;
  const base = t.impact * 0.61 + t.pitch * 0.39 - balancePenalty;
  const perfectSeason =
    filledCount() >= slots.length &&
    t.impact >= perfectCutoffs.impact &&
    t.pitch >= perfectCutoffs.pitch &&
    base >= perfectCutoffs.overall;
  if (perfectSeason) return 162;
  const curve = 50 + 112 * Math.pow(Math.max(0, base) / 100, 1.9);
  const roundBoost = filledCount() < slots.length ? filledCount() * 0.8 : 0;
  const perfectionBonus = filledCount() >= slots.length ? Math.max(0, base - 98) * 1.6 : 0;
  return Math.max(0, Math.min(161, Math.round(curve + roundBoost + perfectionBonus)));
}

function formatScore(score) {
  return Math.round(score * 10) / 10;
}

function stolenBases(player) {
  const match = player?.stats?.match(/,\s*(\d+)\s+SB,/);
  return match ? Number(match[1]) : 0;
}

function hitterRoster() {
  return state.roster.filter((player, index) => player && !["SP", "RP"].includes(slots[index].id));
}

function teamStolenBases() {
  return hitterRoster().reduce((total, player) => total + stolenBases(player), 0);
}

function scorecardSpeedScore() {
  const hitters = hitterRoster();
  if (hitters.length === 0) return 62;
  const averageSpeed = hitters.reduce((total, player) => total + player.speed, 0) / hitters.length;
  const stealVolume = Math.min(105, 60 + teamStolenBases() * 0.22);
  return averageSpeed * 0.3 + stealVolume * 0.7;
}

function scorePercent(score) {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function scoreGrade(score) {
  if (score >= 97) return "A+";
  if (score >= 94) return "A";
  if (score >= 90) return "A-";
  if (score >= 86) return "B+";
  if (score >= 82) return "B";
  if (score >= 78) return "B-";
  if (score >= 74) return "C+";
  if (score >= 70) return "C";
  return "C-";
}

function teamBaseScore(t) {
  const balancePenalty = Math.max(0, 84 - Math.min(t.impact, t.pitch)) * 0.25;
  return t.impact * 0.61 + t.pitch * 0.39 - balancePenalty;
}

function rosterWeakSpots() {
  return state.roster
    .map((player, index) => {
      if (!player) return null;
      const slot = slots[index];
      if (slot.id === "SP" || slot.id === "RP") {
        return { name: player.name, slot: slot.id, score: player.pitch, type: "pitching" };
      }
      const speedBonus = Math.max(0, player.speed - 60) * 0.2;
      const fieldBonus = slot.id === "DH" ? 0 : Math.max(0, player.field - 80) * 0.4;
      return {
        name: player.name,
        slot: slot.id,
        score: player.bat + speedBonus + fieldBonus,
        type: "lineup",
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.score - b.score)
    .slice(0, 2);
}

function teamEvaluation(wins) {
  const t = totals();
  const base = teamBaseScore(t);
  const speedScore = scorecardSpeedScore();
  if (wins >= 162) {
    return "No real holes. The offense and pitching both cleared the perfect-season line, with enough defense and speed to keep the floor high.";
  }

  const issues = [];
  if (t.impact < perfectCutoffs.impact) {
    issues.push("lineup was not quite 162-level");
  }
  if (t.pitch < perfectCutoffs.pitch) {
    issues.push("pitching left a few losses on the board");
  }
  if (base < perfectCutoffs.overall) {
    issues.push("overall balance missed the perfection cutoff");
  }
  if (t.field < 82) {
    issues.push("defense was ordinary");
  }
  if (speedScore < 72) {
    issues.push("speed did not add much extra pressure");
  }

  const weakSpots = rosterWeakSpots()
    .filter((spot) => spot.score < 92)
    .map((spot) => `${spot.slot}: ${spot.name}`);
  if (weakSpots.length > 0) {
    issues.push(`lowest spots were ${weakSpots.join(" and ")}`);
  }

  return `Needs work: ${issues.slice(0, 3).join("; ")}.`;
}

function scorecardRows(wins) {
  const t = totals();
  const base = teamBaseScore(t);
  const sb = teamStolenBases();
  return [
    { label: "Offense", value: t.bat, note: "raw hitting" },
    { label: "Lineup", value: t.impact, note: "hitting plus bonuses" },
    { label: "Pitching", value: t.pitch, note: "SP/RP staff" },
    { label: "Defense", value: t.field, note: "non-pitchers" },
    { label: "Speed", value: scorecardSpeedScore(), note: `${sb} team SB` },
    { label: "Overall", value: base, note: wins >= 162 ? "perfect-season clear" : `perfect cutoff: ${perfectCutoffs.overall}` },
  ];
}

function renderScorecard(wins) {
  el.resultScorecard.innerHTML = scorecardRows(wins)
    .map((row) => {
      const value = formatScore(row.value);
      const percent = scorePercent(row.value);
      return `
        <div class="scorecard-row">
          <div class="scorecard-topline">
            <span>${row.label}</span>
            <strong>${scoreGrade(row.value)}</strong>
          </div>
          <div class="scorebar" aria-label="${row.label} score ${value}">
            <span style="width: ${percent}%"></span>
          </div>
          <div class="scorecard-meta">
            <span>${row.note}</span>
            <span>${value}</span>
          </div>
        </div>
      `;
    })
    .join("");
}

function seasonHeaderHtml(label, positionOptions, activeSortOptions) {
  return `
    <div class="season-header">
      <span>${label}</span>
      <label class="sort-control" for="positionFilter">
        <span>Position</span>
        <select id="positionFilter">
          ${positionOptions
            .map((option) => `<option value="${option.id}" ${option.id === state.positionFilter ? "selected" : ""}>${option.label}</option>`)
            .join("")}
        </select>
      </label>
      <label class="sort-control" for="seasonSort">
        <span>Sort</span>
        <select id="seasonSort">
          ${activeSortOptions
            .map((option) => `<option value="${option.key}" ${option.key === state.seasonSort ? "selected" : ""}>${option.label}</option>`)
            .join("")}
        </select>
      </label>
    </div>
  `;
}

function bindSeasonControls() {
  document.querySelector("#seasonSort")?.addEventListener("change", (event) => {
    state.seasonSort = event.target.value;
    renderChoices();
  });
  document.querySelector("#positionFilter")?.addEventListener("change", (event) => {
    state.positionFilter = event.target.value;
    state.seasonSort = defaultSortForPosition(state.positionFilter);
    renderChoices();
  });
}

function finishSeason() {
  const wins = projectWins();
  el.resultPanel.classList.remove("hidden");
  if (wins >= 162) {
    el.resultTitle.textContent = "162-0. Immortal.";
  } else if (wins >= 150) {
    el.resultTitle.textContent = `${wins}-win monster`;
  } else if (wins >= 120) {
    el.resultTitle.textContent = `${wins} wins`;
  } else {
    el.resultTitle.textContent = `${wins} wins`;
  }
  renderScorecard(wins);
  el.resultCopy.textContent = teamEvaluation(wins);
}

function reset() {
  state.teamSkips = 1;
  state.eraSkips = 1;
  state.eraRangeId = "all";
  state.currentTeam = null;
  state.currentEra = null;
  state.lastTeamId = null;
  state.lastEraId = null;
  state.roster = Array(slots.length).fill(null);
  state.rolled = false;
  state.searchQuery = "";
  state.selectedPlayerID = null;
  state.seasonSort = "opsPlus";
  state.positionFilter = "all";
  el.resultPanel.classList.add("hidden");
  render();
}

function renderEraSetup() {
  const locked = state.rolled || filledCount() > 0;
  el.eraSetup.innerHTML = `
    <div>
      <span>Era Pool</span>
      <strong>${selectedEraRange().shortLabel}</strong>
    </div>
    <div class="era-options">
      ${eraRanges
        .map(
          (range) => `
        <button
          class="era-option${range.id === state.eraRangeId ? " active" : ""}"
          type="button"
          data-era-range="${range.id}"
          ${locked ? "disabled" : ""}
        >
          <span>${range.label}</span>
          <small>${range.shortLabel}</small>
        </button>
      `,
        )
        .join("")}
    </div>
  `;
  [...el.eraSetup.querySelectorAll("[data-era-range]")].forEach((button) => {
    button.addEventListener("click", () => {
      if (locked) return;
      state.eraRangeId = button.dataset.eraRange;
      state.lastEraId = null;
      render();
    });
  });
}

function renderRoster() {
  el.roster.innerHTML = slots
    .map((slot, index) => {
      const p = state.roster[index];
      if (!p) {
        return `<div class="roster-slot" data-slot-index="${index}" data-position="${slot.id}" title="${slot.label}"><div class="slot-name">${slot.id}</div></div>`;
      }
      const fieldLabel = `${playerInitials(p.name)} ${p.teamMark}`;
      return `<div class="roster-slot filled" data-slot-index="${index}" data-position="${slot.id}" draggable="true" title="${slot.label}: ${p.name}, ${p.stats}"><div class="slot-name">${fieldLabel}</div></div>`;
    })
    .join("");
  el.rosterDetails.innerHTML = slots
    .map((slot, index) => {
      const p = state.roster[index];
      if (!p) {
        return `<div class="detail-slot"><span>${slot.label}</span><strong>Open</strong></div>`;
      }
      return `<div class="detail-slot filled"><span>${slot.label} · ${p.teamMark}</span><strong>${p.name}</strong><small>${p.stats}</small><em>Can play: ${p.positions.join(" / ")}</em></div>`;
    })
    .join("");
  [...el.roster.querySelectorAll(".roster-slot")].forEach((slotElement) => {
    slotElement.addEventListener("dragstart", (event) => {
      const slotIndex = Number(slotElement.dataset.slotIndex);
      if (!state.roster[slotIndex]) {
        event.preventDefault();
        return;
      }
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", String(slotIndex));
      state.dragFromIndex = slotIndex;
      slotElement.classList.add("dragging");
    });
    slotElement.addEventListener("dragend", () => {
      state.dragFromIndex = null;
      slotElement.classList.remove("dragging");
      [...el.roster.querySelectorAll(".roster-slot")].forEach((candidate) => {
        candidate.classList.remove("drop-ok", "drop-no");
      });
    });
    slotElement.addEventListener("dragover", (event) => {
      const fromIndex = state.dragFromIndex;
      const toIndex = Number(slotElement.dataset.slotIndex);
      if (!Number.isInteger(fromIndex) || !state.roster[fromIndex]) return;
      event.preventDefault();
      const targetPlayer = state.roster[toIndex];
      const legal =
        canPlaySlot(state.roster[fromIndex], toIndex) &&
        (!targetPlayer || canPlaySlot(targetPlayer, fromIndex));
      event.dataTransfer.dropEffect = legal ? "move" : "none";
      slotElement.classList.toggle("drop-ok", legal);
      slotElement.classList.toggle("drop-no", !legal);
    });
    slotElement.addEventListener("dragleave", () => {
      slotElement.classList.remove("drop-ok", "drop-no");
    });
    slotElement.addEventListener("drop", (event) => {
      event.preventDefault();
      const fromIndex = Number.isInteger(state.dragFromIndex)
        ? state.dragFromIndex
        : Number(event.dataTransfer.getData("text/plain"));
      const toIndex = Number(slotElement.dataset.slotIndex);
      moveRosterPlayer(fromIndex, toIndex);
    });
  });
}

function renderChoices() {
  if (!state.loaded) {
    el.choices.innerHTML = `<div class="roster-slot"><div class="slot-name">Loading stats</div><div class="player-meta">Building the search pool.</div></div>`;
    return;
  }
  if (filledCount() >= slots.length) {
    el.choices.innerHTML = `<div class="roster-slot"><div class="slot-name">Final board</div><div class="player-meta">Start a new season to draft again.</div></div>`;
    return;
  }
  if (!state.rolled) {
    el.choices.innerHTML = `<div class="roster-slot"><div class="slot-name">On deck</div><div class="player-meta">Roll from the ${selectedEraRange().label.toLowerCase()} pool, then browse the best seasons or search by name.</div></div>`;
    return;
  }

  const activePositionOptions = positionFilterOptions();
  if (!activePositionOptions.some((option) => option.id === state.positionFilter)) {
    state.positionFilter = "all";
  }
  let seasonChoices = getTeamSeasonChoices();
  const activeSortOptions = seasonSortOptions(seasonChoices);
  if (!activeSortOptions.some((option) => option.key === state.seasonSort)) {
    state.seasonSort = defaultSortForPosition(state.positionFilter);
    seasonChoices = getTeamSeasonChoices();
  }
  if (seasonChoices.length === 0) {
    const fallbackSortOptions = seasonSortOptions(getAvailablePlayers());
    el.choices.innerHTML = `
      ${seasonHeaderHtml("No matching seasons", activePositionOptions, fallbackSortOptions)}
      <div class="roster-slot"><div class="slot-name">No match</div><div class="player-meta">Try another name or position from this team's eligible pool.</div></div>
    `;
    bindSeasonControls();
    return;
  }
  const visibleChoices = seasonChoices.slice(0, 60);
  const listLabel = state.searchQuery.trim()
    ? `${seasonChoices.length.toLocaleString()} matching season${seasonChoices.length === 1 ? "" : "s"}`
    : `Best ${Math.min(visibleChoices.length, seasonChoices.length).toLocaleString()} of ${seasonChoices.length.toLocaleString()} seasons`;
  el.choices.innerHTML = `
    ${seasonHeaderHtml(listLabel, activePositionOptions, activeSortOptions)}
    ${visibleChoices
    .map(
      (p, index) => `
      <div class="player-button" data-choice="${index}">
        <span>
          <strong>${p.name}</strong>
          <span class="player-meta">${p.year} ${p.teamName} | ${p.positions.join(" / ")}</span>
        </span>
        <span class="stat-line">
          <span>${p.stats.replace(`${p.year}: `, "")}</span>
        </span>
        <span class="assign-line">
          ${assignableSlotsFor(p)
            .map((slot) => `<button class="assign-button" type="button" data-choice="${index}" data-slot="${slot.id}">${slot.id}</button>`)
            .join("")}
        </span>
      </div>
    `,
    )
    .join("")}
  `;
  bindSeasonControls();
  [...el.choices.querySelectorAll(".assign-button")].forEach((button) => {
    button.addEventListener("click", () => draft(visibleChoices[Number(button.dataset.choice)], button.dataset.slot));
  });
}

function render() {
  const wins = projectWins();
  const filled = filledCount();
  const seasonComplete = filled >= slots.length;
  el.roundLabel.textContent = `${Math.min(filled + 1, slots.length)} / ${slots.length}`;
  el.skipLabel.textContent = `Team ${state.teamSkips} | Era ${state.eraSkips}`;
  el.projectionStatus.classList.toggle("hidden", !seasonComplete);
  el.fieldProjection.classList.toggle("hidden", !seasonComplete);
  if (seasonComplete) {
    el.projectionLabel.textContent = wins === 162 ? "162-0" : `${wins} wins`;
    el.recordBig.textContent = wins;
  }
  if (seasonComplete) {
    el.slotTitle.textContent = "Season complete";
  } else {
    el.slotTitle.textContent = state.rolled ? "Pick any player" : `Round ${filled + 1}: Any position`;
  }
  const teamIdentity = getEraTeamIdentity();
  el.teamMark.textContent = teamIdentity ? teamIdentity.mark : "162";
  el.teamName.textContent = teamIdentity ? teamIdentity.name : "Waiting on the machine";
  el.eraName.textContent = state.currentEra ? state.currentEra.label : selectedEraRange().shortLabel;
  el.playerSearch.value = state.searchQuery;
  el.playerSearch.disabled = !state.loaded || !state.rolled || filled >= slots.length;
  el.playerSearch.placeholder = state.rolled ? "Filter by player name" : "Type a player name";
  el.teamSkipButton.disabled = !state.loaded || state.teamSkips === 0 || !state.rolled || filled >= slots.length;
  el.eraSkipButton.disabled = !state.loaded || state.eraSkips === 0 || !state.rolled || filled >= slots.length;
  el.rollButton.disabled = !state.loaded || state.rolled || filled >= slots.length;
  renderEraSetup();
  renderRoster();
  renderChoices();
}

el.rollButton.addEventListener("click", () => {
  if (!state.rolled) rollSlot();
});
el.playerSearch.addEventListener("input", (event) => {
  state.searchQuery = event.target.value;
  state.selectedPlayerID = null;
  renderChoices();
});
el.teamSkipButton.addEventListener("click", () => {
  if (state.teamSkips > 0 && rollSlot(false, true)) {
    state.teamSkips -= 1;
    render();
  }
});
el.eraSkipButton.addEventListener("click", () => {
  if (state.eraSkips > 0 && rollSlot(true, false)) {
    state.eraSkips -= 1;
    render();
  }
});
el.newGameButton.addEventListener("click", reset);

async function init() {
  render();
  const response = await fetch("./data/players.json?v=52");
  const data = await response.json();
  teams = data.teams;
  eras = data.eras;
  players = data.players;
  buildTeamEraYearCounts();
  state.loaded = true;
  render();
}

init().catch((error) => {
  console.error(error);
  el.choices.innerHTML = `<div class="roster-slot"><div class="slot-name">Stats failed to load</div><div class="player-meta">Check the local server and data file.</div></div>`;
});
