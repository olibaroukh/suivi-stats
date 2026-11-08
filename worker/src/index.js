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
import { routesSeminaire, compteSeminaire } from './seminaire.js';

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

// Âge de la session (depuis la connexion), pour la règle des 2 h du séminaire franchisés
function ageSession(request) {
  try { const t = (request.headers.get('Authorization') || '').slice(7).split('.')[0]; const p = JSON.parse(deB64u(t)); return Date.now() - (p.x - SESSION_TTL_MS); } catch (e) { return Infinity; }
}
const SESSION_SEMINAIRE_MS = 2 * 60 * 60 * 1000;
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
    // 07/11/2026 : relève automatique de la boîte Zimbra (pièces jointes utiles copiées dans R2)
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS releve_pieces (id TEXT NOT NULL, part TEXT NOT NULL, nom TEXT, type TEXT, date INTEGER, sujet TEXT, taille INTEGER, cle_r2 TEXT, releve_le INTEGER, PRIMARY KEY (id, part))`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS releve_journal (le INTEGER, par TEXT, statut TEXT, detail TEXT)`),
    // 07/11/2026 : diffusion mensuelle des PDF par mail
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS diffusion_envois (mois TEXT, email TEXT, le INTEGER, statut TEXT, PRIMARY KEY (mois, email))`),
  ]);
  schemaPret = true;
}

// Profil de la personne connectée (relu à chaque appel)
async function profil(env, email) {
  if (estAdminEnv(env, email)) return { email, role: 'admin', perimetre: { tous: true }, ecrans: null };
  const u = await env.DB.prepare('SELECT * FROM utilisateurs WHERE email = ? AND actif = 1').bind(email).first();
  if (!u) {
    // 08/11/2026 : compte « séminaire franchisés » seul (directeur de pôle sans accès à Suivi Stats)
    const s = await compteSeminaire(env, email);
    return s ? { email, nom: s.nom, role: 'seminaire', perimetre: {}, ecrans: ['seminaire'] } : null;
  }
  return { email, nom: u.nom, role: u.role === 'admin' ? 'admin' : 'lecteur', perimetre: JSON.parse(u.perimetre || '{}'), ecrans: u.ecrans ? JSON.parse(u.ecrans) : null };
}

// ---------- Périmètre ----------
// perimetre = { tous, pays: [], groupes: [], ar: [], directeursPays: [], natures: [], codes: [], types: ['Succursale'|'Franchise'], exclurePays: [], exclureCodes: [] }
// types restreint le reste (les codes ajoutés à l'unité restent toujours visibles).
function norm(s) { return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase(); }
function codesAutorises(perimetre, referentiel) {
  const p = perimetre || {}, ens = new Set();
  const dans = (liste, v) => Array.isArray(liste) && liste.some(x => norm(x) === norm(v));
  for (const m of referentiel || []) {
    const c = String(m.code);
    let ok = !!p.tous || dans(p.codes, c) || dans(p.pays, m.pays) || dans(p.groupes, m.groupe) || dans(p.ar, m.ar) || dans(p.directeursPays, m.directeurPays) || dans(p.natures, m.nature);
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
function structureParts(mp, out = [], prof = 0) { for (const p of mp || []) { out.push(`${'›'.repeat(prof)}${p.part || '?'} ${p.ct || ''}${p.filename ? ' «' + p.filename + '»' : ''}${p.cd ? ' ' + p.cd : ''}${p.s ? ' ' + p.s + 'o' : ''}`); if (p.mp) structureParts(p.mp, out, prof + 1); } return out; }
function piecesDe(mp, out) { for (const p of mp || []) { if (p.filename && p.part) out.push({ part: p.part, nom: p.filename, taille: p.s || null, ct: p.ct || '' }); if (p.mp) piecesDe(p.mp, out); } return out; }
// 07/11/2026 : seules les pièces dont le NOM DE FICHIER correspond à une source connue sont prises (jamais d'après l'objet du mail,
// pour ne pas ramasser des pièces jointes personnelles : candidatures, RH…).
function typePiece(nom, sujet, ct) {
  // Cosium : ZIP (par l'extension ou le type de contenu) d'un mail « XXOPTI… n/4 - Résultats des statistiques »
  if ((/\.zip$/i.test(nom) || /zip/i.test(ct || '')) && /\d{2}\s*OPTI\s*\d+|r.sultats des statistiques/i.test(nom + ' ' + (sujet || ''))) return 'cosium';
  if (/^confidence-dashboard.*\.xlsx$/i.test(nom)) return 'confidence';
  if (/\.xlsx?$/i.test(nom) && /(taux.?d.?indus|restes?.?dus)/i.test(nom)) return 'restes';
  if (/\.xlsx?$/i.test(nom) && /^(T07.?MARGES|T12.?RENTASAL|T20|T21|T10)(?!\d)|CONSODETAIL|AVIS.?SUR.?GOOGLE|MR.?QUALIT|TCD/i.test(nom)) return 'autre';
  if (/\.zip$/i.test(nom) && /EXTERNAL.?RELATIONS?/i.test(nom)) return 'autre';
  if (/\.csv$/i.test(nom) && /(AVOIR|FACTURE)/i.test(nom)) return 'autre';
  return null;
}
// Fenêtre : du 20 du mois précédent (certains envois arrivent le dernier jour du mois d'avant) au 25 du mois suivant.
// Le bon fichier est ensuite choisi par l'appli d'après la période inscrite dans les exports.
async function piecesDuMois(jeton, mois) {
  const [a, m] = mois.split('-').map(Number);
  const debut = Date.UTC(a, m - 2, 20), fin = Date.UTC(a, m, 26);
  const pieces = [], vus = new Set(), diag = { mailsCosium: 0 };
  // 1) recherche ciblée des mails Cosium, 2) toutes les pièces jointes récentes (dans toute la boîte, hors corbeille)
  for (const query of ['"statistiques" has:attachment', 'has:attachment']) {
    for (let offset = 0; offset < 1000; offset += 100) {
      const b = await soap(jeton, { SearchRequest: { _jsns: 'urn:zimbraMail', types: 'message', query, sortBy: 'dateDesc', limit: 100, offset, fetch: 'all', html: 0, max: 1 } });
      const res = b.SearchResponse || {}, ms = res.m || [];
      for (const msg of ms) {
        if (msg.d > fin || msg.d < debut || vus.has(msg.id)) continue;
        vus.add(msg.id);
        const sujet = msg.su || '';
        if (/\d{2}\s*OPTI\s*\d+/i.test(sujet)) { diag.mailsCosium++; if (!diag.exemple) diag.exemple = `« ${sujet} » : ` + (structureParts(msg.mp).join(' | ') || 'aucune partie renvoyée'); }
        const parts = piecesDe(msg.mp, []);
        // 07/11/2026 : les mails Cosium contiennent directement les CSV (pas de ZIP) → une seule pièce par mail, téléchargée en ZIP
        const mc = sujet.match(/(\d{2})\s*OPTI\s*(\d+)\s*(\d)\s*\/\s*4/i), csv = parts.filter(p => /\.csv$/i.test(p.nom));
        if (mc && csv.length && !parts.some(p => /\.zip$/i.test(p.nom))) {
          pieces.push({ id: msg.id, part: csv.map(p => p.part).join(','), nom: `${mc[1]}OPTI${mc[2]}_${mc[3]}4_Resultats.zip`, taille: csv.reduce((a, p) => a + (p.taille || 0), 0), date: msg.d, sujet, type: 'cosium' });
          continue;
        }
        for (const p of parts) {
          const type = typePiece(p.nom, sujet, p.ct);
          if (type) pieces.push({ id: msg.id, part: p.part, nom: p.nom, taille: p.taille, date: msg.d, sujet, type });
        }
      }
      if (!res.more || !ms.length || ms[ms.length - 1].d < debut) break;
    }
  }
  pieces.diag = diag;
  return pieces;
}

// Téléchargement d'une pièce (ou d'un groupe de CSV « 2,3,4 » regroupés en ZIP)
async function telechargerPiece(jeton, id, part) {
  const base = `${ZIMBRA_REST}?auth=co&id=${encodeURIComponent(id)}`, cookie = { headers: { Cookie: 'ZM_AUTH_TOKEN=' + jeton } };
  if (!String(part).includes(',')) { const r = await fetch(`${base}&part=${encodeURIComponent(part)}`, cookie); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.arrayBuffer(); }
  const r = await fetch(`${base}&part=${encodeURIComponent(part)}&fmt=zip&disp=a&filename=Resultats.zip`, cookie);
  if (r.ok) { const b = await r.arrayBuffer(); const u = new Uint8Array(b); if (u[0] === 0x50 && u[1] === 0x4b) return b; }
  // Repli : chaque CSV téléchargé puis réunis dans un ZIP (sans compression)
  const fichiers = [];
  for (const p of String(part).split(',')) {
    const x = await fetch(`${base}&part=${encodeURIComponent(p)}`, cookie); if (!x.ok) throw new Error('HTTP ' + x.status);
    const cd = x.headers.get('Content-Disposition') || '', nm = (cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i) || [])[1];
    fichiers.push({ nom: nm ? decodeURIComponent(nm) : `piece_${p}.csv`, data: new Uint8Array(await x.arrayBuffer()) });
  }
  return zipStocke(fichiers);
}
let CRC_TABLE = null;
function crc32(u) { if (!CRC_TABLE) { CRC_TABLE = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; CRC_TABLE[n] = c >>> 0; } }
  let c = 0xFFFFFFFF; for (let i = 0; i < u.length; i++) c = CRC_TABLE[(c ^ u[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function zipStocke(fichiers) {
  const enc = new TextEncoder(), loc = [], cen = []; let off = 0;
  for (const f of fichiers) {
    const nom = enc.encode(f.nom), crc = crc32(f.data), n = f.data.length;
    const h = new DataView(new ArrayBuffer(30)); h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint32(14, crc, true); h.setUint32(18, n, true); h.setUint32(22, n, true); h.setUint16(26, nom.length, true);
    const c = new DataView(new ArrayBuffer(46)); c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint32(16, crc, true); c.setUint32(20, n, true); c.setUint32(24, n, true); c.setUint16(28, nom.length, true); c.setUint32(42, off, true);
    loc.push(new Uint8Array(h.buffer), nom, f.data); cen.push(new Uint8Array(c.buffer), nom); off += 30 + nom.length + n;
  }
  const tailleCen = cen.reduce((a, x) => a + x.length, 0), e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, fichiers.length, true); e.setUint16(10, fichiers.length, true); e.setUint32(12, tailleCen, true); e.setUint32(16, off, true);
  const tout = [...loc, ...cen, new Uint8Array(e.buffer)], out = new Uint8Array(tout.reduce((a, x) => a + x.length, 0)); let i = 0; for (const x of tout) { out.set(x, i); i += x.length; }
  return out.buffer;
}

// ---------- Diffusion mensuelle (PDF préparés par l'appli dans diffusion/AAAA-MM/, envoyés depuis la boîte Zimbra) ----------
const MOIS_LIB = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
async function envoyerMailZimbra(jeton, { a, nom, sujet, texte, pdf, nomPdf }) {
  const up = await fetch('https://zimbra.oc-pratique.com/service/upload?fmt=raw', { method: 'POST', headers: { Cookie: 'ZM_AUTH_TOKEN=' + jeton, 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${nomPdf}"` }, body: pdf });
  const t = await up.text(), aid = (t.match(/'([^']+)'\s*$/) || t.match(/,'[^']*','([^']+)'/) || [])[1];
  if (!up.ok || !aid) throw new Error('dépôt de la pièce jointe refusé (' + up.status + ')');
  await soap(jeton, { SendMsgRequest: { _jsns: 'urn:zimbraMail', m: { e: [{ t: 't', a, p: nom || undefined }], su: { _content: sujet }, mp: [{ ct: 'text/plain', content: { _content: texte } }], attach: { aid } } } });
}
async function diffuser(env, mois, { test = false, par = 'auto' } = {}) {
  await schema(env);
  const idx = await lireJSON(env, `diffusion/${mois}/index.json`);
  if (!idx || !(idx.destinataires || []).length) return { ok: false, erreur: 'PDF de diffusion non générés pour ' + mois };
  if (!env.ZIMBRA_RELEVE_USER || !env.ZIMBRA_RELEVE_PASSWORD) return { ok: false, erreur: 'boîte Zimbra non configurée' };
  const z = await authZimbra(env.ZIMBRA_RELEVE_USER, env.ZIMBRA_RELEVE_PASSWORD); if (!z) return { ok: false, erreur: 'connexion Zimbra refusée' };
  const [a, m] = mois.split('-').map(Number), libMois = `${MOIS_LIB[m - 1]} ${a}`;
  const res = [];
  for (const d of idx.destinataires) {
    if (!test) { const deja = await env.DB.prepare("SELECT statut FROM diffusion_envois WHERE mois = ? AND email = ? AND statut = 'envoyé'").bind(mois, d.email).first(); if (deja) continue; }
    const o = await env.FICHIERS.get(d.fichier); if (!o) { res.push(d.email + ' : PDF introuvable'); continue; }
    const prenom = String(d.nom || '').split(' ')[0];
    const texte = `Bonjour ${prenom},\n\nVous trouverez ci-joint le suivi statistique à fin ${libMois} (cumul depuis le 1er janvier) :\n${(d.ecrans || []).map(x => '  - ' + x).join('\n')}\n\nToutes les données sont aussi consultables dans l'appli Suivi statistique : https://olibaroukh.github.io/suivi-stats\n\nBonne lecture,\nOlivier`;
    const dest = test ? env.ZIMBRA_RELEVE_USER : d.email;
    try {
      await envoyerMailZimbra(z.jeton, { a: dest, nom: test ? null : d.nom, sujet: `${test ? '[TEST pour ' + d.nom + '] ' : ''}Suivi statistique – ${libMois}`, texte, pdf: await o.arrayBuffer(), nomPdf: `Suivi statistique - ${libMois} - ${d.nom}.pdf` });
      if (!test) await env.DB.prepare('INSERT OR REPLACE INTO diffusion_envois (mois, email, le, statut) VALUES (?, ?, ?, ?)').bind(mois, d.email, Date.now(), 'envoyé').run();
      res.push(`${d.nom} ✓`);
    } catch (e) {
      if (!test) await env.DB.prepare('INSERT OR REPLACE INTO diffusion_envois (mois, email, le, statut) VALUES (?, ?, ?, ?)').bind(mois, d.email, Date.now(), 'échec : ' + e.message).run();
      res.push(`${d.nom} : ${e.message}`);
    }
  }
  return { ok: true, detail: (test ? 'Test envoyé à ' + env.ZIMBRA_RELEVE_USER + ' : ' : 'Envoi : ') + (res.join(' · ') || 'rien à envoyer (déjà fait)') };
}

