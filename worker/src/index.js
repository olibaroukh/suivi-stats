/* Worker « suivi-stats-api » — données de Suivi Stats sur Cloudflare.
 *
 * Principes de sécurité :
 *  - Aucune donnée n'est lisible sans connexion personnelle (identifiants Zimbra).
 *    Pas de clé partagée : la seule porte d'entrée est la session signée remise
 *    à la connexion (12 h), vérifiée à chaque appel.
 *  - Droits relus en base à chaque appel : un compte désactivé perd l'accès aussitôt.
 *  - Administrateurs (Olivier) : accès complet aux fichiers (import, calcul, réglages).
 *    Lecteurs : uniquement la photo du mois et le référentiel, filtrés à leur périmètre.
 *  - Fichiers dans R2 (sans accès public), comptes et journal dans D1.
 *  - Les autres Workers (zimbra-relay) lisent les données par un lien interne
 *    (classe SuiviStatsInterne), jamais exposé sur internet.
 *
 * Secrets à saisir dans Cloudflare (Settings › Variables and Secrets) :
 *  - SESSION_KEY : longue chaîne aléatoire (signature des sessions).
 *  - ADMINS : adresse(s) Zimbra des administrateurs, séparées par des virgules.
 */
import { WorkerEntrypoint } from 'cloudflare:workers';

const ZIMBRA_SOAP_URL = 'https://zimbra.oc-pratique.com/service/soap';
const ORIGINES = ['https://olibaroukh.github.io'];
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_ECHECS = 5, FENETRE_ECHECS_MS = 15 * 60 * 1000;

// ---------- Utilitaires ----------
function cors(request) {
  const o = request.headers.get('Origin') || '';
  const h = { 'Vary': 'Origin' };
  if (ORIGINES.includes(o)) Object.assign(h, {
    'Access-Control-Allow-Origin': o,
    'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  });
  return h;
}
const json = (obj, status, h) => new Response(JSON.stringify(obj), { status: status || 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...h } });
const erreur = (msg, status, h) => json({ ok: false, erreur: msg }, status, h);
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64uTexte = s => b64u(new TextEncoder().encode(s));
const deB64u = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)));

async function signer(env, texte) {
  if (!env.SESSION_KEY || env.SESSION_KEY.length < 32) throw new Error('SESSION_KEY absente ou trop courte');
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.SESSION_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64u(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(texte)));
}
function egal(a, b) { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }

async function creerSession(env, email) {
  const charge = b64uTexte(JSON.stringify({ e: email, x: Date.now() + SESSION_TTL_MS }));
  return charge + '.' + await signer(env, charge);
}
async function lireSession(env, request) {
  const a = request.headers.get('Authorization') || '';
  const t = a.startsWith('Bearer ') ? a.slice(7) : '';
  const [charge, sig] = t.split('.');
  if (!charge || !sig) return null;
  if (!egal(sig, await signer(env, charge))) return null;
  let p; try { p = JSON.parse(deB64u(charge)); } catch (e) { return null; }
  if (!p.e || !p.x || p.x < Date.now()) return null;
  return p.e;
}

const estAdminEnv = (env, email) => String(env.ADMINS || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean).includes(email);

