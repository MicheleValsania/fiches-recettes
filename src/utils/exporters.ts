export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = safeFilename(filename);
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadJson(data: unknown, filename = "fiche-technique.json") {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  downloadBlob(blob, filename);
}

export async function readJsonFile<T>(file: File): Promise<T> {
  const text = await file.text();
  return JSON.parse(text) as T;
}

export function safeFilename(name: string) {
  const withoutControlCharacters = Array.from(name.trim(), (character) =>
    character.charCodeAt(0) <= 0x1f ? "_" : character
  ).join("");

  return withoutControlCharacters
    .replace(/[<>:"/\\|?*]/g, "_")
    .replace(/\s+/g, " ")
    .slice(0, 120);
}
