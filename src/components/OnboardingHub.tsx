import { useEffect, useState } from "react";
import type { Lang } from "../i18n";

export type OnboardingStepId = "create" | "compose" | "suppliers" | "save" | "export";
export type OnboardingState = {
  completedSteps: OnboardingStepId[];
  tourSeen: boolean;
};

type Props = {
  lang: Lang;
  progress: OnboardingState;
  autoStart: boolean;
  onChange: (progress: OnboardingState) => void;
};

type StepCopy = {
  id: OnboardingStepId;
  target: string;
  title: string;
  text: string;
};

type Copy = {
  guide: string;
  checklist: string;
  help: string;
  progress: string;
  startTour: string;
  restartTour: string;
  close: string;
  previous: string;
  next: string;
  finish: string;
  completed: string;
  toDo: string;
  helpTitle: string;
  helpIntro: string;
  guides: Array<{ title: string; text: string }>;
  steps: StepCopy[];
};

const copies: Record<Lang, Copy> = {
  it: {
    guide: "Guida",
    checklist: "Primi passi",
    help: "Centro assistenza",
    progress: "Completato",
    startTour: "Avvia la visita guidata",
    restartTour: "Rivedi la visita",
    close: "Chiudi",
    previous: "Indietro",
    next: "Avanti",
    finish: "Termina",
    completed: "Fatto",
    toDo: "Da fare",
    helpTitle: "Lavorare con le fiches",
    helpIntro: "Guide brevi per ritrovare subito il flusso corretto.",
    guides: [
      { title: "Scheda tecnica", text: "Inserisci titolo, resa, ingredienti, procedure, allergeni e profili HACCP." },
      { title: "Fornitori e prezzi", text: "Crea il fornitore, aggiungi i prodotti e collega il prezzo unitario alla ricetta." },
      { title: "Food cost", text: "Le quantità e le unità determinano il costo totale e il costo per porzione." },
      { title: "Stampa ed export", text: "Controlla l'anteprima, poi stampa oppure genera PDF e JSON." },
    ],
    steps: [
      { id: "create", target: "[data-tour='new-fiche']", title: "Crea una fiche", text: "Questo pulsante apre sempre una scheda vuota. Le fiches salvate restano disponibili nella biblioteca." },
      { id: "compose", target: "[data-tour='fiche-editor']", title: "Componi la ricetta", text: "Compila prima titolo, resa e ingredienti. Aggiungi poi procedure, allergeni e informazioni HACCP." },
      { id: "suppliers", target: "[data-tour='suppliers']", title: "Collega i fornitori", text: "Nel listino fornitori registri codici, unità e prezzi che alimentano automaticamente il food cost." },
      { id: "save", target: "[data-tour='save-fiche']", title: "Salva nel tuo spazio", text: "Il salvataggio scrive la fiche esclusivamente nell'organizzazione con cui hai effettuato l'accesso." },
      { id: "export", target: "[data-tour='export-fiche']", title: "Condividi il risultato", text: "Dall'anteprima puoi stampare la scheda o generare un PDF pronto per la brigata." },
    ],
  },
  fr: {
    guide: "Guide",
    checklist: "Premiers pas",
    help: "Centre d'aide",
    progress: "Terminé",
    startTour: "Démarrer la visite guidée",
    restartTour: "Revoir la visite",
    close: "Fermer",
    previous: "Précédent",
    next: "Suivant",
    finish: "Terminer",
    completed: "Fait",
    toDo: "À faire",
    helpTitle: "Travailler avec les fiches",
    helpIntro: "Des guides courts pour retrouver immédiatement le bon parcours.",
    guides: [
      { title: "Fiche technique", text: "Saisissez titre, rendement, ingrédients, procédures, allergènes et profils HACCP." },
      { title: "Fournisseurs et prix", text: "Créez le fournisseur, ajoutez ses produits et reliez le prix unitaire à la recette." },
      { title: "Food cost", text: "Les quantités et unités déterminent le coût total et le coût par portion." },
      { title: "Impression et export", text: "Contrôlez l'aperçu, puis imprimez ou générez les fichiers PDF et JSON." },
    ],
    steps: [
      { id: "create", target: "[data-tour='new-fiche']", title: "Créer une fiche", text: "Ce bouton ouvre une fiche vide. Les fiches enregistrées restent disponibles dans la bibliothèque." },
      { id: "compose", target: "[data-tour='fiche-editor']", title: "Composer la recette", text: "Commencez par le titre, le rendement et les ingrédients, puis complétez procédures, allergènes et HACCP." },
      { id: "suppliers", target: "[data-tour='suppliers']", title: "Relier les fournisseurs", text: "Le tarif fournisseur centralise codes, unités et prix utilisés automatiquement dans le food cost." },
      { id: "save", target: "[data-tour='save-fiche']", title: "Enregistrer dans votre espace", text: "La fiche est enregistrée uniquement dans l'organisation avec laquelle vous êtes connecté." },
      { id: "export", target: "[data-tour='export-fiche']", title: "Partager le résultat", text: "Depuis l'aperçu, imprimez la fiche ou générez un PDF prêt pour la brigade." },
    ],
  },
  en: {
    guide: "Guide",
    checklist: "First steps",
    help: "Help centre",
    progress: "Completed",
    startTour: "Start guided tour",
    restartTour: "Replay the tour",
    close: "Close",
    previous: "Previous",
    next: "Next",
    finish: "Finish",
    completed: "Done",
    toDo: "To do",
    helpTitle: "Working with recipe sheets",
    helpIntro: "Short guides that bring you back to the right workflow.",
    guides: [
      { title: "Technical sheet", text: "Enter title, yield, ingredients, procedures, allergens and HACCP profiles." },
      { title: "Suppliers and prices", text: "Create a supplier, add products and connect unit pricing to the recipe." },
      { title: "Food cost", text: "Quantities and units determine total cost and cost per portion." },
      { title: "Print and export", text: "Review the preview, then print or generate PDF and JSON files." },
    ],
    steps: [
      { id: "create", target: "[data-tour='new-fiche']", title: "Create a sheet", text: "This button opens a blank sheet. Saved sheets remain available from the library." },
      { id: "compose", target: "[data-tour='fiche-editor']", title: "Compose the recipe", text: "Start with title, yield and ingredients, then add procedures, allergens and HACCP details." },
      { id: "suppliers", target: "[data-tour='suppliers']", title: "Connect suppliers", text: "The supplier catalogue holds codes, units and prices used automatically in food cost." },
      { id: "save", target: "[data-tour='save-fiche']", title: "Save to your workspace", text: "The sheet is stored only inside the organisation you signed into." },
      { id: "export", target: "[data-tour='export-fiche']", title: "Share the result", text: "Use the preview to print the sheet or generate a brigade-ready PDF." },
    ],
  },
};

