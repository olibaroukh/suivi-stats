/* Séminaire franchisés — partie serveur (Worker suivi-stats-api).
 *
 * Page : https://olibaroukh.github.io/suivi-stats/seminaire-franchises/
 * Même connexion Zimbra que Suivi Stats. Données à part (tables seminaire_*), jamais
 * mélangées avec les photos du mois.
 *
 * Droits :
 *  - « responsable » : administrateurs de Suivi Stats + comptes désignés (Sacha Assola,
 *    Laurent Levy) → voient toutes les notes, gèrent l'édition de l'année et les comptes.
 *  - « directeur » : directeurs de pôle → ne voient et ne modifient que leurs propres notes.
 *  Les droits sont relus en base à chaque appel. Une note ne peut être modifiée que par son auteur.
 */

const RESPONSABLES_DEPART = [
  ['sacha.assola@optical-center.com', 'Sacha Assola'],
  ['laurent.levy@optical-center.com', 'Laurent Levy'],
];
const TYPES_NOTE = ['preparation', 'speed', 'informel'];
const TAILLE_MAX_NOTE = 30000;

// Édition par défaut (modifiable dans Réglages par un responsable)
export function configParDefaut(annee) {
  return {
    annee,
    titre: `Séminaire franchisés ${annee}`,
    lieu: '', du: '', au: '',
    sujetsProposes: ['Ouvertures de magasins', 'Rentabilité', 'Recrutement', 'Formation', 'Marketing / communication', 'Audio',
      'Achats / produits', 'Informatique / Cosium', 'Relations avec le siège', 'Tiers payant / mutuelles', 'Succession / cession', 'Concurrence'],
    besoinsProposes: [],
    sujetCentral: {
      titre: 'Ouvertures de magasins en franchise',
      questions: [
        { id: 'projet', libelle: 'Projet d’ouverture', type: 'choix', options: ['Oui', 'Peut-être', 'Non', 'Déjà en cours'] },
        { id: 'nombre', libelle: 'Nombre de magasins envisagés', type: 'choix', options: ['1', '2', '3 ou plus'] },
        { id: 'zone', libelle: 'Ville / zone visée', type: 'texte' },
        { id: 'horizon', libelle: 'Horizon', type: 'choix', options: ['Moins de 6 mois', '6 à 12 mois', '1 à 2 ans', 'Plus tard'] },
        { id: 'besoins', libelle: 'Besoins', type: 'etiquettes', options: ['Emplacement', 'Financement', 'Recrutement', 'Accompagnement à l’ouverture', 'Travaux / agencement', 'Juridique', 'Formation'] },
        { id: 'freins', libelle: 'Freins / inquiétudes', type: 'texte' },
      ],
    },
  };
}

let schemaPret = false;
async function schemaSeminaire(env) {
  if (schemaPret) return;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS seminaire_comptes (email TEXT PRIMARY KEY, nom TEXT, role TEXT NOT NULL DEFAULT 'directeur', actif INTEGER NOT NULL DEFAULT 1, maj_le TEXT, par TEXT)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS seminaire_config (annee INTEGER PRIMARY KEY, valeur TEXT NOT NULL, maj_le TEXT, par TEXT)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS seminaire_notes (id TEXT PRIMARY KEY, annee INTEGER NOT NULL, auteur TEXT NOT NULL, franchise TEXT NOT NULL, type TEXT NOT NULL, donnees TEXT NOT NULL, cree_le TEXT, maj_le TEXT NOT NULL, supprime INTEGER NOT NULL DEFAULT 0)`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS seminaire_notes_annee ON seminaire_notes (annee, auteur)`),
    ...RESPONSABLES_DEPART.map(([e, n]) => env.DB.prepare(`INSERT OR IGNORE INTO seminaire_comptes (email, nom, role, actif, maj_le, par) VALUES (?, ?, 'responsable', 1, ?, 'départ')`).bind(e, n, new Date().toISOString())),
  ]);
  schemaPret = true;
}

// Compte séminaire seul (personne sans accès à Suivi Stats) : utilisé à la connexion
export async function compteSeminaire(env, email) {
  await schemaSeminaire(env);
  return env.DB.prepare('SELECT * FROM seminaire_comptes WHERE email = ? AND actif = 1').bind(email).first();
}

// « prenom.nom@… » → « Prenom Nom » (nom affiché si aucun nom n'est saisi)
const nomDepuisEmail = e => String(e || '').split('@')[0].split(/[._-]+/).filter(Boolean).map(x => x[0].toUpperCase() + x.slice(1)).join(' ');
async function droit(env, p) {
  const c = await compteSeminaire(env, p.email);
  if (p.role === 'admin') return { droit: 'responsable', nom: (c && c.nom) || p.nom || nomDepuisEmail(p.email) };
  if (!c) return null;
  return { droit: c.role === 'responsable' ? 'responsable' : 'directeur', nom: c.nom || nomDepuisEmail(p.email) };
}

