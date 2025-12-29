const navItems = document.querySelectorAll(".nav-item");
const views = document.querySelectorAll(".view");
const themeBtn = document.getElementById("themeBtn");
const navUsers = document.getElementById("navUsers");
const userNameEl = document.getElementById("userName");
const userRoleEl = document.getElementById("userRole");
const logoutBtn = document.getElementById("logoutBtn");

const serverListEl = document.getElementById("serverList");
const emptyStateEl = document.getElementById("emptyState");
const refreshBtn = document.getElementById("refreshBtn");
const newServerBtn = document.getElementById("newServerBtn");
const activeServerName = document.getElementById("activeServerName");
const activeServerMeta = document.getElementById("activeServerMeta");
const overviewStatus = document.getElementById("overviewStatus");
const overviewPort = document.getElementById("overviewPort");
const overviewVersion = document.getElementById("overviewVersion");
const overviewType = document.getElementById("overviewType");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const restartBtn = document.getElementById("restartBtn");

const countTotal = document.getElementById("countTotal");
const countRunning = document.getElementById("countRunning");
const countStopped = document.getElementById("countStopped");

const createForm = document.getElementById("createForm");
const createMemory = document.getElementById("createMemory");
const createMemoryValue = document.getElementById("createMemoryValue");

const settingsForm = document.getElementById("settingsForm");
const settingsServerBadge = document.getElementById("settingsServerBadge");
const settingsRestart = document.getElementById("settingsRestart");
const whitelistName = document.getElementById("whitelistName");
const whitelistAddBtn = document.getElementById("whitelistAddBtn");
const whitelistList = document.getElementById("whitelistList");
const deleteKeepData = document.getElementById("deleteKeepData");
const deleteConfirm = document.getElementById("deleteConfirm");
const deleteServerBtn = document.getElementById("deleteServerBtn");

const modSearchInput = document.getElementById("modSearchInput");
const modLoader = document.getElementById("modLoader");
const modGameVersion = document.getElementById("modGameVersion");
const modRestart = document.getElementById("modRestart");
const modSearchBtn = document.getElementById("modSearchBtn");
const modSearchResults = document.getElementById("modSearchResults");
const installedMods = document.getElementById("installedMods");

const consoleSelect = document.getElementById("consoleServerSelect");
const liveLogsBtn = document.getElementById("liveLogsBtn");
const fetchLogsBtn = document.getElementById("fetchLogsBtn");
const clearLogsBtn = document.getElementById("clearLogsBtn");
const logOutput = document.getElementById("logOutput");
const commandInput = document.getElementById("commandInput");
const sendCommandBtn = document.getElementById("sendCommandBtn");

const userCreateForm = document.getElementById("userCreateForm");
const newUserName = document.getElementById("newUserName");
const newUserPassword = document.getElementById("newUserPassword");
const newUserRole = document.getElementById("newUserRole");
const userList = document.getElementById("userList");

let servers = [];
let activeServerId = null;
let modVersionCache = {};
let modSearchToken = 0;
let lastModServerId = null;
let liveLogsController = null;
let liveLogsActive = false;
let liveLogsServerId = null;
let logBuffer = "";
const MAX_LOG_CHARS = 200000;
let currentUser = null;

function toast(message, type = "") {
  const toastEl = document.getElementById("toast");
  toastEl.textContent = message;
  toastEl.className = `toast ${type}`.trim();
  requestAnimationFrame(() => toastEl.classList.add("show"));
  setTimeout(() => toastEl.classList.remove("show"), 3200);
}

async function apiRequest(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (response.status === 401) {
    window.location = "/login";
    throw new Error("Not authenticated");
  }
  if (!response.ok) {
    let detail = "Request failed";
    try {
      const data = await response.json();
      detail = data.detail || detail;
    } catch (err) {
      detail = await response.text();
    }
    throw new Error(detail);
  }
  if (response.status === 204) {
    return null;
  }
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json();
  }
  return response.text();
}

function showView(viewId) {
  views.forEach((view) => view.classList.remove("active"));
  navItems.forEach((item) => item.classList.remove("active"));
  const view = document.getElementById(viewId);
  if (view) view.classList.add("active");
  const nav = Array.from(navItems).find((item) => item.dataset.view === viewId);
  if (nav) nav.classList.add("active");
  if (viewId !== "view-console") {
    stopLiveLogs();
  }
}

function updateLiveButton() {
  liveLogsBtn.textContent = liveLogsActive ? "Stop live" : "Start live";
  liveLogsBtn.classList.toggle("primary", liveLogsActive);
  fetchLogsBtn.disabled = liveLogsActive;
}

function resetLogBuffer(text = "") {
  logBuffer = text;
  logOutput.textContent = logBuffer;
}

function appendLog(text) {
  if (!text) return;
  logBuffer += text;
  if (logBuffer.length > MAX_LOG_CHARS) {
    logBuffer = logBuffer.slice(-MAX_LOG_CHARS);
  }
  logOutput.textContent = logBuffer;
  logOutput.scrollTop = logOutput.scrollHeight;
}

async function startLiveLogs() {
  const serverId = consoleSelect.value;
  if (!serverId) {
    toast("Select a server first", "error");
    return;
  }
  if (liveLogsActive && liveLogsServerId === serverId) {
    return;
  }
  stopLiveLogs();
  liveLogsActive = true;
  liveLogsServerId = serverId;
  updateLiveButton();
  resetLogBuffer("Connecting to live logs...\n");

  const controller = new AbortController();
  liveLogsController = controller;
  try {
    const response = await fetch(`/servers/${serverId}/logs?follow=true&tail=200`, {
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || "Failed to stream logs");
    }
    if (!response.body) {
      throw new Error("Streaming not supported by this browser");
    }
    resetLogBuffer("");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      appendLog(decoder.decode(value, { stream: true }));
    }
  } catch (err) {
    if (err.name !== "AbortError") {
      toast(err.message || "Live logs stopped", "error");
    }
  } finally {
    if (liveLogsActive && liveLogsController === controller) {
      stopLiveLogs({ abort: false });
    }
  }
}

