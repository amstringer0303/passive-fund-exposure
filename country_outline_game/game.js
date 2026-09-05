const countries = window.COUNTRY_OUTLINES || [];

const canvas = document.getElementById("outlineCanvas");
const canvasWrap = canvas.parentElement;
const ctx = canvas.getContext("2d");
const form = document.getElementById("guessForm");
const input = document.getElementById("guessInput");
const feedback = document.getElementById("feedback");
const history = document.getElementById("history");
const scoreLabel = document.getElementById("score");
const guessCountLabel = document.getElementById("guessCount");
const hintButton = document.getElementById("hintButton");
const hintText = document.getElementById("hintText");
const skipButton = document.getElementById("skipButton");
const nextButton = document.getElementById("nextButton");
const soundToggle = document.getElementById("soundToggle");
const playerNameInput = document.getElementById("playerNameInput");
const roomCodeInput = document.getElementById("roomCodeInput");
const createRoomButton = document.getElementById("createRoomButton");
const joinRoomButton = document.getElementById("joinRoomButton");
const copyRoomLinkButton = document.getElementById("copyRoomLinkButton");
const leaveRoomButton = document.getElementById("leaveRoomButton");
const multiplayerStatus = document.getElementById("multiplayerStatus");
const playersList = document.getElementById("playersList");
const friendsTabButton = document.getElementById("friendsTabButton");
const multiplayerPanel = document.getElementById("multiplayerPanel");

const maxGuesses = 5;
const maxHints = 3;
const minWorldZoom = 1;
const maxWorldZoom = 18;
const initialWorldZoom = 1.85;
let current = null;
let guessesLeft = maxGuesses;
let roundOver = false;
let guessedNames = new Set();
let recentNames = [];
let score = 0;
let rounds = 0;
let hintLevel = 0;
let worldZoom = minWorldZoom;
let pendingDrawFrame = 0;
let roomStateRetryTimer = 0;
let roomStateRetryAttempts = 0;
let canvasStatusMessage = "";
let soundEnabled = true;
let audioContext = null;
const localGeometryCache = new WeakMap();
const nearbyHintCache = new WeakMap();
const samplePointCache = new WeakMap();

const aliasMap = new Map();
const countryByName = new Map();
for (const country of countries) {
  countryByName.set(country.name, country);
  for (const alias of country.aliases || []) {
    if (!aliasMap.has(alias)) aliasMap.set(alias, country);
  }
}

const queryParams = new URLSearchParams(window.location.search);
const forcedCountry = aliasMap.get(normalizeName(queryParams.get("country") || ""));
const forcedHintLevel = Math.max(0, Math.min(maxHints, Number.parseInt(queryParams.get("hint") || "0", 10) || 0));
const parsedWorldZoom = Number.parseFloat(queryParams.get("zoom") || "");
const forcedWorldZoom = Number.isFinite(parsedWorldZoom)
  ? Math.max(minWorldZoom, Math.min(maxWorldZoom, parsedWorldZoom))
  : null;
const requestedRoom = normalizeRoomCode(queryParams.get("room") || "");
const supabaseConfig = window.MAP_MEADOW_SUPABASE || {};
const hasSupabaseClient = Boolean(window.supabase && window.supabase.createClient);
const hasSupabaseConfig = Boolean(supabaseConfig.url && supabaseConfig.anonKey);
let realtimeClient = null;

const multiplayer = {
  channel: null,
  connected: false,
  connecting: false,
  roomCode: "",
  hostId: "",
  isHost: false,
  playerId: getStoredPlayerId(),
  playerName: getStoredPlayerName(),
  players: new Map(),
  roundId: "",
  roundStartedAt: 0,
  points: 0,
  guessesUsed: 0,
  solved: false,
  out: false,
  correctAt: null,
  seenEvents: new Set(),
};
let multiplayerPanelOpen = false;

function safeStorageGet(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return "";
  }
}

function safeStorageSet(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Local file/privacy modes can block storage; multiplayer still works.
  }
}

function randomToken(length = 5) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const values = new Uint8Array(length);
  if (window.crypto && window.crypto.getRandomValues) {
    window.crypto.getRandomValues(values);
  } else {
    for (let i = 0; i < values.length; i += 1) values[i] = Math.floor(Math.random() * 255);
  }
  return Array.from(values, (value) => alphabet[value % alphabet.length]).join("");
}

function getStoredPlayerId() {
  const existing = safeStorageGet("mapMeadowPlayerId");
  if (existing) return existing;
  const id = `player-${randomToken(10).toLowerCase()}`;
  safeStorageSet("mapMeadowPlayerId", id);
  return id;
}

function cleanPlayerName(value) {
  return (value || "").trim().replace(/\s+/g, " ").slice(0, 18) || `Player ${randomToken(3)}`;
}

function getStoredPlayerName() {
  const existing = safeStorageGet("mapMeadowPlayerName");
  const name = cleanPlayerName(existing || `Player ${randomToken(3)}`);
  safeStorageSet("mapMeadowPlayerName", name);
  return name;
}

