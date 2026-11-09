/* Fiche magasin : calcul des indicateurs affichés + rendu HTML A4 (langue locale ou français). */
(function (root) {
  'use strict';

  const LANGUES = { FRANCAIS: 'fr', HEBREU: 'he', ANGLAIS: 'en', ESPAGNOL: 'es', FLAMAND: 'nl', ALLEMAND: 'de' };
  const DEVISES = { 'Euro': '€', 'Shekel': '₪', 'Franc Suisse': 'CHF', 'Livre Sterling': '£', 'Dollars Canadien': '$', 'Dolard': '$' };
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
                   ['Nb de Lyleoo', o.lyleoo != null ? o.lyleoo * m : null, (n.BY != null || n.BZ != null) ? (n.BY || 0) + (n.BZ || 0) : null, 'nb'],
                 ] },
      contacto: { ca: nz(n.R), part: div(n.R, ca), evol: div(n.R, p.R) != null ? n.R / p.R - 1 : null },
      audio: { ca: nz(n.Q), part: div(n.Q, ca), evol: div(n.Q, p.Q) != null ? n.Q / p.Q - 1 : null,
               panier: nz(n.AY), panierEvol: nz(p.AY) ? n.AY - p.AY : null, panierEvolPct: div(n.AY, p.AY) != null ? n.AY / p.AY - 1 : null,
               ventes: nz(n.AW), protheses: nz(n.AX), ventesEvol: nz(p.AW) != null ? n.AW - p.AW : null, ventesEvolPct: div(n.AW, p.AW) != null ? n.AW / p.AW - 1 : null,
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
    const toutes = liste.filter(actif).map(p => {
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
        audio: s.audio ? { ventes: s.audio.ventes, protheses: s.audio.protheses, panier: s.audio.panier, pmProthese: s.audio.pmProthese || null, tc: f(s.audio.tc), reussite: f(s.audio.reussite),
          garantie: f(s.audio.garantie), ventesAdd: f(s.audio.ventesAdd), stereo: f(s.audio.stereo), duree: s.audio.duree || null, ouiezen: f(s.audio.ouiezen) } : null,
      };
    });
    const lignes = toutes.filter(l => l.famille !== 'audio'), lignesAudio = toutes.filter(l => l.famille === 'audio');
    const autres = liste.filter(p => !actif(p)).map(p => `${p.prenom || ''} ${(p.nom || '').charAt(0)}. (${p.poste})`);
    const part = p => p.part != null ? p.part : 1;
    const effOpt = liste.filter(p => p.famille !== 'audio').reduce((a, p) => a + part(p), 0), effAud = liste.filter(p => p.famille === 'audio').reduce((a, p) => a + part(p), 0);
    return {
      lignes, lignesAudio, autres, connu: liste.length > 0, effOpt, effAud,
      effTheo: n.P != null ? Math.max(3.5, n.P * 12 / m / 250000) : null,
      caParOpticien: (n.P != null && effOpt + effAud) ? n.P / (effOpt + effAud) / 1000 / m : null,
    };
  }

  // Managers Leaders et Magasins d'Excellence : règles validées le 05/11/2026 (voir regles-managers-leaders-magasins-excellence.md).
  // conf = config/challenges-AAAA.json { magasins: { code: { saisies: { formation, intelligence, planning, retours, dressCode, vocabulaire, savoirEtre }, fid, objCe } }, objectifsAtteints: { code: { 2022: 0|1, … } } }
  // ctx = { taux } (conversion du seuil de CA en devise locale). Statut : ok / ko / na (à renseigner).
  function challenges(photo, mag, c, conf, ctx = {}) {
    const code = String(mag.code), d = photo.magasins[code] || {}, n = d.N || {}, p = d.N1 || {};
    const cm = (conf && conf.magasins && conf.magasins[code]) || {}, sai = cm.saisies || {};
    const v = (ok, val) => ({ s: ok == null ? 'na' : ok ? 'ok' : 'ko', val });
    const pc = x => x == null ? null : Math.round(x * 1000) / 10 + ' %';
    const man = k => sai[k] === true; // critère manuel : « Non » tant qu'il n'est pas validé (consigne d'Olivier, 05/11)
    // Plusieurs conditions obligatoires : non atteint dès qu'une est fausse, à renseigner tant qu'une manque
    const toutes = l => l.some(x => x === false) ? false : l.every(x => x === true) ? true : null;
    const sante = (photo.sante && photo.sante.magasins && photo.sante.magasins[code]) || {}, ent = sante.entrees || {};
    const re = n.CQ != null ? n.CQ / 100 : null;
    const eqp = equipe(photo, mag, c.o);
    const ecartEff = eqp.connu && eqp.effTheo != null ? eqp.effOpt + eqp.effAud - eqp.effTheo : null;
    const entr = ent.entretiens || null, niveau = ent.equipe ? ent.equipe.niveau : null;
    const entOk = entr && entr.eligibles != null ? (entr.eligibles > 0 ? entr.vus >= entr.eligibles : null) : null;
    const indus = n.BV != null ? n.BV : null;
    // Objectif annuel atteint ≥ 3 fois sur les 5 dernières années (historique + année en cours en projection)
    const histo = (conf && conf.objectifsAtteints && conf.objectifsAtteints[code]) || null;
    const positAn = c.ca.posit;
    const anneesOk = histo ? Object.entries(histo).filter(([a, x]) => +a >= photo.annee - 4 && +a < photo.annee && +x === 1).length + (positAn != null && positAn >= 1 ? 1 : 0) : null;
    const ophta = (n.DX || 0) + (n.DW || 0), orl = (n.DV || 0) + (n.DY || 0), ce = n.DZ, objCe = cm.objCe != null ? cm.objCe : (n.EA != null ? n.EA : 50);
    const ml = [
      ['LA PRISE DE DECISION', 'RE ≥ 20 %', v(re == null ? null : re >= 0.2, pc(re))],
      ['CONSTRUIRE EQUIPE GAGNANTE', 'Effectif / 1 entretien par collaborateur et par mois / Niveau de l’équipe ≥ 8',
        v(toutes([ecartEff == null ? null : Math.abs(ecartEff) < 0.5, entOk, niveau == null ? null : niveau >= 8]),
          [ecartEff == null ? null : 'eff. ' + (ecartEff > 0 ? '+' : '') + (Math.round(ecartEff * 10) / 10), entr && entr.eligibles != null ? 'entr. ' + entr.vus + '/' + entr.eligibles : null, niveau != null ? 'niv. ' + niveau : null].filter(Boolean).join(' · ') || null)],
      ['FORMATION', '3 jours de formation par collaborateur', v(man('formation'))],
      ['L’INTELLIGENCE ORGANISATIONNELLE', 'Retour terrain AR + Siège', v(man('intelligence'))],
      ['GESTIONNAIRE', 'Planning / Retours / Taux d’indus ≤ 1 %', v(toutes([man('planning'), man('retours'), indus == null ? null : indus <= 0.01]), indus != null ? 'indus ' + pc(indus) : null)],
      ['LA COMPÉTENCE ÉMOTIONNELLE', 'Objectif annuel atteint 3 fois sur les 5 dernières années', v(anneesOk == null ? null : anneesOk >= 3, anneesOk != null ? anneesOk + ' / 5' : null)],
      ['LA NÉGOCIATION GAGNANTE', 'Taux de concrétisation ≥ 95 %', v(n.AF == null ? null : n.AF >= 95, n.AF != null ? n.AF.toFixed(1) + ' %' : null)],
      ['DÉVELOPPER SA CRÉATIVITÉ', 'Évolution du CA', v(n.P == null || !p.P ? null : n.P > p.P, c.ca.evol != null ? (c.ca.evol > 0 ? '+' : '') + pc(c.ca.evol) : null)],
      ['NOTORIÉTÉ', 'Nombre d’avis Google ≥ 300', v(n.BL == null ? null : n.BL >= 300, n.BL != null ? String(n.BL) : null)],
      ['COMMUNIQUER EFFICACEMENT', 'Ophta ≥ 10 / ORL ≥ 10 / CE ≥ objectif', v(ce == null ? null : ophta >= 10 && orl >= 10 && ce >= objCe, ce != null ? `${ophta} / ${orl} / ${ce} (obj. ${objCe})` : null)],
    ];
    const score = l => ({ ok: l.filter(x => x[2].s === 'ok').length, connus: l.filter(x => x[2].s !== 'na').length });
    const sml = score(ml);
    const devise = mag.devise || 'Euro', taux = (ctx.taux && ctx.taux[devise]) || 1, seuil = 2e6 / taux;
    const caAnnuel = n.P != null ? n.P * 12 / photo.mois : null;
    // Équilibre H/F : export RH du mois (Suivi Stats) sinon dernier import RH de bilan-passage (zimbra-relay)
    const gr = photo.mlme && photo.mlme.genre && photo.mlme.genre.magasins && photo.mlme.genre.magasins[code];
    const hf = n.XI ? n.XH / n.XI : (gr && (gr.femmes + gr.hommes) > 0 ? gr.femmes / (gr.femmes + gr.hommes) : null);
    const perf = [[n.AF, c.o.tc], [n.AC, c.o.sop], [n.V, c.o.panier, 1], [n.AN, c.o.mdc], [n.BE, c.o.depistage]].filter(([x, o]) => x != null && o != null);
    const perfOk = perf.filter(([x, o, abs]) => (abs ? x : x / 100) >= o).length;
    const kz = photo.mlme && photo.mlme.kaizen ? (photo.mlme.kaizen[code] != null ? photo.mlme.kaizen[code] : 0) : null;
    const fid = cm.fid != null ? cm.fid : null;
    const me = [
      ['COMMERCE', 'CA TTC ≥ 2 M€ (projection)', v(caAnnuel == null ? null : caAnnuel >= seuil, caAnnuel != null ? Math.round(caAnnuel / 1000).toLocaleString('fr-FR') + ' k' + (DEVISES[devise] || '€') + ' (proj.)' : null)],
      ['LEADERSHIP', '7/10 à l’évaluation Manager Leader', v(sml.ok >= 7 ? true : sml.connus === 10 ? false : null, sml.ok + ' / 10')],
      ['NOTORIÉTÉ', 'Note Google ≥ 4,5', v(n.BK == null || !n.BL ? null : n.BK >= 4.5, n.BL ? (Math.round(n.BK * 10) / 10).toString().replace('.', ',') : null)],
      ['RESSOURCES HUMAINES', 'Niveau de l’équipe ≥ 8 / Équilibre H/F / 3 jours de formation', v(toutes([niveau == null ? null : niveau >= 8, hf == null ? null : hf >= 0.4 && hf <= 0.6, man('formation')]), [niveau != null ? 'niv. ' + niveau : null, hf != null ? Math.round(hf * 100) + ' % F' : null].filter(Boolean).join(' · ') || null)],
      ['GESTION', 'Taux d’indus ≤ 1 %', v(indus == null ? null : indus <= 0.01, pc(indus))],
      ['FIDÉLISATION', '60 %', v(fid == null ? null : fid >= 0.6, fid != null ? Math.round(fid * 100) + ' %' : null)],
      ['KAIZEN', '400 points cumulés sur l’année', v(kz == null ? null : kz >= 400, kz != null ? String(Math.round(kz)) + ' pts' : null)],
      ['RENTABILITÉ', 'RE ≥ 20 %', v(re == null ? null : re >= 0.2, pc(re))],
      ['PERFORMANCE', 'TC / SOP / PM / MdC / Test audio (3 sur 5)', v(perf.length < 3 && perfOk < 3 ? null : perfOk >= 3, perf.length ? perfOk + ' / ' + perf.length : null)],
      ['VALEUR OC', 'Dress code / Vocabulaire / Savoir-être', v(toutes([man('dressCode'), man('vocabulaire'), man('savoirEtre')]))],
    ];
    // Détail des critères composés (cockpit)
    const details = {
      equipe: { effectif: ecartEff == null ? null : Math.abs(ecartEff) < 0.5, entretiens: entOk, niveau: niveau == null ? null : niveau >= 8 },
      perf: (() => { const o = c.o, r = {}; [['tc', n.AF, o.tc], ['sop', n.AC, o.sop], ['pm', n.V, o.panier, 1], ['mdc', n.AN, o.mdc], ['test', n.BE, o.depistage]]
        .forEach(([k, x, ob, abs]) => { r[k] = x == null || ob == null ? null : (abs ? x : x / 100) >= ob; }); return r; })(),
      rh: { niveau: niveau == null ? null : niveau >= 8, hf: hf == null ? null : hf >= 0.4 && hf <= 0.6, formation: man('formation') },
      gest: { planning: man('planning'), retours: man('retours'), indus: indus == null ? null : indus <= 0.01 },
    };
    return { ml, me, sml, sme: score(me), details };
  }

  function rendre(photo, mag, objectifs, trad, opts = {}) {
    const lang = opts.langue || LANGUES[mag.langue] || 'fr';
    const t = traducteur(trad, lang);
    const dev = DEVISES[mag.devise] || '€';
    const c = calculer(photo, mag, objectifs);
    const ch = challenges(photo, mag, c, opts.challenges, { taux: opts.taux });
    const eq = equipe(photo, mag, c.o);
    // Score santé : version ANNUELLE (mois validés de l'année jusqu'au mois traité) ; score du mois en secours (anciennes photos)
    const saA = photo.santeAnnuel && photo.santeAnnuel.magasins && photo.santeAnnuel.magasins[String(mag.code)];
    const santeAn = !!(saA && saA.score != null);
    const sa = santeAn ? saA : photo.sante && photo.sante.magasins && photo.sante.magasins[String(mag.code)];
    const santeOk = sa && sa.score != null;
    const santeApercu = !santeAn && photo.sante && photo.sante.apercu;
    const santeDims = (santeAn ? photo.santeAnnuel.dims : photo.sante && photo.sante.dims) || null;
    const perSante = santeAn && photo.santeAnnuel.dernierMois ? `01 → ${photo.santeAnnuel.dernierMois.slice(5)}/${photo.santeAnnuel.dernierMois.slice(0, 4)}` : '';
    const santeCl = v => v == null ? '' : v >= 75 ? 'vert' : v >= 50 ? 'orange' : 'rouge';
    const SANTE_LIB = { actions: 'Actions', effectif: 'Effectif', absenteisme: 'Absentéisme', positionnement: 'Positionnement', pedlv: 'Pedlv', avis: 'Avis', equipe: 'Équipe', kaizen: 'Kaizen', entretiens: 'Entretiens', lancements: 'Lancements' };
    const badgeSante = () => !santeOk ? '' : `<div class="sante-badge ${santeCl(sa.score)}"><div class="v">${sa.score}<small>/100</small></div><div class="l">${esc(t('Score santé'))}${santeApercu ? ' *' : ''}</div>${perSante ? `<div class="p">${perSante}</div>` : ''}${sa.precedent != null ? `<div class="e">${sa.score > sa.precedent ? '▲' : sa.score < sa.precedent ? '▼' : '='} ${sa.score - sa.precedent > 0 ? '+' : ''}${sa.score - sa.precedent} pts</div>` : ''}</div>`;
    const bil = photo.bilans && photo.bilans.magasins && photo.bilans.magasins[String(mag.code)];
    const blocBilan = () => {
      if (!bil || !bil.actions || !bil.actions.length) return '';
      const finM = (photo.bilans.fin || '');
      const dfr = d => d ? String(d).slice(0, 10).split('-').reverse().join('/') : '';
      return section('Actions du dernier bilan de passage', `<table class="bilan"><thead><tr><th>${esc(t('Action'))}</th><th>${esc(t('Responsable'))}</th><th>${esc(t('Échéance'))}</th></tr></thead><tbody>
        ${bil.actions.map((a, i) => `<tr><td><b>${i + 1}. ${esc(a.texte)}</b>${a.commentaire ? `<small>${esc(a.commentaire)}</small>` : ''}</td><td>${esc(a.qui || '–')}</td><td class="${a.echeance && finM && String(a.echeance).slice(0, 10) < finM ? 'ko' : ''}">${esc(dfr(a.echeance) || '–')}</td></tr>`).join('')}
      </tbody></table>`, '', `${t('passage du')} ${dfr(bil.date)}${bil.ar ? ' · ' + bil.ar : ''}`);
    };
    const blocSante = () => !santeOk ? '' : section(santeAn ? 'Score santé annuel' : 'Score santé', `<div class="sante-l">
      ${badgeSante()}
      <div class="sante-dims">${(santeDims || Object.keys(SANTE_LIB)).map(d => { const v = (sa.sous || {})[d], off = v == null || (sa.exclusions || {})[d] || (sa.neutralisations || {})[d];
        return `<div class="${off ? 'off' : santeCl(v)}"><div class="j"><div style="width:${off ? 0 : Math.max(2, Math.min(100, v))}%"></div></div><b>${off ? '–' : Math.round(v)}</b><span>${esc(t(SANTE_LIB[d] || d))}</span></div>`; }).join('')}</div>
    </div>${santeApercu ? '<div class="autres">* Aperçu indicatif : le mois n’était pas encore calculé dans le dashboard au moment de l’import.</div>' : ''}`, '', `${perSante ? perSante + ' · ' : ''}${t('couverture')} ${nb(sa.couverture, 0)} %`);
    const loc = lang === 'he' ? 'he-IL' : lang === 'en' ? 'en-GB' : lang === 'es' ? 'es-ES' : 'fr-FR';
    const nb = (v, d = 0) => v == null ? '–' : Number(v).toLocaleString(loc, { maximumFractionDigits: d, minimumFractionDigits: d });
    const eur = v => v == null ? '–' : nb(Math.round(v)) + ' ' + dev;
    const keur = v => v == null ? '–' : nb(Math.round(v / 1000)) + ' k' + dev; // vignettes du haut : en milliers
    const pc = (v, d = 1) => v == null ? '–' : nb(v * 100, d) + ' %';
    const sg = (v, f) => v == null ? '' : (v > 0 ? '+' : '') + f(v);
    const cls = v => v == null ? '' : v >= 0 ? 'ok' : 'ko';
    const fmt = (v, u) => u === 'pct' || u === 'evol' ? pc(v) : u === 'eur' ? eur(v) : u === 'jours' ? nb(v, 1) : nb(v);
    const repris = Object.entries(photo.sources || {}).filter(([, s]) => s.statut === 'repris').map(([k]) => k);
    const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, x => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[x]));
    const logo = opts.logo || 'assets/logo-optical-center.png';
    const titreMois = `${t('Statistiques A Fin')} ${t.mois(c.mois)} ${photo.annee}`;
    // Sources à période propre (restes dus, reporting trimestriel) : dates affichées sans texte, lisibles dans toutes les langues
    const perSrc = s => { const x = photo.sources && photo.sources[s]; if (!x) return null; if (x.periode) return x.periode;
      const m = String(x.detail || '').match(/FIN\s*(\d{4})-(\d{2})/i); return m ? { du: `${m[1]}-01-01`, au: `${m[1]}-${m[2]}-${String(new Date(+m[1], +m[2], 0).getDate()).padStart(2, '0')}` } : null; };
    const plage = p => { if (!p) return ''; const d = p.du.split('-').reverse(), a = p.au.split('-').reverse(); return `${d[0]}/${d[1]} → ${a.join('/')}`; };
    const perRestes = plage(perSrc('restes_dus')), perReporting = plage(perSrc('rentabilites')), perReco = plage(perSrc('recommande'));
    const nd = `<div class="nd">${esc(lang === 'fr' ? 'Non disponible pour ce magasin' : '–')}</div>`;

    const evo = (d, dp, f) => d == null && dp == null ? '' : `<span class="evo ${cls(d != null ? d : dp)}">${d == null ? '' : sg(d, f)}${dp == null ? '' : ` (${sg(dp, pc)})`} <i>N-1</i></span>`;
    const KPI_COUPURE = ['Taux de Concrétisation', '% TC audio'];
    const kpiRows = list => list.map(([lib, ob, re, u, perte]) => {
      const etat = (ob == null || re == null) ? (u === 'evol' ? (re == null ? '' : re >= 0 ? 'ok' : 'ko') : '') : (re >= ob ? 'ok' : 'ko');
      const ratio = (ob && re != null && u !== 'evol') ? Math.max(0, Math.min(1, re / ob)) : null;
      // 06/11/2026 : trait épais avant le taux de concrétisation (au-dessus : leviers du panier ; en dessous : nombre de ventes)
      return `<tr${KPI_COUPURE.includes(lib) ? ' class="coupure"' : ''}><th>${esc(t(lib))}</th><td class="obj">${ob == null ? '' : fmt(ob, u === 'evol' ? 'pct' : u)}</td>`
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
    ${petit ? '' : badgeSante()}
  </header>`;
    const section = (titre, corps, extra = '', sous = '') => `<section class="f-sec ${extra}"><h2><span>${esc(t(titre))}${sous ? ` <small>${esc(sous)}</small>` : ''}</span></h2>${corps}</section>`;
    const tuile = (lib, val, cl = '', sous = '') => `<div class="tuile ${cl}"><div class="v">${val}</div><div class="l">${esc(t(lib))}</div>${sous ? `<div class="s">${sous}</div>` : ''}</div>`;
    const etatPct = (v, ob, inverse) => v == null || ob == null ? '' : (inverse ? v <= ob : v >= ob) ? 'ok' : 'ko';
    const repartition = () => {
      const parts = [['OPTIQUE', c.optique], ['CONTACTO', c.contacto], ['AUDIO', c.audio]];
      const tot = parts.reduce((a, [, x]) => a + (x.ca || 0), 0) || 1;
      return `<div class="barre-ca">${parts.map(([l, x], i) => `<div class="seg s${i}" style="width:${Math.max(4, 100 * (x.ca || 0) / tot)}%"></div>`).join('')}</div>
      <div class="legende-ca">${parts.map(([l, x], i) => `<div><i class="s${i}"></i><b>${esc(t(l))}</b> ${eur(x.ca)} <span class="muted">${pc(x.part, 0)}</span> ${evo(x.evol, null, pc)}</div>`).join('')}</div>`;
    };
    const challenge = (titre, gain, lignes, sc) => `
      <div class="chal">
        <div class="chal-h"><div><div class="chal-t">« ${esc(t(titre))} »</div><div class="chal-g">${esc(t(gain))}</div></div><div class="chal-sc">${sc.ok}<small>/10</small>${sc.ok >= 7 ? `<div class="chal-q">${esc(t('Qualifié'))}</div>` : ''}</div></div>
        <ol>${lignes.map(([l, crit, st]) => `<li class="${st.s}"><span class="ic">${st.s === 'ok' ? '✓' : st.s === 'ko' ? '✕' : '•'}</span><div><b>${esc(t(l))}</b><small>${esc(t(crit))}</small></div><em>${st.val == null ? (st.s === 'na' ? esc(t('à renseigner')) : '') : esc(st.val)}</em></li>`).join('')}</ol>
      </div>`;

    const posteCourt = p => ({ 'optométriste/contactologue': 'Opto/Contacto', 'opticien/vendeur': 'Opticien', 'audioprothésiste': 'Audioprothésiste', 'technicien audio': 'Tech. audio', 'monteur': 'Monteur', 'manager': 'Manager' }[String(p || '').toLowerCase()] || p);
    const blocEquipe = () => {
      const k = (v, ob, f, inv) => `<td class="${v == null || ob == null ? '' : (inv ? v <= ob : v >= ob) ? 'ok' : 'ko'}">${v == null ? '–' : f(v)}</td>`;
      const e0 = v => v == null ? '–' : nb(Math.round(v)), k1 = v => v == null ? '–' : nb(v / 1000, 0) + 'k';
      const ent = `<div class="eff">
        <span>${esc(t('Effectif Optique'))} <b>${nb(eq.effOpt, eq.effOpt % 1 ? 1 : 0)}</b></span><span>${esc(t('Effectif audio'))} <b>${nb(eq.effAud, eq.effAud % 1 ? 1 : 0)}</b></span>
        <span>${esc(t('Effectif Théorique'))} <b>${eq.effTheo == null ? '–' : nb(eq.effTheo, 1)}</b></span>
        <span>${esc(t('CA (k€) / Mois /Opticiens').replace('k€', 'k' + dev))} <b>${eq.caParOpticien == null ? '–' : nb(eq.caParOpticien, 1)}</b></span></div>`;
      if (!eq.lignes.length && !eq.lignesAudio.length) return ent + `<div class="nd">${esc(t(eq.connu ? 'Aucune vente individuelle sur la période' : 'Export RH ou stats par vendeur non chargés'))}</div>`;
      const nl = eq.lignes.length + eq.lignesAudio.length + (eq.lignesAudio.length ? 2 : 0);
      const dense = nl > 9 ? (nl > 13 ? ' tres-dense' : ' dense') : '';
      return ent + `<table class="equipe${dense}"><thead>
        <tr class="grp"><th></th><th colspan="8">${esc(t('Pilotage Ca 2026').replace('2026', photo.annee))}</th><th colspan="7">${esc(t('Analyse Du Panier Moyen Optique'))}</th></tr>
        <tr><th></th>${(lang === 'fr' ? ['Obj. ' + photo.annee, 'Cumul CA', 'Posit.', 'Reste / mois', 'NdV', 'TC', 'Seuil perf.', 'Dépist.', '% SOP', '% PC', '€ PC', 'PM 1re paire', 'Panier', 'Transit.', '% MdC']
          : [t('Objectif 2026').replace('2026', photo.annee), t('Cumul Ca'), 'Posit.', t('Ca / Mois Restant'), t('NdV'), t('Tx De C'), t('Seuil de Performance'), t('Dépistage'), t('% SOP'), '% PC', '€ PC', t('Pmoyen 1er Paire'), t('Panier Moyen'), t('Transition'), t('%MdC')]).map(x => `<th>${esc(x)}</th>`).join('')}</tr></thead><tbody>
        ${eq.lignes.map(l => `<tr class="${l.famille}"><th><b>${esc(l.nom)}</b><small>${esc(posteCourt(l.poste))}${l.anc != null ? ' · ' + nb(l.anc, 0) + ' an' + (l.anc >= 1.5 ? 's' : '') : ''}${l.multi ? ' · multi-sites' : ''}</small></th>
          <td class="muted">${k1(l.obj)}</td><td class="fort">${k1(l.ca)}</td>${k(l.posit, 1, x => pc(x, 0))}<td>${l.restant == null ? '–' : l.restant <= 0 ? '<span class="ok">✓</span>' : e0(l.restant)}</td><td>${e0(l.ndv)}</td>${k(l.tc, c.o.tc, x => pc(x, 1))}${k(l.seuil, 1, x => pc(x, 0))}${k(l.depistage, c.o.depistage, x => pc(x, 0))}
          ${k(l.sop, c.o.sop, x => pc(x, 0))}${k(l.pcPct, c.o.pcPct, x => pc(x, 0))}${k(l.pcEur, c.o.pcEur, e0)}${k(l.pm1, c.o.pm1, e0)}${k(l.panier, c.o.panier, e0)}${k(l.transition, c.o.transition, x => pc(x, 0))}${k(l.mdc, c.o.mdc, x => pc(x, 0))}</tr>`).join('')}
        </tbody>${eq.lignesAudio.length ? `<tbody class="bloc-audio">
        <tr class="grp"><th></th><th colspan="4">${esc(t('Pilotage Ca 2026').replace('2026', photo.annee))}</th><th colspan="11">${esc(t('AUDIO'))}</th></tr>
        <tr class="tete"><th></th>${(lang === 'fr' ? ['Obj. ' + photo.annee, 'Cumul CA', 'Posit.', 'Reste / mois', 'Ventes', 'Prothèses', 'Panier', 'PM prothèse', 'TC audio', 'Réussite essai', '% Garantie', '% Ventes add.', '% Stéréo', 'Durée essai', '% Ouiezen']
          : [t('Objectif 2026').replace('2026', photo.annee), t('Cumul Ca'), 'Posit.', t('Ca / Mois Restant'), t('Nb de Ventes'), 'Prothèses', t('Panier Moyen'), t('P moyen Prothèse'), t('% TC audio'), 'Réussite essai', t('% Garantie'), t('% Ventes  Add'), t('% Stéréo'), t('Durée moyen d’essai'), t('% Ouiezen Premium')]).map(x => `<th>${esc(x)}</th>`).join('')}</tr>
        ${eq.lignesAudio.map(l => { const a = l.audio || {}; return `<tr class="audio"><th><b>${esc(l.nom)}</b><small>${esc(posteCourt(l.poste))}${l.anc != null ? ' · ' + nb(l.anc, 0) + ' an' + (l.anc >= 1.5 ? 's' : '') : ''}${l.multi ? ' · multi-sites' : ''}</small></th>
          <td class="muted">${k1(l.obj)}</td><td class="fort">${k1(l.ca)}</td>${k(l.posit, 1, x => pc(x, 0))}<td>${l.restant == null ? '–' : l.restant <= 0 ? '<span class="ok">✓</span>' : e0(l.restant)}</td>
          <td>${e0(a.ventes)}</td><td>${e0(a.protheses)}</td><td>${e0(a.panier)}</td>${k(a.pmProthese, c.o.pmProthese, e0)}${k(a.tc, c.o.tcAudio, x => pc(x, 0))}<td>${a.reussite == null ? '–' : pc(a.reussite, 0)}</td>${k(a.garantie, c.o.garantieAudio, x => pc(x, 0))}${k(a.ventesAdd, c.o.ventesAdd, x => pc(x, 0))}<td>${a.stereo == null ? '–' : pc(a.stereo, 0)}</td>${k(a.duree, c.o.dureeEssai, x => nb(x, 0) + ' j')}${k(a.ouiezen, c.o.ouiezen, x => pc(x, 0))}</tr>`; }).join('')}
        </tbody>` : ''}</table>${eq.autres.length ? `<div class="autres">Sans vente sur la période : ${eq.autres.map(x => esc(x.replace('Optométriste/Contactologue', 'Opto/Contacto').replace('Opticien/vendeur', 'Opticien'))).join(' · ')}</div>` : ''}`;
    };
    // Évolution mensuelle (historique de l'année) : CA du mois N et N-1 en barres, positionnement en courbe
    // Mois abrégés sans ambiguïté (juin / juillet)
    const COURT = { fr: ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'] };
    const moisCourt = m => COURT[lang] ? COURT[lang][m - 1] : (t.mois(m) || '').slice(0, 3);
    const courbeMois = () => {
      const s = (opts.serie || []).filter(x => x.mois <= photo.mois);
      if (s.length < 2) return '';
      const W = 714, H = 118, g = 34, d = 36, haut = 14, bas = 22, lc = (W - g - d) / s.length;
      const maxCa = Math.max(1, ...s.map(x => Math.max(x.caMois || 0, x.caMoisN1 || 0)));
      const ps = s.map(x => x.posit).filter(v => v != null), pMin = Math.min(0.6, ...ps), pMax = Math.max(1.2, ...ps);
      const yCa = v => H - bas - (v / maxCa) * (H - bas - haut), yP = v => H - bas - (v - pMin) / (pMax - pMin) * (H - bas - haut);
      const barres = s.map((x, i) => { const x0 = g + i * lc, bw = lc * 0.3;
        return (x.caMoisN1 != null ? `<rect x="${(x0 + lc / 2 - bw - 1).toFixed(1)}" y="${yCa(Math.max(0, x.caMoisN1)).toFixed(1)}" width="${bw.toFixed(1)}" height="${(H - bas - yCa(Math.max(0, x.caMoisN1))).toFixed(1)}" fill="#D9D2D1"/>` : '')
          + (x.caMois != null ? `<rect x="${(x0 + lc / 2 + 1).toFixed(1)}" y="${yCa(Math.max(0, x.caMois)).toFixed(1)}" width="${bw.toFixed(1)}" height="${(H - bas - yCa(Math.max(0, x.caMois))).toFixed(1)}" fill="#E22F2A"/>` : '')
          + `<text x="${(x0 + lc / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle" class="cm-m">${esc(moisCourt(x.mois))}</text>`; }).join('');
      const pts = s.map((x, i) => x.posit == null ? null : [g + i * lc + lc / 2, yP(x.posit), x.posit]).filter(Boolean);
      const ligne = pts.length > 1 ? `<polyline points="${pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ')}" fill="none" stroke="#231F20" stroke-width="1.6"/>` : '';
      const ptsSvg = pts.map(p => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="2.6" fill="${p[2] >= 1 ? '#1E8A52' : '#231F20'}"/><text x="${p[0].toFixed(1)}" y="${(p[1] - 5).toFixed(1)}" text-anchor="middle" class="cm-p">${nb(p[2] * 100, 0)}%</text>`).join('');
      const cent = yP(1);
      const svg = `<svg class="courbe-mois" viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="none">
        <line x1="${g}" x2="${W - d}" y1="${cent.toFixed(1)}" y2="${cent.toFixed(1)}" stroke="#1E8A52" stroke-dasharray="3 3" stroke-width="1"/><text x="${W - d + 4}" y="${(cent + 3).toFixed(1)}" class="cm-ax">100%</text>
        <text x="2" y="${haut + 4}" class="cm-ax">${nb(maxCa / 1000)}k</text>${barres}${ligne}${ptsSvg}</svg>`;
      return section('Évolution mois par mois', `${svg}<div class="cm-leg"><span><i style="background:#E22F2A"></i>${esc(t('CA du mois'))} (${esc(dev)})</span><span><i style="background:#D9D2D1"></i>N-1</span><span><i class="ligne"></i>${esc(t('Positionnement'))}</span></div>`, 'courbe');
    };
    // Écart d'effectif (réel optique + audio − théorique) : « OK » si l'écart est inférieur à 0,5 (consigne d'Olivier)
    const vignetteEffectif = () => {
      if (!eq.connu || eq.effTheo == null) return `<div><div class="v">–</div><div class="l">${esc(t('Effectif vs théorique'))}</div></div>`;
      const d = Math.round((eq.effOpt + eq.effAud - eq.effTheo) * 10) / 10;
      if (Math.abs(d) < 0.5) return `<div><div class="v ok">OK</div><div class="l">${esc(t('effectif conforme'))}</div><div class="s">${nb(eq.effOpt + eq.effAud, 1)} / ${nb(eq.effTheo, 1)}</div></div>`;
      return `<div><div class="v ko">${d > 0 ? '+' : '−'}${nb(Math.abs(d), Math.abs(d) % 1 ? 1 : 0)}</div><div class="l">${esc(t(d > 0 ? 'sur-effectif' : 'sous-effectif'))}</div><div class="s">${nb(eq.effOpt + eq.effAud, 1)} / ${nb(eq.effTheo, 1)}</div></div>`;
    };
    const page1 = `
<div class="fiche" dir="${lang === 'he' ? 'rtl' : 'ltr'}" lang="${lang}">
  ${entete(false)}
  <div class="chiffres">
    ${tuile(t('CA GÉNÉRÉ:').replace(/:$/, ''), keur(c.ca.ca), '', evo(c.ca.evol, null, pc))}
    ${tuile(t('OBJECTIF:').replace(/:$/, ''), keur(c.ca.obj))}
    ${tuile('Positionnement', pc(c.ca.posit), 'fort ' + etatPct(c.ca.posit, 1), t('projection fin d’année'))}
    ${tuile(t('CA MANQUANT'), keur(c.ca.manquant), c.ca.manquant ? 'rouge' : '', `${esc(t('Restant par mois'))} ${keur(c.ca.restant)}`)}
    ${tuile(t('Potentiel CA'), keur(c.ca.potentiel), '', `${esc(t('Positionnement potentiel'))} ${pc(c.ca.positPot)}`)}
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
      <div class="gros-kpi"><div class="l">${esc(t('Nb de Ventes'))}</div><div class="v">${nb(c.audio.ventes)}${c.audio.protheses != null ? `<small class="sous-v">${nb(c.audio.protheses)} ${lang === 'fr' ? 'prothèses' : esc(t('P moyen Prothèse').replace(/^P moyen /, ''))}</small>` : ''}</div>${evo(c.audio.ventesEvol, c.audio.ventesEvolPct, x => nb(x))}</div>
    </div>${tableKpi(c.audio.kpis)}`)}
  ${courbeMois()}
  <footer class="f-pied"><span>${esc(titreMois)} · ${esc(mag.magasin)}</span><span class="slogan">Entendre et voir UNIQUEMENT le <b>BIEN</b></span><span>1 / 2</span></footer>
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
    ${section(t('Mr Qualité'), `<div class="mini un"><div><div class="v">${c.mrq == null ? '–' : nb(c.mrq) + '<small style="font-size:9px;font-weight:600;opacity:.6">/100</small>'}</div><div class="l">${esc(t('Score global'))}</div>${c.mrq == null ? `<div class="s">${esc(t('non disponible'))}</div>` : ''}</div></div>`)}
  </div>
  ${section(t('RENTABILITÉ'), `<div class="tuiles8">
    ${tuile(t('%MdC'), pc(c.renta.mdc), etatPct(c.renta.mdc, c.o.mdc))}
    ${tuile(t('% Lukkas'), pc(c.renta.lukkas))}
    ${tuile(t('% Ouiezen Premium'), pc(c.renta.ouiezen), etatPct(c.renta.ouiezen, c.o.ouiezen))}
    ${tuile(t('% Recommande Verres'), pc(c.renta.recommande), '', perReco)}
    ${tuile(t('Seuil de Performance'), pc(c.renta.seuil), etatPct(c.renta.seuil, 1))}
    ${tuile(t('Total des Avoirs'), eur(c.renta.avoirs))}
    ${tuile(t('Tx de Récupération'), pc(c.renta.recup))}
    ${tuile(t('Taux d’Indus'), pc(c.renta.indus, 2), etatPct(c.renta.indus, 0.01, true), perRestes)}
  </div>`)}
  <div class="grille2">
    ${section(t('Marges'), Object.values(c.marges).every(x => x == null) ? nd : `<div class="mini cinq">
      ${[['Verres', c.marges.verres], ['Montures', c.marges.montures], ['Contacto', c.marges.contacto], ['Audio', c.marges.audio], ['Globale', c.marges.globale]].map(([l, x], i) => `<div class="${i === 4 ? 'fort' : ''}"><div class="v">${pc(x, 0)}</div><div class="l">${esc(t(l))}</div></div>`).join('')}</div>`, '', (photo.sources.marges && photo.sources.marges.detail || '').split(' – ')[0])}
    ${section('Confidence', `<div class="barres">${c.confidence.map(([l, ct, tot]) => `<div class="b"><span>${esc(t(l))}</span><div class="j"><div style="width:${tot ? Math.min(100, 100 * ct / tot).toFixed(0) : 0}%"></div></div><b>${tot ? pc(ct / tot, 0) : '–'}</b></div>`).join('')}</div>`)}
  </div>
  <div class="grille2 large-g renta-eff">
    ${section('Reporting trimestriel', c.reporting.ca == null ? nd : `<div class="mini six">
      <div><div class="v">${c.reporting.ca == null ? '–' : nb(c.reporting.ca / 1000) + ' k' + dev}</div><div class="l">${esc(t('CA HT'))}</div></div>
      ${c.reporting.lignes.map(([l, x, ob, k]) => `<div><div class="v ${x == null ? '' : (k === 'CS' || k === 'CQ' ? x >= ob : x <= ob) ? 'ok' : 'ko'}">${pc(x)}</div><div class="l">${esc(t(l))}</div><div class="s">${esc(t('obj.'))} ${pc(ob, 0)}</div></div>`).join('')}</div>`, '', perReporting || (photo.sources.rentabilites && photo.sources.rentabilites.detail || '').split(' – ')[0])}
    ${section(t('Renta Salariale'), `<div class="mini"><div><div class="v ${c.rentaSal == null ? '' : c.rentaSal <= (mag.pays === 'FRANCE' ? 0.28 : 0.35) ? 'ok' : 'ko'}">${pc(c.rentaSal)}</div><div class="l">${esc(t('cumul de l’année'))}</div></div>${vignetteEffectif()}</div>`)}
  </div>
  ${blocSante()}
  ${blocBilan()}
  ${section('Managers Leaders et Magasins d’Excellence', `<div class="grille2 chals">
    ${challenge('LE MANAGER LEADER', 'Une semaine de CP pour le manager (sous réserve d’avoir été en poste les 12 mois de l’année)', ch.ml, ch.sml)}
    ${challenge('LE MAGASIN D’EXCELLENCE', '3 jours de CP pour toute l’équipe (effectif au 31 décembre, proratisé au temps de présence)', ch.me, ch.sme)}
  </div>`)}
  <footer class="f-pied"><span>Généré le ${new Date(photo.genereLe).toLocaleDateString('fr-FR')} · Objectifs : ${c.o._source}${repris.length ? ' · Reprises du mois précédent : ' + repris.map(k => esc((root.Pipeline && root.Pipeline.LIBELLE_SOURCE[k]) || k)).join(', ') : ''}</span><span class="slogan">Entendre et voir UNIQUEMENT le <b>BIEN</b></span><span>2 / 2</span></footer>
</div>`;
    return page1 + page2;
  }

  const api = { calculer, challenges, equipe, rendre, objectifsPour, LANGUES, DEVISES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Fiche = api;
})(typeof self !== 'undefined' ? self : this);