// ---------- Base D1 (tables créées au premier appel) ----------
let schemaPret = false;
async function schema(env) {
  if (schemaPret) return;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS utilisateurs (email TEXT PRIMARY KEY, nom TEXT, role TEXT NOT NULL DEFAULT 'lecteur', perimetre TEXT, ecrans TEXT, actif INTEGER NOT NULL DEFAULT 1, maj_le TEXT)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS connexions (email TEXT, le TEXT, resultat TEXT)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS echecs (identifiant TEXT PRIMARY KEY, nb INTEGER, depuis INTEGER)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS mois (cle TEXT PRIMARY KEY, enregistre_le TEXT, par TEXT)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS jetons_zimbra (email TEXT PRIMARY KEY, jeton TEXT NOT NULL, expire INTEGER NOT NULL)`),
  ]);
  schemaPret = true;
}

// Profil de la personne connectée (relu à chaque appel)
async function profil(env, email) {
  if (estAdminEnv(env, email)) return { email, role: 'admin', perimetre: { tous: true }, ecrans: null };
  const u = await env.DB.prepare('SELECT * FROM utilisateurs WHERE email = ? AND actif = 1').bind(email).first();
  if (!u) return null;
  return { email, nom: u.nom, role: u.role === 'admin' ? 'admin' : 'lecteur', perimetre: JSON.parse(u.perimetre || '{}'), ecrans: u.ecrans ? JSON.parse(u.ecrans) : null };
}

// ---------- Périmètre ----------
// perimetre = { tous, pays: [], groupes: [], ar: [], natures: [], codes: [], types: ['Succursale'|'Franchise'], exclurePays: [], exclureCodes: [] }
// types restreint le reste (les codes ajoutés à l'unité restent toujours visibles).
function norm(s) { return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase(); }
function codesAutorises(perimetre, referentiel) {
  const p = perimetre || {}, ens = new Set();
  const dans = (liste, v) => Array.isArray(liste) && liste.some(x => norm(x) === norm(v));
  for (const m of referentiel || []) {
    const c = String(m.code);
    let ok = !!p.tous || dans(p.codes, c) || dans(p.pays, m.pays) || dans(p.groupes, m.groupe) || dans(p.ar, m.ar) || dans(p.natures, m.nature);
    if (Array.isArray(p.types) && p.types.length && !dans(p.types, m.type) && !dans(p.codes, c)) ok = false;
    if (dans(p.exclurePays, m.pays) || dans(p.exclureCodes, c)) ok = false;
    if (ok) { ens.add(c); ens.add(c + 'A'); }
  }
  return ens;
}
function filtrerPhoto(photo, codes) {
  if (!photo) return null;
  const garder = obj => Object.fromEntries(Object.entries(obj || {}).filter(([c]) => codes.has(String(c))));
  const rh = (photo.rh || []).filter(p => (p.codes || []).some(c => codes.has(String(c))));
  const matricules = new Set(rh.map(p => String(p.matricule)));
  const stats = Object.fromEntries(Object.entries(photo.statsVendeurs || {}).filter(([m]) => matricules.has(String(m))));
  // Le bloc « groupe » (totaux réseau) n'est remis qu'aux personnes qui voient tout le réseau.
  return { ...photo, magasins: garder(photo.magasins), equipes: garder(photo.equipes), rh, statsVendeurs: stats, groupe: null, perimetreFiltre: true };
}

// ---------- Fichiers (R2) ----------
function cheminValide(c) {
  return typeof c === 'string' && c.length > 0 && c.length < 400 && !c.includes('..') && !c.startsWith('/') && /^[\p{L}\p{N} ._()'’,+&@-]+(\/[\p{L}\p{N} ._()'’,+&@-]+)*$/u.test(c);
}
async function lireJSON(env, chemin) { const o = await env.FICHIERS.get(chemin); if (!o) return null; try { return await o.json(); } catch (e) { return null; } }

// ---------- Taux de change (mise à jour automatique le 1er du mois) ----------
// Valeur d'une unité de devise en euros, d'après les cours de référence de la BCE (service Frankfurter, sans clé).
const DEVISES_ISO = { 'Shekel': 'ILS', 'Franc Suisse': 'CHF', 'Livre Sterling': 'GBP', 'Dollars Canadien': 'CAD', 'Dolard': 'USD' };
async function majTaux(env, par) {
  const iso = Object.values(DEVISES_ISO).join(',');
  let d = null;
  for (const u of [`https://api.frankfurter.dev/v1/latest?base=EUR&symbols=${iso}`, `https://api.frankfurter.app/latest?from=EUR&to=${iso}`]) {
    try { const r = await fetch(u, { headers: { 'Accept': 'application/json' } }); if (r.ok) { d = await r.json(); if (d && d.rates) break; } } catch (e) {}
  }
  if (!d || !d.rates) throw new Error('cours indisponibles');
  const taux = { 'Euro': 1 };
  for (const [dev, code] of Object.entries(DEVISES_ISO)) if (d.rates[code]) taux[dev] = Math.round(1 / d.rates[code] * 10000) / 10000;
  taux._maj = d.date; taux._source = 'BCE (cours de référence)'; taux._par = par;
  await env.FICHIERS.put('config/taux-change.json', JSON.stringify(taux), { httpMetadata: { contentType: 'application/json' } });
  const h = (await lireJSON(env, 'config/taux-historique.json')) || {};
  h[String(d.date).slice(0, 7)] = taux;
  await env.FICHIERS.put('config/taux-historique.json', JSON.stringify(h), { httpMetadata: { contentType: 'application/json' } });
  return taux;
}

