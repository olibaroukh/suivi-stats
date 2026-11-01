/* Lyleoo : lecture du copier-coller de la page « Mois / Profil / Dossiers… ».
 * Garde les lignes magasin (« OPTICAL CENTER … »), ignore les lignes opticien (M. / Mme.) et le total. */
(function (root) {
  'use strict';
  const MOIS = ['janvier','fevrier','mars','avril','mai','juin','juillet','aout','septembre','octobre','novembre','decembre'];
  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  function nomMagasin(s) { return s.replace(/^OPTICAL CENTER\s*-?\s*/i, '').trim(); }
  // Un copier-coller peut contenir un ou plusieurs mois : renvoie la liste des mois lus.
  function parseAll(text) {
    const lines = text.replace(/\r/g, '').split('\n');
    const mois = []; let cur = null;
    for (const l of lines) {
      const c = l.split('\t').map(x => x.trim());
      const m = (c[0] || '').match(/^(\p{L}+)\s+(\d{4})$/u);
      if (m) {
        const i = MOIS.indexOf(m[1].normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase());
        if (i >= 0) { cur = { periode: { annee: +m[2], mois: i + 1 }, magasins: [], total: null }; mois.push(cur); }
        continue;
      }
      if (!cur) continue;
      if (/^Totaux/i.test(c[0])) { cur.total = c.slice(1).map(Number); continue; }
      if (!/^OPTICAL CENTER/i.test(c[0]) || c.length < 6) continue;
      const v = c.slice(1, 6).map(x => +x || 0);
      cur.magasins.push({ nom: nomMagasin(c[0]), crees: v[0], soumisClassiques: v[1], soumisExpress: v[2], valides: v[3], refuses: v[4] });
    }
    // contrôle : somme des magasins = ligne « Totaux du mois »
    for (const x of mois) {
      const s = x.magasins.reduce((a, m) => [a[0] + m.crees, a[1] + m.soumisClassiques, a[2] + m.soumisExpress], [0, 0, 0]);
      x.controle = x.total ? (s[0] === x.total[0] && s[1] === x.total[1] && s[2] === x.total[2]) : null;
    }
    return mois;
  }
  function parse(text) { const all = parseAll(text); return all[all.length - 1] || { periode: null, magasins: [], total: null }; }
  // Rapprochement avec le référentiel (colonne Nom Lyleoo, sinon nom du magasin)
  function match(parsed, ref) {
    const byLyl = {}, byNom = {};
    for (const r of ref) { if (r.lyleoo) byLyl[norm(r.lyleoo)] = r; byNom[norm(r.magasin)] = r; }
    const out = {}, inconnus = [], approx = [];
    for (const m of parsed.magasins) {
      const k = norm(m.nom);
      let r = byLyl[k] || byNom[k];
      if (!r && k.length >= 6) {
        // rapprochement approximatif : un seul magasin du référentiel dont le nom contient (ou est contenu dans) le libellé Lyleoo
        const cands = ref.filter(x => [x.lyleoo, x.magasin].some(n => n && (norm(n).includes(k) || k.includes(norm(n)) && norm(n).length >= 6)));
        if (cands.length === 1) { r = cands[0]; approx.push({ lyleoo: m.nom, code: String(r.code), magasin: r.magasin }); }
      }
      if (!r) { inconnus.push(m.nom); continue; }
      out[String(r.code)] = m;
    }
    return { out, inconnus, approx };
  }
  // Cumul depuis janvier : moisParAnnee = { '2026-01': {code: ligne}, ... } → { code: { soumis, express } } jusqu'au mois donné
  function cumul(moisStockes, annee, mois) {
    const out = {}, manquants = [];
    for (let m = 1; m <= mois; m++) {
      const k = `${annee}-${String(m).padStart(2, '0')}`, d = moisStockes[k];
      if (!d) { manquants.push(k); continue; }
      for (const code in d) {
        const o = out[code] = out[code] || { soumis: 0, express: 0 };
        o.soumis += d[code].soumisClassiques || 0; o.express += d[code].soumisExpress || 0;
      }
    }
    return { out, manquants };
  }
  const api = { parse, parseAll, match, cumul };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Lyleoo = api;
})(typeof self !== 'undefined' ? self : this);
