/* Tableau central : une ligne par magasin du référentiel, indicateurs calculés à partir des exports lus. */
(function (root) {
  'use strict';
  const CUMUL_PAYS = ['CANADA'];

  // parsed: { SERVEUR: { report: parsedFile } } ; spec : hub_spec_cosium.json ; ref : [{code, serveur, pays, ...}]
  function build(parsed, spec, ref, opts = {}) {
    const overrides = opts.overrides || {};
    // index rows by code, Canada : code+'A' cumulé dans code
    const idx = {};
    for (const srv in parsed) for (const rep in parsed[srv]) {
      const p = parsed[srv][rep]; const m = {};
      for (const r of p.rows) m[r.code] = r;
      (idx[srv] = idx[srv] || {})[rep] = m;
    }
    // valeurs d'un indicateur pour un code Cosium donné
    function valueFor(srv, s, c) {
      let terms = s.terms.filter(t => t.server === srv && !t.skip);
      if (overrides[s.col]) terms = overrides[s.col](srv, terms);
      if (!terms.length) return null;
      let val = 0, found = false, fileThere = false;
      for (const t of terms) {
        const m = idx[srv] && idx[srv][t.report];
        if (!m) continue;
        fileThere = true;
        const r = m[c]; if (r && r[t.name] != null) { val += r[t.name]; found = true; }
      }
      return found ? val : (fileThere ? 0 : null);
    }
    const out = [];
    for (const mag of ref) {
      const code = String(mag.code), srv = mag.serveur;
      const row = { code, magasin: mag.magasin, pays: mag.pays, serveur: srv };
      const codes = CUMUL_PAYS.includes(mag.pays) ? [code, code + 'A'] : [code];
      const parts = codes.map(c => { const o = {}; for (const s of spec) o[s.col] = valueFor(srv, s, c); return o; });
      for (const s of spec) row[s.col] = combine(s.col, parts);
      const z = (opts.zeroIfMissing || {})[srv] || [];
      for (const c of z) if (row[c] == null) row[c] = 0;
      calc(row);
      out.push(row);
    }
    return out;
  }

  // Cumul de plusieurs codes (Canada) : montants additionnés, ratios pondérés par leur base.
  const WEIGHT = { V: 'U', W: 'U', AC: 'U', AD: 'U', AE: 'U', AF: 'U', AG: 'U', AN: 'U', AP: 'U', AR: 'U',
                   AY: 'AW', BB: 'AW', BH: 'AW', AZ: 'AX', BA: 'AX', BD: 'AX', BF: 'AX', BC: 'Q', BE: 'U' };
  function combine(col, parts) {
    if (parts.length === 1) return parts[0][col];
    const vals = parts.map(p => p[col]);
    if (vals.every(v => v == null)) return null;
    const w = WEIGHT[col];
    if (!w) return vals.reduce((a, v) => a + (v || 0), 0);
    let num = 0, den = 0;
    parts.forEach(p => { const b = p[w] || 0, v = p[col] || 0; if (b) { num += v * b; den += b; } });
    if (den) return num / den;
    const nz = vals.filter(v => v); return nz.length ? nz[0] : 0;
  }

  // Colonnes calculées (reprises des formules de l'onglet Données)
  const n = v => (v == null || v === '' || !isFinite(v)) ? null : v;
  const div = (a, b) => (a == null || b == null || b === 0) ? null : a / b;
  function calc(r) {
    r.X = n(div(100 * r.Y, r.AB));                 // % AR HG
    r.Z = n(div(100 * r.AA, r.AB));                // % TRANSITION
    r.AT = n(div(r.AO * 100, r.AN)) ?? 0;          // NBR DE TOTAL DE MONTURES
    r.AQ = r.AT != null && r.AP != null ? r.AT * r.AP / 100 : 0;   // NBR DE LUKKAS
    r.AS = r.AR != null && r.AT != null ? r.AR * r.AT / 100 : null; // NBR D'INTEMPORELLE
    r.BG = r.BC != null && r.Q != null ? r.BC * r.Q / 100 : null;   // CA VENTES ADD AUDIO
    r.EH = r.U != null && r.V != null ? r.U * r.V : null;           // CA Dossier lunettes
    r.EI = r.AW != null && r.AY != null ? r.AW * r.AY : null;       // CA vente audio
    r.EJ = r.AX != null && r.AZ != null ? r.AX * r.AZ : null;       // CA Prothèses
    r.EK = n(div(r.AW * 100, r.BB));                                // NB de devis audio
    r.EL = r.AX != null && r.BA != null ? r.AX * r.BA / 100 : null; // NB GARANTIE TRIO
    r.EM = r.AX != null && r.BD != null ? r.AX * r.BD / 100 : null; // NB Ouiezen Premium
    r.EN = r.U != null && r.BE != null ? r.U * r.BE / 100 : null;   // NB Dépistages Audio
    r.EO = r.W != null && r.U != null ? r.W * r.U : null;           // CA Monture Paire 1
    r.EP = r.U != null && r.AC != null ? r.U * r.AC / 100 : null;   // NB GARANTIE OPTIQUE
    r.EQ = r.U != null && r.AD != null ? r.U * r.AD / 100 : null;   // NB PACK CONFORT
    r.ER = r.U != null && r.AG != null ? r.U * r.AG / 100 : null;   // NB OFFRE PLAISIR
    r.ES = r.EQ != null && r.AE != null ? r.EQ * r.AE : null;       // Somme pack confort
    r.ET = n(div(r.U * 100, r.AF));                                 // NB de Devis Optique
  }

  const api = { build, calc };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Hub = api;
})(typeof self !== 'undefined' ? self : this);
