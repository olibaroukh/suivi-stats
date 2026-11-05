/* Stockage, deux modes :
 *  - « cloud » (par défaut) : Worker suivi-stats-api sur Cloudflare, après connexion Zimbra.
 *    Administrateurs : lecture / écriture de tous les fichiers. Lecteurs : photo du mois et
 *    référentiel filtrés à leur périmètre par le Worker (rien d'autre n'est lisible).
 *  - « dossier » (ancien mode) : dossier choisi sur l'ordinateur (Dropbox), File System Access de Chrome.
 * Repli « mémoire » (sans dossier) pour essayer l'appli : rien n'est conservé à la fermeture. */
(function (root) {
  'use strict';
  const DB = 'suivi-stats', ST = 'handles';
  function idb() { return new Promise((res, rej) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore(ST); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
  async function idbGet(k) { const db = await idb(); return new Promise(res => { const tx = db.transaction(ST).objectStore(ST).get(k); tx.onsuccess = () => res(tx.result); tx.onerror = () => res(null); }); }
  async function idbSet(k, v) { const db = await idb(); return new Promise(res => { const tx = db.transaction(ST, 'readwrite'); tx.objectStore(ST).put(v, k); tx.oncomplete = () => res(); }); }

  let racine = null; const memoire = new Map();
  const supporte = () => 'showDirectoryPicker' in root;

  async function choisirDossier() { racine = await root.showDirectoryPicker({ id: 'suivi-stats', mode: 'readwrite' }); await idbSet('racine', racine); return racine.name; }
  async function restaurer() {
    try { const h = await idbGet('racine'); if (!h) return null; racine = h;
      const p = await h.queryPermission({ mode: 'readwrite' }); return { nom: h.name, permission: p }; } catch (e) { return null; }
  }
  async function autoriser() { if (!racine) return false; return (await racine.requestPermission({ mode: 'readwrite' })) === 'granted'; }
  const nomDossier = () => cloud() ? 'Cloudflare' : racine ? racine.name : null;
  // Écriture durable possible (sinon : téléchargement en ZIP)
  const ecritureDurable = () => cloud() ? estAdmin() : !!racine;

  async function dossier(chemin, creer) {
    let d = racine; for (const p of chemin.split('/').filter(Boolean)) d = await d.getDirectoryHandle(p, { create: !!creer }); return d;
  }
  async function fichierHandle(chemin, creer) {
    const parts = chemin.split('/'); const nom = parts.pop(); const d = await dossier(parts.join('/'), creer); return d.getFileHandle(nom, { create: !!creer });
  }
  async function lire(chemin) {
    if (cloud()) return cloudLire(chemin);
    if (!racine) return memoire.has(chemin) ? memoire.get(chemin) : null;
    try { const f = await (await fichierHandle(chemin)).getFile(); return f; } catch (e) { return null; }
  }
  async function lireTexte(chemin) { const f = await lire(chemin); if (f == null) return null; return typeof f === 'string' ? f : f.text ? f.text() : new TextDecoder().decode(f); }
  async function lireJSON(chemin) { const t = await lireTexte(chemin); try { return t ? JSON.parse(t) : null; } catch (e) { return null; } }
  async function lireBinaire(chemin) { const f = await lire(chemin); if (f == null) return null; return f.arrayBuffer ? f.arrayBuffer() : f; }
  async function ecrire(chemin, contenu) {
    if (cloud()) return cloudEcrire(chemin, contenu);
    if (!racine) { memoire.set(chemin, contenu instanceof Blob ? await contenu.arrayBuffer() : contenu); return; }
    const h = await fichierHandle(chemin, true); const w = await h.createWritable(); await w.write(contenu); await w.close();
  }
  const ecrireJSON = (chemin, obj) => ecrire(chemin, JSON.stringify(obj));
  async function lister(chemin) {
    if (cloud()) return cloudLister(chemin);
    if (!racine) { const pre = chemin.replace(/\/?$/, '/'); return [...new Set([...memoire.keys()].filter(k => k.startsWith(pre)).map(k => k.slice(pre.length).split('/')[0]))]; }
    try { const d = await dossier(chemin); const out = []; for await (const [n] of d.entries()) out.push(n); return out; } catch (e) { return []; }
  }

  // ---------- Mode cloud (Worker suivi-stats-api) ----------
  const API = 'https://suivi-stats-api.oli-baroukh.workers.dev';
  const CLE_SESSION = 'suiviStatsSession';
  let session = null; // { jeton, expire, profil }
  try { const x = JSON.parse(localStorage.getItem(CLE_SESSION) || 'null'); if (x && x.expire > Date.now()) session = x; else localStorage.removeItem(CLE_SESSION); } catch (e) {}
  const cloud = () => !!session;
  const estAdmin = () => !!session && session.profil && session.profil.role === 'admin';
  const profil = () => session ? session.profil : null;

  async function appel(chemin, opts) {
    const r = await fetch(API + chemin, { ...(opts || {}), headers: { ...((opts && opts.headers) || {}), Authorization: 'Bearer ' + session.jeton } });
    if (r.status === 401) { deconnecter(); throw new Error('Session expirée : reconnectez-vous.'); }
    return r;
  }
  async function connecter(identifiant, motDePasse) {
    const r = await fetch(API + '/auth/connexion', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifiant, motDePasse }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.ok) throw new Error(d.erreur || 'Connexion impossible');
    session = { jeton: d.session, expire: Date.now() + d.expireDansMs - 60000, profil: d.profil };
    localStorage.setItem(CLE_SESSION, JSON.stringify(session));
    return d.profil;
  }
  function deconnecter() { session = null; localStorage.removeItem(CLE_SESSION); }

  async function cloudLire(chemin) {
    if (estAdmin()) { const r = await appel('/fichiers?chemin=' + encodeURIComponent(chemin)); return r.ok ? r.blob() : null; }
    // Lecteurs : seules la photo du mois et le référentiel sont servis (déjà filtrés par le Worker)
    let m = chemin.match(/^donnees\/(\d{4}-\d{2})\/photo\.json$/);
    if (m) { const r = await appel('/donnees/photo?mois=' + m[1]); if (!r.ok) return null; const d = await r.json(); return new Blob([JSON.stringify(d.photo)], { type: 'application/json' }); }
    m = chemin.match(/^config\/((?:objectifs(?:-\d{4})?|objectifs-siege-\d{4}|taux-change|confidence-listes|actions-\d{4}|challenges-\d{4}))\.json$/);
    if (m) { const r = await appel('/donnees/config?nom=' + m[1]); if (!r.ok) return null; const d = await r.json(); return d.valeur == null ? null : new Blob([JSON.stringify(d.valeur)], { type: 'application/json' }); }
    if (chemin === 'config/referentiel.json') { const r = await appel('/donnees/referentiel'); if (!r.ok) return null; const d = await r.json(); return new Blob([JSON.stringify(d.referentiel)], { type: 'application/json' }); }
    return null;
  }
  async function cloudEcrire(chemin, contenu) {
    if (!estAdmin()) throw new Error('Enregistrement réservé aux administrateurs');
    const type = chemin.endsWith('.json') ? 'application/json' : chemin.endsWith('.csv') || chemin.endsWith('.txt') ? 'text/plain; charset=utf-8' : chemin.endsWith('.pdf') ? 'application/pdf' : (contenu && contenu.type) || 'application/octet-stream';
    const r = await appel('/fichiers?chemin=' + encodeURIComponent(chemin), { method: 'PUT', headers: { 'Content-Type': type }, body: contenu });
    if (!r.ok) throw new Error('Échec de l’enregistrement de ' + chemin);
  }
  async function cloudLister(chemin) {
    if (estAdmin()) { const r = await appel('/fichiers/liste?chemin=' + encodeURIComponent(chemin)); return r.ok ? (await r.json()).noms : []; }
    if (chemin.replace(/\/$/, '') === 'donnees') { const r = await appel('/donnees/mois'); return r.ok ? (await r.json()).mois.map(x => x.cle) : []; }
    return [];
  }

  // Reprise : copie d'un dossier local (Dropbox › Suivi Stats) vers Cloudflare, hors PDF de sorties/
  // Le sélecteur doit s'ouvrir immédiatement au clic (exigence de Chrome) : la confirmation vient après.
  async function copierDossierVersCloud(progres, confirmer) {
    if (!estAdmin()) throw new Error('Réservé aux administrateurs');
    const d = await root.showDirectoryPicker({ id: 'suivi-stats', mode: 'read' });
    const fichiers = [];
    const parcourir = async (h, pre) => { for await (const [n, x] of h.entries()) { if (n.startsWith('.')) continue; if (x.kind === 'directory') { if (!((pre === '' || pre === racineCopie) && n === 'sorties')) await parcourir(x, pre + n + '/'); } else fichiers.push([pre + n, x]); } };
    // Tolérance : si l'on a choisi directement le dossier « donnees » (ou un dossier ne contenant que des mois AAAA-MM),
    // les fichiers sont rangés sous donnees/ comme dans le dossier Suivi Stats.
    let racineCopie = '';
    const enfants = []; for await (const [n2, x] of d.entries()) if (!n2.startsWith('.')) enfants.push([n2, x.kind]);
    if (d.name === 'donnees' || (enfants.length && enfants.every(([n2, k]) => k === 'directory' && /^\d{4}(-\d{2})?$/.test(n2)))) racineCopie = 'donnees/';
    await parcourir(d, racineCopie);
    if (confirmer && !confirmer(fichiers.length, d.name, fichiers.map(f => f[0]))) return null;
    let n = 0, echecs = [];
    for (const [chemin, h] of fichiers) {
      try { await cloudEcrire(chemin, await h.getFile()); } catch (e) { echecs.push(chemin); }
      n++; if (progres) progres(n, fichiers.length, chemin);
    }
    return { total: fichiers.length, echecs, dossier: d.name };
  }

  root.Store = { api: (c, o) => appel(c, o), cloud, estAdmin, profil, connecter, deconnecter, copierDossierVersCloud, ecritureDurable, supporte, choisirDossier, restaurer, autoriser, nomDossier, lire, lireTexte, lireJSON, lireBinaire, ecrire, ecrireJSON, lister, _memoire: memoire };
})(typeof self !== 'undefined' ? self : this);
