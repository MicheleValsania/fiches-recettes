📄 REPORTS_SPEC_2026.md
🎯 Obiettivo

Introdurre una sezione Reports nell’app Fiches Recettes per generare report operativi stampabili, senza complicare l’editor fiches e senza invadere l’interfaccia principale.

I report devono:

leggere i dati dal JSON delle fiches

utilizzare le categorie normalizzate (aliases)

essere stampabili (A4)

non modificare il flusso di creazione fiche

🧭 Posizionamento UI
Menu principale (livello root)

Aggiungere voce:

Fiches
Produits
Fournisseurs
📊 Reports

Reports è una sezione autonoma.

Non:

dropdown dentro editor

toolbar secondaria

modale temporanea

Separazione mentale chiara:

L’editor serve a scrivere.
Reports serve a analizzare.

🗂 Categorie utilizzate

I reports si basano sugli id normalizzati:

base
base_dessert
sauce
entree
plat_pates
plat_poisson
plat_viande
plat_vegetarien
pizza
dessert
accompagnement
snack_sandwich_froid
snack_sandwich_chaud
snack_wrap_tacos
snack_burger
snack_assiette
snack_salade_bowl
snack_dessert
snack_petit_dejeuner

Se necessario:

in futuro si può aggiungere un campo sector (restaurant / snack)

per ora si può dedurre da prefisso snack_

📊 REPORTS – VERSIONE 2026
1️⃣ Report: Profils de conservation des bases
Filtro:

category = base OR sauce OR base_dessert

Output:

Tabella:

| Base | Temp stockage | DLC | Surgélation | Notes |

Fonte dati:

storage_profiles dentro fiche

label_hints

Uso:

Stampa HACCP

Affissione cucina

Priorità: 🔴 Alta

2️⃣ Report: Index des fiches par catégorie
Output:
🔥 BASES

Jus de viande

Bolognaise

Suprême SV

🍝 PLATS PÂTES

Linguine bolo

Risotto vert

🍔 SNACK BURGER

Cheese Burger

Fish Burger

Usa aliases → id categoria.

Utilità:

onboarding

controllo carta

visione globale

Priorità: 🔴 Alta

3️⃣ Report: Fiches par secteur

Logica:

Tutto ciò che inizia con snack_ → secteur Snack

Il resto → Restaurant

Output:

SNACK

snack_burger

snack_wrap_tacos

snack_salade_bowl

RESTAURANT

entree

plat_viande

plat_poisson

dessert

Priorità: 🟠 Media

4️⃣ Report: Bases utilisées par recette

Logica:

Analizza ingredienti con supplier_name = "Interne"

oppure ingredient_name_raw che matcha titolo fiche category base

Output:

| Recette finale | Base utilisée |

Esempio:
| Linguine alla bolognese | Bolognaise |
| Suprême provençal | Suprême SV |

Utilità:

impatto modifica base

pianificazione produzione

Priorità: 🔴 Molto Alta (gestionale)

5️⃣ Report: Liste produits par secteur

Aggrega:

ingredient_name_raw

group by categoria

Output:

SNACK

Cheddar

Bun brioché

Tenders

Frites

RESTAURANT

Burrata

Gambas

Foie gras

Utilità:

ordini mirati

controllo doppioni

Priorità: 🟠 Media

6️⃣ Report: Allergènes global carte

Legge:

allergens array

Output:

| Plat | Allergènes |

Formato stampabile per controllo.

Priorità: 🟢 Bassa (ma utile audit)

7️⃣ Report: Food cost moyen par catégorie (fase 2)

Richiede:

food_cost già calcolato

Output:

| Catégorie | Food cost moyen |

Visione manageriale.

Priorità: 🟡 Fase successiva

🧩 Architettura tecnica consigliata
Non salvare report nel DB.

Reports devono essere:

generati runtime

puramente derivati dai dati fiches

Zero duplicazione dati.

📐 Struttura codice suggerita
src/
  reports/
    getFichesByCategory.ts
    getBaseStorageProfiles.ts
    getSectorSummary.ts
    getBaseUsageGraph.ts

Ogni report = funzione pura.

UI layer = semplice renderer tabella.

🎨 UX minimalista

Dentro Reports:

Lista semplice:

Profils de conservation des bases
Index fiches par catégorie
Fiches par secteur
Bases utilisées par recette
Liste produits par secteur
Allergènes carte

Click → vista tabellare → bouton “Imprimer PDF”

Niente grafici inutili.
Niente dashboard.
Niente widget.

🔒 Regole di design

Reports non modificano dati

Reports non scrivono nel DB

Reports non duplicano categorie

Tutto deriva dal JSON fiches

🧠 Filosofia

L’editor è lo strumento.
I reports sono lo specchio.

Non devono interferire.