function stopLiveLogs({ abort = true } = {}) {
  if (!liveLogsActive) {
    updateLiveButton();
    return;
  }
  liveLogsActive = false;
  liveLogsServerId = null;
  if (abort && liveLogsController) {
    liveLogsController.abort();
  }
  liveLogsController = null;
  updateLiveButton();
}

function setTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  themeBtn.textContent = theme === "dark" ? "Dark" : "Light";
  localStorage.setItem("tc-theme", theme);
}

async function loadCurrentUser() {
  try {
    const response = await apiRequest("/auth/me");
    currentUser = response.user || null;
    updateUserCard();
    return !!currentUser;
  } catch (err) {
    currentUser = null;
    return false;
  }
}

function updateUserCard() {
  if (!currentUser) {
    userNameEl.textContent = "-";
    userRoleEl.textContent = "-";
    if (navUsers) navUsers.hidden = true;
    return;
  }
  userNameEl.textContent = currentUser.username;
  userRoleEl.textContent = currentUser.role;
  if (navUsers) {
    navUsers.hidden = currentUser.role !== "owner";
  }
}

async function logout() {
  try {
    await apiRequest("/auth/logout", { method: "POST" });
  } catch (err) {
    // Ignore and force navigation.
  }
  window.location = "/login";
}

async function loadUsers() {
  if (!currentUser || currentUser.role !== "owner") {
    if (userList) {
      userList.innerHTML = `<div class="list-item">Owner access required.</div>`;
    }
    return;
  }
  try {
    const response = await apiRequest("/auth/users");
    renderUsers(response.users || []);
  } catch (err) {
    if (userList) {
      userList.innerHTML = `<div class="list-item">Unable to load users.</div>`;
    }
  }
}

function renderUsers(users) {
  if (!userList) return;
  userList.innerHTML = "";
  if (!users.length) {
    const empty = document.createElement("div");
    empty.className = "list-item";
    empty.textContent = "No users found";
    userList.appendChild(empty);
    return;
  }
  users.forEach((user) => {
    const item = document.createElement("div");
    item.className = "list-item";
    item.innerHTML = `<div><strong>${user.username}</strong><br /><small>${user.role}</small></div>`;
    userList.appendChild(item);
  });
}

async function createUser(event) {
  event.preventDefault();
  if (!currentUser || currentUser.role !== "owner") {
    toast("Owner access required", "error");
    return;
  }
  const username = newUserName.value.trim();
  const password = newUserPassword.value;
  const role = newUserRole.value;
  if (!username || !password) {
    toast("Username and password required", "error");
    return;
  }
  try {
    await apiRequest("/auth/users", {
      method: "POST",
      body: JSON.stringify({ username, password, role }),
    });
    newUserName.value = "";
    newUserPassword.value = "";
    toast("User created", "success");
    await loadUsers();
  } catch (err) {
    toast(err.message, "error");
  }
}

function bindTabs(scopeId) {
  const scope = document.getElementById(scopeId);
  if (!scope) return;
  const tabs = scope.querySelectorAll(".tab");
  const panels = scope.querySelectorAll(".tab-content");
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const target = tab.dataset.tab;
      tabs.forEach((btn) => btn.classList.remove("active"));
      tab.classList.add("active");
      panels.forEach((panel) => {
        panel.classList.toggle("active", panel.dataset.tabPanel === target);
      });
    });
  });
}

function updateCounts() {
  const running = servers.filter((s) => s.status === "running").length;
  const stopped = servers.length - running;
  countTotal.textContent = `${servers.length} total`;
  countRunning.textContent = `${running} running`;
  countStopped.textContent = `${stopped} stopped`;
}

function getActiveServer() {
  if (!activeServerId) return null;
  return servers.find((item) => item.server_id === activeServerId) || null;
}

function renderServers() {
  serverListEl.innerHTML = "";
  if (!servers.length) {
    emptyStateEl.style.display = "block";
    return;
  }
  emptyStateEl.style.display = "none";

  servers.forEach((server) => {
    const card = document.createElement("div");
    card.className = "server-card";
    if (server.server_id === activeServerId) {
      card.classList.add("active");
    }
    const status = (server.status || "stopped").toLowerCase();
    const statusClass = status === "running" ? "running" : "stopped";
    const portLabel = server.port ? `:${server.port}` : "auto";
    card.innerHTML = `
      <div>
        <h3>${server.name}</h3>
        <div class="status ${statusClass}">
          <span class="status-dot"></span>
          <span>${server.status}</span>
        </div>
        <div class="server-meta">${server.server_type || "VANILLA"} • ${server.version || "latest"} • ${portLabel}</div>
      </div>
      <div class="server-actions">
        <button class="btn small" data-action="select" data-id="${server.server_id}">Select</button>
        <button class="btn small" data-action="edit" data-id="${server.server_id}">Edit</button>
      </div>
    `;
    serverListEl.appendChild(card);
  });
}

function setActiveServer(serverId) {
  activeServerId = serverId;
  const server = servers.find((item) => item.server_id === serverId);
  if (!server) {
    activeServerName.textContent = "No server selected";
    activeServerMeta.textContent = "Select a server from the list.";
    settingsServerBadge.textContent = "No server";
    updateOverview(null);
    updateActionButtons(null);
    syncModFiltersWithServer();
    return;
  }
  activeServerName.textContent = server.name;
  activeServerMeta.textContent = `${server.server_type || "VANILLA"} • ${server.version || "latest"}`;
  settingsServerBadge.textContent = server.name;
  updateOverview(server);
  updateActionButtons(server);
  populateConsoleSelect();
  renderServers();
  syncModFiltersWithServer();
  loadSettings();
  loadWhitelist();
  loadMods();
}

