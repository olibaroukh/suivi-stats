/* Les Actions de l'Année : liste paramétrable chaque année (numéro, responsable, libellé, objectif).
 * Une action est soit « automatique » (mesure calculée à partir de la photo du mois : CA, RE, renta salariale, MdC,
 * ouvertures, Confidence, visites…), soit « manuelle » (valeur saisie, conservée tant qu'elle n'est pas modifiée).
 * Configuration : config/actions-AAAA.json { titre, actions: [...] }. */
(function (root) {
  'use strict';
  const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, x => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[x]));
  const nb = (v, d = 0) => v == null || isNaN(v) ? '–' : Number(v).toLocaleString('fr-FR', { maximumFractionDigits: d, minimumFractionDigits: d });
  const SITES_DEV = { France: 'Euro', Israel: 'Shekel', UK: 'Livre Sterling', Canada: 'Dollars Canadien' };

  // Périmètres propres aux actions (+ ceux des cockpits : AR, pays, franchisés)
  function perimetres(ref) {
    const Cockpit = root.Cockpit;
    const base = [
      { id: 'reseau', lib: 'Tout le réseau', f: () => true },
      { id: 'france_succ', lib: 'France – succursales (avec OCM)', f: r => r.pays === 'FRANCE' && r.type === 'Succursale' },
      { id: 'france_succ_mag', lib: 'France – succursales (hors OCM)', f: r => r.pays === 'FRANCE' && r.type === 'Succursale' && r.nature !== 'Camion' && String(r.ar || '').toUpperCase() !== 'OCM' },
      { id: 'france_franch', lib: 'France – franchises (avec OCM)', f: r => r.pays === 'FRANCE' && r.type === 'Franchise' },
      { id: 'france', lib: 'France – tout', f: r => r.pays === 'FRANCE' },
      { id: 'international', lib: 'International (avec OCM)', f: r => r.pays !== 'FRANCE' },
      { id: 'inter_succ', lib: 'International – succursales', f: r => r.pays !== 'FRANCE' && r.type === 'Succursale' },
    ];
    const pays = [...new Set(ref.map(r => r.pays).filter(Boolean))].sort();
    pays.forEach(p => base.push({ id: 'pays:' + p, lib: 'Pays – ' + p, f: r => r.pays === p }));
    (Cockpit ? Cockpit.perimetres(ref) : []).filter(p => /^(ar:|groupe:)/.test(p.id)).forEach(p => base.push({ id: p.id, lib: p.lib, f: p.filtre }));
    return base;
  }
  // Plusieurs pays : identifiant « pays:A|B|C »
  function filtrePerimetre(id, ref) {
    if (/^pays:.*\|/.test(id)) { const l = id.slice(5).split('|'); return r => l.includes(r.pays); }
    const p = perimetres(ref).find(x => x.id === id); return p ? p.f : null;
  }

  const MESURES = {
    ca: { lib: 'CA TTC cumulé (M€)', fmt: 'M', sites: true },
    posit: { lib: 'Positionnement (prévisionnel / objectif)', fmt: 'pct1' },
    ouvertures: { lib: 'Nombre d’ouvertures dans l’année', fmt: 'nb' },
    re: { lib: 'RE (reporting trimestriel)', fmt: 'pct1', periode: 'reporting' },
    marge: { lib: 'Marge produits (reporting trimestriel)', fmt: 'pct1', periode: 'reporting' },
    marge12: { lib: 'Marge brute produits (12 mois glissants)', fmt: 'pct1', periode: 'glissant' },
    rentaSal: { lib: 'Rentabilité salariale', fmt: 'pct1', periode: 'mois' },
    mdc: { lib: 'Taux de MdC', fmt: 'pct1' },
    indus: { lib: 'Taux d’indus', fmt: 'pct2', periode: 'restes' },
    note: { lib: 'Note Google moyenne', fmt: 'note' },
    confUtil: { lib: 'Confidence : magasins utilisateurs', fmt: 'conf' },
    visOphta: { lib: 'Visites ophtalmologistes / orthoptistes (cumul)', fmt: 'nb' },
    visOrl: { lib: 'Visites ORL / généralistes (cumul)', fmt: 'nb' },
    mag100: { lib: 'Nombre de magasins à 100 %', fmt: 'nb' },
    nbML: { lib: 'Nombre de Managers Leaders qualifiés (≥ 7/10)', fmt: 'nb' },
    nbME: { lib: 'Nombre de Magasins d’Excellence qualifiés (≥ 7/10)', fmt: 'nb' },
    // 24/11/2026 : critères du Pôle d'excellence
    avisMoy: { lib: 'Avis Google par magasin (moyenne)', fmt: 'nb' },
    confTaux: { lib: 'Confidence : clients contactés / clients des listes', fmt: 'pct1' },
    mrQualite: { lib: 'Clients mystères (Mr Qualité, moyenne /100)', fmt: 'note1' },
    turnover: { lib: 'Turn-over (départs depuis janvier / effectif moyen)', fmt: 'pct1' },
  };

  function calculer(a, photo, ref, taux, ctx = {}) {
    const Cockpit = root.Cockpit, ind = a.indicateur || {}, mes = MESURES[ind.mesure];
    if (!mes || !photo) return { valeur: null, texte: '–' };
    const f = filtrePerimetre(ind.perimetre || 'reseau', ref); if (!f) return { valeur: null, texte: 'périmètre inconnu' };
    const rs = ref.filter(r => f(r)), actifs = rs.filter(r => r.actif === 'Oui');
    const avec = rs.filter(r => photo.magasins[String(r.code)]);
    const items = avec.map(r => ({ ...photo.magasins[String(r.code)], devise: r.devise || 'Euro' }));
    const conv = it => taux[it.devise] || 1, m = photo.mois;
    const agg = items.length ? Cockpit.agreger(items, conv) : { N: {}, N1: {} };
    const C = k => Cockpit.COL[k].f(agg.N, agg.N1, m);
    let v = null, extra = '';
    switch (ind.mesure) {
      case 'ca': {
        v = (agg.N.P || 0);
        const s = photo.groupe && photo.groupe.site && photo.groupe.site.sites;
        if (s && ind.sites && ind.sites !== 'aucun') for (const nom in s) {
          if (ind.sites === 'France' && nom !== 'France') continue;
          if (ind.sites === 'international' && nom === 'France') continue;
          v += (s[nom].caN || 0) * (taux[SITES_DEV[nom]] || 1);
        }
        v = v / 1e6; break;
      }
      case 'posit': v = C('posit'); break;
      case 'ouvertures': v = actifs.filter(r => { const d = String(r.ouverture || ''); const an = (d.match(/(\d{4})/) || [])[1]; return +an === photo.annee; }).length; break;
      case 're': v = C('re'); break;
      case 'marge': v = C('marge'); break;
      case 'marge12': { const n = agg.N, ca = (n.CA || 0) + (n.CC || 0) + (n.CE || 0) + (n.CG || 0), mg = (n.CB || 0) + (n.CD || 0) + (n.CF || 0) + (n.CH || 0); v = ca ? mg / ca : null; break; }
      case 'rentaSal': v = C('rentaSal'); break;
      case 'mdc': v = C('mdc'); break;
      case 'indus': v = agg.N.BV; break;
      case 'note': v = C('note'); break;
      case 'confUtil': { const u = actifs.filter(r => { const n = (photo.magasins[String(r.code)] || {}).N || {}; return (n.DO || 0) > 0; }).length; v = actifs.length ? u / actifs.length : null; extra = `avec ${nb(u)} / ${nb(actifs.length)} mag.`; break; }
      case 'visOphta': v = (agg.N.DW || 0) + (agg.N.DX || 0); break;
      case 'visOrl': v = (agg.N.DV || 0) + (agg.N.DY || 0); break;
      case 'nbML': case 'nbME': {
        const Fiche = root.Fiche; if (!Fiche) { v = null; break; }
        v = actifs.filter(r => r.type === 'Succursale' && r.nature !== 'Camion' && photo.magasins[String(r.code)]).filter(r => {
          const ch = Fiche.challenges(photo, r, Fiche.calculer(photo, r, ctx.objectifs || {}), ctx.challenges || null, { taux });
          return (ind.mesure === 'nbML' ? ch.sml.ok : ch.sme.ok) >= 7; }).length;
        break;
      }
      case 'avisMoy': { const l = actifs.map(r => ((photo.magasins[String(r.code)] || {}).N || {}).BL).filter(x => x != null); v = l.length ? l.reduce((a, x) => a + x, 0) / l.length : null; extra = `sur ${nb(l.length)} mag.`; break; }
      case 'confTaux': v = agg.N.DP ? (agg.N.DO || 0) / agg.N.DP : null; break;
      case 'mrQualite': { const l = actifs.map(r => ((photo.magasins[String(r.code)] || {}).N || {}).CK).filter(x => x != null); v = l.length ? l.reduce((a, x) => a + x, 0) / l.length : null; extra = `sur ${nb(l.length)} mag.`; break; }
      case 'turnover': {
        // Départs = personnes présentes dans un export RH antérieur de l'année et absentes du dernier ; effectif moyen des mois avec export RH
        const codes = new Set(rs.map(r => String(r.code)));
        const ens = ph => { if (!ph || !ph.equipes) return null; const e = new Set(); for (const c in ph.equipes) if (codes.has(String(c))) ph.equipes[c].forEach(p => p.matricule && e.add(String(p.matricule))); return e.size ? e : null; };
        const mois = (ctx.photosAnnee || []).filter(ph => ph && ph.annee === photo.annee && ph.mois <= photo.mois).sort((a, b) => a.mois - b.mois).map(ph => ({ m: ph.mois, e: ens(ph) })).filter(x => x.e);
        const der = mois.find(x => x.m === photo.mois) || null;
        if (der && mois.length) {
          const vus = new Set(); mois.forEach(x => x.e.forEach(mt => vus.add(mt)));
          const departs = [...vus].filter(mt => !der.e.has(mt)).length, moy = mois.reduce((a, x) => a + x.e.size, 0) / mois.length;
          v = moy ? departs / moy : null; extra = `${nb(departs)} départs · depuis ${MOIS[mois[0].m - 1]}`;
        }
        break;
      }
      case 'mag100': v = actifs.filter(r => { const d = photo.magasins[String(r.code)]; const p = d ? Cockpit.COL.posit.f(d.N || {}, d.N1 || {}, m) : null; return p != null && p >= 1; }).length; break;
    }
    // Période propre à la source
    const src = s => photo.sources && photo.sources[s];
    const finLib = iso => { const [an, mo] = iso.split('-').map(Number); return `${MOIS[mo - 1]} ${an}`; };
    let per = '';
    if (mes.periode === 'reporting') { const x = src('rentabilites'), mm = String((x && (x.periode && x.periode.au)) || (x && x.detail) || '').match(/(\d{4})-(\d{2})/); if (mm) per = `à fin ${MOIS[+mm[2] - 1]} ${mm[1]}`; }
    else if (mes.periode === 'restes') { const x = src('restes_dus'); if (x && x.periode) per = `au ${x.periode.au.split('-').reverse().join('/')}`; }
    else if (mes.periode === 'glissant') { const d = new Date(photo.annee - 1, photo.mois, 1); per = `de ${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()} à ${String(photo.mois).padStart(2, '0')}/${photo.annee}`; }
    else if (mes.periode === 'mois') per = `à fin ${MOIS[photo.mois - 1]} ${photo.annee}`;
    const proj = a.objectif && a.objectif.projection && ['ca', 'ouvertures', 'visOphta', 'visOrl'].includes(ind.mesure) && v != null ? v * 12 / m : null;
    return { valeur: v, projection: proj, texte: formater(v, mes.fmt), extra: [extra, proj != null ? `prév. ${formater(proj, mes.fmt)}` : '', per].filter(Boolean).join(' · ') };
  }
  function formater(v, fmt) {
    if (v == null || isNaN(v)) return '–';
    switch (fmt) {
      case 'M': return nb(v) + ' M€';
      case 'pct1': return nb(v * 100, 1) + ' %';
      case 'pct2': return nb(v * 100, 2) + ' %';
      case 'conf': return nb(v * 100) + ' %';
      case 'note': case 'note1': return nb(v, 1);
      default: return nb(v);
    }
  }
  // Statut : comparaison numérique à l'objectif (sur la projection annuelle si demandé) ; sinon statut manuel
  function statut(a, r) {
    if (a.mode === 'manuel') return a.manuel && a.manuel.statut || '';
    const o = a.objectif || {}; if (o.valeur == null || o.valeur === '' || r.valeur == null) return '';
    const mes = MESURES[(a.indicateur || {}).mesure] || {};
    const cible = ['pct1', 'pct2', 'conf'].includes(mes.fmt) ? Number(o.valeur) / 100 : Number(o.valeur);
    const v = r.projection != null ? r.projection : r.valeur;
    return (o.sens === '<=' ? v <= cible : v >= cible) ? 'ok' : 'ko';
  }

  // Actions « Nb de magasins d'excellence » / « Nb de managers leaders » restées en saisie manuelle : remplies automatiquement
  // avec les qualifiés (≥ 7/10) des succursales France (consigne d'Olivier, 05/11)
  function avecMlme(x) {
    if (x.mode === 'auto') return x;
    const l = String(x.libelle || ''), mes = /excellence/i.test(l) ? 'nbME' : /managers?\s+leaders?/i.test(l) ? 'nbML' : null;
    if (!mes) return x;
    const val = (x.objectif && x.objectif.valeur != null) ? x.objectif.valeur : (parseFloat(String((x.objectif && x.objectif.texte) || '').replace(/\s/g, '').replace(',', '.')) || null);
    return { ...x, mode: 'auto', indicateur: { mesure: mes, perimetre: 'france_succ' }, objectif: { ...(x.objectif || {}), valeur: val, sens: '>=' } };
  }
  function rendre(conf, photo, ref, taux, opts = {}) {
    const acts = (conf.actions || []).map(avecMlme).sort((a, b) => (+a.num || 0) - (+b.num || 0));
    const lignes = acts.map(a => {
      const r = a.mode === 'auto' ? calculer(a, photo, ref, taux, opts) : { texte: (a.manuel && a.manuel.valeur) || '', extra: '' };
      return { a, r, st: statut(a, r) };
    });
    const moitie = Math.ceil(lignes.length / 2);
    const table = ls => `<table class="act-t"><tbody>${ls.map(({ a, r, st }) => `<tr><td class="n">${esc(a.num)}</td><td class="q">${esc(a.resp)}</td><td class="lib">${esc(a.libelle)}</td><td class="obj">${esc((a.objectif && a.objectif.texte) || '')}</td><td class="res ${st}">${esc(r.texte)}${r.extra ? `<small>${esc(r.extra)}</small>` : ''}</td></tr>`).join('')}</tbody></table>`;
    const resp = {}; acts.forEach(a => String(a.resp || '').split(/[\/,+]/).map(s => s.trim()).filter(Boolean).forEach(x => resp[x] = (resp[x] || 0) + 1));
    const logo = opts.logo || 'assets/logo-optical-center.png';
    return `<div class="actions-page" lang="fr">
      <header class="act-head"><img src="${logo}" alt=""><h1>${esc(conf.titre || `Les ${acts.length} Actions ${photo ? photo.annee : ''}`)}</h1><div class="act-maj">Mise à jour : ${photo ? esc(MOIS[photo.mois - 1]) + ' ' + photo.annee : '–'}</div></header>
      <div class="act-cols">${table(lignes.slice(0, moitie))}${table(lignes.slice(moitie))}</div>
      <footer class="act-pied"><div class="act-resp">${Object.keys(resp).sort().map(k => `<span><b>${esc(k)}</b> ${resp[k]}</span>`).join('')}</div><div>Réalisé en <span class="ok">vert</span> : objectif atteint · en <span class="ko">rouge</span> : pas encore · * : suivi manuel</div><div class="slogan">Entendre et voir UNIQUEMENT le <b>BIEN</b></div></footer>
    </div>`;
  }

  // ---------- Pôle d'excellence (24/11/2026) : critères paramétrables par année (config/pole-excellence-AAAA.json) ----------
  const auto = (num, libelle, texte, valeur, sens, mesure, perimetre = 'france_succ_mag') => ({ num, resp: '', libelle, objectif: { texte, valeur, sens }, mode: 'auto', indicateur: { mesure, perimetre }, manuel: { valeur: '', statut: '' } });
  const POLE_MODELE_2026 = { titre: 'Pôle d’excellence 2026', objectifCriteres: 7, _modele: true, actions: [
    auto(1, 'CA succursales France', '100 %', 100, '>=', 'posit'),
    auto(2, 'Nombre d’avis Google par magasin', '500', 500, '>=', 'avisMoy'),
    auto(3, 'Taux d’utilisation de Confidence', '100 %', 100, '>=', 'confUtil'),
    auto(4, 'Taux d’indus', '< 1 %', 1, '<=', 'indus'),
    auto(5, 'Rentabilité salariale', '28 %', 28, '<=', 'rentaSal'),
    auto(6, 'Moyenne des clients mystères', '70/100', 70, '>=', 'mrQualite'),
    { num: 7, resp: '', libelle: 'Réactivité et efficacité du pôle', objectif: { texte: '≥ 8/10', valeur: null, sens: '>=' }, mode: 'manuel', indicateur: {}, manuel: { valeur: 'Atteint', statut: 'ok' } },
    auto(8, 'Nombre de Managers Leaders', '15', 15, '>=', 'nbML'),
    auto(9, 'Nombre de magasins d’excellence', '20', 20, '>=', 'nbME'),
    auto(10, 'Turn-over', '≤ 10 %', 10, '<=', 'turnover'),
  ] };
  function rendrePole(conf, photo, ref, taux, opts = {}) {
    const crit = (conf.actions || []).slice().sort((a, b) => (+a.num || 0) - (+b.num || 0));
    const lignes = crit.map(a => {
      const r = a.mode === 'auto' ? calculer(a, photo, ref, taux, opts) : { valeur: null, texte: (a.manuel && a.manuel.valeur) || '', extra: 'suivi manuel' };
      const st = statut(a, r), mes = MESURES[(a.indicateur || {}).mesure] || {};
      let prog = null;
      if (a.mode === 'auto' && r.valeur != null && a.objectif && a.objectif.valeur != null) {
        const cible = ['pct1', 'pct2', 'conf'].includes(mes.fmt) ? a.objectif.valeur / 100 : a.objectif.valeur;
        prog = a.objectif.sens === '<=' ? (r.valeur <= cible ? 1 : cible / r.valeur) : (cible ? r.valeur / cible : null);
      } else if (a.mode === 'manuel') prog = st === 'ok' ? 1 : null;
      return { a, r, st, prog };
    });
    const ok = lignes.filter(l => l.st === 'ok').length, n = lignes.length;
    // Objectif final : 7 critères sur 10 (vert), orange à 2 critères près, rouge en dessous
    const obj = Math.min(n, +conf.objectifCriteres || Math.ceil(n * 0.7));
    const humeur = ok >= obj ? 'vert' : ok >= obj - 2 ? 'orange' : 'rouge';
    const lib = { vert: 'Objectif atteint', orange: `Encore ${obj - ok} critère${obj - ok > 1 ? 's' : ''}`, rouge: `Encore ${obj - ok} critères` }[humeur];
    const C = 2 * Math.PI * 64, logo = opts.logo || 'assets/logo-optical-center.png';
    const carte = ({ a, r, st, prog }) => `<div class="pe-c ${st || 'na'}">
      <div class="pe-h"><span class="pe-n">${esc(a.num)}</span><span class="pe-st">${st === 'ok' ? '✓ Atteint' : st === 'ko' ? 'En cours' : '–'}</span></div>
      <div class="pe-lib">${esc(a.libelle)}</div>
      <div class="pe-v">${esc(r.texte || '–')}</div>
      <div class="pe-obj">Objectif <b>${esc((a.objectif && a.objectif.texte) || '–')}</b></div>
      ${prog != null ? `<div class="pe-bar"><i style="width:${Math.max(3, Math.min(100, prog * 100)).toFixed(0)}%"></i></div>` : '<div class="pe-bar vide"></div>'}
      <div class="pe-x">${esc(r.extra || (a.mode === 'manuel' ? 'suivi manuel' : ''))}</div></div>`;
    return `<div class="pole-page" lang="fr">
      <header class="pe-head ${humeur}"><img src="${logo}" alt=""><div class="pe-t"><div class="pe-sur">Suivi automatique · mise à jour ${photo ? esc(MOIS[photo.mois - 1]) + ' ' + photo.annee : '–'}</div><h1>${esc(conf.titre || `Pôle d’excellence ${photo ? photo.annee : ''}`)}</h1></div>
        <div class="pe-score"><svg viewBox="0 0 150 150" width="140" height="140"><circle cx="75" cy="75" r="64" fill="none" stroke="rgba(255,255,255,.18)" stroke-width="16"/><circle cx="75" cy="75" r="64" fill="none" stroke="#fff" stroke-width="16" stroke-linecap="round" stroke-dasharray="${(n ? ok / n * C : 0).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 75 75)"/><text x="75" y="86" text-anchor="middle">${ok}/${n}</text></svg><div>critères<br>atteints<small>objectif ${obj}/${n}</small></div></div><div class="pe-hum">${lib}</div></header>
      <div class="pe-grille" style="--l:${Math.ceil(n / 5) || 1}">${lignes.map(carte).join('')}</div>
      <footer class="act-pied"><div>Vert : objectif atteint · rouge : pas encore · périmètre : succursales France (hors OCM)</div><div class="slogan">Entendre et voir UNIQUEMENT le <b>BIEN</b></div></footer>
    </div>`;
  }

  const api = { MESURES, perimetres, calculer, rendre, rendrePole, POLE_MODELE_2026, formater };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Actions = api;
})(typeof self !== 'undefined' ? self : this);