function normalizeRoomCode(value) {
  return (value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
}

function makeRoomCode() {
  return randomToken(5);
}

function makeEventId() {
  return `${Date.now().toString(36)}-${randomToken(6).toLowerCase()}`;
}

function formatPoints(points) {
  return Math.round(points || 0).toLocaleString();
}

function updateSoundToggle() {
  if (!soundToggle) return;
  soundToggle.textContent = soundEnabled ? "Sound on" : "Sound off";
  soundToggle.setAttribute("aria-pressed", String(soundEnabled));
}

function getAudioContext() {
  if (!soundEnabled) return null;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;
  if (!audioContext) audioContext = new AudioContextClass();
  if (audioContext.state === "suspended") audioContext.resume();
  return audioContext;
}

function playSound(kind) {
  const audio = getAudioContext();
  if (!audio) return;

  const patterns = {
    tap: [
      [540, 0, 0.035, "square", 0.024],
      [760, 0.035, 0.035, "square", 0.018],
    ],
    correct: [
      [520, 0, 0.08, "triangle", 0.042],
      [660, 0.09, 0.08, "triangle", 0.042],
      [880, 0.18, 0.15, "sine", 0.05],
    ],
    wrong: [
      [260, 0, 0.08, "triangle", 0.035],
      [190, 0.09, 0.13, "sawtooth", 0.028],
    ],
    unknown: [
      [330, 0, 0.055, "square", 0.026],
      [280, 0.07, 0.09, "triangle", 0.024],
    ],
    hint: [
      [740, 0, 0.05, "triangle", 0.028],
      [980, 0.065, 0.08, "sine", 0.026],
    ],
    next: [
      [430, 0, 0.05, "square", 0.026],
      [610, 0.055, 0.08, "triangle", 0.03],
    ],
  };

  for (const [frequency, delay, duration, type, volume] of patterns[kind] || patterns.tap) {
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    const start = audio.currentTime + delay;
    const stop = start + duration;

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.linearRampToValueAtTime(volume, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, stop);

    oscillator.connect(gain);
    gain.connect(audio.destination);
    oscillator.start(start);
    oscillator.stop(stop + 0.02);
  }
}

function popBits(kind = "good") {
  const colors = kind === "good"
    ? ["#f0c57d", "#df8b72", "#7aa889", "#fffdf2"]
    : ["#9d5461", "#f0c57d", "#fffdf2"];

  for (let i = 0; i < 12; i += 1) {
    const bit = document.createElement("span");
    bit.className = "pop-bit";
    bit.style.setProperty("--pop-x", `${Math.random() * 240 - 120}px`);
    bit.style.setProperty("--pop-y", `${Math.random() * -120 - 24}px`);
    bit.style.setProperty("--pop-rotate", `${Math.random() * 180 - 90}deg`);
    bit.style.background = colors[i % colors.length];
    canvasWrap.appendChild(bit);
    setTimeout(() => bit.remove(), 760);
  }
}

function normalizeName(value) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\bthe\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function haversineKm(lon1, lat1, lon2, lat2) {
  const radiusKm = 6371.0088;
  const phi1 = lat1 * Math.PI / 180;
  const phi2 = lat2 * Math.PI / 180;
  const dphi = (lat2 - lat1) * Math.PI / 180;
  const dlambda = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dphi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dlambda / 2) ** 2;
  return 2 * radiusKm * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function countrySamplePoints(country) {
  const cached = samplePointCache.get(country);
  if (cached) return cached;

  const totalPoints = country.rings.reduce((total, ring) => total + ring.length, 0);
  const stride = Math.max(1, Math.ceil(totalPoints / 140));
  const points = [];

  for (const ring of country.rings) {
    for (let i = 0; i < ring.length; i += stride) {
      points.push(ring[i]);
    }
    if (ring.length && (ring.length - 1) % stride !== 0) {
      points.push(ring[ring.length - 1]);
    }
  }

  if (!points.length) points.push([country.lon, country.lat]);
  samplePointCache.set(country, points);
  return points;
}

function approximateBorderDistanceKm(country, candidate) {
  const points = countrySamplePoints(country);
  const candidatePoints = countrySamplePoints(candidate);
  let best = haversineKm(country.lon, country.lat, candidate.lon, candidate.lat);

  for (const [lon, lat] of points) {
    for (const [candidateLon, candidateLat] of candidatePoints) {
      const distance = haversineKm(lon, lat, candidateLon, candidateLat);
      if (distance < best) best = distance;
      if (best < 8) return best;
    }
  }

  return best;
}

function nearbyHintCountry(country) {
  if (nearbyHintCache.has(country)) return nearbyHintCache.get(country);

  const candidates = countries
    .filter((candidate) => candidate !== country)
    .map((candidate) => ({
      country: candidate,
      centroidDistance: haversineKm(country.lon, country.lat, candidate.lon, candidate.lat),
    }))
    .sort((a, b) => a.centroidDistance - b.centroidDistance)
    .slice(0, 32)
    .map((candidate) => ({
      ...candidate,
      borderDistance: approximateBorderDistanceKm(country, candidate.country),
    }))
    .sort((a, b) => (
      a.borderDistance - b.borderDistance ||
      a.centroidDistance - b.centroidDistance ||
      a.country.name.localeCompare(b.country.name)
    ));

  const nearby = candidates.length ? candidates[0].country : null;
  nearbyHintCache.set(country, nearby);
  return nearby;
}

function firstLetter(country) {
  return country.name.trim().charAt(0).toUpperCase();
}

function updateHintUi() {
  if (hintButton) {
    hintButton.textContent = hintLevel >= maxHints ? "Hints used" : `Hint ${hintLevel}/${maxHints}`;
    hintButton.disabled = !current || roundOver || hintLevel >= maxHints;
  }

  if (!hintText) return;
  if (!current || hintLevel === 0) {
    hintText.textContent = "";
  } else if (hintLevel === 1) {
    hintText.textContent = "Hint 1: a nearby country is outlined.";
  } else if (hintLevel === 2) {
    hintText.textContent = "Hint 2: world map mode. Scroll to zoom.";
  } else {
    hintText.textContent = `Hint 3: starts with ${firstLetter(current)}. Scroll the map.`;
  }
}

function setWorldZoom(value) {
  worldZoom = Math.max(minWorldZoom, Math.min(maxWorldZoom, value));
  scheduleDrawCurrentCountry();
}

function scheduleDrawCurrentCountry() {
  if (pendingDrawFrame) return;
  pendingDrawFrame = window.requestAnimationFrame(() => {
    pendingDrawFrame = 0;
    drawCurrentCountry();
  });
}

function isMultiplayerActive() {
  return Boolean(multiplayer.roomCode && multiplayer.connected);
}

function canUseSupabase() {
  return hasSupabaseClient && hasSupabaseConfig;
}

function setMultiplayerStatus(message, kind = "") {
  if (!multiplayerStatus) return;
  multiplayerStatus.textContent = message;
  multiplayerStatus.className = `multiplayer-status ${kind}`.trim();
}

function updateMultiplayerPanelVisibility() {
  if (multiplayerPanel) multiplayerPanel.hidden = !multiplayerPanelOpen;
  if (friendsTabButton) {
    friendsTabButton.setAttribute("aria-expanded", String(multiplayerPanelOpen));
    if (multiplayer.roomCode && multiplayer.connected) {
      friendsTabButton.textContent = `Friends ${multiplayer.roomCode}`;
    } else {
      friendsTabButton.textContent = "Friends";
    }
  }
}

function setMultiplayerPanelOpen(open) {
  multiplayerPanelOpen = Boolean(open);
  updateMultiplayerPanelVisibility();
}

function multiplayerShareUrl(roomCode = multiplayer.roomCode) {
  const url = new URL(window.location.href);
  url.searchParams.set("room", roomCode);
  url.searchParams.delete("country");
  url.searchParams.delete("hint");
  url.searchParams.delete("zoom");
  return url.toString();
}

function updateRoomUrl(roomCode) {
  if (!roomCode || !window.history || !window.history.replaceState) return;
  window.history.replaceState({}, "", multiplayerShareUrl(roomCode));
}

function updateMultiplayerUi() {
  updateMultiplayerPanelVisibility();
  const configured = canUseSupabase();
  if (playerNameInput && playerNameInput.value !== multiplayer.playerName) {
    playerNameInput.value = multiplayer.playerName;
  }
  if (roomCodeInput && multiplayer.roomCode && roomCodeInput.value !== multiplayer.roomCode) {
    roomCodeInput.value = multiplayer.roomCode;
  }
  if (createRoomButton) createRoomButton.disabled = !configured || multiplayer.connecting;
  if (joinRoomButton) joinRoomButton.disabled = !configured || multiplayer.connecting;
  if (copyRoomLinkButton) copyRoomLinkButton.disabled = !multiplayer.roomCode;
  if (leaveRoomButton) leaveRoomButton.disabled = !multiplayer.roomCode;
  if (nextButton && multiplayer.roomCode) nextButton.disabled = !multiplayer.isHost;
  if (!multiplayer.roomCode && nextButton) nextButton.disabled = false;

  if (!configured) {
    const missing = hasSupabaseClient ? "Add Supabase keys to supabase_config.js." : "Supabase library did not load.";
    setMultiplayerStatus(missing, "bad");
  } else if (!multiplayer.roomCode) {
    setMultiplayerStatus("Create a room or join a code.");
  } else if (multiplayer.connected) {
    setMultiplayerStatus(`${multiplayer.isHost ? "Hosting" : "Joined"} room ${multiplayer.roomCode}.`, "good");
  } else if (multiplayer.connecting) {
    setMultiplayerStatus(`Connecting to ${multiplayer.roomCode}...`);
  }

  updatePlayersList();
}

function ownPlayerState() {
  return {
    id: multiplayer.playerId,
    name: multiplayer.playerName,
    host: multiplayer.isHost,
    points: multiplayer.points,
    guesses: multiplayer.guessesUsed,
    solved: multiplayer.solved,
    out: multiplayer.out,
    correctAt: multiplayer.correctAt,
    roundId: multiplayer.roundId,
    onlineAt: Date.now(),
  };
}

function ensurePlayer(player) {
  if (!player || !player.id) return;
  const previous = multiplayer.players.get(player.id) || {};
  multiplayer.players.set(player.id, {
    ...previous,
    ...player,
    name: cleanPlayerName(player.name || previous.name),
    points: Number.isFinite(player.points) ? player.points : previous.points || 0,
    guesses: Number.isFinite(player.guesses) ? player.guesses : previous.guesses || 0,
    solved: Boolean(player.solved),
    out: Boolean(player.out),
  });
}

function trackPresence() {
  if (!multiplayer.channel || !multiplayer.connected) return;
  multiplayer.channel.track(ownPlayerState());
}

function syncPresence() {
  if (!multiplayer.channel) return;
  const state = multiplayer.channel.presenceState();
  const onlineIds = new Set();

  for (const [presenceKey, presences] of Object.entries(state)) {
    const latest = presences[presences.length - 1];
    if (!latest) continue;
    const id = latest.id || presenceKey;
    onlineIds.add(id);
    ensurePlayer({ ...latest, id, online: true });
  }

  ensurePlayer({ ...ownPlayerState(), online: true });
  for (const [id, player] of multiplayer.players.entries()) {
    if (!onlineIds.has(id) && id !== multiplayer.playerId) {
      multiplayer.players.set(id, { ...player, online: false });
    }
  }
  updatePlayersList();
  finishMultiplayerRoundIfDone();
  if (multiplayer.isHost && current) sendRoomState();
}

function sortedPlayers() {
  ensurePlayer({ ...ownPlayerState(), online: true });
  return Array.from(multiplayer.players.values()).sort((a, b) => {
    if (a.solved !== b.solved) return a.solved ? -1 : 1;
    if ((a.points || 0) !== (b.points || 0)) return (a.points || 0) - (b.points || 0);
    const aTime = a.correctAt || Number.POSITIVE_INFINITY;
    const bTime = b.correctAt || Number.POSITIVE_INFINITY;
    if (aTime !== bTime) return aTime - bTime;
    return (a.name || "").localeCompare(b.name || "");
  });
}

function updatePlayersList() {
  if (!playersList) return;
  playersList.innerHTML = "";
  if (!multiplayer.roomCode) return;

  for (const player of sortedPlayers()) {
    const item = document.createElement("li");
    const name = document.createElement("span");
    const points = document.createElement("span");
    const state = document.createElement("span");
    const tags = [];

    name.className = "player-name";
    points.className = "player-points";
    state.className = "player-state";

    if (player.id === multiplayer.playerId) tags.push("you");
    if (player.host) tags.push("host");
    if (player.online === false) tags.push("offline");

    name.textContent = tags.length ? `${player.name} (${tags.join(", ")})` : player.name;
    points.textContent = `${formatPoints(player.points)} pts`;
    if (player.solved) state.textContent = `solved in ${player.guesses || 1} guesses`;
    else if (player.out) state.textContent = "out of guesses";
    else state.textContent = `${player.guesses || 0}/${maxGuesses} guesses`;

    item.append(name, points, state);
    playersList.appendChild(item);
  }
}

function activeRoundPlayers() {
  ensurePlayer({ ...ownPlayerState(), online: true });
  return Array.from(multiplayer.players.values()).filter((player) => (
    player.online !== false &&
    (!player.roundId || !multiplayer.roundId || player.roundId === multiplayer.roundId)
  ));
}

function everyActivePlayerFinished() {
  const players = activeRoundPlayers();
  return players.length > 0 && players.every((player) => player.solved || player.out);
}

function finishMultiplayerRoundIfDone() {
  if (!isMultiplayerActive() || !current || roundOver || !everyActivePlayerFinished()) return false;
  roundOver = true;
  input.disabled = true;
  setFeedback(`Everyone is finished. Answer: ${current.name}.`, "bad");
  updateLabels();
  if (multiplayer.isHost) sendRoomState();
  return true;
}

function markEventSeen(payload) {
  if (!payload || !payload.eventId) return false;
  if (multiplayer.seenEvents.has(payload.eventId)) return true;
  multiplayer.seenEvents.add(payload.eventId);
  if (multiplayer.seenEvents.size > 300) multiplayer.seenEvents.clear();
  return false;
}

function sendRoomEvent(event, payload = {}) {
  if (!multiplayer.channel || !multiplayer.connected) return;
  multiplayer.channel.send({
    type: "broadcast",
    event,
    payload: {
      ...payload,
      eventId: payload.eventId || makeEventId(),
      roomCode: multiplayer.roomCode,
      playerId: multiplayer.playerId,
      playerName: multiplayer.playerName,
      sentAt: Date.now(),
    },
  });
}

function roomStatePayload(targetId = "") {
  return {
    targetId,
    hostId: multiplayer.hostId || multiplayer.playerId,
    roundId: multiplayer.roundId,
    countryName: current ? current.name : "",
    roundStartedAt: multiplayer.roundStartedAt,
    roundOver,
    players: sortedPlayers(),
  };
}

function sendRoomState(targetId = "") {
  sendRoomEvent("room-state", roomStatePayload(targetId));
}

function clearRoomStateRetry() {
  if (roomStateRetryTimer) {
    window.clearTimeout(roomStateRetryTimer);
    roomStateRetryTimer = 0;
  }
  roomStateRetryAttempts = 0;
}

function requestRoomStateUntilLoaded() {
  if (!isMultiplayerActive() || multiplayer.isHost || current) {
    clearRoomStateRetry();
    return;
  }

  roomStateRetryAttempts += 1;
  sendRoomEvent("request-state");

  if (roomStateRetryAttempts >= 10) {
    canvasStatusMessage = "Waiting for host...";
    setFeedback(`Joined room ${multiplayer.roomCode}. Waiting for host.`);
    resizeCanvas();
    clearRoomStateRetry();
    return;
  }

  const delay = roomStateRetryAttempts < 3 ? 700 : 1400;
  roomStateRetryTimer = window.setTimeout(requestRoomStateUntilLoaded, delay);
}

function startRoomStateRetry() {
  clearRoomStateRetry();
  requestRoomStateUntilLoaded();
}

function resetMultiplayerRoundStats() {
  guessesLeft = maxGuesses;
  roundOver = false;
  guessedNames = new Set();
  hintLevel = 0;
  worldZoom = minWorldZoom;
  multiplayer.guessesUsed = 0;
  multiplayer.solved = false;
  multiplayer.out = false;
  multiplayer.correctAt = null;
}

function showRoomLinkLoading(roomCode) {
  const code = normalizeRoomCode(roomCode);
  current = null;
  guessesLeft = maxGuesses;
  roundOver = false;
  guessedNames = new Set();
  hintLevel = 0;
  worldZoom = minWorldZoom;
  canvasStatusMessage = code ? `Joining room ${code}...` : "Joining room...";
  history.innerHTML = "";
  input.value = "";
  input.disabled = true;
  if (skipButton) skipButton.disabled = true;
  if (nextButton) nextButton.disabled = true;
  setFeedback(canvasStatusMessage);
  updateHintUi();
  resizeCanvas();
}

function loadMultiplayerRound(countryName, roundId, startedAt) {
  const country = countryByName.get(countryName);
  if (!country) return false;
  current = country;
  canvasStatusMessage = "";
  clearRoomStateRetry();
  multiplayer.roundId = roundId || makeEventId();
  multiplayer.roundStartedAt = startedAt || Date.now();
  resetMultiplayerRoundStats();
  history.innerHTML = "";
  input.value = "";
  input.disabled = false;
  if (skipButton) skipButton.disabled = false;
  if (nextButton) nextButton.disabled = false;
  setFeedback(`Room ${multiplayer.roomCode}. Lowest points wins.`);
  updateLabels();
  resizeCanvas();
  trackPresence();
  return true;
}

function startMultiplayerRound() {
  if (!isMultiplayerActive() || !multiplayer.isHost) return;
  const country = chooseCountry();
  const roundId = makeEventId();
  const startedAt = Date.now();
  if (!loadMultiplayerRound(country.name, roundId, startedAt)) return;

  for (const [id, player] of multiplayer.players.entries()) {
    multiplayer.players.set(id, {
      ...player,
      guesses: 0,
      solved: false,
      out: false,
      correctAt: null,
      roundId,
    });
  }
  ensurePlayer({ ...ownPlayerState(), online: true });
  sendRoomEvent("round-start", {
    countryName: country.name,
    roundId,
    roundStartedAt: startedAt,
    hostId: multiplayer.playerId,
  });
  sendRoomState();
  updatePlayersList();
}

function applyRoundStart(payload) {
  if (markEventSeen(payload)) return;
  if (payload.hostId) multiplayer.hostId = payload.hostId;
  if (payload.hostId && payload.playerId && payload.hostId !== payload.playerId) return;
  if (!payload.countryName) return;
  loadMultiplayerRound(payload.countryName, payload.roundId, payload.roundStartedAt);
}

function applyRoomState(payload) {
  if (markEventSeen(payload)) return;
  if (payload.targetId && payload.targetId !== multiplayer.playerId) return;
  if (payload.hostId) multiplayer.hostId = payload.hostId;
  if (Array.isArray(payload.players)) {
    for (const player of payload.players) ensurePlayer(player);
  }
  if (payload.countryName && payload.roundId && (!current || payload.roundId !== multiplayer.roundId)) {
    loadMultiplayerRound(payload.countryName, payload.roundId, payload.roundStartedAt);
  }
  if (payload.roundOver) {
    roundOver = true;
    input.disabled = true;
    if (current) setFeedback(`Round over. Answer: ${current.name}.`, "bad");
  }
  updateMultiplayerUi();
  updateLabels();
}

function applyPlayerUpdate(payload) {
  if (markEventSeen(payload)) return;
  ensurePlayer({
    id: payload.playerId,
    name: payload.playerName,
    host: payload.host,
    points: payload.points,
    guesses: payload.guesses,
    solved: payload.solved,
    out: payload.out,
    correctAt: payload.correctAt,
    roundId: payload.roundId,
    online: true,
  });
  updatePlayersList();
  finishMultiplayerRoundIfDone();
}

function applyGuessEvent(payload) {
  if (markEventSeen(payload)) return;
  if (!payload || payload.roundId !== multiplayer.roundId) return;

  ensurePlayer({
    id: payload.playerId,
    name: payload.playerName,
    host: payload.host,
    points: payload.points,
    guesses: payload.guesses,
    solved: payload.correct,
    out: payload.out,
    correctAt: payload.correctAt,
    roundId: payload.roundId,
    online: true,
  });

  if (payload.correct) {
    addHistory(`${payload.playerName}: correct`);
    roundOver = true;
    input.disabled = true;
    setFeedback(`${payload.playerName} found ${current.name}. ${formatPoints(payload.points)} points.`, "good");
    playSound("correct");
    popBits("good");
  } else {
    const distanceText = `${Math.round(payload.distance || 0).toLocaleString()} km`;
    addHistory(`${payload.playerName}: ${payload.guessName} was ${distanceText} away`);
    if (payload.out) addHistory(`${payload.playerName}: out of guesses`);
  }

  updateLabels();
  updatePlayersList();
  finishMultiplayerRoundIfDone();
}

function broadcastPlayerUpdate() {
  if (!isMultiplayerActive()) return;
  sendRoomEvent("player-update", {
    host: multiplayer.isHost,
    points: multiplayer.points,
    guesses: multiplayer.guessesUsed,
    solved: multiplayer.solved,
    out: multiplayer.out,
    correctAt: multiplayer.correctAt,
    roundId: multiplayer.roundId,
  });
  trackPresence();
}

function getRealtimeClient() {
  if (!canUseSupabase()) return null;
  if (!realtimeClient) {
    realtimeClient = window.supabase.createClient(supabaseConfig.url, supabaseConfig.anonKey, {
      auth: {
        persistSession: false,
      },
    });
  }
  return realtimeClient;
}

async function leaveRoom(resetUrl = true, startSingleRound = true, showSingleFeedback = true) {
  clearRoomStateRetry();
  if (multiplayer.channel && realtimeClient) {
    await multiplayer.channel.untrack();
    await realtimeClient.removeChannel(multiplayer.channel);
  }
  multiplayer.channel = null;
  multiplayer.connected = false;
  multiplayer.connecting = false;
  multiplayer.roomCode = "";
  multiplayer.hostId = "";
  multiplayer.isHost = false;
  multiplayer.players.clear();
  multiplayer.roundId = "";
  canvasStatusMessage = "";
  if (resetUrl && window.history && window.history.replaceState) {
    const url = new URL(window.location.href);
    url.searchParams.delete("room");
    window.history.replaceState({}, "", url.toString());
  }
  updateMultiplayerUi();
  if (startSingleRound && countries.length) {
    newRound();
  } else if (!roundOver && showSingleFeedback) {
    setFeedback("Single-player mode.");
  }
}

async function joinRoom(roomCode, asHost = false) {
  const code = normalizeRoomCode(roomCode);
  if (!code) {
    setMultiplayerStatus("Enter a room code.", "bad");
    return;
  }
  if (!canUseSupabase()) {
    updateMultiplayerUi();
    return;
  }

  await leaveRoom(false, false, false);
  multiplayer.roomCode = code;
  multiplayer.isHost = asHost;
  multiplayer.hostId = asHost ? multiplayer.playerId : "";
  multiplayer.connecting = true;
  multiplayer.players.clear();
  ensurePlayer({ ...ownPlayerState(), online: true });
  updateRoomUrl(code);
  canvasStatusMessage = `Joining room ${code}...`;
  resizeCanvas();
  updateMultiplayerUi();

  const client = getRealtimeClient();
  const channel = client.channel(`map-meadow:${code}`, {
    config: {
      private: false,
      broadcast: { self: false },
      presence: { key: multiplayer.playerId },
    },
  });
  multiplayer.channel = channel;

  channel
    .on("broadcast", { event: "room-state" }, ({ payload }) => applyRoomState(payload))
    .on("broadcast", { event: "round-start" }, ({ payload }) => applyRoundStart(payload))
    .on("broadcast", { event: "guess" }, ({ payload }) => applyGuessEvent(payload))
    .on("broadcast", { event: "player-update" }, ({ payload }) => applyPlayerUpdate(payload))
    .on("broadcast", { event: "request-state" }, ({ payload }) => {
      if (!multiplayer.isHost || markEventSeen(payload)) return;
      sendRoomState((payload && payload.playerId) || "");
    })
    .on("presence", { event: "sync" }, syncPresence)
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        multiplayer.connected = true;
        multiplayer.connecting = false;
        ensurePlayer({ ...ownPlayerState(), online: true });
        trackPresence();
        updateMultiplayerUi();
        if (asHost) startMultiplayerRound();
        else startRoomStateRetry();
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        multiplayer.connecting = false;
        multiplayer.connected = false;
        canvasStatusMessage = "Room connection failed.";
        resizeCanvas();
        setMultiplayerStatus("Room connection failed.", "bad");
        updateMultiplayerUi();
      }
    });
}

