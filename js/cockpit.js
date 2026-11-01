/* Cockpits : un périmètre × un thème → une page A3 paysage (jamais plus d'une page).
 * Les données viennent de la photo du mois (cumul depuis le 1er janvier) ; N-1 = même période de l'année précédente. */
(function (root) {
  'use strict';

  const DEVISE_SYM = { 'Euro': '€', 'Shekel': '₪', 'Franc Suisse': 'CHF', 'Livre Sterling': '£', 'Dollars Canadien': '$CA', 'Dolard': '$' };
  // Taux de conversion vers l'euro pour les totaux multi-devises (modifiables dans Réglages)
  const TAUX_DEFAUT = { 'Euro': 1, 'Shekel': 0.25, 'Franc Suisse': 1.06, 'Livre Sterling': 1.17, 'Dollars Canadien': 0.66, 'Dolard': 0.92 };
  const norm = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();

  // ---------- Agrégation : montants additionnés, ratios pondérés par leur base ----------
  const POIDS = { V: 'U', W: 'U', AC: 'U', AD: 'U', AE: 'U', AF: 'U', AN: 'U', AP: 'U', AR: 'U',
    AY: 'AW', BB: 'AW', BH: 'AW', AZ: 'AX', BA: 'AX', BD: 'AX', BC: 'Q', BE: 'U',
    BV: 'BU', BQ: 'BU', CQ: 'CP', CS: 'CP', CU: 'CP', CW: 'CP', CY: 'CP', CM: 'P', BK: 'BL', BN: 'BO' };
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
          if (w) { const p = (d[w] || 0) * (MONTANTS.has(w) ? t : 1); s += v * p; sw += p; vu = true; }
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
    indus: { lib: 'Taux d’indus', f: (n) => n.BV, fmt: 'pct2', seuil: 0.01, inverse: true },
    caHt: { lib: 'CA HT (reporting)', f: (n) => n.CP, fmt: 'k' },
    re: { lib: 'RE', f: (n) => pct(n.CQ), fmt: 'pct1', seuil: 0.20 },
    marge: { lib: 'Marge produits', f: (n) => pct(n.CS), fmt: 'pct1', seuil: 0.70 },
    loyers: { lib: 'Loyers chargés', f: (n) => pct(n.CU), fmt: 'pct1', seuil: 0.06, inverse: true },
    pub: { lib: 'Publicité', f: (n) => pct(n.CW), fmt: 'pct1', seuil: 0.07, inverse: true },
    personnel: { lib: 'Personnel', f: (n) => pct(n.CY), fmt: 'pct1', seuil: 0.28, inverse: true },
    rentaSal: { lib: 'Renta salariale', f: (n) => pct(n.CM), fmt: 'pct1', seuil: 0.28, inverse: true },
    note: { lib: 'Note Google', f: (n) => n.BL ? n.BK : null, fmt: 'note', seuil: 4.5 },
    avis: { lib: 'Avis Google', f: (n) => n.BL, fmt: 'nb' },
  };

  const THEMES = {
    ca: { lib: 'Chiffre d’affaires', cols: ['obj', 'ca', 'prev', 'evolCa', 'posit', 'caOpt', 'caAud', 'caCon', 'ndv', 'evolNdv'], tri: 'ca',
      top: [['posit', 'Positionnement'], ['ca', 'CA généré'], ['evolCa', 'Évolution du CA']] },
    optique: { lib: 'Optique', cols: ['ndv', 'evolNdv', 'panier', 'evolPanier', 'tc', 'sop', 'mdc', 'pcPct', 'pcEur', 'pm1'], tri: 'ndv',
      top: [['ndv', 'Nombre de ventes'], ['panier', 'Panier moyen'], ['tc', 'Taux de concrétisation']] },
    audio: { lib: 'Audio', cols: ['caAudio', 'evolAudio', 'ventesA', 'protheses', 'panierA', 'pmProt', 'sap', 'tcA', 'vadd', 'depist'], tri: 'caAudio',
      top: [['protheses', 'Nombre de prothèses'], ['caAudio', 'CA audio'], ['depist', 'Dépistage']] },
    restes: { lib: 'Restes dus', cols: ['rdus', 'avoirs', 'gel', 'indus'], tri: 'indus',
      top: [['indus', 'Taux d’indus le plus bas', true]] },
    renta: { lib: 'Rentabilité & gestion', cols: ['caHt', 're', 'marge', 'loyers', 'pub', 'personnel', 'rentaSal', 'indus', 'note', 'avis'], tri: 're',
      top: [['re', 'Résultat d’exploitation'], ['note', 'Note Google'], ['indus', 'Taux d’indus le plus bas', true]] },
  };

  // ---------- Périmètres ----------
  function perimetres(ref) {
    const act = ref.filter(r => r.actif === 'Oui');
    const fr = r => r.pays === 'FRANCE';
    const succFr = r => fr(r) && r.type === 'Succursale' && r.nature !== 'Camion' && norm(r.ar) !== 'OCM';
    const out = [
      { id: 'siege', lib: 'Réseau – vue Siège', groupeLib: 'Synthèse', special: 'siege', themes: ['siege'] },
      { id: 'france', lib: 'France – succursales', groupeLib: 'France', filtre: succFr, sousTotal: r => r.ar, themes: ['ca', 'optique', 'audio', 'restes', 'renta'] },
    ];
    [...new Set(act.filter(succFr).map(r => r.ar))].filter(Boolean).sort().forEach(a =>
      out.push({ id: 'ar:' + a, lib: 'AR – ' + a, groupeLib: 'France', filtre: r => succFr(r) && r.ar === a, themes: ['ca', 'optique', 'audio', 'restes', 'renta'] }));
    out.push({ id: 'ocm', lib: 'OCM (camions succursales)', groupeLib: 'France', filtre: r => fr(r) && norm(r.ar) === 'OCM', themes: ['ca', 'optique', 'audio', 'restes'] });
    out.push({ id: 'franchises', lib: 'Franchises France – par franchisé', groupeLib: 'Franchises', filtre: r => fr(r) && r.type === 'Franchise', regrouper: r => r.groupe, themes: ['ca', 'optique', 'audio'] });
    const grp = {}; act.filter(r => fr(r) && r.type === 'Franchise').forEach(r => { grp[r.groupe] = (grp[r.groupe] || 0) + 1; });
    Object.keys(grp).filter(g => grp[g] >= 2).sort().forEach(g =>
      out.push({ id: 'groupe:' + g, lib: 'Groupe – ' + g, groupeLib: 'Franchises', filtre: r => fr(r) && r.type === 'Franchise' && r.groupe === g, themes: ['ca', 'optique', 'audio'] }));
    out.push({ id: 'inter', lib: 'International – tous pays', groupeLib: 'International', filtre: r => !fr(r), sousTotal: r => r.pays, multiDevise: true, themes: ['ca', 'optique', 'audio', 'renta'] });
    [...new Set(act.filter(r => !fr(r)).map(r => r.pays))].sort().forEach(p =>
      out.push({ id: 'pays:' + p, lib: 'Pays – ' + p, groupeLib: 'International', filtre: r => r.pays === p, themes: ['ca', 'optique', 'audio', 'renta'] }));
    return out;
  }

  // ---------- Modèle d'une page ----------
  function construire(photo, ref, perim, themeId, opts = {}) {
    const m = photo.mois, taux = Object.assign({}, TAUX_DEFAUT, opts.taux || {});
    if (perim.special === 'siege') return construireSiege(photo, ref, taux);
    const th = THEMES[themeId];
    const mags = ref.filter(r => r.actif === 'Oui' && perim.filtre(r) && photo.magasins[String(r.code)]);
    const devises = [...new Set(mags.map(r => r.devise || 'Euro'))];
    const multi = devises.length > 1;
    const conv = multi ? it => taux[it.devise] || 1 : null;
    const item = r => ({ ...photo.magasins[String(r.code)], devise: r.devise || 'Euro', r });
    const valeurs = (d) => { const o = {}; th.cols.forEach(k => { o[k] = COL[k].f(d.N || {}, d.N1 || {}, m); }); return o; };
    let lignes;
    if (perim.regrouper) {
      const g = {}; mags.forEach(r => { const k = perim.regrouper(r) || '—'; (g[k] = g[k] || []).push(item(r)); });
      lignes = Object.entries(g).map(([k, its]) => ({ code: its.length + ' mag.', nom: k, v: valeurs(agreger(its, conv)) }));
    } else lignes = mags.map(r => ({ code: String(r.code), nom: r.magasin, v: valeurs(photo.magasins[String(r.code)]), dev: DEVISE_SYM[r.devise] || '€' }));
    // Objectifs (pays de référence du périmètre) pour colorer les cellules
    const obj = objectifsRef(opts.objectifs, mags);
    const total = { nom: 'TOTAL', v: valeurs(agreger(mags.map(item), conv)) };
    let sous = [];
    if (perim.sousTotal) {
      const g = {}; mags.forEach(r => { const k = perim.sousTotal(r) || '—'; (g[k] = g[k] || []).push(r); });
      sous = Object.entries(g).sort((a, b) => a[0].localeCompare(b[0])).map(([k, rs]) => ({ nom: k, n: rs.length, v: valeurs(agreger(rs.map(item), conv)), dev: [...new Set(rs.map(r => DEVISE_SYM[r.devise] || '€'))].join('/') }));
    }
    let tri = opts.tri || 'code'; if (tri === 'code' && perim.regrouper) tri = 'nom';
    if (tri === 'code') lignes.sort((a, b) => String(a.code).localeCompare(String(b.code), 'fr', { numeric: true }));
    else if (tri === 'nom') lignes.sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
    else lignes.sort((a, b) => (b.v[tri] ?? -Infinity) - (a.v[tri] ?? -Infinity));
    lignes.forEach((l, i) => l.rang = i + 1);
    const top = th.top.map(([k, lib, asc]) => ({ lib, fmt: COL[k].fmt, liste: lignes.filter(l => l.v[k] != null && !(asc && l.v[k] === 0 && k === 'indus' && false)).slice().sort((a, b) => asc ? a.v[k] - b.v[k] : b.v[k] - a.v[k]).slice(0, 3).map(l => [l.nom, l.v[k]]) }));
    const posit = mags.map(r => COL.posit.f(photo.magasins[String(r.code)].N || {}, {}, m));
    const prevs = mags.map(r => COL.prev.f(photo.magasins[String(r.code)].N || {}, {}, m) * (multi ? (taux[r.devise] || 1) : 1));
    const compteurs = [['Magasins', mags.length], ['Magasins à 100 %', posit.filter(x => x != null && x >= 1).length], ['Prévisionnel ≥ 1,2 M€', prevs.filter(x => x >= 1.2e6).length]];
    if (themeId === 'restes') compteurs.push(['Taux d’indus ≤ 1 %', mags.filter(r => { const v = (photo.magasins[String(r.code)].N || {}).BV; return v != null && v <= 0.01; }).length]);
    return { type: 'liste', perim, theme: th, themeId, photo, cols: th.cols, lignes, total, sous, top, compteurs, obj, multi, devTotal: multi ? '€' : (DEVISE_SYM[devises[0]] || '€'), sousLib: perim.id === 'france' ? 'AR' : perim.id === 'inter' ? 'Pays' : '' };
  }
  function objectifsRef(objectifs, mags) {
    const rows = (objectifs && objectifs.rows) || [];
    const pays = [...new Set(mags.map(r => r.pays))];
    if (pays.length !== 1) return {};
    return rows.find(r => r.type === 'Pays' && norm(r.cle) === norm(pays[0])) || {};
  }

  // Vue Siège : synthèse par pays (CA converti en €), rentabilité succursales, évolutions
  function construireSiege(photo, ref, taux) {
    const m = photo.mois, act = ref.filter(r => r.actif === 'Oui' && photo.magasins[String(r.code)]);
    const conv = it => taux[it.devise] || 1;
    const item = r => ({ ...photo.magasins[String(r.code)], devise: r.devise || 'Euro' });
    const ordre = ['FRANCE', 'ESPAGNE', 'BELGIQUE', 'LUXEMBOURG', 'SUISSE', 'ISRAEL', 'CANADA', 'ROYAUME-UNI', 'IRLANDE'];
    const paysL = [...new Set(act.map(r => r.pays))].sort((a, b) => (ordre.indexOf(a) + 1 || 99) - (ordre.indexOf(b) + 1 || 99));
    const ligne = (nom, rs) => {
      const a = agreger(rs.map(item), conv), n = a.N, p = a.N1;
      const prev = n.P != null ? n.P * 12 / m : null, obj = n.O != null ? n.O * 1000 : null;
      const prevMag = rs.map(r => { const x = photo.magasins[String(r.code)].N || {}; return x.P != null ? x.P * 12 / m * (taux[r.devise] || 1) : 0; });
      return { nom, ca: n.P, evol: evol(n.P, p.P), obj, posit: div(prev, obj), prev,
        succ: rs.filter(r => r.type === 'Succursale').length, fr: rs.filter(r => r.type === 'Franchise').length, sup12: prevMag.filter(x => x >= 1.2e6).length,
        evolOpt: evol(n.P != null ? n.P - (n.Q || 0) - (n.R || 0) : null, p.P != null ? p.P - (p.Q || 0) - (p.R || 0) : null), evolAud: evol(n.Q, p.Q),
        evolNdv: evol(n.U, p.U), evolNdvA: evol(n.AW, p.AW), ndv: n.U, ndvA: n.AW,
        re: pct(n.CQ), marge: pct(n.CS), loyers: pct(n.CU), pub: pct(n.CW), rentaSal: pct(n.CM), note: n.BL ? n.BK : null, avis: n.BL };
    };
    const pays = paysL.map(p => ligne(p, act.filter(r => r.pays === p)));
    const total = ligne('TOTAL', act);
    const succ = paysL.map(p => ligne(p, act.filter(r => r.pays === p && r.type === 'Succursale'))).filter(l => l.succ);
    const succTot = ligne('SUCCURSALES', act.filter(r => r.type === 'Succursale'));
    const segments = [['Succursales France', r => r.pays === 'FRANCE' && r.type === 'Succursale'], ['Franchises France', r => r.pays === 'FRANCE' && r.type === 'Franchise'], ['International', r => r.pays !== 'FRANCE']]
      .map(([n, f]) => ligne(n, act.filter(f)));
    return { type: 'siege', photo, pays, total, succ, succTot, segments, taux };
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
        case 'evol': return (v > 0 ? '+' : '') + nb(v * 100, 1) + ' %';
        case 'note': return nb(v, 1);
        default: return nb(v);
      }
    };
    const logo = opts.logo || 'assets/logo-optical-center.png';
    const titreMois = `À fin ${MOIS[md.photo.mois - 1]} ${md.photo.annee}`;
    const periode = `cumul du 1er janvier au ${new Date(md.photo.annee, md.photo.mois, 0).toLocaleDateString('fr-FR')}`;
    const entete = (perimLib, themeLib) => `<header class="ck-head"><img src="${logo}" alt=""><div class="ck-t"><div class="ck-label">${esc(titreMois)} · ${esc(periode)}</div><h1>${esc(perimLib)}</h1></div><div class="ck-theme">${esc(themeLib)}</div></header>`;
    const pied = `<footer class="ck-pied"><span>Optical Center · Suivi statistique · généré le ${new Date().toLocaleDateString('fr-FR')}</span><span>N-1 : même période de l’année précédente${md.multi || md.type === 'siege' ? ' · totaux multi-devises convertis en € (taux en Réglages)' : ''}</span></footer>`;

    if (md.type === 'siege') return rendreSiege(md, { esc, f, nb, entete, pied });

    const cl = (k, v, obj) => {
      const c = COL[k]; let ref = c.obj ? obj[c.obj] : c.seuil;
      if (v == null || ref == null) return c.fmt === 'evol' ? (v == null ? '' : v >= 0 ? 'ok' : 'ko') : '';
      return (c.inverse ? v <= ref : v >= ref) ? 'ok' : 'ko';
    };
    const cellules = (l, dev) => md.cols.map(k => `<td class="${cl(k, l.v[k], md.obj)}${COL[k].fort ? ' fort' : ''}">${f(l.v[k], COL[k].fmt, dev)}</td>`).join('');
    const thead = `<thead><tr><th class="rg">#</th><th class="nm">${md.perim.regrouper ? 'Franchisé' : 'Magasin'}</th>${md.cols.map(k => `<th>${esc(COL[k].lib)}</th>`).join('')}</tr></thead>`;

    // Répartition en colonnes : on cherche le nombre de blocs qui tient sur la page
    const n = md.lignes.length;
    const hDispo = opts.hListe || 640;
    const nCols = md.cols.length;
    let blocs = 1; while (blocs < 4 && n / blocs * 10.5 > hDispo) blocs++;
    if (blocs > 1 && nCols > 7) blocs = Math.min(blocs, 3);
    const parBloc = Math.ceil(n / blocs);
    const hLigne = Math.max(9, Math.min(22, hDispo / Math.max(1, parBloc)));
    const fs = Math.max(6.8, Math.min(11.5, hLigne * 0.68));
    const morceaux = []; for (let i = 0; i < n; i += parBloc) morceaux.push(md.lignes.slice(i, i + parBloc));
    const tables = morceaux.map(ls => `<table class="ck-liste" style="--h:${hLigne.toFixed(1)}px;--fs:${fs.toFixed(1)}px">${thead}<tbody>${ls.map(l => `<tr><td class="rg">${esc(l.rang)}</td><td class="nm"><b>${esc(l.nom)}</b><small>${esc(l.code)}</small></td>${cellules(l, l.dev || md.devTotal)}</tr>`).join('')}</tbody></table>`).join('');

    const ligneSyn = (l, cls, lib) => `<tr class="${cls}"><td class="nm" colspan="2"><b>${esc(lib || l.nom)}</b>${l.n ? `<small>${l.n} mag.</small>` : ''}</td>${cellules(l, md.devTotal)}</tr>`;
    const synthese = `<table class="ck-syn"><thead><tr><th class="nm" colspan="2">${esc(md.sousLib || 'Périmètre')}</th>${md.cols.map(k => `<th>${esc(COL[k].lib)}</th>`).join('')}</tr></thead><tbody>
      ${md.sous.map(s => ligneSyn(s, '')).join('')}${ligneSyn(md.total, 'tot', 'TOTAL ' + (md.perim.lib.split(' – ')[1] || md.perim.lib))}</tbody></table>`;
    const tops = md.top.map(t => `<div class="ck-top"><div class="l">Top 3 · ${esc(t.lib)}</div>${t.liste.map((x, i) => `<div class="r"><span>${['🥇', '🥈', '🥉'][i]}</span><b>${esc(x[0])}</b><em>${f(x[1], t.fmt, md.devTotal)}</em></div>`).join('') || '<div class="r muted">–</div>'}</div>`).join('');
    const compteurs = md.compteurs.map(([l, v]) => `<div class="ck-cpt"><div class="v">${nb(v)}</div><div class="l">${esc(l)}</div></div>`).join('');

    return `<div class="cockpit" data-blocs="${blocs}">
      ${entete(md.perim.lib, md.theme.lib)}
      <div class="ck-haut"><div class="ck-cpts">${compteurs}</div><div class="ck-tops">${tops}</div></div>
      <section class="ck-sec"><h2><span>Synthèse</span></h2>${synthese}</section>
      <section class="ck-sec ck-corps"><h2><span>Détail par ${md.perim.regrouper ? 'franchisé' : 'magasin'}</span><small>${n} ${md.perim.regrouper ? 'franchisés' : 'magasins'} · tri : ${esc(opts.triLib || 'code')}</small></h2><div class="ck-blocs" style="--blocs:${blocs}">${tables}</div></section>
      ${pied}</div>`;
  }

  function rendreSiege(md, { esc, f, nb, entete, pied }) {
    const L = (l, cls = '') => `<tr class="${cls}"><td class="nm"><b>${esc(l.nom)}</b></td><td class="fort">${f(l.ca, 'k')}</td><td class="${l.evol == null ? '' : l.evol >= 0 ? 'ok' : 'ko'}">${f(l.evol, 'evol')}</td><td>${f(l.obj, 'k')}</td><td class="${l.posit == null ? '' : l.posit >= 1 ? 'ok' : 'ko'}">${f(l.posit, 'pct0')}</td><td>${f(l.prev, 'k')}</td><td>${nb(l.succ)}</td><td>${nb(l.fr)}</td><td>${nb(l.sup12)}</td>
      <td class="${l.evolOpt == null ? '' : l.evolOpt >= 0 ? 'ok' : 'ko'}">${f(l.evolOpt, 'evol')}</td><td class="${l.evolAud == null ? '' : l.evolAud >= 0 ? 'ok' : 'ko'}">${f(l.evolAud, 'evol')}</td><td>${nb(l.ndv)}</td><td class="${l.evolNdv == null ? '' : l.evolNdv >= 0 ? 'ok' : 'ko'}">${f(l.evolNdv, 'evol')}</td><td>${nb(l.ndvA)}</td><td class="${l.evolNdvA == null ? '' : l.evolNdvA >= 0 ? 'ok' : 'ko'}">${f(l.evolNdvA, 'evol')}</td></tr>`;
    const head = `<thead><tr><th class="nm"></th><th>CA généré (€)</th><th>Évol. CA</th><th>Objectif</th><th>Position.</th><th>Prévisionnel</th><th>Succ.</th><th>Franch.</th><th>≥ 1,2 M€</th><th>Évol. CA optique</th><th>Évol. CA audio</th><th>Ventes optique</th><th>Évol.</th><th>Ventes audio</th><th>Évol.</th></tr></thead>`;
    const t = md.total;
    const R = (l, cls = '') => `<tr class="${cls}"><td class="nm"><b>${esc(l.nom)}</b><small>${l.succ} succ.</small></td><td>${f(l.ca, 'k')}</td><td class="${l.re == null ? '' : l.re >= 0.2 ? 'ok' : 'ko'}">${f(l.re, 'pct1')}</td><td class="${l.marge == null ? '' : l.marge >= 0.7 ? 'ok' : 'ko'}">${f(l.marge, 'pct1')}</td><td>${f(l.loyers, 'pct1')}</td><td>${f(l.pub, 'pct1')}</td><td class="${l.rentaSal == null ? '' : l.rentaSal <= 0.28 ? 'ok' : 'ko'}">${f(l.rentaSal, 'pct1')}</td><td>${l.note == null ? '–' : '★ ' + nb(l.note, 1)}</td><td>${nb(l.avis)}</td></tr>`;
    const tuile = (lib, v, s = '', cls = '') => `<div class="ck-cpt ${cls}"><div class="v">${v}</div><div class="l">${esc(lib)}</div>${s ? `<div class="s">${s}</div>` : ''}</div>`;
    return `<div class="cockpit siege">
      ${entete('Réseau Optical Center', 'Vue Siège')}
      <div class="ck-cpts large">
        ${tuile('CA généré réseau', f(t.ca, 'k'), `<span class="${t.evol >= 0 ? 'ok' : 'ko'}">${f(t.evol, 'evol')} vs N-1</span>`, 'noir')}
        ${tuile('Objectif annuel', f(t.obj, 'k'))}
        ${tuile('Positionnement', f(t.posit, 'pct1'), 'projection fin d’année', t.posit >= 1 ? 'ok' : 'ko')}
        ${tuile('Prévisionnel', f(t.prev, 'k'))}
        ${tuile('Magasins', nb(t.succ + t.fr), `${t.succ} succursales · ${t.fr} franchises`)}
        ${tuile('Prévisionnel ≥ 1,2 M€', nb(t.sup12), `${nb(t.sup12 / Math.max(1, t.succ + t.fr) * 100)} % du réseau`)}
      </div>
      <section class="ck-sec"><h2><span>Chiffre d’affaires par pays</span></h2><table class="ck-syn">${head}<tbody>${md.pays.map(l => L(l)).join('')}${L(t, 'tot')}</tbody></table></section>
      <div class="ck-2">
        <section class="ck-sec"><h2><span>Par segment</span></h2><table class="ck-syn">${head}<tbody>${md.segments.map(l => L(l)).join('')}</tbody></table></section>
      </div>
      <section class="ck-sec"><h2><span>Rentabilité succursales</span><small>reporting trimestriel · renta salariale cumul</small></h2><table class="ck-syn"><thead><tr><th class="nm"></th><th>CA généré</th><th>RE</th><th>Marge produits</th><th>Loyers chargés</th><th>Publicité</th><th>Renta salariale</th><th>Note Google</th><th>Avis</th></tr></thead><tbody>${md.succ.map(l => R(l)).join('')}${R(md.succTot, 'tot')}</tbody></table></section>
      ${pied}</div>`;
  }

  const api = { perimetres, construire, rendre, THEMES, COL, TAUX_DEFAUT, DEVISE_SYM, agreger, W_PAGE, H_PAGE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Cockpit = api;
})(typeof self !== 'undefined' ? self : this);
