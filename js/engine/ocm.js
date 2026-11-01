/* OCM (Optical Center Mobile) : copier-coller de la page Intranet des interventions.
 * Une ligne = une intervention datée. Le mois vient de la date de chaque ligne : un collage peut couvrir plusieurs mois.
 * Comptage par site de rattachement : ventes, livraisons, dépistages, réglages, annulations (N.O.T = « A »). */
(function (root) {
  'use strict';
  const MOIS = ['janvier','fevrier','mars','avril','mai','juin','juillet','aout','septembre','octobre','novembre','decembre'];
  const sans = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
  const norm = s => sans(s).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const TYPES = { 'deplacement du camion vente': 'DF', 'deplacement du camion livraison': 'DC', 'deplacement du camion depistage': 'DD',
                  'deplacement du camion reglages': 'DE', 'deplacement du camion demarchage': 'demarchage', 'deplacement du camion facturation': 'facturation' };
  function parse(text) {
    const lines = text.replace(/\r/g, '').split('\n').map(l => l.split('\t').map(x => x.trim()));
    const h = lines.findIndex(r => r.some(c => /^Site de rattachement$/i.test(c)));
    const mois = {}; const typesInconnus = new Set(); let n = 0;
    for (const c of lines.slice(h + 1)) {
      if (c.length < 9) continue;
      const d = (c[4] || '').match(/^(\d{1,2})\s+(\p{L}+)\s+(\d{4})$/u); if (!d) continue;
      const mi = MOIS.indexOf(sans(d[2]).toLowerCase()); if (mi < 0) continue;
      const k = `${d[3]}-${String(mi + 1).padStart(2, '0')}`;
      const site = c[7]; const not = c[6]; const t = sans(c[5]).toLowerCase();
      const col = not.toUpperCase() === 'A' ? 'DB' : TYPES[t];
      if (!col) { typesInconnus.add(c[5]); continue; }
      const m = mois[k] = mois[k] || {}; const s = m[site] = m[site] || {};
      s[col] = (s[col] || 0) + 1; n++;
    }
    return { mois, lignes: n, typesInconnus: [...typesInconnus] };
  }
  // sites (« OC MOBILE NANTES ») → codes du référentiel par le nom du magasin
  function match(parsed, ref) {
    const by = {}; for (const r of ref) by[norm(r.magasin)] = r;
    const out = {}, inconnus = new Set();
    for (const k in parsed.mois) {
      out[k] = {};
      for (const site in parsed.mois[k]) { const r = by[norm(site)]; if (!r) { inconnus.add(site); continue; } out[k][String(r.code)] = parsed.mois[k][site]; }
    }
    return { out, inconnus: [...inconnus] };
  }
  // cumul depuis janvier jusqu'au mois donné
  // reprise (optionnelle) : { jusquAuMois: 9, data: {code: {DB,DC,…}} } = cumul repris de l'ancien fichier
  function cumul(moisStockes, annee, mois, reprise) {
    const out = {}, manquants = [];
    let debut = 1;
    if (reprise && reprise.jusquAuMois <= mois) {
      for (const code in reprise.data) out[code] = { ...reprise.data[code] };
      debut = reprise.jusquAuMois + 1;
    }
    for (let m = debut; m <= mois; m++) {
      const k = `${annee}-${String(m).padStart(2, '0')}`; const d = moisStockes[k];
      if (!d) { manquants.push(k); continue; }
      for (const code in d) { const o = out[code] = out[code] || {}; for (const c in d[code]) o[c] = (o[c] || 0) + d[code][c]; }
    }
    return { out, manquants };
  }
  const api = { parse, match, cumul };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.OCM = api;
})(typeof self !== 'undefined' ? self : this);
