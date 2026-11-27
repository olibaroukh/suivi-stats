/* Cockpits : un périmètre × un thème → une page A3 paysage (jamais plus d'une page).
 * Les données viennent de la photo du mois (cumul depuis le 1er janvier) ; N-1 = même période de l'année précédente. */
(function (root) {
  'use strict';

  const DEVISE_SYM = { 'Euro': '€', 'Shekel': '₪', 'Franc Suisse': 'CHF', 'Livre Sterling': '£', 'Dollars Canadien': '$', 'Dolard': '$' };
  // Taux de conversion vers l'euro pour les totaux multi-devises (modifiables dans Réglages)
  const TAUX_DEFAUT = { 'Euro': 1, 'Shekel': 0.25, 'Franc Suisse': 1.06, 'Livre Sterling': 1.17, 'Dollars Canadien': 0.66, 'Dolard': 0.92 };
  const norm = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();

  // ---------- Agrégation : montants additionnés, ratios pondérés par leur base ----------
  const POIDS = { V: 'U', W: 'U', AC: 'U', AD: 'U', AE: 'U', AF: 'U', AN: 'U', AP: 'U', AR: 'U',
    AY: 'AW', BB: 'AW', BH: 'AW', AZ: 'AX', BA: 'AX', BD: 'AX', BC: 'Q', BE: 'U',
    BV: 'BU', XP: 'BU', XQ: 'BU', BQ: 'BU', CQ: 'CP', CS: 'CP', CU: 'CP', CW: 'CP', CY: 'CP', CM: 'P', BK: 'BL', BN: 'BO', CK: '_1', XG: 'XJ' };
  const MONTANTS = new Set(['O', 'P', 'Q', 'R', 'S', 'BR', 'BS', 'BT', 'BU', 'CP', 'EH']); // convertis en € si multi-devises
  function agreger(items, conv) {
    const out = { N: {}, N1: {} };
    for (const per of ['N', 'N1']) {
      const cles = new Set(); items.forEach(it => Object.keys(it[per] || {}).forEach(k => { if (/^[A-Z]{1,2}$/.test(k)) cles.add(k); }));
      for (const k of cles) {
        const w = POIDS[k];
        let s = 0, sw = 0, vu = false;
        for (const it of items) {
          const d = it[per] || {}; let v = d[k]; if (v == null || isNaN(v)) continue;
          const t = conv ? conv(it) : 1;
          if (w) { const p = w === '_1' ? 1 : (d[w] || 0) * (MONTANTS.has(w) ? t : 1); s += v * p; sw += p; vu = true; }
          else { s += v * (MONTANTS.has(k) ? t : 1); vu = true; }
        }
        out[per][k] = !vu ? null : w ? (sw ? s / sw : null) : s;
      }
    }
    return out;
  }

  // ---------- Indicateurs ----------
  const div = (a, b) => (a == null || !b) ? null : a / b;
  const evol = (a, b) => (a == null || !b) ? null : a / b - 1;
  const pct = v => v == null ? null : v / 100;
  const COL = {
    obj: { lib: 'Objectif annuel', f: (n) => n.O != null ? n.O * 1000 : null, fmt: 'k' },
    ca: { lib: 'CA généré', f: (n) => n.P, fmt: 'k', fort: true },
    prev: { lib: 'Prévisionnel', f: (n, p, m) => n.P != null ? n.P * 12 / m : null, fmt: 'k' },
    evolCa: { lib: 'Évol. CA', f: (n, p) => evol(n.P, p.P), fmt: 'evol' },
    posit: { lib: 'Positionnement', f: (n, p, m) => (n.P != null && n.O) ? n.P * 12 / m / (n.O * 1000) : null, fmt: 'pct0', seuil: 1 },
    ndv: { lib: 'Nb ventes', f: (n) => n.U, fmt: 'nb' },
    evolNdv: { lib: 'Évol. ventes', f: (n, p) => evol(n.U, p.U), fmt: 'evol' },
    caOpt: { lib: 'CA optique', f: (n) => n.P != null ? n.P - (n.Q || 0) - (n.R || 0) : null, fmt: 'k' },
    caAud: { lib: 'CA audio', f: (n) => n.Q, fmt: 'k' },
    caCon: { lib: 'CA contacto', f: (n) => n.R, fmt: 'k' },
    mdc: { lib: '% MdC', f: (n) => pct(n.AN), fmt: 'pct0', obj: 'mdc' },
    sop: { lib: '% SOP', f: (n) => pct(n.AC), fmt: 'pct0', obj: 'sop' },
    panier: { lib: 'Panier moyen', f: (n) => n.V, fmt: 'eur', obj: 'panier' },
    evolPanier: { lib: 'Évol. panier', f: (n, p) => evol(n.V, p.V), fmt: 'evol' },
    tc: { lib: 'Tx de concrét.', f: (n) => pct(n.AF), fmt: 'pct1', obj: 'tc' },
    pcPct: { lib: '% Pack confort', f: (n) => pct(n.AD), fmt: 'pct0', obj: 'pcPct' },
    pcEur: { lib: '€ Pack confort', f: (n) => n.AE, fmt: 'eur', obj: 'pcEur' },
    pm1: { lib: 'PM 1re paire', f: (n) => n.W, fmt: 'eur', obj: 'pm1' },
    caAudio: { lib: 'CA audio', f: (n) => n.Q, fmt: 'k', fort: true },
    evolAudio: { lib: 'Évol. CA audio', f: (n, p) => evol(n.Q, p.Q), fmt: 'evol' },
    panierA: { lib: 'Panier audio', f: (n) => n.AY, fmt: 'eur' },
    ventesA: { lib: 'Ventes audio', f: (n) => n.AW, fmt: 'nb' },
    protheses: { lib: 'Prothèses', f: (n) => n.AX, fmt: 'nb' },
    pmProt: { lib: 'PM prothèse', f: (n) => n.AZ, fmt: 'eur', obj: 'pmProthese' },
    sap: { lib: '% Garantie', f: (n) => pct(n.BA), fmt: 'pct0', obj: 'garantieAudio' },
    tcA: { lib: 'TC audio', f: (n) => pct(n.BB), fmt: 'pct0', obj: 'tcAudio' },
    vadd: { lib: '% Ventes add.', f: (n) => pct(n.BC), fmt: 'pct0', obj: 'ventesAdd' },
    depist: { lib: 'Dépistage', f: (n) => pct(n.BE), fmt: 'pct1', obj: 'depistage' },
    rdus: { lib: 'Restes dus', f: (n) => n.BR, fmt: 'eur' },
    avoirs: { lib: 'Avoirs', f: (n) => n.BS, fmt: 'eur' },
    gel: { lib: 'Gel de primes', f: (n) => n.BT, fmt: 'eur' },
    indus: { lib: 'Taux d’indus', f: (n) => n.BV, fmt: 'pct2', seuil: 0.01, seuil2: 0.02, inverse: true },
    evolIndus: { lib: 'Évol. indus', f: (n) => (n.XQ != null && n.XP != null) ? n.XQ - n.XP : null, fmt: 'pts2', seuil: 0, inverse: true },
    recup: { lib: 'Tx de récup', f: (n) => pct(n.BQ), fmt: 'pct1' },
    caHt: { lib: 'CA HT (reporting)', f: (n) => n.CP, fmt: 'k' },
    re: { lib: 'RE', f: (n) => pct(n.CQ), fmt: 'pct1', seuil: 0.20 },
    marge: { lib: 'Marge produits', f: (n) => pct(n.CS), fmt: 'pct1', seuil: 0.70 },
    loyers: { lib: 'Loyers chargés', f: (n) => pct(n.CU), fmt: 'pct1', seuil: 0.06, inverse: true },
    pub: { lib: 'Publicité', f: (n) => pct(n.CW), fmt: 'pct1', seuil: 0.07, inverse: true },
    personnel: { lib: 'Personnel', f: (n) => pct(n.CY), fmt: 'pct1', seuil: 0.28, inverse: true },
    rentaSal: { lib: 'Renta salariale', f: (n) => pct(n.CM), fmt: 'pct1', seuil: 0.28, inverse: true },
    note: { lib: 'Note Google', f: (n) => n.BL ? n.BK : null, fmt: 'note', seuil: 4.5 },
    avis: { lib: 'Avis Google', f: (n) => n.BL, fmt: 'nb' },
    mrq: { lib: 'Mr Qualité', f: (n) => n.CK, fmt: 'nb' },
    effOpt: { lib: 'Effectif optique', f: (n) => n.XA, fmt: 'nb1' },
    effAud: { lib: 'Effectif audio', f: (n) => n.XC, fmt: 'nb1' },
    effTheo: { lib: 'Effectif théorique', f: (n) => n.XB, fmt: 'nb1' },
    // 20/11/2026 : absentéisme cumulé depuis janvier = jours d'absence (motifs du score santé, groupe A) / jours ouvrés
    // théoriques ; XR et XS sont additionnés à chaque niveau (AR, groupe), le taux n'est jamais une moyenne de taux.
    // Seuils validés le 20/11/2026 d'après octobre (médiane 6,3 %, quartiles 3,1 % / 10,7 %) : vert ≤ 5 %, orange ≤ 10 %, rouge au-delà.
    absent: { lib: 'Absentéisme', f: (n) => n.XS ? (n.XR || 0) / n.XS : null, fmt: 'pct1', seuil: 0.05, seuil2: 0.10, inverse: true },
    ecart: { lib: 'Écart effectif / théorique', f: (n) => (n.XA != null && n.XB != null) ? n.XA + (n.XC || 0) - n.XB : null, fmt: 'ecart', seuil: 0.5, inverse: true },
    ageMoy: { lib: 'Âge moyen', f: (n) => n.XG, fmt: 'nb1' },
    pctF: { lib: '% femmes', f: (n) => n.XI ? n.XH / n.XI : null, fmt: 'pct0' },
    caPers: { lib: 'CA / mois / pers.', f: (n, p, m) => (n.P != null && (n.XA || n.XC)) ? n.P / ((n.XA || 0) + (n.XC || 0)) / m : null, fmt: 'k1' },
  };

  const THEMES = {
    // 07/11/2026 : activité OC Mobile (base de l'artefact « Activité OCM », fichier mensuel préparé par Claude)
    ocmAct: { lib: 'Activité OC Mobile', cols: [], tri: 'code', special: true },
    complet: { lib: 'CA · Optique · Audio · Rentabilité', tri: 'ca',
      sections: [
        { lib: 'Chiffre d’affaires · Optique · Audio', groupes: [['Chiffre d’affaires', ['obj', 'ca', 'posit', 'evolCa']], ['Optique', ['ndv', 'evolNdv', 'panier', 'tc', 'sop', 'mdc', 'pcPct', 'pm1']], ['Audio', ['caAudio', 'evolAudio', 'protheses', 'pmProt', 'tcA', 'vadd', 'depist']]] },
        { lib: 'Gestion & rentabilité', groupes: [['Restes dus', ['rdus', 'indus']], ['Rentabilité (reporting trimestriel)', ['caHt', 're', 'marge', 'loyers', 'pub', 'personnel']], ['Google & qualité', ['note', 'avis', 'mrq']], ['Rentabilité salariale & effectifs', ['rentaSal', 'effOpt', 'effAud', 'effTheo', 'ecart', 'absent', 'ageMoy', 'pctF', 'caPers']]] },
      ],
      top: [['posit', 'Positionnement'], ['ndv', 'Nombre de ventes'], ['protheses', 'Nombre de prothèses'], ['re', 'Résultat d’exploitation']] },
    // 24/11/2026 : recto « mur » (affichage au bureau, lisible de loin) + verso = cockpit complet
    mur: { lib: 'Affichage mur (recto) + détail (verso)', tri: 'ca', mur: true },
    moment: { lib: 'Indicateur du moment (affiche)', tri: 'ca', moment: true },
    // sansSiColonnes (06/11/2026, demande d'Olivier) : colonnes retirées de la liste dès qu'elle passe sur 2 colonnes ou plus (la synthèse les garde)
    ca: { lib: 'Chiffre d’affaires', maxBlocs: 2, cols: ['obj', 'ca', 'prev', 'evolCa', 'posit', 'caOpt', 'caAud', 'caCon', 'ndv', 'evolNdv'], sansSiColonnes: ['caOpt', 'caAud', 'caCon'], tri: 'ca',
      top: [['posit', 'Positionnement'], ['ca', 'CA généré'], ['evolCa', 'Évolution du CA']] },
    optique: { lib: 'Optique', maxBlocs: 2, cols: ['ndv', 'evolNdv', 'panier', 'evolPanier', 'tc', 'sop', 'mdc', 'pcPct', 'pcEur', 'pm1'], tri: 'ndv',
      top: [['ndv', 'Nombre de ventes'], ['panier', 'Panier moyen'], ['tc', 'Taux de concrétisation']] },
    audio: { lib: 'Audio', maxBlocs: 2, cols: ['caAudio', 'evolAudio', 'ventesA', 'protheses', 'panierA', 'pmProt', 'sap', 'tcA', 'vadd', 'depist'], tri: 'caAudio',
      top: [['protheses', 'Nombre de prothèses'], ['caAudio', 'CA audio'], ['depist', 'Dépistage']] },
    restes: { lib: 'Restes dus', cols: ['rdus', 'avoirs', 'gel', 'indus', 'evolIndus', 'recup'], tri: 'indus',
      top: [['indus', 'Taux d’indus le plus bas', true]] },
    confidence: { lib: 'Confidence', cols: [], tri: 'cfG', top: [['cfG', 'Taux de contact global']] },
    renta: { lib: 'Rentabilité & gestion', maxBlocs: 2, cols: ['caHt', 're', 'marge', 'loyers', 'pub', 'personnel', 'rentaSal', 'absent', 'indus', 'note', 'mrq'], tri: 're',
      top: [['re', 'Résultat d’exploitation'], ['note', 'Note Google'], ['indus', 'Taux d’indus le plus bas', true]] },
  };

  // ---------- Périmètres ----------
  // Cockpit Paris : liste de codes magasins (modifiable dans Réglages › Cockpit Paris ; config/cockpit-paris.json)
  let PARIS = ['1033', '1026', '1020', '1021', '1022', '1046', '1101', '1103', '1108', '1109', '1110', '1112', '1115', '1116', '1118', '1117', '1119', '1120', '1121', '1122', '1124', '1128'];
  function definirParis(codes) { if (Array.isArray(codes) && codes.length) PARIS = codes.map(x => String(x).trim().replace(/^0+(?=\d)/, '')).filter(Boolean); }
  function perimetres(ref) {
    const act = ref.filter(r => r.actif === 'Oui');
    const fr = r => r.pays === 'FRANCE';
    const succFr = r => fr(r) && r.type === 'Succursale' && r.nature !== 'Camion' && norm(r.ar) !== 'OCM';
    const out = [
      { id: 'siege', lib: 'Réseau – vue Siège', groupeLib: 'Synthèse', special: 'siege', themes: ['siege'] },
      { id: 'france', lib: 'France – succursales', groupeLib: 'France', filtre: succFr, sousTotal: r => r.ar, themes: ['pole', 'moment', 'ca', 'optique', 'audio', 'restes', 'renta'] },
    ];
    [...new Set(act.filter(succFr).map(r => r.ar))].filter(Boolean).sort().forEach(a =>
      out.push({ id: 'ar:' + a, lib: 'AR – ' + a, groupeLib: 'France', filtre: r => succFr(r) && r.ar === a, themes: ['complet', 'mur', 'ca', 'optique', 'audio', 'restes', 'renta'] }));
    out.push({ id: 'paris', lib: 'Paris', groupeLib: 'France', filtre: r => PARIS.includes(String(r.code)), sousTotal: r => r.ar, themes: ['complet', 'mur', 'ca', 'optique', 'audio', 'restes', 'renta'] });
    out.push({ id: 'ocm', lib: 'OCM (camions succursales)', groupeLib: 'France', filtre: r => fr(r) && norm(r.ar) === 'OCM', themes: ['ocmAct', 'ca', 'optique', 'audio', 'restes'] });
    out.push({ id: 'franchises', lib: 'Franchises France – par franchisé', groupeLib: 'Franchises', filtre: r => fr(r) && r.type === 'Franchise', regrouper: r => r.groupe, multiPages: true, themes: ['complet', 'ca', 'optique', 'audio'] });
    const grp = {}; act.filter(r => fr(r) && r.type === 'Franchise').forEach(r => { grp[r.groupe] = (grp[r.groupe] || 0) + 1; });
    Object.keys(grp).filter(g => grp[g] >= 2).sort().forEach(g =>
      out.push({ id: 'groupe:' + g, lib: 'Groupe – ' + g, groupeLib: 'Franchises', filtre: r => fr(r) && r.type === 'Franchise' && r.groupe === g, multiPages: true, themes: ['complet', 'ca', 'optique', 'audio'] }));
    out.push({ id: 'inter', lib: 'International – tous pays', groupeLib: 'International', filtre: r => !fr(r), sousTotal: r => r.pays, multiDevise: true, themes: ['ca', 'optique', 'audio', 'renta'] });
    [...new Set(act.filter(r => !fr(r)).map(r => r.pays))].sort().forEach(p =>
      out.push({ id: 'pays:' + p, lib: 'Pays – ' + p, groupeLib: 'International', filtre: r => r.pays === p, themes: ['ca', 'optique', 'audio', 'renta'] }));
    out.forEach(p => { if (!p.special && p.themes && !p.themes.includes('confidence')) p.themes.push('confidence'); });
    return out;
  }

  // ---------- Modèle d'une page ----------
  function construire(photo, ref, perim, themeId, opts = {}) {
    const m = photo.mois, taux = Object.assign({}, TAUX_DEFAUT, opts.taux || {});
    if (perim.special === 'siege') return construireSiege(photo, ref, taux, Object.assign({}, SIEGE_DEFAUT, opts.siege || {}));
    if (themeId === 'ocmAct') return construireOcmAct(photo, ref, perim);
    let th = THEMES[themeId];
    // Confidence : colonnes construites à partir des listes choisies (nombre de clients contactés + taux), global = somme des listes choisies
    const CF_CT = ['ZA', 'ZB', 'ZC', 'ZD', 'ZE', 'ZF'], CF_TOT = ['ZG', 'ZH', 'ZI', 'ZJ', 'ZK', 'ZL'];
    const listesConf = themeId === 'confidence' ? (opts.listesConf && opts.listesConf.length ? opts.listesConf : LISTES_CONF_DEFAUT).slice(0, 6) : [];
    if (themeId === 'confidence') {
      const cols = [];
      listesConf.forEach((l, i) => {
        COL['cfN' + i] = { lib: l, f: n => n[CF_CT[i]], fmt: 'nb' };
        COL['cfT' + i] = { lib: 'Taux', f: n => n[CF_TOT[i]] ? n[CF_CT[i]] / n[CF_TOT[i]] : null, fmt: 'pct0' };
        cols.push('cfN' + i, 'cfT' + i);
      });
      COL.cfGN = { lib: 'Global', f: n => n.ZM, fmt: 'nb' };
      COL.cfG = { lib: 'Taux', f: n => n.ZN ? n.ZM / n.ZN : null, fmt: 'pct0', fort: true };
      th = { ...th, cols: cols.concat(['cfGN', 'cfG']) };
    }
    if (th.sections && !th.cols) th.cols = [...new Set(th.sections.flatMap(se => se.groupes.flatMap(g => g[1])))];
    const mags = ref.filter(r => r.actif === 'Oui' && perim.filtre(r) && photo.magasins[String(r.code)]);
    // Magasins non actifs : absents des lignes, mais leur chiffre compte dans les totaux (synthèses, total)
    const magsTot = ref.filter(r => perim.filtre(r) && photo.magasins[String(r.code)]);
    const devises = [...new Set(magsTot.map(r => r.devise || 'Euro'))];
    const multi = devises.length > 1;
    const conv = multi ? it => taux[it.devise] || 1 : null;
    // Effectifs (export RH ; une personne sur plusieurs magasins compte 1/n dans chacun) et effectif théorique = max(3,5 ; CA prévisionnel / 250 000)
    const avecEff = d => { const N = { ...(d.N || {}) }; const eq = photo.equipes && photo.equipes[String(d.code)];
      if (eq) { const part = p => p.part != null ? p.part : 1; N.XA = eq.filter(p => p.famille !== 'audio').reduce((a, p) => a + part(p), 0); N.XC = eq.filter(p => p.famille === 'audio').reduce((a, p) => a + part(p), 0); }
      N.XB = N.P != null ? Math.max(3.5, N.P * 12 / m / 250000) : null;
      if (listesConf.length) { const L = N._listes || {}, ANC = { 'Rappel Devis Optique': ['DI', 'DJ'], 'Rappel Optique N+1': ['DK', 'DL'], 'Rappel Audio N+4': ['DM', 'DN'] };
        let gc = 0, gt = 0, vu = false;
        listesConf.forEach((l, i) => { let ct = null, tot = null;
          if (L[l]) { ct = L[l].contactes; tot = L[l].total; } else if (ANC[l] && N[ANC[l][0]] != null) { ct = N[ANC[l][0]]; tot = N[ANC[l][1]]; }
          N[CF_CT[i]] = ct; N[CF_TOT[i]] = tot; if (ct != null) { gc += ct; gt += tot || 0; vu = true; } });
        N.ZM = vu ? gc : null; N.ZN = vu ? gt : null; }
      // Taux d'indus du mois précédent (évolution), si la photo précédente est fournie
      const pr = opts.precedente && opts.precedente.magasins[String(d.code)]; if (pr && pr.N && pr.N.BV != null && N.BV != null) { N.XP = pr.N.BV; N.XQ = N.BV; } // XQ : taux actuel limité aux magasins comparables
      return { ...d, N }; };
    const donnees = r => avecEff({ ...photo.magasins[String(r.code)], code: String(r.code) });
    const item = r => ({ ...donnees(r), devise: r.devise || 'Euro', r });
    const valeurs = (d) => { const o = {}; th.cols.forEach(k => { o[k] = COL[k].f(d.N || {}, d.N1 || {}, m); }); return o; };
    let lignes;
    if (perim.regrouper) {
      const g = {}, nAct = {}; magsTot.forEach(r => { const k = perim.regrouper(r) || '—'; (g[k] = g[k] || []).push(item(r)); if (r.actif === 'Oui') nAct[k] = (nAct[k] || 0) + 1; });
      lignes = Object.entries(g).map(([k, its]) => ({ code: (nAct[k] || 0) + ' mag.', nom: k, v: valeurs(agreger(its, conv)) }));
    } else lignes = mags.map(r => ({ code: String(r.code), nom: r.magasin, ar: r.ar || '', v: valeurs(donnees(r)), dev: DEVISE_SYM[r.devise] || '€', devise: r.devise || 'Euro' }));
    // Objectifs (pays de référence du périmètre) pour colorer les cellules
    const obj = objectifsRef(opts.objectifs, mags);
    const aggTot = agreger(magsTot.map(item), conv);
    // 25/11/2026 : périmètre = toutes les franchises France → objectif fixe (Réglages › objectifs Siège, 880 M€ en 2026)
    const objFF = Object.assign({}, SIEGE_DEFAUT, opts.siege || {}).franchFrance;
    if (objFF && magsTot.length && magsTot.every(r => r.pays === 'FRANCE' && r.type === 'Franchise')
      && magsTot.length === ref.filter(r => r.pays === 'FRANCE' && r.type === 'Franchise' && photo.magasins[String(r.code)]).length) aggTot.N.O = objFF / 1000;
    const total = { nom: 'TOTAL', v: valeurs(aggTot) };
    let sous = [];
    if (perim.sousTotal) {
      const g = {}; magsTot.forEach(r => { const k = perim.sousTotal(r) || '—'; (g[k] = g[k] || []).push(r); });
      sous = Object.entries(g).sort((a, b) => a[0].localeCompare(b[0])).map(([k, rs]) => ({ nom: k, n: rs.filter(r => r.actif === 'Oui').length, v: valeurs(agreger(rs.map(item), conv)), dev: [...new Set(rs.map(r => DEVISE_SYM[r.devise] || '€'))].join('/') }));
    }
    let tri = opts.tri || 'code'; if (tri === 'code' && perim.regrouper) tri = 'nom';
    if (tri === 'code') lignes.sort((a, b) => String(a.code).localeCompare(String(b.code), 'fr', { numeric: true }));
    else if (tri === 'nom') lignes.sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
    else lignes.sort((a, b) => (b.v[tri] ?? -Infinity) - (a.v[tri] ?? -Infinity));
    lignes.forEach((l, i) => l.rang = i + 1);
    // Top 3 : en multi-devises, les montants sont convertis en € avant classement (affichés en €)
    const enEur = (l, k) => (multi && l.devise && ['k', 'kn', 'eur'].includes(COL[k].fmt)) ? l.v[k] * (taux[l.devise] || 1) : l.v[k];
    const top = th.top.map(([k, lib, asc]) => ({ lib, fmt: COL[k].fmt, liste: lignes.filter(l => l.v[k] != null).map(l => [l.nom, enEur(l, k)]).sort((a, b) => asc ? a[1] - b[1] : b[1] - a[1]).slice(0, 3) }));
    const posit = mags.map(r => COL.posit.f(photo.magasins[String(r.code)].N || {}, {}, m));
    const prevs = mags.map(r => COL.prev.f(photo.magasins[String(r.code)].N || {}, {}, m) * (multi ? (taux[r.devise] || 1) : 1));
    const compteurs = [['Magasins', mags.length], ['Magasins à 100 %', posit.filter(x => x != null && x >= 1).length], ['Prévisionnel ≥ 1,2 M€', prevs.filter(x => x >= 1.2e6).length]];
    if (themeId === 'confidence') compteurs.push(['Magasins utilisateurs', mags.filter(r => { const it = donnees(r).N; return it.ZN > 0 && it.ZM > 0; }).length]);
    if (themeId === 'restes') compteurs.push(['Taux d’indus ≤ 1 %', mags.filter(r => { const v = (photo.magasins[String(r.code)].N || {}).BV; return v != null && v <= 0.01; }).length]);
    // Absentéisme : colonne retirée quand aucun magasin du périmètre n'a de rapport agenda RH (franchises, international)
    const colsMd = th.cols.includes('absent') && total.v.absent == null ? th.cols.filter(k => k !== 'absent') : th.cols;
    return { type: th.sections ? 'multi' : 'liste', perim, theme: th, themeId, photo, cols: colsMd, lignes, total, sous, top, compteurs, obj, multi, devTotal: multi ? '€' : (DEVISE_SYM[devises[0]] || '€'), sousLib: perim.id === 'france' ? 'AR' : perim.id === 'inter' ? 'Pays' : '' };
  }
  function objectifsRef(objectifs, mags) {
    const rows = (objectifs && objectifs.rows) || [];
    const pays = [...new Set(mags.map(r => r.pays))];
    if (pays.length !== 1) return {};
    return rows.find(r => r.type === 'Pays' && norm(r.cle) === norm(pays[0])) || {};
  }

  // Vue Siège : synthèse par pays (CA converti en €), rentabilité succursales, évolutions
  // Objectifs propres à la vue Siège (fixés chaque année dans Réglages ; valeurs 2026 du Numbers par défaut)
  const SIEGE_DEFAUT = { groupe: 1.1e9, franchFrance: 880000000, siteFrance: 6000000, siteIsrael: 1200000, siteUK: 840000, siteCanada: 500000, mobileSucc: 1200000, mobileFranchise: 450000, mdc: 0.66 };
  function construireSiege(photo, ref, taux, objS) {
    // Tous les magasins ayant du chiffre (actifs ou non) comptent dans les montants ; les compteurs ne retiennent que les actifs
    const m = photo.mois, act = ref.filter(r => photo.magasins[String(r.code)]), estActif = r => r.actif === 'Oui';
    const conv = it => taux[it.devise] || 1;
    const item = r => ({ ...photo.magasins[String(r.code)], devise: r.devise || 'Euro' });
    const ordre = ['FRANCE', 'ESPAGNE', 'BELGIQUE', 'LUXEMBOURG', 'SUISSE', 'ISRAEL', 'CANADA', 'ROYAUME-UNI', 'IRLANDE'];
    const paysL = [...new Set(act.map(r => r.pays))].sort((a, b) => (ordre.indexOf(a) + 1 || 99) - (ordre.indexOf(b) + 1 || 99));
    // 25/11/2026 : objectif des franchises France = montant fixe (880 M€ en 2026), pas la somme des objectifs des magasins
    const estFF = r => r.pays === 'FRANCE' && r.type === 'Franchise', nFF = act.filter(estFF).length;
    const ligne = (nom, rs) => {
      const a = agreger(rs.map(item), conv), n = a.N, p = a.N1;
      const prev = n.P != null ? n.P * 12 / m : null;
      let obj = n.O != null ? n.O * 1000 : null;
      const ff = rs.filter(estFF);
      if (objS.franchFrance && nFF && ff.length === nFF) { const sFF = agreger(ff.map(item), conv).N; obj = (obj || 0) - (sFF.O || 0) * 1000 + objS.franchFrance; }
      const prevMag = rs.filter(estActif).map(r => { const x = photo.magasins[String(r.code)].N || {}; return x.P != null ? x.P * 12 / m * (taux[r.devise] || 1) : 0; });
      return { nom, ca: n.P, evol: evol(n.P, p.P), obj, posit: div(prev, obj), prev,
        succ: rs.filter(r => estActif(r) && r.type === 'Succursale' && r.nature !== 'Camion').length, fr: rs.filter(r => estActif(r) && r.type === 'Franchise' && r.nature !== 'Camion').length, sup12: prevMag.filter(x => x >= 1.2e6).length,
        evolOpt: evol(n.P != null ? n.P - (n.Q || 0) - (n.R || 0) : null, p.P != null ? p.P - (p.Q || 0) - (p.R || 0) : null), evolAud: evol(n.Q, p.Q),
        evolNdv: evol(n.U, p.U), evolNdvA: evol(n.AW, p.AW), ndv: n.U, ndvA: n.AW,
        re: pct(n.CQ), marge: pct(n.CS), loyers: pct(n.CU), pub: pct(n.CW), rentaSal: pct(n.CM), absent: n.XS ? (n.XR || 0) / n.XS : null, note: n.BL ? n.BK : null, avis: n.BL };
    };
    const pays = paysL.map(p => ligne(p, act.filter(r => r.pays === p)));
    const total = ligne('TOTAL', act);
    const succ = paysL.map(p => ligne(p, act.filter(r => r.pays === p && r.type === 'Succursale'))).filter(l => l.succ);
    const succTot = ligne('SUCCURSALES', act.filter(r => r.type === 'Succursale'));
    // Absentéisme (20/11/2026) : succursales France uniquement → pas de total réseau, qui laisserait croire à un taux toutes succursales
    succTot.absent = null;
    const segments = [['Succursales France', r => r.pays === 'FRANCE' && r.type === 'Succursale'], ['Franchises France', r => r.pays === 'FRANCE' && r.type === 'Franchise'], ['International', r => r.pays !== 'FRANCE']]
      .map(([n, f]) => ligne(n, act.filter(f)));
    // Site internet (cumul depuis janvier, devise locale par site, total en €)
    const st = (photo.groupe && photo.groupe.site) || null;
    const SITES = [['France', 'siteFrance', 'Euro'], ['Israel', 'siteIsrael', 'Shekel'], ['UK', 'siteUK', 'Livre Sterling'], ['Canada', 'siteCanada', 'Dollars Canadien']];
    const site = st ? { lignes: SITES.map(([k, o, dev]) => { const x = st.sites[k] || {}; return { nom: k, dev, ca: x.caN ?? null, evol: x.evolution ?? null, obj: objS[o], posit: (x.caN != null && objS[o]) ? x.caN * 12 / m / objS[o] : null }; }),
      nbLunettes: st.nbEquipements, panier: st.panierMoyen, manquants: st.manquants || [] } : null;
    if (site) { const t = site.lignes.reduce((a, l) => ({ ca: a.ca + (l.ca || 0) * (taux[l.dev] || 1), obj: a.obj + (l.obj || 0) * (taux[l.dev] || 1) }), { ca: 0, obj: 0 }); site.total = { nom: 'TOTAL (€)', ca: t.ca, obj: t.obj, posit: t.obj ? t.ca * 12 / m / t.obj : null }; }
    // Segments pour Confidence, MdC, visites, OC Mobile
    const SEG = [['Succursales', r => r.type === 'Succursale' && r.pays === 'FRANCE'], ['Franchises', r => r.type === 'Franchise' && r.pays === 'FRANCE'], ['International', r => r.pays !== 'FRANCE']];
    const aggSeg = f => agreger(act.filter(f).map(item), conv).N;
    const confidence = SEG.map(([nom, f]) => { const n = aggSeg(f), rs = act.filter(f); return { nom, devis: div(n.DI, n.DJ), n1: div(n.DK, n.DL), audio: div(n.DM, n.DN), global: div(n.DO, n.DP), utilisent: rs.filter(r => estActif(r) && ((photo.magasins[String(r.code)].N || {}).DP || 0) > 0).length, nb: rs.filter(estActif).length }; });
    const nT = agreger(act.map(item), conv).N;
    confidence.push({ nom: 'Total', devis: div(nT.DI, nT.DJ), n1: div(nT.DK, nT.DL), audio: div(nT.DM, nT.DN), global: div(nT.DO, nT.DP), utilisent: confidence.reduce((a, c) => a + c.utilisent, 0), nb: act.filter(estActif).length, tot: true });
    const mdc = SEG.slice(0, 2).map(([nom, f]) => ({ nom: nom + ' France', v: pct(aggSeg(f).AN) }));
    const visites = SEG.map(([nom, f]) => { const n = aggSeg(f); return { nom, ophta: (n.DX || 0) + (n.DW || 0), orl: (n.DV || 0) + (n.DY || 0), ce: n.DZ || 0 }; });
    const mobile = [['Succursales', 'Succursale', objS.mobileSucc], ['Franchises', 'Franchise', objS.mobileFranchise]].map(([nom, ty, ob]) => {
      const rs = act.filter(r => r.nature === 'Camion' && r.type === ty), n = agreger(rs.map(item), conv).N;
      return { nom, nb: rs.filter(estActif).length, ca: n.P, obj: ob, posit: (n.P != null && ob) ? n.P * 12 / m / ob : null, ndv: n.U, prot: n.AX };
    });
    { const a = mobile[0], b = mobile[1], ob = (a.obj || 0) + (b.obj || 0), ca = (a.ca || 0) + (b.ca || 0); mobile.push({ nom: 'Total', nb: a.nb + b.nb, ca, obj: ob, posit: ob ? ca * 12 / m / ob : null, ndv: (a.ndv || 0) + (b.ndv || 0), prot: (a.prot || 0) + (b.prot || 0), tot: true }); }
    const groupe = { obj: objS.groupe, ca: total.ca, posit: objS.groupe && total.prev != null ? total.prev / objS.groupe : null };
    return { type: 'siege', photo, pays, total, succ, succTot, segments, taux, site, confidence, mdc, mdcObj: objS.mdc, visites, mobile, groupe };
  }

  // ---------- Rendu A3 paysage ----------
  const H_PAGE = 1123, W_PAGE = 1587;
  function rendre(md, opts = {}) {
    const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, x => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[x]));
    const nb = (v, d = 0) => v == null || isNaN(v) ? '–' : Number(v).toLocaleString('fr-FR', { maximumFractionDigits: d, minimumFractionDigits: d });
    const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
    const f = (v, fmt, dev = '€') => {
      if (v == null || isNaN(v)) return '–';
      switch (fmt) {
        case 'k': return nb(v / 1000) + ' k' + dev;
        case 'eur': return nb(v) + ' ' + dev;
        case 'nb': return nb(v);
        case 'pct0': return nb(v * 100) + ' %';
        case 'pct1': return nb(v * 100, 1) + ' %';
        case 'pct2': return nb(v * 100, 2) + ' %';
        case 'pts2': return (v > 0 ? '+' : v < 0 ? '−' : '') + nb(Math.abs(v) * 100, 2) + ' pt';
        case 'evol': return (v > 0 ? '+' : '') + nb(v * 100, 1) + ' %';
        case 'note': return nb(v, 1);
        case 'nb1': return nb(v, 1);
        case 'ecart': return (v > 0 ? '+' : '') + nb(v, 1);
        case 'k1': return nb(v / 1000, 1) + '\u202fk' + dev;
        case 'kn': return nb(v / 1000);
        default: return nb(v);
      }
    };
    const logo = opts.logo || 'assets/logo-optical-center.png';
    // Périodes : le cumul Cosium suit le mois traité ; les restes dus et le reporting trimestriel ont leur propre date de fin.
    const finMoisFr = (a, m) => new Date(a, m, 0).toLocaleDateString('fr-FR');
    const isoFr = iso => iso.split('-').reverse().join('/');
    const perSrc = s => { const x = md.photo.sources && md.photo.sources[s]; if (!x) return null; if (x.periode) return x.periode;
      // Photos plus anciennes : période seulement dans le libellé (« FIN 2026-06 – 120 magasins »)
      const m = String(x.detail || '').match(/FIN\s*(\d{4})-(\d{2})/i); if (m) return { du: `${m[1]}-01-01`, au: `${m[1]}-${m[2]}-${String(new Date(+m[1], +m[2], 0).getDate()).padStart(2, '0')}` };
      return null; };
    const finLib = iso => { const [a, m] = iso.split('-').map(Number); return `fin ${MOIS[m - 1]} ${a}`; };
    const pR = perSrc('restes_dus'), pT = perSrc('rentabilites');
    const colsMd = md.cols || [];
    const utiliseRestes = md.type === 'siege' || colsMd.some(k => ['rdus', 'avoirs', 'gel', 'indus', 'evolIndus', 'recup'].includes(k));
    const utiliseReporting = md.type === 'siege' || colsMd.some(k => ['caHt', 're', 'marge', 'loyers', 'pub', 'personnel'].includes(k));
    let titreMois, periode;
    if (md.themeId === 'restes' && pR) { titreMois = `À ${finLib(pR.au)}`; periode = `restes dus du ${isoFr(pR.du)} au ${isoFr(pR.au)}`; }
    else {
      titreMois = `À fin ${MOIS[md.photo.mois - 1]} ${md.photo.annee}`;
      periode = `cumul du 1er janvier au ${finMoisFr(md.photo.annee, md.photo.mois)}`;
      const autres = [];
      if (utiliseReporting && pT && pT.au) autres.push(`reporting trimestriel à ${finLib(pT.au)}`);
      if (utiliseRestes && pR && pR.au) autres.push(`restes dus au ${isoFr(pR.au)}`);
      if (autres.length) periode += ' · ' + autres.join(' · ');
    }
    const entete = (perimLib, themeLib) => `<header class="ck-head"><img src="${logo}" alt=""><div class="ck-t"><div class="ck-label">${esc(titreMois)} · ${esc(periode)}</div><h1>${esc(perimLib)}</h1></div><div class="ck-theme">${esc(themeLib)}</div></header>`;
    const pied = `<footer class="ck-pied"><span>Optical Center · Suivi statistique · généré le ${new Date().toLocaleDateString('fr-FR')}</span><span class="slogan">Entendre et voir UNIQUEMENT le <b>BIEN</b></span><span>N-1 : même période de l’année précédente${md.multi || md.type === 'siege' ? ' · totaux multi-devises convertis en € (taux en Réglages)' : ''}</span></footer>`;

    if (md.type === 'siege') return rendreSiege(md, { esc, f, nb, entete, pied });
    if (md.type === 'ocmAct') return rendreOcmAct(md, { esc, f, nb, logo, pied, MOIS });

    const cl = (k, v, obj) => {
      const c = COL[k]; let ref = c.obj ? obj[c.obj] : c.seuil;
      if (v == null || ref == null) return c.fmt === 'evol' ? (v == null ? '' : v >= 0 ? 'ok' : 'ko') : '';
      if (c.seuil2 != null && c.inverse) return v <= ref ? 'ok' : v <= c.seuil2 ? 'moy' : 'ko';
      if (c.fmt === 'pts2' && v === 0) return '';
      return (c.inverse ? v <= ref : v >= ref) ? 'ok' : 'ko';
    };
    const cellules = (l, dev, cols = md.cols) => cols.map(k => `<td class="${cl(k, l.v[k], md.obj)}${COL[k].fort ? ' fort' : ''}">${f(l.v[k], COL[k].fmt, dev)}</td>`).join('');
    // Répartition en colonnes : on cherche le nombre de blocs qui tient sur la page
    const n = md.lignes.length;
    const hDispo = opts.hListe || 640;
    // maxBlocs (06/11/2026, demande d'Olivier) : Optique, Audio, Rentabilité & gestion restent sur 2 colonnes (comme
    // Restes dus) pour garder les noms de magasins lisibles ; l'appli lève le plafond si la page déborde.
    const plafond = (!opts.sansPlafond && md.theme && md.theme.maxBlocs) || 4;
    let blocs = 1; while (blocs < plafond && n / blocs * 10.5 > hDispo) blocs++;
    // Confidence (06/11/2026, demande d'Olivier) : dès que la liste passe sur 2 colonnes ou plus, seuls les taux
    // sont affichés dans le détail, titrés du nom de la liste (« Global » pour le taux global) ; la synthèse garde tout.
    let colsListe = md.cols; const libListe = {};
    if (md.themeId === 'confidence' && blocs > 1) {
      colsListe = md.cols.filter(k => /^cfT\d$/.test(k) || k === 'cfG');
      colsListe.forEach(k => { libListe[k] = k === 'cfG' ? 'Global' : COL['cfN' + k.slice(3)].lib; });
    } else if (blocs > 1 && md.theme && md.theme.sansSiColonnes) {
      colsListe = md.cols.filter(k => !md.theme.sansSiColonnes.includes(k));
    }
    const nCols = colsListe.length;
    if (blocs > 1 && nCols > 7) blocs = Math.min(blocs, 3);
    const thead = `<thead><tr><th class="rg">#</th><th class="nm">${md.perim.regrouper ? 'Franchisé' : 'Magasin'}</th>${colsListe.map(k => `<th>${esc(libListe[k] || COL[k].lib)}</th>`).join('')}</tr></thead>`;
    const parBloc = Math.ceil(n / blocs);
    const hLigne = Math.max(9, Math.min(22, hDispo / Math.max(1, parBloc)));
    const fs = Math.max(6.8, Math.min(11.5, hLigne * 0.68));
    const morceaux = []; for (let i = 0; i < n; i += parBloc) morceaux.push(md.lignes.slice(i, i + parBloc));
    const tables = morceaux.map(ls => `<table class="ck-liste" style="--h:${hLigne.toFixed(1)}px;--fs:${fs.toFixed(1)}px">${thead}<tbody>${ls.map(l => `<tr><td class="rg">${esc(l.rang)}</td><td class="nm"><b>${esc(l.nom)}</b><small>${esc(l.code)}</small></td>${cellules(l, l.dev || md.devTotal, colsListe)}</tr>`).join('')}</tbody></table>`).join('');

    const ligneSyn = (l, cls, lib) => `<tr class="${cls}"><td class="nm" colspan="2"><b>${esc(lib || l.nom)}</b>${l.n ? `<small>${l.n} mag.</small>` : ''}</td>${cellules(l, md.devTotal)}</tr>`;
    const synthese = `<table class="ck-syn"><thead><tr><th class="nm" colspan="2">${esc(md.sousLib || 'Périmètre')}</th>${md.cols.map(k => `<th>${esc(COL[k].lib)}</th>`).join('')}</tr></thead><tbody>
      ${md.sous.map(s => ligneSyn(s, '')).join('')}${ligneSyn(md.total, 'tot', 'TOTAL ' + (md.perim.lib.split(' – ')[1] || md.perim.lib))}</tbody></table>`;
    const tops = md.top.filter(t => t.liste.length).map(t => `<div class="ck-top"><div class="l">Top 3 · ${esc(t.lib)}</div>${t.liste.map((x, i) => `<div class="r"><span>${['🥇', '🥈', '🥉'][i]}</span><b>${esc(x[0])}</b><em>${f(x[1], t.fmt, md.devTotal)}</em></div>`).join('') || '<div class="r muted">–</div>'}</div>`).join('');
    const compteurs = md.compteurs.map(([l, v]) => `<div class="ck-cpt"><div class="v">${nb(v)}</div><div class="l">${esc(l)}</div></div>`).join('');
    // Positionnement du périmètre mois par mois (petite courbe à côté des compteurs)
    const spark = (() => { const s = md.serie; if (!s || s.length < 2) return '';
      const W = 230, H = 62, ps = s.map(x => x.posit), mn = Math.min(0.6, ...ps), mx = Math.max(1.15, ...ps);
      const X = i => 8 + i * (W - 16) / (s.length - 1), Y = v => H - 12 - (v - mn) / (mx - mn) * (H - 24);
      const pts = s.map((x, i) => `${X(i).toFixed(1)},${Y(x.posit).toFixed(1)}`).join(' '), der = s[s.length - 1];
      return `<div class="ck-cpt ck-spark"><div class="l">Positionnement mois par mois</div><svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><line x1="8" x2="${W - 8}" y1="${Y(1).toFixed(1)}" y2="${Y(1).toFixed(1)}" stroke="#1E8A52" stroke-dasharray="3 3"/><polyline points="${pts}" fill="none" stroke="#E22F2A" stroke-width="2"/>${s.map((x, i) => `<circle cx="${X(i).toFixed(1)}" cy="${Y(x.posit).toFixed(1)}" r="2.2" fill="${x.posit >= 1 ? '#1E8A52' : '#E22F2A'}"/>`).join('')}<text x="8" y="${H - 1}" class="sp-m">janv.</text><text x="${W - 8}" y="${H - 1}" text-anchor="end" class="sp-m">${esc(MOIS[der.mois - 1])} ${nb(der.posit * 100)} %</text></svg></div>`; })();

    if (md.type === 'multi') {
      // Colonnes sans aucune donnée sur le périmètre (ex. reporting pour les franchises) : retirées
      const plein = k => md.total.v[k] != null || md.lignes.some(l => l.v[k] != null);
      const sections = md.theme.sections.map(se => ({ lib: se.lib, groupes: se.groupes.map(g => [g[0], g[1].filter(plein)]).filter(g => g[1].length) })).filter(se => se.groupes.length);
      const nS = sections.length, nP = Math.max(1, opts.pages || 1), parPage = Math.ceil(n / nP);
      const libLigne = md.perim.regrouper ? 'Franchisé' : 'Magasin';
      // Plusieurs AR dans le périmètre : lignes regroupées par AR (ordre alphabétique), tri choisi conservé dans chaque AR
      const arsP = [...new Set(md.lignes.map(l => l.ar).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
      const parAr = !md.perim.regrouper && arsP.length > 1;
      const arIdx = {}; arsP.forEach((a, i) => { arIdx[a] = i; }); arIdx[''] = arsP.length;
      if (parAr) md.lignes = md.lignes.map((l, i) => [l, i]).sort((a, b) => (arIdx[a[0].ar] - arIdx[b[0].ar]) || (a[1] - b[1])).map(x => x[0]);
      const pages = [];
      for (let pI = 0; pI < nP; pI++) {
        const ls = md.lignes.slice(pI * parPage, (pI + 1) * parPage), dern = pI === nP - 1;
        const hDisp = (opts.hListe || 640) + (pI ? 70 : 0);
        const hL = Math.max(10, Math.min(24, (hDisp - nS * 62) / (nS * (ls.length + (dern ? 1 : 0)))));
        const fsM = Math.max(7.2, Math.min(11.5, hL * 0.62));
        const secs = sections.map(se => {
          const cols = se.groupes.flatMap(g => g[1]);
          const debut = k => se.groupes.some(g => g[1][0] === k);
          // 06/11/2026 (demande d'Olivier) : chaque famille de colonnes (CA, Optique, Audio, Restes dus…) a sa teinte
          const grpDe = {}; se.groupes.forEach((g, gi) => g[1].forEach(k => { grpDe[k] = gi % 6; }));
          const cellsC = (l, dev) => cols.map((k, i) => `<td class="${cl(k, l.v[k], md.obj)}${COL[k].fort ? ' fort' : ''}${debut(k) && i ? ' sep' : ''} zg${grpDe[k]}">${f(l.v[k], COL[k].fmt, dev)}</td>`).join('');
          // … et quand le périmètre compte plusieurs AR (ex. Paris), les magasins sont regroupés par AR avec une bande de couleur
          const colAr = parAr ? '<th class="arb"></th>' : '';
          const lignesHtml = (() => {
            if (!parAr) return ls.map(l => `<tr><td class="rg">${esc(l.rang)}</td><td class="nm"><b>${esc(l.nom)}</b><small>${esc(l.code)}</small></td>${cellsC(l, l.dev || md.devTotal)}</tr>`).join('');
            let html = '';
            for (let i = 0; i < ls.length;) {
              let j = i; while (j < ls.length && ls[j].ar === ls[i].ar) j++;
              const k = j - i, ci = arIdx[ls[i].ar] % 8, nomAr = ls[i].ar || '—';
              const lib = k >= 4 ? nomAr : nomAr.split(/\s+/).map(x => x[0] || '').join('').toUpperCase();
              for (let x = i; x < j; x++) {
                const l = ls[x];
                html += `<tr class="ar${ci}${x === i ? ' ar-deb' : ''}">${x === i ? `<td class="arb" rowspan="${k}"><span>${esc(lib)}</span></td>` : ''}<td class="rg">${esc(l.rang)}</td><td class="nm"><b>${esc(l.nom)}</b><small>${esc(l.code)}</small></td>${cellsC(l, l.dev || md.devTotal)}</tr>`;
              }
              i = j;
            }
            return html;
          })();
          return `<section class="ck-sec"><h2><span>${esc(se.lib)}</span></h2><table class="ck-liste ck-multi" style="--h:${hL.toFixed(1)}px;--fs:${fsM.toFixed(1)}px"><thead>
            <tr class="grp">${colAr}<th class="rg"></th><th class="nm"></th>${se.groupes.map((g, gi) => `<th colspan="${g[1].length}" class="sep zg${gi % 6}">${esc(g[0])}</th>`).join('')}</tr>
            <tr>${colAr}<th class="rg">#</th><th class="nm">${libLigne}</th>${cols.map((k, i) => `<th class="${debut(k) && i ? 'sep' : ''} zg${grpDe[k]}">${esc(COL[k].lib)}</th>`).join('')}</tr></thead>
            <tbody>${lignesHtml}
            ${dern ? `<tr class="tot">${parAr ? '<td class="arb"></td>' : ''}<td class="rg"></td><td class="nm"><b>TOTAL</b><small>${n} ${md.perim.regrouper ? 'franchisés' : 'mag.'}</small></td>${cellsC(md.total, md.devTotal)}</tr>` : ''}</tbody></table></section>`;
        }).join('');
        const piedP = nP > 1 ? pied.replace('</footer>', `<span><b>Page ${pI + 1} / ${nP}</b></span></footer>`) : pied;
        pages.push(`<div class="cockpit multi${pI ? ' suite' : ''}" data-blocs="1">
        ${entete(md.perim.lib + (pI ? ' (suite)' : ''), md.theme.lib)}
        ${pI ? '' : `<div class="ck-haut"><div class="ck-cpts">${compteurs}${spark}</div><div class="ck-tops quatre">${tops}</div></div>`}
        <div class="ck-corps ck-blocs">${secs}</div>
        ${piedP}</div>`);
      }
      return pages.join('');
    }
    return `<div class="cockpit${blocs > 1 ? ' noms-fins' : ''}" data-blocs="${blocs}">
      ${entete(md.perim.lib, md.theme.lib)}
      <div class="ck-haut"><div class="ck-cpts">${compteurs}${spark}</div><div class="ck-tops">${tops}</div></div>
      <section class="ck-sec"><h2><span>Synthèse</span></h2>${synthese}</section>
      <section class="ck-sec ck-corps"><h2><span>Détail par ${md.perim.regrouper ? 'franchisé' : 'magasin'}</span><small>${n} ${md.perim.regrouper ? 'franchisés' : 'magasins'} · tri : ${esc(opts.triLib || 'code')}</small></h2><div class="ck-blocs" style="--blocs:${blocs}">${tables}</div></section>
      ${pied}</div>`;
  }

  function rendreSiege(md, { esc, f, nb, entete, pied }) {
    const c = (v, ok) => v == null ? '' : ok ? 'ok' : 'ko';
    const t = md.total, g = md.groupe;
    const VERT = '#1E8A52', ROUGE = '#E22F2A', ORANGE = '#D9822B', GRIS = '#ECE7E6';
    const coulPosit = v => v == null ? '#8C8C8C' : v >= 1 ? VERT : v >= 0.95 ? ORANGE : ROUGE;
    // Anneau de progression (SVG) : v = ratio, plafonné visuellement à 100 %
    const anneau = (v, taille, epais, coul, txt, sous) => {
      const r = (taille - epais) / 2, circ = 2 * Math.PI * r, p = Math.max(0, Math.min(1, v || 0));
      return `<svg class="sg-anneau" width="${taille}" height="${taille}" viewBox="0 0 ${taille} ${taille}"><circle cx="${taille / 2}" cy="${taille / 2}" r="${r}" fill="none" stroke="${GRIS}" stroke-width="${epais}"/>
        <circle cx="${taille / 2}" cy="${taille / 2}" r="${r}" fill="none" stroke="${coul}" stroke-width="${epais}" stroke-linecap="round" stroke-dasharray="${(circ * p).toFixed(1)} ${circ.toFixed(1)}" transform="rotate(-90 ${taille / 2} ${taille / 2})"/>
        <text x="50%" y="${sous ? '47%' : '53%'}" text-anchor="middle" dominant-baseline="middle" class="sg-a-v" style="font-size:${(taille * 0.2).toFixed(0)}px;fill:${coul}">${txt}</text>${sous ? `<text x="50%" y="66%" text-anchor="middle" class="sg-a-s" style="font-size:${(taille * 0.085).toFixed(0)}px">${sous}</text>` : ''}</svg>`;
    };
    // Barre de positionnement : échelle 0 → 120 %, repère à 100 %
    const barre = v => v == null ? '<span class="sg-barre vide"></span>' : `<span class="sg-barre"><i style="width:${(Math.min(1.2, Math.max(0, v)) / 1.2 * 100).toFixed(1)}%;background:${coulPosit(v)}"></i><b></b></span>`;
    const posCell = v => `<td class="sg-pos"><span class="sg-pos-l">${barre(v)}<em style="color:${coulPosit(v)}">${f(v, 'pct0')}</em></span></td>`;
    // Part du CA du réseau (mini barre)
    const part = v => `<span class="sg-part"><i style="width:${t.ca ? Math.min(100, v / t.ca * 100).toFixed(1) : 0}%"></i></span>`;

    // Donut de répartition du CA par segment
    const segs = md.segments.map((s, i) => ({ nom: s.nom, v: s.ca || 0, coul: ['#231F20', '#E22F2A', '#C9B8B6'][i] }));
    const somme = segs.reduce((a, s) => a + s.v, 0) || 1;
    let ang = -Math.PI / 2; const R0 = 46, R1 = 30, cx = 52, cy = 52;
    const arcs = segs.map(s => { const a = s.v / somme * Math.PI * 2, a2 = ang + a, grand = a > Math.PI ? 1 : 0;
      const p = (r, x) => `${(cx + r * Math.cos(x)).toFixed(2)} ${(cy + r * Math.sin(x)).toFixed(2)}`;
      const d = `M ${p(R0, ang)} A ${R0} ${R0} 0 ${grand} 1 ${p(R0, a2 - 0.0001)} L ${p(R1, a2 - 0.0001)} A ${R1} ${R1} 0 ${grand} 0 ${p(R1, ang)} Z`; ang = a2; return `<path d="${d}" fill="${s.coul}"/>`; }).join('');
    const donut = `<div class="sg-donut"><svg width="104" height="104" viewBox="0 0 104 104">${arcs}</svg><div class="sg-leg">${segs.map(s => `<div><i style="background:${s.coul}"></i>${esc(s.nom)}<b>${nb(s.v / somme * 100)} %</b></div>`).join('')}</div></div>`;

    // Bandeau de tête
    const progCA = g.obj ? Math.min(1, (t.ca || 0) / g.obj) : 0, attendu = g.obj ? md.photo.mois / 12 : 0;
    const heros = `<div class="sg-heros">
      <div class="sg-ca"><div class="l">CA généré groupe · cumul</div><div class="v">${f(t.ca, 'k')}</div>
        <div class="evo ${t.evol >= 0 ? 'ok' : 'ko'}">${t.evol >= 0 ? '▲' : '▼'} ${f(t.evol, 'evol')} vs N-1</div>
        <div class="sg-prog"><i style="width:${(progCA * 100).toFixed(1)}%"></i><b style="left:${(attendu * 100).toFixed(1)}%" title="rythme attendu"></b></div>
        <div class="s">${nb(progCA * 100)} % de l’objectif groupe ${f(g.obj, 'k')} · repère : ${nb(attendu * 100)} % de l’année écoulée</div></div>
      <div class="sg-ring">${anneau(g.posit, 112, 12, coulPosit(g.posit), f(g.posit, 'pct0'))}<div class="s"><b class="sg-ring-t">Positionnement groupe</b>prévisionnel ${f(t.prev, 'k')}<br>objectif groupe ${f(g.obj, 'k')}</div></div>
      <div class="sg-kpis">
        <div><div class="v">${nb(t.succ + t.fr)}</div><div class="l">magasins</div><div class="s">${t.succ} succ. · ${t.fr} franch.</div></div>
        <div><div class="v">${nb(t.sup12)}</div><div class="l">magasins à prévisionnel ≥ 1,2 M€</div><div class="s">${nb(t.sup12 / Math.max(1, t.succ + t.fr) * 100)} % du réseau</div></div>
        <div><div class="v ${c(t.evolNdv, t.evolNdv >= 0)}">${f(t.evolNdv, 'evol')}</div><div class="l">ventes optique</div><div class="s">${nb(t.ndv)} ventes</div></div>
        <div><div class="v ${c(t.evolNdvA, t.evolNdvA >= 0)}">${f(t.evolNdvA, 'evol')}</div><div class="l">ventes audio</div><div class="s">${nb(t.ndvA)} ventes</div></div>
      </div>
      <div class="sg-rep"><div class="l">Répartition du CA</div>${donut}</div>
    </div>`;

    const L = (l, cls = '') => `<tr class="${cls}"><td class="nm"><b>${esc(l.nom)}</b></td><td class="fort sg-ca-c">${f(l.ca, 'kn')}${cls === 'tot' ? '' : part(l.ca)}</td><td class="${c(l.evol, l.evol >= 0)}">${f(l.evol, 'evol')}</td><td>${f(l.obj, 'kn')}</td>${posCell(l.posit)}<td>${f(l.prev, 'kn')}</td><td>${nb(l.succ)}</td><td>${nb(l.fr)}</td><td>${nb(l.sup12)}</td>
      <td class="${c(l.evolOpt, l.evolOpt >= 0)}">${f(l.evolOpt, 'evol')}</td><td class="${c(l.evolAud, l.evolAud >= 0)}">${f(l.evolAud, 'evol')}</td><td>${nb(l.ndv)}</td><td class="${c(l.evolNdv, l.evolNdv >= 0)}">${f(l.evolNdv, 'evol')}</td><td>${nb(l.ndvA)}</td><td class="${c(l.evolNdvA, l.evolNdvA >= 0)}">${f(l.evolNdvA, 'evol')}</td></tr>`;
    const head = `<thead><tr><th class="nm"></th><th>CA généré (k€)</th><th>Évol. CA</th><th>Objectif (k€)</th><th class="sg-pos">Positionnement</th><th>Prévisionnel (k€)</th><th>Succ.</th><th>Franch.</th><th>≥ 1,2 M€</th><th>Évol. CA optique</th><th>Évol. CA audio</th><th>Ventes optique</th><th>Évol.</th><th>Ventes audio</th><th>Évol.</th></tr></thead>`;
    const R = (l, cls = '') => `<tr class="${cls}"><td class="nm"><b>${esc(l.nom)}</b><small>${l.succ} succ.</small></td><td>${f(l.ca, 'kn')}</td><td class="${c(l.re, l.re >= 0.2)}">${f(l.re, 'pct1')}</td><td class="${c(l.marge, l.marge >= 0.7)}">${f(l.marge, 'pct1')}</td><td class="${c(l.loyers, l.loyers <= 0.06)}">${f(l.loyers, 'pct1')}</td><td class="${c(l.pub, l.pub <= 0.07)}">${f(l.pub, 'pct1')}</td><td class="${c(l.rentaSal, l.rentaSal <= 0.28)}">${f(l.rentaSal, 'pct1')}</td><td class="${l.absent == null ? '' : l.absent <= COL.absent.seuil ? 'ok' : l.absent <= COL.absent.seuil2 ? 'moy' : 'ko'}">${f(l.absent, 'pct1')}</td><td>${l.note == null ? '–' : '<span class="sg-etoile">★</span> ' + nb(l.note, 1)}</td><td>${nb(l.avis)}</td></tr>`;
    const DS = { 'Euro': '€', 'Shekel': '₪', 'Livre Sterling': '£', 'Dollars Canadien': '$' };
    const site = !md.site ? '<div class="nd">Données du site internet non chargées (copier-coller du mail de fin de mois).</div>' : `<div class="sg-lignes">
      ${md.site.lignes.map(l => `<div class="sg-ligne"><span class="n"><b>${esc(l.nom)}</b><small>${f(l.ca, 'kn')} k${DS[l.dev]} / ${f(l.obj, 'kn')}</small></span>${barre(l.posit)}<em style="color:${coulPosit(l.posit)}">${f(l.posit, 'pct0')}</em><span class="e ${c(l.evol, l.evol >= 0)}">${f(l.evol, 'evol')}</span></div>`).join('')}
      <div class="sg-ligne tot"><span class="n"><b>Total (€)</b><small>${f(md.site.total.ca, 'kn')} k€ / ${f(md.site.total.obj, 'kn')}</small></span>${barre(md.site.total.posit)}<em style="color:${coulPosit(md.site.total.posit)}">${f(md.site.total.posit, 'pct0')}</em><span class="e"></span></div></div>
      <div class="ck-mini"><span>Lunettes de vue (OC.fr) <b>${nb(md.site.nbLunettes)}</b></span><span>Panier moyen <b>${f(md.site.panier, 'eur')}</b></span>${md.site.manquants.length ? `<span class="ko">mois manquants : ${md.site.manquants.join(', ')}</span>` : ''}</div>`;
    const mobile = `<div class="sg-mobile">${md.mobile.map(l => `<div class="${l.tot ? 'tot' : ''}">${anneau(l.posit, 58, 6, coulPosit(l.posit), f(l.posit, 'pct0'))}<div><b>${esc(l.nom)}</b><span>${nb(l.nb)} camion${l.nb > 1 ? 's' : ''}</span><span>${f(l.ca, 'kn')} k€ / ${f(l.obj, 'kn')} k€</span><span>${nb(l.ndv)} ventes · ${nb(l.prot)} proth.</span></div></div>`).join('')}</div>`;
    const conf = `<div class="sg-conf"><div class="sg-conf-t"><span></span><span>Devis optique</span><span>Optique N+1</span><span>Audio N+4</span><span>Global</span><span>Utilisateurs</span></div>
      ${md.confidence.map(l => `<div class="sg-conf-l ${l.tot ? 'tot' : ''}"><b>${esc(l.nom)}</b>${[l.devis, l.n1, l.audio, l.global].map((v, i) => `<span class="${i === 3 ? 'fort' : ''}"><span class="sg-jauge"><i style="width:${Math.min(100, (v || 0) * 100).toFixed(0)}%"></i></span>${f(v, 'pct0')}</span>`).join('')}<span>${nb(l.utilisent)} / ${nb(l.nb)}</span></div>`).join('')}</div>`;
    const mdc = `<div class="sg-mdc">${md.mdc.map(x => `<div>${anneau(x.v, 66, 7, x.v == null ? '#8C8C8C' : x.v >= md.mdcObj ? VERT : ROUGE, f(x.v, 'pct0'))}<div><b>${esc(x.nom)}</b><span>${f(x.v, 'pct1')} · objectif ${f(md.mdcObj, 'pct0')}</span></div></div>`).join('')}</div>`;
    const vT = { ophta: md.visites.reduce((a, l) => a + l.ophta, 0), orl: md.visites.reduce((a, l) => a + l.orl, 0), ce: md.visites.reduce((a, l) => a + l.ce, 0) };
    const vis = `<div class="sg-vis">${[['Ophta', 'ophta'], ['ORL', 'orl'], ['CE', 'ce']].map(([lib, k]) => `<div><div class="v">${nb(vT[k])}</div><div class="l">${lib}</div><div class="s">${md.visites.map(l => `${esc(l.nom.slice(0, 5))}. ${nb(l[k])}`).join(' · ')}</div></div>`).join('')}</div>`;
    return `<div class="cockpit siege sg">
      ${entete('Réseau Optical Center', 'Vue Siège')}
      ${heros}
      <section class="ck-sec"><h2><span>Chiffre d’affaires par pays et par segment</span><small>positionnement : vert ≥ 100 %, orange ≥ 95 %, rouge en dessous · barre grise = part du CA réseau</small></h2><table class="ck-syn sg-pays">${head}<tbody>${md.pays.map(l => L(l)).join('')}${L(t, 'tot')}${md.segments.map(l => L(l, 'seg')).join('')}</tbody></table></section>
      <div class="ck-g2">
        <section class="ck-sec"><h2><span>Rentabilité succursales par pays</span><small>reporting trimestriel · renta salariale et absentéisme cumulés · absentéisme : succursales France</small></h2><table class="ck-syn"><thead><tr><th class="nm"></th><th>CA généré (k€)</th><th>RE</th><th>Marge produits</th><th>Loyers chargés</th><th>Publicité</th><th>Renta salariale</th><th>Absen&shy;téisme</th><th>Note Google</th><th>Avis</th></tr></thead><tbody>${md.succ.map(l => R(l)).join('')}${R(md.succTot, 'tot')}</tbody></table></section>
        <div class="ck-col">
          <section class="ck-sec"><h2><span>Site internet</span><small>CA TTC cumulé · positionnement vs objectif</small></h2>${site}</section>
          <section class="ck-sec"><h2><span>Confidence</span><small>taux de contact par liste</small></h2>${conf}</section>
        </div>
      </div>
      <div class="ck-g3">
        <section class="ck-sec"><h2><span>OC Mobile</span></h2>${mobile}</section>
        <section class="ck-sec"><h2><span>Taux de MdC</span></h2>${mdc}</section>
        <section class="ck-sec"><h2><span>Visites externes</span></h2>${vis}</section>
      </div>
      ${pied}</div>`;
  }

  const LISTES_CONF_DEFAUT = ['Rappel Devis Optique', 'Rappel Optique N+1', 'Rappel Audio N+4'];

  // ===== Activité OC Mobile =====
  // photo.ocmActivite = { mois: 'AAAA-MM', arretes, ocm: { Ville: { mois: { 'AAAA-MM': { relevés Antsroute, CA Cosium (k€), transformation } }, potentiel } } }
  function construireOcmAct(photo, ref, perim) {
    const A = photo.ocmActivite || null;
    if (!A) return { type: 'ocmAct', photo, perim, vide: true };
    const m = A.mois, [an, mo] = m.split('-').map(Number), pm = mo > 1 ? `${an}-${String(mo - 1).padStart(2, '0')}` : null;
    const camions = ref.filter(r => perim.filtre ? perim.filtre(r) : true);
    const S = (l, k) => l.reduce((a, x) => a + (+(x && x[k]) || 0), 0);
    const lignes = [], inactifs = [];
    for (const [ville, v] of Object.entries(A.ocm).sort((a, b) => a[0].localeCompare(b[0], 'fr'))) {
      const ms = v.mois || {}, x = ms[m] || {}, p = (pm && ms[pm]) || {};
      if (!x.rdv) { inactifs.push(ville); continue; }
      const cumul = Object.keys(ms).filter(k => k <= m).map(k => ms[k]);
      const po = v.potentiel || {};
      const r = camions.find(c => norm(c.magasin).includes(norm(ville)));
      const n = r && photo.magasins[String(r.code)] ? photo.magasins[String(r.code)].N || {} : null;
      lignes.push({ ville, code: r ? String(r.code) : '', x, p,
        rdvDelta: p.rdv != null ? x.rdv - p.rdv : null, rdvJour: x.jours ? x.rdv / x.jours : null,
        tauxAnnul: (x.rdv || 0) + (x.annulations || 0) ? (x.annulations || 0) / ((x.rdv || 0) + (x.annulations || 0)) : null,
        attM: x.objectif ? x.ca / x.objectif : null, attA: x.objectifAnnuel ? x.caAnnuel / x.objectifAnnuel : null,
        evolA: x.caAnnuelN1 ? x.caAnnuel / x.caAnnuelN1 - 1 : null,
        dep: S(cumul, 'depistInd'), tr: S(cumul, 'transformes'),
        pot: { vNb: po.faNonFactNb || 0, vEur: po.faNonFactEur || 0, lNb: po.faFactNonLivreNb || 0, lEur: po.faFactNonLivreEur || 0, dNb: po.vnDevisNb || 0, dEur: po.vnDevisEur || 0,
          retard: po.faRetardNb || 0, vns: po.vnNb || 0, renouv: po.vnRenDueNb || 0 },
        posit: n ? COL.posit.f(n, null, photo.mois) : null, mrq: n ? n.CK : null, indus: n ? n.BV : null });
    }
    lignes.forEach(l => { l.potTot = l.pot.vEur + l.pot.lEur + l.pot.dEur; });
    const T = k => lignes.reduce((a, l) => a + (+l.x[k] || 0), 0);
    const tot = { rdv: T('rdv'), rdvPrec: lignes.reduce((a, l) => a + (+l.p.rdv || 0), 0), jours: T('jours'), deplacements: T('deplacements'), annulations: T('annulations'), ventes: T('ventes'),
      ca: T('ca'), objectif: T('objectif'), caAnnuel: T('caAnnuel'), objectifAnnuel: T('objectifAnnuel'), caAnnuelN1: T('caAnnuelN1'),
      livraisons: T('livraisons'), depistages: T('depistages'), reglages: T('reglages'), demarchages: T('demarchages'), autres: T('autres'),
      dep: lignes.reduce((a, l) => a + l.dep, 0), tr: lignes.reduce((a, l) => a + l.tr, 0), potTot: lignes.reduce((a, l) => a + l.potTot, 0) };
    ['vNb', 'vEur', 'lNb', 'lEur', 'dNb', 'dEur', 'retard', 'vns', 'renouv'].forEach(k => { tot['pot_' + k] = lignes.reduce((a, l) => a + l.pot[k], 0); });
    // CA mois par mois (OCM actifs du mois) : réalisé, objectif, N-1
    const serie = [];
    for (let i = 1; i <= mo; i++) { const k = `${an}-${String(i).padStart(2, '0')}`; let ca = 0, ob = 0, n1 = 0;
      lignes.forEach(l => { const y = (A.ocm[l.ville].mois || {})[k] || {}; ca += +y.ca || 0; ob += +y.objectif || 0; n1 += +y.caN1 || 0; }); serie.push({ mois: i, ca, ob, n1 }); }
    const partiel = lignes.some(l => l.x.partiel);
    return { type: 'ocmAct', photo, perim, A, mois: m, an, mo, lignes, tot, inactifs, serieCa: serie, partiel };
  }

  function rendreOcmAct(md, { esc, f, nb, logo, pied, MOIS }) {
    const isoFr = iso => iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '–';
    if (md.vide) return `<div class="cockpit"><header class="ck-head"><img src="${logo}" alt=""><div class="ck-t"><div class="ck-label">À fin ${esc(MOIS[md.photo.mois - 1])} ${md.photo.annee}</div><h1>${esc(md.perim.lib)}</h1></div><div class="ck-theme">Activité OC Mobile</div></header>
      <p class="muted" style="padding:30px 0">Aucune donnée d’activité OC Mobile pour ce mois : déposez le fichier « ocm-activite_AAAA-MM.json » (préparé par Claude depuis l’artefact) dans Import du mois, puis « Compléter » et enregistrez.</p>${pied}</div>`;
    const a = md.A.arretes || {}, t = md.tot;
    const pc = v => v == null || isNaN(v) ? '–' : nb(v * 100) + ' %';
    const sg = v => v == null ? '' : v > 0 ? '+' + nb(v) : v < 0 ? '−' + nb(-v) : '=';
    const k = v => v == null ? '–' : nb(v, 1) + '\u202fk€';
    const att = v => v == null ? '' : v >= 1 ? 'ok' : v < 0.8 ? 'ko' : 'moy';
    const rythme = md.mo / 12;
    const titre = `${MOIS[md.mo - 1].replace(/^./, c => c.toUpperCase())} ${md.an} · relevés Antsroute au ${isoFr(a.releves)} · CA Cosium au ${isoFr(a.cosium)}${md.partiel ? ' (mois partiel)' : ''} · CA potentiel au ${isoFr(a.potentiel)}`;
    const vign = (v, l, s, c) => `<div class="ck-cpt oa-cpt"><div class="v ${c || ''}">${v}</div><div class="l">${esc(l)}</div>${s ? `<div class="s">${s}</div>` : ''}</div>`;
    const dRdv = t.rdvPrec ? t.rdv - t.rdvPrec : null;
    const vignettes = [
      vign(nb(t.rdv), 'RDV effectués', dRdv == null ? '' : `${sg(dRdv)} vs ${MOIS[(md.mo + 10) % 12]}`),
      vign(k(t.ca), 'CA du mois', `atteinte ${pc(t.objectif ? t.ca / t.objectif : null)}${md.partiel ? ' · partiel' : ''}`, att(t.objectif ? t.ca / t.objectif : null)),
      vign(pc(t.objectifAnnuel ? t.caAnnuel / t.objectifAnnuel : null), 'Atteinte annuelle', `${k(t.caAnnuel)} · rythme ${pc(rythme)}`, t.objectifAnnuel && t.caAnnuel / t.objectifAnnuel >= rythme * 0.8 ? 'ok' : 'ko'),
      vign(pc(t.dep ? t.tr / t.dep : null), 'Transformation des dépistages', `${nb(t.tr)} ventes / ${nb(t.dep)} dépistages depuis janvier`),
      vign(nb(t.potTot) + ' €', 'CA potentiel', `dont ${nb(t.pot_vEur)} € de devis validés à facturer`)].join('');
    // Courbe : CA mensuel (barres) et objectif (trait)
    const W = 430, H = 118, mx = Math.max(1, ...md.serieCa.map(s => Math.max(s.ca, s.ob, s.n1))), bw = (W - 30) / 12;
    const Y = v => H - 18 - (v / mx) * (H - 30);
    const courbe = `<div class="ck-top oa-courbe"><div class="l">CA mois par mois (k€) · OCM actifs</div><svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
      ${md.serieCa.map((s, i) => { const x = 20 + i * bw; return `<rect x="${(x + bw * 0.12).toFixed(1)}" y="${Y(s.n1).toFixed(1)}" width="${(bw * 0.34).toFixed(1)}" height="${(H - 18 - Y(s.n1)).toFixed(1)}" fill="#D9D3D1"/><rect x="${(x + bw * 0.48).toFixed(1)}" y="${Y(s.ca).toFixed(1)}" width="${(bw * 0.4).toFixed(1)}" height="${(H - 18 - Y(s.ca)).toFixed(1)}" fill="${s.ob && s.ca >= s.ob ? '#1E8A52' : '#E22F2A'}"/><text x="${(x + bw / 2).toFixed(1)}" y="${H - 5}" text-anchor="middle" class="sp-m">${['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'][i]}</text>`; }).join('')}
      <polyline points="${md.serieCa.map((s, i) => `${(20 + i * bw + bw / 2).toFixed(1)},${Y(s.ob).toFixed(1)}`).join(' ')}" fill="none" stroke="#1A1A1A" stroke-width="1.5" stroke-dasharray="4 3"/>
      </svg><div class="oa-leg"><span class="b r"></span>CA du mois <span class="b g"></span>N-1 <span class="t"></span>objectif</div></div>`;
    const ligne1 = l => `<tr><td class="nm"><b>${esc(l.ville)}</b><small>${esc(l.code)}</small></td>
      <td class="zg0 sep">${nb(l.x.rdv)}</td><td class="zg0 ${l.p.rdv && l.rdvDelta / l.p.rdv < -0.2 ? 'ko' : ''}">${sg(l.rdvDelta)}</td><td class="zg0">${nb(l.rdvJour, 1)}</td><td class="zg0">${nb(l.x.deplacements)}</td><td class="zg0 ${l.x.annulations > 5 ? 'ko' : ''}">${nb(l.x.annulations)} <small>${pc(l.tauxAnnul)}</small></td>
      <td class="zg1 sep">${nb(l.x.ventes)}</td><td class="zg1 fort">${k(l.x.ca)}</td><td class="zg1 ${att(l.attM)}">${pc(l.attM)}</td><td class="zg1">${k(l.x.caAnnuel)}</td><td class="zg1 ${att(l.attA == null ? null : l.attA / rythme)}">${pc(l.attA)}</td><td class="zg1 ${l.evolA == null ? '' : l.evolA >= 0 ? 'ok' : 'ko'}">${l.evolA == null ? '–' : (l.evolA > 0 ? '+' : '') + nb(l.evolA * 100, 1) + ' %'}</td>
      <td class="zg2 sep">${pc(l.dep ? l.tr / l.dep : null)} <small>${nb(l.tr)} / ${nb(l.dep)}</small></td>
      <td class="zg3 sep ${l.posit == null ? '' : l.posit >= 1 ? 'ok' : 'ko'}">${pc(l.posit)}</td><td class="zg3">${l.mrq == null ? '–' : nb(l.mrq)}</td><td class="zg3 ${l.indus == null ? '' : l.indus <= 0.01 ? 'ok' : l.indus > 0.02 ? 'ko' : ''}">${l.indus == null ? '–' : nb(l.indus * 100, 2) + ' %'}</td></tr>`;
    const tot1 = `<tr class="tot"><td class="nm"><b>TOTAL</b><small>${md.lignes.length} OCM</small></td><td class="zg0 sep">${nb(t.rdv)}</td><td class="zg0">${sg(dRdv)}</td><td class="zg0">${nb(t.jours ? t.rdv / t.jours : null, 1)}</td><td class="zg0">${nb(t.deplacements)}</td><td class="zg0">${nb(t.annulations)} <small>${pc(t.rdv + t.annulations ? t.annulations / (t.rdv + t.annulations) : null)}</small></td>
      <td class="zg1 sep">${nb(t.ventes)}</td><td class="zg1">${k(t.ca)}</td><td class="zg1">${pc(t.objectif ? t.ca / t.objectif : null)}</td><td class="zg1">${k(t.caAnnuel)}</td><td class="zg1">${pc(t.objectifAnnuel ? t.caAnnuel / t.objectifAnnuel : null)}</td><td class="zg1">${t.caAnnuelN1 ? (t.caAnnuel / t.caAnnuelN1 - 1 > 0 ? '+' : '') + nb((t.caAnnuel / t.caAnnuelN1 - 1) * 100, 1) + ' %' : '–'}</td>
      <td class="zg2 sep">${pc(t.dep ? t.tr / t.dep : null)} <small>${nb(t.tr)} / ${nb(t.dep)}</small></td><td class="zg3 sep"></td><td class="zg3"></td><td class="zg3"></td></tr>`;
    const tab1 = `<table class="ck-liste ck-multi oa-t" style="--h:24px;--fs:10.5px"><thead>
      <tr class="grp"><th class="nm"></th><th colspan="5" class="sep zg0">Activité Antsroute</th><th colspan="6" class="sep zg1">Chiffre d’affaires Cosium</th><th class="sep zg2">Dépistages</th><th colspan="3" class="sep zg3">Suivi Stats</th></tr>
      <tr><th class="nm">OCM</th><th class="sep zg0">RDV</th><th class="zg0">vs mois préc.</th><th class="zg0">RDV / jour</th><th class="zg0">Déplac.</th><th class="zg0">Annulations</th><th class="sep zg1">Ventes</th><th class="zg1">CA du mois</th><th class="zg1">Atteinte mois</th><th class="zg1">CA cumulé</th><th class="zg1">Atteinte ann.</th><th class="zg1">Cumul vs N-1</th><th class="sep zg2">Transfo.</th><th class="sep zg3">Positionnement</th><th class="zg3">Mr Qualité</th><th class="zg3">Taux d’indus</th></tr></thead>
      <tbody>${md.lignes.map(ligne1).join('')}${tot1}</tbody></table>`;
    const e = (n, eur) => `${nb(n)} <small>${nb(eur)} €</small>`;
    const ligne2 = l => `<tr><td class="nm"><b>${esc(l.ville)}</b><small>${esc(l.code)}</small></td>
      <td class="zg4 sep">${nb(l.x.livraisons)}</td><td class="zg4">${nb(l.x.depistages)}</td><td class="zg4">${nb(l.x.reglages)}</td><td class="zg4">${nb(l.x.ventes)}</td><td class="zg4">${nb(l.x.demarchages)}</td><td class="zg4">${nb(l.x.autres)}</td>
      <td class="zg5 sep">${e(l.pot.vNb, l.pot.vEur)}</td><td class="zg5">${e(l.pot.lNb, l.pot.lEur)}</td><td class="zg5">${e(l.pot.dNb, l.pot.dEur)}</td><td class="zg5 fort">${nb(l.potTot)} €</td><td class="zg5 ${l.pot.retard ? 'ko' : ''}">${nb(l.pot.retard)}</td><td class="zg5">${nb(l.pot.vns)}</td><td class="zg5">${nb(l.pot.renouv)}</td></tr>`;
    const tot2 = `<tr class="tot"><td class="nm"><b>TOTAL</b></td><td class="zg4 sep">${nb(t.livraisons)}</td><td class="zg4">${nb(t.depistages)}</td><td class="zg4">${nb(t.reglages)}</td><td class="zg4">${nb(t.ventes)}</td><td class="zg4">${nb(t.demarchages)}</td><td class="zg4">${nb(t.autres)}</td>
      <td class="zg5 sep">${e(t.pot_vNb, t.pot_vEur)}</td><td class="zg5">${e(t.pot_lNb, t.pot_lEur)}</td><td class="zg5">${e(t.pot_dNb, t.pot_dEur)}</td><td class="zg5">${nb(t.potTot)} €</td><td class="zg5">${nb(t.pot_retard)}</td><td class="zg5">${nb(t.pot_vns)}</td><td class="zg5">${nb(t.pot_renouv)}</td></tr>`;
    const tab2 = `<table class="ck-liste ck-multi oa-t" style="--h:24px;--fs:10.5px"><thead>
      <tr class="grp"><th class="nm"></th><th colspan="6" class="sep zg4">Répartition des RDV par activité</th><th colspan="7" class="sep zg5">CA potentiel à aller chercher (TTC)</th></tr>
      <tr><th class="nm">OCM</th><th class="sep zg4">Livraisons</th><th class="zg4">Dépistages</th><th class="zg4">Réglages / SAV</th><th class="zg4">Ventes</th><th class="zg4">Démarchages</th><th class="zg4">Autres</th><th class="sep zg5">Devis validés à facturer</th><th class="zg5">Facturés à livrer</th><th class="zg5">Devis non validés</th><th class="zg5">Total</th><th class="zg5">Dossiers en retard</th><th class="zg5">Ventes sans suite</th><th class="zg5">Renouv. à relancer</th></tr></thead>
      <tbody>${md.lignes.map(ligne2).join('')}${tot2}</tbody></table>`;
    return `<div class="cockpit oa">
      <header class="ck-head"><img src="${logo}" alt=""><div class="ck-t"><div class="ck-label">${esc(titre)}</div><h1>${esc(md.perim.lib)}</h1></div><div class="ck-theme">Activité OC Mobile</div></header>
      <div class="ck-haut"><div class="ck-cpts oa-cpts">${vignettes}</div><div class="ck-tops">${courbe}</div></div>
      <section class="ck-sec"><h2><span>Activité et résultats du mois</span></h2>${tab1}</section>
      <section class="ck-sec"><h2><span>Répartition de l’activité et CA potentiel</span></h2>${tab2}</section>
      <p class="oa-note">Source : artefact « Activité OCM » (relevés Antsroute, CA Cosium en k€ HT, CA potentiel TTC hors dossiers masqués). Transformation : dépistage individuel suivi d’une vente dans les 8 semaines, cumul depuis janvier. Atteinte annuelle comparée au rythme régulier (${pc(rythme)} à fin ${MOIS[md.mo - 1]}).${md.inactifs.length ? ' OCM sans activité ce mois : ' + md.inactifs.map(esc).join(', ') + '.' : ''}</p>
      ${pied}</div>`;
  }


  // ---------- Cockpit « mur » (24/11/2026, demande d'Olivier) ----------
  // Recto lisible à 2-3 mètres (affichage au bureau) ; le verso est le cockpit complet du même périmètre.
  // Réglages (config/cockpit-mur.json) : 4 indicateurs au choix à côté du positionnement, une couleur par AR.
  const OBJ_AVIS_GOOGLE = 500; // objectif 2026 (aussi critère 9 du Manager Leader)
  const MUR_INDICS = {
    ca: 'Chiffre d’affaires', mdc: 'Taux de MdC', re: 'Rentabilité (RE)', indus: 'Taux d’indus', avis: 'Avis Google',
    caCollab: 'CA / mois / ETP', pc: 'Pack confort (%)', tc: 'Taux de concrétisation', panier: 'Panier moyen',
    audio: 'CA audio', protheses: 'Prothèses', note: 'Note Google', confidence: 'Confidence', rentaSal: 'Renta salariale', absent: 'Absentéisme',
  };
  const MUR_DEFAUT = { indicateurs: ['ca', 're', 'avis', 'indus'], couleurs: {} };
  const MUR_PALETTE = ['#6A3FA0', '#00796B', '#8E1B3A', '#B5520A', '#2E6B30', '#0E6E8C', '#7A5C00', '#4A4E69', '#9C2F7A', '#1E2547'];
  // Couleur de chaque AR : réglage, sinon Cyril en bleu, Aurélie en rose (demande d'Olivier), sinon palette sans doublon
  function couleursAr(ars, couleurs = {}) {
    const out = {}, prises = new Set();
    const fixe = a => couleurs[a] || (/^CYRIL\b/.test(norm(a)) ? '#1565C0' : /^AURELIE\b/.test(norm(a)) ? '#D81B60' : null);
    ars.forEach(a => { const c = fixe(a); if (c) { out[a] = c; prises.add(c.toUpperCase()); } });
    const libres = MUR_PALETTE.filter(c => !prises.has(c.toUpperCase())); let i = 0;
    ars.forEach(a => { if (!out[a]) out[a] = libres.length ? libres[i++ % libres.length] : MUR_PALETTE[i++ % MUR_PALETTE.length]; });
    return out;
  }
  // Effectif d'un magasin (export RH ; une personne sur n magasins compte 1/n)
  function effectifMag(photo, code) {
    const eq = photo && photo.equipes && photo.equipes[String(code)]; if (!eq || !eq.length) return null;
    return eq.reduce((a, p) => a + (p.part != null ? p.part : 1), 0);
  }
  function construireMur(photo, ref, perim, opts = {}) {
    const m = photo.mois, cfg = Object.assign({}, MUR_DEFAUT, opts.mur || {});
    const prec = opts.precedente || null;
    const succFr = r => r.pays === 'FRANCE' && r.type === 'Succursale' && r.nature !== 'Camion' && norm(r.ar) !== 'OCM';
    const avecDonnees = ph => r => ph && ph.magasins[String(r.code)];
    const it = (ph, r) => ph.magasins[String(r.code)];
    const posAgg = (ph, rs) => { if (!ph) return null; const a = agreger(rs.filter(avecDonnees(ph)).map(r => it(ph, r))).N;
      return (a.P != null && a.O) ? a.P * 12 / ph.mois / (a.O * 1000) : null; };
    // Course des AR (succursales France)
    const tous = ref.filter(avecDonnees(photo));
    const ars = [...new Set(tous.filter(succFr).map(r => r.ar))].filter(Boolean).sort((a, b) => a.localeCompare(b, 'fr'));
    const coul = couleursAr(ars, cfg.couleurs || {});
    const course = ars.map(a => { const rs = tous.filter(r => succFr(r) && r.ar === a);
      return { ar: a, posit: posAgg(photo, rs), prec: posAgg(prec, rs), couleur: coul[a] }; })
      .filter(x => x.posit != null).sort((x, y) => y.posit - x.posit);
    const ordrePrec = course.filter(x => x.prec != null).sort((x, y) => y.prec - x.prec).map(x => x.ar);
    course.forEach((x, i) => { x.rang = i + 1; const j = ordrePrec.indexOf(x.ar); x.gain = prec && j >= 0 ? (j + 1) - x.rang : null; });
    const arId = perim.id && perim.id.startsWith('ar:') ? perim.id.slice(3) : null;
    const moi = arId ? course.find(x => x.ar === arId) || null : null;
    course.forEach(x => { x.moi = x.ar === arId; });
    // Chiffres du périmètre (magasins non actifs inclus dans les totaux, comme les autres cockpits)
    const magsTot = ref.filter(r => perim.filtre(r) && photo.magasins[String(r.code)]);
    const mags = magsTot.filter(r => r.actif === 'Oui');
    const ag = agreger(magsTot.map(r => it(photo, r))), n = ag.N, p = ag.N1;
    const nP = prec ? agreger(magsTot.filter(avecDonnees(prec)).map(r => it(prec, r))).N : null;
    const posit = posAgg(photo, magsTot), positPrec = posAgg(prec, magsTot);
    const humeur = posit == null ? 'orange' : posit >= 1 ? 'vert' : posit >= 0.95 ? 'orange' : 'rouge';
    // Magasins (actifs)
    const pm = (ph, r) => { const x = ph && ph.magasins[String(r.code)] && ph.magasins[String(r.code)].N; return (x && x.P != null && x.O) ? x.P * 12 / ph.mois / (x.O * 1000) : null; };
    const lignes = mags.map(r => { const d = photo.magasins[String(r.code)], x = d.N || {}, y = d.N1 || {};
      return { code: String(r.code), nom: r.magasin, posit: pm(photo, r), positPrec: pm(prec, r), evolCa: evol(x.P, y.P), indus: x.BV, avis: x.BL, prev: x.P != null ? x.P * 12 / m : null }; });
    const classes = lignes.filter(l => l.posit != null).sort((a, b) => b.posit - a.posit);
    const podium = classes.slice(0, 3);
    const mobilise = classes.slice(Math.max(3, classes.length - 3)).reverse();
    // CA par collaborateur (CA du mois moyen / effectif RH), comparé à l'ensemble des succursales France
    const caCollab = rs => { let ca = 0, eff = 0; rs.forEach(r => { const e = effectifMag(photo, r.code), x = (photo.magasins[String(r.code)] || {}).N || {};
      if (e && x.P != null) { ca += x.P; eff += e; } }); return eff ? ca / eff / m : null; };
    const caCollabMoi = caCollab(magsTot), caCollabRef = caCollab(tous.filter(succFr));
    // Objectifs (pays du périmètre)
    const obj = objectifsRef(opts.objectifs, mags);
    const pT = photo.sources && photo.sources.rentabilites && photo.sources.rentabilites.periode;
    const nbAvis = lignes.filter(l => l.avis != null);
    const vsN1 = (a, b) => (a == null || b == null) ? null : a - b;
    const I = {
      ca: () => ({ v: n.P, fmt: 'M', ref: evol(n.P, p.P), refFmt: 'evol', sub: 'vs N-1', etat: evol(n.P, p.P) == null ? '' : evol(n.P, p.P) >= 0 ? 'ok' : 'ko' }),
      mdc: () => { const v = pct(n.AN), d = vsN1(v, pct(p.AN)), o = obj.mdc; return { v, fmt: 'pct1', ref: d, refFmt: 'pts', sub: 'vs N-1' + (o ? ` · objectif ${Math.round(o * 100)} %` : ''), etat: v == null ? '' : o ? (v >= o ? 'ok' : 'ko') : (d == null ? '' : d >= 0 ? 'ok' : 'ko') }; },
      re: () => { const v = pct(n.CQ); return { v, fmt: 'pct1', txt: 'objectif ≥ 20 %' + (pT && pT.au ? ` · à fin ${pT.au.slice(5, 7)}/${pT.au.slice(0, 4)}` : ''), etat: v == null ? '' : v >= 0.2 ? 'ok' : 'ko' }; },
      indus: () => { const v = n.BV, d = nP && nP.BV != null && v != null ? v - nP.BV : null;
        return { v, fmt: 'pct2', ref: d, refFmt: 'pts2', sub: 'vs mois préc. · objectif ≤ 1 %', inverse: true, etat: v == null ? '' : v <= 0.01 ? 'ok' : v <= 0.02 ? 'moy' : 'ko' }; },
      avis: () => { const v = nbAvis.length ? nbAvis.reduce((a, l) => a + l.avis, 0) / nbAvis.length : null;
        return { v, fmt: 'nb', lib: 'Avis Google / magasin', txt: `objectif ${OBJ_AVIS_GOOGLE} · ${nbAvis.filter(l => l.avis >= OBJ_AVIS_GOOGLE).length}/${mags.length} magasins atteints`, etat: v == null ? '' : v >= OBJ_AVIS_GOOGLE ? 'ok' : 'moy' }; },
      caCollab: () => { const v = caCollabMoi, d = v != null && caCollabRef ? v / caCollabRef - 1 : null;
        return { v, fmt: 'k1', ref: d, refFmt: 'evol', sub: `vs moy. France (${caCollabRef != null ? (caCollabRef / 1000).toFixed(1).replace('.', ',') + ' k€' : '–'})`, etat: d == null ? '' : d >= 0 ? 'ok' : 'ko' }; },
      pc: () => { const v = pct(n.AD), d = vsN1(v, pct(p.AD)); return { v, fmt: 'pct0', ref: d, refFmt: 'pts', sub: 'vs N-1', etat: d == null ? '' : d >= 0 ? 'ok' : 'ko' }; },
      tc: () => { const v = pct(n.AF), d = vsN1(v, pct(p.AF)); return { v, fmt: 'pct1', ref: d, refFmt: 'pts', sub: 'vs N-1', etat: d == null ? '' : d >= 0 ? 'ok' : 'ko' }; },
      panier: () => { const d = evol(n.V, p.V); return { v: n.V, fmt: 'eur', ref: d, refFmt: 'evol', sub: 'vs N-1', etat: d == null ? '' : d >= 0 ? 'ok' : 'ko' }; },
      audio: () => { const d = evol(n.Q, p.Q); return { v: n.Q, fmt: 'M', ref: d, refFmt: 'evol', sub: 'vs N-1', etat: d == null ? '' : d >= 0 ? 'ok' : 'ko' }; },
      protheses: () => { const d = evol(n.AX, p.AX); return { v: n.AX, fmt: 'nb', ref: d, refFmt: 'evol', sub: 'vs N-1', etat: d == null ? '' : d >= 0 ? 'ok' : 'ko' }; },
      note: () => { const v = n.BL ? n.BK : null; return { v, fmt: 'note', txt: 'objectif ≥ 4,5', etat: v == null ? '' : v >= 4.5 ? 'ok' : 'ko' }; },
      confidence: () => { const v = div(n.DO, n.DP); return { v, fmt: 'pct0', txt: 'clients contactés (listes suivies)', etat: '' }; },
      rentaSal: () => { const v = pct(n.CM); return { v, fmt: 'pct1', txt: 'objectif ≤ 28 %', etat: v == null ? '' : v <= 0.28 ? 'ok' : 'ko' }; },
      absent: () => { const v = n.XS ? (n.XR || 0) / n.XS : null; return { v, fmt: 'pct1', txt: 'vert ≤ 5 % · orange ≤ 10 %', etat: v == null ? '' : v <= 0.05 ? 'ok' : v <= 0.10 ? 'moy' : 'ko' }; },
    };
    const choix = (Array.isArray(cfg.indicateurs) ? cfg.indicateurs : MUR_DEFAUT.indicateurs).filter(k => I[k]).slice(0, 4);
    while (choix.length < 4) { const k = MUR_DEFAUT.indicateurs.concat(Object.keys(I)).find(x => !choix.includes(x)); choix.push(k); }
    const indicateurs = choix.map(k => Object.assign({ cle: k, lib: MUR_INDICS[k] }, I[k]()));
    // Badges
    let ml = null;
    try {
      const F = root.Fiche; const succ = mags.filter(r => r.type === 'Succursale' && r.nature !== 'Camion');
      if (F && opts.chal !== undefined && succ.length) ml = { n: succ.filter(r => F.challenges(photo, r, F.calculer(photo, r, opts.objectifs), opts.chal, { taux: opts.taux }).sml.ok >= 7).length, sur: succ.length };
    } catch (e) { ml = null; }
    const avecIndus = lignes.filter(l => l.indus != null);
    let progres = null;
    const hausses = lignes.filter(l => l.posit != null && l.positPrec != null).map(l => ({ nom: l.nom, d: l.posit - l.positPrec })).sort((a, b) => b.d - a.d);
    if (hausses.length) progres = { lib: 'Plus forte hausse du positionnement (vs ' + ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'][prec.mois - 1] + ')', val: hausses[0].d, fmt: 'pts', nom: hausses[0].nom };
    else { const e = lignes.filter(l => l.evolCa != null).sort((a, b) => b.evolCa - a.evolCa)[0]; if (e) progres = { lib: 'Plus forte progression du CA vs N-1', val: e.evolCa, fmt: 'evol', nom: e.nom }; }
    const badges = { ml, indus: { n: avecIndus.filter(l => l.indus <= 0.01).length, sur: avecIndus.length }, avis: { n: lignes.filter(l => l.avis >= OBJ_AVIS_GOOGLE).length, sur: mags.length }, progres };
    // Équipe & productivité (24/11/2026, à la place de la course des AR, gardée dans l'Indicateur du moment)
    const eqMags = mags.map(r => { const x = (photo.magasins[String(r.code)] || {}).N || {}, ef = effectifMag(photo, r.code);
      return { nom: r.magasin, ecart: ecartEffMag(photo, r), rs: pct(x.CM), caE: ef && x.P != null ? x.P / ef / m : null }; });
    const ecarts = eqMags.filter(x => x.ecart != null);
    const equipe = {
      rentaSal: pct(n.CM), caCollab: caCollabMoi, caCollabRef,
      ecartTot: ecarts.length ? ecarts.reduce((a, x) => a + x.ecart, 0) : null, nEcart: ecarts.length,
      nSous: ecarts.filter(x => x.ecart <= -0.5).length, nSur: ecarts.filter(x => x.ecart >= 0.5).length,
      ajuster: ecarts.filter(x => Math.abs(x.ecart) >= 0.5).sort((a, b) => Math.abs(b.ecart) - Math.abs(a.ecart)).slice(0, 3),
    };
    return { type: 'mur', photo, perim, arId, moi, equipe, couleur: arId ? coul[arId] || '#231F20' : '#231F20', course, posit, positPrec, humeur,
      nbMags: mags.length, n100: lignes.filter(l => l.posit != null && l.posit >= 1).length, n12: lignes.filter(l => l.prev != null && l.prev >= 1.2e6).length,
      indicateurs, podium, mobilise, badges, serie: opts.serie || null, serieRef: opts.serieRef || null };
  }

  function rendreMur(md, opts = {}) {
    const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, x => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[x]));
    const nb = (v, d = 0) => v == null || isNaN(v) ? '–' : Number(v).toLocaleString('fr-FR', { maximumFractionDigits: d, minimumFractionDigits: d });
    const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
    const MC = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
    const signe = v => v > 0 ? '+' : v < 0 ? '−' : '';
    const f = (v, fmt) => {
      if (v == null || isNaN(v)) return '–';
      switch (fmt) {
        case 'M': return Math.abs(v) >= 1e6 ? nb(v / 1e6, 1) + ' M€' : nb(v / 1000) + ' k€';
        case 'k1': return nb(v / 1000, 1) + ' k€';
        case 'eur': return nb(v) + ' €';
        case 'pct0': return nb(v * 100) + ' %';
        case 'pct1': return nb(v * 100, 1) + ' %';
        case 'pct2': return nb(v * 100, 2) + ' %';
        case 'note': return nb(v, 1);
        case 'evol': return signe(v) + nb(Math.abs(v) * 100, 1) + ' %';
        case 'pts': if (Math.abs(v) < 0.0005) return '= 0 pt'; return signe(v) + nb(Math.abs(v) * 100, 1) + ' pt' + (Math.abs(v * 100) >= 2 ? 's' : '');
        case 'pts2': return signe(v) + nb(Math.abs(v) * 100, 2) + ' pt';
        default: return nb(v);
      }
    };
    const logo = opts.logo || 'assets/logo-optical-center.png';
    const ph = md.photo, mo = ph.mois;
    const HUMEUR = { vert: ['DANS LE VERT', '#1E8A52'], orange: ['ON ACCÉLÈRE', '#D98A00'], rouge: ['TOUS MOBILISÉS', '#E22F2A'] }[md.humeur];
    const nomAr = md.arId || md.perim.lib;
    // Bandeau
    const medaille = md.moi ? `<div class="mu-med"><div class="mu-med-l">Classement<br>des ${md.course.length} AR</div><div class="mu-rond"><div class="v">${md.moi.rang}<sup>${md.moi.rang === 1 ? 'er' : 'e'}</sup></div>${md.moi.gain == null ? '' : `<div class="g">${md.moi.gain > 0 ? '▲ ' + md.moi.gain + ' place' + (md.moi.gain > 1 ? 's' : '') : md.moi.gain < 0 ? '▼ ' + (-md.moi.gain) + ' place' + (md.moi.gain < -1 ? 's' : '') : '= stable'}</div>`}</div></div>` : '';
    const bandeau = `<header class="mu-band" style="background:${md.couleur}">
      <div class="mu-id"><div class="mu-lab">Cockpit ${md.arId ? 'AR' : ''} · à fin ${MOIS[mo - 1]} ${ph.annee} · cumul depuis le 1er janvier</div>
        <h1>${esc(nomAr)}</h1><div class="mu-sous">${md.nbMags} magasins · ${md.n100} à 100 % · ${md.n12} au-dessus de 1,2 M€</div></div>
      <div class="mu-humeur" style="background:${HUMEUR[1]}">${md.humeur === 'vert' ? '<svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 12 10 18 20 6"/></svg>' : ''}<span>${HUMEUR[0]}</span></div>
      ${medaille}<img class="mu-logo" src="${logo}" alt=""></header>`;
    // Positionnement + 4 indicateurs
    const C = 2 * Math.PI * 62, pv = md.posit == null ? 0 : Math.max(0, Math.min(1, md.posit));
    const dPos = md.posit != null && md.positPrec != null ? md.posit - md.positPrec : null;
    const anneau = `<div class="mu-carte mu-pos"><svg viewBox="0 0 150 150" width="150" height="150"><circle cx="75" cy="75" r="62" fill="none" stroke="#ECE7E6" stroke-width="16"/>
      <circle cx="75" cy="75" r="62" fill="none" stroke="${md.couleur}" stroke-width="16" stroke-linecap="round" stroke-dasharray="${(pv * C).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 75 75)"/>
      <text x="75" y="86" text-anchor="middle" class="mu-anv">${md.posit == null ? '–' : nb(md.posit * 100) + '%'}</text></svg>
      <div><div class="mu-k">Positionnement</div><div class="mu-ks">vs objectif annuel</div>${dPos == null ? '' : `<div class="mu-kr ${dPos >= 0 ? 'ok' : 'ko'}">${dPos >= 0 ? '▲' : '▼'} ${f(dPos, 'pts')} vs ${MC[(mo + 10) % 12]}</div>`}</div></div>`;
    const carte = k => `<div class="mu-carte mu-ind e-${k.etat || 'na'}"><div class="mu-k">${esc(k.lib)}</div><div class="mu-v">${f(k.v, k.fmt)}</div>
      <div class="mu-kr ${k.etat}">${k.ref != null ? `${k.ref > 0 ? '▲' : k.ref < 0 ? '▼' : '='} ${f(k.ref, k.refFmt)} ${esc(k.sub || '')}` : esc(k.txt || k.sub || '')}</div></div>`;
    const kpis = `<div class="mu-kpis">${anneau}${md.indicateurs.map(carte).join('')}</div>`;
    // Course des AR
    const maxE = Math.max(1.1, ...md.course.map(x => x.posit + 0.02));
    const course = `<div class="mu-carte mu-course"><div class="mu-t">La course des AR <small>positionnement · trait = 100 %</small></div><div class="mu-barres">
      ${md.course.map(x => `<div class="mu-b${x.moi ? ' moi' : ''}"><span class="r">${x.rang}.</span><span class="n">${esc(x.ar.split(/\s+/)[0])}</span>
        <span class="piste"><i style="width:${(Math.max(0, x.posit) / maxE * 100).toFixed(1)}%;background:${x.couleur}"></i><b style="left:${(100 / maxE).toFixed(1)}%"></b></span><span class="v">${nb(x.posit * 100)} %</span></div>`).join('')}</div></div>`;
    // Équipe & productivité
    const q = md.equipe, sgn = v => (v > 0 ? '+' : v < 0 ? '−' : '') + nb(Math.abs(v), 1);
    const dRef = q.caCollab != null && q.caCollabRef ? q.caCollab / q.caCollabRef - 1 : null;
    const tq = (lib, v, sub, etat) => `<div class="mu-eqt ${etat}"><div class="k">${lib}</div><div class="v">${v}</div><div class="s">${sub}</div></div>`;
    const equipe = `<div class="mu-carte mu-equipe"><div class="mu-t">Équipe &amp; productivité <small>effectifs en ETP</small></div>
      <div class="mu-eqts">
        ${tq('Renta salariale', q.rentaSal == null ? '–' : nb(q.rentaSal * 100, 1) + ' %', 'objectif ≤ 28 %', q.rentaSal == null ? '' : q.rentaSal <= 0.28 ? 'ok' : 'ko')}
        ${tq('Effectif vs théorique', q.ecartTot == null ? '–' : sgn(q.ecartTot) + ' ETP', q.ecartTot == null ? 'export RH manquant' : `${q.nSous} en sous-effectif · ${q.nSur} en sur-effectif`, q.ecartTot == null ? '' : Math.abs(q.ecartTot) < 1 ? 'ok' : q.ecartTot < 0 ? 'sous' : q.ecartTot < 3 ? 'moy' : 'ko')}
        ${tq('CA / mois / ETP', q.caCollab == null ? '–' : nb(q.caCollab / 1000, 1) + ' k€', dRef == null ? '' : `${f(dRef, 'evol')} vs moy. France (${nb(q.caCollabRef / 1000, 1)} k€)`, dRef == null ? '' : dRef >= 0 ? 'ok' : 'ko')}
      </div>
      <div class="mu-aj-t">Effectifs à ajuster</div>
      <div class="mu-ajs">${q.ajuster.length ? q.ajuster.map(x => `<div class="mu-aj ${x.ecart < 0 ? 'sous' : 'sur'}"><b>${esc(x.nom)}</b><span class="e">${sgn(x.ecart)} ETP</span><span class="d">${x.ecart < 0 ? 'sous-effectif' : 'sur-effectif'}${x.rs != null ? ' · renta sal. ' + nb(x.rs * 100, 1) + ' %' : ''}${x.caE != null ? ' · ' + nb(x.caE / 1000, 1) + ' k€ / ETP' : ''}</span></div>`).join('') : '<div class="mu-vide">Tous les magasins sont à l’effectif juste (± 0,5 ETP).</div>'}</div></div>`;
    // Podium
    const pod = md.podium, ordre = [[1, 2, 'p2'], [0, 1, 'p1'], [2, 3, 'p3']];
    const podium = `<div class="mu-carte mu-podium"><div class="mu-t">Le podium <small>meilleurs positionnements</small></div><div class="mu-marches">
      ${ordre.map(([i, rg, c]) => pod[i] ? `<div class="mu-m ${c}"><div class="nm">${esc(pod[i].nom)}</div><div class="pc" style="color:${md.couleur}">${nb(pod[i].posit * 100)} %</div><div class="bloc">${rg}</div></div>` : '<div class="mu-m"></div>').join('')}</div></div>`;
    // On se mobilise
    const mob = `<div class="mu-carte mu-mob"><div class="mu-t">On se mobilise <small>à accompagner en priorité</small></div><div class="mu-ml">
      ${md.mobilise.length ? md.mobilise.map(l => `<div class="mu-mi"><span class="ex">!</span><div class="tx"><b>${esc(l.nom)}</b><small>${l.evolCa != null ? 'CA ' + f(l.evolCa, 'evol') + ' vs N-1' : 'positionnement le plus bas'}</small></div><span class="v">${nb(l.posit * 100)} %</span></div>`).join('') : '<div class="mu-vide">Pas assez de magasins classés.</div>'}</div></div>`;
    // Courbe mois par mois
    const s = md.serie, sr = md.serieRef;
    const courbe = (() => {
      if (!s || s.length < 2) return `<div class="mu-carte mu-courbe"><div class="mu-t">Mois par mois</div><div class="mu-vide">Courbe disponible à partir de deux mois enregistrés.</div></div>`;
      const W = 760, H = 170, ps = s.map(x => x.posit).concat(sr ? sr.map(x => x.posit) : []).filter(x => x != null);
      const mn = Math.min(0.85, ...ps) - 0.02, mx = Math.max(1.05, ...ps) + 0.02;
      const X = mo2 => 24 + (mo2 - 1) * (W - 48) / Math.max(1, mo - 1), Y = v => H - 26 - (v - mn) / (mx - mn) * (H - 44);
      const ligne = (se, c, w, dash) => `<polyline points="${se.filter(x => x.posit != null).map(x => `${X(x.mois).toFixed(1)},${Y(x.posit).toFixed(1)}`).join(' ')}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linejoin="round"${dash ? ' stroke-dasharray="8 6"' : ''}/>`;
      const der = s[s.length - 1];
      return `<div class="mu-carte mu-courbe"><div class="mu-t">Mois par mois <small><span style="color:${md.couleur}">━ ${esc(md.arId ? md.arId.split(/\s+/)[0] : 'Périmètre')}</span>${sr ? ' · <span class="gris">┅ Succursales France</span>' : ''}</small></div>
        <svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="none">
        <line x1="24" x2="${W - 24}" y1="${Y(1).toFixed(1)}" y2="${Y(1).toFixed(1)}" stroke="#231F20" stroke-width="1.5" stroke-dasharray="6 6"/><text x="${W - 24}" y="${(Y(1) - 6).toFixed(1)}" text-anchor="end" class="mu-sv">objectif 100 %</text>
        ${sr && sr.length > 1 ? ligne(sr, '#9A9A9A', 3, true) : ''}${ligne(s, md.couleur, 5)}
        <circle cx="${X(der.mois).toFixed(1)}" cy="${Y(der.posit).toFixed(1)}" r="8" fill="${md.couleur}"/>
        <text x="24" y="${H - 4}" class="mu-sm">${MC[s[0].mois - 1]}</text><text x="${W - 24}" y="${H - 4}" text-anchor="end" class="mu-sm">${MC[der.mois - 1]} · ${nb(der.posit * 100)} %</text></svg></div>`;
    })();
    // Badges
    const b = md.badges, bad = [];
    if (b.ml) bad.push(`<div class="mu-bad b1"><div class="v">${b.ml.n}/${b.ml.sur}</div><div class="l">Managers Leaders qualifiés (≥ 7/10)</div></div>`);
    bad.push(`<div class="mu-bad b2"><div class="v">${b.indus.n}/${b.indus.sur}</div><div class="l">Magasins à ≤ 1 % d’indus</div></div>`);
    bad.push(`<div class="mu-bad b3"><div class="v">${b.avis.n}/${b.avis.sur}</div><div class="l">Magasins à ${OBJ_AVIS_GOOGLE} avis Google et + (objectif ${ph.annee})</div></div>`);
    if (b.progres) bad.push(`<div class="mu-bad b4"><div class="v">${f(b.progres.val, b.progres.fmt)}</div><div class="l">${esc(b.progres.lib)}<b style="color:${md.couleur}">${esc(b.progres.nom)}</b></div></div>`);
    const pied = `<footer class="ck-pied"><span>Optical Center · Suivi statistique · généré le ${new Date().toLocaleDateString('fr-FR')}</span><span class="slogan">Entendre et voir UNIQUEMENT le <b>BIEN</b></span><span>Détail par magasin au verso</span></footer>`;
    return `<div class="cockpit mur">${bandeau}${kpis}
      <div class="mu-milieu">${equipe}${podium}${mob}</div>
      <div class="mu-bas">${courbe}<div class="mu-badges">${bad.join('')}</div></div>${pied}</div>`;
  }


  // ---------- Écart d'effectif d'un magasin (réel optique + audio − théorique), comme la fiche ----------
  function ecartEffMag(ph, r) {
    const F = root.Fiche;
    if (F && F.equipe) { try { const e = F.equipe(ph, r, {}); return e.connu && e.effTheo != null ? e.effOpt + e.effAud - e.effTheo : null; } catch (x) { return null; } }
    const ef = effectifMag(ph, r.code), n = (ph.magasins[String(r.code)] || {}).N || {};
    return ef != null && n.P != null ? ef - Math.max(3.5, n.P * 12 / ph.mois / 250000) : null;
  }

  // ---------- Indicateur du moment (24/11/2026) : affiche réseau succursales France, un indicateur ou un thème ----------
  const MOMENT_LIBS = Object.assign({}, MUR_INDICS, { ecartEff: 'Écart d’effectif (ETP)', posit: 'Positionnement' });
  const MOMENT_THEMES = {
    rentabilite: { lib: 'Rentabilité', ind: ['re', 'rentaSal', 'ecartEff'] },
    optique: { lib: 'Optique', ind: ['mdc', 'pc', 'tc', 'panier'] },
    audio: { lib: 'Audio', ind: ['audio', 'protheses'] },
    satisfaction: { lib: 'Satisfaction clients', ind: ['avis', 'note', 'confidence'] },
    gestion: { lib: 'Gestion', ind: ['indus', 'absent'] },
  };
  const MOMENT_DEFAUT = { mode: 'seul', indicateur: 'mdc', theme: 'rentabilite', perso: ['re', 'rentaSal'], message: '' };
  // vol = volume (comparé à N-1, en indice) ; rel = valeur comparée à N-1 ; pts = taux comparé à N-1 ;
  // seuil/sens/tol = objectif fixe ; reseau = comparé à la moyenne du réseau ; eff = écart d'effectif
  const MSPEC = {
    ca: { vol: 1, get: n => n.P, fmt: 'M' }, audio: { vol: 1, get: n => n.Q, fmt: 'M' }, protheses: { vol: 1, get: n => n.AX, fmt: 'nb' },
    panier: { rel: 1, get: n => n.V, fmt: 'eur' },
    mdc: { pts: 1, get: n => pct(n.AN), fmt: 'pct1', objCle: 'mdc' }, pc: { pts: 1, get: n => pct(n.AD), fmt: 'pct0' }, tc: { pts: 1, get: n => pct(n.AF), fmt: 'pct1' },
    re: { get: n => pct(n.CQ), fmt: 'pct1', seuil: 0.2, sens: 1, tol: 0.01 },
    rentaSal: { get: n => pct(n.CM), fmt: 'pct1', seuil: 0.28, sens: -1, tol: 0.01 },
    indus: { get: n => n.BV, fmt: 'pct2', seuil: 0.01, sens: -1, tol: 0.01 },
    note: { get: n => n.BL ? n.BK : null, fmt: 'note', seuil: 4.5, sens: 1, tol: 0.1 },
    absent: { get: n => n.XS ? (n.XR || 0) / n.XS : null, fmt: 'pct1', seuil: 0.05, sens: -1, tol: 0.05 },
    confidence: { reseau: 1, get: n => div(n.DO, n.DP), fmt: 'pct0' },
    avis: { spe: 'avis', fmt: 'nb', seuil: OBJ_AVIS_GOOGLE, sens: 1, tol: 100 },
    caCollab: { spe: 'caCollab', fmt: 'k1', reseau: 1 },
    ecartEff: { spe: 'eff', fmt: 'sg1', eff: 1 },
    posit: { spe: 'posit', fmt: 'pct0', seuil: 1, sens: 1, tol: 0.05 },
  };
  function mesure(k, ph, rs) {
    const sp = MSPEC[k]; if (!sp || !ph) return { v: null, v1: null };
    const rr = rs.filter(r => ph.magasins[String(r.code)]);
    if (!rr.length) return { v: null, v1: null };
    if (sp.spe === 'avis') { const l = rr.map(r => ph.magasins[String(r.code)].N || {}).filter(x => x.BL != null); return { v: l.length ? l.reduce((a, x) => a + x.BL, 0) / l.length : null, v1: null }; }
    if (sp.spe === 'caCollab') { let ca = 0, e = 0; rr.forEach(r => { const ef = effectifMag(ph, r.code), x = ph.magasins[String(r.code)].N || {}; if (ef && x.P != null) { ca += x.P; e += ef; } }); return { v: e ? ca / e / ph.mois : null, v1: null }; }
    if (sp.spe === 'posit') { const a = agreger(rr.map(r => ph.magasins[String(r.code)])).N; return { v: a.P != null && a.O ? a.P * 12 / ph.mois / (a.O * 1000) : null, v1: null }; }
    if (sp.spe === 'eff') { const l = rr.map(r => ecartEffMag(ph, r)).filter(x => x != null); return { v: l.length ? l.reduce((a, x) => a + x, 0) / l.length : null, v1: null }; }
    const a = agreger(rr.map(r => ph.magasins[String(r.code)]));
    return { v: sp.get(a.N), v1: sp.get(a.N1) };
  }
  // Score (plus grand = mieux) et état (ok / moy / ko / sous) d'une mesure
  function evaluer(k, m, ctx = {}) {
    const sp = MSPEC[k], v = m.v; if (v == null) return { score: null, etat: '' };
    const seuil = ctx.seuil != null ? ctx.seuil : sp.seuil;
    if (sp.eff) return { score: -Math.abs(v), etat: v <= -0.5 ? 'sous' : v < 0.5 ? 'ok' : v < 1 ? 'moy' : 'ko' };
    if (seuil != null) { const sens = sp.sens || 1, d = (v - seuil) * sens; return { score: v * sens, etat: d >= 0 ? 'ok' : -d <= (sp.tol || 0.01) ? 'moy' : 'ko' }; }
    if (sp.vol || sp.rel) { const r = m.v1 ? v / m.v1 : null; return { score: r, etat: r == null ? '' : r >= 1 ? 'ok' : r >= 0.98 ? 'moy' : 'ko' }; }
    if (sp.pts) { const d = m.v1 != null ? v - m.v1 : null; return { score: v, etat: d == null ? '' : d >= 0 ? 'ok' : d >= -0.01 ? 'moy' : 'ko' }; }
    if (sp.reseau && ctx.reseau) { const r = v / ctx.reseau; return { score: v, etat: r >= 1 ? 'ok' : r >= 0.95 ? 'moy' : 'ko' }; }
    return { score: v, etat: '' };
  }
  function listeMoment(conf) {
    const c = Object.assign({}, MOMENT_DEFAUT, conf || {});
    if (c.mode === 'seul') return { mode: 'seul', titre: MOMENT_LIBS[c.indicateur] || MOMENT_LIBS.mdc, ind: [MSPEC[c.indicateur] ? c.indicateur : 'mdc'] };
    if (c.theme === 'perso') { const l = [...new Set((c.perso || []).filter(k => MSPEC[k]))].slice(0, 4); return { mode: 'theme', titre: c.titrePerso || 'Thème du moment', ind: l.length >= 2 ? l : ['re', 'rentaSal'] }; }
    const t = MOMENT_THEMES[c.theme] || MOMENT_THEMES.rentabilite;
    return { mode: 'theme', titre: t.lib, ind: t.ind };
  }
  function construireMoment(photo, ref, conf, opts = {}) {
    const L = listeMoment(conf), prec = opts.precedente || null;
    const succFr = r => r.pays === 'FRANCE' && r.type === 'Succursale' && r.nature !== 'Camion' && norm(r.ar) !== 'OCM';
    const tous = ref.filter(r => succFr(r) && photo.magasins[String(r.code)]);
    const actifs = tous.filter(r => r.actif === 'Oui');
    const ars = [...new Set(tous.map(r => r.ar))].filter(Boolean).sort((a, b) => a.localeCompare(b, 'fr'));
    const coul = couleursAr(ars, opts.couleurs || {});
    const objFr = objectifsRef(opts.objectifs, actifs) || {};
    const ctxDe = (k, reseau) => ({ seuil: MSPEC[k].objCle && objFr[MSPEC[k].objCle] ? objFr[MSPEC[k].objCle] : undefined, reseau });
    const inds = L.ind.map(k => {
      const res = mesure(k, photo, tous), resP = mesure(k, prec, tous), ctx = ctxDe(k, res.v);
      const seuil = ctx.seuil != null ? ctx.seuil : MSPEC[k].seuil;
      const arsL = ars.map(a => { const rs = tous.filter(r => r.ar === a), m = mesure(k, photo, rs), mp = mesure(k, prec, rs);
        return { ar: a, couleur: coul[a], m, e: evaluer(k, m, ctx), ep: evaluer(k, mp, ctxDe(k, resP.v)) }; });
      const mags = actifs.map(r => { const m = mesure(k, photo, [r]), mp = mesure(k, prec, [r]);
        return { code: String(r.code), nom: r.magasin, ar: r.ar, couleur: coul[r.ar], m, e: evaluer(k, m, ctx), ep: evaluer(k, mp, ctxDe(k, resP.v)) }; });
      return { k, lib: MOMENT_LIBS[k], spec: MSPEC[k], seuil, res, resP, eRes: evaluer(k, res, ctx), ars: arsL, mags };
    });
    // Classement des AR (indicateur seul) et places gagnées vs mois précédent
    const i0 = inds[0];
    const ordre = (l, cle) => l.filter(x => x[cle].score != null).sort((a, b) => b[cle].score - a[cle].score).map(x => x.ar);
    const rangP = ordre(i0.ars, 'ep');
    let course = [];
    if (L.mode === 'seul') course = i0.ars.filter(x => x.e.score != null).sort((a, b) => b.e.score - a.e.score)
      .map((x, i) => { const j = rangP.indexOf(x.ar); return Object.assign({}, x, { rang: i + 1, gain: prec && j >= 0 ? j - i : null }); });
    // Thème : objectifs tenus par AR et par magasin
    const nOk = (lst, cle) => lst.map((_, idx) => inds.filter(d => d[cle][idx].e.etat === 'ok').length);
    let tableau = [];
    if (L.mode === 'theme') {
      const no = nOk(ars, 'ars');
      tableau = ars.map((a, idx) => ({ ar: a, couleur: coul[a], cells: inds.map(d => d.ars[idx]), nOk: no[idx], s0: inds[0].ars[idx].e.score }))
        .filter(x => x.cells.some(c => c.m.v != null)).sort((a, b) => b.nOk - a.nOk || (b.s0 == null ? -1 : a.s0 == null ? 1 : b.s0 - a.s0)).map((x, i) => Object.assign(x, { rang: i + 1 }));
    }
    const magsT = actifs.map((r, idx) => ({ nom: r.magasin, ar: r.ar, couleur: coul[r.ar], cells: inds.map(d => d.mags[idx]),
      nOk: inds.filter(d => d.mags[idx].e.etat === 'ok').length, nKo: inds.filter(d => ['ko', 'moy'].includes(d.mags[idx].e.etat) || (d.k === 'ecartEff' && d.mags[idx].m.v >= 0.5)).length,
      s0: i0.mags[idx].e.score, d0: (i0.mags[idx].e.score != null && i0.mags[idx].ep.score != null) ? i0.mags[idx].e.score - i0.mags[idx].ep.score : null }));
    const parS0 = (a, b) => (b.s0 == null ? -1 : a.s0 == null ? 1 : b.s0 - a.s0);
    const champions = L.mode === 'seul' ? magsT.filter(x => x.s0 != null).sort(parS0).slice(0, 5)
      : magsT.filter(x => x.nOk === inds.length).sort(parS0).slice(0, 5);
    const progres = magsT.filter(x => x.d0 != null && x.d0 > 0).sort((a, b) => b.d0 - a.d0).slice(0, 3);
    const mobilise = magsT.filter(x => x.nKo > 0).sort((a, b) => b.nKo - a.nKo || -parS0(a, b)).slice(0, 3);
    const coursePos = ars.map(a => { const rs = tous.filter(r => r.ar === a); return { ar: a, couleur: coul[a], v: mesure('posit', photo, rs).v, vp: mesure('posit', prec, rs).v }; })
      .filter(x => x.v != null).sort((a, b) => b.v - a.v);
    const ordP = coursePos.filter(x => x.vp != null).slice().sort((a, b) => b.vp - a.vp).map(x => x.ar);
    coursePos.forEach((x, i) => { x.rang = i + 1; const j = ordP.indexOf(x.ar); x.gain = prec && j >= 0 ? j - i : null; });
    const compte = d => ({ ok: d.mags.filter(x => x.e.etat === 'ok').length, sur: d.mags.filter(x => x.m.v != null).length,
      progres: d.mags.filter(x => x.e.score != null && x.ep.score != null && x.e.score > x.ep.score).length, avecP: d.mags.filter(x => x.e.score != null && x.ep.score != null).length });
    return { type: 'moment', photo, prec, conf: Object.assign({}, MOMENT_DEFAUT, conf || {}), mode: L.mode, titre: L.titre, inds, course, tableau, champions, progres, mobilise,
      coursePos, comptes: inds.map(compte), tousOk: magsT.filter(x => x.nOk === inds.length && x.cells.every(c => c.m.v != null)).length, nbMags: actifs.length, serie: opts.serie || null };
  }

  const FMT_M = (v, fmt) => {
    const nb = (x, d = 0) => Number(x).toLocaleString('fr-FR', { maximumFractionDigits: d, minimumFractionDigits: d });
    const sg = x => x > 0 ? '+' : x < 0 ? '−' : '';
    if (v == null || isNaN(v)) return '–';
    switch (fmt) {
      case 'M': return Math.abs(v) >= 1e6 ? nb(v / 1e6, 1) + ' M€' : nb(v / 1000) + ' k€';
      case 'k1': return nb(v / 1000, 1) + ' k€';
      case 'eur': return nb(v) + ' €';
      case 'pct0': return nb(v * 100) + ' %';
      case 'pct1': return nb(v * 100, 1) + ' %';
      case 'pct2': return nb(v * 100, 2) + ' %';
      case 'note': return nb(v, 1);
      case 'sg1': return sg(v) + nb(Math.abs(v), 1);
      case 'evol': return sg(v) + nb(Math.abs(v) * 100, 1) + ' %';
      case 'pts': return sg(v) + nb(Math.abs(v) * 100, 1) + ' pt' + (Math.abs(v * 100) >= 2 ? 's' : '');
      default: return nb(v);
    }
  };
  // Valeur affichée : volume → évolution vs N-1 ; sinon la valeur
  const valAff = (d, m) => (d.spec.vol || d.spec.rel) && m.v1 ? FMT_M(m.v / m.v1 - 1, 'evol') : FMT_M(m.v, d.spec.fmt);
  const deltaAff = (d, x) => {
    const sp = d.spec;
    if (sp.vol || sp.rel || /^pct/.test(sp.fmt)) return FMT_M(x, 'pts');
    if (sp.fmt === 'k1') return (x > 0 ? '+' : '−') + FMT_M(Math.abs(x), 'k1');
    if (sp.spe === 'avis') return (x > 0 ? '+' : '−') + Math.round(Math.abs(x)) + ' avis';
    return FMT_M(x, sp.fmt === 'nb' ? 'sg1' : 'sg1');
  };
  const objAff = d => {
    const sp = d.spec;
    if (d.seuil != null) return 'objectif ' + ((sp.sens || 1) < 0 ? '≤ ' : '≥ ') + FMT_M(d.seuil, sp.fmt);
    if (sp.eff) return 'objectif ± 0,5 ETP';
    if (sp.vol || sp.rel || sp.pts) return 'objectif ≥ N-1';
    if (sp.reseau) return 'vs moyenne réseau';
    return '';
  };
  const ETATS = { ok: ['#E4F2EA', '#145C35'], moy: ['#FFF0D6', '#7A4300'], ko: ['#FBE3E2', '#A11D18'], sous: ['#E3EEFB', '#0D4C92'], '': ['#F1F0EF', '#231F20'] };

  function rendreMoment(md, opts = {}) {
    const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, x => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[x]));
    const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
    const MC = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
    const ph = md.photo, mo = ph.mois, mp = md.prec ? MC[md.prec.mois - 1] : 'mois préc.';
    const logo = opts.logo || 'assets/logo-optical-center.png';
    const i0 = md.inds[0], seul = md.mode === 'seul';
    const msg = md.conf.message ? `<div class="mo-msg">${esc(md.conf.message)}</div>` : '';
    // Bandeau
    let droite;
    if (seul) {
      const r = i0.res, rp = i0.resP, e = ETATS[i0.eRes.etat] || ETATS[''];
      const vsN1 = r.v1 != null && r.v != null ? ((i0.spec.vol || i0.spec.rel) ? FMT_M(r.v / r.v1 - 1, 'evol') : deltaAff(i0, r.v - r.v1)) + ' vs N-1' : '';
      const vsM = rp.v != null && r.v != null && !(i0.spec.vol || i0.spec.rel) ? deltaAff(i0, r.v - rp.v) + ' vs ' + mp : '';
      droite = `<div class="mo-res" style="background:${i0.eRes.etat ? e[1] : '#E22F2A'}"><div class="l">Réseau</div><div class="v">${FMT_M(r.v, i0.spec.fmt)}</div><div class="o">${esc(objAff(i0))}</div></div>
        <div class="mo-evs">${vsN1 ? `<div>${vsN1}</div>` : ''}${vsM ? `<div>${vsM}</div>` : ''}<div>${md.comptes[0].ok}/${md.comptes[0].sur} magasins à l’objectif</div></div>`;
    } else {
      droite = md.inds.map(d => { const e = ETATS[d.eRes.etat] || ETATS['']; return `<div class="mo-tu" style="background:${d.eRes.etat ? e[1] : '#5A5557'}"><div class="l">${esc(d.lib)}</div><div class="v">${FMT_M(d.res.v, d.spec.fmt)}</div><div class="o">${esc(objAff(d))}</div><div class="c">${md.comptes[md.inds.indexOf(d)].ok}/${md.comptes[md.inds.indexOf(d)].sur} magasins</div></div>`; }).join('');
    }
    const bandeau = `<header class="mo-band"><div class="mo-id"><div class="mo-lab">${seul ? 'Indicateur' : 'Thème'} du moment · à fin ${MOIS[mo - 1]} ${ph.annee}</div>
      <h1>${esc(md.titre)}</h1>${msg}</div>${droite}<img class="mu-logo" src="${logo}" alt=""></header>`;
    // Bloc principal gauche
    let gauche;
    if (seul) {
      const sp = i0.spec, vals = md.course.map(x => (sp.vol || sp.rel) && x.m.v1 ? x.m.v / x.m.v1 : x.m.v).filter(v => v != null);
      const trait = sp.eff ? null : (sp.vol || sp.rel) ? 1 : i0.seuil != null ? i0.seuil : (i0.res.v1 != null ? i0.res.v1 : i0.res.v);
      const hi = Math.max(...vals.map(Math.abs), trait || 0) * 1.12 || 1;
      const lt = sp.eff ? 'barre = écart d’effectif moyen par magasin' : (sp.vol || sp.rel) ? 'trait = N-1' : i0.seuil != null ? 'trait = objectif' : 'trait = réseau N-1';
      gauche = `<div class="mu-carte mo-course"><div class="mu-t">Le classement des AR <small>${lt} · flèche = places vs ${mp}</small></div><div class="mo-barres">
        ${md.course.map(x => { const bv = (sp.vol || sp.rel) && x.m.v1 ? x.m.v / x.m.v1 : x.m.v; const c = sp.eff ? (x.m.v < 0 ? '#1565C0' : '#B5520A') : x.couleur;
          return `<div class="mo-b"><span class="r">${x.rang}.</span><span class="pa" style="background:${x.couleur}">${esc(x.ar.charAt(0))}</span><span class="n">${esc(x.ar.split(/\s+/)[0])}</span>
          <span class="piste"><i style="width:${Math.min(100, Math.abs(bv) / hi * 100).toFixed(1)}%;background:${c}"></i>${trait != null ? `<b style="left:${(trait / hi * 100).toFixed(1)}%"></b>` : ''}</span>
          <span class="v">${valAff(i0, x.m)}</span><span class="g ${x.gain > 0 ? 'ok' : x.gain < 0 ? 'ko' : ''}">${x.gain == null ? '' : x.gain > 0 ? '▲ ' + x.gain : x.gain < 0 ? '▼ ' + (-x.gain) : '='}</span></div>`; }).join('')}</div></div>`;
    } else {
      const cols = md.inds.length;
      gauche = `<div class="mu-carte mo-tab"><div class="mu-t">Le classement des AR <small>par objectifs tenus, puis ${esc(i0.lib)}</small></div>
        <div class="mo-ligne mo-tete" style="--nc:${cols}"><span></span><span></span><span></span>${md.inds.map(d => `<span>${esc(d.lib)}<br><small>${esc(objAff(d).replace('objectif ', ''))}</small></span>`).join('')}<span>Objectifs<br>tenus</span></div>
        <div class="mo-lignes">${md.tableau.map(x => `<div class="mo-ligne" style="--nc:${cols}"><span class="r">${x.rang}.</span><span class="pa" style="background:${x.couleur}">${esc(x.ar.charAt(0))}</span><span class="n">${esc(x.ar.split(/\s+/)[0])}</span>
          ${x.cells.map((c, j) => { const e = ETATS[c.e.etat] || ETATS['']; const d = md.inds[j]; return `<span class="ce" style="background:${e[0]};color:${e[1]}">${valAff(d, c.m)}${d.spec.eff && c.m.v != null ? `<small>${c.m.v <= -0.5 ? 'sous-effectif' : c.m.v < 0.5 ? 'juste' : 'sur-effectif'}</small>` : ''}</span>`; }).join('')}
          <span class="dots" style="color:${x.couleur}">${'●'.repeat(x.nOk)}${'○'.repeat(cols - x.nOk)}</span></div>`).join('')}</div></div>`;
    }
    // Colonne droite
    const medals = ['#E8B931', '#C9CDD6', '#D9A47A', '#EEECEB', '#EEECEB'];
    const champ = `<div class="mu-carte mo-champ"><div class="mu-t">Les champions <small>${seul ? 'meilleurs magasins' : `tous les objectifs tenus · ${md.tousOk}/${md.nbMags} magasins`}</small></div><div class="mo-l">
      ${md.champions.length ? md.champions.map((c, i) => `<div class="mo-c"><span class="md" style="background:${medals[i]}">${i + 1}</span><div class="tx"><b>${esc(c.nom)}</b><small style="color:${c.couleur}">AR ${esc(String(c.ar).split(/\s+/)[0])}</small></div><span class="v${seul ? '' : ' multi'}">${seul ? valAff(i0, c.cells[0].m) : c.cells.map((x, j) => valAff(md.inds[j], x.m)).join(' · ')}</span></div>`).join('') : '<div class="mu-vide">Aucun magasin pour l’instant : à vous de jouer !</div>'}</div></div>`;
    const sec = seul
      ? `<div class="mu-carte mo-prog"><div class="mu-t">Les plus fortes progressions <small>vs ${mp}</small></div><div class="mo-l">
        ${md.progres.length ? md.progres.map(p => `<div class="mo-p"><span class="d">${deltaAff(i0, (i0.spec.vol || i0.spec.rel) ? p.d0 : (i0.spec.sens || 1) * p.d0)}</span><div class="tx"><b style="color:${p.couleur}">${esc(p.nom)}</b><small>AR ${esc(String(p.ar).split(/\s+/)[0])} · ${valAff(i0, p.cells[0].m)}</small></div></div>`).join('') : '<div class="mu-vide">Comparaison disponible avec le mois précédent enregistré.</div>'}</div></div>`
      : `<div class="mu-carte mo-mob"><div class="mu-t">On se mobilise <small>le plus d’objectifs manqués</small></div><div class="mo-l">
        ${md.mobilise.length ? md.mobilise.map(m => `<div class="mu-mi"><span class="ex">!</span><div class="tx"><b>${esc(m.nom)}</b><small style="color:${m.couleur}">AR ${esc(String(m.ar).split(/\s+/)[0])}</small></div><span class="v2">${m.cells.map((x, j) => valAff(md.inds[j], x.m)).join(' · ')}</span></div>`).join('') : '<div class="mu-vide">Tous les magasins tiennent leurs objectifs.</div>'}</div></div>`;
    // Bas gauche : courbe ou écart d'effectif
    let basG;
    const dEff = md.inds.find(d => d.spec.eff);
    if (!seul && dEff) {
      const mx = Math.max(1, ...dEff.ars.map(a => Math.abs(a.m.v || 0))) * 1.1;
      basG = `<div class="mu-carte mo-eff"><div class="mu-t">Sous- et sur-effectif par AR et par magasin <small><span style="color:#1565C0">▼ sous</span> · <span style="color:#B5520A">▲ sur</span> · ETP moyen</small></div><div class="mo-effs">
        ${dEff.ars.filter(a => a.m.v != null).map(a => { const h = Math.abs(a.m.v) / mx * 50, c = a.m.v < 0 ? '#1565C0' : '#B5520A';
          return `<div class="mo-ec"><div class="zone"><i class="axe"></i><i class="bar" style="background:${c};height:${h.toFixed(1)}%;top:${(a.m.v >= 0 ? 50 - h : 50).toFixed(1)}%"></i></div><b style="color:${c}">${FMT_M(a.m.v, 'sg1')}</b><span>${esc(a.ar.split(/\s+/)[0])}</span></div>`; }).join('')}</div></div>`;
    } else {
      const s = md.serie;
      if (!s || s.length < 2) basG = `<div class="mu-carte mu-courbe"><div class="mu-t">Le réseau mois par mois</div><div class="mu-vide">Courbe disponible à partir de deux mois enregistrés.</div></div>`;
      else {
        const W = 760, H = 170, ys = s.flatMap(x => [x.v, x.v1]).filter(x => x != null).concat(i0.seuil != null ? [i0.seuil] : []).concat((i0.spec.vol || i0.spec.rel) ? [1] : []);
        let mn = Math.min(...ys), mx = Math.max(...ys); const pad = (mx - mn) * 0.15 || Math.abs(mx) * 0.1 || 1; mn -= pad; mx += pad;
        const X = m2 => 24 + (m2 - 1) * (W - 48) / Math.max(1, mo - 1), Y = v => H - 26 - (v - mn) / (mx - mn) * (H - 44);
        const ligne = (k, c, w, dash) => { const pts = s.filter(x => x[k] != null); return pts.length > 1 ? `<polyline points="${pts.map(x => `${X(x.mois).toFixed(1)},${Y(x[k]).toFixed(1)}`).join(' ')}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linejoin="round"${dash ? ' stroke-dasharray="8 6"' : ''}/>` : ''; };
        const der = s[s.length - 1];
        basG = `<div class="mu-carte mu-courbe"><div class="mu-t">Le réseau mois par mois <small>${esc(i0.lib)} · <span style="color:#E22F2A">━ ${ph.annee}</span>${s.some(x => x.v1 != null) ? ` · <span class="gris">┅ ${ph.annee - 1}</span>` : ''}</small></div>
          <svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="none">
          ${i0.seuil != null ? `<line x1="24" x2="${W - 24}" y1="${Y(i0.seuil).toFixed(1)}" y2="${Y(i0.seuil).toFixed(1)}" stroke="#231F20" stroke-width="1.5" stroke-dasharray="6 6"/><text x="${W - 24}" y="${(Y(i0.seuil) - 6).toFixed(1)}" text-anchor="end" class="mu-sv">${esc(objAff(i0))}</text>` : ''}
          ${(i0.spec.vol || i0.spec.rel) ? `<line x1="24" x2="${W - 24}" y1="${Y(1).toFixed(1)}" y2="${Y(1).toFixed(1)}" stroke="#9A9A9A" stroke-width="2" stroke-dasharray="8 6"/><text x="${W - 24}" y="${(Y(1) - 6).toFixed(1)}" text-anchor="end" class="mu-sv">niveau N-1</text>` : ''}
          ${ligne('v1', '#9A9A9A', 3, true)}${ligne('v', '#E22F2A', 5)}
          ${der.v != null ? `<circle cx="${X(der.mois).toFixed(1)}" cy="${Y(der.v).toFixed(1)}" r="8" fill="#E22F2A"/>` : ''}
          <text x="24" y="${H - 4}" class="mu-sm">${MC[s[0].mois - 1]}</text><text x="${W - 24}" y="${H - 4}" text-anchor="end" class="mu-sm">${MC[der.mois - 1]} · ${(i0.spec.vol || i0.spec.rel) ? FMT_M(der.v - 1, 'evol') + ' vs N-1' : FMT_M(der.v, i0.spec.fmt)}</text></svg></div>`;
      }
    }
    // Bas droite : la course des AR au positionnement (24/11/2026, retirée des cockpits mur)
    let basD;
    const cp = md.coursePos;
    if (!(seul && i0.k === 'posit') && cp.length) {
      const hiP = Math.max(1.1, ...cp.map(x => x.v + 0.02));
      basD = `<div class="mu-carte mo-cpos"><div class="mu-t">La course des AR <small>positionnement · places vs ${mp}</small></div><div class="mo-cpl">
        ${cp.map(x => `<div class="mo-cp"><span class="r">${x.rang}.</span><span class="n" style="color:${x.couleur}">${esc(x.ar.split(/\s+/)[0])}</span><span class="piste"><i style="width:${(Math.max(0, x.v) / hiP * 100).toFixed(1)}%;background:${x.couleur}"></i><b style="left:${(100 / hiP).toFixed(1)}%"></b></span><span class="v">${FMT_M(x.v, 'pct0')}</span><span class="g ${x.gain > 0 ? 'ok' : x.gain < 0 ? 'ko' : ''}">${x.gain == null ? '' : x.gain > 0 ? '▲ ' + x.gain : x.gain < 0 ? '▼ ' + (-x.gain) : '='}</span></div>`).join('')}</div></div>`;
    } else if (seul) {
      const c = md.comptes[0], r = i0.res;
      let manque = '';
      if (i0.seuil != null && r.v != null) { const d = (i0.seuil - r.v) * (i0.spec.sens || 1);
        manque = d > 0 ? `<div class="mu-bad b3 large"><div class="v">${deltaAff(i0, d).replace(/^[+−]/, '')}</div><div class="l">à aller chercher pour atteindre l’${esc(objAff(i0))} sur le réseau</div></div>`
          : `<div class="mu-bad b2 large"><div class="v">✓</div><div class="l">Objectif atteint sur le réseau : on garde le cap !</div></div>`; }
      else if (r.v != null && r.v1 != null) { const d = (i0.spec.vol || i0.spec.rel) ? r.v / r.v1 - 1 : r.v - r.v1;
        manque = `<div class="mu-bad ${d >= 0 ? 'b2' : 'b3'} large"><div class="v">${(i0.spec.vol || i0.spec.rel) ? FMT_M(d, 'evol') : deltaAff(i0, d)}</div><div class="l">${d >= 0 ? 'd’avance sur N-1 pour le réseau' : 'de retard sur N-1 pour le réseau : on se mobilise !'}</div></div>`; }
      basD = `<div class="mu-badges"><div class="mu-bad b1"><div class="v">${c.ok}/${c.sur}</div><div class="l">magasins à l’objectif</div></div>
        <div class="mu-bad b2"><div class="v">${c.avecP ? c.progres + '/' + c.avecP : '–'}</div><div class="l">magasins en progrès vs ${mp}</div></div>${manque}</div>`;
    } else {
      basD = `<div class="mo-cpt" style="--nc:${md.inds.length}">${md.inds.map((d, j) => `<div class="mu-bad b2"><div class="v">${md.comptes[j].ok}/${md.comptes[j].sur}</div><div class="l">${esc(d.lib)}<br>${esc(objAff(d))}</div></div>`).join('')}
        <div class="mu-bad b1 large"><div class="v">${md.tousOk}/${md.nbMags}</div><div class="l">magasins tiennent tous les objectifs à la fois</div></div></div>`;
    }
    const sources = md.inds.some(d => d.k === 're') && ph.sources && ph.sources.rentabilites && ph.sources.rentabilites.periode && ph.sources.rentabilites.periode.au
      ? `RE : reporting trimestriel à fin ${ph.sources.rentabilites.periode.au.slice(5, 7)}/${ph.sources.rentabilites.periode.au.slice(0, 4)}` : `Optical Center · Suivi statistique · généré le ${new Date().toLocaleDateString('fr-FR')}`;
    return `<div class="cockpit mur moment">${bandeau}
      <div class="mo-milieu">${gauche}<div class="mo-droite">${champ}${sec}</div></div>
      <div class="mu-bas">${basG}${basD}</div>
      <footer class="ck-pied"><span>${esc(sources)}</span><span class="slogan">Entendre et voir UNIQUEMENT le <b>BIEN</b></span><span>Succursales France · ${md.nbMags} magasins</span></footer></div>`;
  }
  // Série réseau d'un indicateur mois par mois (photos de l'année)
  function serieMoment(photos, ref, conf) {
    const k = listeMoment(conf).ind[0];
    const succFr = r => r.pays === 'FRANCE' && r.type === 'Succursale' && r.nature !== 'Camion' && norm(r.ar) !== 'OCM';
    return photos.filter(Boolean).map(ph => { const m = mesure(k, ph, ref.filter(r => succFr(r) && ph.magasins[String(r.code)]));
      const sp = MSPEC[k]; return { mois: ph.mois, v: sp.vol || sp.rel ? (m.v1 ? m.v / m.v1 : null) : m.v, v1: sp.vol || sp.rel ? null : m.v1 }; })
      .filter(x => x.v != null).sort((a, b) => a.mois - b.mois);
  }
  const api = { construireMoment, rendreMoment, serieMoment, listeMoment, MOMENT_LIBS, MOMENT_THEMES, MOMENT_DEFAUT, construireMur, rendreMur, MUR_INDICS, MUR_DEFAUT, couleursAr, OBJ_AVIS_GOOGLE, definirParis, paris: () => PARIS.slice(), LISTES_CONF_DEFAUT, SIEGE_DEFAUT, perimetres, construire, rendre, THEMES, COL, TAUX_DEFAUT, DEVISE_SYM, agreger, W_PAGE, H_PAGE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Cockpit = api;
})(typeof self !== 'undefined' ? self : this);