function submitMultiplayerGuess(rawGuess) {
  if (!current || !isMultiplayerActive()) return;
  if (roundOver) {
    setFeedback(`Round over. Answer: ${current.name}. Host can start the next one.`);
    return;
  }
  if (multiplayer.out || multiplayer.solved || guessesLeft <= 0) {
    const suffix = multiplayer.out ? ` Answer: ${current.name}.` : "";
    setFeedback(`You are out for this round.${suffix}`, "bad");
    playSound("unknown");
    return;
  }

  const normalized = normalizeName(rawGuess);
  if (!normalized) {
    setFeedback("Type a country name first.", "bad");
    playSound("unknown");
    return;
  }

  const guessed = aliasMap.get(normalized);
  if (!guessed) {
    const suggestions = suggestionsFor(rawGuess);
    const suffix = suggestions.length ? ` Did you mean ${suggestions.join(", ")}?` : "";
    setFeedback(`I do not recognize that country.${suffix}`, "bad");
    playSound("unknown");
    return;
  }

  if (guessedNames.has(guessed.name)) {
    setFeedback(`You already guessed ${guessed.name}.`, "bad");
    playSound("unknown");
    input.value = "";
    return;
  }

  guessedNames.add(guessed.name);
  multiplayer.guessesUsed += 1;
  const correct = guessed.name === current.name;
  const distance = correct ? 0 : Math.round(haversineKm(guessed.lon, guessed.lat, current.lon, current.lat));

  if (correct) {
    multiplayer.solved = true;
    multiplayer.correctAt = Math.max(0, Date.now() - multiplayer.roundStartedAt);
    addHistory(`${guessed.name}: correct`);
    roundOver = true;
    input.disabled = true;
    setFeedback(`Correct. ${formatPoints(multiplayer.points)} points.`, "good");
    playSound("correct");
    popBits("good");
  } else {
    guessesLeft -= 1;
    multiplayer.points += distance;
    const distanceText = `${distance.toLocaleString()} km`;
    addHistory(`${guessed.name}: ${distanceText} away`);
    if (guessesLeft <= 0) {
      multiplayer.out = true;
      input.disabled = true;
      setFeedback(`${guessed.name} is ${distanceText} away. Answer: ${current.name}.`, "bad");
      playSound("wrong");
    } else {
      setFeedback(`${guessed.name} is ${distanceText} away. ${guessesLeft} guesses left.`);
      playSound("wrong");
    }
  }

  ensurePlayer({ ...ownPlayerState(), online: true });
  sendRoomEvent("guess", {
    host: multiplayer.isHost,
    roundId: multiplayer.roundId,
    guessName: guessed.name,
    distance,
    correct,
    out: multiplayer.out,
    points: multiplayer.points,
    guesses: multiplayer.guessesUsed,
    correctAt: multiplayer.correctAt,
  });
  broadcastPlayerUpdate();
  finishMultiplayerRoundIfDone();
  updateLabels();
  updatePlayersList();
  input.value = "";
}

