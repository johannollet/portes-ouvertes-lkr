const C="portes-ouvertes-lkr-v9";
const F=["./","index.html","app.css","manifest.json","icon-180.png","icon-192.png","icon-512.png",
  "docs/feuillet_accueil_parents.pdf","docs/fiche_atelier_portes_ouvertes.pdf","docs/flyers_portes_ouvertes.pdf","docs/qrcode_evento.png","docs/college.jpg",
  "docs/th_feuillet-1.png","docs/th_fiche-1.png","docs/th_flyers-1.png"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(C).then(c=>c.addAll(F.map(u=>new Request(u,{cache:"reload"})))).then(()=>self.skipWaiting()))});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==C).map(x=>caches.delete(x)))).then(()=>self.clients.claim()))});
function putCache(req,res){if(res&&(res.ok||res.type==="opaque")){const cp=res.clone();caches.open(C).then(c=>c.put(req,cp))}return res}
self.addEventListener("fetch",e=>{
  const req=e.request;if(req.method!=="GET")return;
  const url=new URL(req.url);const same=url.origin===location.origin;if(url.pathname.startsWith("/api/"))return;
  const isPage=req.mode==="navigate"||(same&&(url.pathname==="/"||url.pathname.endsWith(".html")));
  // L'appli (index) et les pages publiques (fiche atelier, enquête) sont gardées séparément.
  const isApp=same&&(url.pathname==="/"||url.pathname.endsWith("/index.html"));
  if(isPage){
    // Page : la version en ligne si le réseau répond (3 s max), sinon la copie hors ligne.
    e.respondWith(new Promise(resolve=>{
      let done=false;const fallback=()=>caches.match(isApp?"index.html":req,{ignoreSearch:true}).then(r=>r||(isApp?caches.match("index.html"):new Response("Hors ligne : reconnectez-vous pour ouvrir cette page.",{headers:{"content-type":"text/plain; charset=utf-8"}})));
      const t=setTimeout(()=>{if(!done){done=true;resolve(fallback())}},3000);
      fetch(req,{cache:"no-store"}).then(res=>{putCache(isApp?"index.html":req,res.clone());if(!done){done=true;clearTimeout(t);resolve(res)}})
        .catch(()=>{if(!done){done=true;clearTimeout(t);resolve(fallback())}});
    }));
    return;
  }
  // Fichiers du site, polices et bibliothèques (Excel, PDF, QR code) gardés pour le hors-ligne
  if(!same&&!url.hostname.includes("fonts.g")&&url.hostname!=="cdnjs.cloudflare.com")return;
  e.respondWith(caches.match(req,{ignoreSearch:true}).then(r=>{const net=fetch(req).then(res=>putCache(req,res)).catch(()=>r);return r||net}));
});
