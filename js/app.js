/* Interface : import mensuel, fiches magasins, réglages. */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const MOIS = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
  const pad = m => String(m).padStart(2, '0');
  const S = { ref: [], objectifs: {}, spec: null, trad: null, regles: null, fichiers: [], resultat: null, photo: null, listesConf: null, magSel: null };

  // Libellés Excel ↔ clés internes
  const REF_COLS = { 'Code site': 'code', 'Magasin': 'magasin', 'Type': 'type', 'Groupe': 'groupe', 'Date ouverture': 'ouverture', 'Pays': 'pays', 'Nature': 'nature', 'AR': 'ar', 'Langue': 'langue', 'Devise': 'devise', 'Serveur Cosium': 'serveur', 'Manager': 'manager', 'Nom Lyleoo': 'lyleoo', 'E-mail magasin': 'email', 'Actif': 'actif', 'Ancien code site': 'ancienCode',
    // Colonnes reprises du référentiel de bilan-passage (référentiel unique).
    // « Animateur terrain » : personne qui anime le magasin dans les applis terrain (bilans, accueil…) quand ce n'est pas l'AR (vide = l'AR).
    'E-mail AR': 'arEmail', 'Animateur terrain': 'animateur', 'E-mail animateur terrain': 'animateurEmail', 'Google place id': 'googlePlaceId', 'Concept': 'concept', 'Meuble vitrine': 'meubleVitrine', 'Présentoir verres': 'presentoirVerres', 'Alsace-Moselle': 'alsaceMoselle', 'Libellé bilans': 'libelleBilans' };
  const OBJ_COLS = { 'Type': 'type', 'Clé (pays ou franchisé)': 'cle', 'PM 1ère paire': 'pm1', '% Unif individualisés': 'unifIndiv', '% Anti-reflet HG': 'arHG', '% Transition': 'transition', '% SOP': 'sop', 'Nb Lyleoo': 'lyleoo', '% Pack confort': 'pcPct', '€ Pack confort': 'pcEur', '% Taux de concrétisation': 'tc', 'Panier moyen': 'panier', '% MdC': 'mdc', 'Devise': 'devise', 'Prix moyen prothèse': 'pmProthese', '% Garantie audio': 'garantieAudio', '% Ventes additionnelles': 'ventesAdd', '% TC audio': 'tcAudio', 'Durée moyenne d’essai': 'dureeEssai', '% Dépistage': 'depistage', 'PM vente audio': 'pmVente', '% Ouiezen premium': 'ouiezen' };

  // ---------- Démarrage ----------
  async function init() {
    [S.spec, S.trad, S.regles] = await Promise.all(['data/hub_spec_cosium.json', 'data/traductions.json', 'data/regles.json'].map(u => fetch(u).then(r => r.json())));
    const now = new Date(); const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    $('#imp-mois').innerHTML = MOIS.map((m, i) => `<option value="${i + 1}">${m}</option>`).join(''); $('#imp-mois').value = prev.getMonth() + 1;
    $('#imp-annee').innerHTML = [0, 1, 2].map(k => `<option>${now.getFullYear() - k}</option>`).join(''); $('#imp-annee').value = prev.getFullYear();
    document.querySelectorAll('.app-head nav button').forEach(b => b.onclick = () => vue(b.dataset.vue));
    brancherImport(); brancherFiches(); brancherReglages(); brancherCockpits(); brancherSelCockpit(); brancherConfCockpit();
    $('#ac-mois').onchange = afficherActions; ['#chg-mois', '#chg-pays', '#chg-ar'].forEach(x => $(x).onchange = afficherChallenges); $('#chg-v-saisie').onclick = () => { CHG.vue = 'saisie'; $('#chg-v-saisie').classList.add('actif'); $('#chg-v-cockpit').classList.remove('actif'); afficherChallenges(); }; $('#chg-v-cockpit').onclick = () => { CHG.vue = 'cockpit'; $('#chg-v-cockpit').classList.add('actif'); $('#chg-v-saisie').classList.remove('actif'); afficherChallenges(); }; $('#chg-pdf').onclick = pdfMlme; $('#chg-q').oninput = () => afficherChallenges(); $('#ac-param').onclick = editeurActions; $('#ac-pdf').onclick = pdfActions;
    $('#w-url').value = localStorage.getItem('workerUrl') || 'https://zimbra-relay.oli-baroukh.workers.dev';
    $('#w-cle').value = localStorage.getItem('workerCle') || '';
    $('#btn-dossier').onclick = async () => { await Store.choisirDossier(); await dossierPret(); };
    $('#btn-autoriser').onclick = async () => { if (await Store.autoriser()) await dossierPret(); };
    brancherConnexion();
    if (Store.cloud()) return sessionPrete();
    if (localStorage.getItem('modeLocal') === '1') return modeLocal();
    afficherConnexion();
  }
  // ---------- Connexion (mode Cloudflare) ----------
  function afficherConnexion() { document.body.classList.add('non-connecte'); $('#ecran-connexion').hidden = false; $('#lien-deconnexion').hidden = true; $('#etat-dossier').textContent = ''; setTimeout(() => $('#cx-user').focus(), 0); }
  function brancherConnexion() {
    const go = async () => {
      $('#cx-info').textContent = 'Connexion…'; $('#btn-connexion').disabled = true;
      try { await Store.connecter($('#cx-user').value.trim(), $('#cx-pass').value); $('#cx-pass').value = ''; $('#cx-info').textContent = ''; localStorage.removeItem('modeLocal'); await sessionPrete(); }
      catch (e) { $('#cx-info').textContent = e.message; }
      finally { $('#btn-connexion').disabled = false; }
    };
    $('#btn-connexion').onclick = go; $('#cx-pass').onkeydown = e => { if (e.key === 'Enter') go(); };
    $('#lien-mode-local').onclick = e => { e.preventDefault(); localStorage.setItem('modeLocal', '1'); modeLocal(); };
    $('#lien-deconnexion').onclick = e => { e.preventDefault(); Store.deconnecter(); localStorage.removeItem('modeLocal'); location.reload(); };
    $('#btn-copie-cloud').onclick = async () => {
      try {
        const r = await Store.copierDossierVersCloud((n, t, c) => { $('#copie-info').textContent = `${n} / ${t} – ${c}`; },
          (nb, nom, liste) => confirm(`Copier ${nb} fichier(s) du dossier « ${nom} » vers Cloudflare ?\n\n` + liste.slice(0, 12).join('\n') + (liste.length > 12 ? '\n…' : '')));
        if (!r) { $('#copie-info').textContent = 'Copie annulée.'; return; }
        $('#copie-info').textContent = `Terminé : ${r.total - r.echecs.length} fichier(s) copié(s) depuis « ${r.dossier} »` + (r.echecs.length ? ` – ${r.echecs.length} échec(s) : ${r.echecs.slice(0, 5).join(', ')}` : '') + '. Rechargement…';
        setTimeout(() => location.reload(), 1500);
      } catch (e) { if (e.name !== 'AbortError') $('#copie-info').textContent = 'Erreur : ' + e.message; }
    };
  }
  async function sessionPrete() {
    document.body.classList.remove('non-connecte'); $('#ecran-connexion').hidden = true;
    const p = Store.profil(), admin = Store.estAdmin();
    $('#lien-deconnexion').hidden = false;
    $('#pied-stockage').textContent = 'Données stockées sur Cloudflare, accès par connexion personnelle.' + (window.APP_VERSION ? ' · version ' + window.APP_VERSION : '');
    // Lecteurs : ni import ni réglages ; écrans éventuellement limités par leur profil
    document.querySelectorAll('.app-head nav button').forEach(b => {
      const v = b.dataset.vue; let ok = admin || (v !== 'import' && v !== 'reglages');
      if (!admin && v !== 'accueil' && Array.isArray(p.ecrans) && p.ecrans.length) ok = ok && p.ecrans.includes(v);
      b.hidden = !ok;
    });
    $('#carte-cloud').hidden = !admin; $('#carte-acces').hidden = !admin; document.body.classList.add('mode-cloud'); if (admin) brancherPins(); if (admin) brancherParis(); if (admin) brancherIddigital(); if (admin) brancherEcrans(); $('#zone-zimbra').hidden = !admin;
    await dossierPret();
    $('#etat-dossier').textContent = '☁️ ' + (p.nom || p.email);
    if (admin) brancherAcces();
    if (location.hash === '#mlme') vue('challenges'); // lien du mail mensuel aux AR
  }
  async function modeLocal() {
    document.body.classList.remove('non-connecte'); $('#ecran-connexion').hidden = true;
    $('#pied-stockage').textContent = 'Ancien mode : données dans le dossier choisi sur cet ordinateur (Dropbox).';
    $('#lien-deconnexion').hidden = false; $('#lien-deconnexion').textContent = 'Passer à la connexion Cloudflare';
    if (!Store.supporte()) { $('#etat-dossier').textContent = 'Navigateur non compatible : utiliser Chrome'; }
    const r = await Store.restaurer();
    if (r && r.permission === 'granted') await dossierPret(); else { $('#carte-dossier-requis').hidden = false; if (r) { $('#btn-autoriser').hidden = false; $('#btn-dossier').textContent = 'Choisir un autre dossier…'; } }
  }
  async function apresChargement() { brancherRecherche(); await afficherAccueil(); }
  async function dossierPret() {
    $('#carte-dossier-requis').hidden = true;
    $('#etat-dossier').textContent = '📁 ' + (Store.nomDossier() || 'mémoire (non enregistré)');
    S.ref = (await Store.lireJSON('config/referentiel.json')) || [];
    S.objectifs = (await Store.lireJSON(`config/objectifs-${$('#imp-annee').value}.json`)) || (await Store.lireJSON('config/objectifs.json')) || {};
    majInfosReglages(); await listerPhotos(); remplirPerimetres(); brancherTaux(); brancherObjSiege();
    await apresChargement();
  }
  // Lien direct (mail mensuel aux AR) : …/suivi-stats/#mlme ouvre l'écran de saisie
  window.addEventListener('hashchange', () => { if (location.hash === '#mlme') vue('challenges'); });
  function vue(v) { if (v === 'cockpits' && !$('#ck-apercu .cockpit')) setTimeout(afficherCockpit, 0); if (v === 'actions') setTimeout(afficherActions, 0); if (v === 'challenges') setTimeout(afficherChallenges, 0); document.querySelectorAll('.vue').forEach(x => x.classList.toggle('actif', x.id === 'vue-' + v)); document.querySelectorAll('.app-head nav button').forEach(b => b.classList.toggle('actif', b.dataset.vue === v)); }

  // ---------- Import ----------
  function brancherImport() {
    const dep = $('#depot');
    dep.ondragover = e => { e.preventDefault(); dep.classList.add('survol'); };
    dep.ondragleave = () => dep.classList.remove('survol');
    dep.ondrop = async e => { e.preventDefault(); dep.classList.remove('survol'); ajouterFichiers(await fichiersDepuisDrop(e.dataTransfer)); };
    $('#inp-fichiers').onchange = e => ajouterFichiers([...e.target.files]);
    $('#btn-calculer').onclick = calculer;
    $('#btn-zimbra').onclick = recupererZimbra;
    const majCompleter = () => { const k = `${$('#imp-annee').value}-${pad(+$('#imp-mois').value)}`, existe = (S.moisDispo || []).includes(k);
      $('#imp-completer').checked = existe; $('#lbl-completer').hidden = !existe; };
    $('#imp-mois').addEventListener('change', majCompleter); $('#imp-annee').addEventListener('change', majCompleter); S.majCompleter = majCompleter;
    $('#btn-enregistrer').onclick = enregistrer;
  }
  async function fichiersDepuisDrop(dt) {
    const out = [];
    const lireEntree = async en => {
      if (en.isFile) out.push(await new Promise(r => en.file(r)));
      else if (en.isDirectory) { const rd = en.createReader(); let lot; do { lot = await new Promise(r => rd.readEntries(r)); for (const x of lot) await lireEntree(x); } while (lot.length); }
    };
    const entrees = [...dt.items].map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
    if (entrees.length) { for (const en of entrees) await lireEntree(en); return out; }
    return [...dt.files];
  }
  function ajouterFichiers(fs) {
    for (const f of fs) if (!S.fichiers.some(x => x.name === f.name && x.size === f.size)) S.fichiers.push(f);
    $('#liste-fichiers').innerHTML = `<b>${S.fichiers.length} fichier(s)</b> · ` + S.fichiers.map(f => f.name.replace(/^[0-9a-f]{8}-/, '')).join(' · ') + ' <a href="#" id="vider">vider</a>';
    $('#vider').onclick = e => { e.preventDefault(); S.fichiers = []; $('#liste-fichiers').innerHTML = ''; };
  }
  // Mode Cloudflare (administrateur) : lecture côté serveur par le lien interne suivi-stats-api → zimbra-relay
  const viaServeur = () => Store.cloud() && Store.estAdmin();
  async function workerRatings() {
    if (viaServeur()) { try { const r = await Store.api('/relais/google'); const d = await r.json(); return d && d.ok ? { ratings: d.ratings } : { erreur: (d && (d.erreur || d.error)) || ('HTTP ' + r.status) }; } catch (e) { return { erreur: String(e) }; } }
    const { url, cle } = paramsWorker();
    if (!url || !cle) return null;
    try { const r = await fetch(url.replace(/\/$/, '') + '/google-ratings', { headers: { 'X-Store-Token': cle } }); const d = await r.json(); return d.ok ? { ratings: d.ratings } : null; }
    catch (e) { return { erreur: String(e) }; }
  }
  // Score santé mensuel (worker) : session AR partagée avec le dashboard bilan-passage (même origine)
  const sessionSante = () => { try { const x = JSON.parse(localStorage.getItem('bilan_ar_session') || 'null'); return x && x.exp > Date.now() ? x : null; } catch (e) { return null; } };
  // Paramètres du worker : ceux enregistrés, sinon ceux saisis dans Réglages (et on les enregistre au passage)
  function paramsWorker() {
    let url = localStorage.getItem('workerUrl'), cle = localStorage.getItem('workerCle');
    if (!url && $('#w-url').value.trim()) { url = $('#w-url').value.trim(); localStorage.setItem('workerUrl', url); }
    if (!cle && $('#w-cle').value.trim()) { cle = $('#w-cle').value.trim(); localStorage.setItem('workerCle', cle); }
    return { url, cle };
  }
  async function santeWorker(annee, mois) {
    let r;
    try {
      if (viaServeur()) r = await Store.api('/relais/sante?mois=' + annee + '-' + pad(mois));
      else {
        const { url, cle } = paramsWorker(); if (!url || !cle) return null;
        const ses = sessionSante(); if (!ses) return { erreur: 'session' };
        r = await fetch(url.replace(/\/$/, '') + '/sante-mensuel?mois=' + annee + '-' + pad(mois), { headers: { 'X-Store-Token': cle, 'X-AR-Session': ses.token } });
      }
      const d = await r.json(); if (!d.ok) return { erreur: d.error || ('HTTP ' + r.status) };
      const out = {}; (d.magasins || []).forEach(m => { out[String(m.code)] = { score: m.score, precedent: m.scorePrecedent, couverture: m.couverture, sous: m.sous || {}, exclusions: m.exclusions || {}, neutralisations: m.neutralisations || {}, entrees: m.entrees || {} }; });
      return { magasins: out, apercu: !!d.apercu, statut: d.statut, version: d.version, dims: d.dims };
    } catch (e) { return { erreur: String(e) }; }
  }
  // Cumul des points Kaizen de l'année par magasin (Magasin d'Excellence › KAIZEN), lu dans zimbra-relay
  async function genreWorker(annee, mois) {
    if (!viaServeur()) return null;
    try { const r = await Store.api('/relais/genre?mois=' + annee + '-' + pad(mois)); const d = await r.json(); return d && d.ok ? { mois: d.mois, magasins: d.magasins || {} } : null; } catch (e) { return null; }
  }
  async function kaizenWorker(annee, mois) {
    if (!viaServeur()) return null;
    try { const r = await Store.api('/relais/kaizen?mois=' + annee + '-' + pad(mois)); const d = await r.json(); return d && d.ok ? d.cumul || {} : null; } catch (e) { return null; }
  }
  // Dernier bilan de passage de chaque magasin avant la fin du mois traité (actions à suivre)
  async function bilansWorker(annee, mois) {
    const fin = Pipeline.finMois(annee, mois), d = new Date(annee, mois - 7, 1), debut = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;
    try {
      let r;
      if (viaServeur()) r = await Store.api(`/relais/bilans?du=${debut}&au=${fin}`);
      else {
        const { url, cle } = paramsWorker(); if (!url || !cle) return null;
        const ses = sessionSante(); if (!ses) return { erreur: 'session' };
        r = await fetch(url.replace(/\/$/, '') + `/bilans?light=1&from=${debut}&to=${fin}&limit=1000`, { headers: { 'X-Store-Token': cle, 'X-AR-Session': ses.token } });
      }
      const j = await r.json(); if (!j.ok) return { erreur: j.error || ('HTTP ' + r.status) };
      const out = {};
      for (const b of j.results || []) {
        const c = String(b.magasin_code); if (out[c]) continue; // trié du plus récent au plus ancien
        let data = {}; try { data = JSON.parse(b.data_json || '{}'); } catch (e) {}
        out[c] = { date: b.date, ar: b.ar || null, passage: b.passage || null, actions: (data.actions || []).map(a => ({ texte: a.text || '', commentaire: a.comment || '', qui: a.who || '', echeance: a.date || '' })) };
      }
      return { magasins: out, fin };
    } catch (e) { return { erreur: String(e) }; }
  }
  async function calculer() {
    if (!S.ref.length) { alert('Importe d’abord le référentiel magasins (onglet Réglages).'); vue('reglages'); return; }
    const annee = +$('#imp-annee').value, mois = +$('#imp-mois').value;
    $('#calc-info').textContent = 'Calcul en cours…'; $('#btn-calculer').disabled = true; $('#barre-calc').hidden = false; $('#barre-calc div').style.width = '30%';
    try {
      const etatAnnee = (await Store.lireJSON(`donnees/${annee}/etat.json`)) || {};
      const completer = $('#imp-completer').checked && !$('#lbl-completer').hidden;
      const existante = completer ? await Store.lireJSON(`donnees/${annee}-${pad(mois)}/photo.json`) : null;
      if (completer && !existante) throw new Error('aucune photo enregistrée pour ce mois : décochez « Compléter ».');
      const precedent = completer ? existante : mois > 1 ? await Store.lireJSON(`donnees/${annee}-${pad(mois - 1)}/photo.json`) : null;
      let wr = completer ? null : await workerRatings(); const alerteW = wr && wr.erreur ? 'Worker avis Google injoignable : ' + wr.erreur : null; if (wr && wr.erreur) wr = null;
      const listes = S.listesConf || etatAnnee.listesConfidence || null;
      // Export RH : déposé une fois par mois dans bilan-passage › Import (transmis par zimbra-relay)
      const rhDepot = Store.cloud() ? await Store.lireJSON(`donnees/rh/${annee}-${pad(mois)}.json`).catch(() => null) : null;
      // Coefficients ETP (agenda validés importé dans bilan-passage) : tous les mois de l'année jusqu'au mois traité
      const etpDepots = Store.cloud() ? (await Promise.all(Array.from({ length: mois }, (_, i) => Store.lireJSON(`donnees/rh-etp/${annee}-${pad(i + 1)}.json`).catch(() => null)))).filter(Boolean) : [];
      const res = await Pipeline.construire({ rhDepot, etpDepots, fichiers: S.fichiers, pastes: { lyleoo: $('#paste-lyleoo').value, ocm: $('#paste-ocm').value, site: $('#paste-site').value },
        annee, mois, ref: S.ref, spec: S.spec, etatAnnee, photoPrecedente: precedent, workerRatings: wr, listesConfidence: listes });
      if (alerteW) res.rapport.alertes.unshift(alerteW);
      if (completer) { completerPhoto(existante, res); S.resultat = res; afficherRapport(res.rapport); $('#btn-enregistrer').disabled = false;
        $('#calc-info').textContent = `${MOIS[mois - 1]} ${annee} complété (${res.rapport.misesAJour.join(', ') || 'aucune source'}) – vérifie puis enregistre.`; return; }
      // Mr Qualité : mis à jour une fois par an → dernier fichier connu conservé hors année (config/mr-qualite.json)
      try {
        const sm = res.rapport.sources.mr_qualite;
        if (sm && sm.statut === 'recu') {
          const out = {}; for (const c in res.photo.magasins) { const v = res.photo.magasins[c].N.CK; if (v != null) out[c] = v; }
          await Store.ecrireJSON('config/mr-qualite.json', { fichier: sm.detail.split(' – ')[0], importeLe: new Date().toISOString().slice(0, 10), mois: `${annee}-${pad(mois)}`, scores: out });
        } else {
          const mq = await Store.lireJSON('config/mr-qualite.json');
          if (mq && mq.scores) {
            let n = 0; for (const c in mq.scores) { const m = res.photo.magasins[c]; if (m) { m.N.CK = mq.scores[c]; n++; } }
            res.rapport.sources.mr_qualite = { statut: 'repris', detail: `dernier fichier connu (${mq.fichier || '?'}, importé le ${(mq.importeLe || '').split('-').reverse().join('/')}) – ${n} magasins` };
          }
        }
      } catch (e) { console.warn('Mr Qualité', e); }
      const sa = await santeWorker(annee, mois);
      if (sa && !sa.erreur) {
        res.photo.sante = sa; const n = Object.values(sa.magasins).filter(x => x.score != null).length;
        res.rapport.sources.sante = { statut: 'recu', detail: `${n} magasins notés – ${sa.apercu ? 'aperçu indicatif (mois pas encore calculé dans le dashboard)' : 'mois ' + (sa.statut === 'valide' ? 'validé' : 'calculé') + ', version ' + sa.version}` };
        if (sa.apercu) res.rapport.alertes.push('Score santé : le mois n’est pas encore calculé dans le dashboard, les scores affichés sont indicatifs.');
        const kz = await kaizenWorker(annee, mois); if (kz) res.photo.mlme = { ...(res.photo.mlme || {}), kaizen: kz, kaizenMaj: new Date().toISOString() }; const hf = await genreWorker(annee, mois); if (hf) res.photo.mlme = { ...(res.photo.mlme || {}), genre: hf };
        const bp = await bilansWorker(annee, mois);
        if (bp && !bp.erreur) { res.photo.bilans = bp; res.rapport.sources.bilans = { statut: 'recu', detail: `${Object.keys(bp.magasins).length} magasins (dernier passage avant le ${bp.fin.split('-').reverse().join('/')})` }; }
        else res.rapport.sources.bilans = { statut: 'absent', detail: bp ? bp.erreur : 'worker non configuré' };
      } else {
        res.rapport.sources.bilans = { statut: 'absent', detail: !sa ? 'worker non configuré' : sa.erreur === 'session' ? 'connexion Zimbra requise (Réglages)' : sa.erreur };
        res.rapport.sources.sante = { statut: 'absent', detail: !sa ? 'worker non configuré' : sa.erreur === 'session' ? 'connexion Zimbra requise (Réglages)' : sa.erreur };
        if (sa && sa.erreur === 'session') res.rapport.alertes.push('Score santé non récupéré : connecte-toi dans Réglages (session Zimbra expirée), puis recalcule.');
      }
      res.etatAnnee.listesConfidence = listes;
      S.resultat = res; afficherRapport(res.rapport);
      $('#btn-enregistrer').disabled = false;
      $('#calc-info').textContent = `${MOIS[mois - 1]} ${annee} calculé – vérifie le rapport puis enregistre.`;
    } catch (e) { console.error(e); $('#calc-info').textContent = 'Erreur : ' + e.message; }
    finally { $('#btn-calculer').disabled = false; $('#barre-calc div').style.width = '100%'; setTimeout(() => $('#barre-calc').hidden = true, 600); }
  }
  // Complément d'un mois déjà enregistré : seules les sources reçues remplacent leurs colonnes, tout le reste est conservé
  function completerPhoto(base, res) {
    const np = res.photo, srcs = res.rapport.sources, maj = [];
    if ((srcs.cosium_n && srcs.cosium_n.statut === 'recu') || (srcs.cosium_n1 && srcs.cosium_n1.statut === 'recu'))
      throw new Error('les exports Cosium demandent un import complet : décochez « Compléter le mois déjà enregistré ».');
    const photo = JSON.parse(JSON.stringify(base)); photo.sources = photo.sources || {};
    const EXTRAS = { confidence: ['_listes'], avis_google: ['_avisSource'] };
    for (const src in Pipeline.COLONNES_SOURCE) {
      if (!srcs[src] || srcs[src].statut !== 'recu') continue;
      const cols = Pipeline.COLONNES_SOURCE[src].concat(EXTRAS[src] || []);
      for (const c in photo.magasins) { const n = np.magasins[c] && np.magasins[c].N; if (!n) continue; cols.forEach(k => { if (k in n) photo.magasins[c].N[k] = n[k]; }); }
      photo.sources[src] = srcs[src]; maj.push(Pipeline.LIBELLE_SOURCE[src] || src);
    }
    if (srcs.rh && srcs.rh.statut === 'recu') { photo.rh = np.rh; photo.equipes = np.equipes; photo.sources.rh = srcs.rh; maj.push('Export RH'); }
    if (srcs.stat_indiv && srcs.stat_indiv.statut === 'recu') { photo.statsVendeurs = np.statsVendeurs; photo.equipes = np.equipes; photo.sources.stat_indiv = srcs.stat_indiv; maj.push('Stats par vendeur'); }
    for (const s of ['lyleoo', 'ocm', 'site']) if (srcs[s] && srcs[s].statut === 'recu' && !maj.includes(Pipeline.LIBELLE_SOURCE[s])) { photo.sources[s] = srcs[s]; maj.push(Pipeline.LIBELLE_SOURCE[s]); }
    if (srcs.site && srcs.site.statut === 'recu' && np.groupe && np.groupe.site) photo.groupe = Object.assign({}, photo.groupe, { site: np.groupe.site });
    photo.genereLe = new Date().toISOString(); photo.completeLe = photo.genereLe;
    res.photo = photo;
    res.rapport.sources = photo.sources; res.rapport.misesAJour = maj;
    res.rapport.journal.unshift(maj.length ? `Complément du mois enregistré : ${maj.join(', ')} mis à jour ; tout le reste est conservé.` : 'Complément : aucune source reconnue dans les fichiers déposés.');
  }
  function afficherRapport(r) {
    $('#carte-rapport').hidden = false;
    $('#tab-sources').innerHTML = '<tr><th>Source</th><th>État</th><th>Détail</th></tr>' + Object.entries(r.sources).map(([k, s]) =>
      `<tr><td>${Pipeline.LIBELLE_SOURCE[k] || k}</td><td><span class="pastille ${s.statut}">${{ recu: 'reçu', repris: 'mois précédent', absent: 'absent' }[s.statut]}</span></td><td class="muted">${s.detail || ''}</td></tr>`).join('');
    $('#liste-alertes').innerHTML = r.alertes.length ? r.alertes.map(a => `<li>${esc(a)}</li>`).join('') : '<li class="muted">Rien à signaler.</li>';
    $('#liste-journal').innerHTML = r.journal.concat(r.ignores.length ? [`${r.ignores.length} fichier(s) non utilisés : ` + r.ignores.join(', ')] : []).map(a => `<li>${esc(a)}</li>`).join('');
    if (r.listesConfidence) {
      const sel = new Set(S.listesConf || (S.resultat && S.resultat.etatAnnee.listesConfidence) || r.listesConfidence);
      $('#carte-confidence').hidden = false;
      $('#chk-confidence').innerHTML = r.listesConfidence.map(l => `<label><input type="checkbox" value="${esc(l)}" ${sel.has(l) ? 'checked' : ''}> ${esc(l)}</label>`).join('') + ' <button id="btn-reconf">Recalculer avec ces listes</button>';
      $('#btn-reconf').onclick = () => { S.listesConf = [...document.querySelectorAll('#chk-confidence input:checked')].map(i => i.value); calculer(); };
    }
  }
  async function enregistrer() {
    const { photo, etatAnnee } = S.resultat; const k = `${photo.annee}-${pad(photo.mois)}`;
    $('#calc-info').textContent = 'Enregistrement…';
    await Store.ecrireJSON(`donnees/${k}/photo.json`, photo);
    A.photos = {}; CK.cle = null; S.series = null; // les cockpits relisent la photo qui vient d'être enregistrée
    await Store.ecrireJSON(`donnees/${photo.annee}/etat.json`, etatAnnee);
    for (const f of S.fichiers) await Store.ecrire(`donnees/${k}/imports/${f.name.replace(/^[0-9a-f]{8}-/, '')}`, f);
    for (const p of ['lyleoo', 'ocm', 'site']) { const v = $('#paste-' + p).value; if (v.trim()) await Store.ecrire(`donnees/${k}/imports/copier-coller-${p}.txt`, v); }
    $('#calc-info').textContent = `Photo de ${MOIS[photo.mois - 1]} ${photo.annee} enregistrée.`; $('#btn-enregistrer').disabled = true;
    await listerPhotos(); $('#fi-photo').value = k; await chargerPhoto(k); afficherAccueil();
  }

  // ---------- Fiches ----------
  function brancherFiches() {
    $('#fi-photo').onchange = e => chargerPhoto(e.target.value);
    ['#fi-recherche', '#fi-filtre-pays', '#fi-filtre-type', '#fi-filtre-nature'].forEach(s => $(s).oninput = listerMagasins);
    $('#fi-langue').onchange = () => S.magSel && afficherFiche(S.magSel);
    $('#btn-pdf-un').onclick = async () => { if (!S.magSel) return; const m = S.magSel; const b = await pdfMagasin(m); telecharger(b, nomPdf(m)); };
    $('#btn-pdf-tous').onclick = pdfSelection;
    $('#btn-visite').onclick = async () => { if (!S.magSel) return; const b = $('#btn-visite'); b.disabled = true; b.textContent = 'Préparation…';
      try { telecharger(await pdfVisite(S.magSel), 'Visite - ' + nomPdf(S.magSel)); } finally { b.disabled = false; b.textContent = 'Dossier de visite (PDF)'; } };
    $('#btn-visite-voir').onclick = async () => { if (!S.magSel) return; $('#apercu').innerHTML = await htmlVisite(S.magSel); ajuster($('#apercu')); adapterEchelle(); };
  }
  async function listerPhotos() {
    const ks = (await Store.lister('donnees')).filter(n => /^\d{4}-\d{2}$/.test(n)).sort().reverse();
    S.moisDispo = ks;
    if (S.majCompleter) S.majCompleter();
    $('#ck-photo').innerHTML = ks.length ? ks.map(k => `<option value="${k}">${MOIS[+k.slice(5) - 1]} ${k.slice(0, 4)} (cumul depuis janvier)</option>`).join('') : '<option value="">Aucun mois enregistré</option>';
    $('#fi-photo').innerHTML = ks.length ? ks.map(k => `<option value="${k}">${MOIS[+k.slice(5) - 1]} ${k.slice(0, 4)}</option>`).join('') : '<option value="">Aucun mois enregistré</option>';
    if (ks.length) await chargerPhoto(ks[0]);
  }
  async function chargerPhoto(k) {
    S.photo = k ? await Store.lireJSON(`donnees/${k}/photo.json`) : null;
    S.chal = S.photo ? await Store.lireJSON(`config/challenges-${S.photo.annee}.json`).catch(() => null) : null;
    S.tauxCh = await tauxChange();
    { const cp = await Store.lireJSON('config/cockpit-paris.json').catch(() => null); if (cp && cp.codes) { Cockpit.definirParis(cp.codes); try { remplirPerimetres(); } catch (e) {} } }
    const pays = [...new Set(S.ref.map(r => r.pays))].sort();
    $('#fi-filtre-pays').innerHTML = '<option value="">Tous les pays</option>' + pays.map(p => `<option>${p}</option>`).join('');
    listerMagasins();
  }
  function selection() {
    if (!S.photo) return [];
    const q = norm($('#fi-recherche').value), p = $('#fi-filtre-pays').value, t = $('#fi-filtre-type').value;
    // 06/11/2026 : magasins / OC Mobile (camions) / les deux
    const na = $('#fi-filtre-nature') ? $('#fi-filtre-nature').value : '', estOcm = r => r.nature === 'Camion';
    return S.ref.filter(r => r.actif === 'Oui' && S.photo.magasins[String(r.code)] && (!p || r.pays === p) && (!t || r.type === t)
      && (!na || (na === 'ocm' ? estOcm(r) : !estOcm(r)))
      && (!q || norm(`${r.code} ${r.magasin} ${r.ar} ${r.groupe} ${r.manager}`).includes(q)));
  }
  function listerMagasins() {
    const l = selection();
    $('#liste-mag').innerHTML = l.map(r => `<div data-code="${r.code}" class="${S.magSel && S.magSel.code === r.code ? 'sel' : ''}"><b>${r.code}</b> ${esc(r.magasin)}<small>${esc(r.pays === 'FRANCE' ? (r.ar || '') : r.pays)}</small></div>`).join('') || '<p class="muted" style="padding:10px">Aucun magasin.</p>';
    $('#liste-mag').querySelectorAll('div[data-code]').forEach(d => d.onclick = () => { S.magSel = S.ref.find(r => String(r.code) === d.dataset.code); listerMagasins(); afficherFiche(S.magSel); });
    $('#pdf-info').textContent = `${l.length} magasin(s) dans la sélection`;
  }
  function langues(m) { const forcer = $('#fi-langue').value; if (forcer) return [forcer]; const l = Fiche.LANGUES[m.langue] || 'fr'; return l === 'fr' ? ['fr'] : [l, 'fr']; }
  // Si une page déborde (grosse équipe, police locale plus haute), on resserre le tableau équipe
  // Petits écrans : les pages A4 (fiches) et A3 (cockpits) sont réduites à la largeur disponible
  function adapterEchelle() {
    for (const [hote, sel] of [[$('#apercu'), '.fiche']]) { // les cockpits ont déjà leur propre mise à l'échelle
      if (!hote) continue;
      const cs = getComputedStyle(hote), larg = hote.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 2;
      hote.querySelectorAll(sel).forEach(p => { p.style.zoom = ''; const w = p.offsetWidth; if (w && larg && w > larg) p.style.zoom = (larg / w).toFixed(4); });
    }
  }
  window.addEventListener('resize', () => { clearTimeout(S.tEchelle); S.tEchelle = setTimeout(adapterEchelle, 150); });
  function ajuster(hote) {
    hote.querySelectorAll('.fiche').forEach(f => {
      const tb = f.querySelector('table.equipe');
      if (tb && f.scrollHeight > f.clientHeight + 1) tb.classList.add('dense');
      if (tb && f.scrollHeight > f.clientHeight + 1) tb.classList.add('tres-dense');
      if (f.scrollHeight > f.clientHeight + 1) f.classList.add('serre');
      if (f.scrollHeight > f.clientHeight + 1) f.classList.add('tres-serre');
      // 06/11/2026 : dernier recours (page 2 coupée sur téléphone, police plus large) : on réduit légèrement le
      // contenu jusqu'à ce qu'il tienne dans la page, plutôt que de couper le bas
      let z = parseFloat(f.dataset.reduc || '1');
      for (let i = 0; i < 4 && f.scrollHeight > f.clientHeight + 1; i++) {
        z = Math.max(0.75, z * Math.min(0.99, (f.clientHeight - 6) / f.scrollHeight));
        [...f.children].forEach(c => { c.style.zoom = z; });
        f.dataset.reduc = z.toFixed(3);
      }
    });
  }
  async function afficherFiche(m) {
    const serie = await serieMagasin(m.code);
    const tel = window.innerWidth <= 820;
    $('#apercu').innerHTML = langues(m).map(l => Fiche.rendre(S.photo, m, S.objectifs, S.trad, { langue: l, serie , challenges: S.chal, taux: S.tauxCh })).join('');
    ajuster($('#apercu')); adapterEchelle();
    // 06/11/2026 : sur téléphone, la police (Montserrat) arrive souvent après le premier calcul et rallonge la page →
    // bas de page coupé. On recale une fois les polices chargées.
    const hote = $('#apercu');
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if ($('#apercu') === hote) { ajuster(hote); adapterEchelle(); } });
    if (tel) $('#apercu').scrollIntoView({ behavior: 'smooth', block: 'start' }); // téléphone : on descend directement sur la fiche
  }
  // ---------- Historique de l'année : séries mensuelles (CA du mois, N-1, positionnement) ----------
  // Toutes les photos de janvier au mois affiché sont lues une fois, puis réduites à quelques chiffres par magasin.
  async function series() {
    if (!S.photo) return {};
    const cle = `${S.photo.annee}-${pad(S.photo.mois)}`;
    if (S.series && S.series.cle === cle) return S.series.par;
    const par = {}, prec = {};
    for (let mo = 1; mo <= S.photo.mois; mo++) {
      const k = `${S.photo.annee}-${pad(mo)}`;
      if (!(S.moisDispo || []).includes(k)) continue;
      const ph = mo === S.photo.mois ? S.photo : await Store.lireJSON(`donnees/${k}/photo.json`);
      if (!ph) continue;
      for (const code in ph.magasins) {
        const d = ph.magasins[code], n = d.N || {}, n1 = d.N1 || {}, p = prec[code] || {};
        const caMois = n.P == null ? null : n.P - (p.mois === mo - 1 ? (p.P || 0) : (mo === 1 ? 0 : NaN));
        const caMoisN1 = n1.P == null ? null : n1.P - (p.mois === mo - 1 ? (p.P1 || 0) : (mo === 1 ? 0 : NaN));
        (par[code] = par[code] || []).push({ mois: mo, caCum: n.P, O: n.O, caMois: isFinite(caMois) ? caMois : null, caMoisN1: isFinite(caMoisN1) ? caMoisN1 : null,
          posit: n.P != null && n.O ? n.P * 12 / mo / (n.O * 1000) : null });
        prec[code] = { mois: mo, P: n.P, P1: n1.P };
      }
    }
    S.series = { cle, par };
    return par;
  }
  // Positionnement d'un périmètre mois par mois (montants convertis en € si plusieurs devises)
  async function seriePerimetre(p, tx) {
    if (!p || !p.filtre || !CK.photo || !S.photo || CK.photo.annee !== S.photo.annee || CK.photo.mois !== S.photo.mois) return null;
    const par = await series(), ref = S.ref.filter(r => p.filtre(r));
    const out = [];
    for (let mo = 1; mo <= S.photo.mois; mo++) {
      let P = 0, O = 0, ok = false;
      ref.forEach(r => { const x = (par[String(r.code)] || []).find(y => y.mois === mo); if (!x || x.caCum == null || !x.O) return; const t = tx[r.devise] || 1; P += x.caCum * t; O += x.O * 1000 * t; ok = true; });
      if (ok) out.push({ mois: mo, posit: O ? P * 12 / mo / O : null });
    }
    return out.length > 1 ? out : null;
  }
  async function serieMagasin(code) { try { return (await series())[String(code)] || []; } catch (e) { console.warn(e); return []; } }
  const nomPdf = m => `${m.code} - ${String(m.magasin).replace(/[\\/:*?"<>|]/g, '-')} - ${S.photo.annee}-${pad(S.photo.mois)}.pdf`;
  async function pdfMagasin(m) {
    const { jsPDF } = window.jspdf; const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const hote = document.createElement('div'); hote.style.cssText = 'position:fixed;left:-10000px;top:0'; document.body.appendChild(hote);
    const ls = langues(m);
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    let n = 0;
    for (let i = 0; i < ls.length; i++) {
      hote.innerHTML = Fiche.rendre(S.photo, m, S.objectifs, S.trad, { langue: ls[i], serie: await serieMagasin(m.code) , challenges: S.chal, taux: S.tauxCh });
      ajuster(hote);
      await Promise.all([...hote.querySelectorAll('img')].map(im => im.complete ? 0 : new Promise(r => { im.onload = im.onerror = r; })));
      for (const page of hote.querySelectorAll('.fiche')) {
        const canvas = await html2canvas(page, { scale: 2, backgroundColor: '#ffffff', logging: false });
        if (n++) doc.addPage();
        doc.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 210, 297);
      }
    }
    hote.remove();
    return doc.output('blob');
  }
  // Dossier de visite : page de préparation (comparaison au groupe, bilan, notes) + fiche magasin en français
  async function htmlVisite(m) {
    const prec = await photoMois(moisPrec(`${S.photo.annee}-${pad(S.photo.mois)}`));
    return Visite.rendre(S.photo, prec, S.ref, m, S.objectifs) + Fiche.rendre(S.photo, m, S.objectifs, S.trad, { langue: 'fr', serie: await serieMagasin(m.code), challenges: S.chal, taux: S.tauxCh });
  }
  async function pdfVisite(m) {
    const { jsPDF } = window.jspdf; const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const hote = document.createElement('div'); hote.style.cssText = 'position:fixed;left:-10000px;top:0'; document.body.appendChild(hote);
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    hote.innerHTML = await htmlVisite(m); ajuster(hote);
    await Promise.all([...hote.querySelectorAll('img')].map(im => im.complete ? 0 : new Promise(r => { im.onload = im.onerror = r; })));
    let n = 0;
    for (const page of hote.querySelectorAll('.fiche')) {
      const canvas = await html2canvas(page, { scale: 2, backgroundColor: '#ffffff', logging: false });
      if (n++) doc.addPage();
      doc.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 210, 297);
    }
    hote.remove();
    return doc.output('blob');
  }
  async function pdfSelection() {
    const l = selection(); if (!l.length) return;
    if (!confirm(`Générer ${l.length} PDF dans le dossier sorties/${S.photo.annee}-${pad(S.photo.mois)}/fiches ?`)) return;
    const k = `${S.photo.annee}-${pad(S.photo.mois)}`; const envois = [['Code', 'Magasin', 'E-mail', 'Fichier']];
    const zip = Store.ecritureDurable() ? null : new JSZip();
    $('#barre-pdf').hidden = false;
    for (let i = 0; i < l.length; i++) {
      const m = l[i]; const b = await pdfMagasin(m); const nom = nomPdf(m);
      if (zip) zip.file(nom, b); else await Store.ecrire(`sorties/${k}/fiches/${nom}`, b);
      envois.push([m.code, m.magasin, m.email || '', nom]);
      $('#barre-pdf div').style.width = (100 * (i + 1) / l.length) + '%'; $('#pdf-info').textContent = `${i + 1} / ${l.length} – ${m.magasin}`;
    }
    const csv = envois.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\n');
    if (zip) { zip.file('envois.csv', csv); telecharger(await zip.generateAsync({ type: 'blob' }), `fiches-${k}.zip`); }
    else await Store.ecrire(`sorties/${k}/envois.csv`, csv);
    $('#pdf-info').textContent = `${l.length} PDF générés${zip ? ' (ZIP téléchargé)' : ' dans sorties/' + k + '/fiches'} · ${envois.filter(r => r[2]).length - 1} avec e-mail`;
  }

  // ---------- Réglages ----------
  // ---------------- Cockpits ----------------
  const CK = { photo: null, cle: null, perims: [] };
  async function tauxChange() { return Object.assign({}, Cockpit.TAUX_DEFAUT, (await Store.lireJSON('config/taux-change.json')) || {}); }
  function remplirPerimetres() {
    CK.perims = Cockpit.perimetres(S.ref);
    // Comptes à périmètre limité : pas de vue Siège (elle supposerait tout le réseau)
    const pr = Store.cloud() && Store.profil();
    if (pr && pr.role !== 'admin' && !(pr.perimetre && pr.perimetre.tous)) CK.perims = CK.perims.filter(p => p.id !== 'siege');
    const groupes = [...new Set(CK.perims.map(p => p.groupeLib))];
    const avant = $('#ck-perim').value;
    $('#ck-perim').innerHTML = groupes.map(g => `<optgroup label="${esc(g)}">${CK.perims.filter(p => p.groupeLib === g).map(p => `<option value="${esc(p.id)}">${esc(p.lib)}</option>`).join('')}</optgroup>`).join('');
    if (avant && CK.perims.some(p => p.id === avant)) $('#ck-perim').value = avant;
    remplirThemes();
  }
  function remplirThemes() {
    const p = CK.perims.find(x => x.id === $('#ck-perim').value); if (!p) return;
    const avant = $('#ck-theme').value;
    $('#ck-theme').innerHTML = p.themes.map(t => `<option value="${t}">${t === 'siege' ? 'Synthèse réseau' : Cockpit.THEMES[t].lib}</option>`).join('');
    if (p.themes.includes(avant)) $('#ck-theme').value = avant;
    $('#ck-theme').disabled = p.themes.length < 2; $('#ck-tri').disabled = !!p.special;
  }
  function ajusterCockpit(page) {
    const b = page.querySelector('.ck-blocs');
    const deborde = () => page.scrollHeight > page.clientHeight + 1 || (b && b.scrollHeight > b.clientHeight + 1);
    ['serre', 'tres-serre', 'ultra-serre'].forEach(c => { if (deborde()) page.classList.add(c); });
    return !deborde();
  }
  async function afficherCockpit() {
    const k = $('#ck-photo').value; if (!k) return;
    if (CK.cle !== k) { CK.photo = await Store.lireJSON(`donnees/${k}/photo.json`); CK.cle = k; }
    const p = CK.perims.find(x => x.id === $('#ck-perim').value); if (!p || !CK.photo) return;
    const th = $('#ck-theme').value; let tri = $('#ck-tri').value;
    if (tri === '__theme') tri = th !== 'siege' ? Cockpit.THEMES[th].tri : 'code';
    const siege = (await Store.lireJSON(`config/objectifs-siege-${CK.cle.slice(0, 4)}.json`)) || {};
    const exclus = selCockpit(p.id);
    const pAff = (p.filtre && exclus.size) ? { ...p, filtre: r => p.filtre(r) && !exclus.has(String(r.code)) } : p;
    majBoutonSel(p, exclus);
    const precedente = th === 'restes' ? await photoMois(moisPrec(CK.cle)) : null;
    const tx = await tauxChange();
    const listesConf = th === 'confidence' ? await listesConfChoisies() : null;
    $('#ck-conf-btn').hidden = th !== 'confidence'; if (th !== 'confidence') $('#ck-conf').hidden = true;
    const md = Cockpit.construire(CK.photo, S.ref, pAff, th, { tri, objectifs: S.objectifs, taux: tx, siege, precedente, listesConf });
    md.serie = await seriePerimetre(pAff, tx);
    const triLib = $('#ck-tri').selectedOptions[0].textContent.replace('Tri : ', '');
    let sansPlafond = false;
    const poser = (h, pages) => { $('#ck-apercu').innerHTML = `<div class="ck-echelle">${Cockpit.rendre(md, { triLib, hListe: h, pages, sansPlafond })}</div>`; return [...$('#ck-apercu').querySelectorAll('.cockpit')]; };
    let pages = poser(640, 1), page = pages[0];
    // Hauteur réellement disponible pour la liste, puis second rendu calé dessus
    const blocs = page.querySelector('.ck-blocs');
    let hL = 640;
    if (blocs && md.type === 'multi') { const h = blocs.clientHeight; if (h > 100) { hL = h; pages = poser(h, 1); } }
    else if (blocs) { const th = blocs.querySelector('thead'); const h = blocs.clientHeight - (th ? th.offsetHeight : 0) - 4; if (h > 100) pages = poser(h, 1); }
    let ok = pages.every(ajusterCockpit);
    // Thèmes plafonnés à 2 colonnes : si la page déborde, on revient au découpage normal (3 ou 4 colonnes)
    if (!ok && md.type === 'liste' && md.theme && md.theme.maxBlocs) {
      sansPlafond = true; pages = poser(640, 1); page = pages[0];
      const bl = page.querySelector('.ck-blocs'), th2 = bl && bl.querySelector('thead');
      if (bl) { const h = bl.clientHeight - (th2 ? th2.offsetHeight : 0) - 4; if (h > 100) pages = poser(h, 1); }
      ok = pages.every(ajusterCockpit);
    }
    // Franchisés : plusieurs pages autorisées quand il y a trop de lignes
    if (!ok && md.type === 'multi' && p.multiPages) {
      for (let nP = 2; nP <= 6 && !ok; nP++) { pages = poser(hL, nP); ok = pages.every(ajusterCockpit); }
    }
    page = pages[0];
    const echelle = () => { const w = $('#ck-apercu').clientWidth - 28; const sc = Math.min(1, w / Cockpit.W_PAGE); const e = $('#ck-apercu .ck-echelle'); e.style.transform = `scale(${sc})`; e.style.height = ((Cockpit.H_PAGE + 18) * pages.length * sc) + 'px'; };
    echelle(); window.onresize = echelle;
    $('#ck-info').innerHTML = ok ? `${md.type === 'siege' ? '' : md.lignes.length + ' lignes · '}A3 paysage, ${pages.length} page${pages.length > 1 ? 's' : ''}.` : '<b style="color:var(--ko)">Attention : ce cockpit dépasse une page A3, même resserré. Choisis un périmètre plus restreint.</b>';
    return ok;
  }
  async function pdfCockpit() {
    const page = $('#ck-apercu .cockpit'); if (!page) return;
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    const e = $('#ck-apercu .ck-echelle'); const t = e.style.transform; e.style.transform = 'none';
    const { jsPDF } = window.jspdf; const doc = new jsPDF({ unit: 'mm', format: 'a3', orientation: 'landscape' });
    const toutes = [...$('#ck-apercu').querySelectorAll('.cockpit')];
    for (let i = 0; i < toutes.length; i++) {
      const canvas = await html2canvas(toutes[i], { scale: 2, backgroundColor: '#ffffff', logging: false });
      if (i) doc.addPage('a3', 'landscape');
      doc.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 420, 297);
    }
    e.style.transform = t;
    const nom = `Cockpit - ${$('#ck-perim').selectedOptions[0].textContent} - ${$('#ck-theme').selectedOptions[0].textContent} - ${CK.cle}.pdf`.replace(/[\\/:*?"<>|]/g, '-');
    telecharger(doc.output('blob'), nom);
  }
  function brancherCockpits() {
    $('#ck-photo').onchange = afficherCockpit;
    $('#ck-perim').onchange = () => { remplirThemes(); afficherCockpit(); };
    $('#ck-theme').onchange = afficherCockpit; $('#ck-tri').onchange = afficherCockpit;
    $('#ck-pdf').onclick = pdfCockpit;
    $('#ck-print').onclick = () => { document.body.classList.add('impression-cockpit'); window.print(); setTimeout(() => document.body.classList.remove('impression-cockpit'), 500); };
  }
  async function brancherObjSiege() {
    const a = $('#imp-annee').value, LIB = { groupe: 'Groupe (€)', siteFrance: 'Site France (€)', siteIsrael: 'Site Israël (₪)', siteUK: 'Site UK (£)', siteCanada: 'Site Canada ($)', mobileSucc: 'OC Mobile succ. (€)', mobileFranchise: 'OC Mobile franch. (€)', mdc: 'Taux de MdC (ex. 0,66)' };
    const o = Object.assign({}, Cockpit.SIEGE_DEFAUT, (await Store.lireJSON(`config/objectifs-siege-${a}.json`)) || {});
    $('#siege-champs').innerHTML = Object.keys(LIB).map(k => `<label class="muted">${LIB[k]} <input data-k="${k}" type="number" step="any" value="${o[k]}" style="width:120px"></label>`).join('');
    $('#btn-siege').onclick = async () => { const x = {}; document.querySelectorAll('#siege-champs input').forEach(i => x[i.dataset.k] = +i.value); await Store.ecrireJSON(`config/objectifs-siege-${$('#imp-annee').value}.json`, x); $('#siege-info').textContent = 'Enregistré pour ' + $('#imp-annee').value; CK.cle = null; };
  }
  async function brancherTaux() {
    const t = await tauxChange();
    $('#taux-champs').innerHTML = Object.keys(Cockpit.TAUX_DEFAUT).filter(d => d !== 'Euro').map(d => `<label class="muted">${esc(Cockpit.DEVISE_SYM[d] || d)} <input data-dev="${esc(d)}" type="number" step="0.0001" value="${t[d]}" style="width:90px"></label>`).join('');
    $('#taux-info').textContent = t._maj ? `Mis à jour le ${String(t._maj).split('-').reverse().join('/')} · ${t._source || ''}` : 'Valeurs par défaut (jamais mis à jour)';
    $('#btn-taux').onclick = async () => { const o = { _maj: new Date().toISOString().slice(0, 10), _source: 'saisie manuelle' }; document.querySelectorAll('#taux-champs input').forEach(i => o[i.dataset.dev] = +i.value); await Store.ecrireJSON('config/taux-change.json', o); $('#taux-info').textContent = 'Enregistré (saisie manuelle, remplacée au prochain 1er du mois)'; };
    $('#btn-taux-maj').hidden = !(Store.cloud() && Store.estAdmin());
    $('#btn-taux-maj').onclick = async () => {
      $('#taux-info').textContent = 'Récupération des cours BCE…';
      try { const r = await Store.api('/admin/taux', { method: 'POST' }); const d = await r.json(); if (!r.ok) throw new Error(d.erreur); await brancherTaux(); }
      catch (e) { $('#taux-info').textContent = 'Erreur : ' + e.message; }
    };
  }
  function brancherReglages() {
    $('#inp-ref').onchange = async e => { const f = e.target.files[0]; if (!f) return; $('#ref-info-import').textContent = 'Import en cours…';
      try { S.ref = lireRefXlsx(await f.arrayBuffer()); await Store.ecrireJSON('config/referentiel.json', S.ref); await Store.ecrire('config/referentiel.xlsx', f); majInfosReglages(); listerMagasins();
        $('#ref-info-import').textContent = `✓ Enregistré : ${S.ref.length} magasins (${f.name}), le ${new Date().toLocaleString('fr-FR')}`; }
      catch (err) { $('#ref-info-import').textContent = 'Erreur : ' + err.message; } finally { e.target.value = ''; } };
    $('#btn-export-ref').onclick = () => exporterXlsx('Magasins', S.ref, REF_COLS, 'referentiel.xlsx');
    $('#inp-obj').onchange = async e => { const f = e.target.files[0]; if (!f) return; S.objectifs = lireObjXlsx(await f.arrayBuffer()); await Store.ecrireJSON(`config/objectifs-${$('#imp-annee').value}.json`, S.objectifs); majInfosReglages(); };
    $('#btn-export-obj').onclick = () => exporterXlsx('Objectifs ' + $('#imp-annee').value, (S.objectifs.rows || []), OBJ_COLS, `objectifs_${$('#imp-annee').value}.xlsx`);
    $('#btn-w-save').onclick = () => { localStorage.setItem('workerUrl', $('#w-url').value.trim()); localStorage.setItem('workerCle', $('#w-cle').value.trim()); $('#w-info').textContent = 'Enregistré'; };
    $('#btn-w-test').onclick = async () => { $('#btn-w-save').click(); const r = await workerRatings(); $('#w-info').textContent = !r ? 'Clé manquante' : r.erreur ? 'Erreur : ' + r.erreur : `OK – ${Object.keys(r.ratings).length} magasins`; };
    const majSante = () => { const x = sessionSante(); $('#s-info').textContent = x ? `Connecté (${x.ar === 'ALL' ? 'accès réseau complet' : x.ar}) jusqu’à ${new Date(x.exp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : 'Non connecté'; };
    majSante();
    $('#btn-s-login').onclick = async () => {
      const { url, cle } = paramsWorker();
      if (!url || !cle) { $('#s-info').textContent = 'Renseigne d’abord la clé du worker dans le cadre « Avis Google – Worker » puis clique sur Enregistrer.'; return; }
      $('#s-info').textContent = 'Connexion…';
      try {
        const r = await fetch(url.replace(/\/$/, '') + '/ar-login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Store-Token': cle }, body: JSON.stringify({ zimbraUser: $('#s-user').value.trim(), zimbraPass: $('#s-pass').value }) });
        const d = await r.json(); $('#s-pass').value = '';
        if (!r.ok || d.error) throw new Error(d.error || 'HTTP ' + r.status);
        localStorage.setItem('bilan_ar_session', JSON.stringify({ token: d.sessionToken, ar: d.ar, exp: Date.now() + d.expiresInMs }));
        majSante();
      } catch (e) { $('#s-info').textContent = 'Erreur : ' + e.message; }
    };
    $('#btn-s-maj').onclick = async () => {
      const a = +$('#imp-annee').value, m = +$('#imp-mois').value, k = `${a}-${pad(m)}`;
      const ph = await Store.lireJSON(`donnees/${k}/photo.json`); if (!ph) { $('#s-maj-info').textContent = `Aucun mois enregistré pour ${MOIS[m - 1]} ${a}.`; return; }
      $('#s-maj-info').textContent = 'Récupération…';
      const sa = await santeWorker(a, m);
      if (!sa) { $('#s-maj-info').textContent = 'Clé du worker manquante : saisis-la dans le cadre « Avis Google – Worker » et clique sur Enregistrer.'; return; }
      if (sa.erreur) { $('#s-maj-info').textContent = sa.erreur === 'session' ? 'Connecte-toi d’abord (ci-dessus).' : 'Erreur : ' + sa.erreur; return; }
      ph.sante = sa; ph.sources = ph.sources || {}; ph.sources.sante = { statut: 'recu', detail: `${Object.values(sa.magasins).filter(x => x.score != null).length} magasins notés${sa.apercu ? ' – aperçu indicatif' : ''}` };
      const kz = await kaizenWorker(a, m); if (kz) ph.mlme = { ...(ph.mlme || {}), kaizen: kz, kaizenMaj: new Date().toISOString() }; const hf = await genreWorker(a, m); if (hf) ph.mlme = { ...(ph.mlme || {}), genre: hf };
      const bp = await bilansWorker(a, m);
      if (bp && !bp.erreur) { ph.bilans = bp; ph.sources.bilans = { statut: 'recu', detail: `${Object.keys(bp.magasins).length} magasins` }; }
      await Store.ecrireJSON(`donnees/${k}/photo.json`, ph); CK.cle = null; if (S.photo && S.photo.annee === a && S.photo.mois === m) S.photo = ph;
      $('#s-maj-info').textContent = `${MOIS[m - 1]} ${a} mis à jour : score santé ${ph.sources.sante.detail}${ph.bilans ? ' · bilans de passage : ' + ph.sources.bilans.detail : ''}.`;
    };
    $('#inp-reprise').onchange = async e => {
      const f = e.target.files[0]; if (!f) return; const rep = JSON.parse(await f.text()); const a = rep.annee;
      const etat = (await Store.lireJSON(`donnees/${a}/etat.json`)) || {};
      if (rep.ocmReprise) etat.ocmReprise = rep.ocmReprise;
      ['site', 'lyleoo', 'ocm'].forEach(k => { if (rep[k]) etat[k] = Object.assign(etat[k] || {}, rep[k]); });
      if (rep.avisFichiers) etat.avisFichiers = (etat.avisFichiers || []).concat(rep.avisFichiers);
      await Store.ecrireJSON(`donnees/${a}/etat.json`, etat); majInfosReglages();
    };
  }
  async function majInfosReglages() {
    const act = S.ref.filter(r => r.actif === 'Oui');
    $('#ref-info').textContent = S.ref.length ? `${S.ref.length} codes, ${act.length} actifs · ${act.filter(r => !r.email).length} actifs sans e-mail` : 'Aucun référentiel : importe le fichier Excel.';
    $('#obj-info').textContent = S.objectifs.rows ? `${S.objectifs.rows.length} lignes (${S.objectifs.rows.filter(r => r.type === 'Pays').length} pays, ${S.objectifs.rows.filter(r => r.type !== 'Pays').length} franchisés)` : 'Aucun objectif : importe le fichier Excel.';
    const a = $('#imp-annee').value; const e = (await Store.lireJSON(`donnees/${a}/etat.json`)) || {};
    const ks = o => Object.keys(o || {}).filter(k => k.startsWith(a)).map(k => k.slice(5)).sort().join(', ') || '–';
    $('#rep-info').innerHTML = `Année ${a} · Lyleoo : ${ks(e.lyleoo)} · OCM : ${e.ocmReprise ? 'reprise jusqu’à ' + MOIS[e.ocmReprise.jusquAuMois - 1] + ' + ' : ''}${ks(e.ocm)} · Site : ${ks(e.site)} · Avis Google : ${(e.avisFichiers || []).map(x => x.date).join(', ') || '–'}`;
  }
  function lignesXlsx(buf, feuille) {
    const wb = XLSX.read(buf, { type: 'array', cellDates: false });
    const n = wb.SheetNames.find(s => feuille.test(s)) || wb.SheetNames[0];
    return XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: null, raw: false });
  }
  function lireRefXlsx(buf) {
    return lignesXlsx(buf, /^Magasins/i).map(r => { const o = {}; for (const k in REF_COLS) o[REF_COLS[k]] = r[k] == null ? null : String(r[k]).trim(); o.code = String(o.code || '').replace(/^0+/, ''); return o; }).filter(o => o.code);
  }
  function lireObjXlsx(buf) {
    const rows = lignesXlsx(buf, /^Objectifs/i).map(r => { const o = {}; for (const k in OBJ_COLS) { let v = r[k]; if (v != null && OBJ_COLS[k] !== 'type' && OBJ_COLS[k] !== 'cle' && OBJ_COLS[k] !== 'devise') { v = +String(v).replace(',', '.').replace('%', ''); if (String(r[k]).includes('%')) v /= 100; } o[OBJ_COLS[k]] = v; } return o; }).filter(o => o.cle);
    return { rows };
  }
  function exporterXlsx(feuille, data, cols, nom) {
    const inv = Object.entries(cols); const rows = data.map(d => Object.fromEntries(inv.map(([lab, k]) => [lab, d[k] == null ? '' : d[k]])));
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows, { header: inv.map(x => x[0]) }), feuille.slice(0, 31)); XLSX.writeFile(wb, nom);
  }








  // ---------- Managers Leaders et Magasins d'Excellence : saisie des critères manuels ----------
  const CHG = { conf: null, annee: null };
  async function confChallenges(annee, recharger) {
    if (!recharger && CHG.conf && CHG.annee === annee) return CHG.conf;
    CHG.conf = (await Store.lireJSON(`config/challenges-${annee}.json`).catch(() => null)) || { annee, magasins: {} }; CHG.annee = annee; return CHG.conf;
  }
  async function afficherChallenges() {
    const ks = S.moisDispo || [];
    if ($('#chg-mois').options.length !== ks.length) $('#chg-mois').innerHTML = ks.map(k => `<option value="${k}">${MOIS[+k.slice(5) - 1]} ${k.slice(0, 4)}</option>`).join('');
    const k = $('#chg-mois').value || ks[0]; if (!k) { $('#chg-info').textContent = 'Aucun mois enregistré.'; return; }
    const photo = (S.photo && k === `${S.photo.annee}-${pad(S.photo.mois)}`) ? S.photo : await photoMois(k);
    const conf = await confChallenges(+k.slice(0, 4));
    // Sélecteur de pays : tous les pays ayant des succursales (France par défaut)
    const paysSucc = [...new Set(S.ref.filter(r => r.type === 'Succursale' && r.actif === 'Oui' && r.nature !== 'Camion' && r.pays).map(r => r.pays))].sort((x, y) => x === 'FRANCE' ? -1 : y === 'FRANCE' ? 1 : x.localeCompare(y));
    if ($('#chg-pays').options.length !== paysSucc.length + 1) { const v0 = $('#chg-pays').value || 'FRANCE';
      $('#chg-pays').innerHTML = paysSucc.map(x => `<option value="${esc(x)}">${esc(x.charAt(0) + x.slice(1).toLowerCase())}</option>`).join('') + '<option value="">Toutes les succursales</option>';
      $('#chg-pays').value = paysSucc.includes(v0) || v0 === '' ? v0 : 'FRANCE'; }
    const ars = [...new Set(S.ref.filter(r => r.type === 'Succursale' && r.ar && (!$('#chg-pays').value || r.pays === $('#chg-pays').value)).map(r => r.ar))].sort();
    if ($('#chg-ar').options.length !== ars.length + 1) $('#chg-ar').innerHTML = '<option value="">Tous les AR</option>' + ars.map(x => `<option>${esc(x)}</option>`).join('');
    const pays = $('#chg-pays').value, ar = $('#chg-ar').value, q = ($('#chg-q').value || '').toLowerCase();
    const filtre = r => (!pays || r.pays === pays) && (!ar || r.ar === ar) && (!q || `${r.code} ${r.magasin}`.toLowerCase().includes(q));
    const taux = await tauxChange();
    const ls = Challenges.lignes(photo, S.ref, S.objectifs, conf, filtre, taux);
    const admin = Store.estAdmin() || !Store.cloud();
    $('#chg-pdf').hidden = CHG.vue !== 'cockpit';
    if (CHG.vue === 'cockpit') {
      const per = [pays ? pays.charAt(0) + pays.slice(1).toLowerCase() : 'Toutes les succursales', ar ? 'AR ' + ar : '', q ? '« ' + q + ' »' : ''].filter(Boolean).join(' · ');
      $('#chg-info').textContent = `${ls.length} succursales · critères à fin ${MOIS[photo.mois - 1]} ${photo.annee}.`;
      $('#chg-apercu').innerHTML = `<div class="mc-echelle">${MlmeCockpit.rendre(ls, { periode: `À fin ${MOIS[photo.mois - 1]} ${photo.annee}`, perimetre: 'Succursales – ' + per })}</div>`;
      // Listes « qualifiés et plus proches » : on retire les lignes qui ne tiennent pas entièrement (jamais de ligne coupée)
      $('#chg-apercu').querySelectorAll('.mc-liste').forEach(box => { const bas = box.getBoundingClientRect().bottom; const trs = [...box.querySelectorAll('tr')];
        for (let i = trs.length - 1; i >= 0 && trs[i].getBoundingClientRect().bottom > bas + 0.5; i--) trs[i].remove(); });
      const e = $('#chg-apercu .mc-echelle'), sc = Math.min(1, ($('#chg-apercu').clientWidth - 4) / 1587); e.style.transform = `scale(${sc})`; e.style.height = (1123 * sc) + 'px';
      $('#chg-apercu').onclick = null; $('#chg-apercu').onchange = null; return;
    }
    $('#chg-info').textContent = `Critères automatiques à fin ${MOIS[photo.mois - 1]} ${photo.annee}. Saisissez ici les critères manuels de vos succursales.`;
    $('#chg-apercu').innerHTML = Challenges.rendre(ls, conf, { admin, periode: `à fin ${MOIS[photo.mois - 1]} ${photo.annee}`, objCeDefaut: r => { const n = (photo.magasins[String(r.code)] || {}).N || {}; return n.EA != null ? n.EA : 50; } });
    const enregistrer = async (code, champ, valeur) => {
      $('#chg-info').textContent = 'Enregistrement…';
      try {
        const r = await Store.api('/mlme/saisie', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ annee: conf.annee, code, champ, valeur }) });
        const d = await r.json(); if (!r.ok) throw new Error(d.erreur || 'refusé');
        conf.magasins[code] = d.magasin; if (S.photo && S.photo.annee === conf.annee) S.chal = conf;
        $('#chg-info').textContent = '✓ Enregistré';
      } catch (e) { $('#chg-info').textContent = 'Erreur : ' + e.message; }
    };
    $('#chg-apercu').onclick = async e => {
      const td = e.target.closest('td.ms'); if (!td) return;
      const code = td.dataset.code, champ = td.dataset.champ, v = ((conf.magasins[code] || {}).saisies || {})[champ];
      const nv = v !== true; // par défaut « Non » ; un clic bascule OK ↔ Non
      const y = $('#chg-apercu .ch-scroll').scrollTop;
      await enregistrer(code, champ, nv); await afficherChallenges(); const s2 = $('#chg-apercu .ch-scroll'); if (s2) s2.scrollTop = y;
    };
    $('#chg-apercu').onchange = async e => {
      const inp = e.target.closest('input.ms-num'); if (!inp) return;
      const champ = inp.dataset.champ, x = inp.value.trim() === '' ? null : +inp.value;
      await enregistrer(inp.dataset.code, champ, x == null ? null : champ === 'fid' ? x / 100 : x);
    };
  }

  // ---------- Les Actions de l'Année ----------
  const ACT = { conf: null, annee: null };
  async function confActions(annee) {
    if (ACT.conf && ACT.annee === annee) return ACT.conf;
    let c = await Store.lireJSON(`config/actions-${annee}.json`);
    if (!c && annee === 2026) { try { c = await (await fetch('data/actions-modele-2026.json?v=' + (window.APP_VERSION || ''))).json(); c._modele = true; } catch (e) {} }
    ACT.conf = c || { titre: `Les Actions ${annee}`, actions: [] }; ACT.annee = annee; return ACT.conf;
  }
  async function afficherActions() {
    const ks = S.moisDispo || [];
    if (!$('#ac-mois').options.length || $('#ac-mois').options.length !== ks.length) $('#ac-mois').innerHTML = ks.map(k => `<option value="${k}">${MOIS[+k.slice(5) - 1]} ${k.slice(0, 4)}</option>`).join('');
    const k = $('#ac-mois').value || ks[0]; if (!k) { $('#ac-info').textContent = 'Aucun mois enregistré.'; return; }
    const photo = k === `${S.photo && S.photo.annee}-${pad(S.photo && S.photo.mois)}` ? S.photo : await photoMois(k);
    const conf = await confActions(+k.slice(0, 4));
    $('#ac-param').hidden = !(Store.estAdmin() || !Store.cloud());
    $('#ac-info').textContent = conf._modele ? 'Modèle 2026 repris de votre tableau : vérifiez-le dans « Paramétrer les actions », puis enregistrez-le.' : `${(conf.actions || []).length} actions · les réalisés automatiques se mettent à jour à chaque mois enregistré.`;
    $('#ac-apercu').innerHTML = `<div class="ac-echelle">${Actions.rendre(conf, photo, S.ref, await tauxChange(), { objectifs: S.objectifs, challenges: await confChallenges(photo.annee) })}</div>`;
    const e = $('#ac-apercu .ac-echelle'), sc = Math.min(1, ($('#ac-apercu').clientWidth - 4) / 1587);
    e.style.transform = `scale(${sc})`; e.style.height = (1123 * sc) + 'px';
  }
  function editeurActions() {
    const conf = JSON.parse(JSON.stringify(ACT.conf)), perims = Actions.perimetres(S.ref);
    const opt = (l, v) => l.map(([k, t]) => `<option value="${esc(k)}"${k === v ? ' selected' : ''}>${esc(t)}</option>`).join('');
    const mesures = Object.entries(Actions.MESURES).map(([k, m]) => [k, m.lib]);
    const per = perims.map(p => [p.id, p.lib]);
    const ligne = (a, i) => { const ind = a.indicateur || {}, o = a.objectif || {}, mn = a.manuel || {};
      const perL = per.some(p => p[0] === ind.perimetre) || !ind.perimetre ? per : per.concat([[ind.perimetre, ind.perimetre.replace('pays:', 'Pays – ').replace(/\|/g, ', ')]]);
      return `<tr class="${a.mode === 'auto' ? 'auto' : 'manuel'}" data-i="${i}">
        <td><input class="petit" data-k="num" value="${esc(a.num)}"></td><td><input class="petit" data-k="resp" value="${esc(a.resp)}"></td>
        <td><input data-k="libelle" value="${esc(a.libelle)}"></td>
        <td><input data-k="objTexte" value="${esc(o.texte || '')}" placeholder="affiché"><input data-k="objValeur" type="number" step="any" value="${o.valeur == null ? '' : o.valeur}" placeholder="valeur (auto)" class="auto-seul"><select data-k="sens" class="auto-seul">${opt([['>=', 'atteint si ≥'], ['<=', 'atteint si ≤']], o.sens || '>=')}</select><label class="auto-seul" style="font-size:10px"><input type="checkbox" data-k="projection" ${o.projection ? 'checked' : ''} style="width:auto"> sur la projection annuelle</label></td>
        <td><select data-k="mode">${opt([['auto', 'Automatique'], ['manuel', 'Manuel']], a.mode === 'auto' ? 'auto' : 'manuel')}</select></td>
        <td class="auto-seul"><select data-k="mesure">${opt(mesures, ind.mesure)}</select><select data-k="perimetre">${opt(perL, ind.perimetre || 'reseau')}</select>${ind.mesure === 'ca' ? `<select data-k="sites">${opt([['aucun', 'sans site internet'], ['tous', '+ tous les sites'], ['France', '+ site France'], ['international', '+ sites internationaux']], ind.sites || 'aucun')}</select>` : ''}</td>
        <td class="manuel-seul"><input data-k="manValeur" value="${esc(mn.valeur || '')}" placeholder="réalisé"><select data-k="manStatut">${opt([['', 'neutre'], ['ok', 'atteint (vert)'], ['ko', 'pas encore (rouge)']], mn.statut || '')}</select></td>
        <td><button data-suppr="${i}" title="Supprimer">✕</button></td></tr>`; };
    const dessiner = () => {
      $('#ac-editeur').innerHTML = `<div class="ligne-outils"><label style="flex:1">Titre <input id="ac-titre" value="${esc(conf.titre || '')}"></label>
        <button id="ac-plus">+ Ajouter une action</button><button id="ac-copier">Reprendre l’année précédente</button><button class="primaire" id="ac-enr">Enregistrer</button><button id="ac-ann">Fermer</button></div>
        <p class="aide">Automatique : le réalisé est calculé chaque mois (mesure + périmètre) et colorié selon l’objectif chiffré. Manuel : saisissez le réalisé ; il est conservé d’un mois sur l’autre. Pays multiples : choisissez un pays puis complétez l’identifiant (ex. pays:BELGIQUE|SUISSE).</p>
        <table><thead><tr><th>N°</th><th>Resp.</th><th>Libellé</th><th>Objectif</th><th>Suivi</th><th>Mesure automatique</th><th>Réalisé manuel</th><th></th></tr></thead><tbody>${conf.actions.map(ligne).join('')}</tbody></table>`;
      $('#ac-editeur tbody').onchange = $('#ac-editeur tbody').oninput = e => {
        const tr = e.target.closest('tr'); if (!tr) return; const a = conf.actions[+tr.dataset.i], k = e.target.dataset.k, v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
        a.objectif = a.objectif || {}; a.indicateur = a.indicateur || {}; a.manuel = a.manuel || {};
        if (['num', 'resp', 'libelle'].includes(k)) a[k] = k === 'num' ? (+v || v) : v;
        else if (k === 'objTexte') a.objectif.texte = v; else if (k === 'objValeur') a.objectif.valeur = v === '' ? null : +v;
        else if (k === 'sens') a.objectif.sens = v; else if (k === 'projection') a.objectif.projection = v;
        else if (k === 'mode') { a.mode = v; tr.className = v === 'auto' ? 'auto' : 'manuel'; if (v === 'auto' && !a.indicateur.mesure) { a.indicateur.mesure = 'ca'; a.indicateur.perimetre = 'reseau'; } }
        else if (k === 'mesure' || k === 'perimetre' || k === 'sites') { a.indicateur[k] = v; if (k === 'mesure' && e.type === 'change') dessiner(); }
        else if (k === 'manValeur') a.manuel.valeur = v; else if (k === 'manStatut') a.manuel.statut = v;
      };
      $('#ac-editeur tbody').onclick = e => { const i = e.target.dataset.suppr; if (i != null && confirm('Supprimer cette action ?')) { conf.actions.splice(+i, 1); dessiner(); } };
      $('#ac-plus').onclick = () => { conf.actions.push({ num: conf.actions.length + 1, resp: '', libelle: '', objectif: { texte: '', valeur: null, sens: '>=' }, mode: 'manuel', indicateur: {}, manuel: { valeur: '', statut: '' } }); dessiner(); };
      $('#ac-copier').onclick = async () => { const p = await Store.lireJSON(`config/actions-${ACT.annee - 1}.json`); if (!p) return alert(`Pas d’actions enregistrées pour ${ACT.annee - 1}.`); if (!confirm(`Remplacer par les ${p.actions.length} actions de ${ACT.annee - 1} (réalisés manuels remis à zéro) ?`)) return; conf.titre = (p.titre || '').replace(String(ACT.annee - 1), String(ACT.annee)); conf.actions = p.actions.map(a => ({ ...a, manuel: { valeur: '', statut: '' } })); dessiner(); };
      $('#ac-ann').onclick = () => { $('#ac-editeur').hidden = true; };
      $('#ac-enr').onclick = async () => { conf.titre = $('#ac-titre').value; delete conf._modele; conf.maj = new Date().toISOString().slice(0, 10);
        await Store.ecrireJSON(`config/actions-${ACT.annee}.json`, conf); ACT.conf = conf; $('#ac-editeur').hidden = true; afficherActions(); };
    };
    dessiner(); $('#ac-editeur').hidden = false;
  }
  async function pdfMlme() {
    const page = $('#chg-apercu .mlme-page'); if (!page) return;
    const { jsPDF } = window.jspdf; const doc = new jsPDF({ unit: 'mm', format: 'a3', orientation: 'landscape' });
    const clone = page.cloneNode(true), hote = document.createElement('div'); hote.style.cssText = 'position:fixed;left:-10000px;top:0'; hote.appendChild(clone); document.body.appendChild(hote);
    const canvas = await html2canvas(clone, { scale: 2, backgroundColor: '#ffffff', logging: false }); hote.remove();
    doc.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 420, 297);
    telecharger(doc.output('blob'), `Managers Leaders et Magasins d'Excellence - ${$('#chg-mois').value}.pdf`);
  }
  async function pdfActions() {
    const page = $('#ac-apercu .actions-page'); if (!page) return;
    const { jsPDF } = window.jspdf; const doc = new jsPDF({ unit: 'mm', format: 'a3', orientation: 'landscape' });
    const clone = page.cloneNode(true), hote = document.createElement('div'); hote.style.cssText = 'position:fixed;left:-10000px;top:0'; hote.appendChild(clone); document.body.appendChild(hote);
    const canvas = await html2canvas(clone, { scale: 2, backgroundColor: '#ffffff', logging: false }); hote.remove();
    doc.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 420, 297);
    telecharger(doc.output('blob'), `Actions ${ACT.annee} - ${$('#ac-mois').value}.pdf`);
  }




  // ---------- Écrans magasins IDdigital : envoi de la fiche (catégorie « Suivi des statistiques ») ----------
  const ECR = { equipes: null };
  async function magasinsEquipes() {
    if (ECR.equipes) return ECR.equipes;
    const r = await Store.api('/relais/iddigital/test'); const d = await r.json(); if (!d.ok) throw new Error(d.erreur || 'connexion IDdigital impossible');
    ECR.equipes = new Set((d.magasins || []).map(m => String(m.code ?? m.storeCode ?? '').replace(/^0+(?=\d)/, '')).filter(Boolean));
    return ECR.equipes;
  }
  const blobB64 = b => new Promise((ok, ko) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result).split(',')[1]); fr.onerror = ko; fr.readAsDataURL(b); });
  async function envoyerEcran(m) {
    const b = await pdfMagasin(m);
    const r = await Store.api('/relais/iddigital/envoyer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: m.code, type: 'stats-tracking', pdf: await blobB64(b), nom: nomPdf(m) }) });
    const d = await r.json(); if (!r.ok) throw new Error(d.erreur || 'HTTP ' + r.status); return d;
  }
  function brancherEcrans() {
    if (!(Store.cloud() && Store.estAdmin())) return;
    $('#zone-ecrans').hidden = false;
    $('#btn-ecran-un').onclick = async () => {
      const m = S.magSel; if (!m) return alert('Choisissez d’abord un magasin.');
      try { const eq = await magasinsEquipes(); if (!eq.has(String(m.code))) return alert(`${m.magasin} n’a pas d’écran IDdigital.`);
        if (!confirm(`Envoyer la fiche de ${m.magasin} (${MOIS[S.photo.mois - 1]} ${S.photo.annee}) sur l’écran du magasin, dans « Suivi des statistiques » ?`)) return;
        $('#ecran-info').textContent = 'Envoi…'; const d = await envoyerEcran(m);
        $('#ecran-info').textContent = d.ok ? `✓ Envoyé sur l’écran de ${m.magasin}` : `Échec : ${d.erreur || 'statut ' + d.statut + (d.reponse ? ' – ' + d.reponse : '')}`;
      } catch (e) { $('#ecran-info').textContent = 'Erreur : ' + e.message; }
    };
    $('#btn-ecran-tous').onclick = async () => {
      try {
        const eq = await magasinsEquipes(); const l = selection().filter(m => eq.has(String(m.code)));
        if (!l.length) return alert('Aucun magasin équipé d’un écran dans la sélection.');
        if (!confirm(`Envoyer ${l.length} fiche(s) (${MOIS[S.photo.mois - 1]} ${S.photo.annee}) sur les écrans des magasins, dans « Suivi des statistiques » ?`)) return;
        let ok = 0; const ko = [];
        for (let i = 0; i < l.length; i++) {
          $('#ecran-info').textContent = `${i + 1} / ${l.length} – ${l[i].magasin}…`;
          try { const d = await envoyerEcran(l[i]); if (d.ok) ok++; else ko.push(`${l[i].magasin} (${d.erreur || d.statut})`); } catch (e) { ko.push(`${l[i].magasin} (${e.message})`); }
        }
        $('#ecran-info').textContent = `✓ ${ok} fiche(s) envoyée(s)` + (ko.length ? ` · ${ko.length} échec(s) : ${ko.join(', ')}` : '');
      } catch (e) { $('#ecran-info').textContent = 'Erreur : ' + e.message; }
    };
  }

  // ---------- Réglages : écrans magasins IDdigital (test) ----------
  function brancherIddigital() {
    if (!(Store.cloud() && Store.estAdmin())) return;
    $('#carte-iddigital').hidden = false;
    $('#btn-idd-test').onclick = async () => {
      $('#idd-info').textContent = 'Connexion à IDdigital…'; $('#idd-resultat').innerHTML = '';
      try {
        const r = await Store.api('/relais/iddigital/test'); const d = await r.json();
        if (!d.ok) { $('#idd-info').textContent = 'Échec : ' + (d.erreur || d.error || 'inconnu'); $('#idd-resultat').innerHTML = d.essais ? '<pre style="font-size:11px;white-space:pre-wrap">' + esc(d.essais.join('\n')) + '</pre>' : ''; return; }
        const nrm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
        const lignes = (d.magasins || []).map(m => {
          const id = m.id ?? m.storeId ?? m.ID ?? '', nom = m.name ?? m.nom ?? m.label ?? m.libelle ?? JSON.stringify(m).slice(0, 80);
          const code = String(m.code ?? m.storeCode ?? m.codeSite ?? '').replace(/^0+(?=\d)/, '');
          const ref = S.ref.find(r => code && String(r.code) === code) || S.ref.find(r => nrm(r.magasin) && nrm(nom).includes(nrm(r.magasin).split(' ')[0]) && nrm(nom) === nrm(r.magasin));
          return `<tr><td>${esc(id)}</td><td>${esc(nom)}</td><td>${esc(code)}</td><td>${ref ? '✓ ' + esc(ref.code + ' ' + ref.magasin) : '<span class="muted">à rapprocher</span>'}</td></tr>`; });
        $('#idd-info').textContent = `✓ Connecté (${d.base}, ${d.variante}) · ${d.nb} magasin(s) accessible(s)`;
        $('#idd-resultat').innerHTML = `<table class="tableau-acces"><thead><tr><th>Id IDdigital</th><th>Nom</th><th>Code</th><th>Magasin Suivi Stats</th></tr></thead><tbody>${lignes.join('')}</tbody></table>` + (d.brut ? '<pre style="font-size:11px">' + esc(JSON.stringify(d.brut).slice(0, 1500)) + '</pre>' : '') + (d.magasins && d.magasins[0] ? '<p class="aide">Exemple brut : ' + esc(JSON.stringify(d.magasins[0]).slice(0, 300)) + '</p>' : '');
      } catch (e) { $('#idd-info').textContent = 'Erreur : ' + e.message; }
    };
  }

  // ---------- Réglages : composition du cockpit Paris ----------
  async function brancherParis() {
    if (!(Store.estAdmin() || !Store.cloud())) return;
    $('#carte-paris').hidden = false;
    const cp = await Store.lireJSON('config/cockpit-paris.json').catch(() => null); if (cp && cp.codes) Cockpit.definirParis(cp.codes);
    const montrer = () => { const l = Cockpit.paris(); $('#paris-codes').value = l.join(', ');
      $('#paris-info').textContent = l.length + ' magasins : ' + l.map(c => { const r = S.ref.find(x => String(x.code) === c); return r ? r.magasin : c + ' (inconnu)'; }).join(' · '); };
    montrer();
    $('#btn-paris').onclick = async () => {
      const codes = $('#paris-codes').value.split(/[\s,;]+/).map(x => x.trim().replace(/^0+(?=\d)/, '')).filter(Boolean);
      if (!codes.length) return alert('Indiquez au moins un code magasin.');
      await Store.ecrireJSON('config/cockpit-paris.json', { codes, maj: new Date().toISOString().slice(0, 10) });
      Cockpit.definirParis(codes); try { remplirPerimetres(); } catch (e) {} montrer(); $('#paris-info').textContent = '✓ Enregistré · ' + $('#paris-info').textContent;
    };
  }

  // ---------- Accès magasins : codes PIN ----------
  const PIN = { liste: [], choix: new Set() };
  async function brancherPins() {
    if (!(Store.cloud() && Store.estAdmin())) return;
    $('#carte-pins').hidden = false;
    const dessiner = () => {
      const q = ($('#pin-filtre').value || '').toLowerCase(), sans = $('#pin-sans').checked, sansPoste = $('#pin-sans-poste').checked;
      const l = PIN.liste.filter(m => (!sans || !m.pin) && (!sansPoste || !(m.pin && m.pin.derniereConnexion)) && (!q || `${m.code} ${m.libelle} ${m.animateur}`.toLowerCase().includes(q)));
      PIN.affiches = l;
      $('#pin-liste').innerHTML = `<table><thead><tr><th></th><th>Magasin</th><th>Animateur</th><th>Code PIN</th><th>Postes enregistrés</th></tr></thead><tbody>${l.map(m => `<tr><td><input type="checkbox" data-c="${esc(m.code)}"${PIN.choix.has(m.code) ? ' checked' : ''}></td><td><b>${esc(m.code)}</b> ${esc(m.libelle)}<br><small class="muted">${esc(m.email || 'pas d’e-mail')}</small></td><td>${esc(m.animateur)}</td><td>${m.pin ? `envoyé le ${String(m.pin.creeLe || '').slice(0, 10).split('-').reverse().join('/')}${m.pin.envoyeA ? '' : ' (non envoyé)'}` : '<span class="muted">aucun</span>'}</td><td>${m.pin && m.pin.derniereConnexion ? `✓ ${m.pin.nbConnexions} poste(s), dernier le ${String(m.pin.derniereConnexion).slice(0, 10).split('-').reverse().join('/')}` : (m.pin ? '<span class="muted">aucun poste</span>' : '')}</td></tr>`).join('')}</tbody></table>`;
      $('#pin-info').textContent = `${PIN.choix.size} magasin(s) coché(s) · ${PIN.liste.filter(m => m.pin).length} / ${PIN.liste.length} ont un code · ${PIN.liste.filter(m => m.pin && m.pin.derniereConnexion).length} avec au moins un poste enregistré`;
    };
    const charger = async () => { try { const r = await Store.api('/relais/pins'); const d = await r.json(); if (!r.ok) throw new Error(d.erreur); PIN.liste = d.magasins || []; dessiner(); } catch (e) { $('#pin-info').textContent = 'Erreur : ' + e.message; } };
    $('#pin-filtre').oninput = dessiner; $('#pin-sans').onchange = dessiner; $('#pin-sans-poste').onchange = dessiner;
    $('#pin-liste').onchange = e => { const c = e.target.dataset.c; if (!c) return; e.target.checked ? PIN.choix.add(c) : PIN.choix.delete(c); dessiner(); };
    $('#pin-tout').onclick = () => { (PIN.affiches || []).forEach(m => PIN.choix.add(m.code)); dessiner(); };
    $('#pin-generer').onclick = async () => {
      const codes = [...PIN.choix]; if (!codes.length) return alert('Cochez au moins un magasin.');
      const deja = PIN.liste.filter(m => PIN.choix.has(m.code) && m.pin).length;
      if (!confirm(`Générer un code pour ${codes.length} magasin(s) et l’envoyer par mail ?` + (deja ? `\n\n${deja} magasin(s) ont déjà un code : leurs postes devront ressaisir le nouveau.` : ''))) return;
      $('#pin-info').textContent = 'Génération et envoi…';
      try { const r = await Store.api('/relais/pins', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ codes, envoyer: true }) }); const d = await r.json(); if (!r.ok) throw new Error(d.erreur);
        const res = d.resultats || [], ko = res.filter(x => !x.envoye);
        $('#pin-resultat').innerHTML = `<p>✓ ${res.filter(x => x.envoye).length} code(s) envoyé(s) par mail.</p>` + (ko.length ? `<p class="aide">Non envoyés : à transmettre vous-même (affichés une seule fois) :</p><table>${ko.map(x => `<tr><td><b>${esc(x.code)}</b> ${esc(x.libelle || '')}</td><td style="font-size:16px;letter-spacing:2px"><b>${esc(x.pin || '–')}</b></td><td class="muted">${esc(x.erreur || '')}</td></tr>`).join('')}</table>` : '');
        PIN.choix.clear(); await charger();
      } catch (e) { $('#pin-info').textContent = 'Erreur : ' + e.message; }
    };
    await charger();
  }

  // ---------- Cockpit Confidence : listes affichées ----------
  // Choix commun (enregistré par un administrateur pour toute l'équipe) ; un lecteur peut garder son propre choix sur son appareil.
  async function listesConfChoisies() {
    try { const perso = JSON.parse(localStorage.getItem('confListes') || 'null'); if (perso && perso.length && !Store.estAdmin()) return perso; } catch (e) {}
    const c = await Store.lireJSON('config/confidence-listes.json');
    return (c && c.listes && c.listes.length) ? c.listes : Cockpit.LISTES_CONF_DEFAUT;
  }
  function listesDisponibles() {
    const s = new Set(Cockpit.LISTES_CONF_DEFAUT);
    for (const c in (CK.photo || {}).magasins || {}) { const L = (CK.photo.magasins[c].N || {})._listes; if (L) Object.keys(L).forEach(k => { if (k !== 'Global') s.add(k); }); }
    return [...s].sort((a, b) => a.localeCompare(b));
  }
  function brancherConfCockpit() {
    $('#ck-conf-btn').onclick = async () => {
      $('#ck-conf').hidden = !$('#ck-conf').hidden; if ($('#ck-conf').hidden) return;
      const choix = await listesConfChoisies(), dispo = listesDisponibles();
      $('#ck-conf-portee').textContent = Store.estAdmin() ? 'Choix enregistré pour toute l’équipe.' : 'Choix mémorisé sur cet appareil.';
      $('#ck-conf-liste').innerHTML = dispo.map(l => `<label><input type="checkbox" value="${esc(l)}"${choix.includes(l) ? ' checked' : ''}> ${esc(l)}</label>`).join('');
      $('#ck-conf-liste').onchange = async e => {
        const sel = [...document.querySelectorAll('#ck-conf-liste input:checked')].map(i => i.value);
        if (sel.length > 6) { e.target.checked = false; alert('6 listes au maximum.'); return; }
        if (!sel.length) return;
        if (Store.estAdmin()) await Store.ecrireJSON('config/confidence-listes.json', { listes: sel, maj: new Date().toISOString().slice(0, 10) });
        else localStorage.setItem('confListes', JSON.stringify(sel));
        afficherCockpit();
      };
    };
  }

  // ---------- Cockpit : magasins affichés (mémorisé par périmètre, sur cet ordinateur) ----------
  const cleSel = id => 'ckSel:' + ((Store.cloud() && Store.profil() && Store.profil().email) || 'local') + ':' + id;
  function selCockpit(id) { try { return new Set(JSON.parse(localStorage.getItem(cleSel(id)) || '[]')); } catch (e) { return new Set(); } }
  function ecrireSel(id, set) { if (set.size) localStorage.setItem(cleSel(id), JSON.stringify([...set])); else localStorage.removeItem(cleSel(id)); }
  function magsPerim(p) { return p.filtre ? S.ref.filter(r => r.actif === 'Oui' && p.filtre(r) && CK.photo && CK.photo.magasins[String(r.code)]) : []; }
  function majBoutonSel(p, exclus) {
    const mags = magsPerim(p), b = $('#ck-sel-btn');
    b.hidden = !mags.length; if (!mags.length) { $('#ck-sel').hidden = true; return; }
    const n = mags.filter(r => !exclus.has(String(r.code))).length;
    b.textContent = `Magasins affichés (${n} / ${mags.length})`; b.classList.toggle('primaire', n < mags.length);
    if (!$('#ck-sel').hidden) remplirSel(p, exclus);
  }
  function remplirSel(p, exclus) {
    const grp = p.sousTotal || p.regrouper || (r => r.pays === 'FRANCE' ? (r.ar || 'France') : r.pays);
    const groupes = {}; magsPerim(p).forEach(r => { const g = grp(r) || '–'; (groupes[g] = groupes[g] || []).push(r); });
    $('#ck-sel-liste').innerHTML = Object.keys(groupes).sort().map(g => {
      const l = groupes[g].sort((x, y) => String(x.magasin).localeCompare(String(y.magasin))), tous = l.every(r => !exclus.has(String(r.code)));
      return `<fieldset><legend><label><input type="checkbox" data-groupe="${esc(g)}"${tous ? ' checked' : ''}> ${esc(g)} (${l.length})</label></legend>` +
        l.map(r => `<label><input type="checkbox" data-code="${esc(r.code)}"${exclus.has(String(r.code)) ? '' : ' checked'}> ${esc(r.code)} ${esc(r.magasin)}</label>`).join('') + '</fieldset>';
    }).join('');
    $('#ck-sel-liste').onchange = e => {
      const ex = selCockpit(p.id), i = e.target;
      if (i.dataset.groupe != null) groupes[i.dataset.groupe].forEach(r => i.checked ? ex.delete(String(r.code)) : ex.add(String(r.code)));
      else if (i.dataset.code) i.checked ? ex.delete(i.dataset.code) : ex.add(i.dataset.code);
      ecrireSel(p.id, ex); afficherCockpit();
    };
  }
  function brancherSelCockpit() {
    $('#ck-sel-btn').onclick = () => { const p = CK.perims.find(x => x.id === $('#ck-perim').value); $('#ck-sel').hidden = !$('#ck-sel').hidden; if (!$('#ck-sel').hidden && p) remplirSel(p, selCockpit(p.id)); };
    $('#ck-sel-tout').onclick = e => { e.preventDefault(); const id = $('#ck-perim').value; ecrireSel(id, new Set()); afficherCockpit(); };
  }

  // ---------- Récupération des pièces jointes dans Zimbra (administrateurs, mode Cloudflare) ----------
  // Cosium : tous les ZIP de la fenêtre sont téléchargés, puis on garde, par serveur et par mail (n/4),
  // le plus récent dont les exports se terminent bien sur le mois traité (période lue dans les CSV).
  async function recupererZimbra() {
    const annee = +$('#imp-annee').value, mois = +$('#imp-mois').value, k = `${annee}-${pad(mois)}`, info = t => { $('#zimbra-info').textContent = t; };
    $('#btn-zimbra').disabled = true;
    try {
      info('Recherche des mails…');
      const r = await Store.api('/zimbra/pieces?mois=' + k); const d = await r.json();
      if (!r.ok) throw new Error(d.erreur || 'recherche impossible');
      const pieces = d.pieces.sort((x, y) => y.date - x.date);
      if (!pieces.length) { info(`Aucune pièce jointe utile trouvée pour ${MOIS[mois - 1]} ${annee}.`); return; }
      const telecharger = async p => { const x = await Store.api(`/zimbra/piece?id=${encodeURIComponent(p.id)}&part=${encodeURIComponent(p.part)}`); if (!x.ok) throw new Error('téléchargement de ' + p.nom); return new File([await x.blob()], p.nom, { lastModified: p.date }); };
      const gardes = [], bilan = [];
      // Cosium
      const cos = pieces.filter(p => p.type === 'cosium'), parCle = {}, rejets = [];
      for (let i = 0; i < cos.length; i++) {
        const p = cos[i]; info(`Cosium : ${i + 1} / ${cos.length} – ${p.nom}`);
        const f = await telecharger(p), srv = Cosium.serverFromZipName(p.nom);
        let ok = false;
        try { const z = await JSZip.loadAsync(await f.arrayBuffer());
          for (const e of Object.values(z.files)) { if (e.dir || !/\.csv$/i.test(e.name)) continue;
            const pr = Cosium.identify(e.name.split('/').pop()); // la période est dans le nom du fichier
            if (pr.period && pr.period.month === mois && (pr.period.year === annee || pr.period.year === annee - 1)) { ok = true; break; } }
        } catch (e) { console.warn(p.nom, e); }
        const nMail = srv.mail || +((p.sujet || '').match(/OPTI\d+\s*(\d)\s*\/\s*4/i) || p.nom.match(/OPTI\d+[\s_-]*(\d)\s*[\/_-]?\s*4\b/i) || [])[1] || '?';
        const cle = (srv.server || p.nom) + ' ' + nMail + '/4';
        if (ok && !parCle[cle]) parCle[cle] = f; // le plus récent valide (liste triée par date décroissante)
        if (!ok) rejets.push(p.nom);
      }
      gardes.push(...Object.values(parCle));
      const serveurs = ['EURO', 'CANADA', 'IRLANDE', 'SUISSE', 'UK', 'MARTINIQUE', 'ISRAEL'];
      const manquants = serveurs.flatMap(s => [1, 2, 3, 4].map(n => `${s} ${n}/4`)).filter(c => !parCle[c]);
      bilan.push(`Cosium : ${Object.keys(parCle).length} / 28` + (manquants.length ? ` (manque ${manquants.length > 8 ? manquants.length + ' envois' : manquants.join(', ')})` : ' ✓')
        + ` – ${cos.length} ZIP Cosium trouvé(s) dans la boîte` + (rejets.length ? `, ${rejets.length} écarté(s) car d'un autre mois (ex. ${rejets.slice(0, 2).join(' ; ')})` : ''));
      console.info('Zimbra – pièces trouvées', pieces);
      // Confidence : fichier dont la période se termine dans le mois traité
      const conf = pieces.filter(p => p.type === 'confidence' && (p.nom.match(/_(\d{4})-(\d{2})-\d{2}\.xlsx$/i) || []).slice(1).join('-') === k);
      if (conf.length) { info('Confidence…'); gardes.push(await telecharger(conf[0])); bilan.push('Confidence ✓'); } else bilan.push('Confidence : pas encore reçu');
      // Restes dus : classeur contenant l'onglet « Données Restes Dus »
      let restes = false;
      // Restes dus : pas de période lisible dans le fichier → seuls les envois reçus à partir du 1er du mois suivant comptent
      const debutSuivant = Date.UTC(annee, mois, 1) - 2 * 3600e3;
      for (const p of pieces.filter(p => p.type === 'restes' && p.date >= debutSuivant)) {
        info('Restes dus…'); const f = await telecharger(p);
        try { const wb = XLSX.read(await f.arrayBuffer(), { type: 'array', bookSheets: true }); if (wb.SheetNames.some(s => /^Donn.es Restes Dus/i.test(s))) { gardes.push(f); restes = true; break; } } catch (e) {}
      }
      bilan.push(restes ? 'Restes dus ✓' : 'Restes dus : pas encore reçu');
      ajouterFichiers(gardes);
      info(`${MOIS[mois - 1]} ${annee} – ` + bilan.join(' · '));
    } catch (e) { info('Erreur : ' + e.message); }
    finally { $('#btn-zimbra').disabled = false; }
  }

  // ---------- Accueil ----------
  // Dates d'arrivée habituelles (jour du mois suivant) ; null = pas de date fixe
  const ATTENDU_LE = { cosium_n: 1, cosium_n1: 1, stat_indiv: 1, confidence: 5, restes_dus: 7, avoirs: 5, site: 1, lyleoo: 5, ocm: 5 };
  const A = { photos: {} };
  async function photoMois(k) { if (!k) return null; if (!(k in A.photos)) A.photos[k] = await Store.lireJSON(`donnees/${k}/photo.json`); return A.photos[k]; }
  const moisPrec = k => { let [a, m] = k.split('-').map(Number); m--; if (!m) { m = 12; a--; } return `${a}-${pad(m)}`; };
  async function afficherAccueil() {
    const admin = !Store.cloud() || Store.estAdmin();
    // 1. Où en est le mois (administrateurs) : mois traité = mois précédent
    $('#carte-mois').hidden = !admin;
    if (admin) {
      const now = new Date(), d = new Date(now.getFullYear(), now.getMonth() - 1, 1), k = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
      const ph = await photoMois(k), jour = now.getDate();
      $('#am-titre').textContent = `${MOIS[d.getMonth()]} ${d.getFullYear()}`;
      const sources = (ph && ph.sources) || {}, lib = Pipeline.LIBELLE_SOURCE;
      let nRecu = 0, nRetard = 0;
      $('#am-sources').innerHTML = Object.keys(lib).filter(s => s !== 'sante' && s !== 'bilans').map(s => {
        const st = sources[s] && sources[s].statut; let cl = st || 'absent', note = '';
        if (st === 'recu') { nRecu++; note = 'reçu'; }
        else if (st === 'repris') note = 'repris du mois précédent';
        else if (ATTENDU_LE[s] && jour > ATTENDU_LE[s]) { cl = 'retard'; nRetard++; note = `attendu le ${ATTENDU_LE[s]}`; }
        else note = ATTENDU_LE[s] ? `attendu le ${ATTENDU_LE[s]}` : 'à recevoir';
        return `<div class="${cl}"><span class="pastille"></span>${esc(lib[s])}<small>${esc(note)}</small></div>`;
      }).join('');
      $('#am-resume').textContent = ph ? `Mois calculé le ${new Date(ph.genereLe).toLocaleDateString('fr-FR')} · ${nRecu} source(s) reçue(s)` + (nRetard ? ` · ${nRetard} en retard` : '') : `Pas encore calculé` + (nRetard ? ` · ${nRetard} source(s) attendue(s) en retard` : '');
      $('#am-import').onclick = () => { $('#imp-mois').value = d.getMonth() + 1; $('#imp-annee').value = d.getFullYear(); vue('import'); };
    }
    // 2. Ce qui bouge
    const pays = [...new Set(S.ref.filter(r => r.actif === 'Oui').map(r => r.pays))].sort();
    if ($('#cb-pays').options.length <= 1) $('#cb-pays').innerHTML = '<option value="">Tous les pays</option>' + pays.map(p => `<option>${esc(p)}</option>`).join('');
    ['#cb-mode', '#cb-pays', '#cb-type'].forEach(id => $(id).onchange = ceQuiBouge);
    await ceQuiBouge();
  }
  async function ceQuiBouge() {
    const k = (S.moisDispo || [])[0];
    if (!k) { $('#cb-info').textContent = 'Aucun mois enregistré.'; $('#cb-haut').innerHTML = $('#cb-bas').innerHTML = ''; return; }
    const ph = await photoMois(k), mode = $('#cb-mode').value, pays = $('#cb-pays').value, type = $('#cb-type').value;
    const prec = mode === 'mois' ? await photoMois(moisPrec(k)) : null;
    const posit = (d, m) => { const n = (d && d.N) || {}; return n.O && n.P != null ? n.P * 12 / m / (n.O * 1000) : null; };
    const lignes = [];
    for (const r of S.ref) {
      if (r.actif !== 'Oui' || (pays && r.pays !== pays) || (type && r.type !== type)) continue;
      const d = ph.magasins[String(r.code)]; if (!d || !d.N || !d.N.P) continue;
      let v = null, aff = '';
      if (mode === 'n1') { const p1 = d.N1 && d.N1.P; if (p1 > 0) { v = d.N.P / p1 - 1; aff = (v > 0 ? '+' : '') + (v * 100).toFixed(1).replace('.', ',') + ' %'; } }
      else if (prec) { const a = posit(d, ph.mois), b = posit(prec.magasins[String(r.code)], prec.mois); if (a != null && b != null) { v = a - b; aff = (v > 0 ? '+' : '') + (v * 100).toFixed(1).replace('.', ',') + ' pt'; } }
      if (v != null && isFinite(v)) lignes.push({ r, v, aff });
    }
    const libMois = `${MOIS[ph.mois - 1]} ${ph.annee}`;
    if (mode === 'mois' && !prec) { $('#cb-info').textContent = `Le mois précédent (${MOIS[+moisPrec(k).slice(5) - 1]}) n'est pas encore enregistré : la comparaison mois par mois sera disponible dès le prochain mois calculé.`; $('#cb-haut').innerHTML = $('#cb-bas').innerHTML = ''; return; }
    $('#cb-info').textContent = mode === 'n1' ? `${libMois} : évolution du CA cumulé depuis janvier par rapport à la même période l'an dernier · ${lignes.length} magasins comparés.` : `${libMois} : variation du positionnement (CA projeté / objectif) depuis le mois précédent · ${lignes.length} magasins comparés.`;
    lignes.sort((x, y) => y.v - x.v);
    const rendu = l => l.map(x => `<div class="cb-ligne" data-code="${esc(x.r.code)}"><b>${esc(x.r.code)}</b> ${esc(x.r.magasin)} <small>${esc(x.r.pays === 'FRANCE' ? (x.r.ar || '') : x.r.pays)}</small><span class="v" style="color:${x.v >= 0 ? '#2E9E5B' : 'var(--accent)'}">${x.aff}</span></div>`).join('') || '<p class="muted">–</p>';
    $('#cb-haut').innerHTML = rendu(lignes.filter(x => x.v > 0).slice(0, 10));
    $('#cb-bas').innerHTML = rendu(lignes.filter(x => x.v < 0).reverse().slice(0, 10));
    document.querySelectorAll('#vue-accueil .cb-ligne').forEach(l => l.onclick = () => ouvrirFiche(l.dataset.code));
  }
  // Ouvre la fiche d'un magasin depuis n'importe quel écran
  async function ouvrirFiche(code) {
    const m = S.ref.find(r => String(r.code) === String(code)); if (!m) return;
    const bFiches = document.querySelector('.app-head nav button[data-vue="fiches"]');
    if (bFiches && bFiches.hidden) return;
    vue('fiches'); S.magSel = m; $('#fi-recherche').value = ''; listerMagasins(); afficherFiche(m);
  }
  // ---------- Recherche rapide (en-tête) ----------
  function brancherRecherche() {
    if (S.rechercheBranchee) return; S.rechercheBranchee = true;
    const q = $('#rg-q'), res = $('#rg-res'); let sel = 0, l = [];
    const montrer = () => {
      const t = norm(q.value.trim()); if (t.length < 2) { res.hidden = true; return; }
      l = S.ref.filter(r => r.actif === 'Oui' && norm(`${r.code} ${r.magasin} ${r.manager} ${r.ar} ${r.groupe} ${r.pays}`).includes(t)).slice(0, 12); sel = 0;
      res.innerHTML = l.map((r, i) => `<div data-code="${esc(r.code)}" class="${i === sel ? 'sel' : ''}"><b>${esc(r.code)}</b> ${esc(r.magasin)}<small>${esc([r.manager, r.pays === 'FRANCE' ? r.ar : r.pays, r.type === 'Franchise' ? r.groupe : ''].filter(Boolean).join(' · '))}</small></div>`).join('') || '<div class="muted">Aucun magasin</div>';
      res.hidden = false;
      res.querySelectorAll('div[data-code]').forEach(d => d.onmousedown = e => { e.preventDefault(); choisir(d.dataset.code); });
    };
    const choisir = code => { res.hidden = true; q.value = ''; q.blur(); ouvrirFiche(code); };
    q.oninput = montrer; q.onfocus = montrer; q.onblur = () => setTimeout(() => { res.hidden = true; }, 150);
    q.onkeydown = e => {
      if (res.hidden || !l.length) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + l.length) % l.length; res.querySelectorAll('div[data-code]').forEach((d, i) => d.classList.toggle('sel', i === sel)); }
      if (e.key === 'Enter') { e.preventDefault(); choisir(l[sel].code); }
      if (e.key === 'Escape') res.hidden = true;
    };
    document.addEventListener('keydown', e => { if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') { e.preventDefault(); q.focus(); } });
  }

  // ---------- Accès des équipes (administrateurs, mode Cloudflare) ----------
  const AC = { liste: [] };
  const listeCodes = s => String(s || '').split(/[,;\s]+/).map(x => x.trim().replace(/^0+/, '')).filter(Boolean);
  const libTypes = p => (p.types && p.types.length === 1) ? (p.types[0] === 'Franchise' ? 'Franchises uniquement' : 'Succursales uniquement') : '';
  function resumePerim(p) {
    p = p || {};
    if (p.tous) return ['Tout le réseau', libTypes(p)].filter(Boolean).join(' · ');
    const morceaux = [libTypes(p)].filter(Boolean);
    if (p.pays && p.pays.length) morceaux.push(p.pays.join(', '));
    if (p.ar && p.ar.length) morceaux.push('AR : ' + p.ar.join(', '));
    if (p.groupes && p.groupes.length) morceaux.push('Groupes : ' + p.groupes.join(', '));
    if (p.codes && p.codes.length) morceaux.push('+ ' + p.codes.join(', '));

    if (p.exclureCodes && p.exclureCodes.length) morceaux.push('sauf ' + p.exclureCodes.join(', '));
    return morceaux.join(' · ') || 'Aucun magasin';
  }
  // Même règle que le Worker (worker/src/index.js › codesAutorises), pour l'aperçu
  function nbMagasins(p) {
    const n = x => String(x == null ? '' : x).normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
    const dans = (l, v) => Array.isArray(l) && l.some(x => n(x) === n(v));
    return S.ref.filter(m => { let ok = !!p.tous || dans(p.codes, m.code) || dans(p.pays, m.pays) || dans(p.groupes, m.groupe) || dans(p.ar, m.ar); if (Array.isArray(p.types) && p.types.length && !dans(p.types, m.type) && !dans(p.codes, m.code)) ok = false; if (dans(p.exclurePays, m.pays) || dans(p.exclureCodes, m.code)) ok = false; return ok && m.actif === 'Oui'; }).length;
  }
  function cases(id, valeurs, cochees) { $(id).innerHTML = valeurs.map(v => `<label><input type="checkbox" value="${esc(v)}"${cochees.includes(v) ? ' checked' : ''}> ${esc(v)}</label>`).join(''); }
  const coches = id => [...document.querySelectorAll(id + ' input:checked')].map(i => i.value);
  function lirePerimForm() {
    const t = [...document.querySelectorAll('.ac-type:checked')].map(c => c.value);
    const types = t.length === 1 ? t : undefined; // les deux cochés = pas de restriction
    if ($('#ac-tous').checked) return { tous: true, types, exclureCodes: listeCodes($('#ac-exclure-codes').value) };
    return { pays: coches('#ac-pays'), ar: coches('#ac-ar'), groupes: coches('#ac-groupes'), codes: listeCodes($('#ac-codes').value), types, exclureCodes: listeCodes($('#ac-exclure-codes').value) };
  }
  function majApercu() {
    if (!document.querySelectorAll('.ac-type:checked').length) { $('#ac-apercu').textContent = 'Cochez au moins un type de magasins'; return; }
    $('#ac-perim').querySelectorAll('.chk, label').forEach(x => { if (x.closest('.grille2')) return; x.hidden = $('#ac-tous').checked; }); $('#ac-apercu').textContent = `Périmètre : ${resumePerim(lirePerimForm())} — ${nbMagasins(lirePerimForm())} magasin(s) actif(s)`; }
  function ouvrirForm(u) {
    u = u || { email: '', nom: '', perimetre: {}, ecrans: ['fiches', 'cockpits'], actif: 1 };
    const p = u.perimetre || {}, uniq = k => [...new Set(S.ref.map(m => m[k]).filter(Boolean))].sort((x, y) => x.localeCompare(y));
    $('#ac-email').value = u.email; $('#ac-email').disabled = !!u.email; $('#ac-nom').value = u.nom || '';
    $('#ac-tous').checked = !!p.tous;
    cases('#ac-pays', uniq('pays'), p.pays || []);
    document.querySelectorAll('.ac-type').forEach(c => c.checked = !(p.types && p.types.length) || p.types.includes(c.value));
    cases('#ac-ar', uniq('ar'), p.ar || []); cases('#ac-groupes', uniq('groupe').filter(g => !/^optical center$/i.test(g)), p.groupes || []);
    $('#ac-codes').value = (p.codes || []).join(', '); $('#ac-exclure-codes').value = (p.exclureCodes || []).join(', ');
    document.querySelectorAll('.ac-ecran').forEach(c => c.checked = !u.ecrans || u.ecrans.includes(c.value));
    $('#ac-actif').checked = u.actif !== 0 && u.actif !== false; $('#ac-info').textContent = '';
    $('#acces-form').hidden = false; majApercu(); $('#acces-form').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  async function chargerAcces() {
    try {
      const r = await Store.api('/admin/utilisateurs'); AC.liste = (await r.json()).utilisateurs || [];
      $('#acces-liste').innerHTML = AC.liste.length ? `<table><tr><th>Personne</th><th>Périmètre</th><th>Écrans</th><th></th></tr>` + AC.liste.map((u, i) => `<tr class="${u.actif ? '' : 'inactif'}"><td><b>${esc(u.nom || '')}</b><br>${esc(u.email)}</td><td>${esc(resumePerim(u.perimetre))}<br><span class="muted">${nbMagasins(u.perimetre || {})} magasin(s)</span></td><td>${esc((u.ecrans || ['fiches', 'cockpits']).join(', '))}</td><td><a href="#" data-i="${i}">Modifier</a></td></tr>`).join('') + '</table>' : '<p class="muted">Aucun compte pour l’instant (en dehors des administrateurs).</p>';
      document.querySelectorAll('#acces-liste a[data-i]').forEach(l => l.onclick = e => { e.preventDefault(); ouvrirForm(AC.liste[+l.dataset.i]); });
      const j = await (await Store.api('/admin/connexions')).json();
      const lib = { ok: 'connecté', 'refus-zimbra': 'mot de passe refusé', 'non-autorise': 'sans accès' };
      $('#acces-journal').innerHTML = '<table><tr><th>Date</th><th>Adresse</th><th>Résultat</th></tr>' + (j.connexions || []).slice(0, 50).map(c => `<tr><td>${esc(new Date(c.le).toLocaleString('fr-FR'))}</td><td>${esc(c.email)}</td><td>${esc(lib[c.resultat] || c.resultat)}</td></tr>`).join('') + '</table>';
    } catch (e) { $('#acces-liste').innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
  }
  function brancherAcces() {
    $('#btn-acces-nouveau').onclick = () => ouvrirForm();
    $('#btn-acces-annuler').onclick = () => { $('#acces-form').hidden = true; };
    $('#acces-form').oninput = majApercu; $('#acces-form').onchange = majApercu;
    $('#btn-acces-enregistrer').onclick = async () => {
      const email = $('#ac-email').value.trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { $('#ac-info').textContent = 'Adresse e-mail invalide'; return; }
      const perimetre = lirePerimForm(), ecrans = [...document.querySelectorAll('.ac-ecran:checked')].map(c => c.value);
      if (!ecrans.length) { $('#ac-info').textContent = 'Cochez au moins un écran'; return; }
      if (!perimetre.tous && !nbMagasins(perimetre)) { $('#ac-info').textContent = 'Ce périmètre ne contient aucun magasin'; return; }
      $('#ac-info').textContent = 'Enregistrement…';
      const r = await Store.api('/admin/utilisateurs', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, nom: $('#ac-nom').value.trim(), role: 'lecteur', perimetre, ecrans, actif: $('#ac-actif').checked }) });
      if (!r.ok) { $('#ac-info').textContent = 'Échec de l’enregistrement'; return; }
      $('#acces-form').hidden = true; await chargerAcces();
    };
    chargerAcces();
  }

  // ---------- Utilitaires ----------
  function telecharger(blob, nom) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nom; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function norm(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }

  window.App = { afficherCockpit, CK, S, dossierPret, ajouterFichiers, calculer, enregistrer, chargerPhoto, afficherFiche, pdfMagasin, lireRefXlsx, lireObjXlsx };
  init();
})();