function chooseCountry() {
  if (forcedCountry) return forcedCountry;

  let pool = countries.filter((country) => !recentNames.includes(country.name));
  if (!pool.length) {
    recentNames = [];
    pool = countries.slice();
  }
  const country = pool[Math.floor(Math.random() * pool.length)];
  recentNames.push(country.name);
  recentNames = recentNames.slice(-30);
  return country;
}

function resizeCanvas() {
  const rect = canvasWrap.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(2, Math.floor(rect.width * dpr));
  canvas.height = Math.max(2, Math.floor(rect.height * dpr));
  canvas.style.width = `${rect.width}px`;
  canvas.style.height = `${rect.height}px`;
  drawCurrentCountry();
}

function unwrapLongitude(lon, centerLon) {
  let value = lon;
  while (value - centerLon > 180) value -= 360;
  while (value - centerLon < -180) value += 360;
  return value;
}

function localEqualAreaPoint(lon, lat, centerLon, centerLat) {
  const lambda = unwrapLongitude(lon, centerLon) * Math.PI / 180;
  const lambda0 = centerLon * Math.PI / 180;
  const phi = Math.max(-89.5, Math.min(89.5, lat)) * Math.PI / 180;
  const phi0 = centerLat * Math.PI / 180;
  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const sinPhi0 = Math.sin(phi0);
  const cosPhi0 = Math.cos(phi0);
  const deltaLambda = lambda - lambda0;
  const denominator = Math.max(
    0.000001,
    1 + sinPhi0 * sinPhi + cosPhi0 * cosPhi * Math.cos(deltaLambda),
  );
  const k = Math.sqrt(2 / denominator);

  return [
    k * cosPhi * Math.sin(deltaLambda),
    k * (cosPhi0 * sinPhi - sinPhi0 * cosPhi * Math.cos(deltaLambda)),
  ];
}