const normNom = x => String(x == null ? '' : x).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
// 08/11/2026 (décision d'Olivier) : tous les directeurs et AR voient tous les franchisés et leurs informations de départ.
// Un directeur ne reçoit que sa propre colonne du planning ; ses notes restent privées (voir /seminaire/notes).
function filtrerConfig(c, email, resp) {
  if (resp || !c) return c;
  return { ...c, planning: (c.planning || []).filter(p => p.directeur === email) };
}
// Remplace une adresse de directeur dans le planning de toutes les éditions (compte corrigé ou supprimé)
async function remplacerDirecteur(env, ancien, nouveau) {
  const r = await env.DB.prepare('SELECT annee, valeur FROM seminaire_config').all();
  for (const x of r.results || []) {
    let c; try { c = JSON.parse(x.valeur); } catch (e) { continue; }
    let ch = false;
    for (const pl of c.planning || []) if (pl.directeur === ancien) { pl.directeur = nouveau || ''; ch = true; }
    if (ch) await env.DB.prepare('UPDATE seminaire_config SET valeur = ? WHERE annee = ?').bind(JSON.stringify(c), x.annee).run();
  }
}
async function lireJSON(env, chemin) { const o = await env.FICHIERS.get(chemin); if (!o) return null; try { return await o.json(); } catch (e) { return null; } }

async function lireConfig(env, annee) {
  const r = await env.DB.prepare('SELECT valeur, maj_le, par FROM seminaire_config WHERE annee = ?').bind(annee).first();
  if (!r) return { ...configParDefaut(annee), _parDefaut: true };
  try { return { ...JSON.parse(r.valeur), _maj: r.maj_le, _par: r.par }; } catch (e) { return configParDefaut(annee); }
}

// Liste des franchisés : référentiel (Type = Franchise, actifs) regroupé par Groupe + chiffres de la dernière photo (en €)
async function franchises(env) {
  const ref = (await lireJSON(env, 'config/referentiel.json')) || [];
  const mois = await env.DB.prepare('SELECT cle FROM mois ORDER BY cle DESC LIMIT 1').first();
  const photo = mois ? await lireJSON(env, `donnees/${mois.cle}/photo.json`) : null;
  const taux = (await lireJSON(env, 'config/taux-change.json')) || { Euro: 1 };
  const nz = v => (v == null || v === '' || isNaN(v)) ? null : Number(v);
  const groupes = new Map();
  for (const r of ref) {
    if (r.actif !== 'Oui' || r.type !== 'Franchise' || !r.groupe) continue;
    const g = String(r.groupe).trim();
    if (!groupes.has(g)) groupes.set(g, { groupe: g, pays: new Set(), ar: new Set(), magasins: [] });
    const x = groupes.get(g), t = taux[r.devise || 'Euro'] || 1;
    const d = photo && photo.magasins && photo.magasins[String(r.code)], N = (d && d.N) || {}, N1 = (d && d.N1) || {};
    const ca = nz(N.P), ca1 = nz(N1.P), obj = nz(N.O);
    x.pays.add(r.pays || ''); if (r.ar) x.ar.add(r.ar);
    x.magasins.push({
      code: String(r.code), magasin: r.magasin || '', pays: r.pays || '', nature: r.nature || '', ouverture: r.ouverture || '',
      ca: ca == null ? null : Math.round(ca * t), ca1: ca1 == null ? null : Math.round(ca1 * t), obj: obj == null ? null : Math.round(obj * 1000 * t),
      noteGoogle: nz(N.BK), avisGoogle: nz(N.BL),
    });
  }
  const m = photo ? photo.mois : null;
  const liste = [...groupes.values()].map(x => {
    const s = k => x.magasins.reduce((a, y) => a + (y[k] || 0), 0);
    const ca = s('ca'), ca1 = x.magasins.filter(y => y.ca1).reduce((a, y) => a + y.ca1, 0), ca1comp = x.magasins.filter(y => y.ca1).reduce((a, y) => a + (y.ca || 0), 0);
    const obj = x.magasins.filter(y => y.obj && y.ca != null).reduce((a, y) => a + y.obj, 0), caObj = x.magasins.filter(y => y.obj && y.ca != null).reduce((a, y) => a + y.ca, 0);
    return {
      groupe: x.groupe, pays: [...x.pays].filter(Boolean), ar: [...x.ar], nb: x.magasins.length, magasins: x.magasins.sort((a, b) => a.magasin.localeCompare(b.magasin, 'fr')),
      ca, evol: ca1 ? ca1comp / ca1 - 1 : null, posit: obj && m ? caObj * 12 / m / obj : null,
    };
  }).sort((a, b) => a.groupe.localeCompare(b.groupe, 'fr'));
  return { mois: mois ? mois.cle : null, franchises: liste };
}

