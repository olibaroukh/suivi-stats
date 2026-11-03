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
// perimetre = { tous, pays: [], groupes: [], ar: [], natures: [], codes: [], exclurePays: [], exclureCodes: [] }
function norm(s) { return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase(); }
function codesAutorises(perimetre, referentiel) {
  const p = perimetre || {}, ens = new Set();
  const dans = (liste, v) => Array.isArray(liste) && liste.some(x => norm(x) === norm(v));
  for (const m of referentiel || []) {
    const c = String(m.code);
    let ok = !!p.tous || dans(p.codes, c) || dans(p.pays, m.pays) || dans(p.groupes, m.groupe) || dans(p.ar, m.ar) || dans(p.natures, m.nature);
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

// ---------- Connexion Zimbra ----------
async function authZimbra(identifiant, motDePasse) {
  const r = await fetch(ZIMBRA_SOAP_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ Header: { context: { _jsns: 'urn:zimbra', format: { type: 'js' } } }, Body: { AuthRequest: { _jsns: 'urn:zimbraAccount', account: { by: 'name', _content: identifiant }, password: { _content: motDePasse } } } }),
  });
  const d = await r.json().catch(() => null);
  return !!d?.Body?.AuthResponse?.authToken?.[0]?._content;
}

async function connexion(env, request, h) {
  const { identifiant, motDePasse } = await request.json().catch(() => ({}));
  const email = String(identifiant || '').trim().toLowerCase();
  if (!email.includes('@') || !motDePasse) return erreur('Adresse e-mail complète et mot de passe requis', 400, h);
  const e = await env.DB.prepare('SELECT nb, depuis FROM echecs WHERE identifiant = ?').bind(email).first();
  if (e && e.nb >= MAX_ECHECS && Date.now() - e.depuis < FENETRE_ECHECS_MS) return erreur('Trop de tentatives. Réessayez dans 15 minutes.', 429, h);
  const journal = res => env.DB.prepare('INSERT INTO connexions (email, le, resultat) VALUES (?, ?, ?)').bind(email, new Date().toISOString(), res).run();
  if (!(await authZimbra(email, motDePasse))) {
    const nb = e && Date.now() - e.depuis < FENETRE_ECHECS_MS ? e.nb + 1 : 1, depuis = nb === 1 ? Date.now() : e.depuis;
    await env.DB.prepare('INSERT INTO echecs (identifiant, nb, depuis) VALUES (?, ?, ?) ON CONFLICT(identifiant) DO UPDATE SET nb = excluded.nb, depuis = excluded.depuis').bind(email, nb, depuis).run();
    await journal('refus-zimbra');
    return erreur('Identifiants Zimbra invalides', 401, h);
  }
  await env.DB.prepare('DELETE FROM echecs WHERE identifiant = ?').bind(email).run();
  const p = await profil(env, email);
  if (!p) { await journal('non-autorise'); return erreur("Votre compte n'a pas accès à Suivi Stats. Demandez l'accès à Olivier Baroukh.", 403, h); }
  await journal('ok');
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
};

// ---------- Lien interne pour les autres Workers (zimbra-relay) ----------
// Accessible uniquement par une liaison de service déclarée dans Cloudflare,
// jamais depuis internet. Exemple côté zimbra-relay : await env.SUIVI.statsMagasin('101001')
export class SuiviStatsInterne extends WorkerEntrypoint {
  async moisDisponibles() {
    await schema(this.env);
    return (await this.env.DB.prepare('SELECT cle FROM mois ORDER BY cle DESC').all()).results.map(r => r.cle);
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