export default function OnboardingHub({ lang, progress, autoStart, onChange }: Props) {
  const c = copies[lang];
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelTab, setPanelTab] = useState<"checklist" | "help">("checklist");
  const [tourIndex, setTourIndex] = useState<number | null>(() =>
    autoStart && !progress.tourSeen ? 0 : null
  );
  const [spotlight, setSpotlight] = useState<DOMRect | null>(null);
  const completed = new Set(progress.completedSteps);

  useEffect(() => {
    if (tourIndex === null) return;
    const step = c.steps[tourIndex];
    const target = document.querySelector<HTMLElement>(step.target);
    if (!target) {
      const missingTargetTimer = window.setTimeout(() => setSpotlight(null), 0);
      return () => window.clearTimeout(missingTargetTimer);
    }
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    const update = () => setSpotlight(target.getBoundingClientRect());
    const timer = window.setTimeout(update, 280);
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [c.steps, tourIndex]);

  const closeTour = () => {
    setTourIndex(null);
    onChange({ ...progress, tourSeen: true });
  };

  const startTour = (index = 0) => {
    setPanelOpen(false);
    setTourIndex(index);
  };

  const percentage = Math.round((progress.completedSteps.length / c.steps.length) * 100);
  const activeTourIndex = tourIndex ?? 0;
  const step = tourIndex === null ? null : c.steps[activeTourIndex];

  return (
    <>
      <button className="onboarding-launcher no-print" type="button" onClick={() => setPanelOpen(true)}>
        <span>?</span>
        <strong>{c.guide}</strong>
        <small>{progress.completedSteps.length}/{c.steps.length}</small>
      </button>

      {panelOpen ? (
        <div className="onboarding-backdrop no-print" role="presentation" onMouseDown={() => setPanelOpen(false)}>
          <aside className="onboarding-panel" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
            <div className="onboarding-panel-head">
              <div>
                <span>{c.progress}</span>
                <strong>{percentage}%</strong>
              </div>
              <button type="button" onClick={() => setPanelOpen(false)} aria-label={c.close}>×</button>
            </div>
            <div className="onboarding-progress"><span style={{ width: `${percentage}%` }} /></div>
            <div className="onboarding-tabs">
              <button className={panelTab === "checklist" ? "active" : ""} type="button" onClick={() => setPanelTab("checklist")}>{c.checklist}</button>
              <button className={panelTab === "help" ? "active" : ""} type="button" onClick={() => setPanelTab("help")}>{c.help}</button>
            </div>
            {panelTab === "checklist" ? (
              <div className="onboarding-checklist">
                {c.steps.map((item, index) => (
                  <button type="button" key={item.id} onClick={() => startTour(index)}>
                    <span className={completed.has(item.id) ? "done" : ""}>{completed.has(item.id) ? "✓" : index + 1}</span>
                    <div><strong>{item.title}</strong><small>{completed.has(item.id) ? c.completed : c.toDo}</small></div>
                  </button>
                ))}
                <button className="onboarding-tour-button" type="button" onClick={() => startTour()}>
                  {progress.tourSeen ? c.restartTour : c.startTour}
                </button>
              </div>
            ) : (
              <div className="onboarding-help">
                <h2>{c.helpTitle}</h2>
                <p>{c.helpIntro}</p>
                {c.guides.map((guide, index) => (
                  <details key={guide.title} open={index === 0}>
                    <summary>{guide.title}</summary>
                    <p>{guide.text}</p>
                  </details>
                ))}
              </div>
            )}
          </aside>
        </div>
      ) : null}

      {step ? (
        <div className="tour-layer no-print" role="dialog" aria-modal="true">
          {spotlight ? (
            <div
              className="tour-spotlight"
              style={{
                top: Math.max(6, spotlight.top - 7),
                left: Math.max(6, spotlight.left - 7),
                width: Math.min(window.innerWidth - 12, spotlight.width + 14),
                height: spotlight.height + 14,
              }}
            />
          ) : <div className="tour-dim" />}
          <section className="tour-card">
            <div className="tour-counter">{activeTourIndex + 1} / {c.steps.length}</div>
            <h2>{step.title}</h2>
            <p>{step.text}</p>
            <div className="tour-actions">
              <button type="button" onClick={closeTour}>{c.close}</button>
              <div>
                {activeTourIndex > 0 ? <button type="button" onClick={() => setTourIndex(activeTourIndex - 1)}>{c.previous}</button> : null}
                <button className="tour-next" type="button" onClick={() => activeTourIndex === c.steps.length - 1 ? closeTour() : setTourIndex(activeTourIndex + 1)}>
                  {activeTourIndex === c.steps.length - 1 ? c.finish : c.next}
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