// ---------- Pièces jointes Zimbra ----------
const ZIMBRA_REST = 'https://zimbra.oc-pratique.com/service/home/~/';
async function soap(jeton, corps) {
  const r = await fetch(ZIMBRA_SOAP_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ Header: { context: { _jsns: 'urn:zimbra', authToken: { _content: jeton }, format: { type: 'js' } } }, Body: corps }) });
  const d = await r.json().catch(() => null);
  if (!d || d.Body?.Fault) throw new Error(d?.Body?.Fault?.Reason?.Text || 'réponse invalide');
  return d.Body;
}
function piecesDe(mp, out) { for (const p of mp || []) { if (p.filename && p.part) out.push({ part: p.part, nom: p.filename, taille: p.s || null }); if (p.mp) piecesDe(p.mp, out); } return out; }
// Fenêtre : du 20 du mois précédent (certains envois arrivent le dernier jour du mois d'avant) au 25 du mois suivant.
// Le bon fichier est ensuite choisi par l'appli d'après la période inscrite dans les exports.
async function piecesDuMois(jeton, mois) {
  const [a, m] = mois.split('-').map(Number);
  const debut = Date.UTC(a, m - 2, 20), fin = Date.UTC(a, m, 26);
  const pieces = [];
  for (let offset = 0; offset < 1000; offset += 100) {
    const b = await soap(jeton, { SearchRequest: { _jsns: 'urn:zimbraMail', types: 'message', query: 'has:attachment', sortBy: 'dateDesc', limit: 100, offset, fetch: 'all', html: 0, max: 1 } });
    const res = b.SearchResponse || {}, ms = res.m || [];
    for (const msg of ms) {
      if (msg.d > fin || msg.d < debut) continue;
      for (const p of piecesDe(msg.mp, [])) {
        const nom = p.nom, sujet = msg.su || '';
        let type = null;
        if (/\.zip$/i.test(nom) && /\d{2}OPTI\d+/i.test(nom + ' ' + sujet)) type = 'cosium';
        else if (/^confidence-dashboard.*\.xlsx$/i.test(nom)) type = 'confidence';
        else if (/\.xlsx?$/i.test(nom) && /(rest|indus|avoir)/i.test(nom + ' ' + sujet)) type = 'restes';
        if (type) pieces.push({ id: msg.id, part: p.part, nom, taille: p.taille, date: msg.d, sujet, type });
      }
    }
    if (!res.more || !ms.length || ms[ms.length - 1].d < debut) break;
  }
  return pieces;
}

// ---------- Connexion Zimbra ----------
async function authZimbra(identifiant, motDePasse) {
  const r = await fetch(ZIMBRA_SOAP_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ Header: { context: { _jsns: 'urn:zimbra', format: { type: 'js' } } }, Body: { AuthRequest: { _jsns: 'urn:zimbraAccount', account: { by: 'name', _content: identifiant }, password: { _content: motDePasse } } } }),
  });
  const d = await r.json().catch(() => null);
  const a = d?.Body?.AuthResponse;
  const jeton = a?.authToken?.[0]?._content;
  return jeton ? { jeton, dureeMs: Number(a.lifetime) || SESSION_TTL_MS } : null;
}

