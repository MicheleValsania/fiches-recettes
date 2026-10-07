import { useState, type FormEvent } from "react";
import type { Lang } from "../i18n";
import {
  loginApi,
  loginLegacyApi,
  registerApi,
  type AuthFailureReason,
} from "../utils/apiBase";

type Mode = "landing" | "login" | "register" | "legacy";

type Copy = {
  eyebrow: string;
  title: string;
  intro: string;
  login: string;
  register: string;
  featureLabel: string;
  features: Array<{ number: string; title: string; text: string }>;
  trusted: string;
  loginTitle: string;
  loginText: string;
  registerTitle: string;
  registerText: string;
  legacyTitle: string;
  legacyText: string;
  email: string;
  password: string;
  displayName: string;
  organization: string;
  inviteCode: string;
  submitLogin: string;
  submitRegister: string;
  submitLegacy: string;
  back: string;
  legacyLink: string;
  passwordHint: string;
  checking: string;
  errors: Record<AuthFailureReason, string>;
};

const copy: Record<Lang, Copy> = {
  it: {
    eyebrow: "Operazioni di cucina, finalmente coordinate",
    title: "Dalla ricetta al servizio, senza perdere il filo.",
    intro:
      "Fiches-recettes riunisce schede tecniche, costi, fornitori e procedure in uno spazio operativo costruito per la ristorazione reale.",
    login: "Accedi",
    register: "Crea il tuo spazio",
    featureLabel: "Un metodo unico",
    features: [
      { number: "01", title: "Ricette leggibili", text: "Quantità, procedure e allergeni sempre coerenti." },
      { number: "02", title: "Costi collegati", text: "Listini fornitori e food cost nello stesso flusso." },
      { number: "03", title: "Dati separati", text: "Ogni organizzazione lavora nel proprio spazio protetto." },
    ],
    trusted: "Pensato in cucina. Strutturato per crescere.",
    loginTitle: "Bentornato",
    loginText: "Accedi con il tuo account personale.",
    registerTitle: "Crea la tua organizzazione",
    registerText: "Le iscrizioni sono attualmente disponibili su invito.",
    legacyTitle: "Accesso ChefSide esistente",
    legacyText: "Usa la password storica per accedere alle fiches del campeggio.",
    email: "Email professionale",
    password: "Password",
    displayName: "Nome e cognome",
    organization: "Nome dell'organizzazione",
    inviteCode: "Codice d'invito",
    submitLogin: "Entra nel tuo spazio",
    submitRegister: "Crea organizzazione",
    submitLegacy: "Accedi allo storico",
    back: "Torna alla presentazione",
    legacyLink: "Accesso storico ChefSide",
    passwordHint: "Almeno 12 caratteri.",
    checking: "Stiamo verificando la tua sessione...",
    errors: {
      unauthorized: "Email o password non corrette.",
      offline: "Server non raggiungibile. Riprova tra poco.",
      invalid_invite: "Il codice d'invito non è valido.",
      invalid_registration: "Controlla i dati. La password deve contenere almeno 12 caratteri.",
      account_exists: "Esiste già un account con questa email.",
      registration_disabled: "Le iscrizioni non sono ancora aperte.",
      too_many_attempts: "Troppi tentativi. Attendi qualche minuto.",
      registration_failed: "Non è stato possibile creare l'organizzazione.",
    },
  },
  fr: {
    eyebrow: "Les opérations de cuisine, enfin coordonnées",
    title: "De la recette au service, sans perdre le fil.",
    intro:
      "Fiches-recettes réunit fiches techniques, coûts, fournisseurs et procédures dans un espace conçu pour la restauration réelle.",
    login: "Se connecter",
    register: "Créer votre espace",
    featureLabel: "Une méthode unique",
    features: [
      { number: "01", title: "Recettes lisibles", text: "Quantités, procédures et allergènes toujours cohérents." },
      { number: "02", title: "Coûts connectés", text: "Tarifs fournisseurs et food cost dans le même flux." },
      { number: "03", title: "Données séparées", text: "Chaque organisation travaille dans son espace protégé." },
    ],
    trusted: "Pensé en cuisine. Structuré pour grandir.",
    loginTitle: "Heureux de vous revoir",
    loginText: "Connectez-vous avec votre compte personnel.",
    registerTitle: "Créer votre organisation",
    registerText: "Les inscriptions sont actuellement disponibles sur invitation.",
    legacyTitle: "Accès ChefSide existant",
    legacyText: "Utilisez le mot de passe historique pour accéder aux fiches du camping.",
    email: "E-mail professionnel",
    password: "Mot de passe",
    displayName: "Nom et prénom",
    organization: "Nom de l'organisation",
    inviteCode: "Code d'invitation",
    submitLogin: "Entrer dans votre espace",
    submitRegister: "Créer l'organisation",
    submitLegacy: "Accéder à l'historique",
    back: "Retour à la présentation",
    legacyLink: "Accès historique ChefSide",
    passwordHint: "12 caractères minimum.",
    checking: "Vérification de votre session...",
    errors: {
      unauthorized: "E-mail ou mot de passe incorrect.",
      offline: "Serveur inaccessible. Réessayez dans un instant.",
      invalid_invite: "Le code d'invitation n'est pas valide.",
      invalid_registration: "Vérifiez les données. Le mot de passe doit contenir au moins 12 caractères.",
      account_exists: "Un compte existe déjà avec cet e-mail.",
      registration_disabled: "Les inscriptions ne sont pas encore ouvertes.",
      too_many_attempts: "Trop de tentatives. Attendez quelques minutes.",
      registration_failed: "Impossible de créer l'organisation.",
    },
  },
  en: {
    eyebrow: "Kitchen operations, finally coordinated",
    title: "From recipe to service, without losing the thread.",
    intro:
      "Fiches-recettes brings technical sheets, costs, suppliers and procedures into one operational space built for real hospitality teams.",
    login: "Sign in",
    register: "Create your workspace",
    featureLabel: "One shared method",
    features: [
      { number: "01", title: "Readable recipes", text: "Quantities, procedures and allergens kept consistent." },
      { number: "02", title: "Connected costs", text: "Supplier pricing and food cost in the same workflow." },
      { number: "03", title: "Separated data", text: "Each organisation works inside its own protected space." },
    ],
    trusted: "Designed in the kitchen. Structured to grow.",
    loginTitle: "Welcome back",
    loginText: "Sign in with your personal account.",
    registerTitle: "Create your organisation",
    registerText: "Registration is currently available by invitation.",
    legacyTitle: "Existing ChefSide access",
    legacyText: "Use the historic password to access the campsite recipe sheets.",
    email: "Work email",
    password: "Password",
    displayName: "Full name",
    organization: "Organisation name",
    inviteCode: "Invitation code",
    submitLogin: "Enter your workspace",
    submitRegister: "Create organisation",
    submitLegacy: "Access historic workspace",
    back: "Back to overview",
    legacyLink: "Historic ChefSide access",
    passwordHint: "At least 12 characters.",
    checking: "Checking your session...",
    errors: {
      unauthorized: "Incorrect email or password.",
      offline: "The server is unavailable. Please try again shortly.",
      invalid_invite: "The invitation code is not valid.",
      invalid_registration: "Check your details. Passwords must be at least 12 characters.",
      account_exists: "An account already exists for this email.",
      registration_disabled: "Registration is not open yet.",
      too_many_attempts: "Too many attempts. Please wait a few minutes.",
      registration_failed: "The organisation could not be created.",
    },
  },
};

