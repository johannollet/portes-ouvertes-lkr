// Portes ouvertes LKR : inscription en ligne des familles (remplace Evento) — Netlify Blobs.
// La famille ne voit que le formulaire et le nombre de places restantes par créneau.
// POST /api/inscription avec { op, ... } :
//   places : {}                              -> { counts: { "9h00": 12, ... } }
//   submit : { fiche, id?, token?, site }    -> { id, token, updatedAt }   (création, ou modification avec id + token)
//   load   : { id, token }                   -> { data, updatedAt, annule }
//   cancel : { id, token }                   -> { ok }
//   list   : { code }                        -> { inscriptions: [...] }   (organisateur, code d'accès de l'appli)
//   delete : { code, ids }                   -> { ok }                    (organisateur : libère les places)
import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";

const DEFAULT_CODE = "1411";
const DEFAULT_SALT = "portes-ouvertes-lkr-defaut";
const hash = (code, salt) => crypto.createHash("sha256").update(`${salt}:${code}`).digest("hex");
const sha = (t) => crypto.createHash("sha256").update(String(t)).digest("hex");
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const wait = () => new Promise((r) => setTimeout(r, 700));
const str = (v, n) => String(v ?? "").slice(0, n).trim();
const ID = /^[a-f0-9]{8,32}$/;
const MAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function clean(f) {
  f = f && typeof f === "object" ? f : {};
  return { nom: str(f.nom, 60), prenom: str(f.prenom, 60), email: str(f.email, 120).toLowerCase(), ecole: str(f.ecole, 80),
    niveau: str(f.niveau, 30), nb: Math.max(1, Math.min(10, parseInt(f.nb) || 1)), slot: str(f.slot, 10), message: str(f.message, 400) };
}
async function counts(store) {
  const { blobs } = await store.list({ prefix: "insc/" });
  const c = {};
  for (const x of blobs) { const r = await store.get(x.key, { type: "json" }); if (r && !r.annule && r.data && r.data.slot) c[r.data.slot] = (c[r.data.slot] || 0) + 1; }
  return c;
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "méthode non autorisée" }, 405);
  const raw = await req.text();
  if (raw.length > 20000) return json({ error: "requête trop volumineuse" }, 413);
  let b;
  try { b = JSON.parse(raw); } catch { return json({ error: "requête invalide" }, 400); }
  const store = getStore({ name: "portes-ouvertes-lkr", consistency: "strong" });
  try {
    const cfg = (await store.get("config", { type: "json" })) || { salt: DEFAULT_SALT, hash: hash(DEFAULT_CODE, DEFAULT_SALT) };
    const isAdmin = typeof b.code === "string" && hash(b.code, cfg.salt) === cfg.hash;
    switch (b.op) {
      case "places":
        return json({ counts: await counts(store) });
      case "submit": {
        if (b.site) return json({ id: "0", token: "0", updatedAt: "" }); // robot
        const pub = (await store.get("public", { type: "json" })) || {};
        const ins = pub.insc;
        if (!ins || !ins.ouvert) return json({ error: "Les inscriptions sont fermées." }, 403);
        const data = clean(b.fiche);
        if (!data.nom || !data.prenom) return json({ error: "Nom et prénom sont obligatoires." }, 400);
        if (!MAIL.test(data.email)) return json({ error: "Adresse e-mail invalide." }, 400);
        if (!data.ecole || !data.niveau) return json({ error: "École d'origine et niveau de classe sont obligatoires." }, 400);
        if (!(ins.slots || []).includes(data.slot)) return json({ error: "Choisissez un créneau." }, 400);
        let id = b.id, token = b.token, rec = null;
        if (id) {
          if (typeof id !== "string" || !ID.test(id)) return json({ error: "inscription inconnue" }, 404);
          rec = await store.get("insc/" + id, { type: "json" });
          if (!rec || rec.tokenHash !== sha(token)) return json({ error: "Lien de modification invalide." }, 403);
        }
        const places = parseInt(ins.places) || 0;
        if (places > 0 && !(rec && !rec.annule && rec.data.slot === data.slot)) {
          const c = await counts(store);
          if ((c[data.slot] || 0) >= places) return json({ error: `Le créneau de ${data.slot} est complet. Choisissez-en un autre.`, complet: data.slot }, 409);
        }
        if (!id) { id = crypto.randomBytes(6).toString("hex"); token = crypto.randomBytes(16).toString("hex"); }
        const now = new Date().toISOString();
        await store.setJSON("insc/" + id, { id, tokenHash: sha(token), createdAt: rec ? rec.createdAt : now, updatedAt: now, annule: false, data });
        return json({ id, token, updatedAt: now });
      }
      case "load": {
        if (typeof b.id !== "string" || !ID.test(b.id)) return json({ error: "inscription inconnue" }, 404);
        const rec = await store.get("insc/" + b.id, { type: "json" });
        if (!rec || rec.tokenHash !== sha(b.token)) { await wait(); return json({ error: "Lien de modification invalide." }, 403); }
        return json({ data: rec.data, updatedAt: rec.updatedAt, annule: !!rec.annule });
      }
      case "cancel": {
        if (typeof b.id !== "string" || !ID.test(b.id)) return json({ error: "inscription inconnue" }, 404);
        const rec = await store.get("insc/" + b.id, { type: "json" });
        if (!rec || rec.tokenHash !== sha(b.token)) { await wait(); return json({ error: "Lien invalide." }, 403); }
        await store.setJSON("insc/" + b.id, { ...rec, annule: true, updatedAt: new Date().toISOString() });
        return json({ ok: true });
      }
      case "list": {
        if (!isAdmin) { await wait(); return json({ error: "code" }, 401); }
        const { blobs } = await store.list({ prefix: "insc/" });
        const inscriptions = [];
        for (const x of blobs) { const r = await store.get(x.key, { type: "json" }); if (r) inscriptions.push({ id: r.id, createdAt: r.createdAt, updatedAt: r.updatedAt, annule: !!r.annule, data: r.data }); }
        return json({ inscriptions });
      }
      case "delete": {
        if (!isAdmin) { await wait(); return json({ error: "code" }, 401); }
        const ids = (Array.isArray(b.ids) ? b.ids : []).filter((x) => typeof x === "string" && ID.test(x)).slice(0, 500);
        for (const x of ids) await store.delete("insc/" + x);
        return json({ ok: true, n: ids.length });
      }
      default:
        return json({ error: "opération inconnue" }, 400);
    }
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 500);
  }
};

export const config = { path: "/api/inscription" };
