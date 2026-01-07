const navItems = document.querySelectorAll(".nav-item");
const views = document.querySelectorAll(".view");
const navUsers = document.getElementById("navUsers");
const navBranding = document.getElementById("navBranding");
const faviconLink = document.getElementById("faviconLink");
const brandLogo = document.getElementById("brandLogo");
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

const settingsForm = document.getElementById("settingsForm");
const settingsServerBadge = document.getElementById("settingsServerBadge");
const settingsRestart = document.getElementById("settingsRestart");
const deleteKeepData = document.getElementById("deleteKeepData");
const deleteConfirm = document.getElementById("deleteConfirm");
const deleteServerBtn = document.getElementById("deleteServerBtn");

const modConfigFilter = document.getElementById("modConfigFilter");
const modConfigList = document.getElementById("modConfigList");
const modConfigPath = document.getElementById("modConfigPath");
const modConfigRestart = document.getElementById("modConfigRestart");
const modConfigReloadBtn = document.getElementById("modConfigReloadBtn");
const modConfigSaveBtn = document.getElementById("modConfigSaveBtn");
const modConfigEditor = document.getElementById("modConfigEditor");
const modConfigStatus = document.getElementById("modConfigStatus");

const modSearchInput = document.getElementById("modSearchInput");
const modLoader = document.getElementById("modLoader");
const modGameVersion = document.getElementById("modGameVersion");
const modRestart = document.getElementById("modRestart");
const modSearchBtn = document.getElementById("modSearchBtn");
const modSearchResults = document.getElementById("modSearchResults");
const installedMods = document.getElementById("installedMods");

const consoleServerLabel = document.getElementById("consoleServerLabel");
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

const brandingPreview = document.getElementById("brandingPreview");
const brandingFile = document.getElementById("brandingFile");
const brandingUploadBtn = document.getElementById("brandingUploadBtn");
const brandingStatus = document.getElementById("brandingStatus");
const defaultTitle = document.title;

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
let isLoadingServers = false;
const pendingServerActions = {};
let activeViewId = "view-servers";
let activeSettingsTab = "settings-gameplay";
let brandingVersion = "0";

let modConfigFiles = [];
let modConfigSelectedPath = null;
let modConfigLoadedForServerId = null;
let modConfigDirty = false;
let modConfigLoading = false;
let modConfigListMessage = "";

function capitalize(value) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : "";
}

