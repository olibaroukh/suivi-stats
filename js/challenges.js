/* Managers Leaders et Magasins d'Excellence — écran de saisie des critères manuels (succursales).
 * Les critères automatiques se calculent sur la fiche magasin ; ici on saisit les critères manuels,
 * magasin par magasin (AR sur leur périmètre, administrateur partout). Le cockpit viendra ensuite. */
(function (root) {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, x => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[x]));
  // Critères saisis à la main (champ enregistré, libellé, challenge concerné)
  const CHAMPS = [
    ['formation', '3 jours de formation', 'ML 3 · ME 4'],
    ['intelligence', 'Retour terrain AR + Siège', 'ML 4'],
    ['planning', 'Planning', 'ML 5'],
    ['retours', 'Retours', 'ML 5'],
    ['dressCode', 'Dress code', 'ME 10'],
    ['vocabulaire', 'Vocabulaire', 'ME 10'],
    ['savoirEtre', 'Savoir-être', 'ME 10'],
  ];

  function lignes(photo, ref, objectifs, conf, filtre, taux) {
    const Fiche = root.Fiche;
    return ref.filter(r => r.actif === 'Oui' && r.type === 'Succursale' && r.nature !== 'Camion' && photo.magasins[String(r.code)] && (!filtre || filtre(r)))
      .map(r => ({ r, ch: Fiche.challenges(photo, r, Fiche.calculer(photo, r, objectifs), conf, { taux }) }))
      .sort((a, b) => String(a.r.ar || '').localeCompare(String(b.r.ar || '')) || String(a.r.magasin).localeCompare(String(b.r.magasin)));
  }
  function rendre(ls, conf, opts = {}) {
    const admin = !!opts.admin, mags = (conf && conf.magasins) || {};
    const k = { ml: ls.filter(x => x.ch.sml.ok === 10).length, me: ls.filter(x => x.ch.sme.ok === 10).length,
      aSaisir: ls.filter(x => CHAMPS.some(([c]) => !mags[x.r.code] || !mags[x.r.code].saisies || typeof mags[x.r.code].saisies[c] !== 'boolean')).length };
    const cel = (code, champ) => { const v = ((mags[code] || {}).saisies || {})[champ];
      return `<td class="ms ${v === true ? 'ok' : v === false ? 'ko' : 'na'}" data-code="${esc(code)}" data-champ="${champ}" title="Clic : à renseigner → OK → non">${v === true ? 'OK' : v === false ? 'Non' : '–'}</td>`; };
    const sc = s => `<td class="sc ${s.ok === 10 ? 'top' : ''}">${s.ok}<small>/10</small></td>`;
    return `<div class="ch-page">
      <div class="ch-cpts">
        <div><div class="v">${k.ml}</div><div class="l">Managers Leaders (10/10)</div></div>
        <div><div class="v">${k.me}</div><div class="l">Magasins d’Excellence (10/10)</div></div>
        <div><div class="v">${k.aSaisir}</div><div class="l">Magasins avec des critères à renseigner</div><div class="s">sur ${ls.length} succursales · ${esc(opts.periode || '')}</div></div>
      </div>
      <div class="ch-scroll"><table class="ch-t ms-t"><thead><tr><th class="g">Magasin</th><th class="g">AR</th>
        ${CHAMPS.map(([, l, q]) => `<th>${esc(l)}<small>${esc(q)}</small></th>`).join('')}
        <th>Fidélisation<small>ME 6</small></th><th>Obj. CE<small>ML 10</small></th><th>Manager Leader</th><th>Mag. d’Excellence</th></tr></thead>
        <tbody>${ls.map(({ r, ch }) => { const m = mags[r.code] || {};
          return `<tr><td class="g"><b>${esc(r.magasin)}</b> <small>${esc(r.code)}</small></td><td class="g"><small>${esc(r.ar || '')}</small></td>
          ${CHAMPS.map(([c]) => cel(r.code, c)).join('')}
          <td>${admin ? `<input class="ms-num" data-code="${esc(r.code)}" data-champ="fid" type="number" min="0" max="100" step="1" value="${m.fid != null ? Math.round(m.fid * 100) : ''}" placeholder="–"> %` : (m.fid != null ? Math.round(m.fid * 100) + ' %' : '–')}</td>
          <td>${admin ? `<input class="ms-num" data-code="${esc(r.code)}" data-champ="objCe" type="number" min="0" step="10" value="${m.objCe != null ? m.objCe : ''}" placeholder="${esc(opts.objCeDefaut ? opts.objCeDefaut(r) : '')}">` : (m.objCe != null ? m.objCe : (opts.objCeDefaut ? opts.objCeDefaut(r) : '–'))}</td>
          ${sc(ch.sml)}${sc(ch.sme)}</tr>`; }).join('')}</tbody></table></div>
      <p class="aide">Clic sur une case : à renseigner (–) → OK → Non. Enregistré aussitôt et repris sur la fiche magasin. Les autres critères se calculent automatiquement (détail sur la fiche, page 2).${admin ? ' Fidélisation et objectif de visites CE : réservés à l’administrateur.' : ''}</p>
    </div>`;
  }
  const api = { lignes, rendre, CHAMPS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Challenges = api;
})(typeof self !== 'undefined' ? self : this);
