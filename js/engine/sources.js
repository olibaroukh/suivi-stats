/* Lecture des sources non-Cosium (fichiers Excel). Entrée : classeur SheetJS. Sortie : { code: {colonne: valeur} }.
 * Les colonnes sont reconnues par leur nom, jamais par leur position. */
(function (root) {
  'use strict';
  const norm = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9%]/g, '');
  const code = v => { const m = String(v == null ? '' : v).trim().match(/^0*(\d{3,6})$/); return m ? m[1] : null; };
  const num = v => (v == null || v === '') ? null : (typeof v === 'number' ? v : (isFinite(+String(v).replace(',', '.')) ? +String(v).replace(',', '.') : null));

  function rows(XLSX, ws) { return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }); }
  function findSheet(wb, re) { const n = wb.SheetNames.find(s => re.test(s)); return n ? wb.Sheets[n] : null; }
  function headerRow(R, test) { return R.findIndex(r => r && r.some(v => test(norm(v)))); }

  // T07-MARGES (France ou International) → onglet « TOTAL by Cat »
  function marges(XLSX, wb) {
    const R = rows(XLSX, findSheet(wb, /^TOTAL by Cat/i));
    const h = headerRow(R, v => v === 'MAGASINS'); const H = R[h], G = R[h - 1] || [];
    let grp = ''; const cols = H.map((v, i) => { if (G[i]) grp = norm(G[i]); return grp + '|' + norm(v); });
    const ci = H.findIndex((v, i) => i < 4 && R.slice(h + 1, h + 5).some(r => code(r[i])));
    const pick = k => cols.indexOf(k);
    const map = { CA: pick('VERRES|CAHT'), CB: pick('VERRES|MARGE'), CC: pick('CONTACTOBV|CAHT'), CD: pick('CONTACTOBV|MARGE'),
                  CE: pick('MSA|CAHT'), CF: pick('MSA|MARGE'), CG: pick('AUDIO|CAHT'), CH: pick('AUDIO|MARGE') };
    const out = {};
    for (const r of R.slice(h + 1)) { const c = code(r[ci]); if (!c) continue; out[c] = {}; for (const k in map) out[c][k] = map[k] >= 0 ? num(r[map[k]]) : null; }
    return { out, missing: Object.keys(map).filter(k => map[k] < 0), periode: (R.find(r => r && r.includes('PERIODE')) || []).filter(Boolean).pop() };
  }

  // T12_RENTASAL (France ou International) → onglet cumulé « CLASSE PAR DR … »
  function rentaSal(XLSX, wb) {
    const R = rows(XLSX, findSheet(wb, /^CLASSE PAR DR/i));
    const h = headerRow(R, v => v === 'NOMINTERNE'); const H = R[h].map(norm);
    const ci = H.indexOf('N'), ca = H.findIndex(v => v.startsWith('CAHT')), sal = H.findIndex(v => v === 'COUTSALAIRESTOTAL') >= 0 ? H.findIndex(v => v === 'COUTSALAIRESTOTAL') : H.findIndex(v => v.startsWith('COUTSALAIRES')), rt = H.indexOf('RENTABILITE');
    const out = {};
    for (const r of R.slice(h + 1)) { const c = code(r[ci]); if (!c) continue; out[c] = { CN: num(r[ca]), CO: num(r[sal]), CM: r[rt] == null ? null : num(r[rt]) * 100 }; }
    return { out, periode: (R[0] || []).filter(v => typeof v === 'string')[0] };
  }

  // Taux d'indus (Restes dus) : Données Restes Dus + TCD Avoirs / Gel Primes / CA TTC + taux des onglets Secteurs
  function restesDus(XLSX, wb) {
    const out = {};
    const put = (c, k, v) => { (out[c] = out[c] || {})[k] = v; };
    const R0 = rows(XLSX, findSheet(wb, /^Donn.es Restes Dus/i)); const h0 = headerRow(R0, v => v === 'RDUS'); const H0 = R0[h0].map(norm);
    for (const r of R0.slice(h0 + 1)) { const c = code(r[H0.indexOf('CODE')]); if (c) put(c, 'BR', num(r[H0.indexOf('RDUS')])); }
    const tcd = (re, k, f = 1) => { const ws = findSheet(wb, re); if (!ws) return; for (const r of rows(XLSX, ws)) { const c = code(r[0]); if (c && num(r[1]) != null) put(c, k, num(r[1]) * f); } };
    tcd(/^TCD Avoirs/i, 'BS'); tcd(/^TCD Gel Primes/i, 'BT'); tcd(/^TCD CA TTC/i, 'BU', 1000);
    for (const n of wb.SheetNames.filter(s => /^Secteurs/i.test(s))) {
      for (const r of rows(XLSX, wb.Sheets[n])) for (let i = 0; i + 6 < r.length; i += 8) { const c = code(r[i]); if (c && num(r[i + 6]) != null) put(c, 'BV', num(r[i + 6])); }
    }
    for (const c in out) { const o = out[c]; for (const k of ['BR', 'BS', 'BT', 'BU']) if (o[k] == null) o[k] = 0; o.BW = -(o.BS || 0); }
    return { out };
  }

  // Confidence dashboard → par magasin et par liste : contactés / total clients
  const LISTES = { 'Rappel Devis Optique': 'Rappel Devis Optique', 'Rappel Devis Audition': 'Rappel Devis Audition', 'Rappel optique 1 an': 'Rappel Optique N+1',
    'Cross-selling optique-lentilles 30 jours': 'Cross-selling optique-lentilles 30 jours', 'Cross-selling optique-audition 30 jours': 'Cross-selling optique-audition 30 jours',
    'Rappel audio 30 jours': 'Rappel audio 30 jours', 'Renouvellement audio 4 ans': 'Rappel Audio N+4', 'Points FID bientôt Expirés': 'Euro Fid, Périmés',
    'Rappel Optique/Solaire 2 ans': 'Rappel Optique N+2', 'Lentilles de Contact M+11': 'Rappel Lentille M+11', 'Lentilles de Contact M+5': 'Rappel Lentille M+5' };
  // selection : liste des noms de listes (tels que dans l'export) à compter dans le Global ; null = toutes
  function confidence(XLSX, wb, selection) {
    const R = rows(XLSX, wb.Sheets[wb.SheetNames[0]]); const h = headerRow(R, v => v === 'LISTE'); const H = R[h].map(norm);
    const ci = H.indexOf('CODEMAGASIN'), li = H.indexOf('LISTE'), tot = H.indexOf('TOTALCLIENTS'), ct = H.indexOf('CONTACTES');
    const out = {}; const listes = {};
    for (const r of R.slice(h + 1)) {
      const c = code(r[ci]); if (!c) continue;
      const brut = String(r[li] == null ? '' : r[li]).trim(); if (!brut) continue;
      listes[brut] = (listes[brut] || 0) + 1;
      const l = LISTES[brut] || brut;
      const o = out[c] = out[c] || {};
      const k = o[l] = o[l] || { contactes: 0, total: 0, brut };
      k.contactes += num(r[ct]) || 0; k.total += num(r[tot]) || 0;
    }
    const sel = selection ? new Set(selection) : null;
    for (const c in out) { const g = { contactes: 0, total: 0 }; for (const l in out[c]) { const x = out[c][l]; if (!sel || sel.has(x.brut)) { g.contactes += x.contactes; g.total += x.total; } } out[c].Global = g; }
    return { out, listes: Object.keys(listes).sort(), inconnues: Object.keys(listes).filter(l => !LISTES[l]) };
  }

  // External Relations → nombre de visites effectuées par magasin (prescripteurs par spécialité, entreprises CE)
  function visites(XLSX, wb) {
    const R = rows(XLSX, wb.Sheets[wb.SheetNames[0]]); const H = R[0].map(norm);
    const ci = H.indexOf('CODESITE'), vi = H.indexOf('VISITEEFFECTUEE'), si = H.indexOf('SPECIALITE');
    const type = si >= 0 ? 'prescripteur' : 'entreprise';
    const SPEC = { 'ORL': 'DV', 'Orthoptiste': 'DW', 'Ophtalmologie': 'DX', 'Médecin généraliste': 'DY' };
    const out = {};
    for (const r of R.slice(1)) {
      const c = code(r[ci]); if (!c || String(r[vi]).trim() !== 'Oui') continue;
      const o = out[c] = out[c] || {};
      if (type === 'entreprise') o.DZ = (o.DZ || 0) + 1;
      else { const k = SPEC[String(r[si]).trim()]; if (k) o[k] = (o[k] || 0) + 1; }
    }
    return { out, type };
  }

  // Liste des avoirs Cosium (CSV « Factures », type Avoir) → total TTC depuis janvier par centre, jusqu'à la date de fin du mois traité
  function avoirs(text, finPeriode /* 'AAAA-MM-JJ' */) {
    const lines = text.replace(/^﻿/, '').split(/\r?\n/).map(l => l.split(';').map(c => c.replace(/^"|"$/g, '').trim()));
    const h = lines.findIndex(r => r.includes('Type') && r.includes('Centre'));
    const H = lines[h]; const ti = H.indexOf('Type'), di = H.indexOf('Date'), mi = H.indexOf('Montant TTC'), ci = H.indexOf('Centre');
    const out = {}; let ignores = 0;
    for (const r of lines.slice(h + 1)) {
      if (r.length < H.length || r[ti] !== 'Avoir') continue;
      const [j, m, a] = r[di].split('/'); const iso = `${a}-${m}-${j}`;
      if (finPeriode && iso > finPeriode) { ignores++; continue; }
      const c = code(r[ci]); if (!c) continue;
      out[c] = out[c] || { S: 0 }; out[c].S += num(r[mi]) || 0;
    }
    return { out, ignores };
  }

  // Reportings trimestriels (T20_T21 France, T10 International, onglet CONSODETAIL) : une colonne « montant » (k€) + une colonne « % du CA » par magasin.
  // Les lignes sont repérées par leur libellé en colonne A, les magasins par la ligne des codes.
  const RENTA = [ // [libellé (début), colonne %, colonne montant]
    [/^chiffre d'affaires ht/i, null, 'CP'], [/^marge brute/i, 'CS', 'CT'], [/^loyers charg/i, 'CU', 'CV'], [/^publicit/i, 'CW', 'CX'],
    [/^personnel/i, 'CY', 'CZ'], [/^r.sultat d'exploitation . fin/i, 'CQ', 'CR'] ];
  function rentabilites(XLSX, wb) {
    const R = rows(XLSX, wb.Sheets[wb.SheetNames.find(s => /CONSODETAIL/i.test(s)) || wb.SheetNames[0]]);
    const ci = R.findIndex(r => r && r.filter(v => /^\d{6}$/.test(String(v == null ? '' : v).trim())).length >= 3);
    const periode = String((R[0] || [])[0] || '').trim();      // « FIN 2026-06 »
    const lignes = {}; R.forEach((r, i) => { const l = String((r || [])[0] || '').trim(); RENTA.forEach(([re], k) => { if (re.test(l) && lignes[k] == null) lignes[k] = i; }); });
    const out = {};
    (R[ci] || []).forEach((v, j) => {
      const c = code(v); if (!c) return;
      const o = {};
      RENTA.forEach(([, pc, mc], k) => { const r = R[lignes[k]]; if (!r) return; const m = num(r[j]), p = num(r[j + 1]);
        if (mc) o[mc] = m == null ? null : m * 1000; if (pc) o[pc] = p == null ? null : p * 100; });
      if (o.CP || o.CR) out[c] = o;
    });
    return { out, periode, manquantes: RENTA.filter((x, k) => lignes[k] == null).map(x => String(x[0])) };
  }

  // Fichier « AVIS SUR GOOGLE » (onglets OPTICIEN / AUDITION : External ID, GMB rating, GMB total review), reçu de façon irrégulière.
  // Date du fichier lue dans son nom (JJMMAAAA). Règle : optique = Worker si disponible, sinon fichier le plus récent ; audio = fichier le plus récent.
  // Mr Qualité (export TCD visites mystères) : une ligne par magasin, seule la colonne « Score global » (sur 100) est retenue
  function mrQualite(XLSX, wb) {
    const R = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null, raw: true });
    const h = (R[0] || []).map(v => String(v || '').trim());
    const ci = h.findIndex(v => /^score global$/i.test(v));
    const out = {}; if (ci < 0) return { out };
    for (const r of R.slice(1)) {
      const c = code(r[0]); const v = typeof r[ci] === 'number' ? r[ci] : num(r[ci]);
      if (c && v != null) out[c] = { CK: v };
    }
    return { out };
  }
  // % Recommande verres (08/11/2026) : tableau « Taux de recommande <mois> à <mois> AAAA » envoyé par mail (fichier Taux_Succ_….xlsx).
  // Colonnes lues par leur nom : Code Site, Verres recommandés, Verres vendu, Taux de recommande. Taux = recommandés / (recommandés + vendus).
  // Période lue dans le titre (ex. « Mai à Octobre 2026 ») ; le taux est stocké en % dans AL (colonne de l'ancien Numbers).
  const MOIS_FR = ['janvier','fevrier','mars','avril','mai','juin','juillet','aout','septembre','octobre','novembre','decembre'];
  function recommande(XLSX, wb) {
    const R = rows(XLSX, wb.Sheets[wb.SheetNames[0]]);
    const sans = s => String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
    let periode = null, titre = '';
    for (const r of R.slice(0, 6)) for (const v of r || []) {
      const m = sans(v).match(/taux de recommande\s+(\w+)\s+(?:a|au)\s+(\w+)\s+(\d{4})/);
      if (m) { titre = String(v).trim(); const d = MOIS_FR.indexOf(m[1]), f = MOIS_FR.indexOf(m[2]), a = +m[3];
        if (d >= 0 && f >= 0) { const ad = f < d ? a - 1 : a; periode = { du: `${ad}-${String(d + 1).padStart(2, '0')}-01`, au: `${a}-${String(f + 1).padStart(2, '0')}-${String(new Date(a, f + 1, 0).getDate()).padStart(2, '0')}` }; } }
    }
    const hi = R.findIndex(r => (r || []).some(v => sans(v) === 'code site'));
    const out = {}; if (hi < 0) return { out, periode, titre };
    const H = R[hi].map(sans), col = re => H.findIndex(v => re.test(v));
    const ci = col(/^code site$/), cr = col(/^verres recommandes?$/), cv = col(/^verres vendus?$/), ct = col(/^taux de recommande/);
    for (const r of R.slice(hi + 1)) {
      const c = code(r[ci]); if (!c) continue;
      const rec = num(r[cr]), ven = num(r[cv]);
      let taux = rec != null && ven != null && rec + ven > 0 ? rec / (rec + ven) : num(r[ct]);
      if (taux == null) continue;
      out[c] = { AL: Math.round(taux * 100000) / 1000 };
    }
    return { out, periode, titre };
  }
  function avisGoogle(XLSX, wb, nomFichier) {
    const m = String(nomFichier || '').match(/(\d{2})(\d{2})(\d{4})/);
    const date = m ? `${m[3]}-${m[2]}-${m[1]}` : null;
    const out = {};
    const lire = (re, cr, cn) => {
      const n = wb.SheetNames.find(s => re.test(s)); if (!n) return 0;
      const R = rows(XLSX, wb.Sheets[n]); const H = R[0].map(norm);
      const ci = H.indexOf('EXTERNALID'), ri = H.indexOf('GMBRATING'), ni = H.indexOf('GMBTOTALREVIEW'); let k = 0;
      for (const r of R.slice(1)) { const c = code(r[ci]); if (!c) continue; const o = out[c] = out[c] || {}; o[cr] = num(r[ri]); o[cn] = num(r[ni]); k++; }
      return k;
    };
    const nOpt = lire(/OPTIC/i, 'BK', 'BL'), nAud = lire(/AUDI/i, 'BN', 'BO');
    return { out, date, nOpt, nAud };
  }
  // Combine : fichiers (le plus récent par magasin) puis Worker pour l'optique { code: {rating, reviewsCount} }
  function fusionAvis(fichiers /* [{out,date}] */, worker /* {ratings, date} | null */) {
    const res = {}, src = {};
    for (const f of [...fichiers].sort((a, b) => String(a.date).localeCompare(String(b.date))))
      for (const c in f.out) { res[c] = { ...(res[c] || {}), ...f.out[c] }; src[c] = { optique: 'fichier ' + f.date, audio: 'fichier ' + f.date }; }
    if (worker && worker.ratings) for (const c in worker.ratings) {
      const g = worker.ratings[c]; if (!g || !g.rating) continue;
      res[c] = { ...(res[c] || {}), BK: g.rating, BL: g.reviewsCount }; (src[c] = src[c] || {}).optique = 'Worker';
    }
    for (const c in res) { const o = res[c]; o.BJ = o.BK != null && o.BL != null ? o.BK * o.BL : null; o.BM = o.BN != null && o.BO != null ? o.BN * o.BO : null; }
    return { avis: res, sources: src };
  }

  const api = { marges, rentaSal, restesDus, confidence, visites, avoirs, rentabilites, mrQualite, recommande, avisGoogle, fusionAvis, LISTES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Sources = api;
})(typeof self !== 'undefined' ? self : this);
