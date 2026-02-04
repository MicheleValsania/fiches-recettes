import type { FicheTechnique } from "../types/fiche";

const API_BASE = "http://localhost:3001/api";

export async function saveFicheToDb(fiche: FicheTechnique) {
  const res = await fetch(`${API_BASE}/fiches`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fiche),
  });
  if (!res.ok) throw new Error("Salvataggio fallito");
}

export async function loadFicheFromDb(id: string): Promise<FicheTechnique> {
  const res = await fetch(`${API_BASE}/fiches/${id}`);
  if (!res.ok) throw new Error("Fiche non trovata");
  return res.json();
}

export type FicheListItem = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export async function listFichesFromDb(): Promise<FicheListItem[]> {
  const res = await fetch(`${API_BASE}/fiches`);
  if (!res.ok) throw new Error("Errore lista fiches");
  return res.json();
}

export async function deleteFicheFromDb(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/fiches/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Errore eliminazione fiche");
}