function unwrappedCountryRings(country) {
  return country.rings.map((ring) => (
    ring.map(([lon, lat]) => [unwrapLongitude(lon, country.lon), lat])
  ));
}

function projectedRings(country) {
  const unwrapped = unwrappedCountryRings(country);
  let minLon = Infinity;
  let maxLon = -Infinity;

  for (const ring of unwrapped) {
    for (const [lon] of ring) {
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
    }
  }

  const span = maxLon - minLon;

  if (span > 105) {
    const xScale = Math.max(0.22, Math.cos(country.lat * Math.PI / 180));
    return unwrapped.map((ring) => (
      ring.map(([lon, lat]) => [(lon - country.lon) * xScale, lat])
    ));
  }

  return country.rings.map((ring) => (
    ring.map(([lon, lat]) => localEqualAreaPoint(lon, lat, country.lon, country.lat))
  ));
}

function ringArea(ring) {
  let area = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area) / 2;
}

function ringBounds(ring) {
  const xs = ring.map(([x]) => x);
  const ys = ring.map(([, y]) => y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    minX,
    maxX,
    minY,
    maxY,
    spanX: maxX - minX,
    spanY: maxY - minY,
  };
}

function drawingBounds(rings) {
  const metrics = rings
    .filter((ring) => ring.length >= 3)
    .map((ring) => ({ ring, area: ringArea(ring), bounds: ringBounds(ring) }))
    .filter(({ area, bounds }) => (
      Number.isFinite(area) &&
      Number.isFinite(bounds.minX) &&
      Number.isFinite(bounds.maxX) &&
      Number.isFinite(bounds.minY) &&
      Number.isFinite(bounds.maxY)
    ));

  if (!metrics.length) return null;

  const largestArea = Math.max(...metrics.map(({ area }) => area));
  const largest = metrics.find(({ area }) => area === largestArea);
  const spanFloor = Math.max(0.0008, Math.sqrt(largestArea) * 0.028);
  const selected = metrics.filter(({ area, bounds }) => (
    area >= largestArea * 0.0012 ||
    bounds.spanX >= spanFloor ||
    bounds.spanY >= spanFloor
  ));
  const fitMetrics = selected.length ? selected : [largest];
  const fitRings = fitMetrics.map(({ ring }) => ring);
  const points = fitRings.flat();
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);

  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

