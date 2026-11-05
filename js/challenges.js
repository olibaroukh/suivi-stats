/* Écran « Challenges » : Manager Leader et Magasin d'excellence pour les succursales.
 * Critères automatiques (photo du mois) + critères manuels saisis ici (config/challenges-AAAA.json).
 * Qualifié = 10 critères sur 10 atteints. */
(function (root) {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, x => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[x]));
  // Critères saisis à la main (index dans la liste du challenge) ; LEADERSHIP (me 1) est calculé mais peut être forcé
  const MANUELS = { ml: [1, 2, 3, 4, 5], me: [1, 3, 5, 6, 9] };

  function lignes(photo, ref, objectifs, saisies, filtre) {
    const Fiche = root.Fiche;
    return ref.filter(r => r.actif === 'Oui' && r.type === 'Succursale' && r.nature !== 'Camion' && photo.magasins[String(r.code)] && (!filtre || filtre(r)))
      .map(r => { const c = Fiche.calculer(photo, r, objectifs); const ch = Fiche.challenges(photo, r, c, saisies); return { r, ch }; })
      .sort((a, b) => b.ch.sme.ok - a.ch.sme.ok || b.ch.sml.ok - a.ch.sml.ok || String(a.r.magasin).localeCompare(String(b.r.magasin)));
  }
  function compter(ls) {
    return { ml10: ls.filter(x => x.ch.sml.ok === 10).length, ml8: ls.filter(x => x.ch.sml.ok >= 8).length,
      me10: ls.filter(x => x.ch.sme.ok === 10).length, me8: ls.filter(x => x.ch.sme.ok >= 8).length, n: ls.length };
  }
  function rendre(ls, opts = {}) {
    const k = compter(ls), edit = !!opts.edition;
    const ex = ls[0] ? ls[0].ch : null;
    const tete = (cle, l) => (ex ? ex[cle] : []).map((x, i) => `<th title="${esc(x[0] + ' – ' + x[1])}">${i + 1}${MANUELS[cle].includes(i) ? '<sup>✎</sup>' : ''}</th>`).join('');
    const cases = (r, cle, liste) => liste.map((x, i) => {
      const st = x[2], man = MANUELS[cle].includes(i);
      const ic = st.s === 'ok' ? '✓' : st.s === 'ko' ? '✕' : '•';
      const titre = `${x[0]} – ${x[1]}${st.val ? ' · ' + st.val : ''}${st.saisi ? ' · saisi' : ''}${man && edit ? ' · clic : changer' : ''}`;
      return `<td class="ch-c ${st.s}${st.saisi ? ' saisi' : ''}${man && edit ? ' modif' : ''}" ${man && edit ? `data-code="${esc(r.code)}" data-l="${cle}" data-i="${i}"` : ''} title="${esc(titre)}">${ic}</td>`;
    }).join('');
    const legende = cle => (ex ? ex[cle] : []).map((x, i) => `<li><b>${i + 1}.</b> ${esc(x[0])} <span>${esc(x[1])}</span>${MANUELS[cle].includes(i) ? ' ✎' : ''}</li>`).join('');
    return `<div class="ch-page">
      <div class="ch-cpts">
        <div><div class="v">${k.ml10}</div><div class="l">Managers Leader (10/10)</div><div class="s">${k.ml8} à 8 ou plus</div></div>
        <div><div class="v">${k.me10}</div><div class="l">Magasins d’excellence (10/10)</div><div class="s">${k.me8} à 8 ou plus</div></div>
        <div><div class="v">${k.n}</div><div class="l">Succursales</div><div class="s">${esc(opts.periode || '')}</div></div>
      </div>
      <div class="ch-scroll"><table class="ch-t"><thead>
        <tr><th rowspan="2" class="g">Magasin</th><th rowspan="2" class="g">AR</th><th colspan="11" class="ml">LE MANAGER LEADER</th><th colspan="11" class="me">LE MAGASIN D’EXCELLENCE</th></tr>
        <tr>${tete('ml')}<th>Score</th>${tete('me')}<th>Score</th></tr></thead>
        <tbody>${ls.map(({ r, ch }) => `<tr><td class="g"><b>${esc(r.magasin)}</b> <small>${esc(r.code)}</small></td><td class="g"><small>${esc(r.ar || '')}</small></td>
          ${cases(r, 'ml', ch.ml)}<td class="sc ${ch.sml.ok === 10 ? 'top' : ''}">${ch.sml.ok}<small>/10</small></td>
          ${cases(r, 'me', ch.me)}<td class="sc ${ch.sme.ok === 10 ? 'top' : ''}">${ch.sme.ok}<small>/10</small></td></tr>`).join('')}</tbody></table></div>
      <div class="ch-leg"><div><h4>Le Manager Leader</h4><ol>${legende('ml')}</ol></div><div><h4>Le Magasin d’excellence</h4><ol>${legende('me')}</ol></div></div>
      <p class="aide">✓ atteint · ✕ non atteint · • à renseigner · ✎ critère saisi à la main${edit ? ' (cliquez sur la case pour passer de « à renseigner » à atteint, puis non atteint)' : ''}. Qualifié = 10 critères sur 10.</p>
    </div>`;
  }
  const api = { lignes, compter, rendre, MANUELS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Challenges = api;
})(typeof self !== 'undefined' ? self : this);
