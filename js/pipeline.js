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
    mr_qualite: ['CK'],
  };
  const LIBELLE_SOURCE = {
    cosium_n: 'Cosium – année en cours', cosium_n1: 'Cosium – année précédente (N-1)', marges: 'Marges produits', renta_sal: 'Renta salariale',
    restes_dus: 'Restes dus (taux d’indus)', confidence: 'Confidence', visites_presc: 'Visites prescripteurs', visites_ce: 'Visites CE',
    avoirs: 'Avoirs', mr_qualite: 'Mr Qualité (score global)', rentabilites: 'Rentabilités trimestrielles', avis_google: 'Avis Google', lyleoo: 'Lyleoo', ocm: 'OCM', ocm_act: 'Activité OC Mobile (artefact)', site: 'Site internet', rh: 'Export RH', stat_indiv: 'Cosium – stats par vendeur', sante: 'Score santé (dashboard)', bilans: 'Bilans de passage (actions)',
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
    if (h.some(v => /^score global$/i.test(v))) return 'mr_qualite';
    return null;
  }

  async function construire(p) {
    const { fichiers = [], pastes = {}, annee, mois, ref, spec, etatAnnee = {}, photoPrecedente = null, workerRatings = null, listesConfidence = null, codesIgnores = [] } = p;
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
        if (/^"?Date Edition[^\n]*\n"?Factures/i.test(t.slice(0, 200))) { (autres.avoirs = autres.avoirs || []).push({ nom: it.nom, texte: t }); continue; } // un fichier par serveur Cosium
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
        (autres[ty] = autres[ty] || []).push({ nom: it.nom, wb, buf: it.buf });
      } else if (/\.json$/i.test(it.nom)) {
        // 07/11/2026 : activité OC Mobile préparée par Claude depuis la base de l'artefact « Activité OCM »
        let d = null; try { d = JSON.parse(texte(it.buf)); } catch (e) { /* pas du JSON */ }
        if (d && d.type === 'ocm-activite' && d.ocm) { if (!autres.ocm_act || String(d.genereLe) >= String(autres.ocm_act.genereLe)) autres.ocm_act = d; }
        else ignores.push(it.nom + ' (JSON non reconnu)');
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
      // Changement de code d'une année sur l'autre : le N-1 d'un magasin est lu sous son « Ancien code site »
      const versActuel = {};
      const refN1 = ref.map(r => { const a = String(r.ancienCode || '').trim().replace(/^0+/, '');
        if (!a || a === String(r.code) || refIdx[a]) return r; versActuel[a] = String(r.code); return { ...r, code: a }; });
      const l1 = Hub.build(cosN1, spec1, refN1, { zeroIfMissing: { IRLANDE: ['R'] } });
      l1.forEach(l => { const o = {}; COLS_N1.forEach(c => o[c] = l[c]); o.ET = l.AF ? l.U * 100 / l.AF : null; o.EH = l.U != null && l.V != null ? l.U * l.V : null;
        const c = versActuel[String(l.code)] || l.code; if (mag[c]) mag[c].N1 = o; });
      const nAnc = Object.keys(versActuel).length;
      if (nAnc) journal.push(`N-1 lu sous l’ancien code pour ${nAnc} magasin(s) : ` + Object.entries(versActuel).map(([a, c]) => `${c} ← ${a}`).join(', '));
      Object.keys(versActuel).forEach(a => { delete codesHorsRef[a]; delete codesHorsRef[a + 'A']; });
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
    if (un('restes_dus')) {
      const per = await periodeRestes(un('restes_dus').buf);
      poser('restes_dus', Sources.restesDus(XLSX, un('restes_dus').wb).out, per ? `du ${fr(per.du)} au ${fr(per.au)}` : un('restes_dus').nom);
      if (per) sources.restes_dus.periode = per; else alertes.push('Restes dus : période introuvable dans l’en-tête des onglets Secteurs (« Taux d’indus du … au … »).');
    }
    if (autres.rentabilites) { const o = {}; let per = ''; autres.rentabilites.forEach(x => { const r = Sources.rentabilites(XLSX, x.wb); Object.assign(o, r.out); per = r.periode; }); poser('rentabilites', o, per);
      // « FIN 2026-06 » → reporting arrêté à fin juin 2026
      const mP = String(per || '').match(/(\d{4})\D(\d{1,2})/); if (mP) { const a = +mP[1], mm = +mP[2]; sources.rentabilites.periode = { du: `${a}-01-01`, au: `${a}-${String(mm).padStart(2, '0')}-${String(new Date(a, mm, 0).getDate()).padStart(2, '0')}` }; } }
    if (un('visites_presc')) { for (const c in mag) Object.assign(mag[c].N, { DV: 0, DW: 0, DX: 0, DY: 0 }); poser('visites_presc', Sources.visites(XLSX, un('visites_presc').wb).out); }
    if (un('mr_qualite')) poser('mr_qualite', Sources.mrQualite(XLSX, un('mr_qualite').wb).out, un('mr_qualite').nom);
    if (un('visites_ce')) { for (const c in mag) mag[c].N.DZ = 0; poser('visites_ce', Sources.visites(XLSX, un('visites_ce').wb).out); }
    // 07/11/2026 : un tableau des avoirs par serveur Cosium → additionnés (un même fichier déposé deux fois n'est compté qu'une fois)
    if (autres.avoirs && autres.avoirs.length) {
      const vus = new Set(), tot = {};
      for (const a of autres.avoirs) { if (vus.has(a.texte)) continue; vus.add(a.texte);
        const o = Sources.avoirs(a.texte, finMois(annee, mois)).out; for (const c in o) { tot[c] = tot[c] || { S: 0 }; tot[c].S += o[c].S; } }
      poser('avoirs', tot, `${vus.size} fichier(s)`);
    }

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
    // 07/11/2026 : les relevés de l'artefact « Activité OCM » remplacent le copier-coller Intranet (mêmes chiffres, validé par Olivier).
    // Camion rattaché par la ville dans son nom ; un copier-coller déposé le même mois reste prioritaire.
    if (autres.ocm_act && autres.ocm_act.ocm) {
      const camions = ref.filter(r => r.nature === 'Camion' || /OC\s*MOBILE|^OCM\b/i.test(String(r.magasin || '')));
      const nz = x => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      const nonRattaches = [];
      for (const [ville, v] of Object.entries(autres.ocm_act.ocm)) {
        const r = camions.find(c => nz(c.magasin).includes(nz(ville)));
        if (!r) { if (Object.values(v.mois || {}).some(x => x.rdv)) nonRattaches.push(ville); continue; }
        for (const [k, x] of Object.entries(v.mois || {})) {
          if (!k.startsWith(annee + '-') || !x.rdv && !x.annulations) continue;
          etat.ocm[k] = etat.ocm[k] || {};
          etat.ocm[k][String(r.code)] = { DB: x.annulations || 0, DC: x.livraisons || 0, DD: x.depistages || 0, DE: x.reglages || 0, DF: x.ventes || 0 };
        }
      }
      if (nonRattaches.length) alertes.push('Activité OCM – camions non trouvés dans le référentiel : ' + nonRattaches.join(', '));
      journal.push('OCM : relevés repris de l’artefact Activité OCM');
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
        if (n) { sources[src] = { statut: 'repris', detail: 'valeurs du mois précédent' };
          const pp = photoPrecedente.sources && photoPrecedente.sources[src]; if (pp && pp.periode) sources[src].periode = pp.periode; }
      }
      if (!sources.cosium_n1 || sources.cosium_n1.statut === 'absent') { for (const c in mag) if (photoPrecedente.magasins[c]) mag[c].N1 = photoPrecedente.magasins[c].N1 || {}; }
    }
    // Activité OC Mobile (artefact) : fichier du mois, sinon celui du mois précédent
    let ocmActivite = null;
    if (autres.ocm_act) {
      ocmActivite = autres.ocm_act; const mm = `${annee}-${String(mois).padStart(2, '0')}`;
      if (ocmActivite.mois !== mm) alertes.push(`Activité OCM : fichier de ${ocmActivite.mois} (mois traité : ${mm})`);
      const actifs = Object.values(ocmActivite.ocm).filter(v => ((v.mois || {})[ocmActivite.mois] || {}).rdv).length, a = ocmActivite.arretes || {};
      sources.ocm_act = { statut: 'recu', detail: `${actifs} OCM actifs en ${ocmActivite.mois}${a.releves ? ' · relevés au ' + a.releves : ''}${a.cosium ? ' · CA au ' + a.cosium : ''}${a.potentiel ? ' · CA potentiel au ' + a.potentiel : ''}` };
    } else if (photoPrecedente && photoPrecedente.ocmActivite) { ocmActivite = photoPrecedente.ocmActivite; sources.ocm_act = { statut: 'repris', detail: `fichier de ${ocmActivite.mois}` }; }
    for (const s in LIBELLE_SOURCE) if (!sources[s] && s !== 'sante' && s !== 'bilans') sources[s] = { statut: 'absent' };

    // 7. Contrôles
    // 07/11/2026 : codes connus (magasins fermés gardés pour une réouverture éventuelle) : plus d'alerte, simple mention au journal
    const ign = new Set((codesIgnores || []).map(x => String(x).replace(/^0+/, ''))), horsRefConnus = [];
    const horsRefCA = [];
    for (const c in codesHorsRef) {
      if (ign.has(String(c).replace(/^0+/, ''))) { horsRefConnus.push(c); continue; }
      let ca = 0; for (const s in cosN) { const p = cosN[s].stat_optique; if (p) { const r = p.rows.find(x => x.code === c); if (r) ca += r['CA Généré Opt+Aud'] || 0; } }
      if (ca > 0 && !/A$/.test(c)) horsRefCA.push(`${c} ${codesHorsRef[c] || ''} (${Math.round(ca).toLocaleString('fr-FR')} €)`);
    }
    if (horsRefCA.length) alertes.push('Codes avec CA absents du référentiel (ignorés) : ' + horsRefCA.join(' ; '));
    if (horsRefConnus.length) journal.push('Codes connus hors référentiel (magasins fermés, ignorés) : ' + horsRefConnus.join(', '));
    const actifsSansCA = ref.filter(r => r.actif === 'Oui' && mag[r.code] && srvN.includes(r.serveur) && !mag[r.code].N.P).map(r => r.code + ' ' + r.magasin);
    if (actifsSansCA.length) journal.push(`${actifsSansCA.length} magasin(s) actif(s) sans CA ce mois-ci : ` + actifsSansCA.slice(0, 15).join(', ') + (actifsSansCA.length > 15 ? '…' : ''));

    // 8. Équipes : export RH (repris du mois précédent s'il n'est pas fourni) + stats Cosium par vendeur
    const Eq = root.Equipe || (typeof require !== 'undefined' ? require('./engine/equipe.js') : null);
    let personnes = null;
    if (!un('rh') && p.rhDepot && Array.isArray(p.rhDepot.lignes) && p.rhDepot.lignes.length) {
      const r = Eq.rhLignes(p.rhDepot.lignes); personnes = r.personnes;
      sources.rh = { statut: 'recu', detail: `${r.personnes.length} personnes – export déposé dans bilan-passage le ${String(p.rhDepot.recuLe || '').slice(0, 10).split('-').reverse().join('/')} (${r.exclus} lignes écartées : postes non retenus ou sans code site)` };
    }
    else if (un('rh')) { const r = Eq.rh(XLSX, un('rh').wb); personnes = r.personnes; sources.rh = { statut: 'recu', detail: `${r.personnes.length} personnes (${r.exclus} lignes écartées : postes non retenus ou sans site)` }; }
    else if (photoPrecedente && photoPrecedente.rh) { personnes = photoPrecedente.rh; sources.rh = { statut: 'repris', detail: 'export RH du mois précédent' }; }
    let stats = null;
    if (vendeurs.length) { stats = Eq.indexVendeurs(vendeurs.map(v => ({ report: v.pr.report, rows: v.pr.rows }))); sources.stat_indiv = { statut: 'recu', detail: `${Object.keys(stats).length} matricules` }; }
    else if (photoPrecedente && photoPrecedente.statsVendeurs) { stats = photoPrecedente.statsVendeurs; sources.stat_indiv = { statut: 'repris', detail: 'stats du mois précédent' }; }
    else sources.stat_indiv = { statut: 'absent' };
    // Effectif en équivalent temps plein : moyenne depuis janvier des coefficients transmis par bilan-passage
    // (journées école, repos temps partiel, temps partiel thérapeutique) ; sans agenda, chacun compte 1.
    const etp = Eq.etpMoyen(p.etpDepots || []);
    if (personnes && sources.rh) {
      const partiels = personnes.filter(x => etp.coefs[x.matricule] != null && etp.coefs[x.matricule] < 1).length;
      sources.rh.detail = (sources.rh.detail || '') + (etp.mois ? ` · temps plein (ETP) : moyenne de ${etp.mois} mois d’agenda, ${partiels} personne(s) à moins d’un temps plein` : ' · ETP : aucun agenda reçu, chacun compte 1');
    }
    const equipes = personnes ? Eq.parMagasin(personnes, stats || {}, ref, etp.coefs) : {};
    if (personnes && stats) {
      const sansStats = personnes.filter(p => !stats[p.matricule] && /opticien|manager|audio/i.test(p.poste)).length;
      if (sansStats) journal.push(`${sansStats} personne(s) de l'export RH sans stats Cosium (matricule absent des exports par vendeur)`);
    }
    if (!sources.rh) sources.rh = { statut: 'absent' };

    // Part de femmes et âge moyen par magasin (agrégés) ; genre et date de naissance retirés des fiches personnes
    if (personnes) {
      const demo = Eq.demographie(personnes, ref, annee, mois);
      for (const c in demo) if (mag[c] && mag[c].N) Object.assign(mag[c].N, demo[c]);
      personnes = personnes.map(({ genre, naissance, ...reste }) => reste);
    }
    const photo = { version: 2, annee, mois, genereLe: new Date().toISOString(), sources, magasins: mag, groupe, rh: personnes, statsVendeurs: stats, equipes, ocmActivite };
    return { photo, etatAnnee: etat, rapport: { journal, alertes, ignores, listesConfidence: listesTrouvees, sources } };
  }

  function serveurParCodes(pr, refIdx) {
    const cnt = {}; pr.rows.forEach(r => { const x = refIdx[r.code] || refIdx[r.code.replace(/A$/, '')]; if (x && x.serveur) cnt[x.serveur] = (cnt[x.serveur] || 0) + 1; });
    const best = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0];
    return best ? best[0] : null;
  }


  // Restes dus : la période n'est pas dans les cellules mais dans l'en-tête d'impression des onglets Secteurs
  // (« Taux d'indus du 01/01/2026 au 31/07/2026 ») → lecture directe du XML du classeur.
  async function periodeRestes(buf) {
    try {
      // Fichiers bruts du classeur via SheetJS (synchrone, sans JSZip)
      const wb = XLSX.read(buf, { type: 'array', bookFiles: true });
      for (const n of Object.keys(wb.files || {}).filter(n => /worksheets\/sheet\d+\.xml$/.test(n))) {
        const c = wb.files[n].content; if (!c) continue;
        let x = ''; if (typeof c === 'string') x = c; else { const u = c.length != null ? c : new Uint8Array(c); for (let i = 0; i < u.length; i += 8192) x += String.fromCharCode.apply(null, Array.prototype.slice.call(u, i, i + 8192)); }
        const h = (x.match(/<(?:odd|even|first)Header>([\s\S]*?)<\//) || [])[1]; if (!h) continue;
        const m = h.match(/du\s+(\d{2})\/(\d{2})\/(\d{4})\s+au\s+(\d{2})\/(\d{2})\/(\d{4})/i);
        if (m) return { du: `${m[3]}-${m[2]}-${m[1]}`, au: `${m[6]}-${m[5]}-${m[4]}` };
      }
    } catch (e) { console.warn('période restes dus', e); }
    return null;
  }
  const fr = iso => iso.split('-').reverse().join('/');

  const api = { construire, LIBELLE_SOURCE, COLONNES_SOURCE, MOIS_FR, cle, finMois, typeClasseur };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Pipeline = api;
})(typeof self !== 'undefined' ? self : this);
