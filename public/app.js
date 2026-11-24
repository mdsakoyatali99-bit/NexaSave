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

async function downloadDirectUrl() {
  const raw = $("#videoUrl").value.trim();
  if (!raw) return setStatus("প্রথমে ভিডিওর সরাসরি লিংক পেস্ট করুন।", true);
  let parsed;
  try { parsed = new URL(raw); } catch { return setStatus("সঠিক ভিডিও URL দিন।", true); }
  if (!["http:", "https:"].includes(parsed.protocol)) return setStatus("শুধু HTTP বা HTTPS লিংক ব্যবহার করুন।", true);

  const button = $("#downloadBtn");
  button.disabled = true;
  button.textContent = "Checking link…";
  setStatus("লিংক পরীক্ষা করা হচ্ছে। ভিডিও ফাইল হলে ডাউনলোড শুরু হবে…");
  try {
    const endpoint = `/api/download?url=${encodeURIComponent(raw)}`;
    const response = await fetch(endpoint, { method: "GET" });
    const contentType = response.headers.get("content-type") || "";
    if (!response.ok || contentType.includes("application/json")) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `Download failed (HTTP ${response.status}).`);
    }
    if (!contentType.toLowerCase().startsWith("video/") && !contentType.toLowerCase().includes("octet-stream")) {
      throw new Error("এই লিংক থেকে ভিডিও ফাইল পাওয়া যায়নি। Direct MP4/WebM/MOV URL দিন।");
    }
    const blob = await response.blob();
    if (!blob.size) throw new Error("ভিডিও ফাইলটি খালি বা পাওয়া যায়নি।");
    const disposition = response.headers.get("content-disposition") || "";
    const match = disposition.match(/filename="([^"]+)"/i);
    const filename = match ? match[1] : "nexasave-video";
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
    setStatus(`ডাউনলোড শুরু হয়েছে: ${filename}`);
  } catch (error) {
    setStatus(error.message || "ডাউনলোড করা যায়নি। লিংকটি পরীক্ষা করুন।", true);
  } finally {
    button.disabled = false;
    button.innerHTML = 'Save video <b>↓</b>';
  }
}
$("#downloadBtn").addEventListener("click", downloadDirectUrl);
$("#videoUrl").addEventListener("keydown", event => {
  if (event.key === "Enter") downloadDirectUrl();
});

$("#fileInput").addEventListener("change", event => {
  selectedFile = event.target.files?.[0] || null;
  const info = $("#fileInfo");
  if (!selectedFile) { info.classList.add("hidden"); return; }
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
  setStatus("ভিডিও প্রস্তুত। ফাইলটি আপনার ডিভাইসেই থাকবে।");
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
  setStatus("আপনার ব্রাউজারে ভিডিও সেভ করা শুরু হয়েছে।");
}
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"]; let value = bytes, index = -1;
  do { value /= 1024; index++; } while (value >= 1024 && index < units.length - 1);
  return `${value.toFixed(1)} ${units[index]}`;
}
$(".menu").addEventListener("click", () => $("nav").classList.toggle("open"));
$("#year").textContent = new Date().getFullYear();