// ---------- Rappel mensuel à Olivier (le 1er à 9 h, heure de Paris) ----------
// 07/11/2026 : rappel de préparation le 27 à 9 h (ce qui doit être à jour avant le 1er)
async function rappelPreparation(env) {
  if (!env.ZIMBRA_RELEVE_USER || !env.ZIMBRA_RELEVE_PASSWORD) return { ok: false, erreur: 'boîte Zimbra non configurée' };
  const z = await authZimbra(env.ZIMBRA_RELEVE_USER, env.ZIMBRA_RELEVE_PASSWORD); if (!z) return { ok: false, erreur: 'connexion Zimbra refusée' };
  const mois = moisDecale(new Date(), 0), [a, m] = mois.split('-').map(Number), lib = `${MOIS_LIB[m - 1]} ${a}`;
  const texte = [
    `Bonjour Olivier,`, ``,
    `La fin de ${lib} approche : voici ce qui doit être à jour avant le 1er pour que le calcul et la diffusion de 15 h se passent bien.`, ``,
    `👉 Suivi Stats : https://olibaroukh.github.io/suivi-stats`, ``,
    `D'ici la fin du mois :`,
    `  1. Référentiel magasins — dans SUIVI STATS › Réglages › Référentiel (c'est le référentiel unique : bilan-passage, PEDLV, Suivi magasin, Kaizen… le lisent automatiquement) : exporter l'Excel, corriger, réimporter. Ouvertures / fermetures (colonne Actif), manager, AR, e-mail magasin ; nouveau code site → « Ancien code site » pour garder le N-1.`,
    `  2. Accès : comptes des nouveaux collaborateurs (Suivi Stats › Réglages › Accès des équipes) ; code PIN des nouveaux magasins (Réglages › Accès magasins).`,
    `  3. Saisies manuelles : critères Managers Leaders / Magasins d'Excellence (relancer les AR) et réalisé des Actions de l'Année non automatiques.`,
    `  4. Diffusion : destinataires et écrans à jour (Réglages › Diffusion mensuelle).`, ``,
    `Le dernier jour du mois ou le 1er au matin :`,
    `  5. Import RH — dans BILAN-PASSAGE › Import (pas dans Suivi Stats) : export effectif (8 colonnes) ET « Rapport agenda validés » du mois (absences, journées école, temps partiels). Un seul dépôt : bilan-passage transmet tout seul effectifs et ETP à Suivi Stats.`,
    `  6. Score santé du mois calculé (et validé) dans bilan-passage ; Suivi Stats le reprend tout seul au calcul.`, ``,
    `Rien à faire pour les objectifs de CA : ils arrivent avec le positionnement annuel du mail Cosium 4/4. Le fichier des objectifs d'indicateurs (Réglages › Objectifs) ne change qu'en janvier.`, ``,
    `Le 1er à 9 h, tu recevras le rappel « boucler ${lib} » avec la suite (Cosium, OC Mobile, avoirs, visites, Lyleoo, calcul, enregistrement).`, ``,
    `— Suivi statistique (message automatique)`].join('\n');
  await soap(z.jeton, { SendMsgRequest: { _jsns: 'urn:zimbraMail', m: { e: [{ t: 't', a: env.ZIMBRA_RELEVE_USER }], su: { _content: `🗓️ Suivi statistique : préparer la fin de ${lib}` }, mp: [{ ct: 'text/plain', content: { _content: texte } }] } } });
  return { ok: true, detail: `Rappel de préparation envoyé à ${env.ZIMBRA_RELEVE_USER}` };
}
async function rappelMensuel(env, par = 'auto') {
  if (!env.ZIMBRA_RELEVE_USER || !env.ZIMBRA_RELEVE_PASSWORD) return { ok: false, erreur: 'boîte Zimbra non configurée' };
  await schema(env);
  const z = await authZimbra(env.ZIMBRA_RELEVE_USER, env.ZIMBRA_RELEVE_PASSWORD); if (!z) return { ok: false, erreur: 'connexion Zimbra refusée' };
  const mois = moisDecale(new Date(), -1), [a, m] = mois.split('-').map(Number), lib = `${MOIS_LIB[m - 1]} ${a}`;
  const pcs = await piecesReleveesDuMois(env, mois);
  const nbCos = new Set(pcs.filter(p => p.type === 'cosium').map(p => p.nom)).size;
  const vu = t => pcs.some(p => p.type === t);
  const autres = [...new Set(pcs.filter(p => p.type === 'autre').map(p => p.nom))];
  const dejaEnregistre = await env.DB.prepare('SELECT enregistre_le FROM mois WHERE cle = ?').bind(mois).first();
  const L = '\n';
  const texte = [
    `Bonjour Olivier,`, ``,
    `C'est le moment de boucler ${lib} dans Suivi statistique.`, ``,
    `👉 Ouvrir Suivi Stats : https://olibaroukh.github.io/suivi-stats`, ``,
    `Ce qui est déjà arrivé par mail (relève automatique) :`,
    `  - Cosium : ${nbCos} / 28 envois${nbCos >= 28 ? ' ✓' : ' (les 3/4 et 4/4 arrivent dans la matinée : cliquez sur « Relever maintenant »)'}`,
    `  - Confidence : ${vu('confidence') ? 'reçu ✓' : 'pas encore (arrive en début de mois)'}`,
    `  - Restes dus : ${vu('restes') ? 'reçu ✓' : 'pas encore (vers le 7)'}`,
    autres.length ? `  - Autres fichiers : ${autres.join(', ')}` : `  - Autres fichiers (marges, renta salariale, rentabilités, avis Google) : arrivent au fil du mois`,
    dejaEnregistre ? `${L}(${lib} est déjà enregistré : il suffira d'intégrer les fichiers arrivés depuis.)` : '', ``,
    `À faire aujourd'hui (avant 15 h, heure de l'envoi automatique aux destinataires) :`,
    `  0. Si ce n'est pas fait : import RH dans BILAN-PASSAGE (export effectif + « Rapport agenda validés » du mois écoulé) et référentiel magasins à jour dans SUIVI STATS.`,
    `  1. Accueil › « Relever maintenant », puis attendre « Cosium complet (28 / 28) ».`,
    `  2. Import du mois › « 🚐 Préparer l'activité OC Mobile avec Claude » → récupérer le fichier ocm-activite_${mois}.json.`,
    `  3. Accueil › « Préparer et calculer ».`,
    `  4. Déposer les fichiers manuels : tableaux des avoirs (un par serveur Cosium), exports des visites (External Relations), fichier OC Mobile ; coller Lyleoo si besoin.`,
    `  5. Cocher les listes Confidence à compter, cliquer « Calculer le mois », vérifier le rapport.`,
    `  6. « Enregistrer la photo du mois » → les PDF de diffusion se préparent ; envoi automatique à 15 h.`, ``,
    `Ensuite : quand un fichier arrive plus tard (restes dus, Confidence…), le bandeau orange de l'accueil le signale → « Préparer et calculer » → « Enregistrer ».`, ``,
    `Mode d'emploi complet : PDF « Suivi statistique – mode d'emploi mensuel ».`, ``,
    `— Suivi statistique (message automatique)`].filter(x => x !== '').join(L).replace(/\n\n\n+/g, L + L);
  await soap(z.jeton, { SendMsgRequest: { _jsns: 'urn:zimbraMail', m: { e: [{ t: 't', a: env.ZIMBRA_RELEVE_USER }], su: { _content: `📊 Suivi statistique : boucler ${lib}` }, mp: [{ ct: 'text/plain', content: { _content: texte } }] } } });
  return { ok: true, detail: `Rappel envoyé à ${env.ZIMBRA_RELEVE_USER}` };
}