async function connexion(env, request, h) {
  const { identifiant, motDePasse } = await request.json().catch(() => ({}));
  const email = String(identifiant || '').trim().toLowerCase();
  if (!email.includes('@') || !motDePasse) return erreur('Adresse e-mail complète et mot de passe requis', 400, h);
  const e = await env.DB.prepare('SELECT nb, depuis FROM echecs WHERE identifiant = ?').bind(email).first();
  if (e && e.nb >= MAX_ECHECS && Date.now() - e.depuis < FENETRE_ECHECS_MS) return erreur('Trop de tentatives. Réessayez dans 15 minutes.', 429, h);
  const journal = res => env.DB.prepare('INSERT INTO connexions (email, le, resultat) VALUES (?, ?, ?)').bind(email, new Date().toISOString(), res).run();
  const z = await authZimbra(email, motDePasse);
  if (!z) {
    const nb = e && Date.now() - e.depuis < FENETRE_ECHECS_MS ? e.nb + 1 : 1, depuis = nb === 1 ? Date.now() : e.depuis;
    await env.DB.prepare('INSERT INTO echecs (identifiant, nb, depuis) VALUES (?, ?, ?) ON CONFLICT(identifiant) DO UPDATE SET nb = excluded.nb, depuis = excluded.depuis').bind(email, nb, depuis).run();
    await journal('refus-zimbra');
    return erreur('Identifiants Zimbra invalides', 401, h);
  }
  await env.DB.prepare('DELETE FROM echecs WHERE identifiant = ?').bind(email).run();
  const p = await profil(env, email);
  if (!p) { await journal('non-autorise'); return erreur("Votre compte n'a pas accès à Suivi Stats. Demandez l'accès à Olivier Baroukh.", 403, h); }
  await journal('ok');
  // Administrateurs : le jeton Zimbra est gardé côté serveur (jamais renvoyé) pour récupérer les pièces jointes du mois
  if (p.role === 'admin') await env.DB.prepare('INSERT INTO jetons_zimbra (email, jeton, expire) VALUES (?, ?, ?) ON CONFLICT(email) DO UPDATE SET jeton = excluded.jeton, expire = excluded.expire')
    .bind(email, z.jeton, Date.now() + Math.min(z.dureeMs, SESSION_TTL_MS)).run();
  return json({ ok: true, session: await creerSession(env, email), expireDansMs: SESSION_TTL_MS, profil: p }, 200, h);
}