function countryDrawingGeometry(country) {
  let cached = localGeometryCache.get(country);
  if (cached) return cached;

  const rings = projectedRings(country);
  cached = {
    rings,
    bounds: drawingBounds(rings),
  };
  localGeometryCache.set(country, cached);
  return cached;
}

function drawCanvasBackdrop(width, height, dpr) {
  const sky = ctx.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, "#c5e7df");
  sky.addColorStop(0.54, "#fff0bf");
  sky.addColorStop(1, "#f7e3a9");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.strokeStyle = "#5f7e4b";
  ctx.lineWidth = 1 * dpr;
  const grid = 28 * dpr;
  for (let x = 0; x <= width; x += grid) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = 0; y <= height; y += grid) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.fillStyle = "rgba(143, 189, 115, 0.26)";
  ctx.beginPath();
  ctx.moveTo(0, height * 0.82);
  ctx.bezierCurveTo(width * 0.22, height * 0.68, width * 0.34, height * 0.92, width * 0.52, height * 0.75);
  ctx.bezierCurveTo(width * 0.72, height * 0.58, width * 0.86, height * 0.82, width, height * 0.66);
  ctx.lineTo(width, height);
  ctx.lineTo(0, height);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function wrappedLongitude(lon) {
  let wrappedLon = ((lon + 180) % 360 + 360) % 360 - 180;
  if (wrappedLon === -180 && lon > 0) wrappedLon = 180;
  return wrappedLon;
}

function worldBox(width, height, dpr) {
  const margin = 38 * dpr;
  const availableWidth = Math.max(1, width - 2 * margin);
  const availableHeight = Math.max(1, height - 2 * margin);
  const worldWidth = Math.min(availableWidth, availableHeight * 1.96);
  const worldHeight = worldWidth / 2;
  return {
    x: (width - worldWidth) / 2,
    y: (height - worldHeight) / 2,
    width: worldWidth,
    height: worldHeight,
  };
}

function baseWorldPoint(lon, lat, box) {
  const wrappedLon = wrappedLongitude(lon);
  return [
    box.x + ((wrappedLon + 180) / 360) * box.width,
    box.y + ((90 - lat) / 180) * box.height,
  ];
}

function worldScreenPoint(lon, lat, box, width, height) {
  const [x, y] = baseWorldPoint(lon, lat, box);
  if (!current || worldZoom <= minWorldZoom + 0.01) return [x, y];
  const [focusX, focusY] = baseWorldPoint(current.lon, current.lat, box);
  return [
    width / 2 + (x - focusX) * worldZoom,
    height / 2 + (y - focusY) * worldZoom,
  ];
}

function drawWorldCountry(country, box, width, height, dpr, options) {
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = options.lineWidth * dpr;
  ctx.strokeStyle = options.stroke;
  ctx.fillStyle = options.fill || "transparent";
  const stride = Math.max(1, options.stride || 1);

  for (const ring of country.rings) {
    if (ring.length < 2) continue;
    ctx.beginPath();
    let previousBaseX = null;
    let segmentStarted = false;
    let split = false;

    for (let i = 0; i < ring.length; i += stride) {
      const [lon, lat] = ring[i];
      const [baseX] = baseWorldPoint(lon, lat, box);
      const [x, y] = worldScreenPoint(lon, lat, box, width, height);
      const crossesEdge = previousBaseX !== null && Math.abs(baseX - previousBaseX) > box.width * 0.52;

      if (!segmentStarted || crossesEdge) {
        ctx.moveTo(x, y);
        segmentStarted = true;
        if (crossesEdge) split = true;
      } else {
        ctx.lineTo(x, y);
      }

      previousBaseX = baseX;
    }

    if (stride > 1 && (ring.length - 1) % stride !== 0) {
      const [lon, lat] = ring[ring.length - 1];
      const [baseX] = baseWorldPoint(lon, lat, box);
      const [x, y] = worldScreenPoint(lon, lat, box, width, height);
      const crossesEdge = previousBaseX !== null && Math.abs(baseX - previousBaseX) > box.width * 0.52;

      if (!segmentStarted || crossesEdge) {
        ctx.moveTo(x, y);
        segmentStarted = true;
        if (crossesEdge) split = true;
      } else {
        ctx.lineTo(x, y);
      }
    }

    if (!split) {
      ctx.closePath();
      if (options.fill) ctx.fill();
    }
    ctx.stroke();
  }
  ctx.restore();
}

