const PRINT_ROTATION_KEY = "printRotationDegrees";

export async function readPrintRotation() {
  const settings = await chrome.storage.local.get(PRINT_ROTATION_KEY);
  return settings[PRINT_ROTATION_KEY] === 180 ? 180 : 0;
}

export async function savePrintRotation(rotation) {
  if (rotation !== 0 && rotation !== 180) {
    throw new RangeError("Print rotation must be 0 or 180 degrees.");
  }
  await chrome.storage.local.set({ [PRINT_ROTATION_KEY]: rotation });
}
