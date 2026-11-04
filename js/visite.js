/* Dossier de visite – page de préparation (vue AR) placée avant la fiche magasin.
 * Compare le magasin à son groupe de référence : succursales France = même AR, franchises = même franchisé,
 * international = même pays. Classement, moyenne du groupe, objectif, évolution depuis le mois précédent,
 * points forts / points de vigilance, actions du dernier bilan, score santé, zone de notes. */
(function (root) {
  'use strict';
  const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, x => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[x]));
  const nb = (v, d = 0) => v == null || isNaN(v) ? '–' : Number(v).toLocaleString('fr-FR', { maximumFractionDigits: d, minimumFractionDigits: d });
  const DEV = { 'Euro': '€', 'Franc Suisse': 'CHF', 'Livre Sterling': '£', 'Shekel': '₪', 'Dollars Canadien': '$', 'Dolard': '$' };
  const ratio = (a, b) => (a == null || !b) ? null : a / b;

  // Indicateurs comparés : [id, libellé, lecture(c), format, sens (1 = plus haut est mieux, -1 = plus bas est mieux), objectif(c)]
  const kpi = (c, lib) => { const k = c.optique.kpis.concat(c.audio.kpis).find(x => x[0] === lib); return k ? k : [lib, null, null]; };
  const INDICATEURS = [
    ['posit', 'Positionnement', c => c.ca.posit, 'pct0', 1, () => 1],
    ['evolCa', 'Évolution du CA', c => c.ca.evol, 'evol', 1, null],
    ['ventes', 'Évolution des ventes optique', c => c.optique.ventesEvolPct, 'evol', 1, null],
    ['panier', 'Panier moyen optique', c => c.optique.panier, 'eur', 1, c => c.o.panier],
    ['tc', 'Taux de concrétisation', c => kpi(c, 'Taux de Concrétisation')[2], 'pct1', 1, c => kpi(c, 'Taux de Concrétisation')[1]],
    ['pm1', 'Prix moyen 1re paire', c => kpi(c, 'Pmoyen 1er Paire')[2], 'eur', 1, c => kpi(c, 'Pmoyen 1er Paire')[1]],
    ['sop', '% SOP', c => kpi(c, '% SOP')[2], 'pct1', 1, c => kpi(c, '% SOP')[1]],
    ['pc', '% Pack Confort', c => kpi(c, '% Pack Confort')[2], 'pct1', 1, c => kpi(c, '% Pack Confort')[1]],
    ['mdc', '% MdC', c => c.renta.mdc, 'pct1', 1, c => c.o.mdc],
    ['audio', 'Évolution du CA audio', c => c.audio.evol, 'evol', 1, null],
    ['prot', 'Prothèses vendues', c => c.audio.protheses, 'nb', 1, null],
    ['google', 'Note Google', c => c.google.opt.note, 'note', 1, () => 4.5],
    ['conf', 'Confidence (global)', c => ratio(c.confidence[3][1], c.confidence[3][2]), 'pct0', 1, null],
    ['indus', 'Taux d’indus', c => c.renta.indus, 'pct2', -1, () => 0.01],
    ['rentaSal', 'Renta salariale', c => c.rentaSal, 'pct1', -1, () => 0.28],
  ];

  function fmt(v, f, dev) {
    if (v == null || isNaN(v)) return '–';
    switch (f) {
      case 'pct0': return nb(v * 100) + ' %';
      case 'pct1': return nb(v * 100, 1) + ' %';
      case 'pct2': return nb(v * 100, 2) + ' %';
      case 'evol': return (v > 0 ? '+' : '') + nb(v * 100, 1) + ' %';
      case 'eur': return nb(v) + ' ' + dev;
      case 'note': return nb(v, 1);
      default: return nb(v);
    }
  }
  function groupeDe(mag, ref) {
    if (mag.type === 'Franchise') return { lib: 'Franchisé ' + (mag.groupe || ''), f: r => r.type === 'Franchise' && r.groupe === mag.groupe };
    if (mag.pays === 'FRANCE') return { lib: 'AR ' + (mag.ar || ''), f: r => r.pays === 'FRANCE' && r.type === 'Succursale' && r.ar === mag.ar && r.nature === mag.nature };
    return { lib: mag.pays, f: r => r.pays === mag.pays };
  }

  function rendre(photo, precedente, ref, mag, objectifs, opts = {}) {
    const Fiche = root.Fiche;
    const dev = DEV[mag.devise] || '€';
    const c = Fiche.calculer(photo, mag, objectifs);
    const grp = groupeDe(mag, ref);
    const pairs = ref.filter(r => r.actif === 'Oui' && grp.f(r) && photo.magasins[String(r.code)]);
    const calcs = pairs.map(r => ({ r, c: Fiche.calculer(photo, r, objectifs) }));
    const cPrec = precedente && precedente.magasins[String(mag.code)] ? Fiche.calculer(precedente, mag, objectifs) : null;

    // Comparaison indicateur par indicateur
    const lignes = INDICATEURS.map(([id, lib, lire, f, sens, objF]) => {
      const v = lire(c), ob = objF ? objF(c) : null;
      const vals = calcs.map(x => ({ code: String(x.r.code), v: lire(x.c) })).filter(x => x.v != null && isFinite(x.v));
      const moy = vals.length ? vals.reduce((a, x) => a + x.v, 0) / vals.length : null;
      vals.sort((a, b) => sens * (b.v - a.v));
      const rang = v == null ? null : vals.findIndex(x => x.code === String(mag.code)) + 1 || null;
      const pctile = rang && vals.length > 1 ? 1 - (rang - 1) / (vals.length - 1) : null; // 1 = meilleur du groupe
      const atteint = (v == null || ob == null) ? null : sens > 0 ? v >= ob : v <= ob;
      const prec = cPrec ? lire(cPrec) : null;
      return { id, lib, v, f, sens, ob, moy, rang, n: vals.length, pctile, atteint, prec };
    });
    // Seuls les indicateurs qui distinguent vraiment le magasin (valeurs différentes dans le groupe, écart à la moyenne non nul)
    const classees = lignes.filter(l => l.pctile != null && l.n >= 3 && l.moy != null && Math.abs(l.v - l.moy) > Math.abs(l.moy) * 0.005 + 1e-9);
    const forts = classees.slice().sort((a, b) => b.pctile - a.pctile).filter(l => l.pctile >= 0.6).slice(0, 4);
    const faibles = classees.slice().sort((a, b) => a.pctile - b.pctile).filter(l => l.pctile <= 0.4).slice(0, 4);

    // Rang global du positionnement dans le groupe
    const lp = lignes[0];
    const titreMois = `Dossier de visite · à fin ${MOIS[photo.mois - 1]} ${photo.annee}`;
    const logo = opts.logo || 'assets/logo-optical-center.png';
    const ecart = (l) => {
      if (l.v == null || l.moy == null) return '';
      const d = l.v - l.moy, bon = l.sens * d >= 0;
      const txt = ['pct0', 'pct1', 'pct2', 'evol'].includes(l.f) ? (d > 0 ? '+' : '−') + nb(Math.abs(d) * 100, l.f === 'pct2' ? 2 : 1) + ' pt' : (d > 0 ? '+' : '−') + fmt(Math.abs(d), l.f, dev);
      return `<span class="${bon ? 'ok' : 'ko'}">${txt}</span>`;
    };
    const evolMois = (l) => {
      if (l.v == null || l.prec == null || ['evolCa', 'ventes', 'audio'].includes(l.id)) return '';
      const d = l.v - l.prec; if (Math.abs(d) < 1e-9) return '<span class="muted">=</span>';
      const bon = l.sens * d > 0;
      return `<span class="${bon ? 'ok' : 'ko'}">${d > 0 ? '▲' : '▼'}</span>`;
    };
    const barreRang = l => l.pctile == null ? '' : `<span class="v-rang"><i style="left:${((1 - l.pctile) * 100).toFixed(0)}%"></i></span>`;
    const tableau = `<table class="v-comp"><thead><tr><th>Indicateur</th><th>Magasin</th><th>Objectif</th><th>Moyenne ${esc(grp.lib)}</th><th>Écart</th><th>Rang</th><th></th><th>Mois</th></tr></thead><tbody>
      ${lignes.map(l => `<tr><td><b>${esc(l.lib)}</b></td><td class="fort ${l.atteint == null ? '' : l.atteint ? 'ok' : 'ko'}">${fmt(l.v, l.f, dev)}</td><td class="muted">${l.ob == null ? '–' : fmt(l.ob, l.f === 'evol' ? 'pct0' : l.f, dev)}</td><td>${fmt(l.moy, l.f, dev)}</td><td>${ecart(l)}</td><td>${l.rang ? `<b>${l.rang}</b><small> / ${l.n}</small>` : '–'}</td><td>${barreRang(l)}</td><td>${evolMois(l)}</td></tr>`).join('')}
    </tbody></table>`;
    const puces = (ls, vide) => ls.length ? ls.map(l => `<li><b>${esc(l.lib)}</b> ${fmt(l.v, l.f, dev)} <small>· ${l.rang}${l.rang === 1 ? 'er' : 'e'} sur ${l.n} · moy. ${fmt(l.moy, l.f, dev)}</small></li>`).join('') : `<li class="muted">${vide}</li>`;

    // Score santé et bilan de passage (mêmes sources que la fiche)
    const sa = photo.sante && photo.sante.magasins && photo.sante.magasins[String(mag.code)];
    const bil = photo.bilans && photo.bilans.magasins && photo.bilans.magasins[String(mag.code)];
    const dfr = d => d ? String(d).slice(0, 10).split('-').reverse().join('/') : '';
    const finM = (photo.bilans && photo.bilans.fin) || '';
    const bilan = !bil || !bil.actions || !bil.actions.length ? '<p class="muted">Aucune action enregistrée lors du dernier bilan de passage.</p>'
      : `<table class="bilan"><thead><tr><th>Action</th><th>Responsable</th><th>Échéance</th><th>Fait ?</th></tr></thead><tbody>${bil.actions.map((a, i) => `<tr><td><b>${i + 1}. ${esc(a.texte)}</b>${a.commentaire ? `<small>${esc(a.commentaire)}</small>` : ''}</td><td>${esc(a.qui || '–')}</td><td class="${a.echeance && finM && String(a.echeance).slice(0, 10) < finM ? 'ko' : ''}">${esc(dfr(a.echeance) || '–')}</td><td class="v-case">☐</td></tr>`).join('')}</tbody></table>`;

    const tuile = (lib, v, s, cl = '') => `<div class="tuile ${cl}"><div class="v">${v}</div><div class="l">${esc(lib)}</div>${s ? `<div class="s">${s}</div>` : ''}</div>`;
    return `<div class="fiche visite" lang="fr">
  <header class="f-head">
    <img class="f-logo" src="${logo}" alt="">
    <div class="f-titre"><div class="f-label">${esc(titreMois)}</div><h1>${esc(mag.magasin)}</h1>
      <div class="f-meta">Manager <b>${esc(mag.manager || '–')}</b><span>·</span>Code ${esc(mag.code)}<span>·</span>Comparé à : ${esc(grp.lib)} (${pairs.length} magasins)</div></div>
    <div class="f-tag">${esc(mag.pays === 'FRANCE' ? (mag.ar || mag.pays) : mag.pays)}<small>${esc(mag.type || '')}</small></div>
  </header>
  <div class="chiffres v-chiffres">
    ${tuile('CA généré', c.ca.ca == null ? '–' : nb(c.ca.ca / 1000) + '\u202fk' + dev, c.ca.evol == null ? '' : `<span class="${c.ca.evol >= 0 ? 'ok' : 'ko'}">${fmt(c.ca.evol, 'evol')} vs N-1</span>`)}
    ${tuile('Positionnement', fmt(c.ca.posit, 'pct0'), lp.rang ? `${lp.rang}${lp.rang === 1 ? 'er' : 'e'} sur ${lp.n} · ${esc(grp.lib)}` : '', c.ca.posit == null ? '' : c.ca.posit >= 1 ? 'fort ok' : 'fort ko')}
    ${tuile('CA manquant', c.ca.manquant == null ? '–' : nb(c.ca.manquant / 1000) + '\u202fk' + dev, c.ca.restant == null ? '' : `restant par mois ${nb(c.ca.restant / 1000)}\u202fk${dev}`, c.ca.manquant ? 'rouge' : '')}
    ${tuile('Potentiel CA', c.ca.potentiel == null ? '–' : nb(c.ca.potentiel / 1000) + '\u202fk' + dev, 'pertes sur objectifs qualité')}
    ${tuile('Score santé', sa && sa.score != null ? nb(sa.score) + '<small style="font-size:9px;opacity:.6">/100</small>' : '–', sa && sa.precedent != null ? `${sa.score >= sa.precedent ? '▲' : '▼'} ${sa.score - sa.precedent > 0 ? '+' : ''}${sa.score - sa.precedent} pts` : '')}
  </div>
  <section class="f-sec"><h2><span>Le magasin face à ${esc(grp.lib)} <small>rang 1 = meilleur · repère : à gauche = en tête du groupe · Mois : tendance vs mois précédent</small></span></h2>${tableau}</section>
  <div class="grille2">
    <section class="f-sec v-forts"><h2><span>Points forts</span></h2><ul>${puces(forts, 'Pas d’indicateur nettement au-dessus du groupe.')}</ul></section>
    <section class="f-sec v-faibles"><h2><span>Points de vigilance</span></h2><ul>${puces(faibles, 'Pas d’indicateur nettement en dessous du groupe.')}</ul></section>
  </div>
  <section class="f-sec"><h2><span>Actions du dernier bilan de passage ${bil && bil.date ? `<small>passage du ${esc(dfr(bil.date))}${bil.ar ? ' · ' + esc(bil.ar) : ''}</small>` : ''}</span></h2>${bilan}</section>
  <section class="f-sec v-notes"><h2><span>Notes de visite <small>date : ____ / ____ / ________</small></span></h2><div class="v-lignes">${'<div></div>'.repeat(9)}</div></section>
  <footer class="f-pied"><span>Optical Center · Dossier de visite · généré le ${new Date().toLocaleDateString('fr-FR')}</span><span class="slogan">Entendre et voir UNIQUEMENT le <b>BIEN</b></span><span>Usage interne</span></footer>
</div>`;
  }

  const api = { rendre, INDICATEURS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Visite = api;
})(typeof self !== 'undefined' ? self : this);
