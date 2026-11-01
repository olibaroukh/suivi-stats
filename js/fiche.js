/* Fiche magasin : calcul des indicateurs affichés + rendu HTML A4 (langue locale ou français). */
(function (root) {
  'use strict';

  const LANGUES = { FRANCAIS: 'fr', HEBREU: 'he', ANGLAIS: 'en', ESPAGNOL: 'es', FLAMAND: 'nl', ALLEMAND: 'de' };
  const DEVISES = { 'Euro': '€', 'Shekel': '₪', 'Franc Suisse': 'CHF', 'Livre Sterling': '£', 'Dollars Canadien': '$CA', 'Dolard': '$' };
  const OBJ_REPORTING = { CS: 0.70, CU: 0.06, CW: 0.07, CY: 0.28, CQ: 0.20 };

  const nz = v => (v == null || v === '' || !isFinite(v)) ? null : +v;
  const div = (a, b) => (nz(a) == null || !nz(b)) ? null : a / b;

  // Objectifs : franchisé (colonne Groupe) sinon pays
  function objectifsPour(mag, objectifs) {
    const rows = (objectifs && objectifs.rows) || [];
    const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
    let o = null;
    if (mag.type === 'Franchise') o = rows.find(r => r.type === 'Franchisé' && norm(r.cle) === norm(mag.groupe));
    const p = rows.find(r => r.type === 'Pays' && norm(r.cle) === norm(mag.pays));
    return { ...(p || {}), ...(o || {}), _source: o ? 'franchisé' : (p ? 'pays' : 'aucun') };
  }

  // Tous les chiffres de la fiche
  function calculer(photo, mag, objectifs) {
    const d = (photo.magasins[String(mag.code)] || { N: {}, N1: {} });
    const n = d.N || {}, p = d.N1 || {}, m = photo.mois, o = objectifsPour(mag, objectifs);
    const obj = nz(n.O) != null ? n.O * 1000 : null, ca = nz(n.P);
    const pct = v => nz(v) == null ? null : v / 100;
    const perte = {
      pm1: (nz(n.W) != null && o.pm1 && n.W < o.pm1) ? (o.pm1 - n.W) * (n.U || 0) : 0,
      sop: (nz(n.AC) != null && o.sop && n.AC / 100 < o.sop) ? 39 * (n.U || 0) * (o.sop - n.AC / 100) : 0,
      pc: ((nz(n.AC) != null && o.sop && n.AC / 100 < o.sop) ? (o.pcEur - (n.AE || 0)) * (n.EQ || 0) : 0) + ((o.pcPct != null && nz(n.AD) != null) ? (o.pcPct - n.AD / 100) * (n.U || 0) * (o.pcEur || 0) : 0),
      tc: (nz(n.AF) != null && o.tc && n.AF / 100 < o.tc) ? (n.V || 0) * (n.ET || 0) * (o.tc - n.AF / 100) : 0,
      prot: (nz(n.AZ) != null && o.pmProthese && n.AZ < o.pmProthese && n.AZ > 0) ? (o.pmProthese - n.AZ) * (n.AX || 0) : 0,
      tcA: (nz(n.BB) != null && o.tcAudio && n.BB / 100 < o.tcAudio && n.BB > 0) ? (n.AY || 0) * (n.EK || 0) * (o.tcAudio - n.BB / 100) : 0,
    };
    Object.keys(perte).forEach(k => { perte[k] = Math.max(0, Math.ceil(perte[k] || 0)); });
    const potentiel = Object.values(perte).reduce((a, b) => a + b, 0);
    const caOpt = ca != null ? ca - (n.R || 0) - (n.Q || 0) : null, caOpt1 = nz(p.P) != null ? p.P - (p.R || 0) - (p.Q || 0) : null;
    const gm = (note, nb) => (nz(note) && note < 4.5) ? -nb * ((note - 4.5) * 2) : 0;
    return {
      o, mois: m,
      ca: { obj, ca, posit: (obj && ca != null) ? ca * 12 / m / obj : null, evol: div(ca, p.P) != null ? ca / p.P - 1 : null,
            manquant: (obj && ca != null) ? Math.max(0, Math.ceil(obj * m / 12 - ca)) : null,
            restant: (obj && ca != null && m < 12) ? Math.ceil((obj - ca) / (12 - m)) : null,
            potentiel, positPot: (obj && ca != null) ? (ca + potentiel) * 12 / m / obj : null },
      optique: { ca: caOpt, part: div(caOpt, ca), evol: div(caOpt, caOpt1) != null ? caOpt / caOpt1 - 1 : null,
                 panier: nz(n.V), panierEvol: nz(p.V) ? n.V - p.V : null, panierEvolPct: div(n.V, p.V) != null ? n.V / p.V - 1 : null,
                 ventes: nz(n.U), ventesEvol: nz(p.U) != null ? n.U - p.U : null, ventesEvolPct: div(n.U, p.U) != null ? n.U / p.U - 1 : null,
                 kpis: [
                   ['Pmoyen 1er Paire', o.pm1, nz(n.W), 'eur', perte.pm1],
                   ['Unif Individualisés', o.unifIndiv, div(n.AI, n.AH), 'pct'],
                   ['Anti Reflet HG', o.arHG, pct(n.X), 'pct'],
                   ['Transition', o.transition, pct(n.Z), 'pct'],
                   ['% SOP', o.sop, pct(n.AC), 'pct', perte.sop],
                   ['% Pack Confort', o.pcPct, pct(n.AD), 'pct', perte.pc],
                   ['€ Pack Confort', o.pcEur, nz(n.AE), 'eur'],
                   ['Taux de Concrétisation', o.tc, pct(n.AF), 'pct', perte.tc],
                   ['Evol de Fréquentation', null, div(n.ET, p.ET) != null ? n.ET / p.ET - 1 : null, 'evol'],
                   ['Nd de Lyleoo', o.lyleoo != null ? o.lyleoo * m : null, (n.BY != null || n.BZ != null) ? (n.BY || 0) + (n.BZ || 0) : null, 'nb'],
                 ] },
      contacto: { ca: nz(n.R), part: div(n.R, ca), evol: div(n.R, p.R) != null ? n.R / p.R - 1 : null },
      audio: { ca: nz(n.Q), part: div(n.Q, ca), evol: div(n.Q, p.Q) != null ? n.Q / p.Q - 1 : null,
               panier: nz(n.AY), panierEvol: nz(p.AY) ? n.AY - p.AY : null, panierEvolPct: div(n.AY, p.AY) != null ? n.AY / p.AY - 1 : null,
               ventes: nz(n.AW), ventesEvol: nz(p.AW) != null ? n.AW - p.AW : null, ventesEvolPct: div(n.AW, p.AW) != null ? n.AW / p.AW - 1 : null,
               kpis: [
                 ['P moyen Prothèse', o.pmProthese, nz(n.AZ), 'eur', perte.prot],
                 ['% Garantie', o.garantieAudio, pct(n.BA), 'pct'],
                 ['% Ventes  Add', o.ventesAdd, pct(n.BC), 'pct'],
                 ['% TC audio', o.tcAudio, pct(n.BB), 'pct', perte.tcA],
                 ['Durée moyen d’essai', o.dureeEssai, nz(n.BH), 'jours'],
                 ['% de Dépistage', o.depistage, pct(n.BE), 'pct'],
               ].concat(mag.pays === 'ISRAEL' ? [['Perfect Clean', n.AW != null ? Math.round(n.AW / 2) : null, nz(n.EV), 'nb']] : []) },
      google: { opt: { nb: nz(n.BL), note: n.BL ? nz(n.BK) : null, manquants: gm(n.BK, n.BL) }, aud: { nb: nz(n.BO), note: n.BO ? nz(n.BN) : null, manquants: gm(n.BN, n.BO) }, source: n._avisSource },
      visites: { orlGen: (n.DV || 0) + (n.DY || 0), ophtaOrtho: (n.DX || 0) + (n.DW || 0), ce: nz(n.DZ), objCe: nz(n.EA) },
      mrq: nz(n.CK),
      renta: { mdc: pct(n.AN), lukkas: pct(n.AP), ouiezen: pct(n.BD), panierA: pct(n.AU), recommande: pct(n.AL),
               seuil: (o.tc && o.panier && nz(n.V) != null && nz(n.AF) != null) ? Math.ceil(n.V) * (n.AF / 100) / (o.tc * o.panier) : null,
               avoirs: nz(n.S), recup: pct(n.BQ), indus: nz(n.BV) },
      marges: { verres: div(n.CB, n.CA), montures: div(n.CF, n.CE), contacto: div(n.CD, n.CC), audio: div(n.CH, n.CG), globale: nz(n.CI) },
      confidence: [['Rappel Devis Optique', n.DI, n.DJ], ['Rappel Optique N+1', n.DK, n.DL], ['Rappel Audio N+4', n.DM, n.DN], ['Global', n.DO, n.DP]],
      reporting: { ca: nz(n.CP), lignes: [['Marge brute', 'CS'], ['Loyers chargés', 'CU'], ['Publicité', 'CW'], ['Personnel', 'CY'], ['Résultat d’exploitation', 'CQ']].map(([l, k]) => [l, nz(n[k]) != null ? n[k] / 100 : null, OBJ_REPORTING[k], k]) },
      rentaSal: pct(n.CM),
    };
  }

  // Traduction : libellés de l'onglet Traduction (base française → langue)
  function traducteur(trad, lang) {
    const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9%€]/g, '');
    const idx = {}; (trad.libelles || []).forEach(l => { idx[norm(l.base)] = l; });
    const t = s => { if (lang === 'fr') return s; const l = idx[norm(s)]; return (l && l[lang]) || s; };
    t.mois = i => { const l = (trad.mois || [])[i - 1]; return (l && (lang === 'fr' ? l.fr || l.base : l[lang] || l.fr || l.base)) || ''; };
    return t;
  }

  function rendre(photo, mag, objectifs, trad, opts = {}) {
    const lang = opts.langue || LANGUES[mag.langue] || 'fr';
    const t = traducteur(trad, lang);
    const dev = DEVISES[mag.devise] || '€';
    const c = calculer(photo, mag, objectifs);
    const loc = lang === 'he' ? 'he-IL' : lang === 'en' ? 'en-GB' : lang === 'es' ? 'es-ES' : 'fr-FR';
    const nb = (v, d = 0) => v == null ? '–' : Number(v).toLocaleString(loc, { maximumFractionDigits: d, minimumFractionDigits: d });
    const eur = v => v == null ? '–' : nb(Math.round(v)) + ' ' + dev;
    const pc = (v, d = 1) => v == null ? '–' : nb(v * 100, d) + ' %';
    const sg = (v, f) => v == null ? '' : (v > 0 ? '+' : '') + f(v);
    const cls = v => v == null ? '' : v >= 0 ? 'ok' : 'ko';
    const fmt = (v, u) => u === 'pct' || u === 'evol' ? pc(v) : u === 'eur' ? eur(v) : u === 'jours' ? nb(v, 1) : nb(v);
    const repris = Object.entries(photo.sources || {}).filter(([, s]) => s.statut === 'repris').map(([k]) => k);
    const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

    const kpiRows = list => list.map(([lib, ob, re, u, perte]) => {
      const atteint = (ob == null || re == null) ? null : (re >= ob);
      return `<tr><th>${esc(t(lib))}</th><td class="obj">${ob == null ? '' : fmt(ob, u === 'evol' ? 'pct' : u)}</td>`
        + `<td class="val ${atteint == null ? (u === 'evol' ? cls(re) : '') : atteint ? 'ok' : 'ko'}">${u === 'evol' ? sg(re, pc) : fmt(re, u)}</td>`
        + `<td class="perte">${perte ? eur(perte) : ''}</td></tr>`;
    }).join('');
    const evol = (d, dp, f) => `<div class="evol ${cls(d)}">${d == null ? '' : sg(d, f)}${dp == null ? '' : ` <span>${sg(dp, pc)}</span>`}</div>`;

    const vide = arr => arr.every(v => v == null);
    const nd = '<div class="nd">Non disponible pour ce magasin</div>';
    return `
<div class="fiche" dir="${lang === 'he' ? 'rtl' : 'ltr'}" lang="${lang}">
  <header class="f-head">
    <div class="f-titre">
      <div class="f-sur">${esc(t('Statistiques A Fin'))} ${esc(t.mois(c.mois))} ${photo.annee}</div>
      <h1>${esc(mag.magasin)}</h1>
      <div class="f-meta">${esc(t('Manager'))} : <b>${esc(mag.manager || '–')}</b> · ${esc(t('Date d’Ouverture'))} : ${esc(mag.ouverture || '–')} · Code ${esc(mag.code)}${mag.type === 'Franchise' ? ' · ' + esc(mag.groupe) : ''}</div>
    </div>
    <div class="f-logo">OPTICAL CENTER</div>
  </header>

  <section class="f-row r1">
    <div class="bloc ca">
      <h2>${esc(t('CA'))}</h2>
      <div class="ligne"><span>${esc(t('OBJECTIF:'))}</span><b>${eur(c.ca.obj)}</b></div>
      <div class="ligne"><span>${esc(t('CA GÉNÉRÉ:'))}</span><b>${eur(c.ca.ca)}</b></div>
      <div class="gros ${c.ca.posit == null ? '' : c.ca.posit >= 1 ? 'ok' : 'ko'}">${pc(c.ca.posit)}</div>
      <div class="evol ${cls(c.ca.evol)} centre">${c.ca.evol == null ? '' : 'N-1 ' + sg(c.ca.evol, pc)}</div>
      <div class="ligne"><span>${esc(t('CA MANQUANT'))}</span><b class="${c.ca.manquant ? 'ko' : 'ok'}">${eur(c.ca.manquant)}</b></div>
      <div class="ligne"><span>${esc(t('Restant par mois'))}</span><b>${eur(c.ca.restant)}</b></div>
      <div class="ligne"><span>${esc(t('Potentiel CA'))}</span><b>${eur(c.ca.potentiel)}</b></div>
      <div class="ligne"><span>${esc(t('Positionnement potentiel'))}</span><b>${pc(c.ca.positPot)}</b></div>
    </div>
    <div class="bloc optique">
      <div class="entete">
        <div class="part"><div class="pct">${pc(c.optique.part, 0)}</div><h2>${esc(t('OPTIQUE'))}</h2><div class="mt">${eur(c.optique.ca)}</div>${evol(c.optique.evol == null ? null : c.optique.evol, null, pc)}</div>
        <div class="kv"><span>${esc(t('Panier Moyen'))}</span><b>${eur(c.optique.panier)}</b>${evol(c.optique.panierEvol, c.optique.panierEvolPct, eur)}</div>
        <div class="kv"><span>${esc(t('Nb de Ventes'))}</span><b>${nb(c.optique.ventes)}</b>${evol(c.optique.ventesEvol, c.optique.ventesEvolPct, v => nb(v))}</div>
        <div class="part petit"><div class="pct">${pc(c.contacto.part, 0)}</div><h2>${esc(t('CONTACTO'))}</h2><div class="mt">${eur(c.contacto.ca)}</div>${evol(c.contacto.evol, null, pc)}</div>
      </div>
      <table class="kpi"><thead><tr><th></th><th>${esc(t('Objectifs'))}</th><th>${esc(t('Statistiques'))}</th><th>${esc(t('Perte CA'))}</th></tr></thead><tbody>${kpiRows(c.optique.kpis)}</tbody></table>
    </div>
  </section>

  <section class="f-row r2">
    <div class="bloc audio">
      <div class="entete">
        <div class="part"><div class="pct">${pc(c.audio.part, 0)}</div><h2>${esc(t('AUDIO'))}</h2><div class="mt">${eur(c.audio.ca)}</div>${evol(c.audio.evol, null, pc)}</div>
        <div class="kv"><span>${esc(t('Panier Moyen'))}</span><b>${eur(c.audio.panier)}</b>${evol(c.audio.panierEvol, c.audio.panierEvolPct, eur)}</div>
        <div class="kv"><span>${esc(t('Nb de Ventes'))}</span><b>${nb(c.audio.ventes)}</b>${evol(c.audio.ventesEvol, c.audio.ventesEvolPct, v => nb(v))}</div>
      </div>
      <table class="kpi"><thead><tr><th></th><th>${esc(t('Objectifs'))}</th><th>${esc(t('Statistiques'))}</th><th>${esc(t('Perte CA'))}</th></tr></thead><tbody>${kpiRows(c.audio.kpis)}</tbody></table>
    </div>
  </section>

  <section class="f-row r3">
    <div class="bloc google">
      <h3>${esc(t('GOOGLE'))}</h3>
      <table><tr><th></th><th>${esc(t('Nombre d’avis'))}</th><th>${esc(t('Note'))}</th><th>${esc(t('Avis Manquants'))}</th></tr>
        <tr><th>${esc(t('OPTIQUE'))}</th><td>${nb(c.google.opt.nb)}</td><td class="${c.google.opt.note == null ? '' : c.google.opt.note >= 4.5 ? 'ok' : 'ko'}">${nb(c.google.opt.note, 1)}</td><td>${nb(c.google.opt.manquants, 0)}</td></tr>
        <tr><th>${esc(t('AUDIO'))}</th><td>${nb(c.google.aud.nb)}</td><td class="${c.google.aud.note == null ? '' : c.google.aud.note >= 4.5 ? 'ok' : 'ko'}">${nb(c.google.aud.note, 1)}</td><td>${nb(c.google.aud.manquants, 0)}</td></tr></table>
    </div>
    <div class="bloc visites">
      <h3>${esc(t('VISITES EXTERNES'))}</h3>
      <table><tr><th>ORL / GEN</th><th>OPHTA / ORTHO</th><th>CE</th></tr><tr><td>${nb(c.visites.orlGen)}</td><td>${nb(c.visites.ophtaOrtho)}</td><td>${nb(c.visites.ce)}</td></tr></table>
    </div>
    <div class="bloc mrq"><h3>${esc(t('Mr Qualité'))}</h3><div class="gros-s">${c.mrq == null ? '–' : nb(c.mrq)}</div></div>
  </section>

  <section class="f-row r4">
    <div class="bloc renta">
      <h3>${esc(t('RENTABILITÉ'))}</h3>
      <table><tr><th>${esc(t('%MdC'))}</th><th>${esc(t('% Lukkas'))}</th><th>${esc(t('% Ouiezen Premium'))}</th><th>${esc(t('% Recommande Verres'))}</th><th>${esc(t('Seuil de Performance'))}</th><th>${esc(t('Total des Avoirs'))}</th><th>${esc(t('Tx de Récupération'))}</th><th>${esc(t('Taux d’Indus'))}</th></tr>
      <tr><td class="${c.renta.mdc == null || !c.o.mdc ? '' : c.renta.mdc >= c.o.mdc ? 'ok' : 'ko'}">${pc(c.renta.mdc)}</td><td>${pc(c.renta.lukkas)}</td><td>${pc(c.renta.ouiezen)}</td><td>${pc(c.renta.recommande)}</td>
          <td class="${c.renta.seuil == null ? '' : c.renta.seuil >= 1 ? 'ok' : 'ko'}">${pc(c.renta.seuil)}</td><td>${eur(c.renta.avoirs)}</td><td>${pc(c.renta.recup)}</td><td class="${c.renta.indus == null ? '' : c.renta.indus <= 0.01 ? 'ok' : 'ko'}">${pc(c.renta.indus, 2)}</td></tr></table>
    </div>
  </section>

  <section class="f-row r5">
    <div class="bloc marges">
      <h3>${esc(t('Marges'))}</h3>
      ${vide(Object.values(c.marges)) ? nd : `<table><tr><th>${esc(t('Verres'))}</th><th>${esc(t('Montures'))}</th><th>${esc(t('Contacto'))}</th><th>${esc(t('Audio'))}</th><th>${esc(t('Globale'))}</th></tr>
      <tr><td>${pc(c.marges.verres)}</td><td>${pc(c.marges.montures)}</td><td>${pc(c.marges.contacto)}</td><td>${pc(c.marges.audio)}</td><td><b>${pc(c.marges.globale)}</b></td></tr></table>`}
    </div>
    <div class="bloc confidence">
      <h3>Confidence</h3>
      <table><tr>${c.confidence.map(([l]) => `<th>${esc(l)}</th>`).join('')}</tr>
      <tr>${c.confidence.map(([, ct, tot]) => `<td>${tot ? pc(ct / tot, 0) : '–'}<small>${tot ? nb(ct) + ' / ' + nb(tot) : ''}</small></td>`).join('')}</tr></table>
    </div>
  </section>

  <section class="f-row r6">
    <div class="bloc reporting">
      <h3>REPORTING <small>${esc((photo.sources.rentabilites && photo.sources.rentabilites.detail || '').split(' – ')[0])}</small></h3>
      ${c.reporting.ca == null ? nd : `<table><tr><th>${esc(t('CA'))} HT</th>${c.reporting.lignes.map(([l]) => `<th>${esc(l)}</th>`).join('')}</tr>
      <tr><td>${eur(c.reporting.ca)}</td>${c.reporting.lignes.map(([, v, ob, k]) => `<td class="${v == null ? '' : (k === 'CS' || k === 'CQ' ? v >= ob : v <= ob) ? 'ok' : 'ko'}">${pc(v)}<small>obj. ${pc(ob, 0)}</small></td>`).join('')}</tr></table>`}
    </div>
    <div class="bloc rentasal"><h3>${esc(t('Renta Salariale'))}</h3><div class="gros-s ${c.rentaSal == null ? '' : c.rentaSal <= (mag.pays === 'FRANCE' ? 0.28 : 0.35) ? 'ok' : 'ko'}">${pc(c.rentaSal)}</div></div>
  </section>

  <footer class="f-pied">
    <span>Généré le ${new Date(photo.genereLe).toLocaleDateString('fr-FR')} · Objectifs : ${c.o._source}${repris.length ? ' · Valeurs reprises du mois précédent : ' + repris.map(k => esc((root.Pipeline && root.Pipeline.LIBELLE_SOURCE[k]) || k)).join(', ') : ''}</span>
  </footer>
</div>`;
  }

  const api = { calculer, rendre, objectifsPour, LANGUES, DEVISES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Fiche = api;
})(typeof self !== 'undefined' ? self : this);
