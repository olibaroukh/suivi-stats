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
      reporting: { ca: nz(n.CP), lignes: [['Marge brute', 'CS'], ['Loyers chargés', 'CU'], ['Publicité', 'CW'], ['Personnel', 'CY'], ['Résultat expl.', 'CQ']].map(([l, k]) => [l, nz(n[k]) != null ? n[k] / 100 : null, OBJ_REPORTING[k], k]) },
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

  // Bloc équipe : une ligne par personne (export RH + stats Cosium par vendeur)
  function equipe(photo, mag, o) {
    const n = (photo.magasins[String(mag.code)] || {}).N || {}, m = photo.mois;
    const liste = (photo.equipes || {})[String(mag.code)] || [];
    const fin = new Date(photo.annee, m, 0);
    const actif = p => p.s && ((p.s.ndv || 0) > 0 || (p.s.ca || 0) > 0 || (p.s.ventesAudio || 0) > 0);
    const lignes = liste.filter(actif).map(p => {
      const s = p.s, f = x => x == null ? null : x / 100;
      return {
        nom: (p.prenom || '') + ' ' + (p.nom || '').charAt(0) + '.', poste: p.poste, famille: p.famille, multi: p.multi,
        anc: p.entree ? Math.max(0, (fin - new Date(p.entree)) / (365.25 * 864e5)) : null,
        obj: s.obj || null, ca: s.ca,
        posit: s.obj ? s.ca / (s.obj * m / 12) : null,
        restant: (s.obj && m < 12) ? Math.ceil((s.obj - (s.ca || 0)) / (12 - m)) : null,
        depistage: f(s.depistage), ndv: s.ndv, tc: f(s.tc),
        seuil: (o.tc && o.panier && s.tc != null && s.panier != null) ? (s.tc / 100 * s.panier) / (o.tc * o.panier) : null,
        sop: f(s.sop), pcPct: f(s.pcPct), pcEur: s.pcEur, pm1: s.pm1 || null, panier: s.panier, transition: f(s.transition), mdc: f(s.mdc),
      };
    });
    const autres = liste.filter(p => !actif(p)).map(p => `${p.prenom || ''} ${(p.nom || '').charAt(0)}. (${p.poste})`);
    const effOpt = liste.filter(p => p.famille !== 'audio').length, effAud = liste.filter(p => p.famille === 'audio').length;
    return {
      lignes, autres, connu: liste.length > 0, effOpt, effAud,
      effTheo: n.U != null ? Math.max(3.5, n.U / (m * 50)) : null,
      caParOpticien: (n.P != null && effOpt + effAud) ? n.P / (effOpt + effAud) / 1000 / m : null,
    };
  }

  // Challenges « Manager Leader » et « Magasin d'excellence » : statut calculé quand la donnée existe, sinon « à renseigner »
  function challenges(photo, mag, c) {
    const n = (photo.magasins[String(mag.code)] || {}).N || {}, p = (photo.magasins[String(mag.code)] || {}).N1 || {};
    const v = (ok, val) => ({ s: ok == null ? 'na' : ok ? 'ok' : 'ko', val });
    const re = n.CQ != null ? n.CQ / 100 : null, pc = x => x == null ? null : Math.round(x * 1000) / 10 + ' %';
    const visites = [n.DX || n.DW, n.DV, n.DZ].filter(x => x > 0).length;
    const perf = [[n.AF, c.o.tc], [n.AC, c.o.sop], [n.V, c.o.panier, 1], [n.AN, c.o.mdc], [n.BE, c.o.depistage]].filter(([x, o]) => x != null && o != null);
    const perfOk = perf.filter(([x, o, abs]) => (abs ? x : x / 100) >= o).length;
    const caAnnuel = n.P != null ? n.P * 12 / photo.mois : null;
    const ml = [
      ['LA PRISE DE DECISION', 'RE ≥ 20 %', v(re == null ? null : re >= 0.2, pc(re))],
      ['CONSTRUIRE EQUIPE GAGNANTE', 'Entretiens / Niveau de l’équipe ≥ 8 / Effectif', v(null)],
      ['FORMATION', '3 jours de formation par collaborateur', v(null)],
      ['L’INTELLIGENCE ORGANISATIONNELLE', 'Retour terrain AR + Siège', v(null)],
      ['GESTIONNAIRE', 'Planning / Retours / Taux d’indus', v(null, n.BV != null ? 'indus ' + pc(n.BV) : null)],
      ['LA COMPÉTENCE ÉMOTIONNELLE', 'CA fait 3 fois les 5 dernières années', v(null)],
      ['LA NÉGOCIATION GAGNANTE', 'Taux de concrétisation ≥ 95 %', v(n.AF == null ? null : n.AF >= 95, n.AF != null ? n.AF.toFixed(1) + ' %' : null)],
      ['DÉVELOPPER SA CRÉATIVITÉ', 'Évolution du CA', v(n.P == null || !p.P ? null : n.P > p.P, c.ca.evol != null ? (c.ca.evol > 0 ? '+' : '') + pc(c.ca.evol) : null)],
      ['NOTORIÉTÉ', 'Nombre d’avis Google ≥ 300', v(n.BL == null ? null : n.BL >= 300, n.BL != null ? String(n.BL) : null)],
      ['COMMUNIQUER EFFICACEMENT', 'Ophta / ORL / CE', v(n.DZ == null ? null : visites === 3, n.DZ != null ? visites + ' / 3' : null)],
    ];
    const me = [
      ['COMMERCE', 'CA ≥ 2 M€', v(caAnnuel == null ? null : caAnnuel >= 2e6, caAnnuel != null ? Math.round(caAnnuel / 1000).toLocaleString('fr-FR') + ' k€ (proj.)' : null)],
      ['LEADERSHIP', '7/10 à l’évaluation Manager Leader', v(null)],
      ['NOTORIÉTÉ', 'Note Google ≥ 4,5', v(n.BK == null || !n.BL ? null : n.BK >= 4.5, n.BL ? String(n.BK).replace('.', ',') : null)],
      ['RESSOURCES HUMAINES', 'Niveau de l’équipe ≥ 8 / Équilibre H/F / 3 jours de formation', v(null)],
      ['GESTION', 'Taux d’indus ≤ 1 %', v(n.BV == null ? null : n.BV <= 0.01, pc(n.BV))],
      ['FIDÉLISATION', '60 %', v(null)],
      ['KAIZEN', 'Audit 5S à jour', v(null)],
      ['RENTABILITÉ', 'RE ≥ 20 %', v(re == null ? null : re >= 0.2, pc(re))],
      ['PERFORMANCE', 'TC / SOP / PM / MdC / Test audio', v(perf.length < 5 ? null : perfOk === 5, perf.length ? perfOk + ' / ' + perf.length : null)],
      ['VALEUR OC', 'Dress code / Vocabulaire / Savoir-être', v(null)],
    ];
    const score = l => ({ ok: l.filter(x => x[2].s === 'ok').length, connus: l.filter(x => x[2].s !== 'na').length });
    return { ml, me, sml: score(ml), sme: score(me) };
  }

  function rendre(photo, mag, objectifs, trad, opts = {}) {
    const lang = opts.langue || LANGUES[mag.langue] || 'fr';
    const t = traducteur(trad, lang);
    const dev = DEVISES[mag.devise] || '€';
    const c = calculer(photo, mag, objectifs);
    const ch = challenges(photo, mag, c);
    const eq = equipe(photo, mag, c.o);
    const loc = lang === 'he' ? 'he-IL' : lang === 'en' ? 'en-GB' : lang === 'es' ? 'es-ES' : 'fr-FR';
    const nb = (v, d = 0) => v == null ? '–' : Number(v).toLocaleString(loc, { maximumFractionDigits: d, minimumFractionDigits: d });
    const eur = v => v == null ? '–' : nb(Math.round(v)) + ' ' + dev;
    const pc = (v, d = 1) => v == null ? '–' : nb(v * 100, d) + ' %';
    const sg = (v, f) => v == null ? '' : (v > 0 ? '+' : '') + f(v);
    const cls = v => v == null ? '' : v >= 0 ? 'ok' : 'ko';
    const fmt = (v, u) => u === 'pct' || u === 'evol' ? pc(v) : u === 'eur' ? eur(v) : u === 'jours' ? nb(v, 1) : nb(v);
    const repris = Object.entries(photo.sources || {}).filter(([, s]) => s.statut === 'repris').map(([k]) => k);
    const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, x => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[x]));
    const logo = opts.logo || 'assets/logo-optical-center.png';
    const titreMois = `${t('Statistiques A Fin')} ${t.mois(c.mois)} ${photo.annee}`;
    const nd = `<div class="nd">${esc(lang === 'fr' ? 'Non disponible pour ce magasin' : '–')}</div>`;

    const evo = (d, dp, f) => d == null && dp == null ? '' : `<span class="evo ${cls(d != null ? d : dp)}">${d == null ? '' : sg(d, f)}${dp == null ? '' : ` (${sg(dp, pc)})`} <i>N-1</i></span>`;
    const kpiRows = list => list.map(([lib, ob, re, u, perte]) => {
      const etat = (ob == null || re == null) ? (u === 'evol' ? (re == null ? '' : re >= 0 ? 'ok' : 'ko') : '') : (re >= ob ? 'ok' : 'ko');
      const ratio = (ob && re != null && u !== 'evol') ? Math.max(0, Math.min(1, re / ob)) : null;
      return `<tr><th>${esc(t(lib))}</th><td class="obj">${ob == null ? '' : fmt(ob, u === 'evol' ? 'pct' : u)}</td>`
        + `<td class="val ${etat}">${u === 'evol' ? sg(re, pc) : fmt(re, u)}</td>`
        + `<td class="jauge">${ratio == null ? '' : `<div class="j"><div class="${etat}" style="width:${(ratio * 100).toFixed(0)}%"></div></div>`}</td>`
        + `<td class="perte">${perte ? '−' + eur(perte) : ''}</td></tr>`;
    }).join('');
    const tableKpi = list => `<table class="kpi"><thead><tr><th></th><th>${esc(t('Objectifs'))}</th><th>${esc(t('Statistiques'))}</th><th></th><th>${esc(t('Perte CA'))}</th></tr></thead><tbody>${kpiRows(list)}</tbody></table>`;
    const entete = petit => `
  <header class="f-head${petit ? ' petit' : ''}">
    <img class="f-logo" src="${logo}" alt="">
    <div class="f-titre">
      <div class="f-label">${esc(titreMois)}</div>
      <h1>${esc(mag.magasin)}</h1>
      <div class="f-meta">${esc(t('Manager'))} <b>${esc(mag.manager || '–')}</b><span>·</span>${esc(t('Date d’Ouverture'))} ${esc(mag.ouverture || '–')}<span>·</span>Code ${esc(mag.code)}${mag.type === 'Franchise' ? `<span>·</span>${esc(mag.groupe)}` : ''}</div>
    </div>
    <div class="f-tag">${esc(mag.pays === 'FRANCE' ? (mag.ar || mag.pays) : mag.pays)}<small>${esc(mag.type || '')}</small></div>
  </header>`;
    const section = (titre, corps, extra = '', sous = '') => `<section class="f-sec ${extra}"><h2><span>${esc(titre)}${sous ? ` <small>${esc(sous)}</small>` : ''}</span></h2>${corps}</section>`;
    const tuile = (lib, val, cl = '', sous = '') => `<div class="tuile ${cl}"><div class="v">${val}</div><div class="l">${esc(lib)}</div>${sous ? `<div class="s">${sous}</div>` : ''}</div>`;
    const etatPct = (v, ob, inverse) => v == null || ob == null ? '' : (inverse ? v <= ob : v >= ob) ? 'ok' : 'ko';
    const repartition = () => {
      const parts = [['OPTIQUE', c.optique], ['CONTACTO', c.contacto], ['AUDIO', c.audio]];
      const tot = parts.reduce((a, [, x]) => a + (x.ca || 0), 0) || 1;
      return `<div class="barre-ca">${parts.map(([l, x], i) => `<div class="seg s${i}" style="width:${Math.max(4, 100 * (x.ca || 0) / tot)}%"></div>`).join('')}</div>
      <div class="legende-ca">${parts.map(([l, x], i) => `<div><i class="s${i}"></i><b>${esc(t(l))}</b> ${eur(x.ca)} <span class="muted">${pc(x.part, 0)}</span> ${evo(x.evol, null, pc)}</div>`).join('')}</div>`;
    };
    const challenge = (titre, gain, lignes, sc) => `
      <div class="chal">
        <div class="chal-h"><div><div class="chal-t">« ${esc(titre)} »</div><div class="chal-g">${esc(gain)}</div></div><div class="chal-sc">${sc.ok}<small>/10</small></div></div>
        <ol>${lignes.map(([l, crit, st]) => `<li class="${st.s}"><span class="ic">${st.s === 'ok' ? '✓' : st.s === 'ko' ? '✕' : '•'}</span><div><b>${esc(l)}</b><small>${esc(crit)}</small></div><em>${st.val == null ? (st.s === 'na' ? 'à renseigner' : '') : esc(st.val)}</em></li>`).join('')}</ol>
      </div>`;

    const blocEquipe = () => {
      const k = (v, ob, f, inv) => `<td class="${v == null || ob == null ? '' : (inv ? v <= ob : v >= ob) ? 'ok' : 'ko'}">${v == null ? '–' : f(v)}</td>`;
      const e0 = v => v == null ? '–' : nb(Math.round(v)), k1 = v => v == null ? '–' : nb(v / 1000, 0) + 'k';
      const ent = `<div class="eff">
        <span>${esc(t('Effectif Optique'))} <b>${eq.effOpt}</b></span><span>${esc(t('Effectif audio'))} <b>${eq.effAud}</b></span>
        <span>${esc(t('Effectif Théorique'))} <b>${eq.effTheo == null ? '–' : nb(eq.effTheo, 1)}</b></span>
        <span>${esc(t('CA (k€) / Mois /Opticiens').replace('k€', 'k' + dev))} <b>${eq.caParOpticien == null ? '–' : nb(eq.caParOpticien, 1)}</b></span></div>`;
      if (!eq.lignes.length) return ent + `<div class="nd">${eq.connu ? 'Aucune vente individuelle sur la période' : 'Export RH ou stats par vendeur non chargés'}</div>`;
      const dense = eq.lignes.length > 9 ? (eq.lignes.length > 13 ? ' tres-dense' : ' dense') : '';
      return ent + `<table class="equipe${dense}"><thead>
        <tr class="grp"><th></th><th colspan="8">${esc(t('Pilotage Ca 2026').replace('2026', photo.annee))}</th><th colspan="7">${esc(t('Analyse Du Panier Moyen Optique'))}</th></tr>
        <tr><th></th>${(lang === 'fr' ? ['Obj. ' + photo.annee, 'Cumul CA', 'Posit.', 'Reste / mois', 'NdV', 'TC', 'Seuil perf.', 'Dépist.', '% SOP', '% PC', '€ PC', 'PM 1re paire', 'Panier', 'Transit.', '% MdC']
          : [t('Objectif 2026').replace('2026', photo.annee), t('Cumul Ca'), 'Posit.', t('Ca / Mois Restant'), t('NdV'), t('Tx De C'), t('Seuil de Performance'), t('Dépistage'), t('% SOP'), '% PC', '€ PC', t('Pmoyen 1er Paire'), t('Panier Moyen'), t('Transition'), t('%MdC')]).map(x => `<th>${esc(x)}</th>`).join('')}</tr></thead><tbody>
        ${eq.lignes.map(l => `<tr class="${l.famille}"><th><b>${esc(l.nom)}</b><small>${esc(l.poste)}${l.anc != null ? ' · ' + nb(l.anc, 0) + ' an' + (l.anc >= 1.5 ? 's' : '') : ''}${l.multi ? ' · multi-sites' : ''}</small></th>
          <td class="muted">${k1(l.obj)}</td><td class="fort">${k1(l.ca)}</td>${k(l.posit, 1, x => pc(x, 0))}<td>${l.restant == null ? '–' : l.restant <= 0 ? '<span class="ok">✓</span>' : e0(l.restant)}</td><td>${e0(l.ndv)}</td>${k(l.tc, c.o.tc, x => pc(x, 1))}${k(l.seuil, 1, x => pc(x, 0))}${k(l.depistage, c.o.depistage, x => pc(x, 0))}
          ${k(l.sop, c.o.sop, x => pc(x, 0))}${k(l.pcPct, c.o.pcPct, x => pc(x, 0))}${k(l.pcEur, c.o.pcEur, e0)}${k(l.pm1, c.o.pm1, e0)}${k(l.panier, c.o.panier, e0)}${k(l.transition, c.o.transition, x => pc(x, 0))}${k(l.mdc, c.o.mdc, x => pc(x, 0))}</tr>`).join('')}
        </tbody></table>${eq.autres.length ? `<div class="autres">Sans vente sur la période : ${eq.autres.map(esc).join(' · ')}</div>` : ''}`;
    };
    const page1 = `
<div class="fiche" dir="${lang === 'he' ? 'rtl' : 'ltr'}" lang="${lang}">
  ${entete(false)}
  <div class="chiffres">
    ${tuile(t('CA GÉNÉRÉ:').replace(/:$/, ''), eur(c.ca.ca), '', evo(c.ca.evol, null, pc))}
    ${tuile(t('OBJECTIF:').replace(/:$/, ''), eur(c.ca.obj))}
    ${tuile('Positionnement', pc(c.ca.posit), 'fort ' + etatPct(c.ca.posit, 1), 'projection fin d’année')}
    ${tuile(t('CA MANQUANT'), eur(c.ca.manquant), c.ca.manquant ? 'rouge' : '', `${esc(t('Restant par mois'))} ${eur(c.ca.restant)}`)}
    ${tuile(t('Potentiel CA'), eur(c.ca.potentiel), '', `${esc(t('Positionnement potentiel'))} ${pc(c.ca.positPot)}`)}
  </div>
  ${section('Équipe', blocEquipe(), 'sec-equipe')}
  ${section('Répartition du CA', repartition())}
  ${section(t('OPTIQUE'), `
    <div class="duo">
      <div class="gros-kpi"><div class="l">${esc(t('Panier Moyen'))}</div><div class="v">${eur(c.optique.panier)}</div>${evo(c.optique.panierEvol, c.optique.panierEvolPct, eur)}</div>
      <div class="gros-kpi"><div class="l">${esc(t('Nb de Ventes'))}</div><div class="v">${nb(c.optique.ventes)}</div>${evo(c.optique.ventesEvol, c.optique.ventesEvolPct, x => nb(x))}</div>
    </div>${tableKpi(c.optique.kpis)}`)}
  ${section(t('AUDIO'), `
    <div class="duo">
      <div class="gros-kpi"><div class="l">${esc(t('Panier Moyen'))}</div><div class="v">${eur(c.audio.panier)}</div>${evo(c.audio.panierEvol, c.audio.panierEvolPct, eur)}</div>
      <div class="gros-kpi"><div class="l">${esc(t('Nb de Ventes'))}</div><div class="v">${nb(c.audio.ventes)}</div>${evo(c.audio.ventesEvol, c.audio.ventesEvolPct, x => nb(x))}</div>
    </div>${tableKpi(c.audio.kpis)}`)}
  <footer class="f-pied"><span>${esc(titreMois)} · ${esc(mag.magasin)}</span><span>1 / 2</span></footer>
</div>`;

    const page2 = `
<div class="fiche" dir="${lang === 'he' ? 'rtl' : 'ltr'}" lang="${lang}">
  ${entete(true)}
  <div class="grille3">
    ${section(t('GOOGLE'), `<div class="mini">
      <div><div class="l">${esc(t('OPTIQUE'))}</div><div class="v ${c.google.opt.note == null ? '' : c.google.opt.note >= 4.5 ? 'ok' : 'ko'}">${c.google.opt.note == null ? '–' : '★ ' + nb(c.google.opt.note, 1)}</div><div class="s">${nb(c.google.opt.nb)} ${esc(t('Nombre d’avis').toLowerCase())}${c.google.opt.manquants ? ` · ${nb(c.google.opt.manquants)} ${esc(t('Avis Manquants').toLowerCase())}` : ''}</div></div>
      <div><div class="l">${esc(t('AUDIO'))}</div><div class="v ${c.google.aud.note == null ? '' : c.google.aud.note >= 4.5 ? 'ok' : 'ko'}">${c.google.aud.note == null ? '–' : '★ ' + nb(c.google.aud.note, 1)}</div><div class="s">${nb(c.google.aud.nb)} ${esc(t('Nombre d’avis').toLowerCase())}${c.google.aud.manquants ? ` · ${nb(c.google.aud.manquants)} ${esc(t('Avis Manquants').toLowerCase())}` : ''}</div></div></div>`)}
    ${section('Visites externes', `<div class="mini trois">
      <div><div class="v">${nb(c.visites.orlGen)}</div><div class="l">ORL / Généraliste</div></div>
      <div><div class="v">${nb(c.visites.ophtaOrtho)}</div><div class="l">Ophta / Orthoptiste</div></div>
      <div><div class="v">${nb(c.visites.ce)}</div><div class="l">CE</div></div></div>`)}
    ${section(t('Mr Qualité'), `<div class="mini un"><div><div class="v">${c.mrq == null ? '–' : nb(c.mrq)}</div><div class="l">${esc(t('Passage 1'))}</div>${c.mrq == null ? '<div class="s">à renseigner</div>' : ''}</div></div>`)}
  </div>
  ${section(t('RENTABILITÉ'), `<div class="tuiles8">
    ${tuile(t('%MdC'), pc(c.renta.mdc), etatPct(c.renta.mdc, c.o.mdc))}
    ${tuile(t('% Lukkas'), pc(c.renta.lukkas))}
    ${tuile(t('% Ouiezen Premium'), pc(c.renta.ouiezen), etatPct(c.renta.ouiezen, c.o.ouiezen))}
    ${tuile(t('% Recommande Verres'), pc(c.renta.recommande))}
    ${tuile(t('Seuil de Performance'), pc(c.renta.seuil), etatPct(c.renta.seuil, 1))}
    ${tuile(t('Total des Avoirs'), eur(c.renta.avoirs))}
    ${tuile(t('Tx de Récupération'), pc(c.renta.recup))}
    ${tuile(t('Taux d’Indus'), pc(c.renta.indus, 2), etatPct(c.renta.indus, 0.01, true))}
  </div>`)}
  <div class="grille2">
    ${section(t('Marges'), Object.values(c.marges).every(x => x == null) ? nd : `<div class="mini cinq">
      ${[['Verres', c.marges.verres], ['Montures', c.marges.montures], ['Contacto', c.marges.contacto], ['Audio', c.marges.audio], ['Globale', c.marges.globale]].map(([l, x], i) => `<div class="${i === 4 ? 'fort' : ''}"><div class="v">${pc(x, 0)}</div><div class="l">${esc(t(l))}</div></div>`).join('')}</div>`, '', (photo.sources.marges && photo.sources.marges.detail || '').split(' – ')[0])}
    ${section('Confidence', `<div class="barres">${c.confidence.map(([l, ct, tot]) => `<div class="b"><span>${esc(l)}</span><div class="j"><div style="width:${tot ? Math.min(100, 100 * ct / tot).toFixed(0) : 0}%"></div></div><b>${tot ? pc(ct / tot, 0) : '–'}</b></div>`).join('')}</div>`)}
  </div>
  <div class="grille2 large-g">
    ${section('Reporting trimestriel', c.reporting.ca == null ? nd : `<div class="mini six">
      <div><div class="v">${c.reporting.ca == null ? '–' : nb(c.reporting.ca / 1000) + ' k' + dev}</div><div class="l">CA HT</div></div>
      ${c.reporting.lignes.map(([l, x, ob, k]) => `<div><div class="v ${x == null ? '' : (k === 'CS' || k === 'CQ' ? x >= ob : x <= ob) ? 'ok' : 'ko'}">${pc(x)}</div><div class="l">${esc(l)}</div><div class="s">obj. ${pc(ob, 0)}</div></div>`).join('')}</div>`, '', (photo.sources.rentabilites && photo.sources.rentabilites.detail || '').split(' – ')[0])}
    ${section(t('Renta Salariale'), `<div class="mini un"><div><div class="v ${c.rentaSal == null ? '' : c.rentaSal <= (mag.pays === 'FRANCE' ? 0.28 : 0.35) ? 'ok' : 'ko'}">${pc(c.rentaSal)}</div><div class="l">cumul de l’année</div></div></div>`)}
  </div>
  ${section('Challenges', `<div class="grille2 chals">
    ${challenge('LE MANAGER LEADER', 'Une semaine de CP pour le manager (sous réserve d’avoir été en poste les 12 mois de l’année)', ch.ml, ch.sml)}
    ${challenge('LE MAGASIN D’EXCELLENCE', '3 jours de CP pour toute l’équipe (effectif au 31 décembre, proratisé au temps de présence)', ch.me, ch.sme)}
  </div>`)}
  <footer class="f-pied"><span>Généré le ${new Date(photo.genereLe).toLocaleDateString('fr-FR')} · Objectifs : ${c.o._source}${repris.length ? ' · Reprises du mois précédent : ' + repris.map(k => esc((root.Pipeline && root.Pipeline.LIBELLE_SOURCE[k]) || k)).join(', ') : ''}</span><span>2 / 2</span></footer>
</div>`;
    return page1 + page2;
  }

  const api = { calculer, challenges, equipe, rendre, objectifsPour, LANGUES, DEVISES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Fiche = api;
})(typeof self !== 'undefined' ? self : this);
