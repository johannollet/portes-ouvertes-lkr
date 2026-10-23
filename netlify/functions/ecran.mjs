// Portes ouvertes LKR : écran de la salle des élèves accompagnateurs (Netlify Blobs).
// L'écran ne voit qu'une vue réduite (prénom, initiale du nom, classe, statut, appels) et ne peut que :
// pointer une arrivée, pointer un retour de visite, répondre « J'arrive » à un appel.
// POST /api/ecran avec { op, ... } :
//   login   : { ecran }                 -> { ok }
//   state   : { ecran, etag? }          -> { same } | { etag, eleves, appels, prochaines, info }
//   checkin : { ecran, id, kind }       -> { ok, prenom }      (kind = "arrivee" | "retour")
//   ack     : { ecran, id }             -> { ok }              (id = élève appelé)
//   setcode : { code, newCode }         -> { ok }              (organisateur : code d'accès de l'appli)
import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";

const DEFAULT_CODE = "1411";
const DEFAULT_SALT = "portes-ouvertes-lkr-defaut";
const DEFAULT_ECRAN = "2335";
const ECRAN_SALT = "ecran-portes-ouvertes-lkr";
const hash = (code, salt) => crypto.createHash("sha256").update(`${salt}:${code}`).digest("hex");
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const wait = () => new Promise((r) => setTimeout(r, 700));
const tmin = (s) => { const m = String(s || "").match(/(\d{1,2})\s*[hH:]\s*(\d{2})?/); return m ? +m[1] * 60 + +(m[2] || 0) : null; };
const fmt = (m) => Math.floor(m / 60) + "h" + String(m % 60).padStart(2, "0");
function nowParis() {
  const p = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  const h = +p.find((x) => x.type === "hour").value, mi = +p.find((x) => x.type === "minute").value;
  return h * 60 + mi;
}
const isGuide = (e) => e.role === "visite" || !!e.aussiVisite;

function view(st) {
  const el = st.eleves || {}, fams = Object.values(st.familles || {});
  const enVisite = new Set(fams.filter((f) => f.statut === "visite" && f.eleve).map((f) => f.eleve));
  const now = nowParis();
  const prochaine = {};
  fams.filter((f) => !f.eleve && f.elevePrevu && ["inscrit", "arrive", undefined, ""].includes(f.statut))
    .forEach((f) => { const t = tmin(f.slot); if (t == null) return; if (prochaine[f.elevePrevu] == null || t < prochaine[f.elevePrevu]) prochaine[f.elevePrevu] = t; });
  const eleves = Object.values(el).map((e) => ({
    id: e.id, prenom: String(e.prenom || "").trim(), n: String(e.nom || "").trim().charAt(0).toUpperCase(), classe: e.classe || "",
    guide: isGuide(e), atelier: e.role === "atelier" ? e.atelier || "" : "", presence: e.presence || "", visite: enVisite.has(e.id),
    prochaine: prochaine[e.id] != null ? fmt(prochaine[e.id]) : "",
  }));
  const appels = Object.values(st.appels || {}).filter((a) => a && a.etat !== "fini").map((a) => {
    const e = el[a.eleve] || {};
    return { id: a.eleve, prenom: String(e.prenom || "").trim(), n: String(e.nom || "").trim().charAt(0).toUpperCase(), classe: e.classe || "", famille: a.familleNom || "", at: a.at || "", etat: a.etat || "appel" };
  });
  const prochaines = Object.entries(prochaine).filter(([, t]) => t >= now - 15 && t <= now + 40).sort((a, b) => a[1] - b[1])
    .map(([id, t]) => ({ t: fmt(t), prenom: String((el[id] || {}).prenom || "").trim(), n: String((el[id] || {}).nom || "").charAt(0).toUpperCase(), present: (el[id] || {}).presence === "present", visite: enVisite.has(id) }));
  const c = st.config || {};
  return { eleves, appels, prochaines, info: { college: c.college || "", dateTexte: c.dateTexte || "" } };
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "méthode non autorisée" }, 405);
  let b;
  try { b = await req.json(); } catch { return json({ error: "requête invalide" }, 400); }
  const store = getStore({ name: "portes-ouvertes-lkr", consistency: "strong" });
  try {
    const cfg = (await store.get("config", { type: "json" })) || { salt: DEFAULT_SALT, hash: hash(DEFAULT_CODE, DEFAULT_SALT) };
    const isEcran = typeof b.ecran === "string" && hash(b.ecran.trim(), cfg.ecranSalt || ECRAN_SALT) === (cfg.ecranHash || hash(DEFAULT_ECRAN, ECRAN_SALT));
    const isAdmin = typeof b.code === "string" && hash(b.code, cfg.salt) === cfg.hash;
    if (b.op === "setcode") {
      if (!isAdmin) { await wait(); return json({ error: "code" }, 401); }
      if (typeof b.newCode !== "string" || !/^\d{4,8}$/.test(b.newCode)) return json({ error: "Le code écran doit faire 4 à 8 chiffres." }, 400);
      const salt = crypto.randomBytes(8).toString("hex");
      await store.setJSON("config", { ...cfg, ecranSalt: salt, ecranHash: hash(b.newCode, salt) });
      return json({ ok: true });
    }
    if (!isEcran) { await wait(); return json({ error: "code" }, 401); }
    if (b.op === "login") return json({ ok: true });
    if (b.op === "state") {
      const e = await store.getWithMetadata("state", { type: "text" });
      if (!e) return json({ etag: "", eleves: [], appels: [], prochaines: [], info: {} });
      if (b.etag && e.etag === b.etag) return json({ same: true });
      return json({ etag: e.etag, ...view(JSON.parse(e.data)) });
    }
    if (b.op === "checkin" || b.op === "ack") {
      for (let i = 0; i < 5; i++) {
        const e = await store.getWithMetadata("state", { type: "text" });
        if (!e) return json({ error: "Aucune donnée." }, 404);
        const st = JSON.parse(e.data);
        const el = (st.eleves || {})[b.id];
        if (!el) return json({ error: "Élève inconnu." }, 404);
        const t = fmt(nowParis());
        if (b.op === "ack") {
          const a = (st.appels || {})[b.id];
          if (!a || a.etat === "fini") return json({ ok: true });
          a.etat = "vient"; a.ackAt = t;
        } else if (b.kind === "retour") {
          Object.values(st.familles || {}).forEach((f) => { if (f.statut === "visite" && f.eleve === b.id) { f.statut = "fini"; f.hRetour = t; } });
          el.presence = "present"; if (!el.arrivee) el.arrivee = t;
        } else {
          el.presence = "present"; el.arrivee = el.arrivee || t;
        }
        const res = await store.set("state", JSON.stringify(st), { onlyIfMatch: e.etag });
        if (res && res.modified === false) continue; // l'appli a écrit entre-temps : on recommence
        return json({ ok: true, prenom: el.prenom || "" });
      }
      return json({ error: "Réessaie dans un instant." }, 409);
    }
    return json({ error: "opération inconnue" }, 400);
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 500);
  }
};

export const config = { path: "/api/ecran" };
