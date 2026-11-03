/* Interface : import mensuel, fiches magasins, réglages. */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const MOIS = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
  const pad = m => String(m).padStart(2, '0');
  const S = { ref: [], objectifs: {}, spec: null, trad: null, regles: null, fichiers: [], resultat: null, photo: null, listesConf: null, magSel: null };

  // Libellés Excel ↔ clés internes
  const REF_COLS = { 'Code site': 'code', 'Magasin': 'magasin', 'Type': 'type', 'Groupe': 'groupe', 'Date ouverture': 'ouverture', 'Pays': 'pays', 'Nature': 'nature', 'AR': 'ar', 'Langue': 'langue', 'Devise': 'devise', 'Serveur Cosium': 'serveur', 'Manager': 'manager', 'Nom Lyleoo': 'lyleoo', 'E-mail magasin': 'email', 'Actif': 'actif' };
  const OBJ_COLS = { 'Type': 'type', 'Clé (pays ou franchisé)': 'cle', 'PM 1ère paire': 'pm1', '% Unif individualisés': 'unifIndiv', '% Anti-reflet HG': 'arHG', '% Transition': 'transition', '% SOP': 'sop', 'Nb Lyleoo': 'lyleoo', '% Pack confort': 'pcPct', '€ Pack confort': 'pcEur', '% Taux de concrétisation': 'tc', 'Panier moyen': 'panier', '% MdC': 'mdc', 'Devise': 'devise', 'Prix moyen prothèse': 'pmProthese', '% Garantie audio': 'garantieAudio', '% Ventes additionnelles': 'ventesAdd', '% TC audio': 'tcAudio', 'Durée moyenne d’essai': 'dureeEssai', '% Dépistage': 'depistage', 'PM vente audio': 'pmVente', '% Ouiezen premium': 'ouiezen' };

  // ---------- Démarrage ----------
  async function init() {
    [S.spec, S.trad, S.regles] = await Promise.all(['data/hub_spec_cosium.json', 'data/traductions.json', 'data/regles.json'].map(u => fetch(u).then(r => r.json())));
    const now = new Date(); const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    $('#imp-mois').innerHTML = MOIS.map((m, i) => `<option value="${i + 1}">${m}</option>`).join(''); $('#imp-mois').value = prev.getMonth() + 1;
    $('#imp-annee').innerHTML = [0, 1, 2].map(k => `<option>${now.getFullYear() - k}</option>`).join(''); $('#imp-annee').value = prev.getFullYear();
    document.querySelectorAll('.app-head nav button').forEach(b => b.onclick = () => vue(b.dataset.vue));
    brancherImport(); brancherFiches(); brancherReglages(); brancherCockpits();
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
          (nb, nom) => confirm(`Copier ${nb} fichier(s) du dossier « ${nom} » vers Cloudflare ?`));
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
    $('#pied-stockage').textContent = 'Données stockées sur Cloudflare, accès par connexion personnelle.';
    // Lecteurs : ni import ni réglages ; écrans éventuellement limités par leur profil
    document.querySelectorAll('.app-head nav button').forEach(b => {
      const v = b.dataset.vue; let ok = admin || (v !== 'import' && v !== 'reglages');
      if (!admin && v !== 'accueil' && Array.isArray(p.ecrans) && p.ecrans.length) ok = ok && p.ecrans.includes(v);
      b.hidden = !ok;
    });
    $('#carte-cloud').hidden = !admin; $('#carte-acces').hidden = !admin; $('#zone-zimbra').hidden = !admin;
    await dossierPret();
    $('#etat-dossier').textContent = '☁️ ' + (p.nom || p.email);
    if (admin) brancherAcces();
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
  function vue(v) { if (v === 'cockpits' && !$('#ck-apercu .cockpit')) setTimeout(afficherCockpit, 0); document.querySelectorAll('.vue').forEach(x => x.classList.toggle('actif', x.id === 'vue-' + v)); document.querySelectorAll('.app-head nav button').forEach(b => b.classList.toggle('actif', b.dataset.vue === v)); }

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
  async function workerRatings() {
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
    const { url, cle } = paramsWorker();
    if (!url || !cle) return null;
    const ses = sessionSante(); if (!ses) return { erreur: 'session' };
    try {
      const r = await fetch(url.replace(/\/$/, '') + '/sante-mensuel?mois=' + annee + '-' + pad(mois), { headers: { 'X-Store-Token': cle, 'X-AR-Session': ses.token } });
      const d = await r.json(); if (!d.ok) return { erreur: d.error || ('HTTP ' + r.status) };
      const out = {}; (d.magasins || []).forEach(m => { out[String(m.code)] = { score: m.score, precedent: m.scorePrecedent, couverture: m.couverture, sous: m.sous || {}, exclusions: m.exclusions || {}, neutralisations: m.neutralisations || {} }; });
      return { magasins: out, apercu: !!d.apercu, statut: d.statut, version: d.version, dims: d.dims };
    } catch (e) { return { erreur: String(e) }; }
  }
  // Dernier bilan de passage de chaque magasin avant la fin du mois traité (actions à suivre)
  async function bilansWorker(annee, mois) {
    const { url, cle } = paramsWorker(); if (!url || !cle) return null;
    const ses = sessionSante(); if (!ses) return { erreur: 'session' };
    const fin = Pipeline.finMois(annee, mois), d = new Date(annee, mois - 7, 1), debut = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;
    try {
      const r = await fetch(url.replace(/\/$/, '') + `/bilans?light=1&from=${debut}&to=${fin}&limit=1000`, { headers: { 'X-Store-Token': cle, 'X-AR-Session': ses.token } });
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
      const res = await Pipeline.construire({ fichiers: S.fichiers, pastes: { lyleoo: $('#paste-lyleoo').value, ocm: $('#paste-ocm').value, site: $('#paste-site').value },
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
    A.photos = {};
    await Store.ecrireJSON(`donnees/${photo.annee}/etat.json`, etatAnnee);
    for (const f of S.fichiers) await Store.ecrire(`donnees/${k}/imports/${f.name.replace(/^[0-9a-f]{8}-/, '')}`, f);
    for (const p of ['lyleoo', 'ocm', 'site']) { const v = $('#paste-' + p).value; if (v.trim()) await Store.ecrire(`donnees/${k}/imports/copier-coller-${p}.txt`, v); }
    $('#calc-info').textContent = `Photo de ${MOIS[photo.mois - 1]} ${photo.annee} enregistrée.`; $('#btn-enregistrer').disabled = true;
    await listerPhotos(); $('#fi-photo').value = k; await chargerPhoto(k); afficherAccueil();
  }

  // ---------- Fiches ----------
  function brancherFiches() {
    $('#fi-photo').onchange = e => chargerPhoto(e.target.value);
    ['#fi-recherche', '#fi-filtre-pays', '#fi-filtre-type'].forEach(s => $(s).oninput = listerMagasins);
    $('#fi-langue').onchange = () => S.magSel && afficherFiche(S.magSel);
    $('#btn-pdf-un').onclick = async () => { if (!S.magSel) return; const m = S.magSel; const b = await pdfMagasin(m); telecharger(b, nomPdf(m)); };
    $('#btn-pdf-tous').onclick = pdfSelection;
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
    const pays = [...new Set(S.ref.map(r => r.pays))].sort();
    $('#fi-filtre-pays').innerHTML = '<option value="">Tous les pays</option>' + pays.map(p => `<option>${p}</option>`).join('');
    listerMagasins();
  }
  function selection() {
    if (!S.photo) return [];
    const q = norm($('#fi-recherche').value), p = $('#fi-filtre-pays').value, t = $('#fi-filtre-type').value;
    return S.ref.filter(r => r.actif === 'Oui' && S.photo.magasins[String(r.code)] && (!p || r.pays === p) && (!t || r.type === t)
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
  function ajuster(hote) {
    hote.querySelectorAll('.fiche').forEach(f => {
      const tb = f.querySelector('table.equipe');
      if (tb && f.scrollHeight > f.clientHeight + 1) tb.classList.add('dense');
      if (tb && f.scrollHeight > f.clientHeight + 1) tb.classList.add('tres-dense');
      if (f.scrollHeight > f.clientHeight + 1) f.classList.add('serre');
      if (f.scrollHeight > f.clientHeight + 1) f.classList.add('tres-serre');
    });
  }
  function afficherFiche(m) {
    $('#apercu').innerHTML = langues(m).map(l => Fiche.rendre(S.photo, m, S.objectifs, S.trad, { langue: l })).join('');
    ajuster($('#apercu'));
  }
  const nomPdf = m => `${m.code} - ${String(m.magasin).replace(/[\\/:*?"<>|]/g, '-')} - ${S.photo.annee}-${pad(S.photo.mois)}.pdf`;
  async function pdfMagasin(m) {
    const { jsPDF } = window.jspdf; const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const hote = document.createElement('div'); hote.style.cssText = 'position:fixed;left:-10000px;top:0'; document.body.appendChild(hote);
    const ls = langues(m);
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    let n = 0;
    for (let i = 0; i < ls.length; i++) {
      hote.innerHTML = Fiche.rendre(S.photo, m, S.objectifs, S.trad, { langue: ls[i] });
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
    const md = Cockpit.construire(CK.photo, S.ref, p, th, { tri, objectifs: S.objectifs, taux: await tauxChange(), siege });
    const triLib = $('#ck-tri').selectedOptions[0].textContent.replace('Tri : ', '');
    const poser = (h, pages) => { $('#ck-apercu').innerHTML = `<div class="ck-echelle">${Cockpit.rendre(md, { triLib, hListe: h, pages })}</div>`; return [...$('#ck-apercu').querySelectorAll('.cockpit')]; };
    let pages = poser(640, 1), page = pages[0];
    // Hauteur réellement disponible pour la liste, puis second rendu calé dessus
    const blocs = page.querySelector('.ck-blocs');
    let hL = 640;
    if (blocs && md.type === 'multi') { const h = blocs.clientHeight; if (h > 100) { hL = h; pages = poser(h, 1); } }
    else if (blocs) { const th = blocs.querySelector('thead'); const h = blocs.clientHeight - (th ? th.offsetHeight : 0) - 4; if (h > 100) pages = poser(h, 1); }
    let ok = pages.every(ajusterCockpit);
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
    const a = $('#imp-annee').value, LIB = { groupe: 'Groupe (€)', siteFrance: 'Site France (€)', siteIsrael: 'Site Israël (₪)', siteUK: 'Site UK (£)', siteCanada: 'Site Canada ($CA)', mobileSucc: 'OC Mobile succ. (€)', mobileFranchise: 'OC Mobile franch. (€)', mdc: 'Taux de MdC (ex. 0,66)' };
    const o = Object.assign({}, Cockpit.SIEGE_DEFAUT, (await Store.lireJSON(`config/objectifs-siege-${a}.json`)) || {});
    $('#siege-champs').innerHTML = Object.keys(LIB).map(k => `<label class="muted">${LIB[k]} <input data-k="${k}" type="number" step="any" value="${o[k]}" style="width:120px"></label>`).join('');
    $('#btn-siege').onclick = async () => { const x = {}; document.querySelectorAll('#siege-champs input').forEach(i => x[i.dataset.k] = +i.value); await Store.ecrireJSON(`config/objectifs-siege-${$('#imp-annee').value}.json`, x); $('#siege-info').textContent = 'Enregistré pour ' + $('#imp-annee').value; CK.cle = null; };
  }
  async function brancherTaux() {
    const t = await tauxChange();
    $('#taux-champs').innerHTML = Object.keys(Cockpit.TAUX_DEFAUT).filter(d => d !== 'Euro').map(d => `<label class="muted">${esc(Cockpit.DEVISE_SYM[d] || d)} <input data-dev="${esc(d)}" type="number" step="0.0001" value="${t[d]}" style="width:90px"></label>`).join('');
    $('#btn-taux').onclick = async () => { const o = {}; document.querySelectorAll('#taux-champs input').forEach(i => o[i.dataset.dev] = +i.value); await Store.ecrireJSON('config/taux-change.json', o); $('#taux-info').textContent = 'Enregistré'; };
  }
  function brancherReglages() {
    $('#inp-ref').onchange = async e => { const f = e.target.files[0]; if (!f) return; S.ref = lireRefXlsx(await f.arrayBuffer()); await Store.ecrireJSON('config/referentiel.json', S.ref); await Store.ecrire('config/referentiel.xlsx', f); majInfosReglages(); listerMagasins(); };
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
      const cos = pieces.filter(p => p.type === 'cosium'), parCle = {};
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
      }
      gardes.push(...Object.values(parCle));
      const serveurs = ['EURO', 'CANADA', 'IRLANDE', 'SUISSE', 'UK', 'MARTINIQUE', 'ISRAEL'];
      const manquants = serveurs.flatMap(s => [1, 2, 3, 4].map(n => `${s} ${n}/4`)).filter(c => !parCle[c]);
      bilan.push(`Cosium : ${Object.keys(parCle).length} / 28` + (manquants.length ? ` (manque ${manquants.join(', ')})` : ' ✓'));
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