function valideNote(n) {
  if (!n || typeof n !== 'object') return 'note vide';
  if (!/^[\w-]{8,64}$/.test(String(n.id || ''))) return 'identifiant invalide';
  if (!(+n.annee >= 2024 && +n.annee <= 2100)) return 'année invalide';
  if (!TYPES_NOTE.includes(n.type)) return 'type invalide';
  if (!n.franchise || String(n.franchise).length > 200) return 'franchisé requis';
  const t = JSON.stringify(n.donnees || {});
  if (t.length > TAILLE_MAX_NOTE) return 'note trop longue';
  return null;
}

// Routes /seminaire/* ; p = profil de la personne connectée (Suivi Stats ou compte séminaire seul)
export async function routesSeminaire(request, env, p, chemin, url, h, json, erreur) {
  await schemaSeminaire(env);
  const d = await droit(env, p);
  if (!d) return erreur('Accès au séminaire non autorisé. Demandez l’accès à Olivier Baroukh.', 403, h);
  const resp = d.droit === 'responsable', email = p.email;
  const annee = +(url.searchParams.get('annee') || new Date().getFullYear());

  if (chemin === '/seminaire/moi') {
    const r = await env.DB.prepare('SELECT annee FROM seminaire_config ORDER BY annee DESC').all();
    return json({ ok: true, email, nom: d.nom, droit: d.droit, annees: (r.results || []).map(x => x.annee) }, 200, h);
  }
  if (chemin === '/seminaire/config' && request.method === 'GET') {
    if (!(annee >= 2024 && annee <= 2100)) return erreur('Année invalide', 400, h);
    return json({ ok: true, config: filtrerConfig(await lireConfig(env, annee), email, resp) }, 200, h);
  }
  if (chemin === '/seminaire/config' && request.method === 'PUT') {
    if (!resp) return erreur('Réservé aux responsables du séminaire', 403, h);
    const c = await request.json().catch(() => null);
    if (!c || !(+c.annee >= 2024 && +c.annee <= 2100)) return erreur('Année invalide', 400, h);
    delete c._parDefaut; delete c._maj; delete c._par;
    const t = JSON.stringify(c); if (t.length > 800000) return erreur('Réglages trop longs', 400, h);
    await env.DB.prepare('INSERT INTO seminaire_config (annee, valeur, maj_le, par) VALUES (?, ?, ?, ?) ON CONFLICT(annee) DO UPDATE SET valeur = excluded.valeur, maj_le = excluded.maj_le, par = excluded.par')
      .bind(+c.annee, t, new Date().toISOString(), email).run();
    return json({ ok: true }, 200, h);
  }
  if (chemin === '/seminaire/franchises') return json({ ok: true, ...(await franchises(env)) }, 200, h);

  if (chemin === '/seminaire/notes' && request.method === 'GET') {
    const r = resp
      ? await env.DB.prepare('SELECT n.*, c.nom AS auteur_nom FROM seminaire_notes n LEFT JOIN seminaire_comptes c ON c.email = n.auteur WHERE n.annee = ?').bind(annee).all()
      : await env.DB.prepare('SELECT n.*, NULL AS auteur_nom FROM seminaire_notes n WHERE n.annee = ? AND n.auteur = ?').bind(annee, email).all();
    const notes = (r.results || []).map(x => ({ id: x.id, annee: x.annee, auteur: x.auteur, auteurNom: x.auteur_nom || (x.auteur === email ? d.nom : nomDepuisEmail(x.auteur)), franchise: x.franchise, type: x.type,
      donnees: JSON.parse(x.donnees || '{}'), creeLe: x.cree_le, majLe: x.maj_le, supprime: !!x.supprime }));
    return json({ ok: true, notes }, 200, h);
  }
  // Envoi groupé (file d'attente hors connexion du téléphone) : création, modification, suppression (douce)
  if (chemin === '/seminaire/notes' && request.method === 'POST') {
    const b = await request.json().catch(() => ({}));
    const liste = Array.isArray(b.notes) ? b.notes.slice(0, 200) : [];
    const resultats = [];
    for (const n of liste) {
      const pb = valideNote(n);
      if (pb) { resultats.push({ id: n && n.id, ok: false, erreur: pb }); continue; }
      const ex = await env.DB.prepare('SELECT auteur, maj_le FROM seminaire_notes WHERE id = ?').bind(n.id).first();
      if (ex && ex.auteur !== email) { resultats.push({ id: n.id, ok: false, erreur: 'note d’un autre directeur' }); continue; }
      const maj = String(n.majLe || new Date().toISOString());
      if (ex && ex.maj_le > maj) { resultats.push({ id: n.id, ok: true, ignore: 'version plus récente déjà enregistrée' }); continue; }
      await env.DB.prepare(`INSERT INTO seminaire_notes (id, annee, auteur, franchise, type, donnees, cree_le, maj_le, supprime) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET franchise = excluded.franchise, type = excluded.type, donnees = excluded.donnees, maj_le = excluded.maj_le, supprime = excluded.supprime`)
        .bind(n.id, +n.annee, email, String(n.franchise), n.type, JSON.stringify(n.donnees || {}), String(n.creeLe || maj), maj, n.supprime ? 1 : 0).run();
      resultats.push({ id: n.id, ok: true });
    }
    return json({ ok: true, resultats }, 200, h);
  }

  if (chemin === '/seminaire/comptes') {
    if (!resp) return erreur('Réservé aux responsables du séminaire', 403, h);
    if (request.method === 'GET') {
      const r = await env.DB.prepare('SELECT email, nom, role, actif, maj_le FROM seminaire_comptes ORDER BY role DESC, nom').all();
      const cx = await env.DB.prepare(`SELECT auteur, COUNT(*) AS nb, MAX(maj_le) AS der FROM seminaire_notes WHERE annee = ? AND supprime = 0 GROUP BY auteur`).bind(annee).all();
      const parAuteur = Object.fromEntries((cx.results || []).map(x => [x.auteur, x]));
      // Administrateurs de Suivi Stats (responsables d'office, non modifiables ici)
      const admins = String(env.ADMINS || '').toLowerCase().split(',').map(x => x.trim()).filter(Boolean)
        .filter(e => !(r.results || []).some(c => c.email === e)).map(e => ({ email: e, nom: nomDepuisEmail(e), role: 'responsable', actif: 1, admin: true }));
      return json({ ok: true, comptes: [...admins, ...(r.results || [])].map(c => ({ ...c, notes: (parAuteur[c.email] || {}).nb || 0, derniere: (parAuteur[c.email] || {}).der || null })) }, 200, h);
    }
    if (request.method === 'PUT') {
      const c = await request.json().catch(() => null);
      const em = String(c && c.email || '').trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) return erreur('Adresse e-mail invalide', 400, h);
      // Correction d'une adresse saisie par erreur : l'ancien compte est remplacé (planning et notes suivent)
      const ancien = String(c.ancienEmail || '').trim().toLowerCase();
      if (ancien && ancien !== em) {
        if (await env.DB.prepare('SELECT 1 FROM seminaire_comptes WHERE email = ?').bind(em).first()) return erreur('Cette adresse a déjà un compte', 409, h);
        await env.DB.prepare('DELETE FROM seminaire_comptes WHERE email = ?').bind(ancien).run();
        await env.DB.prepare('UPDATE seminaire_notes SET auteur = ? WHERE auteur = ?').bind(em, ancien).run();
        await remplacerDirecteur(env, ancien, em);
      }
      await env.DB.prepare(`INSERT INTO seminaire_comptes (email, nom, role, actif, maj_le, par) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(email) DO UPDATE SET nom = excluded.nom, role = excluded.role, actif = excluded.actif, maj_le = excluded.maj_le, par = excluded.par`)
        .bind(em, String(c.nom || '').slice(0, 120) || null, c.role === 'responsable' ? 'responsable' : 'directeur', c.actif === false ? 0 : 1, new Date().toISOString(), email).run();
      return json({ ok: true }, 200, h);
    }
  }
  // Suppression d'un compte saisi par erreur ; s'il a déjà des notes, il est seulement désactivé (rien n'est perdu)
  if (chemin === '/seminaire/comptes/supprimer' && request.method === 'POST') {
    if (!resp) return erreur('Réservé aux responsables du séminaire', 403, h);
    const b = await request.json().catch(() => ({}));
    const em = String(b.email || '').trim().toLowerCase();
    if (!em) return erreur('Adresse requise', 400, h);
    if (em === email) return erreur('Vous ne pouvez pas supprimer votre propre compte', 400, h);
    const nb = (await env.DB.prepare('SELECT COUNT(*) AS n FROM seminaire_notes WHERE auteur = ? AND supprime = 0').bind(em).first()).n;
    if (nb) {
      await env.DB.prepare('UPDATE seminaire_comptes SET actif = 0, maj_le = ?, par = ? WHERE email = ?').bind(new Date().toISOString(), email, em).run();
      return json({ ok: true, desactive: true, notes: nb }, 200, h);
    }
    await env.DB.prepare('DELETE FROM seminaire_comptes WHERE email = ?').bind(em).run();
    await remplacerDirecteur(env, em, '');
    return json({ ok: true, supprime: true }, 200, h);
  }
  return erreur('Introuvable', 404, h);
}