// ---------- Relève automatique (chaque nuit + bouton) ----------
// Identifiants de la boîte dans les secrets Cloudflare ZIMBRA_RELEVE_USER / ZIMBRA_RELEVE_PASSWORD (jamais dans le code).
// Mois traités : le mois précédent et le mois en cours (envois Cosium du dernier jour du mois). Chaque pièce n'est copiée qu'une fois.
const moisDecale = (d, n) => { const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1)); return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}`; };
async function releverBoite(env, par) {
  await schema(env);
  if (!env.ZIMBRA_RELEVE_USER || !env.ZIMBRA_RELEVE_PASSWORD) {
    await env.DB.prepare('INSERT INTO releve_journal (le, par, statut, detail) VALUES (?, ?, ?, ?)').bind(Date.now(), par, 'non configuré', 'secrets ZIMBRA_RELEVE_USER / ZIMBRA_RELEVE_PASSWORD absents').run();
    return { ok: false, erreur: 'relève non configurée (secrets Cloudflare absents)' };
  }
  const z = await authZimbra(env.ZIMBRA_RELEVE_USER, env.ZIMBRA_RELEVE_PASSWORD);
  if (!z) { await env.DB.prepare('INSERT INTO releve_journal (le, par, statut, detail) VALUES (?, ?, ?, ?)').bind(Date.now(), par, 'échec', 'connexion Zimbra refusée (mot de passe changé ?)').run(); return { ok: false, erreur: 'connexion Zimbra refusée' }; }
  // Purge : toute pièce déjà relevée qui ne correspond plus aux règles est effacée (fichier R2 + ligne)
  const anc = await env.DB.prepare('SELECT id, part, nom, sujet, type, cle_r2 FROM releve_pieces').all();
  let purgees = 0;
  for (const x of anc.results || []) if (!typePiece(x.nom || '', x.sujet || '', x.type === 'cosium' ? 'zip' : '')) {
    if (x.cle_r2) await env.FICHIERS.delete(x.cle_r2);
    await env.DB.prepare('DELETE FROM releve_pieces WHERE id = ? AND part = ?').bind(x.id, x.part).run(); purgees++;
  }
  const now = new Date(), vus = new Map();
  let mailsCosium = 0, exemple = '';
  for (const m of [moisDecale(now, -1), moisDecale(now, 0)]) { const l = await piecesDuMois(z.jeton, m); mailsCosium = Math.max(mailsCosium, (l.diag || {}).mailsCosium || 0); if (!exemple && l.diag && l.diag.exemple) exemple = l.diag.exemple; for (const p of l) vus.set(p.id + '|' + p.part, p); }
  let nouvelles = 0, deja = 0, erreurs = 0, restantes = 0;
  const MAX_TELECHARGEMENTS = 30; // Cloudflare limite le nombre d'appels sortants par exécution : le reste est pris au passage suivant
  for (const p of vus.values()) {
    const ex = await env.DB.prepare('SELECT 1 FROM releve_pieces WHERE id = ? AND part = ?').bind(String(p.id), String(p.part)).first();
    if (ex) { deja++; continue; }
    if (nouvelles + erreurs >= MAX_TELECHARGEMENTS) { restantes++; continue; }
    if (p.taille && p.taille > 25e6) { erreurs++; continue; }
    try {
      const buf = await telechargerPiece(z.jeton, p.id, p.part), cle = `releve/${String(p.id).replace(/[^\w-]/g, '_')}_${String(p.part).replace(/[^\w.]/g, '_').slice(0, 40)}/${p.nom.replace(/[\/\\]/g, '_')}`;
      await env.FICHIERS.put(cle, buf, { httpMetadata: { contentType: 'application/octet-stream' } });
      await env.DB.prepare('INSERT OR REPLACE INTO releve_pieces (id, part, nom, type, date, sujet, taille, cle_r2, releve_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(String(p.id), String(p.part), p.nom, p.type, p.date, p.sujet || '', buf.byteLength, cle, Date.now()).run();
      nouvelles++;
    } catch (e) { erreurs++; console.error('relève', p.nom, e); }
  }
  const nbCos = [...vus.values()].filter(p => p.type === 'cosium').length;
  const detail = `${vus.size} pièce(s) utiles dans la boîte (dont ${nbCos} ZIP Cosium, ${mailsCosium} mail(s) Cosium vus) · ${nouvelles} nouvelle(s) copiée(s) · ${deja} déjà relevée(s)${restantes ? ' · ' + restantes + ' restante(s) : relancez' : ''}${erreurs ? ' · ' + erreurs + ' erreur(s)' : ''}${purgees ? ' · ' + purgees + ' pièce(s) hors sources effacée(s)' : ''}${!nbCos && exemple ? ' · structure d’un mail Cosium : ' + exemple.slice(0, 600) : ''}`;
  await env.DB.prepare('INSERT INTO releve_journal (le, par, statut, detail) VALUES (?, ?, ?, ?)').bind(Date.now(), par, erreurs ? 'partiel' : 'ok', detail).run();
  return { ok: true, nouvelles, deja, erreurs, restantes, detail };
}
// Pièces relevées de la fenêtre d'un mois traité (même fenêtre que piecesDuMois)
async function piecesReleveesDuMois(env, mois) {
  await schema(env);
  const [a, m] = mois.split('-').map(Number);
  const r = await env.DB.prepare('SELECT id, part, nom, type, date, sujet, taille, releve_le FROM releve_pieces WHERE date >= ? AND date <= ? ORDER BY date DESC').bind(Date.UTC(a, m - 2, 20), Date.UTC(a, m, 26)).all();
  return (r.results || []).map(x => ({ ...x, releve: true }));
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

  // 08/11/2026 : séminaire franchisés (tables à part, droits propres)
  // Informations sensibles : reconnexion obligatoire toutes les 2 heures (session vérifiée et signée plus haut)
  if (chemin.startsWith('/seminaire/') && ageSession(request) > SESSION_SEMINAIRE_MS) return erreur('Par sécurité, reconnectez-vous (toutes les 2 heures).', 401, h);
  if (chemin.startsWith('/seminaire/')) return routesSeminaire(request, env, p, chemin, url, h, json, erreur);
  if (p.role === 'seminaire') return erreur('Ce compte n’a accès qu’au séminaire franchisés', 403, h);

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
    if (!/^(objectifs(-\d{4})?|objectifs-siege-\d{4}|taux-change|confidence-listes|actions-\d{4}|challenges-\d{4}|cockpit-paris)$/.test(nom)) return erreur('Réglage non disponible', 403, h);
    let valeur = await lireJSON(env, `config/${nom}.json`);
    // Managers Leaders et Magasins d'Excellence : un lecteur ne reçoit que les magasins de son périmètre
    if (valeur && /^challenges-/.test(nom) && !admin) {
      const codes = codesAutorises(p.perimetre, (await lireJSON(env, 'config/referentiel.json')) || []);
      const garder = o => Object.fromEntries(Object.entries(o || {}).filter(([c]) => codes.has(String(c))));
      valeur = { ...valeur, magasins: garder(valeur.magasins), objectifsAtteints: garder(valeur.objectifsAtteints) };
    }
    return json({ ok: true, valeur }, 200, h);
  }

  // Saisie des critères manuels Managers Leaders / Magasins d'Excellence : administrateur, ou lecteur sur son périmètre
  if (chemin === '/mlme/saisie' && request.method === 'POST') {
    const b = await request.json().catch(() => ({}));
    const annee = +b.annee, code = String(b.code || ''), champ = String(b.champ || ''), v = b.valeur;
    const BOOL = ['formation', 'intelligence', 'planning', 'retours', 'dressCode', 'vocabulaire', 'savoirEtre'];
    if (!(annee >= 2024 && annee <= 2100) || !code || !(BOOL.includes(champ) || champ === 'fid' || champ === 'objCe')) return erreur('Saisie invalide', 400, h);
    if ((champ === 'fid' || champ === 'objCe') && !admin) return erreur('Réservé aux administrateurs', 403, h);
    if (BOOL.includes(champ) && !(v === true || v === false || v === null)) return erreur('Valeur invalide', 400, h);
    if (champ === 'fid' && !(v === null || (typeof v === 'number' && v >= 0 && v <= 1))) return erreur('Taux de fidélisation entre 0 et 1', 400, h);
    if (champ === 'objCe' && !(v === null || (typeof v === 'number' && v >= 0 && v <= 10000))) return erreur('Objectif CE invalide', 400, h);
    if (!admin) {
      if (Array.isArray(p.ecrans) && !p.ecrans.includes('challenges')) return erreur('Écran non autorisé', 403, h);
      const codes = codesAutorises(p.perimetre, (await lireJSON(env, 'config/referentiel.json')) || []);
      if (!codes.has(code)) return erreur('Magasin hors de votre périmètre', 403, h);
    }
    const cle = `config/challenges-${annee}.json`;
    const conf = (await lireJSON(env, cle)) || { annee, magasins: {} };
    const m = conf.magasins[code] = conf.magasins[code] || {};
    if (BOOL.includes(champ)) { m.saisies = m.saisies || {}; if (v === null) delete m.saisies[champ]; else m.saisies[champ] = v; }
    else if (v === null) delete m[champ]; else m[champ] = v;
    m.maj = new Date().toISOString(); m.par = email;
    await env.FICHIERS.put(cle, JSON.stringify(conf), { httpMetadata: { contentType: 'application/json' } });
    return json({ ok: true, magasin: m }, 200, h);
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
  // Relève automatique : état (accueil), lancement manuel
  if (chemin === '/releve' && admin) {
    const m = url.searchParams.get('mois') || moisDecale(new Date(), -1);
    if (!/^\d{4}-\d{2}$/.test(m)) return erreur('Paramètre mois (AAAA-MM) requis', 400, h);
    await schema(env);
    const j = await env.DB.prepare('SELECT le, par, statut, detail FROM releve_journal ORDER BY le DESC LIMIT 5').all();
    return json({ ok: true, configure: !!(env.ZIMBRA_RELEVE_USER && env.ZIMBRA_RELEVE_PASSWORD), journal: j.results || [], pieces: await piecesReleveesDuMois(env, m) }, 200, h);
  }
  if (chemin === '/rappel/tester' && request.method === 'POST' && admin) {
    const b = await request.json().catch(() => ({}));
    try { return json(b.type === 'preparation' ? await rappelPreparation(env) : await rappelMensuel(env, email), 200, h); } catch (e) { return erreur('Rappel : ' + e.message, 502, h); }
  }
  if (chemin === '/diffusion/etat' && admin) {
    const m = url.searchParams.get('mois') || ''; if (!/^\d{4}-\d{2}$/.test(m)) return erreur('Paramètre mois requis', 400, h);
    await schema(env);
    const e = await env.DB.prepare('SELECT email, le, statut FROM diffusion_envois WHERE mois = ? ORDER BY le').bind(m).all();
    return json({ ok: true, index: await lireJSON(env, `diffusion/${m}/index.json`), envois: e.results || [] }, 200, h);
  }
  if (chemin === '/diffusion/envoyer' && request.method === 'POST' && admin) {
    const b = await request.json().catch(() => ({})); if (!/^\d{4}-\d{2}$/.test(String(b.mois || ''))) return erreur('mois requis', 400, h);
    try { return json(await diffuser(env, b.mois, { test: !!b.test, par: email }), 200, h); } catch (e) { return erreur('Diffusion : ' + e.message, 502, h); }
  }
  if (chemin === '/releve/lancer' && request.method === 'POST' && admin) {
    try { return json(await releverBoite(env, email), 200, h); } catch (e) { return erreur('Relève : ' + e.message, 502, h); }
  }
  if ((chemin === '/zimbra/pieces' || chemin === '/zimbra/piece') && admin) {
    const j = await env.DB.prepare('SELECT jeton, expire FROM jetons_zimbra WHERE email = ?').bind(email).first();
    const enDirect = j && j.expire >= Date.now();
    if (chemin === '/zimbra/pieces') {
      const m = url.searchParams.get('mois') || '';
      if (!/^\d{4}-\d{2}$/.test(m)) return erreur('Paramètre mois (AAAA-MM) requis', 400, h);
      // Pièces déjà relevées (chaque nuit) + recherche en direct si la session Zimbra est valide
      const rel = await piecesReleveesDuMois(env, m), cles = new Set(rel.map(p => p.id + '|' + p.part));
      let direct = [];
      if (enDirect) { try { direct = (await piecesDuMois(j.jeton, m)).filter(p => !cles.has(p.id + '|' + p.part)); } catch (e) { console.warn('Zimbra direct', e); } }
      if (!enDirect && !rel.length) return erreur('Connexion Zimbra expirée et aucune pièce relevée : déconnectez-vous puis reconnectez-vous.', 409, h);
      return json({ ok: true, pieces: rel.concat(direct) }, 200, h);
    }
    const id = url.searchParams.get('id') || '', part = url.searchParams.get('part') || '';
    if (!/^-?\d+(:\d+)?$/.test(id) || !/^[\d.,]+$/.test(part)) return erreur('Paramètres invalides', 400, h);
    const rp = await env.DB.prepare('SELECT cle_r2 FROM releve_pieces WHERE id = ? AND part = ?').bind(id, part).first();
    if (rp && rp.cle_r2) { const o = await env.FICHIERS.get(rp.cle_r2); if (o) return new Response(o.body, { headers: { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store', ...h } }); }
    if (!enDirect) return erreur('Connexion Zimbra expirée : déconnectez-vous puis reconnectez-vous.', 409, h);
    try { return new Response(await telechargerPiece(j.jeton, id, part), { headers: { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store', ...h } }); }
    catch (e) { return erreur('Pièce jointe introuvable (' + e.message + ')', 502, h); }
  }

  if (chemin === '/admin/taux' && request.method === 'POST') {
    try { return json({ ok: true, taux: await majTaux(env, email) }, 200, h); } catch (e) { return erreur('Taux : ' + e.message, 502, h); }
  }

  // Répartition hommes / femmes par magasin (dernier import RH de bilan-passage), pour le Magasin d'Excellence
  if (chemin === '/relais/genre') {
    if (!env.RELAIS) return erreur('Lien interne vers zimbra-relay absent', 500, h);
    const m = url.searchParams.get('mois') || '';
    if (!/^\d{4}-\d{2}$/.test(m)) return erreur('Paramètre mois (AAAA-MM) requis', 400, h);
    try { return json({ ok: true, ...(await env.RELAIS.rhGenre(m)) }, 200, h); } catch (e) { return erreur('zimbra-relay : ' + e.message, 502, h); }
  }

  // Cumul annuel des points Kaizen par magasin (zimbra-relay), pour le Magasin d'Excellence
  if (chemin === '/relais/kaizen') {
    if (!env.RELAIS) return erreur('Lien interne vers zimbra-relay absent', 500, h);
    const m = url.searchParams.get('mois') || '';
    if (!/^\d{4}-\d{2}$/.test(m)) return erreur('Paramètre mois (AAAA-MM) requis', 400, h);
    try { return json({ ok: true, cumul: await env.RELAIS.kaizenCumul(m) }, 200, h); } catch (e) { return erreur('zimbra-relay : ' + e.message, 502, h); }
  }

  // Écrans magasins IDdigital : envoi d'un PDF sur l'écran d'un magasin (administrateur)
  if (chemin === '/relais/iddigital/envoyer' && request.method === 'POST') {
    if (!env.RELAIS) return erreur('Lien interne vers zimbra-relay absent', 500, h);
    const b = await request.json().catch(() => ({}));
    if (!b.code || !b.pdf || !b.type) return erreur('code, type et pdf requis', 400, h);
    try { return json(await env.RELAIS.iddigitalEnvoyer(String(b.type), String(b.code), String(b.pdf), b.nom ? String(b.nom) : null), 200, h); } catch (e) { return erreur('zimbra-relay : ' + e.message, 502, h); }
  }

  // Écrans magasins IDdigital : test de connexion et liste des magasins équipés (rien n'est envoyé)
  if (chemin === '/relais/iddigital/test') {
    if (!env.RELAIS) return erreur('Lien interne vers zimbra-relay absent', 500, h);
    try { return json(await env.RELAIS.iddigitalTest(), 200, h); } catch (e) { return erreur('zimbra-relay : ' + e.message, 502, h); }
  }

  // Codes PIN des applis magasin (gérés par zimbra-relay) : liste et génération + envoi par mail (administrateurs)
  if (chemin === '/relais/pins') {
    if (!env.RELAIS) return erreur('Lien interne vers zimbra-relay absent', 500, h);
    try {
      if (request.method === 'GET') return json({ ok: true, magasins: await env.RELAIS.listePins() }, 200, h);
      if (request.method === 'POST') { const b = await request.json().catch(() => ({})); const codes = Array.isArray(b.codes) ? b.codes.map(String).slice(0, 200) : [];
        if (!codes.length) return erreur('Aucun magasin choisi', 400, h);
        return json({ ok: true, resultats: await env.RELAIS.genererPins(codes, b.envoyer !== false) }, 200, h); }
      return erreur('Méthode non prise en charge', 405, h);
    } catch (e) { return erreur('zimbra-relay : ' + e.message, 502, h); }
  }

  // 07/11/2026 : appels des applis terrain qui n'utilisent encore que la clé partagée (préparation de la partie D)
  if (chemin === '/relais/cle-usage' && admin) {
    if (!env.RELAIS || typeof env.RELAIS.cleUsage !== 'function') return erreur('Lien interne vers zimbra-relay absent', 500, h);
    try { return json(await env.RELAIS.cleUsage(), 200, h); } catch (e) { return erreur('zimbra-relay : ' + e.message, 502, h); }
  }
  // Données de zimbra-relay lues côté serveur par le lien interne RELAIS (administrateurs)
  if (chemin === '/relais/google' || chemin === '/relais/sante' || chemin === '/relais/sante-annuel' || chemin === '/relais/bilans') {
    if (!env.RELAIS) return erreur('Lien interne vers zimbra-relay absent', 500, h);
    try {
      let d;
      if (chemin === '/relais/google') d = await env.RELAIS.googleRatings();
      else if (chemin === '/relais/sante-annuel') { const m = url.searchParams.get('mois') || ''; if (!/^\d{4}-\d{2}$/.test(m)) return erreur('Paramètre mois (AAAA-MM) requis', 400, h); if (typeof env.RELAIS.santeAnnuel !== 'function') return erreur('zimbra-relay pas encore à jour (score annuel)', 502, h); d = await env.RELAIS.santeAnnuel(m); }
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
    // « 0 5 1 * * » : taux de change le 1er du mois ; « 0 1 * * * » : relève de la boîte Zimbra chaque nuit
    if (event.cron === '0 5 1 * *') ctx.waitUntil(majTaux(env, 'automatique').catch(e => console.error('taux', e)));
    // 07/11/2026 : diffusion du mois précédent le 1er à 15 h (heure de Paris), puis chaque jour à 15 h jusqu'au 10 tant que les PDF
    // ne sont pas prêts / envoyés. Deux déclenchements (13 h et 14 h UTC) : seul celui qui tombe à 15 h à Paris envoie (heure d'été / d'hiver).
    // 07/11/2026 : rappel à Olivier le 1er à 9 h (heure de Paris) : crons 7 h et 8 h UTC, seul celui de 9 h à Paris envoie
    else if (event.cron === '0 7 1 * *' || event.cron === '0 8 1 * *') {
      const hP = +new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', hour12: false }).format(new Date(event.scheduledTime || Date.now()));
      if (hP === 9) ctx.waitUntil(rappelMensuel(env).then(r => console.log('rappel', JSON.stringify(r))).catch(e => console.error('rappel', e)));
    }
    // le 27 à 9 h (heure de Paris) : rappel de préparation de la fin de mois
    else if (event.cron === '0 7 27 * *' || event.cron === '0 8 27 * *') {
      const hP = +new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', hour12: false }).format(new Date(event.scheduledTime || Date.now()));
      if (hP === 9) ctx.waitUntil(rappelPreparation(env).then(r => console.log('rappel prépa', JSON.stringify(r))).catch(e => console.error('rappel prépa', e)));
    }
    else if (event.cron === '0 13 1-10 * *' || event.cron === '0 14 1-10 * *') {
      const hParis = +new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', hour12: false }).format(new Date(event.scheduledTime || Date.now()));
      if (hParis === 15) ctx.waitUntil(diffuser(env, moisDecale(new Date(), -1)).then(r => console.log('diffusion', JSON.stringify(r))).catch(e => console.error('diffusion', e)));
    }
    else ctx.waitUntil(releverBoite(env, 'nuit').catch(e => console.error('relève', e)));
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
  // Stats par collaborateur (export Cosium par vendeur, cumul à fin du dernier mois enregistré), par matricule
  async statsVendeurs(matricules) {
    await schema(this.env);
    const m = (await this.moisDisponibles())[0]; if (!m) return { mois: null, parMatricule: {} };
    const photo = await lireJSON(this.env, `donnees/${m}/photo.json`);
    const sv = (photo && photo.statsVendeurs) || {}, cle = x => String(x == null ? '' : x).trim().replace(/\.0+$/, '').replace(/^0+(?=\d)/, '');
    // 07/11/2026 : % Unif individualisés du magasin (Lyris n'existe pas par vendeur) — repris pour chaque collaborateur
    const magDe = {};
    for (const [code, ls] of Object.entries((photo && photo.equipes) || {})) for (const pe of (ls || [])) { const k = cle(pe.matricule); if (k && !magDe[k]) magDe[k] = code; }
    const unifMag = code => { const n = code && photo && photo.magasins && photo.magasins[code] && photo.magasins[code].N; return n && n.AH ? Math.round(1000 * (n.AI || 0) / n.AH) / 10 : null; };
    const parMatricule = {};
    for (const x of (matricules || [])) {
      const k = cle(x), s = sv[k], u = unifMag(magDe[k]);
      if (s || u != null) parMatricule[String(x)] = { ...(s || {}), unifIndivMag: u };
    }
    return { mois: m, parMatricule };
  }
  // Export RH déposé par zimbra-relay quand Olivier l'importe dans bilan-passage (un seul dépôt par mois).
  // Seules les colonnes utiles sont gardées ; fichier privé (administrateurs).
  async deposerRh(mois, lignes) {
    if (!/^\d{4}-\d{2}$/.test(String(mois || ''))) throw new Error('mois AAAA-MM requis');
    if (!Array.isArray(lignes) || !lignes.length) throw new Error('aucune ligne');
    const COLS = ['Matricule', 'Codes sites', "Date d'entrée", 'Genre', 'Nom', 'Prénom', 'Poste', 'Date de naissance'];
    const cle = k => String(k).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[’']/g, "'").toLowerCase().trim();
    const garde = lignes.map(r => { const o = {}; for (const c of COLS) { const k = Object.keys(r || {}).find(x => cle(x) === cle(c)); if (k !== undefined) o[c] = r[k]; } return o; }).filter(o => o.Matricule != null && o.Matricule !== '');
    await this.env.FICHIERS.put(`donnees/rh/${mois}.json`, JSON.stringify({ mois, recuLe: new Date().toISOString(), source: 'bilan-passage', lignes: garde }), { httpMetadata: { contentType: 'application/json' } });
    return { ok: true, mois, nb: garde.length };
  }
  // 06/11/2026 : coefficients ETP par matricule (1 = temps plein), calculés par zimbra-relay à l'import de
  // l'agenda validés dans bilan-passage (journées école, repos temps partiel, temps partiel thérapeutique).
  // Seul le coefficient est conservé, jamais le motif ; fichier privé (administrateurs).
  async deposerEtp(mois, coefs) {
    if (!/^\d{4}-\d{2}$/.test(String(mois || ''))) throw new Error('mois AAAA-MM requis');
    const garde = {};
    for (const [m, v] of Object.entries(coefs || {})) {
      const k = String(m).trim().replace(/\.0+$/, '').replace(/^0+(?=\d)/, ''), n = Number(v);
      if (k && Number.isFinite(n)) garde[k] = Math.max(0, Math.min(1, n));
    }
    const nb = Object.keys(garde).length;
    if (!nb) throw new Error('aucun coefficient');
    const nbPartiels = Object.values(garde).filter(v => v < 1).length;
    await this.env.FICHIERS.put(`donnees/rh-etp/${mois}.json`, JSON.stringify({ mois, recuLe: new Date().toISOString(), source: 'bilan-passage', coefs: garde }), { httpMetadata: { contentType: 'application/json' } });
    return { ok: true, mois, nb, nbPartiels };
  }
  // 06/11/2026 : coefficients ETP d'un mois (repris une fois par zimbra-relay pour le score santé)
  async lireEtp(mois) {
    if (!/^\d{4}-\d{2}$/.test(String(mois || ''))) return null;
    const d = await lireJSON(this.env, `donnees/rh-etp/${mois}.json`);
    return d && d.coefs ? d.coefs : null;
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
