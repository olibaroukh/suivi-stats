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
    brancherImport(); brancherFiches(); brancherReglages();
    $('#w-url').value = localStorage.getItem('workerUrl') || 'https://zimbra-relay.oli-baroukh.workers.dev';
    $('#w-cle').value = localStorage.getItem('workerCle') || '';
    if (!Store.supporte()) { $('#etat-dossier').textContent = 'Navigateur non compatible : utiliser Chrome'; }
    const r = await Store.restaurer();
    if (r && r.permission === 'granted') await dossierPret(); else { $('#carte-dossier-requis').hidden = false; if (r) { $('#btn-autoriser').hidden = false; $('#btn-dossier').textContent = 'Choisir un autre dossier…'; } }
    $('#btn-dossier').onclick = async () => { await Store.choisirDossier(); await dossierPret(); };
    $('#btn-autoriser').onclick = async () => { if (await Store.autoriser()) await dossierPret(); };
  }
  async function dossierPret() {
    $('#carte-dossier-requis').hidden = true;
    $('#etat-dossier').textContent = '📁 ' + (Store.nomDossier() || 'mémoire (non enregistré)');
    S.ref = (await Store.lireJSON('config/referentiel.json')) || [];
    S.objectifs = (await Store.lireJSON(`config/objectifs-${$('#imp-annee').value}.json`)) || (await Store.lireJSON('config/objectifs.json')) || {};
    majInfosReglages(); await listerPhotos();
  }
  function vue(v) { document.querySelectorAll('.vue').forEach(x => x.classList.toggle('actif', x.id === 'vue-' + v)); document.querySelectorAll('.app-head nav button').forEach(b => b.classList.toggle('actif', b.dataset.vue === v)); }

  // ---------- Import ----------
  function brancherImport() {
    const dep = $('#depot');
    dep.ondragover = e => { e.preventDefault(); dep.classList.add('survol'); };
    dep.ondragleave = () => dep.classList.remove('survol');
    dep.ondrop = async e => { e.preventDefault(); dep.classList.remove('survol'); ajouterFichiers(await fichiersDepuisDrop(e.dataTransfer)); };
    $('#inp-fichiers').onchange = e => ajouterFichiers([...e.target.files]);
    $('#btn-calculer').onclick = calculer;
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
    const url = localStorage.getItem('workerUrl'), cle = localStorage.getItem('workerCle');
    if (!url || !cle) return null;
    try { const r = await fetch(url.replace(/\/$/, '') + '/google-ratings', { headers: { 'X-Store-Token': cle } }); const d = await r.json(); return d.ok ? { ratings: d.ratings } : null; }
    catch (e) { return { erreur: String(e) }; }
  }
  async function calculer() {
    if (!S.ref.length) { alert('Importe d’abord le référentiel magasins (onglet Réglages).'); vue('reglages'); return; }
    const annee = +$('#imp-annee').value, mois = +$('#imp-mois').value;
    $('#calc-info').textContent = 'Calcul en cours…'; $('#btn-calculer').disabled = true; $('#barre-calc').hidden = false; $('#barre-calc div').style.width = '30%';
    try {
      const etatAnnee = (await Store.lireJSON(`donnees/${annee}/etat.json`)) || {};
      const precedent = mois > 1 ? await Store.lireJSON(`donnees/${annee}-${pad(mois - 1)}/photo.json`) : null;
      let wr = await workerRatings(); const alerteW = wr && wr.erreur ? 'Worker avis Google injoignable : ' + wr.erreur : null; if (wr && wr.erreur) wr = null;
      const listes = S.listesConf || etatAnnee.listesConfidence || null;
      const res = await Pipeline.construire({ fichiers: S.fichiers, pastes: { lyleoo: $('#paste-lyleoo').value, ocm: $('#paste-ocm').value, site: $('#paste-site').value },
        annee, mois, ref: S.ref, spec: S.spec, etatAnnee, photoPrecedente: precedent, workerRatings: wr, listesConfidence: listes });
      if (alerteW) res.rapport.alertes.unshift(alerteW);
      res.etatAnnee.listesConfidence = listes;
      S.resultat = res; afficherRapport(res.rapport);
      $('#btn-enregistrer').disabled = false;
      $('#calc-info').textContent = `${MOIS[mois - 1]} ${annee} calculé – vérifie le rapport puis enregistre.`;
    } catch (e) { console.error(e); $('#calc-info').textContent = 'Erreur : ' + e.message; }
    $('#btn-calculer').disabled = false; $('#barre-calc div').style.width = '100%'; setTimeout(() => $('#barre-calc').hidden = true, 600);
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
    await Store.ecrireJSON(`donnees/${photo.annee}/etat.json`, etatAnnee);
    for (const f of S.fichiers) await Store.ecrire(`donnees/${k}/imports/${f.name.replace(/^[0-9a-f]{8}-/, '')}`, f);
    for (const p of ['lyleoo', 'ocm', 'site']) { const v = $('#paste-' + p).value; if (v.trim()) await Store.ecrire(`donnees/${k}/imports/copier-coller-${p}.txt`, v); }
    $('#calc-info').textContent = `Photo de ${MOIS[photo.mois - 1]} ${photo.annee} enregistrée.`; $('#btn-enregistrer').disabled = true;
    await listerPhotos(); $('#fi-photo').value = k; await chargerPhoto(k);
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
  function afficherFiche(m) {
    $('#apercu').innerHTML = langues(m).map(l => Fiche.rendre(S.photo, m, S.objectifs, S.trad, { langue: l })).join('<div style="height:14px"></div>');
  }
  const nomPdf = m => `${m.code} - ${String(m.magasin).replace(/[\\/:*?"<>|]/g, '-')} - ${S.photo.annee}-${pad(S.photo.mois)}.pdf`;
  async function pdfMagasin(m) {
    const { jsPDF } = window.jspdf; const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const hote = document.createElement('div'); hote.style.cssText = 'position:fixed;left:-10000px;top:0'; document.body.appendChild(hote);
    const ls = langues(m);
    for (let i = 0; i < ls.length; i++) {
      hote.innerHTML = Fiche.rendre(S.photo, m, S.objectifs, S.trad, { langue: ls[i] });
      const canvas = await html2canvas(hote.firstElementChild, { scale: 2, backgroundColor: '#ffffff', logging: false });
      if (i) doc.addPage();
      doc.addImage(canvas.toDataURL('image/jpeg', 0.9), 'JPEG', 0, 0, 210, 297);
    }
    hote.remove();
    return doc.output('blob');
  }
  async function pdfSelection() {
    const l = selection(); if (!l.length) return;
    if (!confirm(`Générer ${l.length} PDF dans le dossier sorties/${S.photo.annee}-${pad(S.photo.mois)}/fiches ?`)) return;
    const k = `${S.photo.annee}-${pad(S.photo.mois)}`; const envois = [['Code', 'Magasin', 'E-mail', 'Fichier']];
    const zip = Store.nomDossier() ? null : new JSZip();
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
  function brancherReglages() {
    $('#inp-ref').onchange = async e => { const f = e.target.files[0]; if (!f) return; S.ref = lireRefXlsx(await f.arrayBuffer()); await Store.ecrireJSON('config/referentiel.json', S.ref); await Store.ecrire('config/referentiel.xlsx', f); majInfosReglages(); listerMagasins(); };
    $('#btn-export-ref').onclick = () => exporterXlsx('Magasins', S.ref, REF_COLS, 'referentiel.xlsx');
    $('#inp-obj').onchange = async e => { const f = e.target.files[0]; if (!f) return; S.objectifs = lireObjXlsx(await f.arrayBuffer()); await Store.ecrireJSON(`config/objectifs-${$('#imp-annee').value}.json`, S.objectifs); majInfosReglages(); };
    $('#btn-export-obj').onclick = () => exporterXlsx('Objectifs ' + $('#imp-annee').value, (S.objectifs.rows || []), OBJ_COLS, `objectifs_${$('#imp-annee').value}.xlsx`);
    $('#btn-w-save').onclick = () => { localStorage.setItem('workerUrl', $('#w-url').value.trim()); localStorage.setItem('workerCle', $('#w-cle').value.trim()); $('#w-info').textContent = 'Enregistré'; };
    $('#btn-w-test').onclick = async () => { $('#btn-w-save').click(); const r = await workerRatings(); $('#w-info').textContent = !r ? 'Clé manquante' : r.erreur ? 'Erreur : ' + r.erreur : `OK – ${Object.keys(r.ratings).length} magasins`; };
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

  // ---------- Utilitaires ----------
  function telecharger(blob, nom) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nom; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function norm(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }

  window.App = { S, dossierPret, ajouterFichiers, calculer, enregistrer, chargerPhoto, afficherFiche, pdfMagasin, lireRefXlsx, lireObjXlsx };
  init();
})();
