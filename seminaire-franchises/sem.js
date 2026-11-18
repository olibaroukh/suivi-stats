/* Séminaire franchisés — Optical Center.
 * Même connexion que Suivi Stats (session partagée sur olibaroukh.github.io), données dans le Worker suivi-stats-api.
 * Hors connexion : les notes sont gardées sur l'appareil et envoyées dès que le réseau revient. */
(function () {
  'use strict';
  const API = 'https://suivi-stats-api.oli-baroukh.workers.dev';
  const CLE_SESSION = 'suiviStatsSession';
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = s => String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const HUMEURS = [[1, '😟', 'Très négatif'], [2, '🙁', 'Négatif'], [3, '😐', 'Neutre'], [4, '🙂', 'Positif'], [5, '😄', 'Très positif']];
  const emoji = h => (HUMEURS.find(x => x[0] === h) || [0, ''])[1];
  const STATUTS = ['À faire', 'En cours', 'Fait'];
  const keur = v => v == null ? '–' : Math.round(v / 1000).toLocaleString('fr-FR') + ' k€';
  const pc = v => v == null ? '–' : (v * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' %';
  const evo = v => v == null ? '–' : `<span class="${v >= 0 ? 'ok' : 'ko'}">${v >= 0 ? '+' : ''}${pc(v)}</span>`;
  const dateFr = s => { if (!s) return ''; const [a, m, j] = String(s).slice(0, 10).split('-'); return j ? `${j}/${m}/${a}` : s; };
  const aujourdhui = () => new Date().toISOString().slice(0, 10);

  // ---------- Session et état ----------
  let session = null;
  try { const x = JSON.parse(localStorage.getItem(CLE_SESSION) || 'null'); if (x && x.jeton) session = x; } catch (e) {}
  const S = { moi: null, annee: new Date().getFullYear(), config: null, editions: [], franchises: [], moisChiffres: null, notes: new Map(), file: [], comptes: [] };
  const ICONES = ['🏝️', '🌴', '⛱️', '🌊', '🐠', '⛰️', '🏔️', '🏛️', '🗼', '🏰', '⛵', '✈️', '🌍', '☀️', '🍷', '🎯', '⭐', '🤝'];
  let surAccueil = true;
  // Icône d'un séminaire : un émoji, ou une photo (album ou appareil photo) recadrée en carré
  const estPhoto = i => typeof i === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(i);
  const iconeHtml = (i, taille) => estPhoto(i) ? `<img src="${i}" alt="" style="${taille ? `width:${taille}px;height:${taille}px;` : ''}border-radius:50%;object-fit:cover;vertical-align:middle">` : esc(i || '🏝️');
  const titreHtml = (i, t) => `${i ? iconeHtml(i, 26) + ' ' : ''}${esc(t)}`;
  // Choix de l'icône : grille d'émojis + bouton Photo ; quand(icone) est appelé à chaque choix
  function grilleIcones(conteneur, actuelle, quand) {
    const rendre = () => {
      conteneur.innerHTML = `<button type="button" data-photo class="${estPhoto(actuelle) ? 'on' : ''}" title="Photo de l'album ou de l'appareil photo" style="${estPhoto(actuelle) ? 'padding:3px' : 'font-size:14px'}">${estPhoto(actuelle) ? iconeHtml(actuelle, 38) : '📷 Photo'}</button>`
        + ICONES.map(i => `<button type="button" data-i="${i}" class="${i === actuelle ? 'on' : ''}">${i}</button>`).join('');
      conteneur.querySelectorAll('[data-i]').forEach(b => b.onclick = () => { actuelle = b.dataset.i; quand(actuelle); rendre(); });
      conteneur.querySelector('[data-photo]').onclick = () => {
        const f = document.createElement('input'); f.type = 'file'; f.accept = 'image/*';
        f.onchange = async () => { const fic = f.files[0]; if (!fic) return; try { actuelle = await photoCarree(fic, 320); quand(actuelle); rendre(); } catch (e) { alert('Photo illisible : ' + e.message); } };
        f.click();
      };
    };
    rendre();
  }
  // Recadrage au centre en carré, réduit (~30 Ko) pour rester léger sur les téléphones
  function photoCarree(fichier, cote) {
    return new Promise((ok, ko) => {
      const url = URL.createObjectURL(fichier), img = new Image();
      img.onload = () => {
        const c = Math.min(img.naturalWidth, img.naturalHeight); if (!c) { URL.revokeObjectURL(url); return ko(new Error('image vide')); }
        const cv = document.createElement('canvas'); cv.width = cv.height = cote;
        cv.getContext('2d').drawImage(img, (img.naturalWidth - c) / 2, (img.naturalHeight - c) / 2, c, c, 0, 0, cote, cote);
        URL.revokeObjectURL(url); ok(cv.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = () => { URL.revokeObjectURL(url); ko(new Error('format non reconnu (essayez une photo JPEG)')); };
      img.src = url;
    });
  }
  const cleCache = () => 'seminaireCache:' + (session && session.profil ? session.profil.email : '');
  const cleFile = () => 'seminaireFile:' + (session && session.profil ? session.profil.email : '');
  function sauverCache() {
    try { localStorage.setItem(cleFile(), JSON.stringify(S.file)); } catch (e) { console.warn('file', e); alert('Mémoire de l’appareil pleine : reconnectez-vous au réseau pour envoyer vos notes.'); }
    const base = { moi: S.moi, annee: S.annee, config: S.config, editions: S.editions, franchises: S.franchises, moisChiffres: S.moisChiffres };
    try { localStorage.setItem(cleCache(), JSON.stringify({ ...base, notes: [...S.notes.values()] })); }
    catch (e) {
      // Trop lourd (notes au stylet) : on garde sur l'appareil les tracés de ses propres notes seulement
      const allege = [...S.notes.values()].map(n => n.type === 'manuscrit' && n.auteur !== monEmail() ? { ...n, donnees: { ...n.donnees, pages: null, allege: true } } : n);
      try { localStorage.setItem(cleCache(), JSON.stringify({ ...base, notes: allege })); } catch (x) { console.warn('cache', x); }
    }
  }
  function lireFileSeule() { try { S.file = JSON.parse(localStorage.getItem(cleFile()) || '[]'); } catch (e) { S.file = []; } }
  function lireCache() {
    try {
      const c = JSON.parse(localStorage.getItem(cleCache()) || 'null');
      if (c) { S.moi = c.moi; S.annee = c.annee || S.annee; S.config = c.config; S.editions = c.editions || []; S.franchises = c.franchises || []; S.moisChiffres = c.moisChiffres; (c.notes || []).forEach(n => S.notes.set(n.id, n)); }
      S.file = JSON.parse(localStorage.getItem(cleFile()) || '[]');
      return !!c;
    } catch (e) { return false; }
  }
  // Reconnexion obligatoire toutes les 2 heures (informations sensibles) ; le serveur applique la même règle
  const DUREE_SESSION_MS = 2 * 60 * 60 * 1000;
  const debutSession = () => session ? (session.debut || (session.expire + 60000 - 12 * 60 * 60 * 1000)) : 0;
  const sessionValide = () => !!session && session.jeton && Date.now() - debutSession() < DUREE_SESSION_MS;
  function verrouiller(message) {
    // Les notes non envoyées restent sur l'appareil (file d'attente) ; tout le reste est effacé de l'appareil
    try { localStorage.removeItem(cleCache()); } catch (e) {}
    surAccueil = true; S.moi = null; S.config = null; S.editions = []; S.franchises = []; S.notes.clear(); S.comptes = []; cfg = null;
    S.notes = new Map(S.file.map(n => [n.id, n]));
    fenetreFr = null; $('#fenetre').innerHTML = '';
    afficherConnexion();
    $('#cx-info').textContent = message || 'Par sécurité, reconnectez-vous (toutes les 2 heures).';
    if (S.file.length) $('#cx-info').textContent += ` ${S.file.length} note(s) en attente seront envoyées après la connexion.`;
  }
  function surveillerSession() {
    if (!S.moi) return;
    if (!sessionValide()) return verrouiller();
    const reste = Math.max(0, DUREE_SESSION_MS - (Date.now() - debutSession())), min = Math.round(reste / 60000);
    const el = $('#qui-duree'); if (el) el.textContent = ` · reconnexion dans ${min >= 60 ? Math.floor(min / 60) + ' h ' + String(min % 60).padStart(2, '0') : min + ' min'}`;
  }
  const resp = () => S.moi && S.moi.droit === 'responsable';
  const monEmail = () => session && session.profil ? session.profil.email : '';

  async function appel(chemin, opts) {
    if (!session) throw new Error('Connexion requise');
    let r;
    try { r = await fetch(API + chemin, { ...(opts || {}), headers: { 'Content-Type': 'application/json', ...((opts && opts.headers) || {}), Authorization: 'Bearer ' + session.jeton } }); }
    catch (e) { const x = new Error('hors ligne'); x.horsLigne = true; throw x; }
    const d = await r.json().catch(() => ({}));
    if (r.status === 401) { const x = new Error('Session expirée : reconnectez-vous.'); x.session = true; throw x; }
    if (!r.ok || d.ok === false) throw new Error(d.erreur || ('Erreur ' + r.status));
    return d;
  }

  // ---------- Synchronisation ----------
  let syncEnCours = false, etatReseau = 'ok';
  function afficherSync() {
    const el = $('#etat-sync'); el.hidden = false;
    if (etatReseau === 'session') { el.className = 'sync hors'; el.textContent = S.file.length ? `${S.file.length} note(s) en attente · reconnectez-vous` : 'Reconnectez-vous'; }
    else if (etatReseau === 'hors') { el.className = 'sync hors'; el.textContent = S.file.length ? `Hors ligne · ${S.file.length} en attente` : 'Hors ligne'; }
    else if (S.file.length) { el.className = 'sync attente'; el.textContent = `${S.file.length} en attente d'envoi`; }
    else { el.className = 'sync'; el.textContent = 'À jour ✓'; }
  }
  async function synchroniser(complet) {
    if (syncEnCours || !session) return; syncEnCours = true;
    try {
      if (S.file.length) {
        const lot = []; let taille = 0;
        for (const n of S.file) { const t = JSON.stringify(n).length; if (lot.length && (taille + t > 4e6 || lot.length >= 100)) break; lot.push(n); taille += t; }
        const d = await appel('/seminaire/notes', { method: 'POST', body: JSON.stringify({ notes: lot }) });
        const okIds = new Set((d.resultats || []).filter(x => x.ok).map(x => x.id));
        const refus = (d.resultats || []).filter(x => !x.ok);
        S.file = S.file.filter(n => !okIds.has(n.id) && !refus.some(x => x.id === n.id));
        if (refus.length) alert('Certaines notes ont été refusées : ' + refus.map(x => x.erreur).join(', '));
      }
      if (complet) {
        const [moi, cfg, fr, ed] = await Promise.all([appel('/seminaire/moi'), appel('/seminaire/config?annee=' + S.annee), appel('/seminaire/franchises'), appel('/seminaire/editions')]);
        S.editions = ed.editions || [];
        $('#bandeau-erreur').hidden = true; S.erreur = null; S.moi = moi; S.config = cfg.config; S.franchises = fr.franchises || []; S.moisChiffres = fr.mois;
      }
      const n = await appel('/seminaire/notes?annee=' + S.annee);
      const enAttente = new Set(S.file.map(x => x.id));
      const garde = [...S.notes.values()].filter(x => enAttente.has(x.id));
      const signature = () => [...S.notes.values()].map(x => x.id + x.majLe + (x.supprime ? 1 : 0)).sort().join('|');
      const avant = signature();
      S.notes = new Map(n.notes.map(x => [x.id, x])); garde.forEach(x => S.notes.set(x.id, x));
      etatReseau = 'ok';
      sauverCache();
      // Nouvel affichage seulement si quelque chose a changé (évite de perdre un clic en cours)
      if (complet || signature() !== avant) rafraichir();
    } catch (e) {
      etatReseau = e.session ? 'session' : e.horsLigne ? 'hors' : etatReseau;
      S.erreur = e.message;
      if (!e.session && !e.horsLigne) { console.warn(e); const b = $('#bandeau-erreur'); b.hidden = false; b.textContent = '⚠️ Impossible de charger le séminaire : ' + e.message; }
      if (e.session) verrouiller(e.message);
    } finally { syncEnCours = false; afficherSync(); }
  }
  function enregistrerNote(n, silencieux) {
    n.majLe = new Date().toISOString(); if (!n.creeLe) n.creeLe = n.majLe;
    n.auteur = monEmail(); n.auteurNom = S.moi ? S.moi.nom : n.auteur; n.annee = n.annee || S.annee;
    S.notes.set(n.id, n);
    S.file = S.file.filter(x => x.id !== n.id).concat([n]);
    sauverCache(); afficherSync(); if (!silencieux) rafraichir();
    synchroniser(false);
  }
  const nouvelId = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 12));
  // Identifiant fixe pour la préparation (une par directeur, franchisé et année), quel que soit l'appareil
  function hash(s) { let h1 = 0x811c9dc5, h2 = 0x01000193; for (let i = 0; i < s.length; i++) { h1 = Math.imul(h1 ^ s.charCodeAt(i), 16777619) >>> 0; h2 = Math.imul(h2 + s.charCodeAt(i), 2654435761) >>> 0; } return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0'); }
  const idPrep = fr => 'prep-' + S.annee + '-' + hash(monEmail() + '|' + fr);

  // Participants (personnes) de l'édition, rattachés à un groupe du référentiel ; à défaut, les groupes eux-mêmes
  const groupeDe = nom => S.franchises.find(f => f.groupe === nom) || null;
  function entrees() {
    const ps = (S.config && S.config.participants) || [];
    if (ps.length) return ps.map(p => ({ cle: p.nom, p, f: p.groupe ? groupeDe(p.groupe) : null })).sort((a, b) => a.cle.localeCompare(b.cle, 'fr'));
    return S.franchises.map(f => ({ cle: f.groupe, p: null, f }));
  }
  const entree = cle => entrees().find(e => e.cle === cle) || { cle, p: null, f: groupeDe(cle) };
  const nomCle = x => norm(x).replace(/[^a-z0-9]+/g, ' ').trim();
  const mesCreneaux = () => ((S.config && S.config.planning) || []).filter(pl => pl.directeur && pl.directeur === monEmail())
    .flatMap(pl => (pl.creneaux || []).map(c => ({ ...c, libelle: pl.libelle })));
  const idCreneau = c => 'sd-' + S.annee + '-' + hash(monEmail() + '|' + nomCle(c.participant) + '|' + c.debut);
  const creneauDe = cle => mesCreneaux().find(c => nomCle(c.participant) === nomCle(cle));

  const notesVisibles = () => [...S.notes.values()].filter(n => !n.supprime && n.annee === S.annee);
  const mesNotes = () => notesVisibles().filter(n => n.auteur === monEmail());
  const prepDe = fr => S.notes.get(idPrep(fr));

  // ---------- Démarrage ----------
  async function demarrer() {
    $('#btn-connexion').onclick = connecter;
    $('#cx-pass').onkeydown = e => { if (e.key === 'Enter') connecter(); };
    $('#lien-deconnexion').onclick = e => { e.preventDefault(); if (etatReseau === 'session') return afficherConnexion(); if (S.file.length && !confirm(`${S.file.length} note(s) ne sont pas encore envoyées et seront perdues. Se déconnecter quand même ?`)) return; localStorage.removeItem(cleCache()); localStorage.removeItem(cleFile()); localStorage.removeItem(CLE_SESSION); location.reload(); };
    document.querySelectorAll('#onglets button').forEach(b => b.onclick = () => vue(b.dataset.vue));
    $('#fr-q').oninput = rendreFranchises; $('#fr-mes').onchange = rendreFranchises;
    $('#pl-ajouter').onclick = () => ouvrirNote({ type: 'speed' });
    $('#sy-auteur').onchange = rendreSynthese;
    brancherAccueil();
    $('#sy-excel').onclick = exporterExcel;
    ['#cr-q', '#cr-auteur', '#cr-type', '#cr-ordre', '#cr-realises'].forEach(id => { $(id).oninput = $(id).onchange = rendreComptesRendus; });
    $('#cr-imprimer').onclick = () => window.print();
    $('#ms-nouvelle').onclick = () => ouvrirManuscrit(null, ''); $('#sy-imprimer').onclick = () => window.print();
    window.addEventListener('online', () => synchroniser(true));
    window.addEventListener('offline', () => { etatReseau = 'hors'; afficherSync(); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) synchroniser(false); });
    setInterval(() => synchroniser(false), 60000);
    setInterval(surveillerSession, 30000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) surveillerSession(); });
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

    if (!session) return afficherConnexion();
    if (!sessionValide()) { lireFileSeule(); return verrouiller(); }
    const cache = lireCache();
    if (cache && S.moi) { ouvrirAppli(); }
    try { await synchroniser(true); if (!S.moi) throw new Error('profil'); ouvrirAppli(); }
    catch (e) { if (!cache) { afficherConnexion(); if (S.erreur && etatReseau !== 'session') $('#cx-info').textContent = S.erreur === 'hors ligne' ? 'Pas de réseau : connectez-vous une première fois avec une connexion internet.' : S.erreur; } }
    if (etatReseau === 'session' && !cache) afficherConnexion();
  }
  function afficherConnexion() {
    $('#ecran-connexion').hidden = false; $('#principal').hidden = true; $('#onglets').hidden = true; $('#ecran-accueil').hidden = true; $('#btn-seminaires').hidden = true;
    if (session && session.profil) $('#cx-user').value = session.profil.email;
  }
  async function connecter() {
    $('#cx-info').textContent = 'Connexion…';
    try {
      const r = await fetch(API + '/auth/connexion', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifiant: $('#cx-user').value.trim(), motDePasse: $('#cx-pass').value }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) throw new Error(d.erreur && /pas accès à (Suivi Stats|cette application)/.test(d.erreur) ? 'Votre compte n’a pas accès au séminaire. Demandez l’accès à Olivier Baroukh.' : (d.erreur || 'Connexion impossible'));
      const ancien = session && session.profil && session.profil.email;
      session = { jeton: d.session, expire: Date.now() + d.expireDansMs - 60000, debut: Date.now(), profil: d.profil };
      localStorage.setItem(CLE_SESSION, JSON.stringify(session));
      $('#cx-pass').value = ''; $('#cx-info').textContent = '';
      if (ancien && ancien !== d.profil.email) { S.notes.clear(); S.file = []; } else lireFileSeule();
      lireCache(); etatReseau = 'ok';
      await synchroniser(true);
      if (!S.moi) throw new Error(S.erreur || 'Votre compte n’a pas accès au séminaire. Demandez l’accès à Olivier Baroukh.');
      $('#lien-deconnexion').textContent = 'Déconnexion';
      ouvrirAppli();
    } catch (e) { $('#cx-info').textContent = e.message; }
  }
  function ouvrirAppli() {
    $('#ecran-connexion').hidden = true;
    $('#lien-deconnexion').hidden = false;
    $('#qui').innerHTML = esc(S.moi.nom || monEmail()) + (resp() ? ' · responsable' : '') + '<span id="qui-duree"></span>';
    surveillerSession();
    $('#onglet-reglages').hidden = !resp();
    afficherSync();
    if (surAccueil) afficherAccueil(); else { $('#principal').hidden = false; $('#onglets').hidden = false; rafraichir(); }
  }

  // ---------- Accueil : choix du séminaire ----------
  const datesEdition = e => {
    if (!e.du && !e.au) return String(e.annee);
    const f = x => new Date(x + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
    return e.du && e.au ? `du ${f(e.du).replace(/ \d{4}$/, '')} au ${f(e.au)}` : f(e.du || e.au);
  };
  function afficherAccueil() {
    surAccueil = true; fenetreFr = null; $('#fenetre').innerHTML = '';
    $('#principal').hidden = true; $('#onglets').hidden = true; $('#ecran-accueil').hidden = false; $('#btn-seminaires').hidden = true;
    $('#titre-edition').textContent = 'Séminaires franchisés';
    const l = S.editions || [];
    $('#acc-liste').innerHTML = l.length ? l.map(e => `<div class="carte-sem" data-annee="${e.annee}"><div class="icone">${iconeHtml(e.icone)}</div>
      <div><b>${esc(e.titre)}</b>${e.lieu ? `<div class="lieu">${esc(e.lieu)}</div>` : ''}<div class="dates">${esc(datesEdition(e))}</div></div></div>`).join('')
      : `<div class="carte"><p class="muted">${resp() ? 'Aucun séminaire pour l’instant : créez le premier.' : 'Aucun séminaire pour l’instant.'}</p></div>`;
    $('#acc-liste').querySelectorAll('[data-annee]').forEach(x => x.onclick = () => choisirEdition(+x.dataset.annee));
    $('#acc-ouvrir-nouveau').hidden = !resp() || !$('#acc-nouveau').hidden;
    window.scrollTo(0, 0);
  }
  async function choisirEdition(annee) {
    surAccueil = false;
    $('#ecran-accueil').hidden = true; $('#principal').hidden = false; $('#onglets').hidden = false; $('#btn-seminaires').hidden = false;
    const e = (S.editions || []).find(x => x.annee === annee) || {};
    $('#titre-edition').innerHTML = titreHtml(e.icone, e.titre || 'Séminaire ' + annee);
    if (annee !== S.annee || !S.config || S.config._parDefaut || S.config.annee !== annee) {
      S.annee = annee; S.config = null; S.notes = new Map(S.file.map(n => [n.id, n]));
      document.querySelectorAll('.vue').forEach(v => v.classList.remove('actif'));
      $('#vue-franchises').classList.add('actif'); vueActive = 'franchises';
      document.querySelectorAll('#onglets button').forEach(b => b.classList.toggle('actif', b.dataset.vue === 'franchises'));
      $('#fr-liste').innerHTML = '<p class="muted">Chargement du séminaire…</p>';
      await synchroniser(true);
      if (!S.config) { afficherAccueil(); alert(etatReseau === 'hors' ? 'Connexion internet nécessaire pour ouvrir ce séminaire la première fois.' : 'Impossible d’ouvrir ce séminaire.'); return; }
    }
    else synchroniser(true); // séminaire déjà chargé : affichage immédiat, mise à jour en arrière-plan
    vue(vueActive);
  }
  function brancherAccueil() {
    $('#btn-seminaires').onclick = afficherAccueil;
    let icone = '🏝️';
    const icones = () => grilleIcones($('#acc-icones'), icone, i => { icone = i; });
    $('#acc-ouvrir-nouveau').onclick = () => {
      const pris = new Set((S.editions || []).map(e => e.annee)); let a = new Date().getFullYear(); while (pris.has(a)) a++;
      $('#acc-annee').value = a; $('#acc-titre').value = `Séminaire franchisés ${a}`; $('#acc-lieu').value = ''; $('#acc-du').value = ''; $('#acc-au').value = ''; $('#acc-info').textContent = '';
      $('#acc-reprendre').closest('label').hidden = !(S.editions || []).length;
      icone = '🏝️'; icones(); $('#acc-nouveau').hidden = false; $('#acc-ouvrir-nouveau').hidden = true; $('#acc-titre').focus();
    };
    $('#acc-annee').oninput = () => { const a = $('#acc-annee').value; if (/^Séminaire franchisés \d{4}$/.test($('#acc-titre').value)) $('#acc-titre').value = 'Séminaire franchisés ' + a; };
    $('#acc-annuler').onclick = () => { $('#acc-nouveau').hidden = true; afficherAccueil(); };
    $('#acc-creer').onclick = async () => {
      const a = +$('#acc-annee').value;
      if (!(a >= 2024 && a <= 2100)) { $('#acc-info').textContent = 'Année invalide'; return; }
      if ((S.editions || []).some(e => e.annee === a)) { $('#acc-info').textContent = `Un séminaire existe déjà pour ${a} (un séminaire par année).`; return; }
      $('#acc-info').textContent = 'Création…';
      try {
        const c = (await appel('/seminaire/config?annee=' + a)).config;
        const prec = (S.editions || []).filter(e => e.annee < a).sort((x, y) => y.annee - x.annee)[0] || (S.editions || [])[0];
        if ($('#acc-reprendre').checked && prec) {
          const p = (await appel('/seminaire/config?annee=' + prec.annee)).config;
          ['sujetsProposes', 'momentsSeminaire', 'sujetCentral', 'besoinsProposes'].forEach(k => { if (p[k]) c[k] = p[k]; });
        }
        Object.assign(c, { annee: a, titre: $('#acc-titre').value.trim() || `Séminaire franchisés ${a}`, lieu: $('#acc-lieu').value.trim(), du: $('#acc-du').value, au: $('#acc-au').value, icone, planning: [], participants: [] });
        delete c._parDefaut; delete c._maj; delete c._par;
        await appel('/seminaire/config', { method: 'PUT', body: JSON.stringify(c) });
        S.editions = [{ annee: a, titre: c.titre, lieu: c.lieu, du: c.du, au: c.au, icone }, ...(S.editions || []).filter(e => e.annee !== a)].sort((x, y) => y.annee - x.annee);
        $('#acc-nouveau').hidden = true; S.config = null; sauverCache();
        choisirEdition(a);
      } catch (e) { $('#acc-info').textContent = e.horsLigne ? 'Connexion internet nécessaire.' : e.message; }
    };
  }
  let vueActive = 'franchises';
  function vue(v) {
    vueActive = v;
    document.querySelectorAll('#onglets button').forEach(b => b.classList.toggle('actif', b.dataset.vue === v));
    document.querySelectorAll('.vue').forEach(s => s.classList.toggle('actif', s.id === 'vue-' + v));
    if (v === 'reglages') brancherReglages();
    rafraichir(); window.scrollTo(0, 0);
  }
  function rafraichir() {
    if (!S.moi || !S.config || surAccueil) { if (S.moi && surAccueil) afficherAccueil(); return; }
    $('#titre-edition').innerHTML = titreHtml(S.config.icone, S.config.titre || 'Séminaire franchisés');
    if (vueActive === 'franchises') rendreFranchises();
    if (vueActive === 'planning') rendrePlanning();
    if (vueActive === 'synthese') rendreSynthese();
    if (vueActive === 'comptes-rendus') rendreComptesRendus();
    if (vueActive === 'manuscrit') rendreListeManuscrits();
    // Pas de nouvel affichage de la fiche pendant une saisie (sinon le curseur saute)
    const actif = document.activeElement;
    if (fenetreFr && !(actif && $('#fenetre').contains(actif) && /^(INPUT|TEXTAREA)$/.test(actif.tagName))) rendreFicheFranchise(fenetreFr);
  }

  // ---------- Franchisés ----------
  function rendreFranchises() {
    const q = norm($('#fr-q').value), mes = $('#fr-mes').checked;
    const miennes = new Set(mesNotes().map(n => n.franchise));
    const l = entrees().filter(e => { const f = e.f;
      const txt = `${e.cle} ${e.p && e.p.groupe || ''} ${f ? f.pays.join(' ') + ' ' + f.ar.join(' ') + ' ' + f.magasins.map(m => m.magasin + ' ' + m.code).join(' ') : ''} ${e.p && e.p.dev ? e.p.dev.map(d => d.villes).join(' ') : ''}`;
      return (!q || norm(txt).includes(q)) && (!mes || miennes.has(e.cle) || creneauDe(e.cle)); });
    $('#fr-liste').innerHTML = l.length ? l.map(e => {
      const f = e.f, p = prepDe(e.cle), rdv = mesNotes().filter(n => n.franchise === e.cle && n.type === 'speed'), c = creneauDe(e.cle);
      const fait = rdv.some(n => n.donnees && n.donnees.realise);
      const sous = f ? `${f.nb} magasin${f.nb > 1 ? 's' : ''} · ${esc(f.pays.join(', '))}` : e.p && e.p.groupe ? esc(e.p.groupe) : '';
      return `<div class="item" data-fr="${esc(e.cle)}"><div><b>${esc(e.cle)}</b><span class="s">${sous}${e.p && e.p.sujetsDemandes ? ' · 📝 sujets envoyés' : ''}</span></div>
        <div class="d">${p && p.donnees.humeur ? `<span style="font-size:18px">${emoji(p.donnees.humeur)}</span> ` : ''}${p ? '<span class="pastille ok">préparé</span>' : ''}${fait ? '<span class="pastille ok">rencontré</span>' : c ? `<span class="pastille att">⏱️ ${esc(c.debut)}</span>` : rdv.length ? '<span class="pastille att">RDV prévu</span>' : ''}</div></div>`;
    }).join('') : '<p class="muted">Aucun franchisé ne correspond.</p>';
    $('#fr-liste').querySelectorAll('[data-fr]').forEach(x => x.onclick = () => ouvrirFranchise(x.dataset.fr));
    const nbP = ((S.config && S.config.participants) || []).length;
    $('#fr-source').textContent = nbP ? `${nbP} participants${S.moisChiffres ? ' · chiffres des groupes cumulés à fin ' + S.moisChiffres.split('-').reverse().join('/') : ''}` : S.franchises.length ? `${S.franchises.length} franchisés (référentiel Suivi Stats)${S.moisChiffres ? ' · chiffres cumulés à fin ' + S.moisChiffres.split('-').reverse().join('/') : ''}` : 'Liste des franchisés indisponible (connexion nécessaire au premier chargement).';
  }

  let fenetreFr = null;
  function ouvrirFranchise(fr) { fenetreFr = fr; rendreFicheFranchise(fr); }
  function fermerFenetre() { fenetreFr = null; $('#fenetre').innerHTML = ''; rafraichir(); }
  function rendreFicheFranchise(fr) {
    const e = entree(fr), f = e.f, part = e.p || {};
    const p = prepDe(fr), pd = (p && p.donnees) || {};
    const cr = creneauDe(fr);
    const infosDepart = part.etatEsprit || part.sujetsDemandes || part.ca2025 || (part.dev && part.dev.length) || part.ouverture;
    const echanges = notesVisibles().filter(n => n.franchise === fr && n.type !== 'preparation').sort((a, b) => String(b.donnees.date || b.creeLe).localeCompare(String(a.donnees.date || a.creeLe)));
    const autresPreps = resp() ? notesVisibles().filter(n => n.franchise === fr && n.type === 'preparation' && n.auteur !== monEmail()) : [];
    const sujetsListe = [...new Set([...(S.config.sujetsProposes || []), ...(pd.sujets || [])])];
    const ouvert = $('#fenetre').querySelector('.fond');
    const scroll = ouvert ? ouvert.scrollTop : 0;
    $('#fenetre').innerHTML = `<div class="fond"><div class="barre-haut"><button id="ff-retour">← Retour</button><h3>${esc(fr)}</h3></div><div class="contenu">
      ${cr ? `<div class="carte ligne"><b>⏱️ Speed dating ${esc(cr.debut)} – ${esc(cr.fin)}</b><button class="primaire pousse" id="ff-creneau">${S.notes.get(idCreneau(cr)) && !S.notes.get(idCreneau(cr)).supprime ? 'Voir l’échange' : 'Saisir l’échange'}</button></div>` : ''}
      ${infosDepart ? `<div class="carte"><h2>Avant le séminaire</h2>
        ${part.ca2025 ? `<p class="petit"><b>CA 2025 :</b> ${esc(Number(part.ca2025).toLocaleString('fr-FR'))} €</p>` : ''}
        ${part.etatEsprit ? `<label>État d'esprit</label><p style="white-space:pre-wrap;margin:0">${esc(part.etatEsprit)}</p>` : ''}
        ${part.dev && part.dev.length ? `<label>Développement prévu</label><div class="defile"><table>${part.dev.map(d => `<tr><td style="width:60px"><b>${esc(d.annee)}</b></td><td>${esc(d.villes)}</td></tr>`).join('')}</table></div>` : ''}
        ${part.ouverture ? `<p class="petit"><b>Ouverture prévue :</b> ${esc(part.ouverture)}</p>` : ''}
        ${part.sujetsDemandes ? `<label>Sujets qu'il souhaite aborder</label><p style="white-space:pre-wrap;margin:0;font-size:13px">${esc(part.sujetsDemandes)}</p>` : ''}
      </div>` : ''}
      ${f ? `<div class="carte"><h2>Chiffres${e.p ? ' · ' + esc(f.groupe) : ''}</h2>
        <div class="chiffres"><div><div class="v">${keur(f.ca)}</div><div class="l">CA cumulé</div></div><div><div class="v">${evo(f.evol)}</div><div class="l">vs N-1</div></div><div><div class="v">${pc(f.posit)}</div><div class="l">Positionnement</div></div></div>
        <p class="muted petit">${f.nb} magasin${f.nb > 1 ? 's' : ''} · ${esc(f.pays.join(', '))}${f.ar.length ? ' · AR : ' + esc(f.ar.join(', ')) : ''}${S.moisChiffres ? ' · à fin ' + S.moisChiffres.split('-').reverse().join('/') : ''}</p>
        <details><summary class="petit" style="cursor:pointer">Voir les magasins</summary><div class="defile"><table><tr><th>Magasin</th><th>CA</th><th>vs N-1</th><th>Posit.</th><th>Google</th></tr>
        ${f.magasins.map(m => `<tr><td>${esc(m.magasin)}<br><span class="muted">${esc(m.code)}${m.ouverture ? ' · ouv. ' + esc(String(m.ouverture).slice(0, 10)) : ''}</span></td><td>${keur(m.ca)}</td><td>${m.ca1 ? evo(m.ca / m.ca1 - 1) : '–'}</td><td>${m.obj && m.ca != null && S.moisChiffres ? pc(m.ca * 12 / +S.moisChiffres.slice(5) / m.obj) : '–'}</td><td>${m.noteGoogle ? '★ ' + m.noteGoogle.toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' (' + (m.avisGoogle || 0) + ')' : '–'}</td></tr>`).join('')}</table></div></details>
      </div>` : `<p class="muted petit" style="margin:0 4px 12px">${e.p ? 'Groupe du référentiel non associé : chiffres indisponibles' + (resp() ? ' (Réglages › Participants).' : '.') : ''}</p>`}
      <div class="carte"><h2>Ma préparation</h2>
        <label>État d'esprit</label>
        <div class="humeur">${HUMEURS.map(([v, e, l]) => `<button data-h="${v}" class="${pd.humeur === v ? 'on' : ''}" title="${esc(l)}">${e}</button>`).join('')}</div>
        <textarea id="ff-esprit" placeholder="Ce que l'on sait de son état d'esprit avant le séminaire…" style="margin-top:8px">${esc(pd.esprit || '')}</textarea>
        <label>Sujets qui l'intéressent</label>
        <div class="chips" id="ff-sujets">${sujetsListe.map(s => `<span class="chip ${(pd.sujets || []).includes(s) ? 'on' : ''}" data-s="${esc(s)}">${esc(s)}</span>`).join('')}<span class="chip" id="ff-autre">+ autre</span></div>
        <p class="muted petit" id="ff-info">${p ? 'Enregistré ' + new Date(p.majLe).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : 'Les modifications sont enregistrées automatiquement.'}</p>
      </div>
      ${autresPreps.length ? `<div class="carte lecture"><h2>Préparation des autres directeurs</h2>${autresPreps.map(n => `<div class="note"><div class="t">${esc(n.auteurNom)} ${emoji(n.donnees.humeur)}</div>${n.donnees.esprit ? `<p>${esc(n.donnees.esprit)}</p>` : ''}${(n.donnees.sujets || []).map(s => `<span class="pastille">${esc(s)}</span>`).join('')}</div>`).join('')}</div>` : ''}
      <div class="carte"><h2>Échanges</h2>
        <div class="ligne"><button class="primaire" id="ff-speed" style="flex:1">+ Speed dating</button><button id="ff-info-btn" style="flex:1">+ Échange informel</button><button id="ff-stylet" style="flex:1">+ ✍️ Stylet</button></div>
        ${echanges.length ? echanges.map(apercuNote).join('') : '<p class="muted petit">Aucun échange pour l’instant.</p>'}
      </div></div></div>`;
    const fond = $('#fenetre .fond'); fond.scrollTop = scroll;
    $('#ff-retour').onclick = fermerFenetre;
    const sauverPrep = (maj, silencieux) => {
      const n = prepDe(fr) || { id: idPrep(fr), type: 'preparation', franchise: fr, donnees: {} };
      n.donnees = { ...n.donnees, ...maj }; enregistrerNote(n, silencieux);
      if (silencieux) { pd.esprit = n.donnees.esprit; const i = $('#ff-info'); if (i) i.textContent = 'Enregistré ' + new Date(n.majLe).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }); }
    };
    fond.querySelectorAll('[data-h]').forEach(b => b.onclick = () => { const v = +b.dataset.h; sauverPrep({ humeur: pd.humeur === v ? null : v }); });
    let t = null;
    $('#ff-esprit').oninput = e => { clearTimeout(t); $('#ff-info').textContent = '…'; t = setTimeout(() => { t = null; sauverPrep({ esprit: e.target.value }, true); }, 900); };
    $('#ff-esprit').onblur = e => { if (t) { clearTimeout(t); t = null; if ((pd.esprit || '') !== e.target.value) sauverPrep({ esprit: e.target.value }, true); } };
    fond.querySelectorAll('#ff-sujets [data-s]').forEach(c => c.onclick = () => { const s = c.dataset.s, l = new Set(pd.sujets || []); l.has(s) ? l.delete(s) : l.add(s); sauverPrep({ sujets: [...l] }); });
    $('#ff-autre').onclick = () => { const s = (prompt('Autre sujet :') || '').trim(); if (s) sauverPrep({ sujets: [...new Set([...(pd.sujets || []), s])] }); };
    $('#ff-speed').onclick = () => cr ? ouvrirCreneau(cr) : ouvrirNote({ type: 'speed', franchise: fr });
    if ($('#ff-creneau')) $('#ff-creneau').onclick = () => ouvrirCreneau(cr);
    $('#ff-info-btn').onclick = () => ouvrirNote({ type: 'informel', franchise: fr });
    $('#ff-stylet').onclick = () => ouvrirManuscrit(null, fr);
    fond.querySelectorAll('[data-note]').forEach(x => x.onclick = () => ouvrirNote(S.notes.get(x.dataset.note)));
  }
  function apercuNote(n) {
    if (n.type === 'manuscrit') return `<div class="note" data-note="${esc(n.id)}"><div class="t">✍️ Note au stylet · ${esc(dateFr(n.donnees.date || n.creeLe))}${n.auteur !== monEmail() ? ' · ' + esc(n.auteurNom) : ''}${n.donnees.titre ? ' · <b>' + esc(n.donnees.titre) + '</b>' : ''}</div>${vignettes(n, 1, 120)}</div>`;
    const d = n.donnees || {}, c = d.central || {};
    const repC = Object.entries(c).filter(([, v]) => v && (!Array.isArray(v) || v.length)).map(([k, v]) => { const q = ((S.config.sujetCentral || {}).questions || []).find(x => x.id === k); return `${esc(q ? q.libelle : k)} : <b>${esc(Array.isArray(v) ? v.join(', ') : v)}</b>`; });
    const actions = (d.actions || []).filter(a => a.quoi);
    return `<div class="note" data-note="${esc(n.id)}"><div class="t">${n.type === 'speed' ? '⏱️ Speed dating' : '💬 Échange informel'} · ${esc(dateFr(d.date))}${d.heure ? ' ' + esc(d.heure) : ''}${n.auteur !== monEmail() ? ' · ' + esc(n.auteurNom) : ''} ${emoji(d.humeur)}${n.type === 'speed' && !d.realise ? ' <span class="pastille att">à venir</span>' : ''}</div>
      ${(d.sujets || []).map(s => `<span class="pastille">${esc(s)}</span>`).join('')}
      ${d.notes ? `<p>${esc(d.notes.length > 280 ? d.notes.slice(0, 280) + '…' : d.notes)}</p>` : ''}
      ${repC.length ? `<p class="petit">🎯 ${repC.join(' · ')}</p>` : ''}
      ${actions.length ? `<p class="petit">✅ ${actions.length} action${actions.length > 1 ? 's' : ''} : ${actions.map(a => esc(a.quoi) + (a.statut === 'Fait' ? ' ✓' : '')).join(' · ')}</p>` : ''}</div>`;
  }

  // ---------- Saisie d'un échange (speed dating ou informel) ----------
  function ouvrirCreneau(c) {
    const id = idCreneau(c), ex = S.notes.get(id);
    ouvrirNote(ex && !ex.supprime ? ex : { id, type: 'speed', franchise: c.participant, donnees: { date: (S.config && S.config.dateSpeed) || aujourdhui(), heure: c.debut, sujets: [], central: {}, actions: [] } });
  }
  function ouvrirNote(base) {
    if (base && base.type === 'manuscrit') return ouvrirManuscrit(base);
    const n = base && base.id ? JSON.parse(JSON.stringify(base)) : { id: nouvelId(), type: base.type, franchise: base.franchise || '', donnees: { date: aujourdhui(), sujets: [], central: {}, actions: [] } };
    if (n.supprime) n.supprime = false;
    const existe = base && base.id && S.notes.has(base.id) && !S.notes.get(base.id).supprime;
    const lecture = base && base.id && base.auteur && base.auteur !== monEmail();
    const d = n.donnees; d.central = d.central || {}; d.actions = d.actions || []; d.sujets = d.sujets || [];
    const qs = ((S.config.sujetCentral || {}).questions) || [];
    const sujetsListe = [...new Set([...(S.config.sujetsProposes || []), ...d.sujets])];
    const precedent = $('#fenetre').innerHTML, frPrecedent = fenetreFr;
    fenetreFr = null;
    const dis = lecture ? ' disabled' : '';
    $('#fenetre').innerHTML = `<div class="fond ${lecture ? 'lecture' : ''}"><div class="barre-haut"><button id="fn-retour">← Retour</button><h3>${n.type === 'speed' ? '⏱️ Speed dating' : '💬 Échange informel'}${lecture ? ' · ' + esc(n.auteurNom) : ''}</h3></div><div class="contenu">
      <div class="carte">
        <label>Franchisé</label>
        <input id="fn-fr" list="fn-liste-fr" value="${esc(n.franchise)}" placeholder="Choisir un franchisé"${dis}><datalist id="fn-liste-fr">${entrees().map(e => `<option value="${esc(e.cle)}">`).join('')}</datalist>
        <div class="ligne"><div style="flex:1"><label>Date</label><input id="fn-date" type="date" value="${esc(d.date || '')}"${dis}></div><div style="flex:1"><label>Heure</label><input id="fn-heure" type="time" value="${esc(d.heure || '')}"${dis}></div></div>
        ${n.type === 'speed' ? `<label class="ligne" style="font-weight:600;margin-top:12px"><input type="checkbox" id="fn-realise" style="width:auto"${d.realise ? ' checked' : ''}${dis}> Rendez-vous réalisé</label>` : ''}
      </div>
      <div class="carte"><h2>L'échange</h2>
        <label>Humeur perçue</label>
        <div class="humeur" id="fn-humeur">${HUMEURS.map(([v, e, l]) => `<button data-h="${v}" class="${d.humeur === v ? 'on' : ''}" title="${esc(l)}"${dis}>${e}</button>`).join('')}</div>
        <label>Sujets abordés</label>
        <div class="chips" id="fn-sujets">${sujetsListe.map(s => `<span class="chip ${d.sujets.includes(s) ? 'on' : ''}" data-s="${esc(s)}">${esc(s)}</span>`).join('')}${lecture ? '' : '<span class="chip" id="fn-autre">+ autre</span>'}</div>
        <label>Notes</label><textarea id="fn-notes" rows="6" placeholder="Ce qui s'est dit…"${dis}>${esc(d.notes || '')}</textarea>
        <label>Demandes du franchisé</label><textarea id="fn-demandes" rows="3"${dis}>${esc(d.demandes || '')}</textarea>
      </div>
      ${qs.length ? `<div class="carte"><h2>🎯 ${esc((S.config.sujetCentral || {}).titre || 'Sujet central')}</h2>${qs.map(q => champQuestion(q, d.central[q.id], lecture)).join('')}</div>` : ''}
      <div class="carte"><h2>Actions à suivre</h2><div id="fn-actions"></div>${lecture ? '' : '<button id="fn-plus-action" style="width:100%">+ Ajouter une action</button>'}</div>
    </div>
    <div class="pied">${lecture ? '<button id="fn-fermer">Fermer</button>' : `${existe ? '<button id="fn-suppr">Supprimer</button>' : ''}<button class="primaire" id="fn-enreg">Enregistrer</button>`}</div></div>`;
    const fond = $('#fenetre .fond');
    const revenir = () => { if (frPrecedent) ouvrirFranchise(frPrecedent); else fermerFenetre(); };
    $('#fn-retour').onclick = () => { if (!lecture && modifie && !confirm('Quitter sans enregistrer ?')) return; revenir(); };
    if (lecture) { $('#fn-fermer').onclick = revenir; }
    let modifie = false; fond.addEventListener('input', () => { modifie = true; });
    const rendreActions = () => {
      $('#fn-actions').innerHTML = d.actions.length ? d.actions.map((a, i) => `<div class="action-ligne" data-i="${i}">
        <input data-k="quoi" placeholder="Action" value="${esc(a.quoi || '')}"${dis}>
        <input data-k="qui" placeholder="Qui s'en charge ?" value="${esc(a.qui || '')}"${dis}>
        <div class="ligne" style="flex-wrap:nowrap"><input data-k="echeance" type="date" value="${esc(a.echeance || '')}" style="flex:1;min-width:0" title="Échéance"${dis}>
        <select data-k="statut" style="flex:1;min-width:0"${dis}>${STATUTS.map(s => `<option${(a.statut || 'À faire') === s ? ' selected' : ''}>${s}</option>`).join('')}</select>${lecture ? '' : `<button class="lien" data-x="${i}" title="Retirer">✕</button>`}</div></div>`).join('') : '<p class="muted petit">Aucune action.</p>';
      $('#fn-actions').querySelectorAll('[data-k]').forEach(el => el.oninput = el.onchange = () => { d.actions[+el.closest('[data-i]').dataset.i][el.dataset.k] = el.value; modifie = true; });
      $('#fn-actions').querySelectorAll('[data-x]').forEach(b => b.onclick = () => { d.actions.splice(+b.dataset.x, 1); modifie = true; rendreActions(); });
    };
    rendreActions();
    if (lecture) return;
    $('#fn-plus-action').onclick = () => { d.actions.push({ quoi: '', qui: '', echeance: '', statut: 'À faire' }); rendreActions(); const l = $('#fn-actions').querySelectorAll('[data-k="quoi"]'); l[l.length - 1].focus(); };
    fond.querySelectorAll('#fn-humeur [data-h]').forEach(b => b.onclick = () => { const v = +b.dataset.h; d.humeur = d.humeur === v ? null : v; modifie = true; fond.querySelectorAll('#fn-humeur [data-h]').forEach(x => x.classList.toggle('on', +x.dataset.h === d.humeur)); });
    const brancherChips = () => fond.querySelectorAll('#fn-sujets [data-s]').forEach(c => c.onclick = () => { const s = c.dataset.s, i = d.sujets.indexOf(s); i >= 0 ? d.sujets.splice(i, 1) : d.sujets.push(s); c.classList.toggle('on', i < 0); modifie = true; });
    brancherChips();
    $('#fn-autre').onclick = () => { const s = (prompt('Autre sujet :') || '').trim(); if (!s || d.sujets.includes(s)) return; d.sujets.push(s); const c = document.createElement('span'); c.className = 'chip on'; c.dataset.s = s; c.textContent = s; $('#fn-autre').before(c); brancherChips(); modifie = true; };
    fond.querySelectorAll('[data-q]').forEach(el => {
      const q = qs.find(x => x.id === el.dataset.q);
      if (q.type === 'texte') el.querySelector('input').oninput = e => { d.central[q.id] = e.target.value; };
      else el.querySelectorAll('.chip').forEach(c => c.onclick = () => {
        const v = c.dataset.v;
        if (q.type === 'choix') { d.central[q.id] = d.central[q.id] === v ? '' : v; el.querySelectorAll('.chip').forEach(x => x.classList.toggle('on', x.dataset.v === d.central[q.id])); }
        else { const l = new Set(d.central[q.id] || []); l.has(v) ? l.delete(v) : l.add(v); d.central[q.id] = [...l]; c.classList.toggle('on'); }
        modifie = true;
      });
    });
    $('#fn-enreg').onclick = () => {
      const fr = $('#fn-fr').value.trim();
      if (!fr) { alert('Choisissez le franchisé.'); return; }
      if (!entrees().some(e => e.cle === fr) && !confirm(`« ${fr} » n'est pas dans la liste des franchisés. Enregistrer quand même ?`)) return;
      n.franchise = fr; d.date = $('#fn-date').value; d.heure = $('#fn-heure').value; d.notes = $('#fn-notes').value; d.demandes = $('#fn-demandes').value;
      if (n.type === 'speed') d.realise = $('#fn-realise').checked;
      d.actions = d.actions.filter(a => (a.quoi || '').trim());
      enregistrerNote(n); modifie = false;
      if (frPrecedent || vueActive === 'franchises') ouvrirFranchise(fr); else fermerFenetre();
    };
    if ($('#fn-suppr')) $('#fn-suppr').onclick = () => { if (!confirm('Supprimer cet échange ?')) return; n.supprime = true; enregistrerNote(n); revenir(); };
  }
  function champQuestion(q, val, lecture) {
    const opts = q.options || [];
    if (q.type === 'texte') return `<div data-q="${esc(q.id)}"><label>${esc(q.libelle)}</label><input value="${esc(val || '')}"${lecture ? ' disabled' : ''}></div>`;
    const on = v => q.type === 'choix' ? val === v : (val || []).includes(v);
    return `<div data-q="${esc(q.id)}"><label>${esc(q.libelle)}</label><div class="chips">${opts.map(o => `<span class="chip ${on(o) ? 'on' : ''}" data-v="${esc(o)}">${esc(o)}</span>`).join('')}</div></div>`;
  }

  // ---------- Planning speed dating ----------
  function rendrePlanning() {
    const cle = n => (n.donnees.date || '') + ' ' + (n.donnees.heure || '');
    const crs = mesCreneaux(), idsCr = new Set(crs.map(idCreneau));
    const ligneCr = c => { const n = S.notes.get(idCreneau(c)), ok = n && !n.supprime && n.donnees.realise;
      return `<div class="note" data-cr="${esc(c.debut)}|${esc(c.participant)}"><div class="ligne"><b>${esc(c.participant)}</b><span class="pousse petit"><b>${esc(c.debut)}</b> – ${esc(c.fin)}</span></div>
      <div class="petit">${ok ? '<span class="pastille ok">réalisé</span>' : n && !n.supprime ? '<span class="pastille att">en cours de saisie</span>' : '<span class="pastille">à venir</span>'} ${n ? emoji(n.donnees.humeur) : ''} ${prepDe(c.participant) ? '<span class="pastille">préparé</span>' : ''}${(entree(c.participant).p || {}).sujetsDemandes ? ' <span class="pastille">📝 sujets envoyés</span>' : ''}</div></div>`; };
    const rdv = mesNotes().filter(n => n.type === 'speed' && !idsCr.has(n.id)).sort((a, b) => cle(a).localeCompare(cle(b)));
    $('#pl-liste').innerHTML = (crs.length ? `<p class="petit muted" style="margin:0 0 4px">Planning du séminaire${S.config.dateSpeed ? ' · ' + esc(dateFr(S.config.dateSpeed)) : ''}</p>` + crs.map(ligneCr).join('') : '') + (rdv.length ? (crs.length ? '<p class="petit muted" style="margin:12px 0 4px">Autres rendez-vous</p>' : '') + rdv.map(n => `<div class="note" data-note="${esc(n.id)}"><div class="ligne"><b>${esc(n.franchise)}</b><span class="pousse petit muted">${esc(dateFr(n.donnees.date))} ${esc(n.donnees.heure || '')}</span></div>
      <div class="petit">${n.donnees.realise ? '<span class="pastille ok">réalisé</span>' : '<span class="pastille att">à venir</span>'} ${emoji(n.donnees.humeur)} ${prepDe(n.franchise) ? '<span class="pastille">préparé</span>' : '<span class="pastille rouge">pas encore préparé</span>'}</div></div>`).join('')
      : crs.length ? '' : '<p class="muted petit">Aucun rendez-vous pour l’instant.</p>');
    $('#pl-liste').querySelectorAll('[data-cr]').forEach(x => x.onclick = () => { const [d, ...pp] = x.dataset.cr.split('|'); ouvrirCreneau(crs.find(c => c.debut === d && c.participant === pp.join('|'))); });
    $('#pl-liste').querySelectorAll('[data-note]').forEach(x => x.onclick = () => ouvrirNote(S.notes.get(x.dataset.note)));
    const inf = mesNotes().filter(n => n.type === 'informel').sort((a, b) => String(b.donnees.date).localeCompare(String(a.donnees.date)));
    $('#pl-informels').innerHTML = inf.length ? inf.map(n => apercuNote(n).replace('<div class="t">', `<div class="t"><b>${esc(n.franchise)}</b> · `)).join('') : '<p class="muted petit">Aucun pour l’instant. Ajoutez-les depuis la fiche d’un franchisé.</p>';
    $('#pl-informels').querySelectorAll('[data-note]').forEach(x => x.onclick = () => ouvrirNote(S.notes.get(x.dataset.note)));
  }

  // ---------- Notes au stylet ----------
  // Page au format A4 (1000 × 1414 unités) ; un trait = { c: couleur, w: épaisseur, p: [x, y, pression 1-9, …] } en unités de page
  const PAGE_L = 1000, PAGE_H = 1414;
  const COULEURS = ['#231F20', '#1F5FBF', '#E22F2A', '#1E8A52'];
  const EPAISSEURS = [[2.2, 'Fin'], [3.6, 'Moyen'], [6.5, 'Épais']];
  function dessinerPage(ctx, traits, k, lignes) {
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height); ctx.restore();
    if (lignes) { ctx.strokeStyle = '#E8EEF6'; ctx.lineWidth = Math.max(1, k); for (let y = 130; y < PAGE_H - 40; y += 62) { ctx.beginPath(); ctx.moveTo(50 * k, y * k); ctx.lineTo((PAGE_L - 50) * k, y * k); ctx.stroke(); } }
    (traits || []).forEach(t => tracerTrait(ctx, t, k));
  }
  function tracerTrait(ctx, t, k, depuis) {
    const p = t.p, n = p.length / 3; if (!n) return;
    ctx.strokeStyle = ctx.fillStyle = COULEURS[t.c] || COULEURS[0]; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const larg = pr => t.w * (0.45 + (pr || 5) / 9 * 0.9) * k;
    if (n === 1) { ctx.beginPath(); ctx.arc(p[0] * k, p[1] * k, larg(p[2]) / 2, 0, Math.PI * 2); ctx.fill(); return; }
    for (let i = Math.max(1, depuis || 1); i < n; i++) {
      ctx.beginPath(); ctx.lineWidth = larg(p[i * 3 + 2]);
      ctx.moveTo(p[(i - 1) * 3] * k, p[(i - 1) * 3 + 1] * k); ctx.lineTo(p[i * 3] * k, p[i * 3 + 1] * k); ctx.stroke();
    }
  }
  const MOMENTS_DEFAUT = ['Plénière', 'Atelier ouvertures de magasins'];
  const moments = () => (S.config && S.config.momentsSeminaire) || MOMENTS_DEFAUT;
  const estSeminaire = n => n.type === 'manuscrit' && (n.donnees || {}).rattachement === 'seminaire';
  const libelleRattachement = n => estSeminaire(n) ? 'Séminaire · ' + ((n.donnees || {}).moment || 'général') : (n.franchise || '');
  const cacheVignettes = new Map();
  function imagePage(traits, largeur) {
    const c = document.createElement('canvas'), k = largeur / PAGE_L;
    c.width = largeur; c.height = Math.round(PAGE_H * k);
    dessinerPage(c.getContext('2d'), traits, k, false);
    return c.toDataURL('image/png');
  }
  function vignettes(n, max, largeur) {
    const pages = (n.donnees && n.donnees.pages) || null;
    if (!pages) return '<p class="muted petit">Tracé consultable avec une connexion internet.</p>';
    const cle = n.id + n.majLe + largeur;
    if (!cacheVignettes.has(cle)) cacheVignettes.set(cle, pages.filter(pg => pg.length).slice(0, max || 99).map(pg => imagePage(pg, largeur)));
    const imgs = cacheVignettes.get(cle);
    return imgs.length ? `<div class="vignettes">${imgs.map(u => `<img src="${u}" alt="Page manuscrite">`).join('')}</div>` : '<p class="muted petit">Page vide.</p>';
  }
  function rendreListeManuscrits() {
    const l = notesVisibles().filter(n => n.type === 'manuscrit').sort((a, b) => String(b.majLe).localeCompare(String(a.majLe)));
    $('#ms-liste').innerHTML = l.length ? l.map(n => {
      const pages = n.donnees.pages || [], img = pages.length && pages[0].length ? imagePage(pages[0], 144) : '';
      return `<div class="ms-item" data-note="${esc(n.id)}">${img ? `<img src="${img}" alt="">` : '<div style="width:72px;height:102px;border:1px dashed var(--line);border-radius:6px;flex:none"></div>'}
        <div><b>${esc(n.donnees.titre || 'Sans titre')}</b><span class="petit muted">${libelleRattachement(n) ? (estSeminaire(n) ? '🗂 ' : '') + esc(libelleRattachement(n)) + ' · ' : ''}${esc(dateFr(n.donnees.date || n.creeLe))} · ${pages.length} page${pages.length > 1 ? 's' : ''}${n.auteur !== monEmail() ? ' · ' + esc(n.auteurNom) : ''}</span></div></div>`;
    }).join('') : '<p class="muted petit">Aucune note au stylet pour l’instant.</p>';
    $('#ms-liste').querySelectorAll('[data-note]').forEach(x => x.onclick = () => ouvrirManuscrit(S.notes.get(x.dataset.note)));
  }
  function ouvrirManuscrit(base, franchise) {
    const n = base ? JSON.parse(JSON.stringify(base)) : { id: nouvelId(), type: 'manuscrit', franchise: franchise || '', donnees: { titre: '', date: aujourdhui(), pages: [[]] } };
    const lecture = !!(base && base.auteur && base.auteur !== monEmail());
    const d = n.donnees; if (!Array.isArray(d.pages) || !d.pages.length) d.pages = [[]];
    const indisponible = d.allege && !d.pages.some(pg => pg && pg.length);
    const frPrecedent = fenetreFr; fenetreFr = null;
    let page = 0, couleur = 0, epaisseur = 1, gomme = false, styletSeul = false, styletVu = false, modifie = false, minuterie = null;
    const annulations = [];
    const dis = lecture ? ' disabled' : '';
    $('#fenetre').innerHTML = `<div class="fond ${lecture ? 'lecture' : ''}" style="padding-bottom:20px">
      <div class="barre-haut"><button id="ms-retour">← Retour</button><h3>✍️ Note au stylet${lecture ? ' · ' + esc(n.auteurNom) : ''}</h3><span class="pousse petit muted" id="ms-etat"></span></div>
      <div class="contenu"><div class="ligne" style="margin-bottom:6px">
        <input id="ms-titre" placeholder="Titre (facultatif)" value="${esc(d.titre || '')}" style="flex:2;min-width:160px"${dis}>
        <select id="ms-rat" style="flex:0 0 auto;width:auto"${dis}><option value="franchise"${d.rattachement === 'seminaire' ? '' : ' selected'}>Franchisé</option><option value="seminaire"${d.rattachement === 'seminaire' ? ' selected' : ''}>Séminaire / atelier</option></select>
        <input id="ms-fr" list="ms-liste-fr" placeholder="Franchisé (facultatif)" value="${esc(n.franchise || '')}" style="flex:2;min-width:160px"${dis}${d.rattachement === 'seminaire' ? ' hidden' : ''}><datalist id="ms-liste-fr">${entrees().map(e => `<option value="${esc(e.cle)}">`).join('')}</datalist>
        <input id="ms-moment" list="ms-liste-moments" placeholder="Atelier, plénière… (choisir ou saisir)" value="${esc(d.moment || '')}" style="flex:2;min-width:160px"${dis}${d.rattachement === 'seminaire' ? '' : ' hidden'}><datalist id="ms-liste-moments">${moments().map(m => `<option value="${esc(m)}">`).join('')}</datalist>
        <input id="ms-date" type="date" value="${esc(d.date || '')}" style="flex:1;min-width:130px"${dis}>
      </div></div>
      <div class="outils">
        ${lecture ? '' : `${COULEURS.map((c, i) => `<button class="pastille-couleur" data-c="${i}" style="background:${c}" title="Couleur"></button>`).join('')}
        <select id="ms-ep" style="width:auto;padding:6px 8px;font-size:13px">${EPAISSEURS.map(([, l], i) => `<option value="${i}"${i === 1 ? ' selected' : ''}>${l}</option>`).join('')}</select>
        <button id="ms-gomme" title="Gomme : touchez un trait pour l'effacer">🧽 Gomme</button>
        <button id="ms-annuler" title="Annuler">↶</button>
        <button id="ms-stylet" title="Si activé, seul le stylet écrit (la main posée sur l'écran est ignorée)">✏️ Stylet seul</button>`}
        <span class="ligne pousse" style="gap:4px"><button id="ms-prec">◀</button><span id="ms-num" class="petit" style="min-width:44px;text-align:center"></span><button id="ms-suiv">▶</button>${lecture ? '' : '<button id="ms-plus">+ Page</button>'}
        <button id="ms-image" title="Télécharger la page en image">⬇︎</button>${lecture || !base ? '' : '<button id="ms-suppr" title="Supprimer la note">🗑</button>'}</span>
      </div>
      <div class="zone-page">${indisponible ? '<p class="muted">Cette note est consultable avec une connexion internet.</p>' : '<canvas class="page" id="ms-canvas"></canvas>'}</div></div>`;
    const fond = $('#fenetre .fond'), cv = $('#ms-canvas');
    const etat = t => { $('#ms-etat').textContent = t; };
    const revenir = () => { if (frPrecedent) ouvrirFranchise(frPrecedent); else fermerFenetre(); };
    const vide = () => !d.pages.some(pg => pg.length) && !$('#ms-titre').value.trim();
    function enregistrer() {
      clearTimeout(minuterie); minuterie = null;
      if (lecture || !modifie) return;
      if (!base && vide()) return;
      d.rattachement = $('#ms-rat').value;
      if (d.rattachement === 'seminaire') { n.franchise = ''; d.moment = $('#ms-moment').value.trim(); } else { n.franchise = $('#ms-fr').value.trim(); delete d.moment; }
      d.titre = $('#ms-titre').value.trim(); d.date = $('#ms-date').value;
      d.pages = d.pages.length > 1 ? d.pages.filter((pg, i) => pg.length || i === 0) : d.pages;
      enregistrerNote(n, true); base = n; modifie = false; etat('Enregistré ✓');
    }
    const plusTard = () => { modifie = true; etat('…'); clearTimeout(minuterie); minuterie = setTimeout(enregistrer, 2500); };
    $('#ms-retour').onclick = () => { enregistrer(); revenir(); };
    if (!lecture) {
      ['#ms-titre', '#ms-fr', '#ms-moment', '#ms-date'].forEach(id => { $(id).oninput = plusTard; });
      $('#ms-rat').onchange = () => { const sem = $('#ms-rat').value === 'seminaire'; $('#ms-fr').hidden = sem; $('#ms-moment').hidden = !sem; (sem ? $('#ms-moment') : $('#ms-fr')).focus(); plusTard(); };
    }
    if (!cv) return;
    const ctx = cv.getContext('2d');
    let k = 1;
    function taille() {
      const zone = fond.querySelector('.zone-page'), haut = cv.getBoundingClientRect().top - fond.getBoundingClientRect().top;
      const dispoH = Math.max(320, window.innerHeight - Math.max(haut, 120) - 24);
      const l = Math.min(zone.clientWidth - 28, dispoH / (PAGE_H / PAGE_L), 1000);
      const r = window.devicePixelRatio || 1;
      cv.style.width = l + 'px'; cv.style.height = l * PAGE_H / PAGE_L + 'px';
      cv.width = Math.round(l * r); cv.height = Math.round(l * PAGE_H / PAGE_L * r);
      k = cv.width / PAGE_L; redessiner();
    }
    function redessiner() {
      dessinerPage(ctx, d.pages[page], k, true);
      $('#ms-num').textContent = `${page + 1} / ${d.pages.length}`;
      $('#ms-prec').disabled = page === 0; $('#ms-suiv').disabled = page >= d.pages.length - 1;
      if (!lecture) {
        fond.querySelectorAll('[data-c]').forEach(b => b.classList.toggle('on', !gomme && +b.dataset.c === couleur));
        $('#ms-gomme').classList.toggle('on', gomme); $('#ms-stylet').classList.toggle('on', styletSeul);
        $('#ms-annuler').disabled = !annulations.length;
      }
    }
    const pointPage = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * PAGE_L, (e.clientY - r.top) / r.height * PAGE_H]; };
    const memoriser = () => { annulations.push([page, d.pages[page].slice()]); if (annulations.length > 60) annulations.shift(); };
    function effacerAutour(x, y) {
      const avant = d.pages[page].length, r2 = 16 * 16;
      d.pages[page] = d.pages[page].filter(t => { for (let i = 0; i < t.p.length; i += 3) { const dx = t.p[i] - x, dy = t.p[i + 1] - y; if (dx * dx + dy * dy < r2) return false; } return true; });
      if (d.pages[page].length !== avant) { redessiner(); plusTard(); }
    }
    let trait = null, actif = null;
    if (!lecture) {
      cv.addEventListener('pointerdown', e => {
        if (e.pointerType === 'pen' && !styletVu) { styletVu = true; styletSeul = true; redessiner(); }
        if (styletSeul && e.pointerType !== 'pen') return;
        if (actif !== null) return;
        e.preventDefault(); actif = e.pointerId; try { cv.setPointerCapture(e.pointerId); } catch (x) {}
        const [x, y] = pointPage(e);
        memoriser();
        if (gomme) { trait = null; effacerAutour(x, y); return; }
        const pr = e.pointerType === 'pen' && e.pressure > 0 ? Math.max(1, Math.round(e.pressure * 9)) : 5;
        trait = { c: couleur, w: EPAISSEURS[epaisseur][0], p: [Math.round(x * 10) / 10, Math.round(y * 10) / 10, pr] };
        tracerTrait(ctx, trait, k);
      });
      cv.addEventListener('pointermove', e => {
        if (e.pointerId !== actif) return; e.preventDefault();
        const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
        for (const ev of (evs.length ? evs : [e])) {
          const [x, y] = pointPage(ev);
          if (gomme) { effacerAutour(x, y); continue; }
          if (!trait) continue;
          const p = trait.p, lx = p[p.length - 3], ly = p[p.length - 2];
          if ((x - lx) ** 2 + (y - ly) ** 2 < 1.4) continue;
          const pr = ev.pointerType === 'pen' && ev.pressure > 0 ? Math.max(1, Math.round(ev.pressure * 9)) : 5;
          p.push(Math.round(x * 10) / 10, Math.round(y * 10) / 10, pr);
          tracerTrait(ctx, trait, k, p.length / 3 - 1);
        }
      });
      const fin = e => {
        if (e.pointerId !== actif) return; actif = null;
        if (trait) { d.pages[page].push(trait); trait = null; plusTard(); } else if (gomme && annulations.length && annulations[annulations.length - 1][1].length === d.pages[page].length) annulations.pop();
        redessiner();
      };
      cv.addEventListener('pointerup', fin); cv.addEventListener('pointercancel', fin); cv.addEventListener('lostpointercapture', fin);
      fond.querySelectorAll('[data-c]').forEach(b => b.onclick = () => { couleur = +b.dataset.c; gomme = false; redessiner(); });
      $('#ms-ep').onchange = e => { epaisseur = +e.target.value; gomme = false; redessiner(); };
      $('#ms-gomme').onclick = () => { gomme = !gomme; redessiner(); };
      $('#ms-stylet').onclick = () => { styletSeul = !styletSeul; redessiner(); };
      $('#ms-annuler').onclick = () => { const a = annulations.pop(); if (!a) return; d.pages[a[0]] = a[1]; page = a[0]; redessiner(); plusTard(); };
      $('#ms-plus').onclick = () => { d.pages.splice(page + 1, 0, []); page++; redessiner(); plusTard(); };
      if ($('#ms-suppr')) $('#ms-suppr').onclick = () => { if (!confirm('Supprimer cette note au stylet ?')) return; clearTimeout(minuterie); n.supprime = true; enregistrerNote(n, true); revenir(); };
    }
    $('#ms-prec').onclick = () => { if (page > 0) { page--; redessiner(); } };
    $('#ms-suiv').onclick = () => { if (page < d.pages.length - 1) { page++; redessiner(); } };
    $('#ms-image').onclick = () => { const a = document.createElement('a'); a.href = imagePage(d.pages[page], 1500); a.download = `note-stylet-${(n.franchise || d.titre || 'page').replace(/[^\w-]+/g, '_')}-${page + 1}.png`; a.click(); };
    const auRedim = () => { if (document.body.contains(cv)) taille(); else window.removeEventListener('resize', auRedim); };
    window.addEventListener('resize', auRedim);
    requestAnimationFrame(taille);
  }

  // ---------- Comptes rendus des rendez-vous ----------
  function contenuCR(n) {
    const d = n.donnees || {};
    if (n.type === 'manuscrit') return `${d.titre ? `<p><b>${esc(d.titre)}</b></p>` : ''}${vignettes(n, 99, 300)}`;
    const qs = ((S.config && S.config.sujetCentral) || {}).questions || [];
    const rep = qs.map(q => [q, (d.central || {})[q.id]]).filter(([, v]) => v && (!Array.isArray(v) || v.length));
    const actions = (d.actions || []).filter(a => a.quoi);
    return `${(d.sujets || []).length ? `<div style="margin-top:6px">${d.sujets.map(x => `<span class="pastille">${esc(x)}</span>`).join('')}</div>` : ''}
      ${d.notes ? `<h4>Notes</h4><p>${esc(d.notes)}</p>` : ''}
      ${d.demandes ? `<h4>Demandes du franchisé</h4><p>${esc(d.demandes)}</p>` : ''}
      ${rep.length ? `<h4>🎯 ${esc(((S.config && S.config.sujetCentral) || {}).titre || 'Sujet central')}</h4><table>${rep.map(([q, v]) => `<tr><td style="width:40%" class="muted">${esc(q.libelle)}</td><td><b>${esc(Array.isArray(v) ? v.join(', ') : v)}</b></td></tr>`).join('')}</table>` : ''}
      ${actions.length ? `<h4>Actions</h4><table>${actions.map(a => `<tr><td>${esc(a.quoi)}</td><td>${esc(a.qui || '')}</td><td>${esc(dateFr(a.echeance))}</td><td><span class="pastille ${a.statut === 'Fait' ? 'ok' : a.statut === 'En cours' ? 'att' : 'rouge'}">${esc(a.statut || 'À faire')}</span></td></tr>`).join('')}</table>` : ''}
      ${!d.notes && !d.demandes && !rep.length && !actions.length && !(d.sujets || []).length ? '<p class="muted petit">Pas encore de contenu.</p>' : ''}`;
  }
  function rendreComptesRendus() {
    const sel = $('#cr-auteur');
    if (resp()) {
      const auteurs = [...new Map(notesVisibles().filter(n => n.type !== 'preparation').map(n => [n.auteur, n.auteurNom])).entries()].sort((x, y) => String(x[1]).localeCompare(String(y[1])));
      const v = sel.value; sel.hidden = false;
      sel.innerHTML = '<option value="">Tous les directeurs</option>' + auteurs.map(([e, nm]) => `<option value="${esc(e)}"${e === v ? ' selected' : ''}>${esc(nm || e)}</option>`).join('');
    }
    const q = norm($('#cr-q').value), type = $('#cr-type').value, aut = resp() ? sel.value : '', real = $('#cr-realises').checked, ordre = $('#cr-ordre').value;
    const l = notesVisibles().filter(n => ['speed', 'informel', 'manuscrit'].includes(n.type))
      .filter(n => (!type || (type === 'seminaire' ? estSeminaire(n) : n.type === type)) && (!aut || n.auteur === aut) && (!real || n.type !== 'speed' || n.donnees.realise))
      .filter(n => !q || norm([n.franchise, n.donnees.moment, n.auteurNom, n.donnees.titre, n.donnees.notes, n.donnees.demandes, (n.donnees.sujets || []).join(' '), (n.donnees.actions || []).map(a => a.quoi).join(' '), Object.values(n.donnees.central || {}).flat().join(' ')].join(' ')).includes(q));
    const cleDate = n => (n.donnees.date || String(n.creeLe).slice(0, 10)) + ' ' + (n.donnees.heure || '');
    const groupe = n => ordre === 'auteur' ? (n.auteurNom || n.auteur) : ordre === 'date' ? dateFr(n.donnees.date || n.creeLe) : (libelleRattachement(n) || 'Sans rattachement');
    l.sort((a, b) => ordre === 'date' ? cleDate(a).localeCompare(cleDate(b)) : (ordre === 'franchise' && (estSeminaire(b) - estSeminaire(a))) || groupe(a).localeCompare(groupe(b), 'fr') || cleDate(a).localeCompare(cleDate(b)));
    let dernier = null;
    const types = { speed: '⏱️ Speed dating', informel: '💬 Échange informel', manuscrit: '✍️ Note au stylet' };
    $('#cr-contenu').innerHTML = (l.length ? `<p class="muted petit" style="margin:0 4px 8px">${l.length} compte${l.length > 1 ? 's' : ''} rendu${l.length > 1 ? 's' : ''}${resp() ? '' : ' · vos rendez-vous'}</p>` : '<div class="carte"><p class="muted">Aucun compte rendu ne correspond.</p></div>') + l.map(n => {
      const g = groupe(n), titre = g !== dernier ? `<div class="groupe-cr">${esc(g)}</div>` : ''; dernier = g;
      const d = n.donnees;
      return `${titre}<div class="cr" data-note="${esc(n.id)}"><div class="en-tete">${ordre !== 'franchise' && libelleRattachement(n) ? `<b>${esc(libelleRattachement(n))}</b>` : ''}<span class="meta">${types[n.type]} · ${esc(dateFr(d.date || n.creeLe))}${d.heure ? ' ' + esc(d.heure) : ''}${ordre !== 'auteur' && (resp() || n.auteur !== monEmail()) ? ' · ' + esc(n.auteurNom) : ''}</span>
        ${d.humeur ? `<span style="font-size:18px" title="Humeur perçue">${emoji(d.humeur)}</span>` : ''}${n.type === 'speed' && !d.realise ? '<span class="pastille att">à venir</span>' : ''}</div>${contenuCR(n)}</div>`;
    }).join('');
    $('#cr-contenu').querySelectorAll('[data-note]').forEach(x => x.onclick = () => ouvrirNote(S.notes.get(x.dataset.note)));
  }

  // ---------- Synthèse ----------
  function notesSynthese() {
    const a = $('#sy-auteur').value;
    return notesVisibles().filter(n => !a || n.auteur === a);
  }
  function rendreSynthese() {
    const sel = $('#sy-auteur');
    if (resp()) {
      const auteurs = [...new Map(notesVisibles().map(n => [n.auteur, n.auteurNom])).entries()].sort((x, y) => String(x[1]).localeCompare(String(y[1])));
      const v = sel.value; sel.hidden = false;
      sel.innerHTML = '<option value="">Tous les directeurs</option>' + auteurs.map(([e, n]) => `<option value="${esc(e)}"${e === v ? ' selected' : ''}>${esc(n || e)}</option>`).join('');
    }
    const ns = notesSynthese();
    const preps = ns.filter(n => n.type === 'preparation'), ech = ns.filter(n => n.type === 'speed' || n.type === 'informel');
    const speed = ech.filter(n => n.type === 'speed'), realises = speed.filter(n => n.donnees.realise);
    const frTouches = new Set(ns.map(n => n.franchise).filter(Boolean));
    // Sujets : nombre de franchisés concernés (préparation + échanges)
    const parSujet = new Map();
    for (const n of ns) for (const s of (n.donnees.sujets || [])) { if (!parSujet.has(s)) parSujet.set(s, new Set()); parSujet.get(s).add(n.franchise); }
    const sujets = [...parSujet.entries()].map(([s, e]) => [s, e.size]).sort((a, b) => b[1] - a[1]);
    const maxS = sujets.length ? sujets[0][1] : 1;
    // Humeur moyenne : avant (préparation) et pendant (échanges)
    const moy = l => { const v = l.map(n => n.donnees.humeur).filter(Boolean); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    const hAvant = moy(preps), hPendant = moy(ech);
    // Sujet central : dernière réponse par franchisé et par directeur
    const qs = ((S.config.sujetCentral || {}).questions) || [];
    const reponses = ech.filter(n => Object.values(n.donnees.central || {}).some(v => v && (!Array.isArray(v) || v.length)))
      .sort((a, b) => String(b.donnees.date || b.majLe).localeCompare(String(a.donnees.date || a.majLe)));
    const vus = new Set(), pipeline = reponses.filter(n => { const k = n.franchise + '|' + n.auteur; if (vus.has(k)) return false; vus.add(k); return true; })
      .sort((a, b) => a.franchise.localeCompare(b.franchise, 'fr'));
    const qProjet = qs.find(q => q.type === 'choix');
    const compteProjet = qProjet ? (qProjet.options || []).map(o => [o, pipeline.filter(n => n.donnees.central[qProjet.id] === o).length]) : [];
    // Actions
    const actions = ech.flatMap(n => (n.donnees.actions || []).filter(a => a.quoi).map(a => ({ ...a, franchise: n.franchise, auteurNom: n.auteurNom, note: n.id })))
      .sort((a, b) => (a.statut === 'Fait') - (b.statut === 'Fait') || String(a.echeance || '9').localeCompare(String(b.echeance || '9')));
    const hum = h => h == null ? '–' : `${emoji(Math.round(h))} ${h.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}/5`;
    // Avancement du planning par directeur (responsables)
    const plan = resp() ? ((S.config && S.config.planning) || []) : [];
    const avancement = plan.length ? `<div class="carte"><h2>Avancement des speed dating</h2><div class="defile"><table><tr><th>Directeur</th><th>Préparés</th><th>Réalisés</th></tr>${plan.map(x => {
      const de = notesVisibles().filter(n => x.directeur && n.auteur === x.directeur), cs = x.creneaux || [];
      const prep = cs.filter(c => de.some(n => n.type === 'preparation' && nomCle(n.franchise) === nomCle(c.participant))).length;
      const real = cs.filter(c => de.some(n => n.type === 'speed' && n.donnees.realise && nomCle(n.franchise) === nomCle(c.participant))).length;
      return `<tr><td><b>${esc(x.libelle)}</b>${x.directeur ? '' : ' <span class="pastille rouge">compte non associé</span>'}</td><td>${prep} / ${cs.length}</td><td><span class="pastille ${real === cs.length && cs.length ? 'ok' : real ? 'att' : ''}">${real} / ${cs.length}</span></td></tr>`;
    }).join('')}</table></div></div>` : '';
    $('#sy-contenu').innerHTML = `
      <div class="carte"><h2>${esc((S.config && S.config.titre) || 'Séminaire')}${S.config.lieu ? ' · ' + esc(S.config.lieu) : ''}</h2>
        <div class="chiffres"><div><div class="v">${frTouches.size}</div><div class="l">Franchisés suivis</div></div><div><div class="v">${realises.length} / ${speed.length}</div><div class="l">Speed dating réalisés</div></div><div><div class="v">${ech.filter(n => n.type === 'informel').length}</div><div class="l">Échanges informels</div></div></div>
        <div class="chiffres" style="grid-template-columns:repeat(2,1fr)"><div><div class="v">${hum(hAvant)}</div><div class="l">Humeur avant (${preps.filter(n => n.donnees.humeur).length})</div></div><div><div class="v">${hum(hPendant)}</div><div class="l">Humeur pendant (${ech.filter(n => n.donnees.humeur).length})</div></div></div>
      </div>
      ${avancement}
      <div class="carte"><h2>Sujets qui reviennent</h2>
        ${sujets.length ? sujets.map(([s, c]) => `<div class="barre"><span class="n" title="${esc(s)}">${esc(s)}</span><span class="b"><i style="width:${Math.round(c / maxS * 100)}%"></i></span><span class="c">${c}</span></div>`).join('') + '<p class="muted petit">Nombre de franchisés concernés (préparation et échanges).</p>' : '<p class="muted petit">Pas encore de sujets saisis.</p>'}
      </div>
      <div class="carte"><h2>🎯 ${esc((S.config.sujetCentral || {}).titre || 'Sujet central')}</h2>
        ${compteProjet.length ? `<div class="ligne" style="margin-bottom:8px">${compteProjet.map(([o, c]) => `<span class="pastille ${/^(oui|déjà)/i.test(o) ? 'ok' : /peut/i.test(o) ? 'att' : ''}">${esc(o)} : ${c}</span>`).join('')}</div>` : ''}
        ${pipeline.length ? `<div class="defile"><table><tr><th>Franchisé</th>${qs.map(q => `<th>${esc(q.libelle)}</th>`).join('')}${resp() ? '<th>Par</th>' : ''}</tr>
          ${pipeline.map(n => `<tr data-note="${esc(n.id)}" style="cursor:pointer"><td><b>${esc(n.franchise)}</b><br><span class="muted">${esc(dateFr(n.donnees.date))}</span></td>${qs.map(q => { const v = n.donnees.central[q.id]; return `<td>${esc(Array.isArray(v) ? v.join(', ') : v || '')}</td>`; }).join('')}${resp() ? `<td>${esc(n.auteurNom)}</td>` : ''}</tr>`).join('')}</table></div>` : '<p class="muted petit">Pas encore de réponse.</p>'}
      </div>
      <div class="carte"><h2>Actions à suivre (${actions.filter(a => a.statut !== 'Fait').length} ouvertes)</h2>
        ${actions.length ? `<div class="defile"><table><tr><th>Action</th><th>Franchisé</th><th>Qui</th><th>Échéance</th><th>Statut</th>${resp() ? '<th>Par</th>' : ''}</tr>
          ${actions.map(a => `<tr data-note="${esc(a.note)}" style="cursor:pointer"><td>${esc(a.quoi)}</td><td>${esc(a.franchise)}</td><td>${esc(a.qui || '')}</td><td>${esc(dateFr(a.echeance))}</td><td><span class="pastille ${a.statut === 'Fait' ? 'ok' : a.statut === 'En cours' ? 'att' : 'rouge'}">${esc(a.statut || 'À faire')}</span></td>${resp() ? `<td>${esc(a.auteurNom)}</td>` : ''}</tr>`).join('')}</table></div>` : '<p class="muted petit">Aucune action.</p>'}
      </div>
      <div class="carte"><h2>Par franchisé</h2>
        ${[...frTouches].sort((a, b) => a.localeCompare(b, 'fr')).map(fr => {
          const l = ns.filter(n => n.franchise === fr), p = l.filter(n => n.type === 'preparation'), e = l.filter(n => n.type !== 'preparation');
          return `<div class="note" data-fr="${esc(fr)}"><div class="ligne"><b>${esc(fr)}</b><span class="pousse petit">${hum(moy(p))} → ${hum(moy(e))}</span></div>
            <div class="petit muted">${e.length} échange${e.length > 1 ? 's' : ''} · ${[...new Set(l.flatMap(n => n.donnees.sujets || []))].map(esc).join(', ') || 'aucun sujet'}</div></div>`;
        }).join('') || '<p class="muted petit">Rien pour l’instant.</p>'}
      </div>`;
    $('#sy-contenu').querySelectorAll('[data-note]').forEach(x => x.onclick = () => ouvrirNote(S.notes.get(x.dataset.note)));
    $('#sy-contenu').querySelectorAll('[data-fr]').forEach(x => x.onclick = () => ouvrirFranchise(x.dataset.fr));
  }
  function exporterExcel() {
    if (!window.XLSX) { alert('Export indisponible hors connexion.'); return; }
    const ns = notesSynthese(), qs = ((S.config.sujetCentral || {}).questions) || [];
    const hl = h => h ? (HUMEURS.find(x => x[0] === h) || [])[2] : '';
    const prep = ns.filter(n => n.type === 'preparation').map(n => ({ 'Franchisé': n.franchise, 'Directeur': n.auteurNom, 'Humeur': hl(n.donnees.humeur), "État d'esprit": n.donnees.esprit || '', 'Sujets': (n.donnees.sujets || []).join(', ') }));
    const ech = ns.filter(n => n.type === 'speed' || n.type === 'informel').map(n => {
      const o = { 'Type': n.type === 'speed' ? 'Speed dating' : 'Informel', 'Franchisé': n.franchise, 'Directeur': n.auteurNom, 'Date': dateFr(n.donnees.date), 'Heure': n.donnees.heure || '', 'Réalisé': n.type === 'speed' ? (n.donnees.realise ? 'Oui' : 'Non') : '', 'Humeur': hl(n.donnees.humeur), 'Sujets': (n.donnees.sujets || []).join(', '), 'Notes': n.donnees.notes || '', 'Demandes': n.donnees.demandes || '' };
      qs.forEach(q => { const v = (n.donnees.central || {})[q.id]; o[q.libelle] = Array.isArray(v) ? v.join(', ') : v || ''; });
      return o;
    });
    const act = ns.flatMap(n => (n.donnees.actions || []).filter(a => a.quoi).map(a => ({ 'Action': a.quoi, 'Franchisé': n.franchise, 'Qui': a.qui || '', 'Échéance': dateFr(a.echeance), 'Statut': a.statut || 'À faire', 'Directeur': n.auteurNom })));
    const wb = XLSX.utils.book_new();
    const feuille = (l, nom) => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(l.length ? l : [{ '': 'Aucune donnée' }]), nom);
    feuille(ech, 'Échanges'); feuille(prep, 'Préparation'); feuille(act, 'Actions');
    XLSX.writeFile(wb, `seminaire-franchises-${S.annee}.xlsx`);
  }

  // ---------- Réglages (responsables) ----------
  // Réglages : une copie de l'édition choisie (cfg) est modifiée puis enregistrée en entier
  let cfg = null, reglagesBranches = false;
  async function brancherReglages() {
    if (!resp()) return;
    $('#rg-annee').innerHTML = `<option>${S.annee}</option>`;
    cfg = JSON.parse(JSON.stringify(S.config));
    remplirReglages();
    chargerComptes();
    if (reglagesBranches) return; reglagesBranches = true;
    $('#rg-enregistrer').onclick = () => enregistrerReglages('#rg-info');
    $('#pp-enregistrer').onclick = () => enregistrerReglages('#pp-info');
    $('#pp-q').oninput = rendreParticipantsReglages;
    $('#pp-imp-json').onclick = () => $('#pp-fic-json').click();
    $('#pp-imp-xlsx').onclick = () => $('#pp-fic-xlsx').click();
    $('#pp-fic-json').onchange = async e => { const f = e.target.files[0]; e.target.value = ''; if (f) try { importerDepart(JSON.parse(await f.text())); } catch (x) { $('#pp-imp-info').textContent = 'Fichier illisible : ' + x.message; } };
    $('#pp-fic-xlsx').onchange = async e => { const f = e.target.files[0]; e.target.value = ''; if (f) try { importerDev(await f.arrayBuffer()); } catch (x) { $('#pp-imp-info').textContent = 'Fichier illisible : ' + x.message; } };
    $('#pp-auto').onclick = () => { const n = associerGroupes(false); rendreParticipantsReglages(); $('#pp-info').textContent = `${n} participant(s) associé(s) automatiquement : vérifiez puis enregistrez.`; };
    $('#cp-ajouter').onclick = async () => {
      const email = $('#cp-email').value.trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { $('#cp-info').textContent = 'Adresse e-mail invalide'; return; }
      const modif = compteEnModif;
      try {
        await appel('/seminaire/comptes', { method: 'PUT', body: JSON.stringify({ email, ancienEmail: modif || undefined, nom: $('#cp-nom').value.trim(), role: $('#cp-role').value, actif: true }) });
        if (modif && cfg) (cfg.planning || []).forEach(x => { if (x.directeur === modif) x.directeur = email; });
        if (modif && S.config) (S.config.planning || []).forEach(x => { if (x.directeur === modif) x.directeur = email; });
        finModifCompte(); $('#cp-info').textContent = modif ? 'Modifié ✓' : 'Ajouté ✓'; chargerComptes();
      } catch (e) { $('#cp-info').textContent = e.message; }
    };
    $('#cp-annuler').onclick = finModifCompte;
  }
  function remplirReglages() {
    const c = cfg;
    const icones = () => grilleIcones($('#rg-icones'), cfg.icone || '🏝️', ic => { cfg.icone = ic; });
    icones();
    $('#rg-titre').value = c.titre || ''; $('#rg-lieu').value = c.lieu || ''; $('#rg-du').value = c.du || ''; $('#rg-au').value = c.au || '';
    $('#rg-sujets').value = (c.sujetsProposes || []).join('\n');
    $('#rg-moments').value = (c.momentsSeminaire || MOMENTS_DEFAUT).join('\n');
    $('#rg-central').value = (c.sujetCentral || {}).titre || '';
    $('#rg-questions').value = ((c.sujetCentral || {}).questions || []).map(q => [q.libelle, q.type, (q.options || []).join(', ')].filter((x, i) => i < 2 || x).join(' | ')).join('\n');
    $('#pp-date').value = c.dateSpeed || '';
    $('#rg-info').textContent = c._parDefaut ? 'Réglages proposés par défaut : pensez à enregistrer.' : c._maj ? `Enregistré le ${new Date(c._maj).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}` : '';
    $('#pp-groupes').innerHTML = S.franchises.map(f => `<option value="${esc(f.groupe)}">`).join('');
    rendrePlanningReglages(); rendreParticipantsReglages();
  }
  function rendrePlanningReglages() {
    const pl = cfg.planning || [];
    $('#pp-planning').innerHTML = pl.length ? `<table><tr><th>Colonne du planning</th><th>Compte du directeur</th><th>Créneaux</th></tr>${pl.map((x, i) => `<tr><td><b>${esc(x.libelle)}</b></td>
      <td><select data-pl="${i}"><option value="">— à associer —</option>${S.comptes.filter(c => c.actif).map(c => `<option value="${esc(c.email)}"${c.email === x.directeur ? ' selected' : ''}>${esc(c.nom || c.email)}</option>`).join('')}</select></td>
      <td class="petit">${(x.creneaux || []).map(c => `${esc(c.debut)} ${esc(c.participant)}`).join('<br>')}</td></tr>`).join('')}</table>`
      : '<p class="muted petit">Pas encore de planning : importez le fichier de départ.</p>';
    $('#pp-planning').querySelectorAll('[data-pl]').forEach(sel => sel.onchange = () => { cfg.planning[+sel.dataset.pl].directeur = sel.value; });
  }
  function rendreParticipantsReglages() {
    const q = norm($('#pp-q').value), ps = cfg.participants || [];
    const ou = {}; (cfg.planning || []).forEach(x => (x.creneaux || []).forEach(c => { ou[nomCle(c.participant)] = `${x.libelle} ${c.debut}`; }));
    const l = ps.map((p, i) => [p, i]).filter(([p]) => !q || norm(p.nom + ' ' + (p.groupe || '')).includes(q)).sort((a, b) => a[0].nom.localeCompare(b[0].nom, 'fr'));
    $('#pp-participants').innerHTML = ps.length ? `<table><tr><th>Participant</th><th>Groupe (référentiel)</th><th>Infos</th></tr>${l.map(([p, i]) => `<tr><td><b>${esc(p.nom)}</b></td>
      <td><input data-pg="${i}" list="pp-groupes" value="${esc(p.groupe || '')}" placeholder="—" style="min-width:170px;${p.groupe && !groupeDe(p.groupe) ? 'border-color:var(--accent)' : ''}"></td>
      <td class="petit">${ou[nomCle(p.nom)] ? `<span class="pastille att">⏱️ ${esc(ou[nomCle(p.nom)])}</span>` : ''}${p.etatEsprit ? '<span class="pastille">état d’esprit</span>' : ''}${p.sujetsDemandes ? '<span class="pastille">sujets</span>' : ''}${p.dev && p.dev.length ? '<span class="pastille">développement</span>' : ''}</td></tr>`).join('')}</table>
      <p class="muted petit">${ps.length} participants · ${ps.filter(p => p.groupe && groupeDe(p.groupe)).length} associés à un groupe</p>`
      : '<p class="muted petit">Aucun participant : importez le fichier de départ et le Google Sheet « Développement 2030 ».</p>';
    $('#pp-participants').querySelectorAll('[data-pg]').forEach(inp => inp.onchange = () => { cfg.participants[+inp.dataset.pg].groupe = inp.value.trim(); inp.style.borderColor = inp.value && !groupeDe(inp.value.trim()) ? 'var(--accent)' : ''; });
  }
  function participant(nom) {
    cfg.participants = cfg.participants || [];
    let p = cfg.participants.find(x => nomCle(x.nom) === nomCle(nom));
    if (!p) { p = { nom: String(nom).trim(), groupe: '' }; cfg.participants.push(p); }
    return p;
  }
  // Fichier préparé par Claude : { planning: [{ libelle, creneaux: [{ debut, fin, participant }] }], sujets: { nom: texte }, dateSpeed? }
  function importerDepart(d) {
    let nb = 0;
    if (Array.isArray(d.planning)) {
      const ancien = cfg.planning || [];
      cfg.planning = d.planning.map(x => { const a = ancien.find(y => norm(y.libelle) === norm(x.libelle)); return { libelle: x.libelle, directeur: (a && a.directeur) || x.directeur || '', creneaux: x.creneaux || [] }; });
      cfg.planning.forEach(x => x.creneaux.forEach(c => { participant(c.participant); nb++; }));
    }
    let ns = 0; for (const [nom, t] of Object.entries(d.sujets || {})) { participant(nom).sujetsDemandes = t; ns++; }
    if (d.dateSpeed) cfg.dateSpeed = d.dateSpeed;
    associerComptes(); const na = associerGroupes(true);
    remplirReglages();
    $('#pp-imp-info').textContent = `Importé : ${nb} créneaux, ${ns} demandes de sujets, ${na} groupe(s) associé(s) automatiquement. Vérifiez puis cliquez sur « Enregistrer ».`;
  }
  // Google Sheet « Développement 2030 » téléchargé en .xlsx : Franchisé, CA 2025, colonnes par année, Ouverture prévue, État d'esprit
  function importerDev(buf) {
    if (!window.XLSX) throw new Error('module Excel non chargé');
    const wb = XLSX.read(buf, { type: 'array' });
    const nomF = wb.SheetNames.find(n => /dev/i.test(n)) || wb.SheetNames[0];
    const lignes = XLSX.utils.sheet_to_json(wb.Sheets[nomF], { header: 1, defval: '', raw: true });
    const iEnt = lignes.findIndex(l => l.some(v => /^franchis/i.test(norm(v))));
    if (iEnt < 0) throw new Error('colonne « Franchisé » introuvable');
    const ent = lignes[iEnt].map(v => norm(v)), col = re => ent.findIndex(v => re.test(v));
    const cNom = col(/^franchis/), cCa = col(/^ca\b/), cOuv = col(/ouverture/), cEsp = col(/esprit/);
    const cAns = ent.map((v, i) => [v, i]).filter(([v]) => /^20\d\d$/.test(String(v).trim())).map(([v, i]) => [String(v).trim(), i]);
    let nb = 0;
    for (const l of lignes.slice(iEnt + 1)) {
      const nom = String(l[cNom] || '').replace(/^\s*\d+[\s.)-]*/, '').trim();
      if (!nom || /^(ouvertures?|zone|si petit|pas interess|en cours)\b/i.test(norm(nom))) continue;
      const p = participant(nom);
      if (cCa >= 0) { const v = typeof l[cCa] === 'number' ? l[cCa] : Number(String(l[cCa]).replace(/[^\d,.-]/g, '').replace(',', '.')); p.ca2025 = isFinite(v) && v ? Math.round(v) : null; }
      p.dev = cAns.map(([a, i]) => ({ annee: a, villes: String(l[i] || '').trim() })).filter(x => x.villes);
      if (cOuv >= 0) p.ouverture = String(l[cOuv] || '').trim();
      if (cEsp >= 0) p.etatEsprit = String(l[cEsp] || '').trim();
      nb++;
    }
    const na = associerGroupes(true);
    remplirReglages();
    $('#pp-imp-info').textContent = `Onglet « ${nomF} » : ${nb} franchisés lus (état d'esprit, CA 2025, développement par année)${na ? ', ' + na + ' groupe(s) associé(s)' : ''}. Vérifiez puis cliquez sur « Enregistrer ».`;
  }
  // Groupe du référentiel : le nom de famille du participant figure dans le nom du groupe (un seul groupe possible)
  function associerGroupes(seulementVides) {
    let n = 0;
    for (const p of cfg.participants || []) {
      if (p.groupe && (seulementVides || groupeDe(p.groupe))) continue;
      // 1) même nom que le groupe (les groupes du référentiel portent souvent le nom du franchisé)
      const exact = S.franchises.filter(f => nomCle(f.groupe) === nomCle(p.nom));
      if (exact.length === 1) { p.groupe = exact[0].groupe; n++; continue; }
      // 2) sinon, nom de famille contenu dans le nom du groupe (un seul groupe possible)
      const mots = String(p.nom).split(/\s+ET\s+/i).map(x => x.trim().split(/\s+/).pop()).flatMap(x => x.split('-')).map(nomCle).filter(x => x.length >= 3);
      const cand = S.franchises.filter(f => { const g = ' ' + nomCle(f.groupe) + ' '; return mots.some(m => g.includes(' ' + m + ' ')); });
      if (cand.length === 1) { p.groupe = cand[0].groupe; n++; }
    }
    return n;
  }
  function associerComptes() {
    for (const x of cfg.planning || []) {
      if (x.directeur) continue;
      const l = nomCle(x.libelle), c = S.comptes.filter(c => c.actif && (nomCle(c.nom || '') === l || nomCle(c.nom || '').split(' ')[0] === l || nomCle(c.email.split('@')[0]) === l));
      if (c.length === 1) x.directeur = c[0].email;
    }
  }
  async function enregistrerReglages(cible) {
    const ancien = (cfg.sujetCentral || {}).questions || [];
    const questions = $('#rg-questions').value.split('\n').map(l => l.trim()).filter(Boolean).map((l, i) => {
      const [lib, type, opts] = l.split('|').map(x => (x || '').trim());
      const t = /^choix/i.test(type) ? 'choix' : /^eti|^étiq|^tag/i.test(type) ? 'etiquettes' : 'texte';
      const ex = ancien.find(q => norm(q.libelle) === norm(lib));
      return { id: ex ? ex.id : 'q' + hash(lib + i).slice(0, 8), libelle: lib, type: t, options: t === 'texte' ? [] : (opts || '').split(',').map(x => x.trim()).filter(Boolean) };
    });
    const c = { ...cfg, annee: +$('#rg-annee').value, titre: $('#rg-titre').value.trim(), lieu: $('#rg-lieu').value.trim(), du: $('#rg-du').value, au: $('#rg-au').value,
      sujetsProposes: $('#rg-sujets').value.split('\n').map(x => x.trim()).filter(Boolean), momentsSeminaire: $('#rg-moments').value.split('\n').map(x => x.trim()).filter(Boolean), sujetCentral: { titre: $('#rg-central').value.trim(), questions },
      dateSpeed: $('#pp-date').value };
    delete c.partageInfosDepart;
    delete c._parDefaut; delete c._maj; delete c._par;
    $(cible).textContent = 'Enregistrement…';
    try {
      await appel('/seminaire/config', { method: 'PUT', body: JSON.stringify(c) });
      cfg = { ...c, _maj: new Date().toISOString() };
      if (c.annee === S.annee) S.config = JSON.parse(JSON.stringify(c));
      if (!(S.moi.annees || []).includes(c.annee)) S.moi.annees = [...(S.moi.annees || []), c.annee];
      S.editions = [{ annee: c.annee, titre: c.titre, lieu: c.lieu, du: c.du, au: c.au, icone: c.icone || '' }, ...(S.editions || []).filter(e => e.annee !== c.annee)].sort((x, y) => y.annee - x.annee);
      if (c.annee === S.annee && !surAccueil) $('#titre-edition').innerHTML = titreHtml(c.icone, c.titre);
      sauverCache(); $(cible).textContent = 'Enregistré ✓';
      const sansCompte = (c.planning || []).filter(x => !x.directeur).map(x => x.libelle);
      if (sansCompte.length) $(cible).textContent += ` · colonnes sans compte : ${sansCompte.join(', ')}`;
    } catch (e) { $(cible).textContent = e.horsLigne ? 'Hors ligne : réessayez quand le réseau sera revenu.' : e.message; }
  }
  let compteEnModif = null;
  function finModifCompte() { compteEnModif = null; $('#cp-email').value = ''; $('#cp-nom').value = ''; $('#cp-role').value = 'directeur'; $('#cp-ajouter').textContent = 'Ajouter'; $('#cp-annuler').hidden = true; }
  async function chargerComptes() {
    try {
      const d = await appel('/seminaire/comptes?annee=' + S.annee); S.comptes = d.comptes;
      $('#cp-liste').innerHTML = `<table><tr><th>Personne</th><th>Rôle</th><th>Notes ${S.annee}</th><th></th></tr>${S.comptes.map((c, i) => `<tr style="${c.actif ? '' : 'opacity:.5'}"><td><b>${esc(c.nom || '')}</b><br><span class="muted">${esc(c.email)}</span></td>
        <td>${c.admin ? 'Responsable (administrateur)' : c.role === 'responsable' ? 'Responsable' : 'Directeur'}</td><td>${c.notes}${c.derniere ? `<br><span class="muted">${esc(new Date(c.derniere).toLocaleDateString('fr-FR'))}</span>` : ''}</td>
        <td>${c.admin ? '' : `<button class="lien" data-m="${i}">Modifier</button>${c.actif ? `<button class="lien" data-s="${i}">Supprimer</button>` : `<button class="lien" data-a="${i}">Réactiver</button>`}`}</td></tr>`).join('')}</table>`;
      const maj = async (c, ch) => { try { await appel('/seminaire/comptes', { method: 'PUT', body: JSON.stringify({ ...c, ...ch, actif: ch.actif != null ? ch.actif : !!c.actif }) }); chargerComptes(); } catch (e) { $('#cp-info').textContent = e.message; } };
      $('#cp-liste').querySelectorAll('[data-m]').forEach(b => b.onclick = () => { const c = S.comptes[+b.dataset.m]; compteEnModif = c.email;
        $('#cp-nom').value = c.nom || ''; $('#cp-email').value = c.email; $('#cp-role').value = c.role === 'responsable' ? 'responsable' : 'directeur';
        $('#cp-ajouter').textContent = 'Enregistrer la modification'; $('#cp-annuler').hidden = false; $('#cp-info').textContent = 'Modification de ' + c.email; $('#cp-nom').focus(); });
      $('#cp-liste').querySelectorAll('[data-s]').forEach(b => b.onclick = async () => { const c = S.comptes[+b.dataset.s];
        if (!confirm(`Supprimer le compte de ${c.nom || c.email} ?`)) return;
        try { const d = await appel('/seminaire/comptes/supprimer', { method: 'POST', body: JSON.stringify({ email: c.email }) });
          $('#cp-info').textContent = d.desactive ? `${c.nom || c.email} a déjà ${d.notes} note(s) : compte désactivé (notes conservées).` : 'Supprimé ✓';
          if (d.supprime && cfg) (cfg.planning || []).forEach(x => { if (x.directeur === c.email) x.directeur = ''; });
          if (compteEnModif === c.email) finModifCompte(); chargerComptes();
        } catch (e) { $('#cp-info').textContent = e.message; } });
      $('#cp-liste').querySelectorAll('[data-a]').forEach(b => b.onclick = () => { const c = S.comptes[+b.dataset.a]; maj(c, { actif: !c.actif }); });
      if (cfg) { associerComptes(); rendrePlanningReglages(); }
    } catch (e) { $('#cp-liste').innerHTML = `<p class="muted petit">${e.horsLigne ? 'Liste des comptes indisponible hors ligne.' : esc(e.message)}</p>`; }
  }

  demarrer();
})();
