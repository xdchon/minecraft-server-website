function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function pickNextBackground(urls, currentUrl) {
  if (!urls.length) return null;
  if (urls.length === 1) return urls[0];
  let candidate = urls[Math.floor(Math.random() * urls.length)];
  let attempts = 0;
  while (candidate === currentUrl && attempts < 6) {
    candidate = urls[Math.floor(Math.random() * urls.length)];
    attempts += 1;
  }
  return candidate;
}

function applyKenBurns(layer, { durationMs }) {
  const fromScale = randomBetween(1.0, 1.03);
  const toScale = clamp(fromScale + randomBetween(0.01, 0.03), 1.02, 1.06);
  const fromX = randomBetween(-2, 2);
  const fromY = randomBetween(-2, 2);
  const toX = clamp(fromX + randomBetween(-3, 3), -4, 4);
  const toY = clamp(fromY + randomBetween(-3, 3), -4, 4);

  layer.style.setProperty("--bg-from-scale", String(fromScale));
  layer.style.setProperty("--bg-to-scale", String(toScale));
  layer.style.setProperty("--bg-from-x", `${fromX}%`);
  layer.style.setProperty("--bg-from-y", `${fromY}%`);
  layer.style.setProperty("--bg-to-x", `${toX}%`);
  layer.style.setProperty("--bg-to-y", `${toY}%`);
  layer.style.setProperty("--bg-duration", `${durationMs}ms`);

  layer.style.animation = "none";
  // Force reflow to restart animation.
  // eslint-disable-next-line no-unused-expressions
  layer.offsetHeight;
  layer.style.animation = "bg-kenburns var(--bg-duration) linear forwards";
}

async function fetchBackgrounds() {
  try {
    const res = await fetch("/theme/backgrounds", { cache: "no-store" });
    if (!res.ok) throw new Error("Failed to load backgrounds");
    const payload = await res.json();
    const urls = Array.isArray(payload.urls) ? payload.urls.filter(Boolean).map(String) : [];
    return urls;
  } catch (err) {
    return [
      "/imgs/background/panorama_0.png",
      "/imgs/background/panorama_1.png",
      "/imgs/background/panorama_2.png",
      "/imgs/background/panorama_3.png",
      "/imgs/background/panorama_4.png",
      "/imgs/background/panorama_5.png",
    ];
  }
}

function setLayerImage(layer, url) {
  layer.style.setProperty("--bg-image", `url("${url}")`);
}

async function initBackgroundRotator() {
  const root = document.getElementById("bg");
  if (!root) return;
  const layerA = root.querySelector(".bg-layer-a");
  const layerB = root.querySelector(".bg-layer-b");
  if (!layerA || !layerB) return;

  root.classList.add("bg-rotator");
  const urls = await fetchBackgrounds();
  if (!urls.length) return;

  const durationMs = 20000;
  const transitionMs = 1400;

  let activeLayer = layerA;
  let inactiveLayer = layerB;
  let currentUrl = null;

  activeLayer.style.opacity = "1";
  inactiveLayer.style.opacity = "0";
  activeLayer.style.transition = `opacity ${transitionMs}ms ease`;
  inactiveLayer.style.transition = `opacity ${transitionMs}ms ease`;

  currentUrl = pickNextBackground(urls, null);
  if (!currentUrl) return;
  setLayerImage(activeLayer, currentUrl);
  applyKenBurns(activeLayer, { durationMs });

  window.setInterval(() => {
    const nextUrl = pickNextBackground(urls, currentUrl);
    if (!nextUrl) return;
    currentUrl = nextUrl;

    setLayerImage(inactiveLayer, nextUrl);
    applyKenBurns(inactiveLayer, { durationMs });

    inactiveLayer.style.opacity = "1";
    activeLayer.style.opacity = "0";

    const prevActive = activeLayer;
    activeLayer = inactiveLayer;
    inactiveLayer = prevActive;
  }, durationMs);
}

document.addEventListener("DOMContentLoaded", initBackgroundRotator);
