// Portes ouvertes LKR : inscriptions en ligne des élèves volontaires (Netlify Blobs).
// L'élève ne voit que son formulaire ; aucune donnée de l'appli n'est exposée.
// POST /api/volontaire avec { op, ... } :
//   submit : { fiche, id?, token?, site }  -> { id, token, updatedAt }   (création, ou modification avec id + token)
//   load   : { id, token }                 -> { data, updatedAt }
//   list   : { code }                      -> { inscriptions: [...] }   (organisateur, code d'accès de l'appli)
//   delete : { code, id }                  -> { ok }
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

function clean(f) {
  f = f && typeof f === "object" ? f : {};
  return {
    nom: str(f.nom, 60), prenom: str(f.prenom, 60), classe: str(f.classe, 10),
    visite: !!f.visite, atelier: !!f.atelier, atelierChoix: str(f.atelierChoix, 80),
    famille: !!f.famille, familleNom: str(f.familleNom, 60), familleLien: str(f.familleLien, 40),
    dispo: f.dispo === "partiel" ? "partiel" : "tout", dispoDes: str(f.dispoDes, 8), dispoJusqua: str(f.dispoJusqua, 8),
    accord: !!f.accord, message: str(f.message, 400),
  };
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
      case "submit": {
        if (b.site) return json({ id: "0", token: "0", updatedAt: "" }); // robot
        const pub = (await store.get("public", { type: "json" })) || {};
        if (!pub.vol || !pub.vol.ouvert) return json({ error: "Les inscriptions des élèves sont fermées." }, 403);
        const data = clean(b.fiche);
        if (!data.nom || !data.prenom || !data.classe) return json({ error: "Nom, prénom et classe sont obligatoires." }, 400);
        if (!data.visite && !data.atelier && !data.famille) return json({ error: "Choisis au moins une façon d'aider." }, 400);
        if (!data.accord) return json({ error: "Il faut l'accord de tes parents." }, 400);
        const now = new Date().toISOString();
        let id = b.id, token = b.token, rec = null;
        if (id) {
          if (typeof id !== "string" || !ID.test(id)) return json({ error: "inscription inconnue" }, 404);
          rec = await store.get("vol/" + id, { type: "json" });
          if (!rec || rec.tokenHash !== sha(token)) return json({ error: "Lien de modification invalide." }, 403);
        } else { id = crypto.randomBytes(6).toString("hex"); token = crypto.randomBytes(16).toString("hex"); }
        await store.setJSON("vol/" + id, { id, tokenHash: sha(token), createdAt: rec ? rec.createdAt : now, updatedAt: now, data });
        return json({ id, token, updatedAt: now });
      }
      case "load": {
        if (typeof b.id !== "string" || !ID.test(b.id)) return json({ error: "inscription inconnue" }, 404);
        const rec = await store.get("vol/" + b.id, { type: "json" });
        if (!rec || rec.tokenHash !== sha(b.token)) { await wait(); return json({ error: "Lien de modification invalide." }, 403); }
        return json({ data: rec.data, updatedAt: rec.updatedAt });
      }
      case "list": {
        if (!isAdmin) { await wait(); return json({ error: "code" }, 401); }
        const { blobs } = await store.list({ prefix: "vol/" });
        const inscriptions = [];
        for (const x of blobs) { const r = await store.get(x.key, { type: "json" }); if (r) inscriptions.push({ id: r.id, createdAt: r.createdAt, updatedAt: r.updatedAt, data: r.data }); }
        inscriptions.sort((p, q) => (p.createdAt < q.createdAt ? -1 : 1));
        return json({ inscriptions });
      }
      case "delete": {
        if (!isAdmin) { await wait(); return json({ error: "code" }, 401); }
        if (typeof b.id === "string" && ID.test(b.id)) await store.delete("vol/" + b.id);
        return json({ ok: true });
      }
      default:
        return json({ error: "opération inconnue" }, 400);
    }
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 500);
  }
};

export const config = { path: "/api/volontaire" };
