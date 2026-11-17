/* Restes dus des franchisés — partie serveur (Worker suivi-stats-api).
 *
 * Page : https://olibaroukh.github.io/restes_dus/ (dépôt GitHub olibaroukh/restes_dus, code seul).
 * Même connexion Zimbra que Suivi Stats. Données à part (tables restes_dus_*).
 *
 * Fonctionnement (règles validées le 17/11/2026) :
 *  - Le franchisé dépose son extraction Cosium « Liste des règlements » ; la page la lit sur
 *    l'ordinateur et n'envoie que les dossiers à justifier (45 jours → 1 an), regroupés par facture,
 *    SANS le n° de Sécurité sociale ni les autres colonnes inutiles.
 *  - Une justification par dossier (motif, commentaire, date d'action prévue), conservée d'un dépôt
 *    à l'autre tant que le dossier reste dans l'extraction ; dossier disparu = réglé (justification effacée).
 *  - Seul le dernier dépôt de chaque magasin est gardé.
 *
 * Droits (relus à chaque appel) :
 *  - administrateurs de Suivi Stats : tous les magasins, suivi, comptes ;
 *  - comptes « restes dus » (adresse Zimbra donnée par Olivier) : uniquement leurs codes magasins.
 */

export const MOTIFS = ['En livraison', 'Relancé auprès de l’organisme', 'Rejet de l’organisme, dossier renvoyé', 'Prise en charge en attente',
  'Client à relancer', 'Déjà payé, à lettrer', 'Erreur de saisie à régulariser', 'À passer en perte', 'Autre'];
const MAX_DOSSIERS = 3000, MAX_OCTETS_DEPOT = 800000;

