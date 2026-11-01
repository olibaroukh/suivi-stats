/* Chaîne de calcul mensuelle : fichiers reçus + copier-coller → photo du mois (tableau central N et N-1) + rapport de contrôle.
 * Dépendances (globales) : XLSX, JSZip, Cosium, Hub, Sources, Lyleoo, OCM, Site, Equipe. */
(function (root) {
  'use strict';

  const MOIS_FR = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
  const cle = (a, m) => `${a}-${String(m).padStart(2, '0')}`;
  const finMois = (a, m) => `${a}-${String(m).padStart(2, '0')}-${String(new Date(a, m, 0).getDate()).padStart(2, '0')}`;

  // Colonnes du tableau central alimentées par chaque source (pour la reprise du mois précédent)
  const COLONNES_SOURCE = {
    cosium_n: ['O','P','Q','R','U','V','W','Y','AA','AB','AC','AD','AE','AF','AG','AH','AI','AN','AO','AP','AR','AW','AX','AY','AZ','BA','BB','BC','BD','BE','BF','BH','EV','X','Z','AT','AQ','AS','BG','EH','EI','EJ','EK','EL','EM','EN','EO','EP','EQ','ER','ES','ET'],
    marges: ['CA','CB','CC','CD','CE','CF','CG','CH','CI'],
    renta_sal: ['CM','CN','CO'],
    restes_dus: ['BR','BS','BT','BU','BV','BW'],
    confidence: ['DI','DJ','DK','DL','DM','DN','DO','DP','DQ','DR','DS','DT'],
    visites_presc: ['DV','DW','DX','DY'],
    visites_ce: ['DZ'],
    avoirs: ['S'],
    rentabilites: ['CP','CQ','CR','CS','CT','CU','CV','CW','CX','CY','CZ'],
    avis_google: ['BJ','BK','BL','BM','BN','BO'],
  };
  const LIBELLE_SOURCE = {
    cosium_n: 'Cosium – année en cours', cosium_n1: 'Cosium – année précédente (N-1)', marges: 'Marges produits', renta_sal: 'Renta salariale',
    restes_dus: 'Restes dus (taux d’indus)', confidence: 'Confidence', visites_presc: 'Visites prescripteurs', visites_ce: 'Visites CE',
    avoirs: 'Avoirs', rentabilites: 'Rentabilités trimestrielles', avis_google: 'Avis Google', lyleoo: 'Lyleoo', ocm: 'OCM', site: 'Site internet', rh: 'Export RH', stat_indiv: 'Cosium – stats par vendeur', sante: 'Score santé (dashboard)',
  };
  // Colonnes N-1 utiles à la fiche (évolutions)
  const COLS_N1 = ['P','Q','R','U','V','AF','AW','AY','AX'];

  async function lireFichier(f) {
    const nom = f.name || f.nom;
    const buf = f.arrayBuffer ? await f.arrayBuffer() : f.buffer;
    return { nom, buf };
  }
  const texte = buf => new TextDecoder('utf-8').decode(buf);

  // Déplie les ZIP Cosium : chaque fichier hérite du serveur du ZIP (préfixe XXOPTI…)
  async function deplier(fichiers, journal) {
    const out = [];
    for (const f of fichiers) {
      const { nom, buf } = await lireFichier(f);
      if (/\.zip$/i.test(nom)) {
        const z = await JSZip.loadAsync(buf);
        const srv = Cosium.serverFromZipName(nom);
        let n = 0;
        for (const e of Object.values(z.files)) {
          if (e.dir || /(^|\/)__MACOSX\//.test(e.name)) continue;
          out.push({ nom: e.name.split('/').pop(), buf: await e.async('arraybuffer'), zip: nom, serveurZip: srv.server, mail: srv.mail });
          n++;
        }
        journal.push(`ZIP ${nom} : ${n} fichiers${srv.server ? ' (serveur ' + srv.server + ')' : ''}`);
      } else out.push({ nom, buf });
    }
    return out;
  }

  // Reconnaît le type d'un fichier Excel d'après ses onglets / en-têtes
  function typeClasseur(wb) {
    const n = wb.SheetNames.map(s => s.trim());
    if (n.some(s => /^TOTAL by Cat/i.test(s))) return 'marges';
    if (n.some(s => /^CLASSE PAR DR/i.test(s))) return 'renta_sal';
    if (n.some(s => /^Donn.es Restes Dus/i.test(s))) return 'restes_dus';
    if (n.some(s => /CONSODETAIL/i.test(s))) return 'rentabilites';
    if (n.some(s => /^OPTICIEN$/i.test(s)) && n.some(s => /^AUDITION$/i.test(s))) return 'avis_google';
    const h = (XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, range: 0 })[0] || []).map(v => String(v || '').trim());
    if (h.includes('Liste') && h.includes('Code Magasin')) return 'confidence';
    if (h.includes('code_site') && h.includes('visite_effectuee')) return h.includes('specialite') ? 'visites_presc' : 'visites_ce';
    if (h.includes('Matricule') && h.includes('Poste')) return 'rh';
    return null;
  }

  async function construire(p) {
    const { fichiers = [], pastes = {}, annee, mois, ref, spec, etatAnnee = {}, photoPrecedente = null, workerRatings = null, listesConfidence = null } = p;
    const journal = [], alertes = [], sources = {};
    const etat = JSON.parse(JSON.stringify(etatAnnee || {}));
    etat.lyleoo = etat.lyleoo || {}; etat.ocm = etat.ocm || {}; etat.site = etat.site || {}; etat.avisFichiers = etat.avisFichiers || [];
    const refIdx = {}; ref.forEach(r => refIdx[String(r.code)] = r);

    // 1. Lecture
    const items = await deplier(fichiers, journal);
    const cosN = {}, cosN1 = {}, vendeurs = []; const ignores = []; const autres = {};
    const codesHorsRef = {};
    for (const it of items) {
      if (/\.csv$/i.test(it.nom)) {
        const t = texte(it.buf);
        if (/^"?Date Edition[^\n]*\n"?Factures/i.test(t.slice(0, 200))) { autres.avoirs = { nom: it.nom, texte: t }; continue; }
        const pr = Cosium.parse(it.nom, t);
        if (!pr.report) { ignores.push(it.nom + ' (type inconnu)'); continue; }
        if (!pr.used) { ignores.push(it.nom + ' (non utilisé)'); continue; }
        const srv = it.serveurZip || serveurParCodes(pr, refIdx);
        if (!srv) { alertes.push(`Serveur introuvable pour ${it.nom}`); continue; }
        const an = pr.period && pr.period.year;
        const cible = an === annee ? cosN : an === annee - 1 ? cosN1 : null;
        if (!cible) { alertes.push(`${it.nom} : période ${pr.period ? pr.period.from + ' → ' + pr.period.to : '?'} hors ${annee}/${annee - 1}`); continue; }
        if (pr.period.month !== mois) alertes.push(`${srv} – ${it.nom} : se termine en ${MOIS_FR[pr.period.month - 1]} (mois traité : ${MOIS_FR[mois - 1]})`);
        if (pr.level === 'magasin') { (cible[srv] = cible[srv] || {})[pr.report] = pr; pr.rows.forEach(r => { if (!refIdx[r.code] && !refIdx[r.code.replace(/A$/, '')]) codesHorsRef[r.code] = r.libelle; }); }
        else if (cible === cosN) vendeurs.push({ srv, pr });
      } else if (/\.xlsx?$/i.test(it.nom)) {
        const wb = XLSX.read(it.buf, { type: 'array', cellDates: true });
        const ty = typeClasseur(wb);
        if (!ty) { ignores.push(it.nom + ' (classeur non reconnu)'); continue; }
        (autres[ty] = autres[ty] || []).push({ nom: it.nom, wb });
      } else ignores.push(it.nom);
    }

    // 2. Cosium N
    const srvN = Object.keys(cosN);
    const overrides = {
      AO: (srv, terms) => terms.map((t, i) => ({ ...t, name: i % 2 === 0 ? 'TOTAL DES MONTURES 1ERE PAIRE' : 'TOTAL DES MONTURES 2EME PAIRE' })),
      EV: (srv, terms) => srv === 'ISRAEL' ? terms.map(t => ({ ...t, name: 'PERFECT CLEAN Qt' })) : [],
    };
    const lignes = Hub.build(cosN, spec, ref, { overrides, zeroIfMissing: { IRLANDE: ['R'] } });
    const mag = {}; lignes.forEach(l => { mag[l.code] = { N: l, N1: {} }; });
    sources.cosium_n = srvN.length ? { statut: 'recu', detail: `${srvN.length} serveur(s) : ${srvN.join(', ')}` } : { statut: 'absent' };
    const attendus = ['EURO','CANADA','IRLANDE','SUISSE','UK','MARTINIQUE','ISRAEL'];
    if (srvN.length) attendus.filter(s => !srvN.includes(s)).forEach(s => alertes.push(`Cosium N : serveur ${s} absent`));

    // 3. Cosium N-1 (évolutions)
    const srvN1 = Object.keys(cosN1);
    if (srvN1.length) {
      const spec1 = spec.filter(s => COLS_N1.includes(s.col));
      const l1 = Hub.build(cosN1, spec1, ref, { zeroIfMissing: { IRLANDE: ['R'] } });
      l1.forEach(l => { const o = {}; COLS_N1.forEach(c => o[c] = l[c]); o.ET = l.AF ? l.U * 100 / l.AF : null; o.EH = l.U != null && l.V != null ? l.U * l.V : null; mag[l.code].N1 = o; });
      sources.cosium_n1 = { statut: 'recu', detail: `${srvN1.length} serveur(s)` };
    } else sources.cosium_n1 = { statut: 'absent' };

    const poser = (src, out, detail) => {
      let n = 0;
      for (const c in out) { const m = mag[c]; if (!m) continue; Object.assign(m.N, out[c]); n++; }
      sources[src] = { statut: 'recu', detail: (detail ? detail + ' – ' : '') + n + ' magasins' };
    };
    const un = ty => autres[ty] && autres[ty][0];

    // 4. Sources Excel / CSV
    if (autres.marges) { const o = {}; autres.marges.forEach(x => Object.assign(o, Sources.marges(XLSX, x.wb).out));
      for (const c in o) { const r = o[c]; const a = ['CA','CC','CE','CG'].reduce((t, k) => t + (r[k] || 0), 0), m = ['CB','CD','CF','CH'].reduce((t, k) => t + (r[k] || 0), 0); r.CI = a ? m / a : null; }
      poser('marges', o, Sources.marges(XLSX, autres.marges[0].wb).periode); }
    if (autres.renta_sal) { const o = {}; autres.renta_sal.forEach(x => Object.assign(o, Sources.rentaSal(XLSX, x.wb).out)); poser('renta_sal', o, Sources.rentaSal(XLSX, autres.renta_sal[0].wb).periode); }
    if (un('restes_dus')) poser('restes_dus', Sources.restesDus(XLSX, un('restes_dus').wb).out, un('restes_dus').nom);
    if (autres.rentabilites) { const o = {}; let per = ''; autres.rentabilites.forEach(x => { const r = Sources.rentabilites(XLSX, x.wb); Object.assign(o, r.out); per = r.periode; }); poser('rentabilites', o, per); }
    if (un('visites_presc')) { for (const c in mag) Object.assign(mag[c].N, { DV: 0, DW: 0, DX: 0, DY: 0 }); poser('visites_presc', Sources.visites(XLSX, un('visites_presc').wb).out); }
    if (un('visites_ce')) { for (const c in mag) mag[c].N.DZ = 0; poser('visites_ce', Sources.visites(XLSX, un('visites_ce').wb).out); }
    if (autres.avoirs) poser('avoirs', Sources.avoirs(autres.avoirs.texte, finMois(annee, mois)).out, autres.avoirs.nom);

    // Confidence : listes cochées
    let listesTrouvees = null;
    if (un('confidence')) {
      const cf = Sources.confidence(XLSX, un('confidence').wb, listesConfidence);
      listesTrouvees = cf.listes;
      const o = {};
      for (const c in cf.out) { const x = cf.out[c], g = l => x[l] || { contactes: 0, total: 0 };
        o[c] = { DI: g('Rappel Devis Optique').contactes, DJ: g('Rappel Devis Optique').total, DK: g('Rappel Optique N+1').contactes, DL: g('Rappel Optique N+1').total,
                 DM: g('Rappel Audio N+4').contactes, DN: g('Rappel Audio N+4').total, DO: x.Global.contactes, DP: x.Global.total, DQ: g('Rappel Devis Optique').contactes, DR: g('Rappel Devis Optique').total, DS: x.Global.contactes, DT: x.Global.total, _listes: x }; }
      poser('confidence', o, (listesConfidence ? listesConfidence.length : 'toutes les') + ' listes');
    }

    // Avis Google : fichiers conservés dans l'année + Worker
    if (autres.avis_google) autres.avis_google.forEach(x => { const a = Sources.avisGoogle(XLSX, x.wb, x.nom); etat.avisFichiers = etat.avisFichiers.filter(f => f.date !== a.date).concat([{ date: a.date, out: a.out }]); });
    if (etat.avisFichiers.length || workerRatings) {
      const f = Sources.fusionAvis(etat.avisFichiers, workerRatings);
      poser('avis_google', f.avis, (workerRatings ? 'Worker + ' : '') + 'fichier du ' + (etat.avisFichiers.map(x => x.date).sort().pop() || '–'));
      for (const c in f.sources) if (mag[c]) mag[c].N._avisSource = f.sources[c];
    }

    // 5. Copier-coller cumulés sur l'année
    if (pastes.lyleoo && pastes.lyleoo.trim()) {
      const all = Lyleoo.parseAll(pastes.lyleoo); const inc = new Set();
      for (const m of all) { const r = Lyleoo.match(m, ref); etat.lyleoo[cle(m.periode.annee, m.periode.mois)] = r.out; r.inconnus.forEach(x => inc.add(x));
        if (m.controle === false) alertes.push(`Lyleoo ${cle(m.periode.annee, m.periode.mois)} : la somme des magasins ne correspond pas au total de la page`);
        r.approx.forEach(a => journal.push(`Lyleoo : « ${a.lyleoo} » rapproché de ${a.code} ${a.magasin}`)); }
      if (inc.size) alertes.push('Lyleoo – magasins non rattachés : ' + [...inc].join(', '));
      journal.push('Lyleoo : mois chargés ' + all.map(m => cle(m.periode.annee, m.periode.mois)).join(', '));
    }
    const cl = Lyleoo.cumul(etat.lyleoo, annee, mois);
    if (Object.keys(etat.lyleoo).some(k => k.startsWith(annee + '-'))) {
      for (const c in mag) { const o = cl.out[c]; mag[c].N.BY = o ? o.soumis : 0; mag[c].N.BZ = o ? o.express : 0; }
      sources.lyleoo = { statut: etat.lyleoo[cle(annee, mois)] ? 'recu' : 'repris', detail: cl.manquants.length ? 'mois manquants : ' + cl.manquants.join(', ') : 'cumul complet' };
    }
    if (pastes.ocm && pastes.ocm.trim()) {
      const po = OCM.parse(pastes.ocm); const r = OCM.match(po, ref);
      Object.assign(etat.ocm, r.out);
      if (r.inconnus.length) alertes.push('OCM – sites non rattachés : ' + r.inconnus.join(', '));
      journal.push(`OCM : ${po.lignes} interventions (${Object.keys(po.mois).join(', ')})`);
    }
    if (Object.keys(etat.ocm).some(k => k.startsWith(annee + '-')) || (etat.ocmReprise && etat.ocmReprise.annee === annee)) {
      const rep = etat.ocmReprise && etat.ocmReprise.annee === annee ? etat.ocmReprise : null;
      const co = OCM.cumul(etat.ocm, annee, mois, rep);
      for (const c in co.out) if (mag[c]) Object.assign(mag[c].N, { DB: co.out[c].DB || 0, DC: co.out[c].DC || 0, DD: co.out[c].DD || 0, DE: co.out[c].DE || 0, DF: co.out[c].DF || 0 });
      sources.ocm = { statut: etat.ocm[cle(annee, mois)] ? 'recu' : 'repris', detail: co.manquants.length ? 'mois manquants : ' + co.manquants.join(', ') : 'cumul complet' };
    }
    if (pastes.site && pastes.site.trim()) {
      const ps = Site.parse(pastes.site);
      if (ps.mois) { etat.site[ps.mois] = ps; journal.push('Site internet : ' + ps.mois); } else alertes.push('Site internet : mois introuvable (ligne « OC.fr MM/AAAA » manquante)');
    }
    const groupe = {};
    if (Object.keys(etat.site).some(k => k.startsWith(annee + '-'))) {
      groupe.site = Site.cumul(etat.site, annee, mois);
      sources.site = { statut: etat.site[cle(annee, mois)] ? 'recu' : 'repris', detail: groupe.site.manquants.length ? 'mois manquants : ' + groupe.site.manquants.join(', ') : 'cumul complet' };
    }

    // 6. Reprise du mois précédent pour les sources absentes
    if (photoPrecedente) {
      for (const src in COLONNES_SOURCE) {
        if (sources[src]) continue;
        let n = 0;
        for (const c in mag) { const prev = photoPrecedente.magasins[c]; if (!prev) continue; COLONNES_SOURCE[src].forEach(k => { if (prev.N[k] != null) { mag[c].N[k] = prev.N[k]; n++; } }); }
        if (n) sources[src] = { statut: 'repris', detail: 'valeurs du mois précédent' };
      }
      if (!sources.cosium_n1 || sources.cosium_n1.statut === 'absent') { for (const c in mag) if (photoPrecedente.magasins[c]) mag[c].N1 = photoPrecedente.magasins[c].N1 || {}; }
    }
    for (const s in LIBELLE_SOURCE) if (!sources[s] && s !== 'sante') sources[s] = { statut: 'absent' };

    // 7. Contrôles
    const horsRefCA = [];
    for (const c in codesHorsRef) {
      let ca = 0; for (const s in cosN) { const p = cosN[s].stat_optique; if (p) { const r = p.rows.find(x => x.code === c); if (r) ca += r['CA Généré Opt+Aud'] || 0; } }
      if (ca > 0 && !/A$/.test(c)) horsRefCA.push(`${c} ${codesHorsRef[c] || ''} (${Math.round(ca).toLocaleString('fr-FR')} €)`);
    }
    if (horsRefCA.length) alertes.push('Codes avec CA absents du référentiel (ignorés) : ' + horsRefCA.join(' ; '));
    const actifsSansCA = ref.filter(r => r.actif === 'Oui' && mag[r.code] && srvN.includes(r.serveur) && !mag[r.code].N.P).map(r => r.code + ' ' + r.magasin);
    if (actifsSansCA.length) journal.push(`${actifsSansCA.length} magasin(s) actif(s) sans CA ce mois-ci : ` + actifsSansCA.slice(0, 15).join(', ') + (actifsSansCA.length > 15 ? '…' : ''));

    // 8. Équipes : export RH (repris du mois précédent s'il n'est pas fourni) + stats Cosium par vendeur
    const Eq = root.Equipe || (typeof require !== 'undefined' ? require('./engine/equipe.js') : null);
    let personnes = null;
    if (un('rh')) { const r = Eq.rh(XLSX, un('rh').wb); personnes = r.personnes; sources.rh = { statut: 'recu', detail: `${r.personnes.length} personnes (${r.exclus} lignes écartées : postes non retenus ou sans site)` }; }
    else if (photoPrecedente && photoPrecedente.rh) { personnes = photoPrecedente.rh; sources.rh = { statut: 'repris', detail: 'export RH du mois précédent' }; }
    let stats = null;
    if (vendeurs.length) { stats = Eq.indexVendeurs(vendeurs.map(v => ({ report: v.pr.report, rows: v.pr.rows }))); sources.stat_indiv = { statut: 'recu', detail: `${Object.keys(stats).length} matricules` }; }
    else if (photoPrecedente && photoPrecedente.statsVendeurs) { stats = photoPrecedente.statsVendeurs; sources.stat_indiv = { statut: 'repris', detail: 'stats du mois précédent' }; }
    else sources.stat_indiv = { statut: 'absent' };
    const equipes = personnes ? Eq.parMagasin(personnes, stats || {}, ref) : {};
    if (personnes && stats) {
      const sansStats = personnes.filter(p => !stats[p.matricule] && /opticien|manager|audio/i.test(p.poste)).length;
      if (sansStats) journal.push(`${sansStats} personne(s) de l'export RH sans stats Cosium (matricule absent des exports par vendeur)`);
    }
    if (!sources.rh) sources.rh = { statut: 'absent' };

    const photo = { version: 2, annee, mois, genereLe: new Date().toISOString(), sources, magasins: mag, groupe, rh: personnes, statsVendeurs: stats, equipes };
    return { photo, etatAnnee: etat, rapport: { journal, alertes, ignores, listesConfidence: listesTrouvees, sources } };
  }

  function serveurParCodes(pr, refIdx) {
    const cnt = {}; pr.rows.forEach(r => { const x = refIdx[r.code] || refIdx[r.code.replace(/A$/, '')]; if (x && x.serveur) cnt[x.serveur] = (cnt[x.serveur] || 0) + 1; });
    const best = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0];
    return best ? best[0] : null;
  }

  const api = { construire, LIBELLE_SOURCE, MOIS_FR, cle, finMois };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Pipeline = api;
})(typeof self !== 'undefined' ? self : this);