function updateOverview(server) {
  if (!server) {
    overviewStatus.textContent = "-";
    overviewPort.textContent = "-";
    overviewVersion.textContent = "-";
    overviewType.textContent = "-";
    return;
  }
  overviewStatus.textContent = server.status;
  overviewPort.textContent = server.port ? `:${server.port}` : "auto";
  overviewVersion.textContent = server.version || "latest";
  overviewType.textContent = server.server_type || "VANILLA";
}

function updateActionButtons(server) {
  if (!server) {
    startBtn.disabled = true;
    stopBtn.disabled = true;
    restartBtn.disabled = true;
    return;
  }
  const isRunning = server.status === "running";
  startBtn.disabled = isRunning;
  stopBtn.disabled = !isRunning;
  restartBtn.disabled = false;
}

function syncModFiltersWithServer() {
  if (activeServerId !== lastModServerId) {
    modSearchToken += 1;
    modVersionCache = {};
    modSearchResults.innerHTML = "";
    modSearchInput.value = "";
    lastModServerId = activeServerId;
  }

  const server = getActiveServer();
  if (!server) {
    modLoader.value = "fabric";
    modGameVersion.value = "";
    modLoader.disabled = true;
    modGameVersion.disabled = true;
    modSearchInput.disabled = true;
    modSearchBtn.disabled = true;
    modSearchResults.innerHTML = `<div class="list-item">Select a server to search mods.</div>`;
    return;
  }

  const serverType = (server.server_type || "").toLowerCase();
  const isModded = serverType === "fabric" || serverType === "forge";
  const rawVersion = (server.version || "").trim();
  const normalizedVersion =
    rawVersion && rawVersion.toLowerCase() !== "latest" ? rawVersion : "";
  modLoader.value = isModded ? serverType : "fabric";
  modLoader.disabled = true;
  modGameVersion.value = normalizedVersion;
  modGameVersion.disabled = true;

  if (!isModded) {
    modSearchInput.disabled = true;
    modSearchBtn.disabled = true;
    modSearchResults.innerHTML = `<div class="list-item">Mods require a Fabric or Forge server.</div>`;
    return;
  }
  if (!normalizedVersion) {
    modSearchInput.disabled = true;
    modSearchBtn.disabled = true;
    modSearchResults.innerHTML = `<div class="list-item">Set a specific server version to filter compatible mods.</div>`;
    return;
  }

  modSearchInput.disabled = false;
  modSearchBtn.disabled = false;
}

function populateConsoleSelect() {
  consoleSelect.innerHTML = "";
  if (!servers.length) {
    const option = document.createElement("option");
    option.textContent = "No servers available";
    option.value = "";
    consoleSelect.appendChild(option);
    return;
  }
  servers.forEach((server) => {
    const option = document.createElement("option");
    option.textContent = `${server.name} (${server.status})`;
    option.value = server.server_id;
    consoleSelect.appendChild(option);
  });
  if (activeServerId) {
    consoleSelect.value = activeServerId;
  }
}

async function loadServers() {
  try {
    servers = await apiRequest("/servers");
    updateCounts();
    renderServers();
    populateConsoleSelect();
    if (!activeServerId && servers.length) {
      setActiveServer(servers[0].server_id);
    } else if (activeServerId) {
      setActiveServer(activeServerId);
    } else {
      syncModFiltersWithServer();
    }
  } catch (err) {
    toast(err.message, "error");
  }
}

function buildCreateEnv() {
  const env = {};
  env.GAMEMODE = document.getElementById("createGamemode").value;
  env.DIFFICULTY = document.getElementById("createDifficulty").value;
  env.PVP = document.getElementById("createPvp").checked ? "TRUE" : "FALSE";
  env.HARDCORE = document.getElementById("createHardcore").checked ? "TRUE" : "FALSE";
  env.ALLOW_NETHER = document.getElementById("createAllowNether").checked ? "TRUE" : "FALSE";
  env.ALLOW_END = document.getElementById("createAllowEnd").checked ? "TRUE" : "FALSE";
  env.ENABLE_COMMAND_BLOCK = document.getElementById("createCommandBlocks").checked ? "TRUE" : "FALSE";
  env.ONLINE_MODE = document.getElementById("createOnlineMode").checked ? "TRUE" : "FALSE";
  env.WHITELIST = document.getElementById("createWhitelist").checked ? "TRUE" : "FALSE";
  env.ALLOW_FLIGHT = document.getElementById("createAllowFlight").checked ? "TRUE" : "FALSE";
  env.SPAWN_ANIMALS = document.getElementById("createSpawnAnimals").checked ? "TRUE" : "FALSE";
  env.SPAWN_MONSTERS = document.getElementById("createSpawnMonsters").checked ? "TRUE" : "FALSE";
  env.SPAWN_NPCS = document.getElementById("createSpawnNpcs").checked ? "TRUE" : "FALSE";
  env.BROADCAST_CONSOLE_TO_OPS = document.getElementById("createBroadcastConsole").checked ? "TRUE" : "FALSE";
  env.BROADCAST_RCON_TO_OPS = document.getElementById("createBroadcastRcon").checked ? "TRUE" : "FALSE";
  env.ENABLE_QUERY = document.getElementById("createEnableQuery").value === "true" ? "TRUE" : "FALSE";

  env.MAX_PLAYERS = String(document.getElementById("createMaxPlayers").value);
  env.OP_PERMISSION_LEVEL = String(document.getElementById("createOpPermissionLevel").value);
  env.PLAYER_IDLE_TIMEOUT = String(document.getElementById("createIdleTimeout").value);
  env.VIEW_DISTANCE = String(document.getElementById("createViewDistance").value);
  env.SIMULATION_DISTANCE = String(document.getElementById("createSimulationDistance").value);
  env.MAX_TICK_TIME = String(document.getElementById("createMaxTickTime").value);
  env.ENTITY_BROADCAST_RANGE_PERCENTAGE = String(document.getElementById("createEntityBroadcastRange").value);
  env.SPAWN_PROTECTION = String(document.getElementById("createSpawnProtection").value);

  const motd = document.getElementById("createMotd").value.trim();
  const levelSeed = document.getElementById("createLevelSeed").value.trim();
  const levelType = document.getElementById("createLevelType").value.trim();
  const serverIp = document.getElementById("createServerIp").value.trim();
  const resourcePack = document.getElementById("createResourcePack").value.trim();
  const resourcePackSha1 = document.getElementById("createResourcePackSha1").value.trim();
  const queryPort = document.getElementById("createQueryPort").value.trim();

  if (motd) env.MOTD = motd;
  if (levelSeed) env.LEVEL_SEED = levelSeed;
  if (levelType) env.LEVEL_TYPE = levelType;
  if (serverIp) env.SERVER_IP = serverIp;
  if (resourcePack) env.RESOURCE_PACK = resourcePack;
  if (resourcePackSha1) env.RESOURCE_PACK_SHA1 = resourcePackSha1;
  if (document.getElementById("createEnableQuery").value === "true" && queryPort) {
    env.QUERY_PORT = queryPort;
  }

  return env;
}

