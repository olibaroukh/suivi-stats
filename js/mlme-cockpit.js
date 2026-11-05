/* Cockpit « Managers Leaders et Magasins d'Excellence » (A3 paysage, une page).
 * À gauche le Magasin d'Excellence, à droite le Manager Leader : nombre de qualifiés (10/10), part des succursales
 * qui valident chaque critère, détail des critères composés, magasins les plus proches de la qualification
 * (avec ce qui leur manque) et synthèse par AR. */
(function (root) {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, x => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[x]));
  const SEUIL = 7; // qualifié à partir de 7 critères sur 10 (consigne d'Olivier, 05/11)
  const pct = (a, b) => b ? Math.round(a * 1000 / b) / 10 : 0;
  const court = s => String(s).replace(/^L[’']/, '').replace(/^LA |^LE /, '').toLowerCase().replace(/(^|\s)\S/g, x => x.toUpperCase());

  function barres(ls, cle, couleur) {
    const n = ls.length; if (!n) return '';
    return ls[0].ch[cle].map((c, i) => {
      const ok = ls.filter(x => x.ch[cle][i][2].s === 'ok').length, p = pct(ok, n);
      return `<div class="mc-b"><div class="mc-bl"><b>${i + 1}.</b> ${esc(c[0])}<small>${esc(c[1])}</small></div>
        <div class="mc-bt"><div class="mc-bf" style="width:${Math.max(p, 0.5)}%;background:${couleur}"></div><span>${String(p).replace('.', ',')} %</span></div><div class="mc-bn">${ok}</div></div>`;
    }).join('');
  }
  function mini(titre, lignes, n, couleur) {
    return `<div class="mc-mini"><h4>${esc(titre)}</h4>${lignes.map(([l, ok]) => { const p = pct(ok, n);
      return `<div class="mc-mr"><span>${esc(l)}</span><div class="mc-mt"><div style="width:${Math.max(p, 0.5)}%;background:${couleur}"></div></div><em>${String(p).replace('.', ',')} %</em></div>`; }).join('')}</div>`;
  }
  function proches(ls, cle, sc, avecManager) {
    const l = ls.slice().sort((a, b) => b.ch[sc].ok - a.ch[sc].ok || String(a.r.magasin).localeCompare(String(b.r.magasin))).slice(0, 30); // affichés tant qu'il y a de la place (le reste est masqué proprement)
    if (!l.length) return '<p class="mc-vide">Aucune succursale.</p>';
    return `<table class="mc-l"><tbody>${l.map(x => { const manque = x.ch[cle].filter(c => c[2].s !== 'ok').map(c => court(c[0]));
      return `<tr class="${x.ch[sc].ok >= SEUIL ? 'q' : ''}"><td class="s">${x.ch[sc].ok}<small>/10</small></td><td class="n"><b>${esc(x.r.magasin)}</b>${avecManager && x.r.manager ? ` <small>· ${esc(x.r.manager)}</small>` : ''}</td>
        <td class="m">${(x.ch[sc].ok >= SEUIL ? '<span class="ok">Qualifié</span>' + (manque.length ? ' · reste : ' + esc(manque.join(', ')) : '') : 'Manque : ' + esc(manque.join(', ')))}</td></tr>`; }).join('')}</tbody></table>`;
  }
  function parAr(ls) {
    const g = {}; ls.forEach(x => { const k = x.r.ar || '—'; (g[k] = g[k] || []).push(x); });
    const moy = (l, sc) => l.length ? (l.reduce((a, x) => a + x.ch[sc].ok, 0) / l.length).toFixed(1).replace('.', ',') : '–';
    const q = (l, sc) => l.filter(x => x.ch[sc].ok >= SEUIL).length;
    const cols = Object.keys(g).sort().map(k => [k, g[k]]).concat([['Total', ls]]);
    const prenomNom = s => esc(String(s)).replace(/^(\S+)\s+/, '$1<br>');
    return `<table class="mc-ar"><tbody>
      <tr class="h"><th>Par AR</th>${cols.map(([k]) => `<th class="${k === 'Total' ? 't' : ''}">${k === 'Total' ? 'Total' : prenomNom(k)}</th>`).join('')}</tr>
      <tr><td>Succursales</td>${cols.map(([k, l]) => `<td class="${k === 'Total' ? 't' : ''}">${l.length}</td>`).join('')}</tr>
      <tr><td><i class="or"></i>Magasins d’Excellence <small>qualifiés · moy. /10</small></td>${cols.map(([k, l]) => `<td class="${k === 'Total' ? 't' : ''}"><b>${q(l, 'sme')}</b> <small>· ${moy(l, 'sme')}</small></td>`).join('')}</tr>
      <tr><td><i class="bl"></i>Managers Leaders <small>qualifiés · moy. /10</small></td>${cols.map(([k, l]) => `<td class="${k === 'Total' ? 't' : ''}"><b>${q(l, 'sml')}</b> <small>· ${moy(l, 'sml')}</small></td>`).join('')}</tr>
    </tbody></table>`;
  }
  function rendre(ls, opts = {}) {
    const n = ls.length, OR = '#C9A227', BL = '#3F63C7';
    const cpt = sc => ({ q: ls.filter(x => x.ch[sc].ok >= SEUIL).length, n9: ls.filter(x => x.ch[sc].ok === SEUIL - 1).length, n8: ls.filter(x => x.ch[sc].ok === SEUIL - 2).length });
    const me = cpt('sme'), ml = cpt('sml');
    const d = k => ls.map(x => x.ch.details || {}).map(x => x[k] || {});
    const compte = (k, s) => d(k).filter(x => x[s] === true).length;
    const hero = (titre, k, couleur, sous) => `<div class="mc-hero" style="--c:${couleur};background:${couleur}1F"><div class="mc-n">${k.q}</div><div><div class="mc-t">${esc(titre)}</div><div class="mc-s">qualifiés (7/10 ou plus) sur ${n} succursales · ${k.n9} à 6/10 · ${k.n8} à 5/10</div>${sous ? `<div class="mc-s">${esc(sous)}</div>` : ''}</div></div>`;
    return `<div class="mlme-page">
      <header class="mc-head"><img src="assets/logo-optical-center.png" alt=""><div><div class="mc-sur">${esc(opts.periode || '')}</div><h1>Managers Leaders et Magasins d’Excellence</h1><div class="mc-per">${esc(opts.perimetre || '')}</div></div></header>
      <div class="mc-cols">
        <section>${hero('Magasins d’Excellence', me, OR, 'Gain : 3 jours de CP pour toute l’équipe')}
          <h3>Part des succursales qui valident chaque critère</h3>${barres(ls, 'me', OR)}
          <div class="mc-minis">${mini('Performance (3 sur 5)', [['TC', compte('perf', 'tc')], ['SOP', compte('perf', 'sop')], ['Panier moyen', compte('perf', 'pm')], ['MdC', compte('perf', 'mdc')], ['Test audio', compte('perf', 'test')]], n, OR)}
            ${mini('Ressources humaines (les 3)', [['Niveau d’équipe ≥ 8', compte('rh', 'niveau')], ['Équilibre H/F', compte('rh', 'hf')], ['3 jours de formation', compte('rh', 'formation')]], n, OR)}</div>
          <h3>Qualifiés et plus proches de la qualification</h3><div class="mc-liste">${proches(ls, 'me', 'sme', false)}</div></section>
        <section>${hero('Managers Leaders', ml, BL, 'Gain : une semaine de CP pour le manager')}
          <h3>Part des succursales qui valident chaque critère</h3>${barres(ls, 'ml', BL)}
          <div class="mc-minis">${mini('Construire une équipe gagnante (les 3)', [['Effectif (écart < 0,5)', compte('equipe', 'effectif')], ['1 entretien / collab. / mois', compte('equipe', 'entretiens')], ['Niveau d’équipe ≥ 8', compte('equipe', 'niveau')]], n, BL)}
            ${mini('Gestionnaire (les 3)', [['Planning', compte('gest', 'planning')], ['Retours', compte('gest', 'retours')], ['Taux d’indus ≤ 1 %', compte('gest', 'indus')]], n, BL)}</div>
          <h3>Qualifiés et plus proches de la qualification</h3><div class="mc-liste">${proches(ls, 'ml', 'sml', true)}</div></section>
      </div>
      <div class="mc-bandeau">${parAr(ls)}</div>
      <footer class="mc-pied"><span>Critères à fin de mois : automatiques (Suivi Stats, zimbra-relay) et manuels (saisis par les AR)</span><span class="slogan">Entendre et voir UNIQUEMENT le <b>BIEN</b></span></footer>
    </div>`;
  }
  const api = { rendre };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MlmeCockpit = api;
})(typeof self !== 'undefined' ? self : this);