// ---------- Routes ----------
async function routes(request, env) {
  const h = cors(request), url = new URL(request.url), chemin = url.pathname;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
  await schema(env);

  if (chemin === '/' ) return json({ ok: true, service: 'suivi-stats-api' }, 200, h);
  if (chemin === '/auth/connexion' && request.method === 'POST') return connexion(env, request, h);

  const email = await lireSession(env, request);
  if (!email) return erreur('Connexion requise', 401, h);
  const p = await profil(env, email);
  if (!p) return erreur('Accès retiré', 403, h);
  const admin = p.role === 'admin';

  if (chemin === '/auth/moi') return json({ ok: true, profil: p }, 200, h);

  // Lecture filtrée (tous les comptes)
  if (chemin === '/donnees/mois') {
    const r = await env.DB.prepare('SELECT cle, enregistre_le FROM mois ORDER BY cle DESC').all();
    return json({ ok: true, mois: r.results }, 200, h);
  }
  if (chemin === '/donnees/photo') {
    const m = url.searchParams.get('mois') || '';
    if (!/^\d{4}-\d{2}$/.test(m)) return erreur('Paramètre mois (AAAA-MM) requis', 400, h);
    const photo = await lireJSON(env, `donnees/${m}/photo.json`);
    if (!photo) return erreur('Mois non enregistré', 404, h);
    if (admin || p.perimetre.tous) return json({ ok: true, photo }, 200, h);
    const ref = await lireJSON(env, 'config/referentiel.json');
    return json({ ok: true, photo: filtrerPhoto(photo, codesAutorises(p.perimetre, ref)) }, 200, h);
  }
  if (chemin === '/donnees/referentiel') {
    const ref = (await lireJSON(env, 'config/referentiel.json')) || [];
    if (admin || p.perimetre.tous) return json({ ok: true, referentiel: ref }, 200, h);
    const codes = codesAutorises(p.perimetre, ref);
    return json({ ok: true, referentiel: ref.filter(m => codes.has(String(m.code))) }, 200, h);
  }

  // Réglages communs non sensibles (objectifs, taux de change) : nécessaires aux fiches et cockpits
  if (chemin === '/donnees/config') {
    const nom = url.searchParams.get('nom') || '';
    if (!/^(objectifs(-\d{4})?|objectifs-siege-\d{4}|taux-change|confidence-listes|actions-\d{4})$/.test(nom)) return erreur('Réglage non disponible', 403, h);
    return json({ ok: true, valeur: await lireJSON(env, `config/${nom}.json`) }, 200, h);
  }

  if (!admin) return erreur('Réservé aux administrateurs', 403, h);

  // Fichiers bruts (administrateurs) : même logique que le dossier Dropbox
  if (chemin === '/fichiers') {
    const c = url.searchParams.get('chemin');
    if (!cheminValide(c)) return erreur('Chemin invalide', 400, h);
    if (request.method === 'GET') {
      const o = await env.FICHIERS.get(c);
      if (!o) return erreur('Introuvable', 404, h);
      return new Response(o.body, { headers: { 'Content-Type': o.httpMetadata?.contentType || 'application/octet-stream', 'Cache-Control': 'no-store', ...h } });
    }
    if (request.method === 'PUT') {
      await env.FICHIERS.put(c, request.body, { httpMetadata: { contentType: request.headers.get('Content-Type') || 'application/octet-stream' }, customMetadata: { par: email } });
      const mm = c.match(/^donnees\/(\d{4}-\d{2})\/photo\.json$/);
      if (mm) await env.DB.prepare('INSERT INTO mois (cle, enregistre_le, par) VALUES (?, ?, ?) ON CONFLICT(cle) DO UPDATE SET enregistre_le = excluded.enregistre_le, par = excluded.par').bind(mm[1], new Date().toISOString(), email).run();
      return json({ ok: true }, 200, h);
    }
  }
  if (chemin === '/fichiers/liste') {
    const c = (url.searchParams.get('chemin') || '').replace(/\/?$/, '/');
    if (c !== '/' && !cheminValide(c.slice(0, -1))) return erreur('Chemin invalide', 400, h);
    const prefixe = c === '/' ? '' : c, noms = new Set();
    let curseur;
    do {
      const r = await env.FICHIERS.list({ prefix: prefixe, delimiter: '/', cursor: curseur });
      r.objects.forEach(o => noms.add(o.key.slice(prefixe.length)));
      (r.delimitedPrefixes || []).forEach(d => noms.add(d.slice(prefixe.length).replace(/\/$/, '')));
      curseur = r.truncated ? r.cursor : null;
    } while (curseur);
    return json({ ok: true, noms: [...noms] }, 200, h);
  }

  // Pièces jointes Zimbra du mois (administrateurs)
  if (chemin === '/zimbra/pieces' || chemin === '/zimbra/piece') {
    const j = await env.DB.prepare('SELECT jeton, expire FROM jetons_zimbra WHERE email = ?').bind(email).first();
    if (!j || j.expire < Date.now()) return erreur('Connexion Zimbra expirée : déconnectez-vous puis reconnectez-vous.', 409, h);
    if (chemin === '/zimbra/pieces') {
      const m = url.searchParams.get('mois') || '';
      if (!/^\d{4}-\d{2}$/.test(m)) return erreur('Paramètre mois (AAAA-MM) requis', 400, h);
      try { return json({ ok: true, pieces: await piecesDuMois(j.jeton, m) }, 200, h); }
      catch (e) { return erreur('Zimbra : ' + e.message, 502, h); }
    }
    const id = url.searchParams.get('id') || '', part = url.searchParams.get('part') || '';
    if (!/^-?\d+(:\d+)?$/.test(id) || !/^[\d.]+$/.test(part)) return erreur('Paramètres invalides', 400, h);
    const r = await fetch(`${ZIMBRA_REST}?auth=co&id=${encodeURIComponent(id)}&part=${encodeURIComponent(part)}`, { headers: { Cookie: 'ZM_AUTH_TOKEN=' + j.jeton } });
    if (!r.ok) return erreur('Pièce jointe introuvable (' + r.status + ')', 502, h);
    return new Response(r.body, { headers: { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store', ...h } });
  }

  if (chemin === '/admin/taux' && request.method === 'POST') {
    try { return json({ ok: true, taux: await majTaux(env, email) }, 200, h); } catch (e) { return erreur('Taux : ' + e.message, 502, h); }
  }

  // Données de zimbra-relay lues côté serveur par le lien interne RELAIS (administrateurs)
  if (chemin === '/relais/google' || chemin === '/relais/sante' || chemin === '/relais/bilans') {
    if (!env.RELAIS) return erreur('Lien interne vers zimbra-relay absent', 500, h);
    try {
      let d;
      if (chemin === '/relais/google') d = await env.RELAIS.googleRatings();
      else if (chemin === '/relais/sante') { const m = url.searchParams.get('mois') || ''; if (!/^\d{4}-\d{2}$/.test(m)) return erreur('Paramètre mois (AAAA-MM) requis', 400, h); d = await env.RELAIS.santeMensuel(m); }
      else { const du = url.searchParams.get('du') || '', au = url.searchParams.get('au') || ''; if (!/^\d{4}-\d{2}-\d{2}$/.test(du) || !/^\d{4}-\d{2}-\d{2}$/.test(au)) return erreur('Paramètres du / au (AAAA-MM-JJ) requis', 400, h); d = await env.RELAIS.bilans(du, au); }
      return json(d, 200, h);
    } catch (e) { return erreur('zimbra-relay : ' + e.message, 502, h); }
  }

  // Gestion des accès (administrateurs)
  if (chemin === '/admin/utilisateurs' && request.method === 'GET') {
    const r = await env.DB.prepare('SELECT * FROM utilisateurs ORDER BY nom, email').all();
    return json({ ok: true, utilisateurs: r.results.map(u => ({ ...u, perimetre: JSON.parse(u.perimetre || '{}'), ecrans: u.ecrans ? JSON.parse(u.ecrans) : null })) }, 200, h);
  }
  if (chemin === '/admin/utilisateurs' && request.method === 'PUT') {
    const u = await request.json().catch(() => null);
    const em = String(u?.email || '').trim().toLowerCase();
    if (!em.includes('@')) return erreur('E-mail requis', 400, h);
    await env.DB.prepare(`INSERT INTO utilisateurs (email, nom, role, perimetre, ecrans, actif, maj_le) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(email) DO UPDATE SET nom = excluded.nom, role = excluded.role, perimetre = excluded.perimetre, ecrans = excluded.ecrans, actif = excluded.actif, maj_le = excluded.maj_le`)
      .bind(em, u.nom || null, u.role === 'admin' ? 'admin' : 'lecteur', JSON.stringify(u.perimetre || {}), u.ecrans ? JSON.stringify(u.ecrans) : null, u.actif === false ? 0 : 1, new Date().toISOString()).run();
    return json({ ok: true }, 200, h);
  }
  if (chemin === '/admin/connexions') {
    const r = await env.DB.prepare('SELECT * FROM connexions ORDER BY le DESC LIMIT 200').all();
    return json({ ok: true, connexions: r.results }, 200, h);
  }

  return erreur('Introuvable', 404, h);
}

export default {
  async fetch(request, env) {
    try { return await routes(request, env); }
    catch (e) { console.error(e); return erreur('Erreur interne', 500, cors(request)); }
  },
  // Tâche planifiée (wrangler.toml › triggers) : le 1er de chaque mois, mise à jour des taux de change
  async scheduled(event, env, ctx) {
    ctx.waitUntil(majTaux(env, 'automatique').catch(e => console.error('taux', e)));
  },
};

// ---------- Lien interne pour les autres Workers (zimbra-relay) ----------
// Accessible uniquement par une liaison de service déclarée dans Cloudflare,
// jamais depuis internet. Exemple côté zimbra-relay : await env.SUIVI.statsMagasin('101001')
export class SuiviStatsInterne extends WorkerEntrypoint {
  async moisDisponibles() {
    await schema(this.env);
    return (await this.env.DB.prepare('SELECT cle FROM mois ORDER BY cle DESC').all()).results.map(r => r.cle);
  }
  // Référentiel « terrain » pour les applis de zimbra-relay (remplace magasins.csv) :
  // succursales France actives + magasins ayant un animateur terrain ; effectifs, effectif théorique
  // et objectif annuel calculés à partir de la dernière photo enregistrée.
  async referentielTerrain() {
    await schema(this.env);
    const ref = (await lireJSON(this.env, 'config/referentiel.json')) || [];
    const m = (await this.moisDisponibles())[0];
    const photo = m ? await lireJSON(this.env, `donnees/${m}/photo.json`) : null;
    const oui = v => /^(oui|1|true|x)$/i.test(String(v || '').trim());
    return {
      mois: m || null,
      // Camions OC Mobile exclus pour l'instant (pas suivis dans les applis terrain ; une version OC Mobile est à prévoir)
      magasins: ref.filter(r => r.actif === 'Oui' && r.nature !== 'Camion' && ((r.pays === 'FRANCE' && r.type === 'Succursale') || (r.animateur && String(r.animateur).trim())))
        .map(r => {
          const c = String(r.code), d = photo && photo.magasins[c], N = (d && d.N) || {}, eq = (photo && photo.equipes && photo.equipes[c]) || null;
          const part = p => p.part != null ? p.part : 1;
          const effOpt = eq ? eq.filter(p => p.famille !== 'audio').reduce((a, p) => a + part(p), 0) : null;
          const effAudio = eq ? eq.filter(p => p.famille === 'audio').reduce((a, p) => a + part(p), 0) : null;
          const effTheo = N.P != null && photo ? Math.max(3.5, N.P * 12 / photo.mois / 250000) : null;
          return {
            code: c, libelle: r.libelleBilans || r.magasin || '', email: r.email || '', manager: r.manager || '',
            effOpt, effAudio, effTheo: effTheo == null ? null : Math.round(effTheo * 10) / 10,
            animateur: (r.animateur && String(r.animateur).trim()) || r.ar || '', animateurEmail: (r.animateurEmail && String(r.animateurEmail).trim()) || r.arEmail || '',
            googlePlaceId: r.googlePlaceId || '', concept: r.concept || '', meubleVitrine: oui(r.meubleVitrine), presentoirVerres: oui(r.presentoirVerres),
            statut: r.type === 'Franchise' ? 'franchise' : '', objectifAnnuel: N.O != null ? N.O : null, alsaceMoselle: oui(r.alsaceMoselle),
            type: r.type || '', pays: r.pays || '', ar: r.ar || '',
          };
        }),
    };
  }
  async statsMagasin(code, mois) {
    await schema(this.env);
    const m = mois || (await this.moisDisponibles())[0];
    if (!m) return null;
    const photo = await lireJSON(this.env, `donnees/${m}/photo.json`);
    const c = String(code);
    if (!photo || !photo.magasins || !photo.magasins[c]) return { mois: m, magasin: null };
    return { mois: m, magasin: photo.magasins[c], equipe: (photo.equipes || {})[c] || null };
  }
}
