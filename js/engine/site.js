/* Site internet : copier-coller des deux tableaux du mail de fin de mois (« CA CUMULE MENSUEL » et « CA OPTIQUE »).
 * Les en-têtes peuvent être coupés sur plusieurs lignes : on ne lit que les lignes de données (Site …, Total des Sites, OC.fr …). */
(function (root) {
  'use strict';
  const num = s => { if (s == null) return null; const t = String(s).replace(/[^\d.,+\-]/g, '').replace(',', '.'); if (t === '' || t === '+' || t === '-') return null; const n = parseFloat(t); return isFinite(n) ? n : null; };
  const CHAMPS = ['caN1', 'caN', 'extrapolation', 'evolution', 'caMV', 'nbMV', 'panierMV', 'caSV', 'nbSV', 'panierSV', 'caMS', 'nbMS', 'panierMS', 'caJour'];
  function parse(text) {
    const out = { mois: null, sites: {}, ocfr: null };
    for (const l of text.replace(/\r/g, '').split('\n')) {
      const c = l.split('\t').map(x => x.trim());
      let m;
      if ((m = c[0].match(/^OC\.fr\s+(\d{2})\/(\d{4})$/i))) {
        out.mois = `${m[2]}-${m[1]}`;
        out.ocfr = { panierMV: num(c[1]), nbLV: num(c[2]), panierSansVerres: num(c[3]), nbSansVerres: num(c[4]), nbLVcumul: num(c[5]) };
      } else if ((m = c[0].match(/^(Site\s+(.+)|Total des Sites)$/i))) {
        const k = m[2] ? m[2].trim() : 'Total';
        const o = {}; CHAMPS.forEach((f, i) => { o[f] = num(c[i + 1]); });
        if (o.evolution != null) o.evolution /= 100;
        out.sites[k] = o;
      } else if (!out.mois && (m = l.match(/(\d{2})\/(\d{4})\s*$/))) {
        // en-tête « CA site cumule 10/2026 » : sert si le tableau OC.fr n'a pas été collé
        if (+m[2] >= 2020) out.moisEnTete = `${m[2]}-${m[1]}`;
      }
    }
    if (!out.mois) out.mois = out.moisEnTete || null;
    return out;
  }
  // Cumul annuel : somme des mois (CA N, CA N-1, nb équipements optique = NB lunettes de vue cumulé du mois), panier = Σ(nb × panier) / Σ nb
  function cumul(moisStockes, annee, mois) {
    const sites = {}; let nb = 0, ca = 0; const manquants = [];
    for (let m = 1; m <= mois; m++) {
      const d = moisStockes[`${annee}-${String(m).padStart(2, '0')}`];
      if (!d) { manquants.push(m); continue; }
      for (const s in d.sites) { const o = sites[s] = sites[s] || { caN: 0, caN1: 0 }; o.caN += d.sites[s].caN || 0; o.caN1 += d.sites[s].caN1 || 0; }
      if (d.ocfr) { nb += d.ocfr.nbLVcumul || 0; ca += (d.ocfr.nbLVcumul || 0) * (d.ocfr.panierMV || 0); }
    }
    for (const s in sites) sites[s].evolution = sites[s].caN1 ? sites[s].caN / sites[s].caN1 - 1 : null;
    return { sites, nbEquipements: nb, panierMoyen: nb ? ca / nb : null, manquants };
  }
  const api = { parse, cumul };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Site = api;
})(typeof self !== 'undefined' ? self : this);
