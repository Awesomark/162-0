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

const state = {
  teamSkips: 1,
  eraSkips: 1,
  currentTeam: null,
  currentEra: null,
  roster: Array(slots.length).fill(null),
  rolled: false,
  searchQuery: "",
  selectedPlayerID: null,
  loaded: false,
  dragFromIndex: null,
};

let teams = [];
let players = [];
let eras = [];

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
  teamMark: document.querySelector("#teamMark"),
  teamName: document.querySelector("#teamName"),
  eraName: document.querySelector("#eraName"),
  playerSearch: document.querySelector("#playerSearch"),
  choices: document.querySelector("#choices"),
  resultPanel: document.querySelector("#resultPanel"),
  resultTitle: document.querySelector("#resultTitle"),
  resultCopy: document.querySelector("#resultCopy"),
  newGameButton: document.querySelector("#newGameButton"),
};

function sample(list) {
  return list[Math.floor(Math.random() * list.length)];
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
      p.team === state.currentTeam.id &&
      p.era === state.currentEra.id &&
      !draftedPlayerIds.has(p.playerID) &&
      hasOpenPosition(p),
  );
}

function getEraTeamIdentity() {
  if (!state.currentTeam || !state.currentEra) return null;
  const counts = new Map();
  for (const entry of players) {
    if (entry.team !== state.currentTeam.id || entry.era !== state.currentEra.id) continue;
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

function getSeasonChoices() {
  if (!state.selectedPlayerID) return [];
  return getAvailablePlayers()
    .filter((entry) => entry.playerID === state.selectedPlayerID)
    .sort((a, b) => b.year - a.year || b.bat + b.pitch - (a.bat + a.pitch));
}

function rollSlot(keepTeam = false, keepEra = false) {
  const draftedPlayerIds = new Set(state.roster.filter(Boolean).map((p) => p.playerID));
  for (let tries = 0; tries < 500; tries += 1) {
    const nextTeam = keepTeam && state.currentTeam ? state.currentTeam : sample(teams);
    const nextEra = keepEra && state.currentEra ? state.currentEra : sample(eras);
    const hasPlayers = players.some(
      (p) =>
        p.team === nextTeam.id &&
        p.era === nextEra.id &&
        !draftedPlayerIds.has(p.playerID) &&
        hasOpenPosition(p),
    );
    if (hasPlayers) {
      state.currentTeam = nextTeam;
      state.currentEra = nextEra;
      break;
    }
  }
  state.searchQuery = "";
  state.selectedPlayerID = null;
  state.rolled = true;
  render();
  el.playerSearch.focus();
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
  if (filledCount() >= slots.length) finishSeason();
  render();
}

function totals() {
  const starter = state.roster[0];
  const reliever = state.roster[1];
  const hitters = state.roster.slice(2).filter(Boolean);
  const fielders = state.roster.filter((player, index) => player && !["SP", "RP", "DH"].includes(slots[index].id));
  const average = (list, key, fallback = 62) => {
    if (list.length === 0) return fallback;
    return list.reduce((total, player) => total + player[key], 0) / list.length;
  };
  const starterPitch = starter ? starter.pitch : 62;
  const relieverPitch = reliever ? reliever.pitch : 62;
  return {
    bat: average(hitters, "bat"),
    pitch: starterPitch * 0.72 + relieverPitch * 0.28,
    speed: average(hitters, "speed"),
    field: average(fielders, "field"),
  };
}

function projectWins() {
  if (filledCount() === 0) return null;
  const t = totals();
  const balancePenalty =
    Math.max(0, 84 - Math.min(t.bat, t.pitch)) * 0.25 +
    Math.max(0, 65 - t.field) * 0.04 +
    Math.max(0, 50 - t.speed) * 0.02;
  const base =
    t.bat * 0.52 +
    t.pitch * 0.39 +
    t.field * 0.06 +
    t.speed * 0.03 -
    balancePenalty;
  const curve = 50 + 112 * Math.pow(Math.max(0, base) / 100, 1.9);
  const roundBoost = filledCount() < slots.length ? filledCount() * 0.8 : 0;
  const perfectionBonus = filledCount() >= slots.length ? Math.max(0, base - 98) * 1.6 : 0;
  return Math.max(0, Math.min(162, Math.round(curve + roundBoost + perfectionBonus)));
}

function finishSeason() {
  const wins = projectWins();
  el.resultPanel.classList.remove("hidden");
  if (wins >= 162) {
    el.resultTitle.textContent = "162-0. Immortal.";
    el.resultCopy.textContent =
      "The model found no soft spot: bats, arms, defense, and speed all survived the curve.";
  } else if (wins >= 150) {
    el.resultTitle.textContent = `${wins}-win monster`;
    el.resultCopy.textContent =
      "This roster is a parade route with cleats. It still dropped a few chaos games because baseball is built to humble spreadsheets.";
  } else if (wins >= 120) {
    el.resultTitle.textContent = `${wins} wins`;
    el.resultCopy.textContent =
      "A legendary club, but the simulator found enough thin innings to keep perfection out of reach.";
  } else {
    el.resultTitle.textContent = `${wins} wins`;
    el.resultCopy.textContent =
      "Great names, uneven roster. The non-linear curve punishes missing pitching, defense, or table-setting.";
  }
}

function reset() {
  state.teamSkips = 1;
  state.eraSkips = 1;
  state.currentTeam = null;
  state.currentEra = null;
  state.roster = Array(slots.length).fill(null);
  state.rolled = false;
  state.searchQuery = "";
  state.selectedPlayerID = null;
  el.resultPanel.classList.add("hidden");
  render();
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
    el.choices.innerHTML = `<div class="roster-slot"><div class="slot-name">On deck</div><div class="player-meta">Roll, then type a player name.</div></div>`;
    return;
  }
  if (!state.searchQuery.trim()) {
    const count = getAvailablePlayers().length;
    el.choices.innerHTML = `<div class="roster-slot"><div class="slot-name">${count.toLocaleString()} seasons available</div><div class="player-meta">Start typing to search this team and era.</div></div>`;
    return;
  }
  if (!state.selectedPlayerID) {
    const players = getPlayerMatches();
    if (players.length === 0) {
      el.choices.innerHTML = `<div class="roster-slot"><div class="slot-name">No match</div><div class="player-meta">Try another name from this slot's eligible pool.</div></div>`;
      return;
    }
    el.choices.innerHTML = players
      .map(
        (player) => `
        <button class="player-button" type="button" data-player="${player.playerID}">
          <span>
            <strong>${player.name}</strong>
            <span class="player-meta">${player.teamName} | ${player.positions.join(" / ")}</span>
          </span>
          <span class="stat-line">
            <span>${player.seasons} season${player.seasons === 1 ? "" : "s"}</span>
          </span>
        </button>
      `,
      )
      .join("");
    [...el.choices.querySelectorAll("[data-player]")].forEach((button) => {
      button.addEventListener("click", () => {
        state.selectedPlayerID = button.dataset.player;
        renderChoices();
      });
    });
    return;
  }

  const seasonChoices = getSeasonChoices();
  if (seasonChoices.length === 0) {
    el.choices.innerHTML = `<div class="roster-slot"><div class="slot-name">No match</div><div class="player-meta">Try another name from this slot's eligible pool.</div></div>`;
    return;
  }
  const selectedName = seasonChoices[0].name;
  el.choices.innerHTML = `
    <div class="season-header">
      <button class="back-button" type="button" id="backToPlayers">Back</button>
      <span>${selectedName}</span>
    </div>
    ${seasonChoices
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
          ${openSlotsFor(p)
            .map((slot) => `<button class="assign-button" type="button" data-choice="${index}" data-slot="${slot.id}">${slot.id}</button>`)
            .join("")}
        </span>
      </div>
    `,
    )
    .join("")}
  `;
  document.querySelector("#backToPlayers").addEventListener("click", () => {
    state.selectedPlayerID = null;
    renderChoices();
  });
  [...el.choices.querySelectorAll(".assign-button")].forEach((button) => {
    button.addEventListener("click", () => draft(seasonChoices[Number(button.dataset.choice)], button.dataset.slot));
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
  el.eraName.textContent = state.currentEra ? state.currentEra.label : "Any era";
  el.playerSearch.value = state.searchQuery;
  el.playerSearch.disabled = !state.loaded || !state.rolled || filled >= slots.length;
  el.playerSearch.placeholder = state.rolled ? "Search any eligible player" : "Type a player name";
  el.teamSkipButton.disabled = !state.loaded || state.teamSkips === 0 || !state.rolled || filled >= slots.length;
  el.eraSkipButton.disabled = !state.loaded || state.eraSkips === 0 || !state.rolled || filled >= slots.length;
  el.rollButton.disabled = !state.loaded || filled >= slots.length;
  renderRoster();
  renderChoices();
}

el.rollButton.addEventListener("click", () => rollSlot());
el.playerSearch.addEventListener("input", (event) => {
  state.searchQuery = event.target.value;
  state.selectedPlayerID = null;
  renderChoices();
});
el.teamSkipButton.addEventListener("click", () => {
  if (state.teamSkips > 0) {
    state.teamSkips -= 1;
    rollSlot(false, true);
  }
});
el.eraSkipButton.addEventListener("click", () => {
  if (state.eraSkips > 0) {
    state.eraSkips -= 1;
    rollSlot(true, false);
  }
});
el.newGameButton.addEventListener("click", reset);

async function init() {
  render();
  const response = await fetch("./data/players.json?v=30");
  const data = await response.json();
  teams = data.teams;
  eras = data.eras;
  players = data.players;
  state.loaded = true;
  render();
}

init().catch((error) => {
  console.error(error);
  el.choices.innerHTML = `<div class="roster-slot"><div class="slot-name">Stats failed to load</div><div class="player-meta">Check the local server and data file.</div></div>`;
});
