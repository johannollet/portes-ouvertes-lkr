// Portes ouvertes LKR : enquête de satisfaction et informations publiques (Netlify Blobs).
// POST /api/enquete avec un corps JSON { op, ... } :
//   public  : {}                        -> { info, enquete, vol }  (lu par les pages publiques : enquête, fiche atelier)
//   answer  : { answers, site }         -> { ok }             (réponse anonyme d'une famille ; « site » = piège à robots)
//   results : { code }                  -> { reponses: [...] } (organisateur, code d'accès de l'appli)
//   publish : { code, info, enquete }   -> { ok }             (l'appli publie l'enquête et les infos de l'événement)
//   clear   : { code }                  -> { ok, deleted }    (efface toutes les réponses)
import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";

const DEFAULT_CODE = "1411";
const DEFAULT_SALT = "portes-ouvertes-lkr-defaut";
const hash = (code, salt) => crypto.createHash("sha256").update(`${salt}:${code}`).digest("hex");
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const wait = () => new Promise((r) => setTimeout(r, 700));
const str = (v, n) => String(v ?? "").slice(0, n);
const TYPES = ["note", "choix", "multi", "texte"];

function cleanEnquete(e) {
  e = e && typeof e === "object" ? e : {};
  const questions = (Array.isArray(e.questions) ? e.questions : []).slice(0, 25).map((q) => ({
    id: str(q && q.id, 24).replace(/[^a-z0-9_-]/gi, "") || crypto.randomBytes(3).toString("hex"),
    type: TYPES.includes(q && q.type) ? q.type : "texte",
    label: str(q && q.label, 200),
    options: (Array.isArray(q && q.options) ? q.options : []).slice(0, 30).map((o) => str(o, 100)).filter(Boolean),
    obligatoire: !!(q && q.obligatoire),
  }));
  return { ouverte: e.ouverte !== false, titre: str(e.titre, 120), intro: str(e.intro, 400), merci: str(e.merci, 400), questions };
}
function cleanVol(v) {
  v = v && typeof v === "object" ? v : {};
  const list = (a, n, m) => (Array.isArray(a) ? a : []).slice(0, n).map((x) => str(x, m)).filter(Boolean);
  return { ouvert: !!v.ouvert, classes: list(v.classes, 60, 10), ateliers: list(v.ateliers, 40, 80), dateLimite: str(v.dateLimite, 40), message: str(v.message, 400) };
}
function cleanInfo(i) {
  i = i && typeof i === "object" ? i : {};
  return { college: str(i.college, 100), ville: str(i.ville, 60), dateTexte: str(i.dateTexte, 80), horaires: str(i.horaires, 40), responsable: str(i.responsable, 80), accent: str(i.accent, 10) };
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "méthode non autorisée" }, 405);
  const raw = await req.text();
  if (raw.length > 60000) return json({ error: "requête trop volumineuse" }, 413);
  let b;
  try { b = JSON.parse(raw); } catch { return json({ error: "requête invalide" }, 400); }
  const store = getStore({ name: "portes-ouvertes-lkr", consistency: "strong" });
  try {
    const cfg = (await store.get("config", { type: "json" })) || { salt: DEFAULT_SALT, hash: hash(DEFAULT_CODE, DEFAULT_SALT) };
    const isAdmin = typeof b.code === "string" && hash(b.code, cfg.salt) === cfg.hash;
    switch (b.op) {
      case "public": {
        const pub = (await store.get("public", { type: "json" })) || {};
        return json({ info: pub.info || null, enquete: pub.enquete || null, vol: pub.vol || null });
      }
      case "answer": {
        if (b.site) return json({ ok: true }); // robot : on fait semblant
        const pub = (await store.get("public", { type: "json" })) || {};
        const e = pub.enquete;
        if (!e || !e.ouverte) return json({ error: "L'enquête est fermée." }, 403);
        const a = b.answers && typeof b.answers === "object" ? b.answers : {};
        const out = {};
        for (const q of e.questions) {
          const v = a[q.id];
          if (v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length)) {
            if (q.obligatoire) return json({ error: `Réponse manquante : ${q.label}` }, 400);
            continue;
          }
          if (q.type === "note") { const n = parseInt(v); if (n >= 1 && n <= 5) out[q.id] = n; }
          else if (q.type === "choix") { if (q.options.includes(String(v))) out[q.id] = String(v); }
          else if (q.type === "multi") { const arr = (Array.isArray(v) ? v : [v]).map(String).filter((x) => q.options.includes(x)); if (arr.length) out[q.id] = [...new Set(arr)]; }
          else out[q.id] = str(v, 800).trim();
        }
        if (!Object.keys(out).length) return json({ error: "Réponse vide." }, 400);
        const at = new Date().toISOString();
        await store.setJSON(`rep/${at}-${crypto.randomBytes(3).toString("hex")}`, { at, answers: out });
        return json({ ok: true });
      }
      case "results": {
        if (!isAdmin) { await wait(); return json({ error: "code" }, 401); }
        const { blobs } = await store.list({ prefix: "rep/" });
        const reponses = [];
        for (const x of blobs) { const r = await store.get(x.key, { type: "json" }); if (r) reponses.push({ id: x.key.slice(4), ...r }); }
        reponses.sort((p, q) => (p.at < q.at ? -1 : 1));
        return json({ reponses });
      }
      case "publish": {
        if (!isAdmin) { await wait(); return json({ error: "code" }, 401); }
        await store.setJSON("public", { info: cleanInfo(b.info), enquete: cleanEnquete(b.enquete), vol: cleanVol(b.vol), at: new Date().toISOString() });
        return json({ ok: true });
      }
      case "clear": {
        if (!isAdmin) { await wait(); return json({ error: "code" }, 401); }
        const { blobs } = await store.list({ prefix: "rep/" });
        for (const x of blobs) await store.delete(x.key);
        return json({ ok: true, deleted: blobs.length });
      }
      default:
        return json({ error: "opération inconnue" }, 400);
    }
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 500);
  }
};

export const config = { path: "/api/enquete" };
