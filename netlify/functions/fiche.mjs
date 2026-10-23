// Portes ouvertes LKR : fiches ateliers remplies en ligne par les professeurs (Netlify Blobs).
// POST /api/fiche avec un corps JSON { op, ... } :
//   submit    : { profCode, fiche, id?, token? } -> { id, token, updatedAt }  (création, ou modification avec id + token)
//   load      : { id, token }                    -> { data, updatedAt }       (le professeur rouvre sa fiche)
//   list      : { code }                         -> { fiches: [...] }        (organisateur : code d'accès de l'appli)
//   delete    : { code, id }                     -> { ok }
//   profcode  : { code, newProfCode }            -> { ok }                    (change le code transmis aux professeurs)
import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";

const DEFAULT_CODE = "1411";
const DEFAULT_SALT = "portes-ouvertes-lkr-defaut";
const DEFAULT_PROF = "2026";
const PROF_SALT = "prof-portes-ouvertes-lkr";
const hash = (code, salt) => crypto.createHash("sha256").update(`${salt}:${code}`).digest("hex");
const sha = (t) => crypto.createHash("sha256").update(String(t)).digest("hex");
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const wait = () => new Promise((r) => setTimeout(r, 700));
const str = (v, n) => String(v ?? "").slice(0, n);

function clean(f) {
  f = f && typeof f === "object" ? f : {};
  const eleves = (Array.isArray(f.eleves) ? f.eleves : []).slice(0, 40)
    .map((e) => ({ nom: str(e && e.nom, 60), prenom: str(e && e.prenom, 60), classe: str(e && e.classe, 10) }))
    .filter((e) => e.nom.trim() || e.prenom.trim());
  return {
    nom: str(f.nom, 80).trim(), pole: str(f.pole, 40), poleAutre: str(f.poleAutre, 60), description: str(f.description, 260),
    prof: str(f.prof, 120), email: str(f.email, 120), salle: str(f.salle, 60), acces: f.acces === "horaires" ? "horaires" : "libre",
    horaires: str(f.horaires, 120), materiel: str(f.materiel, 400), eleves, besoinEleves: Math.max(0, Math.min(40, parseInt(f.besoinEleves) || 0)),
  };
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "méthode non autorisée" }, 405);
  let b;
  try { b = await req.json(); } catch { return json({ error: "requête invalide" }, 400); }
  const store = getStore({ name: "portes-ouvertes-lkr", consistency: "strong" });
  try {
    const cfg = (await store.get("config", { type: "json" })) || { salt: DEFAULT_SALT, hash: hash(DEFAULT_CODE, DEFAULT_SALT) };
    const isAdmin = typeof b.code === "string" && hash(b.code, cfg.salt) === cfg.hash;
    const profSalt = cfg.profSalt || PROF_SALT;
    const profHash = cfg.profHash || hash(DEFAULT_PROF, PROF_SALT);
    const isProf = typeof b.profCode === "string" && hash(b.profCode.trim(), profSalt) === profHash;
    switch (b.op) {
      case "submit": {
        if (!isProf) { await wait(); return json({ error: "code" }, 401); }
        const data = clean(b.fiche);
        if (!data.nom) return json({ error: "Le nom de l'atelier est obligatoire." }, 400);
        const now = new Date().toISOString();
        let id = b.id, token = b.token, rec = null;
        if (id) {
          if (typeof id !== "string" || !/^[a-f0-9]{8,32}$/.test(id)) return json({ error: "fiche inconnue" }, 404);
          rec = await store.get("fiche/" + id, { type: "json" });
          if (!rec || rec.tokenHash !== sha(token)) return json({ error: "Lien de modification invalide." }, 403);
        } else {
          id = crypto.randomBytes(6).toString("hex");
          token = crypto.randomBytes(16).toString("hex");
        }
        await store.setJSON("fiche/" + id, { id, tokenHash: sha(token), createdAt: rec ? rec.createdAt : now, updatedAt: now, data });
        return json({ id, token, updatedAt: now });
      }
      case "load": {
        if (typeof b.id !== "string" || !/^[a-f0-9]{8,32}$/.test(b.id)) return json({ error: "fiche inconnue" }, 404);
        const rec = await store.get("fiche/" + b.id, { type: "json" });
        if (!rec || rec.tokenHash !== sha(b.token)) { await wait(); return json({ error: "Lien de modification invalide." }, 403); }
        return json({ data: rec.data, updatedAt: rec.updatedAt });
      }
      case "list": {
        if (!isAdmin) { await wait(); return json({ error: "code" }, 401); }
        const { blobs } = await store.list({ prefix: "fiche/" });
        const fiches = [];
        for (const x of blobs) {
          const r = await store.get(x.key, { type: "json" });
          if (r) fiches.push({ id: r.id, createdAt: r.createdAt, updatedAt: r.updatedAt, data: r.data });
        }
        return json({ fiches });
      }
      case "delete": {
        if (!isAdmin) { await wait(); return json({ error: "code" }, 401); }
        if (typeof b.id === "string" && /^[a-f0-9]{8,32}$/.test(b.id)) await store.delete("fiche/" + b.id);
        return json({ ok: true });
      }
      case "profcode": {
        if (!isAdmin) { await wait(); return json({ error: "code" }, 401); }
        if (typeof b.newProfCode !== "string" || !/^[A-Za-z0-9]{4,12}$/.test(b.newProfCode)) return json({ error: "Le code profs doit faire 4 à 12 lettres ou chiffres." }, 400);
        const salt = crypto.randomBytes(8).toString("hex");
        await store.setJSON("config", { ...cfg, profSalt: salt, profHash: hash(b.newProfCode, salt) });
        return json({ ok: true });
      }
      default:
        return json({ error: "opération inconnue" }, 400);
    }
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 500);
  }
};

export const config = { path: "/api/fiche" };
