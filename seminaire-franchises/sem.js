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
  const S = { moi: null, annee: new Date().getFullYear(), config: null, franchises: [], moisChiffres: null, notes: new Map(), file: [], comptes: [] };
  const cleCache = () => 'seminaireCache:' + (session && session.profil ? session.profil.email : '');
  const cleFile = () => 'seminaireFile:' + (session && session.profil ? session.profil.email : '');
  function sauverCache() {
    try {
      localStorage.setItem(cleCache(), JSON.stringify({ moi: S.moi, annee: S.annee, config: S.config, franchises: S.franchises, moisChiffres: S.moisChiffres, notes: [...S.notes.values()] }));
      localStorage.setItem(cleFile(), JSON.stringify(S.file));
    } catch (e) { console.warn('cache', e); }
  }
  function lireFileSeule() { try { S.file = JSON.parse(localStorage.getItem(cleFile()) || '[]'); } catch (e) { S.file = []; } }
  function lireCache() {
    try {
      const c = JSON.parse(localStorage.getItem(cleCache()) || 'null');
      if (c) { S.moi = c.moi; S.annee = c.annee || S.annee; S.config = c.config; S.franchises = c.franchises || []; S.moisChiffres = c.moisChiffres; (c.notes || []).forEach(n => S.notes.set(n.id, n)); }
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
    S.moi = null; S.config = null; S.franchises = []; S.notes.clear(); S.comptes = []; cfg = null;
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
        const lot = S.file.slice(0, 100);
        const d = await appel('/seminaire/notes', { method: 'POST', body: JSON.stringify({ notes: lot }) });
        const okIds = new Set((d.resultats || []).filter(x => x.ok).map(x => x.id));
        const refus = (d.resultats || []).filter(x => !x.ok);
        S.file = S.file.filter(n => !okIds.has(n.id) && !refus.some(x => x.id === n.id));
        if (refus.length) alert('Certaines notes ont été refusées : ' + refus.map(x => x.erreur).join(', '));
      }
      if (complet) {
        const [moi, cfg, fr] = await Promise.all([appel('/seminaire/moi'), appel('/seminaire/config?annee=' + S.annee), appel('/seminaire/franchises')]);
        S.erreur = null; S.moi = moi; S.config = cfg.config; S.franchises = fr.franchises || []; S.moisChiffres = fr.mois;
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
      if (!e.session && !e.horsLigne) console.warn(e);
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
    $('#sy-auteur').onchange = rendreSynthese; $('#sy-annee').onchange = async () => { S.annee = +$('#sy-annee').value; S.notes.clear(); await synchroniser(true); };
    $('#sy-excel').onclick = exporterExcel; $('#sy-imprimer').onclick = () => window.print();
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
    $('#ecran-connexion').hidden = false; $('#principal').hidden = true; $('#onglets').hidden = true;
    if (session && session.profil) $('#cx-user').value = session.profil.email;
  }
  async function connecter() {
    $('#cx-info').textContent = 'Connexion…';
    try {
      const r = await fetch(API + '/auth/connexion', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifiant: $('#cx-user').value.trim(), motDePasse: $('#cx-pass').value }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) throw new Error(d.erreur && /pas accès à Suivi Stats/.test(d.erreur) ? 'Votre compte n’a pas accès au séminaire. Demandez l’accès à Olivier Baroukh.' : (d.erreur || 'Connexion impossible'));
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
    $('#ecran-connexion').hidden = true; $('#principal').hidden = false; $('#onglets').hidden = false;
    $('#lien-deconnexion').hidden = false;
    $('#qui').innerHTML = esc(S.moi.nom || monEmail()) + (resp() ? ' · responsable' : '') + '<span id="qui-duree"></span>';
    surveillerSession();
    $('#onglet-reglages').hidden = !resp();
    afficherSync(); rafraichir();
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
    if (!S.moi) return;
    $('#titre-edition').textContent = (S.config && S.config.titre) || 'Séminaire franchisés';
    if (vueActive === 'franchises') rendreFranchises();
    if (vueActive === 'planning') rendrePlanning();
    if (vueActive === 'synthese') rendreSynthese();
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
        <div class="ligne"><button class="primaire" id="ff-speed" style="flex:1">+ Speed dating</button><button id="ff-info-btn" style="flex:1">+ Échange informel</button></div>
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
    fond.querySelectorAll('[data-note]').forEach(x => x.onclick = () => ouvrirNote(S.notes.get(x.dataset.note)));
  }
  function apercuNote(n) {
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
    const annees = [...new Set([...(S.moi.annees || []), S.annee, new Date().getFullYear()])].sort((a, b) => b - a);
    $('#sy-annee').innerHTML = annees.map(a => `<option${a === S.annee ? ' selected' : ''}>${a}</option>`).join('');
    const ns = notesSynthese();
    const preps = ns.filter(n => n.type === 'preparation'), ech = ns.filter(n => n.type !== 'preparation');
    const speed = ech.filter(n => n.type === 'speed'), realises = speed.filter(n => n.donnees.realise);
    const frTouches = new Set(ns.map(n => n.franchise));
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
    const ech = ns.filter(n => n.type !== 'preparation').map(n => {
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
    const a0 = new Date().getFullYear();
    $('#rg-annee').innerHTML = [...new Set([a0 + 1, a0, S.annee, ...(S.moi.annees || [])])].sort((a, b) => b - a).map(a => `<option${a === S.annee ? ' selected' : ''}>${a}</option>`).join('');
    cfg = JSON.parse(JSON.stringify(S.config));
    remplirReglages();
    chargerComptes();
    if (reglagesBranches) return; reglagesBranches = true;
    $('#rg-annee').onchange = async () => { try { const d = await appel('/seminaire/config?annee=' + $('#rg-annee').value); cfg = d.config; remplirReglages(); } catch (e) { $('#rg-info').textContent = e.message; } };
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
    $('#rg-titre').value = c.titre || ''; $('#rg-lieu').value = c.lieu || ''; $('#rg-du').value = c.du || ''; $('#rg-au').value = c.au || '';
    $('#rg-sujets').value = (c.sujetsProposes || []).join('\n');
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
      sujetsProposes: $('#rg-sujets').value.split('\n').map(x => x.trim()).filter(Boolean), sujetCentral: { titre: $('#rg-central').value.trim(), questions },
      dateSpeed: $('#pp-date').value };
    delete c.partageInfosDepart;
    delete c._parDefaut; delete c._maj; delete c._par;
    $(cible).textContent = 'Enregistrement…';
    try {
      await appel('/seminaire/config', { method: 'PUT', body: JSON.stringify(c) });
      cfg = { ...c, _maj: new Date().toISOString() };
      if (c.annee === S.annee) S.config = JSON.parse(JSON.stringify(c));
      if (!(S.moi.annees || []).includes(c.annee)) S.moi.annees = [...(S.moi.annees || []), c.annee];
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