function drawWorldGrid(box, width, height, dpr) {
  ctx.save();
  ctx.strokeStyle = "rgba(49, 66, 44, 0.16)";
  ctx.lineWidth = 0.75 * dpr;
  ctx.setLineDash([3 * dpr, 7 * dpr]);

  for (let lon = -120; lon <= 120; lon += 60) {
    ctx.beginPath();
    for (let lat = -80; lat <= 80; lat += 4) {
      const [x, y] = worldScreenPoint(lon, lat, box, width, height);
      if (lat === -80) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  for (let lat = -60; lat <= 60; lat += 30) {
    ctx.beginPath();
    for (let lon = -180; lon <= 180; lon += 4) {
      const [x, y] = worldScreenPoint(lon, lat, box, width, height);
      if (lon === -180) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  ctx.setLineDash([]);
  ctx.strokeStyle = "rgba(37, 51, 32, 0.26)";
  ctx.lineWidth = 1.2 * dpr;
  ctx.strokeRect(box.x, box.y, box.width, box.height);
  ctx.restore();
}

function drawWorldView(width, height, dpr) {
  const box = worldBox(width, height, dpr);
  const backgroundStride = worldZoom < 2 ? 5 : worldZoom < 5 ? 3 : 2;
  drawWorldGrid(box, width, height, dpr);

  for (const country of countries) {
    drawWorldCountry(country, box, width, height, dpr, {
      lineWidth: 0.65,
      stroke: "rgba(49, 66, 44, 0.22)",
      stride: country === current ? 1 : backgroundStride,
    });
  }

  drawWorldCountry(current, box, width, height, dpr, {
    lineWidth: 7,
    stroke: "rgba(255, 253, 242, 0.78)",
    fill: "rgba(255, 230, 142, 0.68)",
  });
  drawWorldCountry(current, box, width, height, dpr, {
    lineWidth: 2.6,
    stroke: "#253320",
    fill: "rgba(255, 230, 142, 0.68)",
  });
  drawWorldCountry(current, box, width, height, dpr, {
    lineWidth: 1,
    stroke: "rgba(91, 79, 57, 0.34)",
  });
}

function traceRings(rings, offsetX, offsetY, scale) {
  ctx.beginPath();
  for (const ring of rings) {
    if (ring.length < 2) continue;
    let previousPoint = null;
    let wasSplit = false;
    for (let i = 0; i < ring.length; i += 1) {
      const [x, y] = ring[i];
      const cx = offsetX + x * scale;
      const cy = offsetY - y * scale;
      const jump = previousPoint ? Math.hypot(x - previousPoint[0], y - previousPoint[1]) : 0;
      if (i === 0 || jump > 1.7) {
        ctx.moveTo(cx, cy);
        if (i !== 0) wasSplit = true;
      }
      else ctx.lineTo(cx, cy);
      previousPoint = [x, y];
    }
    if (!wasSplit) ctx.closePath();
  }
}

function fittedTransform(bounds, box) {
  const spanX = Math.max(bounds.maxX - bounds.minX, 0.00001);
  const spanY = Math.max(bounds.maxY - bounds.minY, 0.00001);
  const scale = Math.min(box.width / spanX, box.height / spanY);

  return {
    offsetX: box.x + (box.width - spanX * scale) / 2 - bounds.minX * scale,
    offsetY: box.y + (box.height + spanY * scale) / 2 + bounds.minY * scale,
    scale,
  };
}

function drawFittedRings(rings, bounds, box, dpr, options = {}) {
  if (!bounds || !box.width || !box.height) return;

  const { offsetX, offsetY, scale } = fittedTransform(bounds, box);
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (options.fill) {
    traceRings(rings, offsetX, offsetY, scale);
    ctx.fillStyle = options.fill;
    ctx.fill();
  }

  for (const stroke of options.strokes || []) {
    traceRings(rings, offsetX, offsetY, scale);
    ctx.setLineDash(stroke.dash ? stroke.dash.map((value) => value * dpr) : []);
    ctx.lineWidth = stroke.width * dpr;
    ctx.strokeStyle = stroke.color;
    ctx.stroke();
  }

  ctx.restore();
}

function hintLayoutBoxes(width, height, dpr) {
  const margin = 54 * dpr;
  const gap = 24 * dpr;
  const fullBox = {
    x: margin,
    y: margin,
    width: Math.max(1, width - 2 * margin),
    height: Math.max(1, height - 2 * margin),
  };

  if (fullBox.width >= fullBox.height * 1.15) {
    const hintWidth = Math.max(90 * dpr, fullBox.width * 0.32);
    const mainWidth = Math.max(1, fullBox.width - hintWidth - gap);
    return {
      fullBox,
      mainBox: {
        x: fullBox.x,
        y: fullBox.y,
        width: mainWidth,
        height: fullBox.height,
      },
      hintBox: {
        x: fullBox.x + mainWidth + gap,
        y: fullBox.y + fullBox.height * 0.08,
        width: Math.max(1, fullBox.width - mainWidth - gap),
        height: Math.max(1, fullBox.height * 0.84),
      },
    };
  }

  const hintHeight = Math.max(76 * dpr, fullBox.height * 0.32);
  const mainHeight = Math.max(1, fullBox.height - hintHeight - gap);
  return {
    fullBox,
    mainBox: {
      x: fullBox.x,
      y: fullBox.y,
      width: fullBox.width,
      height: mainHeight,
    },
    hintBox: {
      x: fullBox.x + fullBox.width * 0.12,
      y: fullBox.y + mainHeight + gap,
      width: fullBox.width * 0.76,
      height: Math.max(1, fullBox.height - mainHeight - gap),
    },
  };
}

function drawCurrentCountry() {
  if (!canvas.width || !canvas.height) return;

  const width = canvas.width;
  const height = canvas.height;
  const dpr = window.devicePixelRatio || 1;

  ctx.clearRect(0, 0, width, height);
  drawCanvasBackdrop(width, height, dpr);
  if (!current) {
    ctx.save();
    ctx.fillStyle = "rgba(36, 50, 37, 0.72)";
    ctx.font = `${Math.round(16 * dpr)}px "MS Sans Serif", Tahoma, sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText(canvasStatusMessage || "Preparing map...", width / 2, height / 2);
    ctx.restore();
    return;
  }

  if (hintLevel >= 2) {
    drawWorldView(width, height, dpr);
    return;
  }

  const { rings, bounds } = countryDrawingGeometry(current);
  if (!bounds) return;
  const { fullBox, mainBox, hintBox } = hintLayoutBoxes(width, height, dpr);
  const currentBox = hintLevel === 1 ? mainBox : fullBox;

  drawFittedRings(rings, bounds, currentBox, dpr, {
    fill: "rgba(255, 253, 242, 0.34)",
    strokes: [
      { width: 7, color: "rgba(255, 253, 242, 0.7)" },
      { width: 3, color: "#253320" },
      { width: 1.1, color: "rgba(91, 79, 57, 0.32)" },
    ],
  });

  if (hintLevel === 1) {
    const nearby = nearbyHintCountry(current);
    const nearbyGeometry = nearby ? countryDrawingGeometry(nearby) : null;
    if (nearbyGeometry && nearbyGeometry.bounds) {
      drawFittedRings(nearbyGeometry.rings, nearbyGeometry.bounds, hintBox, dpr, {
        fill: "rgba(126, 168, 137, 0.2)",
        strokes: [
          { width: 8, color: "rgba(255, 253, 242, 0.8)" },
          { width: 3.6, color: "rgba(49, 66, 44, 0.92)" },
          { width: 1.2, color: "rgba(223, 139, 114, 0.72)" },
        ],
      });
    }
  }
}

function setFeedback(message, kind = "") {
  feedback.textContent = message;
  feedback.className = `feedback ${kind}`.trim();
}

function updateLabels() {
  if (isMultiplayerActive()) {
    scoreLabel.textContent = `Points ${formatPoints(multiplayer.points)}`;
    if (roundOver) guessCountLabel.textContent = "Round over";
    else if (multiplayer.solved) guessCountLabel.textContent = "Solved";
    else if (multiplayer.out || guessesLeft <= 0) guessCountLabel.textContent = "Out of guesses";
    else guessCountLabel.textContent = `Guess ${multiplayer.guessesUsed + 1} of ${maxGuesses}`;
    updateHintUi();
    updateMultiplayerUi();
    return;
  }

  scoreLabel.textContent = `Score ${score}/${rounds}`;
  const guessNumber = Math.min(maxGuesses, maxGuesses - guessesLeft + 1);
  guessCountLabel.textContent = roundOver ? "Round over" : `Guess ${guessNumber} of ${maxGuesses}`;
  updateHintUi();
}

function addHistory(message) {
  const item = document.createElement("li");
  item.textContent = message;
  history.prepend(item);
}

function newRound() {
  current = chooseCountry();
  canvasStatusMessage = "";
  clearRoomStateRetry();
  guessesLeft = maxGuesses;
  roundOver = false;
  hintLevel = forcedHintLevel;
  worldZoom = hintLevel >= 2 ? (forcedWorldZoom || initialWorldZoom) : minWorldZoom;
  guessedNames = new Set();
  history.innerHTML = "";
  input.value = "";
  input.disabled = false;
  if (skipButton) skipButton.disabled = false;
  if (nextButton) nextButton.disabled = false;
  setFeedback("Five guesses. Wrong answers get distance feedback.");
  updateLabels();
  resizeCanvas();
  input.focus();
}

function editDistance(a, b) {
  const dp = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i += 1) dp[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) dp[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[a.length][b.length];
}

function suggestionsFor(rawGuess) {
  const guess = normalizeName(rawGuess);
  if (!guess) return [];
  const seen = new Set();
  const scored = [];
  for (const [alias, country] of aliasMap.entries()) {
    if (seen.has(country.name)) continue;
    const dist = editDistance(guess, alias);
    const scoreValue = dist / Math.max(guess.length, alias.length, 1);
    if (scoreValue <= 0.32 || alias.includes(guess) || guess.includes(alias)) {
      seen.add(country.name);
      scored.push({ country, scoreValue });
    }
  }
  scored.sort((a, b) => a.scoreValue - b.scoreValue || a.country.name.localeCompare(b.country.name));
  return scored.slice(0, 3).map((entry) => entry.country.name);
}

function finishRound(message, kind) {
  if (!isMultiplayerActive()) rounds += 1;
  roundOver = true;
  input.disabled = true;
  setFeedback(message, kind);
  updateLabels();
}

function useHint() {
  if (!current || roundOver || hintLevel >= maxHints) return;
  hintLevel += 1;
  if (hintLevel === 2) worldZoom = forcedWorldZoom || initialWorldZoom;
  updateHintUi();
  drawCurrentCountry();
  playSound("hint");
  if (hintLevel >= maxHints) popBits("good");
  input.focus();
}

function submitGuess(rawGuess) {
  if (!current || roundOver) return;
  if (isMultiplayerActive()) {
    submitMultiplayerGuess(rawGuess);
    return;
  }

  const normalized = normalizeName(rawGuess);
  if (!normalized) {
    setFeedback("Type a country name first.", "bad");
    playSound("unknown");
    return;
  }

  const guessed = aliasMap.get(normalized);
  if (!guessed) {
    const suggestions = suggestionsFor(rawGuess);
    const suffix = suggestions.length ? ` Did you mean ${suggestions.join(", ")}?` : "";
    setFeedback(`I do not recognize that country.${suffix}`, "bad");
    playSound("unknown");
    return;
  }

  if (guessedNames.has(guessed.name)) {
    setFeedback(`You already guessed ${guessed.name}.`, "bad");
    playSound("unknown");
    input.value = "";
    return;
  }
  guessedNames.add(guessed.name);

  if (guessed.name === current.name) {
    score += 1;
    addHistory(`${guessed.name}: correct`);
    finishRound(`Correct. It was ${current.name}.`, "good");
    playSound("correct");
    popBits("good");
    input.value = "";
    return;
  }

  guessesLeft -= 1;
  const distance = Math.round(haversineKm(guessed.lon, guessed.lat, current.lon, current.lat));
  const distanceText = `${distance.toLocaleString()} km`;
  addHistory(`${guessed.name}: ${distanceText} away`);

  if (guessesLeft <= 0) {
    finishRound(`${guessed.name} is ${distanceText} away. Answer: ${current.name}.`, "bad");
    playSound("wrong");
    popBits("bad");
  } else {
    setFeedback(`${guessed.name} is ${distanceText} away. ${guessesLeft} guesses left.`);
    playSound("wrong");
    updateLabels();
  }
  input.value = "";
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  playSound("tap");
  submitGuess(input.value);
});

if (hintButton) {
  hintButton.addEventListener("click", () => {
    playSound("tap");
    useHint();
  });
}

canvas.addEventListener("wheel", (event) => {
  if (hintLevel < 2) return;
  event.preventDefault();
  const factor = event.deltaY < 0 ? 1.24 : 1 / 1.24;
  setWorldZoom(worldZoom * factor);
}, { passive: false });

skipButton.addEventListener("click", () => {
  playSound("tap");
  if (!current || roundOver) return;
  if (isMultiplayerActive()) {
    multiplayer.out = true;
    guessesLeft = 0;
    input.disabled = true;
    setFeedback(`Skipped. Answer: ${current.name}. Waiting for next round.`);
    broadcastPlayerUpdate();
    finishMultiplayerRoundIfDone();
    updateLabels();
    return;
  }
  finishRound(`Skipped. It was ${current.name}.`, "bad");
  playSound("wrong");
});

nextButton.addEventListener("click", () => {
  playSound("next");
  if (isMultiplayerActive()) {
    if (multiplayer.isHost) startMultiplayerRound();
    else setFeedback("Host starts the next round.");
    return;
  }
  newRound();
});

if (friendsTabButton) {
  friendsTabButton.addEventListener("click", () => {
    playSound("tap");
    setMultiplayerPanelOpen(!multiplayerPanelOpen);
    if (multiplayerPanelOpen) {
      const target = requestedRoom && roomCodeInput ? roomCodeInput : playerNameInput;
      if (target) target.focus();
    } else {
      input.focus();
    }
  });
}

if (playerNameInput) {
  playerNameInput.value = multiplayer.playerName;
  playerNameInput.addEventListener("change", () => {
    multiplayer.playerName = cleanPlayerName(playerNameInput.value);
    playerNameInput.value = multiplayer.playerName;
    safeStorageSet("mapMeadowPlayerName", multiplayer.playerName);
    ensurePlayer({ ...ownPlayerState(), online: true });
    broadcastPlayerUpdate();
    updateMultiplayerUi();
  });
}

if (roomCodeInput) {
  roomCodeInput.value = requestedRoom;
  roomCodeInput.addEventListener("input", () => {
    roomCodeInput.value = normalizeRoomCode(roomCodeInput.value);
  });
}

if (createRoomButton) {
  createRoomButton.addEventListener("click", () => {
    playSound("tap");
    joinRoom(makeRoomCode(), true);
  });
}

if (joinRoomButton) {
  joinRoomButton.addEventListener("click", () => {
    playSound("tap");
    joinRoom(roomCodeInput ? roomCodeInput.value : "", false);
  });
}

if (copyRoomLinkButton) {
  copyRoomLinkButton.addEventListener("click", async () => {
    playSound("tap");
    if (!multiplayer.roomCode) return;
    const link = multiplayerShareUrl();
    try {
      await navigator.clipboard.writeText(link);
      setMultiplayerStatus("Link copied.", "good");
    } catch {
      setMultiplayerStatus(`Copy this link: ${link}`, "good");
    }
  });
}

if (leaveRoomButton) {
  leaveRoomButton.addEventListener("click", () => {
    playSound("tap");
    leaveRoom();
  });
}

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !multiplayerPanelOpen) return;
  setMultiplayerPanelOpen(false);
  input.focus();
});

document.addEventListener("click", (event) => {
  if (!multiplayerPanelOpen || !multiplayerPanel || !friendsTabButton) return;
  const target = event.target;
  if (multiplayerPanel.contains(target) || friendsTabButton.contains(target)) return;
  setMultiplayerPanelOpen(false);
});

if (soundToggle) {
  soundToggle.addEventListener("click", () => {
    if (soundEnabled) playSound("tap");
    soundEnabled = !soundEnabled;
    updateSoundToggle();
    if (soundEnabled) playSound("next");
    input.focus();
  });
}

window.addEventListener("resize", resizeCanvas);

updateSoundToggle();
updateMultiplayerUi();

if (!countries.length) {
  setFeedback("Country data did not load.", "bad");
} else if (requestedRoom && canUseSupabase()) {
  showRoomLinkLoading(requestedRoom);
  updateMultiplayerUi();
  joinRoom(requestedRoom, false);
} else {
  newRound();
  updateMultiplayerUi();
  if (requestedRoom) {
    setMultiplayerStatus("Add Supabase keys before joining.", "bad");
  }
}
