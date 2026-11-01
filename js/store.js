/* Stockage : dossier choisi sur l'ordinateur (Dropbox) via l'API File System Access de Chrome.
 * Rien n'est envoyé en ligne : l'appli lit et écrit uniquement dans ce dossier.
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
  const nomDossier = () => racine ? racine.name : null;

  async function dossier(chemin, creer) {
    let d = racine; for (const p of chemin.split('/').filter(Boolean)) d = await d.getDirectoryHandle(p, { create: !!creer }); return d;
  }
  async function fichierHandle(chemin, creer) {
    const parts = chemin.split('/'); const nom = parts.pop(); const d = await dossier(parts.join('/'), creer); return d.getFileHandle(nom, { create: !!creer });
  }
  async function lire(chemin) {
    if (!racine) return memoire.has(chemin) ? memoire.get(chemin) : null;
    try { const f = await (await fichierHandle(chemin)).getFile(); return f; } catch (e) { return null; }
  }
  async function lireTexte(chemin) { const f = await lire(chemin); if (f == null) return null; return typeof f === 'string' ? f : f.text ? f.text() : new TextDecoder().decode(f); }
  async function lireJSON(chemin) { const t = await lireTexte(chemin); try { return t ? JSON.parse(t) : null; } catch (e) { return null; } }
  async function lireBinaire(chemin) { const f = await lire(chemin); if (f == null) return null; return f.arrayBuffer ? f.arrayBuffer() : f; }
  async function ecrire(chemin, contenu) {
    if (!racine) { memoire.set(chemin, contenu instanceof Blob ? await contenu.arrayBuffer() : contenu); return; }
    const h = await fichierHandle(chemin, true); const w = await h.createWritable(); await w.write(contenu); await w.close();
  }
  const ecrireJSON = (chemin, obj) => ecrire(chemin, JSON.stringify(obj));
  async function lister(chemin) {
    if (!racine) { const pre = chemin.replace(/\/?$/, '/'); return [...new Set([...memoire.keys()].filter(k => k.startsWith(pre)).map(k => k.slice(pre.length).split('/')[0]))]; }
    try { const d = await dossier(chemin); const out = []; for await (const [n] of d.entries()) out.push(n); return out; } catch (e) { return []; }
  }

  root.Store = { supporte, choisirDossier, restaurer, autoriser, nomDossier, lire, lireTexte, lireJSON, lireBinaire, ecrire, ecrireJSON, lister, _memoire: memoire };
})(typeof self !== 'undefined' ? self : this);