let schemaPret = false;
async function schemaRD(env) {
  if (schemaPret) return;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS restes_dus_comptes (email TEXT PRIMARY KEY, nom TEXT, codes TEXT NOT NULL DEFAULT '[]', actif INTEGER NOT NULL DEFAULT 1, maj_le TEXT, par TEXT)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS restes_dus_depots (code TEXT PRIMARY KEY, le TEXT NOT NULL, par TEXT, date_edition TEXT, nb_lignes INTEGER, dossiers TEXT NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS restes_dus_justifs (code TEXT NOT NULL, cle TEXT NOT NULL, motif TEXT, commentaire TEXT, date_action TEXT, par TEXT, maj_le TEXT, PRIMARY KEY (code, cle))`),
  ]);
  schemaPret = true;
}

// Compte « restes dus » seul (franchisé sans accès à Suivi Stats) : utilisé à la connexion
export async function compteRestesDus(env, email) {
  await schemaRD(env);
  return env.DB.prepare('SELECT * FROM restes_dus_comptes WHERE email = ? AND actif = 1').bind(email).first();
}

const nomDepuisEmail = e => String(e || '').split('@')[0].split(/[._-]+/).filter(Boolean).map(x => x[0].toUpperCase() + x.slice(1)).join(' ');
const codeNorm = c => String(c == null ? '' : c).trim().replace(/^0+(?=\d)/, '');
const auj = () => new Date().toISOString().slice(0, 10);
const estJustifie = j => !!(j && j.motif) && (!j.date_action || j.date_action >= auj());

async function droit(env, p) {
  if (p.role === 'admin') return { admin: true, nom: p.nom || nomDepuisEmail(p.email), codes: null };
  const c = await compteRestesDus(env, p.email);
  if (!c) return null;
  let codes = []; try { codes = JSON.parse(c.codes || '[]').map(codeNorm); } catch (e) {}
  return { admin: false, nom: c.nom || nomDepuisEmail(p.email), codes };
}

function valideDossier(d) {
  if (!d || typeof d !== 'object') return 'dossier invalide';
  if (typeof d.cle !== 'string' || !d.cle || d.cle.length > 80) return 'clé invalide';
  if (!Array.isArray(d.lignes) || !d.lignes.length || d.lignes.length > 60) return 'lignes invalides';
  for (const l of d.lignes) {
    if (!l || typeof l.montant !== 'number' || !isFinite(l.montant)) return 'montant invalide';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(l.date || ''))) return 'date invalide';
  }
  return null;
}
// Ne garde que les champs prévus (rien d'autre n'est stocké, même si la page en envoyait plus)
const propre = d => ({
  cle: d.cle, facture: String(d.facture || '').slice(0, 40), client: String(d.client || '').slice(0, 80),
  lignes: d.lignes.map(l => ({ date: l.date, type: String(l.type || '').slice(0, 30), organisme: String(l.organisme || '').slice(0, 80),
    montant: Math.round(l.montant * 100) / 100, vendeur: String(l.vendeur || '').slice(0, 30) })),
});

export async function routesRestesDus(request, env, p, chemin, url, h, json, erreur, lireJSON) {
  await schemaRD(env);
  const d = await droit(env, p);
  if (!d) return erreur('Ce compte n’a pas accès aux restes dus. Demandez l’accès à Olivier Baroukh.', 403, h);
  const email = p.email;
  const ref = (await lireJSON(env, 'config/referentiel.json')) || [];
  const parCode = new Map(ref.map(m => [codeNorm(m.code), m]));
  const autorise = code => d.admin || d.codes.includes(codeNorm(code));
  const infoMag = code => { const m = parCode.get(codeNorm(code)) || {}; return { code: codeNorm(code), magasin: m.magasin || '', groupe: m.groupe || '', pays: m.pays || '', type: m.type || '' }; };

  if (chemin === '/restes-dus/moi') {
    const codes = d.admin
      ? ref.filter(m => m.type === 'Franchise' && m.actif === 'Oui').map(m => codeNorm(m.code))
      : d.codes;
    return json({ ok: true, moi: { email, nom: d.nom, admin: d.admin }, motifs: MOTIFS, magasins: codes.map(infoMag).sort((a, b) => (a.groupe + a.magasin).localeCompare(b.groupe + b.magasin)) }, 200, h);
  }

  if (chemin === '/restes-dus/magasin' && request.method === 'GET') {
    const code = codeNorm(url.searchParams.get('code'));
    if (!code || !autorise(code)) return erreur('Magasin non autorisé', 403, h);
    const dep = await env.DB.prepare('SELECT * FROM restes_dus_depots WHERE code = ?').bind(code).first();
    const js = await env.DB.prepare('SELECT cle, motif, commentaire, date_action, par, maj_le FROM restes_dus_justifs WHERE code = ?').bind(code).all();
    const justifs = Object.fromEntries((js.results || []).map(j => [j.cle, { motif: j.motif || '', commentaire: j.commentaire || '', dateAction: j.date_action || '', par: j.par, majLe: j.maj_le }]));
    return json({ ok: true, magasin: infoMag(code), depot: dep ? { le: dep.le, par: dep.par, dateEdition: dep.date_edition, nbLignes: dep.nb_lignes, dossiers: JSON.parse(dep.dossiers) } : null, justifs }, 200, h);
  }

  if (chemin === '/restes-dus/depot' && request.method === 'POST') {
    const b = await request.json().catch(() => ({}));
    const code = codeNorm(b.code);
    if (!code || !autorise(code)) return erreur(`Ce fichier concerne le centre ${code || '?'}, qui ne fait pas partie de vos magasins.`, 403, h);
    if (!parCode.has(code)) return erreur(`Le centre ${code} est absent du référentiel.`, 400, h);
    if (!d.admin && parCode.get(code).type !== 'Franchise') return erreur('Réservé aux magasins franchisés.', 403, h);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.dateEdition || ''))) return erreur('Date d’édition du fichier introuvable.', 400, h);
    const liste = Array.isArray(b.dossiers) ? b.dossiers : [];
    if (liste.length > MAX_DOSSIERS) return erreur('Trop de dossiers dans le fichier.', 400, h);
    for (const x of liste) { const pb = valideDossier(x); if (pb) return erreur('Fichier mal lu : ' + pb, 400, h); }
    const dossiers = liste.map(propre);
    const texte = JSON.stringify(dossiers);
    if (texte.length > MAX_OCTETS_DEPOT) return erreur('Fichier trop volumineux.', 400, h);
    const ancien = await env.DB.prepare('SELECT date_edition FROM restes_dus_depots WHERE code = ?').bind(code).first();
    if (ancien && ancien.date_edition > b.dateEdition && !b.forcer) return erreur(`Une extraction plus récente (${ancien.date_edition.split('-').reverse().join('/')}) est déjà déposée.`, 409, h);
    // Dossiers disparus = réglés : leurs justifications sont effacées (on ne garde que l'utile)
    const cles = new Set(dossiers.map(x => x.cle));
    const js = await env.DB.prepare('SELECT cle FROM restes_dus_justifs WHERE code = ?').bind(code).all();
    const aEffacer = (js.results || []).map(j => j.cle).filter(c => !cles.has(c));
    const ops = [env.DB.prepare(`INSERT INTO restes_dus_depots (code, le, par, date_edition, nb_lignes, dossiers) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(code) DO UPDATE SET le = excluded.le, par = excluded.par, date_edition = excluded.date_edition, nb_lignes = excluded.nb_lignes, dossiers = excluded.dossiers`)
      .bind(code, new Date().toISOString(), email, b.dateEdition, Number(b.nbLignes) || 0, texte)];
    for (const c of aEffacer) ops.push(env.DB.prepare('DELETE FROM restes_dus_justifs WHERE code = ? AND cle = ?').bind(code, c));
    await env.DB.batch(ops);
    return json({ ok: true, dossiers: dossiers.length, regles: aEffacer.length }, 200, h);
  }

  if (chemin === '/restes-dus/justif' && request.method === 'PUT') {
    const b = await request.json().catch(() => ({}));
    const code = codeNorm(b.code);
    if (!code || !autorise(code)) return erreur('Magasin non autorisé', 403, h);
    const dep = await env.DB.prepare('SELECT dossiers FROM restes_dus_depots WHERE code = ?').bind(code).first();
    if (!dep || !JSON.parse(dep.dossiers).some(x => x.cle === b.cle)) return erreur('Dossier introuvable dans la dernière extraction.', 404, h);
    const motif = String(b.motif || '');
    if (motif && !MOTIFS.includes(motif)) return erreur('Motif inconnu', 400, h);
    const da = String(b.dateAction || '');
    if (da && !/^\d{4}-\d{2}-\d{2}$/.test(da)) return erreur('Date d’action invalide', 400, h);
    const maj = new Date().toISOString();
    await env.DB.prepare(`INSERT INTO restes_dus_justifs (code, cle, motif, commentaire, date_action, par, maj_le) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(code, cle) DO UPDATE SET motif = excluded.motif, commentaire = excluded.commentaire, date_action = excluded.date_action, par = excluded.par, maj_le = excluded.maj_le`)
      .bind(code, String(b.cle), motif, String(b.commentaire || '').slice(0, 1000), da, email, maj).run();
    return json({ ok: true, majLe: maj, par: email }, 200, h);
  }

  // ---------- Administrateurs ----------
  if (!d.admin) return erreur('Réservé aux administrateurs', 403, h);

  if (chemin === '/restes-dus/suivi') {
    const deps = await env.DB.prepare('SELECT code, le, par, date_edition, dossiers FROM restes_dus_depots').all();
    const js = await env.DB.prepare('SELECT code, cle, motif, date_action FROM restes_dus_justifs').all();
    const jParCode = new Map();
    for (const j of js.results || []) { if (!jParCode.has(j.code)) jParCode.set(j.code, new Map()); jParCode.get(j.code).set(j.cle, j); }
    const lignes = (deps.results || []).map(x => {
      const ds = JSON.parse(x.dossiers), jm = jParCode.get(x.code) || new Map();
      const mt = y => y.lignes.reduce((a, l) => a + l.montant, 0);
      const just = ds.filter(y => estJustifie(jm.get(y.cle)));
      const parMotif = {};
      for (const y of ds) { const j = jm.get(y.cle); if (j && j.motif) parMotif[j.motif] = (parMotif[j.motif] || 0) + mt(y); }
      return { ...infoMag(x.code), le: x.le, par: x.par, dateEdition: x.date_edition, nb: ds.length, montant: Math.round(ds.reduce((a, y) => a + mt(y), 0) * 100) / 100,
        nbJustifies: just.length, montantJustifie: Math.round(just.reduce((a, y) => a + mt(y), 0) * 100) / 100, parMotif };
    });
    return json({ ok: true, suivi: lignes }, 200, h);
  }

  if (chemin === '/restes-dus/comptes') {
    if (request.method === 'GET') {
      const r = await env.DB.prepare('SELECT email, nom, codes, actif, maj_le FROM restes_dus_comptes ORDER BY nom, email').all();
      return json({ ok: true, comptes: (r.results || []).map(c => ({ ...c, codes: JSON.parse(c.codes || '[]'), actif: !!c.actif })) }, 200, h);
    }
    if (request.method === 'PUT') {
      const c = await request.json().catch(() => null);
      const em = String(c && c.email || '').trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) return erreur('Adresse e-mail invalide', 400, h);
      const codes = [...new Set((Array.isArray(c.codes) ? c.codes : []).map(codeNorm).filter(Boolean))];
      const inconnus = codes.filter(x => !parCode.has(x));
      if (inconnus.length) return erreur('Codes absents du référentiel : ' + inconnus.join(', '), 400, h);
      if (!codes.length) return erreur('Choisissez au moins un magasin', 400, h);
      await env.DB.prepare(`INSERT INTO restes_dus_comptes (email, nom, codes, actif, maj_le, par) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(email) DO UPDATE SET nom = excluded.nom, codes = excluded.codes, actif = excluded.actif, maj_le = excluded.maj_le, par = excluded.par`)
        .bind(em, String(c.nom || '').slice(0, 120) || null, JSON.stringify(codes), c.actif === false ? 0 : 1, new Date().toISOString(), email).run();
      return json({ ok: true }, 200, h);
    }
  }
  if (chemin === '/restes-dus/comptes/supprimer' && request.method === 'POST') {
    const b = await request.json().catch(() => ({}));
    const em = String(b.email || '').trim().toLowerCase();
    if (!em) return erreur('Adresse requise', 400, h);
    await env.DB.prepare('DELETE FROM restes_dus_comptes WHERE email = ?').bind(em).run();
    return json({ ok: true }, 200, h);
  }
  return erreur('Introuvable', 404, h);
}