type Props = {
  lang: Lang;
  checking: boolean;
  initialError?: string;
  onLangChange: (lang: Lang) => void;
  onAuthenticated: () => void;
};

export default function AuthPortal({ lang, checking, initialError, onLangChange, onAuthenticated }: Props) {
  const [mode, setMode] = useState<Mode>("landing");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError || "");
  const c = copy[lang];

  const open = (nextMode: Mode) => {
    setMode(nextMode);
    setError("");
    setPassword("");
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    const result =
      mode === "register"
        ? await registerApi({ displayName, email, password, organizationName, inviteCode })
        : mode === "legacy"
          ? await loginLegacyApi(password)
          : await loginApi(email, password);
    setBusy(false);
    if (result.ok) {
      onAuthenticated();
      return;
    }
    setError(c.errors[result.reason]);
  };

  if (checking) {
    return (
      <main className="portal portal--checking">
        <img className="portal-checking-logo" src="/chefside-logo.svg" alt="Chef Side" />
        <div className="portal-loader" />
        <p>{c.checking}</p>
      </main>
    );
  }

  return (
    <main className="portal">
      <header className="portal-nav">
        <button className="portal-brand" type="button" onClick={() => open("landing")}>
          <img src="/chefside-logo.svg" alt="Chef Side" />
          <span>Fiches-recettes</span>
        </button>
        <div className="portal-nav-actions">
          <select
            className="portal-language"
            value={lang}
            onChange={(event) => onLangChange(event.target.value as Lang)}
            aria-label="Language"
          >
            <option value="it">IT</option>
            <option value="fr">FR</option>
            <option value="en">EN</option>
          </select>
          {mode === "landing" ? (
            <button className="portal-text-button" type="button" onClick={() => open("login")}>
              {c.login}
            </button>
          ) : null}
        </div>
      </header>

      {mode === "landing" ? (
        <>
          <section className="portal-hero">
            <div className="portal-hero-copy">
              <div className="portal-eyebrow"><span />{c.eyebrow}</div>
              <h1>{c.title}</h1>
              <p>{c.intro}</p>
              <div className="portal-hero-actions">
                <button className="portal-primary" type="button" onClick={() => open("login")}>{c.login}</button>
                <button className="portal-secondary" type="button" onClick={() => open("register")}>{c.register}</button>
              </div>
            </div>
            <div className="portal-orbit" aria-hidden="true">
              <div className="portal-orbit-ring portal-orbit-ring--outer" />
              <div className="portal-orbit-ring portal-orbit-ring--inner" />
              <div className="portal-orbit-core">F/R</div>
              <span className="portal-orbit-label portal-orbit-label--top">FOOD COST</span>
              <span className="portal-orbit-label portal-orbit-label--right">HACCP</span>
              <span className="portal-orbit-label portal-orbit-label--bottom">SUPPLIERS</span>
            </div>
          </section>
          <section className="portal-features">
            <div className="portal-section-label">{c.featureLabel}</div>
            <div className="portal-feature-grid">
              {c.features.map((feature) => (
                <article className="portal-feature" key={feature.number}>
                  <span>{feature.number}</span>
                  <h2>{feature.title}</h2>
                  <p>{feature.text}</p>
                </article>
              ))}
            </div>
            <div className="portal-trusted">{c.trusted}</div>
          </section>
        </>
      ) : (
        <section className="portal-auth-layout">
          <div className="portal-auth-message">
            <button className="portal-back" type="button" onClick={() => open("landing")}>← {c.back}</button>
            <span className="portal-auth-index">{mode === "login" ? "01" : mode === "register" ? "02" : "03"}</span>
            <h1>{mode === "login" ? c.loginTitle : mode === "register" ? c.registerTitle : c.legacyTitle}</h1>
            <p>{mode === "login" ? c.loginText : mode === "register" ? c.registerText : c.legacyText}</p>
          </div>
          <form className="portal-auth-form" onSubmit={submit}>
            {mode === "register" ? (
              <>
                <label>{c.displayName}<input value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoComplete="name" required /></label>
                <label>{c.organization}<input value={organizationName} onChange={(e) => setOrganizationName(e.target.value)} autoComplete="organization" required /></label>
              </>
            ) : null}
            {mode !== "legacy" ? (
              <label>{c.email}<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required /></label>
            ) : null}
            <label>
              {c.password}
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "register" ? "new-password" : "current-password"} minLength={mode === "register" ? 12 : undefined} required />
              {mode === "register" ? <small>{c.passwordHint}</small> : null}
            </label>
            {mode === "register" ? (
              <label>{c.inviteCode}<input value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} autoComplete="one-time-code" required /></label>
            ) : null}
            {error ? <div className="portal-form-error" role="alert">{error}</div> : null}
            <button className="portal-primary portal-submit" type="submit" disabled={busy}>
              {busy ? "…" : mode === "login" ? c.submitLogin : mode === "register" ? c.submitRegister : c.submitLegacy}
            </button>
            {mode === "login" ? (
              <button className="portal-legacy-link" type="button" onClick={() => open("legacy")}>{c.legacyLink}</button>
            ) : null}
          </form>
        </section>
      )}
    </main>
  );
}