function encodePathSegments(path) {
  return String(path || "")
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function brandingAssetUrl(filename) {
  const suffix = brandingVersion ? `?v=${encodeURIComponent(brandingVersion)}` : "";
  return `/branding/${filename}${suffix}`;
}

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

async function apiUpload(path, formData) {
  const response = await fetch(path, {
    method: "POST",
    body: formData,
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
  return response.json();
}

function applyBrandingAssets() {
  const logoUrl = brandingAssetUrl("logo.png");
  const faviconUrl = brandingAssetUrl("favicon.png");
  if (brandLogo) brandLogo.src = logoUrl;
  if (brandingPreview) brandingPreview.src = logoUrl;
  if (faviconLink) faviconLink.href = faviconUrl;
}

async function loadBrandingVersion() {
  try {
    const response = await apiRequest("/branding/version");
    brandingVersion = String(response.version || "0");
  } catch (err) {
    brandingVersion = "0";
  } finally {
    applyBrandingAssets();
  }
}

function setButtonLoading(button, isLoading, label) {
  if (!button) return;
  if (isLoading) {
    button.dataset.originalText = button.textContent;
    button.textContent = label || "Working…";
    button.disabled = true;
    button.classList.add("loading");
    return;
  }
  const original = button.dataset.originalText;
  if (original) button.textContent = original;
  button.disabled = false;
  button.classList.remove("loading");
}

function setPendingAction(serverId, action) {
  if (!serverId) return;
  pendingServerActions[serverId] = { action, startedAt: Date.now() };
  renderServers();
  updateOverview(getActiveServer());
  updateActionButtons(getActiveServer());
  updateConsoleLabel();
}

function clearPendingAction(serverId) {
  if (!serverId) return;
  delete pendingServerActions[serverId];
  renderServers();
  updateOverview(getActiveServer());
  updateActionButtons(getActiveServer());
  updateConsoleLabel();
}

function getDisplayedServerStatus(server) {
  const pending = pendingServerActions[server.server_id];
  if (!pending) return server.status;
  if (pending.action === "start") return "starting";
  if (pending.action === "stop") return "stopping";
  if (pending.action === "restart") return "restarting";
  if (pending.action === "delete") return "deleting";
  return "working";
}

function showView(viewId) {
  views.forEach((view) => view.classList.remove("active"));
  navItems.forEach((item) => item.classList.remove("active"));
  const view = document.getElementById(viewId);
  if (view) view.classList.add("active");
  const nav = Array.from(navItems).find((item) => item.dataset.view === viewId);
  if (nav) nav.classList.add("active");
  activeViewId = viewId;
  if (viewId === "view-settings") {
    loadSettings();
  }
  if (viewId === "view-mods") {
    syncModFiltersWithServer();
    loadMods();
  }
  if (viewId === "view-console") {
    updateConsoleLabel();
    startLiveLogs();
  } else {
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
  const serverId = activeServerId;
  if (!serverId) {
    resetLogBuffer("Select a server to view logs.\n");
    updateLiveButton();
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
    if (navBranding) navBranding.hidden = true;
    return;
  }
  userNameEl.textContent = currentUser.username;
  userRoleEl.textContent = currentUser.role;
  if (navUsers) {
    navUsers.hidden = currentUser.role !== "owner";
  }
  if (navBranding) {
    navBranding.hidden = currentUser.role !== "owner";
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

async function uploadBrandingLogo() {
  if (!currentUser || currentUser.role !== "owner") {
    toast("Owner access required", "error");
    return;
  }
  if (!brandingFile || !brandingFile.files || !brandingFile.files.length) {
    toast("Select an image to upload", "error");
    return;
  }
  const file = brandingFile.files[0];
  const formData = new FormData();
  formData.append("file", file);

  if (brandingStatus) brandingStatus.textContent = "Uploading…";
  if (brandingUploadBtn) setButtonLoading(brandingUploadBtn, true, "Uploading…");
  try {
    const response = await apiUpload("/branding/logo", formData);
    brandingVersion = String(response.version || brandingVersion || "0");
    applyBrandingAssets();
    renderServers();
    toast("Logo updated", "success");
    if (brandingStatus) {
      const count = typeof response.servers_updated === "number" ? response.servers_updated : null;
      brandingStatus.textContent =
        count === null ? "Updated." : `Updated. Server icons refreshed for ${count} server(s).`;
    }
    brandingFile.value = "";
  } catch (err) {
    toast(err.message, "error");
    if (brandingStatus) brandingStatus.textContent = err.message || "Upload failed";
  } finally {
    if (brandingUploadBtn) setButtonLoading(brandingUploadBtn, false);
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
      onTabActivated(scopeId, target);
    });
  });
}

function onTabActivated(scopeId, tabId) {
  if (scopeId !== "view-settings") return;
  activeSettingsTab = tabId;
  if (tabId === "settings-modconfig") {
    loadModConfigFiles();
  }
}

function updateCounts() {
  const running = servers.filter((s) => s.status === "running").length;
  const stopped = servers.length - running;
  countTotal.textContent = `${servers.length} total`;
  countRunning.textContent = `${running} running`;
  countStopped.textContent = `${stopped} stopped`;
}

function updateNavAvailability() {
  const requiresServer = new Set(["view-settings", "view-mods", "view-console"]);
  navItems.forEach((item) => {
    const viewId = item.dataset.view;
    if (!viewId) return;
    if (!requiresServer.has(viewId)) return;
    item.disabled = !activeServerId;
  });
}

function getActiveServer() {
  if (!activeServerId) return null;
  return servers.find((item) => item.server_id === activeServerId) || null;
}

function renderServers() {
  serverListEl.innerHTML = "";
  if (isLoadingServers) {
    emptyStateEl.style.display = "none";
    for (let i = 0; i < 4; i++) {
      const skeleton = document.createElement("div");
      skeleton.className = "server-card skeleton";
      skeleton.innerHTML = `
        <div>
          <div class="skeleton-line title"></div>
          <div class="skeleton-line meta"></div>
          <div class="skeleton-line meta"></div>
        </div>
        <div class="server-actions">
          <div class="skeleton-pill"></div>
          <div class="skeleton-pill"></div>
        </div>
      `;
      serverListEl.appendChild(skeleton);
    }
    return;
  }
  if (!servers.length) {
    emptyStateEl.style.display = "block";
    return;
  }
  emptyStateEl.style.display = "none";

  servers.forEach((server) => {
    const card = document.createElement("div");
    card.className = "server-card";
    card.dataset.id = server.server_id;
    if (server.server_id === activeServerId) {
      card.classList.add("active");
    }
    const displayedStatus = getDisplayedServerStatus(server);
    const status = (displayedStatus || "stopped").toLowerCase();
    const statusClass = status === "running" ? "running" : status === "stopped" ? "stopped" : "pending";
    const portLabel = server.port ? `:${server.port}` : "auto";
    card.innerHTML = `
      <div>
        <div class="server-title-row">
          <img class="server-card-icon" src="${brandingAssetUrl("server-icon.png")}" alt="" />
          <div>
            <h3>${server.name}</h3>
            <div class="status ${statusClass}">
              <span class="status-dot"></span>
              <span>${displayedStatus}</span>
            </div>
          </div>
        </div>
        <div class="server-meta">${server.server_type || "VANILLA"} • ${server.version || "latest"} • ${portLabel}</div>
      </div>
      <div class="server-actions">
        <button class="btn small" data-action="select" data-id="${server.server_id}">Select</button>
      </div>
    `;
    serverListEl.appendChild(card);
  });
}

function setActiveServer(serverId) {
  const previousServerId = activeServerId;
  activeServerId = serverId;
  const server = servers.find((item) => item.server_id === serverId);
  if (!server) {
    try {
      localStorage.removeItem("tc-active-server");
    } catch (err) {
      // ignore
    }
    activeServerName.textContent = "No server selected";
    activeServerMeta.textContent = "Select a server from the list.";
    settingsServerBadge.textContent = "No server";
    document.title = defaultTitle;
    updateOverview(null);
    updateActionButtons(null);
    syncModFiltersWithServer();
    resetModConfigState();
    updateConsoleLabel();
    updateNavAvailability();
    return;
  }
  if (previousServerId && previousServerId !== serverId) {
    resetModConfigState();
  }
  try {
    localStorage.setItem("tc-active-server", serverId);
  } catch (err) {
    // ignore
  }
  activeServerName.textContent = server.name;
  activeServerMeta.textContent = `${server.server_type || "VANILLA"} • ${server.version || "latest"}`;
  settingsServerBadge.textContent = server.name;
  document.title = `${server.name} • ${defaultTitle}`;
  updateOverview(server);
  updateActionButtons(server);
  updateConsoleLabel();
  renderServers();
  syncModFiltersWithServer();
  updateNavAvailability();
  if (activeSettingsTab === "settings-modconfig") {
    loadModConfigFiles();
  }
  if (activeViewId === "view-settings") {
    loadSettings();
  }
  if (activeViewId === "view-mods") {
    loadMods();
  }
  if (activeViewId === "view-console") {
    startLiveLogs();
  }
}

function updateOverview(server) {
  if (!server) {
    overviewStatus.textContent = "-";
    overviewPort.textContent = "-";
    overviewVersion.textContent = "-";
    overviewType.textContent = "-";
    return;
  }
  const displayedStatus = getDisplayedServerStatus(server);
  overviewStatus.textContent = displayedStatus;
  overviewPort.textContent = server.port ? `:${server.port}` : "auto";
  overviewVersion.textContent = server.version || "latest";
  overviewType.textContent = server.server_type || "VANILLA";

  const portLabel = server.port ? `:${server.port}` : "auto";
  activeServerMeta.textContent = `${displayedStatus} • ${server.server_type || "VANILLA"} • ${server.version || "latest"} • ${portLabel}`;
}

function updateConsoleLabel() {
  if (!consoleServerLabel) return;
  const server = getActiveServer();
  if (!server) {
    consoleServerLabel.textContent = "No server selected";
    return;
  }
  const status = getDisplayedServerStatus(server);
  const portLabel = server.port ? `:${server.port}` : "auto";
  consoleServerLabel.textContent = `${server.name} • ${status} • ${portLabel}`;
}

function updateActionButtons(server) {
  if (!server) {
    startBtn.disabled = true;
    stopBtn.disabled = true;
    restartBtn.disabled = true;
    return;
  }
  if (pendingServerActions[server.server_id]) {
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

async function loadServers({ showLoading = true } = {}) {
  if (showLoading) {
    isLoadingServers = true;
    refreshBtn.disabled = true;
    renderServers();
  }
  try {
    servers = await apiRequest("/servers");
    updateCounts();
    renderServers();
    let desiredServerId = activeServerId;
    if (!desiredServerId) {
      try {
        desiredServerId = localStorage.getItem("tc-active-server");
      } catch (err) {
        desiredServerId = null;
      }
    }
    if (desiredServerId && servers.some((s) => s.server_id === desiredServerId)) {
      setActiveServer(desiredServerId);
    } else {
      setActiveServer(null);
    }
  } catch (err) {
    toast(err.message, "error");
  } finally {
    if (showLoading) {
      isLoadingServers = false;
      refreshBtn.disabled = false;
      renderServers();
    }
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
  env.SPAWN_ANIMALS = document.getElementById("createSpawnAnimals").checked ? "TRUE" : "FALSE";
  env.SPAWN_MONSTERS = document.getElementById("createSpawnMonsters").checked ? "TRUE" : "FALSE";
  env.SPAWN_NPCS = document.getElementById("createSpawnNpcs").checked ? "TRUE" : "FALSE";

  env.MAX_PLAYERS = String(document.getElementById("createMaxPlayers").value);
  env.OP_PERMISSION_LEVEL = String(document.getElementById("createOpPermissionLevel").value);
  env.VIEW_DISTANCE = String(document.getElementById("createViewDistance").value);
  env.SIMULATION_DISTANCE = String(document.getElementById("createSimulationDistance").value);
  env.MAX_TICK_TIME = String(document.getElementById("createMaxTickTime").value);
  env.ENTITY_BROADCAST_RANGE_PERCENTAGE = String(document.getElementById("createEntityBroadcastRange").value);
  env.SPAWN_PROTECTION = String(document.getElementById("createSpawnProtection").value);

  const motd = document.getElementById("createMotd").value.trim();
  const levelSeed = document.getElementById("createLevelSeed").value.trim();
  const levelType = document.getElementById("createLevelType").value.trim();

  if (motd) env.MOTD = motd;
  if (levelSeed) env.LEVEL_SEED = levelSeed;
  if (levelType) env.LEVEL_TYPE = levelType;

  return env;
}

async function createServer(event) {
  event.preventDefault();
  const submitBtn = createForm.querySelector('button[type="submit"]');
  setButtonLoading(submitBtn, true, "Creating…");
  const name = document.getElementById("createName").value.trim();
  const version = document.getElementById("createVersion").value.trim();
  const serverType = document.getElementById("createType").value;
  const memoryGb = parseInt(document.getElementById("createMemory").value, 10);
  const memory = Number.isFinite(memoryGb) ? memoryGb * 1024 : 2048;
  const eula = document.getElementById("createEula").checked;

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
    enable_rcon: true,
  };

  if (version) payload.version = version;

  try {
    await apiRequest("/servers", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    toast("Server created", "success");
    createForm.reset();
    createMemory.value = "2";
    await loadServers();
    showView("view-servers");
  } catch (err) {
    toast(err.message, "error");
  } finally {
    setButtonLoading(submitBtn, false);
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
  settingsLevelType.value = "minecraft:normal";
  settingsSpawnProtection.value = "16";
  settingsSpawnAnimals.checked = true;
  settingsSpawnMonsters.checked = true;
  settingsSpawnNpcs.checked = true;
  settingsMaxPlayers.value = "20";
  settingsOpPermissionLevel.value = "4";
  settingsOnlineMode.checked = true;
  settingsViewDistance.value = "32";
  settingsSimulationDistance.value = "10";
  settingsMaxTickTime.value = "60000";
  settingsEntityBroadcastRange.value = "100";
  settingsMotd.value = "";
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
    if (settings.level_type !== undefined) settingsLevelType.value = settings.level_type || "minecraft:normal";
    if (settings.spawn_protection !== undefined) settingsSpawnProtection.value = settings.spawn_protection ?? "";
    if (settings.spawn_animals !== undefined) settingsSpawnAnimals.checked = settings.spawn_animals;
    if (settings.spawn_monsters !== undefined) settingsSpawnMonsters.checked = settings.spawn_monsters;
    if (settings.spawn_npcs !== undefined) settingsSpawnNpcs.checked = settings.spawn_npcs;
    if (settings.max_players !== undefined) settingsMaxPlayers.value = settings.max_players ?? "";
    if (settings.op_permission_level !== undefined) settingsOpPermissionLevel.value = settings.op_permission_level ?? "";
    if (settings.online_mode !== undefined) settingsOnlineMode.checked = settings.online_mode;
    if (settings.view_distance !== undefined) settingsViewDistance.value = settings.view_distance ?? "";
    if (settings.simulation_distance !== undefined) settingsSimulationDistance.value = settings.simulation_distance ?? "";
    if (settings.max_tick_time !== undefined) settingsMaxTickTime.value = settings.max_tick_time ?? "";
    if (settings.entity_broadcast_range_percentage !== undefined) settingsEntityBroadcastRange.value = settings.entity_broadcast_range_percentage ?? "";
    if (settings.motd !== undefined) settingsMotd.value = settings.motd || "";
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
    motd: settingsMotd.value.trim(),
  };

  if (settingsMaxPlayers.value !== "") payload.max_players = parseInt(settingsMaxPlayers.value, 10);
  if (settingsOpPermissionLevel.value !== "") payload.op_permission_level = parseInt(settingsOpPermissionLevel.value, 10);
  if (settingsViewDistance.value !== "") payload.view_distance = parseInt(settingsViewDistance.value, 10);
  if (settingsSimulationDistance.value !== "") payload.simulation_distance = parseInt(settingsSimulationDistance.value, 10);
  if (settingsMaxTickTime.value !== "") payload.max_tick_time = parseInt(settingsMaxTickTime.value, 10);
  if (settingsEntityBroadcastRange.value !== "") payload.entity_broadcast_range_percentage = parseInt(settingsEntityBroadcastRange.value, 10);
  if (settingsSpawnProtection.value !== "") payload.spawn_protection = parseInt(settingsSpawnProtection.value, 10);

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

function resetModConfigState() {
  modConfigFiles = [];
  modConfigSelectedPath = null;
  modConfigLoadedForServerId = null;
  modConfigDirty = false;
  modConfigLoading = false;
  modConfigListMessage = "";
  if (modConfigFilter) modConfigFilter.value = "";
  if (modConfigList) modConfigList.innerHTML = "";
  if (modConfigPath) modConfigPath.textContent = "No file selected";
  if (modConfigEditor) {
    modConfigEditor.value = "";
    modConfigEditor.disabled = true;
  }
  if (modConfigSaveBtn) modConfigSaveBtn.disabled = true;
  if (modConfigReloadBtn) modConfigReloadBtn.disabled = true;
  if (modConfigStatus) modConfigStatus.textContent = "";
}

function setModConfigStatus(message) {
  if (!modConfigStatus) return;
  modConfigStatus.textContent = message || "";
}

function updateModConfigActions() {
  const hasFile = !!modConfigSelectedPath;
  if (modConfigSaveBtn) {
    modConfigSaveBtn.disabled = !hasFile || !modConfigDirty || modConfigLoading;
  }
  if (modConfigReloadBtn) {
    modConfigReloadBtn.disabled = !hasFile || modConfigLoading;
  }
}

function renderModConfigList() {
  if (!modConfigList) return;
  const filter = (modConfigFilter?.value || "").trim().toLowerCase();
  const files = filter
    ? modConfigFiles.filter((file) => file.path.toLowerCase().includes(filter))
    : modConfigFiles;

  modConfigList.innerHTML = "";
  if (!activeServerId) {
    modConfigList.innerHTML = `<div class="list-item">Select a server to view config files.</div>`;
    return;
  }
  if (modConfigListMessage) {
    const item = document.createElement("div");
    item.className = "list-item";
    item.textContent = modConfigListMessage;
    modConfigList.appendChild(item);
    return;
  }
  if (!files.length) {
    modConfigList.innerHTML = `<div class="list-item">No config files found. Start the server once to generate configs.</div>`;
    return;
  }

  files.forEach((file) => {
    const item = document.createElement("div");
    item.className = "list-item";
    item.dataset.path = file.path;
    const selected = file.path === modConfigSelectedPath;
    if (selected) item.classList.add("active");
    const size = typeof file.size_bytes === "number" ? `${Math.round(file.size_bytes / 1024)} KB` : "";
    item.innerHTML = `<div><strong>${file.path}</strong><br /><small>${size}</small></div>
      <button class="btn small" type="button" data-action="open">Open</button>`;
    modConfigList.appendChild(item);
  });
}

async function loadModConfigFiles() {
  if (activeSettingsTab !== "settings-modconfig") return;
  if (!activeServerId) {
    resetModConfigState();
    renderModConfigList();
    return;
  }

  modConfigLoading = true;
  modConfigListMessage = "";
  updateModConfigActions();
  setModConfigStatus("Loading config files…");
  if (modConfigEditor) modConfigEditor.disabled = true;

  try {
    const response = await apiRequest(`/servers/${activeServerId}/mod-settings`);
    modConfigFiles = response.files || [];
    modConfigLoadedForServerId = activeServerId;
    modConfigSelectedPath = null;
    modConfigDirty = false;
    if (modConfigPath) modConfigPath.textContent = "No file selected";
    if (modConfigEditor) modConfigEditor.value = "";
    renderModConfigList();
    setModConfigStatus(modConfigFiles.length ? "" : "No configs yet. Start the server once to generate files.");
  } catch (err) {
    modConfigFiles = [];
    modConfigLoadedForServerId = activeServerId;
    modConfigListMessage = err.message || "Unable to load config files.";
    renderModConfigList();
    setModConfigStatus(modConfigListMessage);
  } finally {
    modConfigLoading = false;
    updateModConfigActions();
  }
}

async function openModConfigFile(path) {
  if (!activeServerId) {
    toast("Select a server first", "error");
    return;
  }
  if (!path) return;
  if (modConfigDirty) {
    const ok = window.confirm("Discard unsaved changes?");
    if (!ok) return;
  }
  modConfigSelectedPath = path;
  modConfigDirty = false;
  if (modConfigPath) modConfigPath.textContent = path;
  if (modConfigEditor) {
    modConfigEditor.disabled = true;
    modConfigEditor.value = "";
  }
  updateModConfigActions();
  setModConfigStatus("Loading file…");
  renderModConfigList();

  try {
    const encodedPath = encodePathSegments(path);
    const response = await apiRequest(`/servers/${activeServerId}/mod-settings/${encodedPath}`);
    if (modConfigEditor) {
      modConfigEditor.value = response.content || "";
      modConfigEditor.disabled = false;
      modConfigEditor.focus();
    }
    setModConfigStatus("");
    updateModConfigActions();
  } catch (err) {
    toast(err.message, "error");
    setModConfigStatus(err.message || "Failed to load file.");
  }
}

async function saveModConfigFile() {
  if (!activeServerId || !modConfigSelectedPath) return;
  if (modConfigLoading) return;
  const content = modConfigEditor?.value ?? "";
  const restart = modConfigRestart?.value === "true";

  modConfigLoading = true;
  updateModConfigActions();
  setModConfigStatus("Saving…");
  if (modConfigSaveBtn) setButtonLoading(modConfigSaveBtn, true, "Saving…");
  if (modConfigEditor) modConfigEditor.disabled = true;

  try {
    const encodedPath = encodePathSegments(modConfigSelectedPath);
    await apiRequest(
      `/servers/${activeServerId}/mod-settings/${encodedPath}?restart=${restart ? "true" : "false"}`,
      {
        method: "PUT",
        body: JSON.stringify({ content }),
      }
    );
    toast("Config saved", "success");
    modConfigDirty = false;
    setModConfigStatus(restart ? "Saved. Restart requested." : "Saved.");
  } catch (err) {
    toast(err.message, "error");
    setModConfigStatus(err.message || "Failed to save file.");
  } finally {
    if (modConfigSaveBtn) setButtonLoading(modConfigSaveBtn, false);
    if (modConfigEditor) modConfigEditor.disabled = false;
    modConfigLoading = false;
    updateModConfigActions();
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
  const deletingServerId = activeServerId;
  const deletedSnapshot = servers.slice();
  setPendingAction(deletingServerId, "delete");
  servers = servers.filter((s) => s.server_id !== deletingServerId);
  if (activeServerId === deletingServerId) {
    activeServerId = null;
  }
  renderServers();
  updateCounts();
  setActiveServer(activeServerId);
  const retain = deleteKeepData.checked ? "true" : "false";
  try {
    await apiRequest(`/servers/${deletingServerId}?retain_data=${retain}`, { method: "DELETE" });
    toast("Server deleted", "success");
    deleteConfirm.checked = false;
  } catch (err) {
    servers = deletedSnapshot;
    toast(err.message, "error");
    await loadServers();
  } finally {
    clearPendingAction(deletingServerId);
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
  const serverId = activeServerId;
  const actionBtn = action === "start" ? startBtn : action === "stop" ? stopBtn : restartBtn;
  setPendingAction(serverId, action);
  setButtonLoading(actionBtn, true, `${capitalize(action)}ing…`);
  try {
    await apiRequest(`/servers/${serverId}/${action}`, { method: "POST" });
    toast(`${capitalize(action)} requested`, "success");
    const deadline = Date.now() + 45000;
    const desired = action === "start" ? "running" : action === "stop" ? "stopped" : null;
    while (Date.now() < deadline) {
      await loadServers({ showLoading: false });
      const current = servers.find((s) => s.server_id === serverId);
      if (!current) break;
      if (desired && current.status === desired) break;
      if (!desired) break;
      await new Promise((resolve) => setTimeout(resolve, 900));
    }
  } catch (err) {
    toast(err.message, "error");
  } finally {
    setButtonLoading(actionBtn, false);
    clearPendingAction(serverId);
  }
}

async function fetchLogs() {
  const serverId = activeServerId;
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
  const serverId = activeServerId;
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
      const viewId = item.dataset.view;
      const requiresServer = viewId === "view-settings" || viewId === "view-mods" || viewId === "view-console";
      if (requiresServer && !activeServerId) {
        toast("Select a server first", "error");
        showView("view-servers");
        return;
      }
      showView(viewId);
      if (viewId === "view-users") {
        loadUsers();
      }
    });
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
    const button = event.target.closest("button");
    if (button && button.dataset.action && button.dataset.id) {
      const action = button.dataset.action;
      const serverId = button.dataset.id;
      if (action === "select") {
        setActiveServer(serverId);
      }
      return;
    }

    const card = event.target.closest(".server-card");
    if (card && card.dataset.id) {
      setActiveServer(card.dataset.id);
    }
  });

  createForm.addEventListener("submit", createServer);
  settingsForm.addEventListener("submit", saveSettings);
  if (modConfigFilter) {
    modConfigFilter.addEventListener("input", () => {
      renderModConfigList();
    });
  }
  if (modConfigList) {
    modConfigList.addEventListener("click", (event) => {
      const item = event.target.closest(".list-item");
      if (!item) return;
      const path = item.dataset.path;
      if (!path) return;
      openModConfigFile(path);
    });
  }
  if (modConfigEditor) {
    modConfigEditor.addEventListener("input", () => {
      if (!modConfigSelectedPath) return;
      modConfigDirty = true;
      updateModConfigActions();
    });
  }
  if (modConfigReloadBtn) {
    modConfigReloadBtn.addEventListener("click", () => {
      if (modConfigSelectedPath) {
        openModConfigFile(modConfigSelectedPath);
      } else {
        loadModConfigFiles();
      }
    });
  }
  if (modConfigSaveBtn) {
    modConfigSaveBtn.addEventListener("click", saveModConfigFile);
  }

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

  if (brandingUploadBtn) {
    brandingUploadBtn.addEventListener("click", uploadBrandingLogo);
  }
  if (brandingFile) {
    brandingFile.addEventListener("change", () => {
      if (!brandingStatus) return;
      brandingStatus.textContent =
        brandingFile.files && brandingFile.files.length ? brandingFile.files[0].name : "";
    });
  }
}

function bindTabGroups() {
  bindTabs("view-create");
  bindTabs("view-settings");
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
    settingsOnlineMode: document.getElementById("settingsOnlineMode"),
    settingsViewDistance: document.getElementById("settingsViewDistance"),
    settingsSimulationDistance: document.getElementById("settingsSimulationDistance"),
    settingsMaxTickTime: document.getElementById("settingsMaxTickTime"),
    settingsEntityBroadcastRange: document.getElementById("settingsEntityBroadcastRange"),
    settingsMotd: document.getElementById("settingsMotd"),
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
  settingsOnlineMode,
  settingsViewDistance,
  settingsSimulationDistance,
  settingsMaxTickTime,
  settingsEntityBroadcastRange,
  settingsMotd,
} = getSettingsInputs();

window.addEventListener("DOMContentLoaded", () => {
  loadBrandingVersion();
  bindEvents();
  bindTabGroups();
  applySettingsDefaults();
  updateLiveButton();
  updateNavAvailability();
  resetModConfigState();
  updateConsoleLabel();
  loadCurrentUser().then((authenticated) => {
    if (authenticated) {
      loadServers();
    }
  });
});
