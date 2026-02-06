export type Supplier = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

export type SupplierProduct = {
  id: string;
  supplierId: string;
  name: string;
  unitPrice: number | null;
  unit: string | null;
  updatedAt: string;
};

const API_BASE = "http://localhost:3001/api";

export async function listSuppliers(): Promise<Supplier[]> {
  const res = await fetch(`${API_BASE}/suppliers`);
  if (!res.ok) throw new Error("Errore lista fornitori");
  return res.json();
}

export async function upsertSupplier(name: string): Promise<Supplier> {
  const res = await fetch(`${API_BASE}/suppliers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error("Errore salvataggio fornitore");
  return res.json();
}

export async function listSupplierProducts(supplierId: string): Promise<SupplierProduct[]> {
  const res = await fetch(`${API_BASE}/suppliers/${supplierId}/products`);
  if (!res.ok) throw new Error("Errore lista prodotti fornitore");
  return res.json();
}

export async function upsertSupplierProduct(
  supplierId: string,
  name: string,
  unitPrice: number | null,
  unit: string | null
): Promise<SupplierProduct> {
  const res = await fetch(`${API_BASE}/suppliers/${supplierId}/products`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, unitPrice, unit }),
  });
  if (!res.ok) throw new Error("Errore salvataggio prodotto fornitore");
  return res.json();
}

export async function updateSupplierProduct(
  supplierId: string,
  productId: string,
  unitPrice: number | null,
  unit: string | null
): Promise<SupplierProduct> {
  const res = await fetch(`${API_BASE}/suppliers/${supplierId}/products/${productId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ unitPrice, unit }),
  });
  if (!res.ok) throw new Error("Errore aggiornamento prodotto");
  return res.json();
}

export async function renameSupplier(supplierId: string, name: string): Promise<Supplier> {
  const res = await fetch(`${API_BASE}/suppliers/${supplierId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (res.status === 409) throw new Error("Nome fornitore già esistente");
  if (!res.ok) throw new Error("Errore aggiornamento fornitore");
  return res.json();
}

export async function renameSupplierProduct(
  supplierId: string,
  productId: string,
  name: string
): Promise<SupplierProduct> {
  const res = await fetch(`${API_BASE}/suppliers/${supplierId}/products/${productId}/name`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (res.status === 409) throw new Error("Nome prodotto già esistente");
  if (!res.ok) throw new Error("Errore rinomina prodotto");
  return res.json();
}

export async function deleteSupplier(supplierId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/suppliers/${supplierId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Errore eliminazione fornitore");
}

export async function deleteSupplierProduct(supplierId: string, productId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/suppliers/${supplierId}/products/${productId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Errore eliminazione prodotto");
}
