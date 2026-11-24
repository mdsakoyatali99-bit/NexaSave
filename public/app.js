const $ = (selector) => document.querySelector(selector);
const status = $("#status");
let selectedFile = null;

function setStatus(message, error = false) {
  status.textContent = message;
  status.classList.toggle("error", error);
}

document.querySelectorAll(".tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(item => item.classList.toggle("active", item === tab));
    $("#linkPane").classList.toggle("hidden", tab.dataset.tab !== "link");
    $("#filePane").classList.toggle("hidden", tab.dataset.tab !== "file");
    setStatus("");
  });
});

function isDirectVideoFile(raw) {
  try {
    const url = new URL(raw);
    return ["http:", "https:"].includes(url.protocol) &&
      /\.(mp4|webm|mov|m4v|ogv)$/i.test(url.pathname);
  } catch {
    return false;
  }
}

$("#downloadBtn").addEventListener("click", () => {
  const raw = $("#videoUrl").value.trim();
  if (!raw) return setStatus("Paste a direct video-file URL first.", true);
  if (!isDirectVideoFile(raw)) {
    return setStatus("This is not a recognized direct video-file URL. Platform share links are not supported.", true);
  }
  const anchor = document.createElement("a");
  anchor.href = raw;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  anchor.download = "";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setStatus("Your browser has opened the download request. The source host may control whether it downloads directly.");
});

$("#fileInput").addEventListener("change", event => {
  selectedFile = event.target.files?.[0] || null;
  const info = $("#fileInfo");
  if (!selectedFile) {
    info.classList.add("hidden");
    return;
  }
  info.classList.remove("hidden");
  info.replaceChildren();
  const name = document.createElement("strong");
  name.textContent = selectedFile.name;
  const size = document.createTextNode(` · ${formatBytes(selectedFile.size)} `);
  const button = document.createElement("button");
  button.className = "action";
  button.textContent = "Save file ↓";
  button.style.padding = "8px 12px";
  button.addEventListener("click", saveLocalFile);
  info.append(name, size, button);
  setStatus("Selected file is ready. It stays on your device.");
});

function saveLocalFile() {
  if (!selectedFile) return;
  const objectUrl = URL.createObjectURL(selectedFile);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = selectedFile.name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 2000);
  setStatus("Your browser has started saving the selected video.");
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes, index = -1;
  do { value /= 1024; index++; } while (value >= 1024 && index < units.length - 1);
  return `${value.toFixed(1)} ${units[index]}`;
}

$(".menu").addEventListener("click", () => $("nav").classList.toggle("open"));
$("#year").textContent = new Date().getFullYear();
