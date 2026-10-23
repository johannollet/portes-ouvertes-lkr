// Portes ouvertes LKR : synchronisation des appareils et code d'accès (Netlify Blobs).
// Toutes les requêtes sont en POST /api/sync avec un corps JSON { op, code, ... } :
//   login : vérifie le code (1411 par défaut tant qu'il n'a pas été changé)
//   get   : { etag? } -> { empty } | { same, etag } | { etag, data }
//   put   : { data, etag? } -> { etag } | 409 { conflict } si un autre appareil a modifié entre-temps
//   code  : { newCode } -> change le code d'accès pour tous les appareils
// Les fiches ateliers des professeurs passent par /api/fiche (fiche.mjs).
import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";

const DEFAULT_CODE = "1411";
const DEFAULT_SALT = "portes-ouvertes-lkr-defaut";
const MAX = 5_000_000;
const hash = (code, salt) => crypto.createHash("sha256").update(`${salt}:${code}`).digest("hex");
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export default async (req) => {
  if (req.method !== "POST") return json({ error: "méthode non autorisée" }, 405);
  let b;
  try { b = await req.json(); } catch { return json({ error: "requête invalide" }, 400); }
  const store = getStore({ name: "portes-ouvertes-lkr", consistency: "strong" });
  try {
    const cfg = (await store.get("config", { type: "json" })) || { salt: DEFAULT_SALT, hash: hash(DEFAULT_CODE, DEFAULT_SALT) };
    if (typeof b.code !== "string" || hash(b.code, cfg.salt) !== cfg.hash) {
      await new Promise((r) => setTimeout(r, 700));
      return json({ error: "code" }, 401);
    }
    switch (b.op) {
      case "login":
        return json({ ok: true, salt: cfg.salt, hash: cfg.hash });
      case "get": {
        const e = await store.getWithMetadata("state", { type: "text" });
        if (!e) return json({ empty: true });
        if (b.etag && e.etag === b.etag) return json({ same: true, etag: e.etag });
        return new Response(`{"etag":${JSON.stringify(e.etag)},"data":${e.data}}`, {
          status: 200, headers: { "content-type": "application/json", "cache-control": "no-store" },
        });
      }
      case "put": {
        if (!b.data || typeof b.data !== "object") return json({ error: "données manquantes" }, 400);
        const body = JSON.stringify(b.data);
        if (body.length > MAX) return json({ error: "Données trop volumineuses." }, 413);
        const res = await store.set("state", body, b.etag ? { onlyIfMatch: b.etag } : { onlyIfNew: true });
        if (res && res.modified === false) return json({ conflict: true }, 409);
        let etag = res && res.etag;
        if (!etag) { const m = await store.getMetadata("state"); etag = m && m.etag; }
        return json({ etag });
      }
      case "code": {
        if (typeof b.newCode !== "string" || !/^\d{4,8}$/.test(b.newCode)) return json({ error: "Le code doit faire 4 à 8 chiffres." }, 400);
        const salt = crypto.randomBytes(8).toString("hex");
        const next = { salt, hash: hash(b.newCode, salt) };
        await store.setJSON("config", { ...cfg, ...next }); // garde le code profs
        return json({ ok: true, ...next });
      }
      default:
        return json({ error: "opération inconnue" }, 400);
    }
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 500);
  }
};

export const config = { path: "/api/sync" };
