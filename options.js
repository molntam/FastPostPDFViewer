import { readPrintRotation, savePrintRotation } from "./print-settings.js";

const rotationSelect = document.getElementById("printRotation");
const status = document.getElementById("settingsStatus");
let savedRotation = 0;

async function loadSettings() {
  try {
    savedRotation = await readPrintRotation();
    rotationSelect.value = String(savedRotation);
    rotationSelect.disabled = false;
    status.textContent = "";
  } catch (error) {
    status.textContent = `Could not load settings: ${error.message}`;
  }
}

rotationSelect.addEventListener("change", async () => {
  rotationSelect.disabled = true;
  status.textContent = "Saving…";
  try {
    const rotation = Number(rotationSelect.value);
    await savePrintRotation(rotation);
    savedRotation = rotation;
    status.textContent = "Saved. Applies to your next print job.";
  } catch (error) {
    rotationSelect.value = String(savedRotation);
    status.textContent = `Could not save settings: ${error.message}`;
  } finally {
    rotationSelect.disabled = false;
  }
});

loadSettings();