async function createServer(event) {
  event.preventDefault();
  const name = document.getElementById("createName").value.trim();
  const version = document.getElementById("createVersion").value.trim();
  const serverType = document.getElementById("createType").value;
  const memory = parseInt(document.getElementById("createMemory").value, 10);
  const portValue = document.getElementById("createPort").value.trim();
  const eula = document.getElementById("createEula").checked;
  const rconPassword = document.getElementById("createRconPassword").value.trim();
  const enableRcon = document.getElementById("createEnableRcon").checked;

  if (!eula) {
    toast("EULA must be accepted", "error");
    return;
  }

  const payload = {
    name,
    memory_mb: memory,
    server_type: serverType,
    env: buildCreateEnv(),
    eula,
    enable_rcon: enableRcon,
  };

  if (version) payload.version = version;
  if (portValue) payload.port = parseInt(portValue, 10);
  if (rconPassword) payload.rcon_password = rconPassword;

  try {
    await apiRequest("/servers", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    toast("Server created", "success");
    createForm.reset();
    createMemory.value = "2048";
    createMemoryValue.textContent = "2048 MB";
    await loadServers();
    showView("view-servers");
  } catch (err) {
    toast(err.message, "error");
  }
}

function applySettingsDefaults() {
  settingsGamemode.value = "survival";
  settingsDifficulty.value = "normal";
  settingsPvp.checked = true;
  settingsHardcore.checked = false;
  settingsAllowNether.checked = true;
  settingsAllowEnd.checked = true;
  settingsCommandBlocks.checked = false;
  settingsLevelSeed.value = "";
  settingsLevelType.value = "";
  settingsSpawnProtection.value = "16";
  settingsSpawnAnimals.checked = true;
  settingsSpawnMonsters.checked = true;
  settingsSpawnNpcs.checked = true;
  settingsMaxPlayers.value = "20";
  settingsOpPermissionLevel.value = "4";
  settingsPlayerIdleTimeout.value = "0";
  settingsOnlineMode.checked = true;
  settingsWhitelist.checked = false;
  settingsViewDistance.value = "10";
  settingsSimulationDistance.value = "10";
  settingsMaxTickTime.value = "60000";
  settingsEntityBroadcastRange.value = "100";
  settingsServerPort.value = "";
  settingsServerIp.value = "";
  settingsEnableQuery.value = "false";
  settingsQueryPort.value = "25565";
  settingsMotd.value = "";
  settingsAllowFlight.checked = false;
  settingsBroadcastConsoleToOps.checked = true;
  settingsBroadcastRconToOps.checked = true;
  settingsResourcePack.value = "";
  settingsResourcePackSha1.value = "";
}

async function loadSettings() {
  if (!activeServerId) return;
  applySettingsDefaults();
  try {
    const response = await apiRequest(`/servers/${activeServerId}/settings`);
    const settings = response.settings || {};
    if (settings.gamemode) settingsGamemode.value = settings.gamemode;
    if (settings.difficulty) settingsDifficulty.value = settings.difficulty;
    if (settings.pvp !== undefined) settingsPvp.checked = settings.pvp;
    if (settings.hardcore !== undefined) settingsHardcore.checked = settings.hardcore;
    if (settings.allow_nether !== undefined) settingsAllowNether.checked = settings.allow_nether;
    if (settings.allow_end !== undefined) settingsAllowEnd.checked = settings.allow_end;
    if (settings.enable_command_block !== undefined) settingsCommandBlocks.checked = settings.enable_command_block;
    if (settings.level_seed !== undefined) settingsLevelSeed.value = settings.level_seed || "";
    if (settings.level_type !== undefined) settingsLevelType.value = settings.level_type || "";
    if (settings.spawn_protection !== undefined) settingsSpawnProtection.value = settings.spawn_protection ?? "";
    if (settings.spawn_animals !== undefined) settingsSpawnAnimals.checked = settings.spawn_animals;
    if (settings.spawn_monsters !== undefined) settingsSpawnMonsters.checked = settings.spawn_monsters;
    if (settings.spawn_npcs !== undefined) settingsSpawnNpcs.checked = settings.spawn_npcs;
    if (settings.max_players !== undefined) settingsMaxPlayers.value = settings.max_players ?? "";
    if (settings.op_permission_level !== undefined) settingsOpPermissionLevel.value = settings.op_permission_level ?? "";
    if (settings.player_idle_timeout !== undefined) settingsPlayerIdleTimeout.value = settings.player_idle_timeout ?? "";
    if (settings.online_mode !== undefined) settingsOnlineMode.checked = settings.online_mode;
    if (settings.whitelist !== undefined) settingsWhitelist.checked = settings.whitelist;
    if (settings.view_distance !== undefined) settingsViewDistance.value = settings.view_distance ?? "";
    if (settings.simulation_distance !== undefined) settingsSimulationDistance.value = settings.simulation_distance ?? "";
    if (settings.max_tick_time !== undefined) settingsMaxTickTime.value = settings.max_tick_time ?? "";
    if (settings.entity_broadcast_range_percentage !== undefined) settingsEntityBroadcastRange.value = settings.entity_broadcast_range_percentage ?? "";
    if (settings.server_port !== undefined && settings.server_port !== null) {
      settingsServerPort.value = settings.server_port;
    } else {
      const server = servers.find((item) => item.server_id === activeServerId);
      if (server && server.port) settingsServerPort.value = server.port;
    }
    if (settings.server_ip !== undefined) settingsServerIp.value = settings.server_ip || "";
    if (settings.motd !== undefined) settingsMotd.value = settings.motd || "";
    if (settings.enable_query !== undefined) settingsEnableQuery.value = settings.enable_query ? "true" : "false";
    if (settings.query_port !== undefined) settingsQueryPort.value = settings.query_port ?? "";
    if (settings.allow_flight !== undefined) settingsAllowFlight.checked = settings.allow_flight;
    if (settings.broadcast_console_to_ops !== undefined) settingsBroadcastConsoleToOps.checked = settings.broadcast_console_to_ops;
    if (settings.broadcast_rcon_to_ops !== undefined) settingsBroadcastRconToOps.checked = settings.broadcast_rcon_to_ops;
    if (settings.resource_pack !== undefined) settingsResourcePack.value = settings.resource_pack || "";
    if (settings.resource_pack_sha1 !== undefined) settingsResourcePackSha1.value = settings.resource_pack_sha1 || "";
  } catch (err) {
    toast(err.message, "error");
  }
}

function collectSettingsPayload() {
  const payload = {
    gamemode: settingsGamemode.value,
    difficulty: settingsDifficulty.value,
    pvp: settingsPvp.checked,
    hardcore: settingsHardcore.checked,
    allow_nether: settingsAllowNether.checked,
    allow_end: settingsAllowEnd.checked,
    enable_command_block: settingsCommandBlocks.checked,
    level_seed: settingsLevelSeed.value.trim(),
    level_type: settingsLevelType.value.trim(),
    spawn_animals: settingsSpawnAnimals.checked,
    spawn_monsters: settingsSpawnMonsters.checked,
    spawn_npcs: settingsSpawnNpcs.checked,
    online_mode: settingsOnlineMode.checked,
    whitelist: settingsWhitelist.checked,
    allow_flight: settingsAllowFlight.checked,
    broadcast_console_to_ops: settingsBroadcastConsoleToOps.checked,
    broadcast_rcon_to_ops: settingsBroadcastRconToOps.checked,
    enable_query: settingsEnableQuery.value === "true",
    server_ip: settingsServerIp.value.trim(),
    motd: settingsMotd.value.trim(),
    resource_pack: settingsResourcePack.value.trim(),
    resource_pack_sha1: settingsResourcePackSha1.value.trim(),
  };

  if (settingsMaxPlayers.value !== "") payload.max_players = parseInt(settingsMaxPlayers.value, 10);
  if (settingsOpPermissionLevel.value !== "") payload.op_permission_level = parseInt(settingsOpPermissionLevel.value, 10);
  if (settingsPlayerIdleTimeout.value !== "") payload.player_idle_timeout = parseInt(settingsPlayerIdleTimeout.value, 10);
  if (settingsViewDistance.value !== "") payload.view_distance = parseInt(settingsViewDistance.value, 10);
  if (settingsSimulationDistance.value !== "") payload.simulation_distance = parseInt(settingsSimulationDistance.value, 10);
  if (settingsMaxTickTime.value !== "") payload.max_tick_time = parseInt(settingsMaxTickTime.value, 10);
  if (settingsEntityBroadcastRange.value !== "") payload.entity_broadcast_range_percentage = parseInt(settingsEntityBroadcastRange.value, 10);
  if (settingsSpawnProtection.value !== "") payload.spawn_protection = parseInt(settingsSpawnProtection.value, 10);
  if (settingsServerPort.value !== "") payload.server_port = parseInt(settingsServerPort.value, 10);
  if (settingsEnableQuery.value === "true" && settingsQueryPort.value !== "") {
    payload.query_port = parseInt(settingsQueryPort.value, 10);
  }

  return payload;
}

async function saveSettings(event) {
  event.preventDefault();
  if (!activeServerId) {
    toast("Select a server first", "error");
    return;
  }
  const payload = collectSettingsPayload();
  try {
    await apiRequest(`/servers/${activeServerId}/settings?restart=${settingsRestart.checked}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
    toast("Settings saved", "success");
    await loadServers();
    await loadSettings();
  } catch (err) {
    toast(err.message, "error");
  }
}

async function loadWhitelist() {
  if (!activeServerId) return;
  try {
    const response = await apiRequest(`/servers/${activeServerId}/whitelist`);
    renderWhitelist(response.names || []);
  } catch (err) {
    renderWhitelist([]);
  }
}

function renderWhitelist(names) {
  whitelistList.innerHTML = "";
  if (!names.length) {
    const empty = document.createElement("div");
    empty.className = "list-item";
    empty.textContent = "No whitelisted players";
    whitelistList.appendChild(empty);
    return;
  }
  names.forEach((name) => {
    const item = document.createElement("div");
    item.className = "list-item";
    item.innerHTML = `<span>${name}</span><button class="btn small" data-name="${name}">Remove</button>`;
    whitelistList.appendChild(item);
  });
}

async function addWhitelist() {
  const name = whitelistName.value.trim();
  if (!name) {
    toast("Enter a player name", "error");
    return;
  }
  if (!activeServerId) {
    toast("Select a server first", "error");
    return;
  }
  try {
    const response = await apiRequest(`/servers/${activeServerId}/whitelist`, {
      method: "POST",
      body: JSON.stringify({ name, action: "add" }),
    });
    whitelistName.value = "";
    renderWhitelist(response.names || []);
    toast("Player added to whitelist", "success");
  } catch (err) {
    toast(err.message, "error");
  }
}

async function removeWhitelist(name) {
  if (!activeServerId) return;
  try {
    const response = await apiRequest(`/servers/${activeServerId}/whitelist`, {
      method: "POST",
      body: JSON.stringify({ name, action: "remove" }),
    });
    renderWhitelist(response.names || []);
    toast("Player removed", "success");
  } catch (err) {
    toast(err.message, "error");
  }
}

async function deleteServer() {
  if (!activeServerId) {
    toast("Select a server first", "error");
    return;
  }
  if (!deleteConfirm.checked) {
    toast("Confirm deletion first", "error");
    return;
  }
  const retain = deleteKeepData.checked ? "true" : "false";
  try {
    await apiRequest(`/servers/${activeServerId}?retain_data=${retain}`, { method: "DELETE" });
    toast("Server deleted", "success");
    activeServerId = null;
    deleteConfirm.checked = false;
    await loadServers();
  } catch (err) {
    toast(err.message, "error");
  }
}

async function loadMods() {
  if (!activeServerId) {
    installedMods.innerHTML = "";
    return;
  }
  try {
    const response = await apiRequest(`/servers/${activeServerId}/mods`);
    renderInstalledMods(response.mods || []);
  } catch (err) {
    installedMods.innerHTML = "";
  }
}

function renderInstalledMods(mods) {
  installedMods.innerHTML = "";
  if (!mods.length) {
    const empty = document.createElement("div");
    empty.className = "list-item";
    empty.textContent = "No mods installed";
    installedMods.appendChild(empty);
    return;
  }
  mods.forEach((mod) => {
    const item = document.createElement("div");
    item.className = "list-item";
    item.innerHTML = `<div><strong>${mod}</strong><br /><small>Installed</small></div>
      <button class="btn small" data-action="remove" data-name="${mod}">Remove</button>`;
    installedMods.appendChild(item);
  });
}

function getModContext() {
  const server = getActiveServer();
  if (!server) {
    return { error: "Select a server first" };
  }
  const serverType = (server.server_type || "").toLowerCase();
  const loader = serverType === "fabric" || serverType === "forge" ? serverType : null;
  const rawVersion = (server.version || "").trim();
  const normalizedVersion =
    rawVersion && rawVersion.toLowerCase() !== "latest" ? rawVersion : "";
  return {
    server,
    loader,
    version: normalizedVersion,
    isModded: !!loader,
  };
}

function getModCacheKey(projectId, loader, gameVersion) {
  const versionKey = gameVersion || "any";
  const loaderKey = loader || "any";
  return `${projectId}::${loaderKey}::${versionKey}`;
}

async function fetchModVersions(projectId, loader, gameVersion) {
  const cacheKey = getModCacheKey(projectId, loader, gameVersion);
  if (modVersionCache[cacheKey]) {
    return modVersionCache[cacheKey];
  }
  const params = new URLSearchParams();
  if (loader) params.set("loader", loader);
  if (gameVersion) params.set("game_version", gameVersion);
  const response = await apiRequest(`/mods/${projectId}/versions?${params.toString()}`);
  const versions = response.versions || [];
  modVersionCache[cacheKey] = versions;
  return versions;
}

function markModChecking(item, selectEl) {
  item.classList.remove("disabled");
  selectEl.disabled = true;
  selectEl.innerHTML = `<option value="">Checking compatibility...</option>`;
  item.querySelectorAll("button").forEach((btn) => {
    btn.disabled = true;
  });
}

function setModCompatible(item, selectEl, versions) {
  item.classList.remove("disabled");
  selectEl.disabled = false;
  item.querySelectorAll("button").forEach((btn) => {
    btn.disabled = false;
  });
  populateVersionSelect(selectEl, versions);
}

function setModIncompatible(item, selectEl, message = "No compatible version") {
  item.classList.add("disabled");
  selectEl.disabled = true;
  selectEl.innerHTML = `<option value="">${message}</option>`;
  item.querySelectorAll("button").forEach((btn) => {
    btn.disabled = true;
  });
}

async function searchMods() {
  const query = modSearchInput.value.trim();
  if (!query) {
    toast("Enter a search term", "error");
    return;
  }
  const context = getModContext();
  if (context.error) {
    toast(context.error, "error");
    return;
  }
  if (!context.isModded) {
    toast("Mods require a Fabric or Forge server", "error");
    return;
  }
  if (!context.version) {
    toast("Server version not set. Create the server with a specific version to filter mods.", "error");
    return;
  }
  modSearchResults.innerHTML = "";
  try {
    const params = new URLSearchParams({
      query,
      loader: context.loader,
      limit: "12",
    });
    const token = ++modSearchToken;
    const response = await apiRequest(`/mods/search?${params.toString()}`);
    renderModResults(response.results || [], context, token);
  } catch (err) {
    toast(err.message, "error");
  }
}

function renderModResults(results, context, token) {
  modSearchResults.innerHTML = "";
  if (!results.length) {
    const empty = document.createElement("div");
    empty.className = "list-item";
    empty.textContent = "No results found";
    modSearchResults.appendChild(empty);
    return;
  }
  const items = [];
  results.forEach((mod) => {
    const item = document.createElement("div");
    item.className = "list-item";
    item.dataset.projectId = mod.project_id;
    item.innerHTML = `
      <div>
        <strong>${mod.title}</strong>
        <div class="server-meta">${mod.description || ""}</div>
      </div>
      <div class="inline-input">
        <button class="btn small" data-action="versions">Versions</button>
        <select class="version-select"><option value="">Latest (auto)</option></select>
        <button class="btn small primary" data-action="install">Install</button>
      </div>
    `;
    modSearchResults.appendChild(item);
    const selectEl = item.querySelector(".version-select");
    markModChecking(item, selectEl);
    items.push(item);
  });
  applyModCompatibility(items, context, token);
}

async function applyModCompatibility(items, context, token) {
  const loader = context.loader;
  const gameVersion = context.version;
  await Promise.allSettled(
    items.map(async (item) => {
      const projectId = item.dataset.projectId;
      const selectEl = item.querySelector(".version-select");
      try {
        const versions = await fetchModVersions(projectId, loader, gameVersion);
        if (token !== modSearchToken) return;
        if (!versions.length) {
          setModIncompatible(item, selectEl);
        } else {
          setModCompatible(item, selectEl, versions);
        }
      } catch (err) {
        if (token !== modSearchToken) return;
        setModIncompatible(item, selectEl, "Error loading versions");
      }
    })
  );
}

async function loadModVersions(projectId, selectEl, context) {
  const versions = await fetchModVersions(projectId, context.loader, context.version);
  populateVersionSelect(selectEl, versions);
}

function populateVersionSelect(selectEl, versions) {
  selectEl.innerHTML = "";
  if (!versions.length) {
    const option = document.createElement("option");
    option.textContent = "No compatible versions";
    option.value = "";
    selectEl.appendChild(option);
    return;
  }
  const latest = document.createElement("option");
  latest.value = "";
  latest.textContent = "Latest (auto)";
  selectEl.appendChild(latest);
  versions.forEach((version) => {
    const option = document.createElement("option");
    option.value = version.id;
    option.textContent = `${version.name} (${version.version_number})`;
    selectEl.appendChild(option);
  });
}

async function installMod(projectId, versionId) {
  if (!activeServerId) {
    toast("Select a server first", "error");
    return;
  }
  const context = getModContext();
  if (context.error) {
    toast(context.error, "error");
    return;
  }
  if (!context.isModded) {
    toast("Mods require a Fabric or Forge server", "error");
    return;
  }
  if (!context.version) {
    toast("Server version not set. Create the server with a specific version to install mods.", "error");
    return;
  }
  const restart = modRestart.value === "true";
  const payload = {
    project_id: projectId,
    version_id: versionId || null,
    loader: context.loader,
    game_version: context.version || null,
  };
  try {
    await apiRequest(`/servers/${activeServerId}/mods?restart=${restart}`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    toast("Mod installed", "success");
    await loadMods();
  } catch (err) {
    toast(err.message, "error");
  }
}

async function removeMod(filename) {
  if (!activeServerId) return;
  const restart = modRestart.value === "true";
  try {
    await apiRequest(`/servers/${activeServerId}/mods/${encodeURIComponent(filename)}?restart=${restart}`, {
      method: "DELETE",
    });
    toast("Mod removed", "success");
    await loadMods();
  } catch (err) {
    toast(err.message, "error");
  }
}

async function sendServerAction(action) {
  if (!activeServerId) {
    toast("Select a server first", "error");
    return;
  }
  try {
    await apiRequest(`/servers/${activeServerId}/${action}`, { method: "POST" });
    toast(`${action} requested`, "success");
    await loadServers();
  } catch (err) {
    toast(err.message, "error");
  }
}

async function fetchLogs() {
  const serverId = consoleSelect.value;
  if (!serverId) {
    toast("Select a server first", "error");
    return;
  }
  try {
    const logs = await apiRequest(`/servers/${serverId}/logs?tail=200`);
    resetLogBuffer(logs || "(no logs yet)");
  } catch (err) {
    toast(err.message, "error");
  }
}

async function sendCommand() {
  const serverId = consoleSelect.value;
  const command = commandInput.value.trim();
  if (!serverId) {
    toast("Select a server first", "error");
    return;
  }
  if (!command) {
    toast("Command cannot be blank", "error");
    return;
  }
  try {
    const response = await apiRequest(`/servers/${serverId}/command`, {
      method: "POST",
      body: JSON.stringify({ command }),
    });
    logOutput.textContent = response.output || "Command sent";
    commandInput.value = "";
  } catch (err) {
    toast(err.message, "error");
  }
}

function bindEvents() {
  navItems.forEach((item) => {
    item.addEventListener("click", () => {
      showView(item.dataset.view);
      if (item.dataset.view === "view-users") {
        loadUsers();
      }
    });
  });

  themeBtn.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme");
    setTheme(current === "dark" ? "light" : "dark");
  });

  if (logoutBtn) {
    logoutBtn.addEventListener("click", logout);
  }

  refreshBtn.addEventListener("click", loadServers);
  newServerBtn.addEventListener("click", () => showView("view-create"));
  startBtn.addEventListener("click", () => sendServerAction("start"));
  stopBtn.addEventListener("click", () => sendServerAction("stop"));
  restartBtn.addEventListener("click", () => sendServerAction("restart"));

  serverListEl.addEventListener("click", (event) => {
    const action = event.target.dataset.action;
    const serverId = event.target.dataset.id;
    if (!serverId) return;
    if (action === "select") {
      setActiveServer(serverId);
      return;
    }
    if (action === "edit") {
      setActiveServer(serverId);
      showView("view-settings");
      return;
    }
  });

  createMemory.addEventListener("input", () => {
    createMemoryValue.textContent = `${createMemory.value} MB`;
  });

  createForm.addEventListener("submit", createServer);
  settingsForm.addEventListener("submit", saveSettings);
  whitelistAddBtn.addEventListener("click", addWhitelist);
  whitelistName.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addWhitelist();
    }
  });
  whitelistList.addEventListener("click", (event) => {
    const name = event.target.dataset.name;
    if (name) removeWhitelist(name);
  });

  deleteServerBtn.addEventListener("click", deleteServer);

  modLoader.addEventListener("change", () => {
    modVersionCache = {};
  });
  modGameVersion.addEventListener("input", () => {
    modVersionCache = {};
  });
  modSearchBtn.addEventListener("click", searchMods);
  modSearchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      searchMods();
    }
  });
  modSearchResults.addEventListener("click", async (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    const item = button.closest(".list-item");
    if (!item) return;
    if (item.classList.contains("disabled")) return;
    const projectId = item.dataset.projectId;
    const selectEl = item.querySelector(".version-select");
    const action = button.dataset.action;
    const context = getModContext();
    if (context.error) {
      toast(context.error, "error");
      return;
    }
    if (!context.isModded) {
      toast("Mods require a Fabric or Forge server", "error");
      return;
    }
    if (!context.version) {
      toast("Server version not set. Create the server with a specific version to install mods.", "error");
      return;
    }
    if (action === "versions") {
      try {
        await loadModVersions(projectId, selectEl, context);
      } catch (err) {
        toast(err.message, "error");
      }
    }
    if (action === "install") {
      const versionId = selectEl.value || null;
      await installMod(projectId, versionId);
    }
  });

  installedMods.addEventListener("click", (event) => {
    const action = event.target.dataset.action;
    const name = event.target.dataset.name;
    if (action === "remove" && name) {
      removeMod(name);
    }
  });

  fetchLogsBtn.addEventListener("click", fetchLogs);
  liveLogsBtn.addEventListener("click", () => {
    if (liveLogsActive) {
      stopLiveLogs();
    } else {
      startLiveLogs();
    }
  });
  consoleSelect.addEventListener("change", () => {
    if (liveLogsActive) {
      startLiveLogs();
    }
  });
  clearLogsBtn.addEventListener("click", () => {
    resetLogBuffer("Logs cleared.");
  });
  sendCommandBtn.addEventListener("click", sendCommand);
  commandInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      sendCommand();
    }
  });

  if (userCreateForm) {
    userCreateForm.addEventListener("submit", createUser);
  }
}

function bindTabGroups() {
  bindTabs("view-create");
  bindTabs("view-settings");
}

function setupTheme() {
  const saved = localStorage.getItem("tc-theme");
  setTheme(saved || "dark");
}

function getSettingsInputs() {
  return {
    settingsGamemode: document.getElementById("settingsGamemode"),
    settingsDifficulty: document.getElementById("settingsDifficulty"),
    settingsPvp: document.getElementById("settingsPvp"),
    settingsHardcore: document.getElementById("settingsHardcore"),
    settingsAllowNether: document.getElementById("settingsAllowNether"),
    settingsAllowEnd: document.getElementById("settingsAllowEnd"),
    settingsCommandBlocks: document.getElementById("settingsCommandBlocks"),
    settingsLevelSeed: document.getElementById("settingsLevelSeed"),
    settingsLevelType: document.getElementById("settingsLevelType"),
    settingsSpawnProtection: document.getElementById("settingsSpawnProtection"),
    settingsSpawnAnimals: document.getElementById("settingsSpawnAnimals"),
    settingsSpawnMonsters: document.getElementById("settingsSpawnMonsters"),
    settingsSpawnNpcs: document.getElementById("settingsSpawnNpcs"),
    settingsMaxPlayers: document.getElementById("settingsMaxPlayers"),
    settingsOpPermissionLevel: document.getElementById("settingsOpPermissionLevel"),
    settingsPlayerIdleTimeout: document.getElementById("settingsPlayerIdleTimeout"),
    settingsOnlineMode: document.getElementById("settingsOnlineMode"),
    settingsWhitelist: document.getElementById("settingsWhitelist"),
    settingsViewDistance: document.getElementById("settingsViewDistance"),
    settingsSimulationDistance: document.getElementById("settingsSimulationDistance"),
    settingsMaxTickTime: document.getElementById("settingsMaxTickTime"),
    settingsEntityBroadcastRange: document.getElementById("settingsEntityBroadcastRange"),
    settingsServerPort: document.getElementById("settingsServerPort"),
    settingsServerIp: document.getElementById("settingsServerIp"),
    settingsEnableQuery: document.getElementById("settingsEnableQuery"),
    settingsQueryPort: document.getElementById("settingsQueryPort"),
    settingsMotd: document.getElementById("settingsMotd"),
    settingsAllowFlight: document.getElementById("settingsAllowFlight"),
    settingsBroadcastConsoleToOps: document.getElementById("settingsBroadcastConsoleToOps"),
    settingsBroadcastRconToOps: document.getElementById("settingsBroadcastRconToOps"),
    settingsResourcePack: document.getElementById("settingsResourcePack"),
    settingsResourcePackSha1: document.getElementById("settingsResourcePackSha1"),
  };
}

const {
  settingsGamemode,
  settingsDifficulty,
  settingsPvp,
  settingsHardcore,
  settingsAllowNether,
  settingsAllowEnd,
  settingsCommandBlocks,
  settingsLevelSeed,
  settingsLevelType,
  settingsSpawnProtection,
  settingsSpawnAnimals,
  settingsSpawnMonsters,
  settingsSpawnNpcs,
  settingsMaxPlayers,
  settingsOpPermissionLevel,
  settingsPlayerIdleTimeout,
  settingsOnlineMode,
  settingsWhitelist,
  settingsViewDistance,
  settingsSimulationDistance,
  settingsMaxTickTime,
  settingsEntityBroadcastRange,
  settingsServerPort,
  settingsServerIp,
  settingsEnableQuery,
  settingsQueryPort,
  settingsMotd,
  settingsAllowFlight,
  settingsBroadcastConsoleToOps,
  settingsBroadcastRconToOps,
  settingsResourcePack,
  settingsResourcePackSha1,
} = getSettingsInputs();

window.addEventListener("DOMContentLoaded", () => {
  setupTheme();
  bindEvents();
  bindTabGroups();
  applySettingsDefaults();
  updateLiveButton();
  loadCurrentUser().then((authenticated) => {
    if (authenticated) {
      loadServers();
    }
  });
});
