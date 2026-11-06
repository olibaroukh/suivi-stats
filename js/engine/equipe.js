// Données par personne : export RH (qui travaille où) + stats Cosium par vendeur (rattachées par matricule).
(function (root) {
  'use strict';

  // Seuls ces postes comptent dans les effectifs présents (règle d'Olivier) ; tous les autres sont ignorés
  const POSTES_RETENUS = ['audioprothesiste', 'manager', 'monteur', 'opticien/vendeur', 'optometriste/contactologue', 'technicien audio'];
  const norm = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const mat = v => { if (v == null || v === '') return null; const s = typeof v === 'number' ? String(Math.round(v)) : String(v).trim().replace(/\.0+$/, ''); return /^\d+$/.test(s) ? (s.replace(/^0+(?=\d)/, '')) : null; };
  const code = v => { const s = String(v == null ? '' : v).trim().toUpperCase(); return /^\d+A?$/.test(s) ? s.replace(/^0+(?=\d)/, '') : null; };
  const date = v => {
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (typeof v === 'number' && v > 1000) return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10); // date Excel
    const m = String(v || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
  };

  // Export RH → liste filtrée (sans date de naissance ni genre : inutiles pour la fiche)
  function rh(XLSX, wb) { return rhLignes(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: true })); }
  // Même lecture à partir de lignes déjà extraites (export déposé dans bilan-passage). Genre et date de naissance
  // ne servent qu'aux indicateurs agrégés par magasin (part de femmes, âge moyen) et ne sont pas conservés par personne.
  function rhLignes(rows) {
    const out = []; let exclus = 0;
    for (const r of rows) {
      const g = k => r[Object.keys(r).find(x => norm(x) === norm(k))];
      const m = mat(g('Matricule')), poste = String(g('Poste') || '').trim();
      if (!m || !POSTES_RETENUS.includes(norm(poste))) { exclus++; continue; }
      const codes = String(g('Codes sites') || '').split(/[,;]/).map(code).filter(Boolean);
      if (!codes.length) { exclus++; continue; }
      out.push({ matricule: m, prenom: String(g('Prénom') || '').trim(), nom: String(g('Nom') || '').trim(), poste, entree: date(g("Date d'entrée") || g('Date d’entrée')), codes,
        genre: String(g('Genre') || '').trim(), naissance: date(g('Date de naissance')) });
    }
    return { personnes: out, exclus };
  }

  // Stats Cosium par vendeur, agrégées par matricule sur tous les serveurs
  function indexVendeurs(vendeurs) {
    const idx = {};
    const get = m => idx[m] = idx[m] || { opt: [], aud: [], pos: [], pm: [], ver: [], caa: [] };
    const cible = { v_stat_optique: 'opt', v_stat_audio: 'aud', v_positionnement: 'pos', v_pm_1ere_paire: 'pm', v_carac_verres: 'ver', v_ca_audio: 'caa' };
    for (const v of vendeurs) { const k = cible[v.report]; if (!k) continue; v.rows.forEach(r => { const m = mat(r.matricule); if (m) get(m)[k].push(r); }); }
    const somme = (l, c) => l.reduce((a, r) => a + (+r[c] || 0), 0);
    const pond = (l, c, w) => { const t = somme(l, w); return t ? l.reduce((a, r) => a + (+r[c] || 0) * (+r[w] || 0), 0) / t : (l.length ? +l[0][c] || 0 : null); };
    const out = {};
    for (const m in idx) {
      const x = idx[m];
      const ndv = somme(x.opt, 'Nb Vente Opt');
      out[m] = {
        obj: x.pos.length ? somme(x.pos, 'Objectif Annuel') : null,
        ca: x.opt.length ? somme(x.opt, 'CA Généré Opt+Aud') : (x.pos.length ? somme(x.pos, 'CA Généré (Factures - Avoirs)') : null),
        ndv: x.opt.length ? ndv : null,
        panier: x.opt.length ? pond(x.opt, 'Panier Moyen', 'Nb Vente Opt') : null,
        tc: x.opt.length ? pond(x.opt, '% TC', 'Nb Vente Opt') : null,
        sop: x.opt.length ? pond(x.opt, '% Garantie', 'Nb Vente Opt') : null,
        pcPct: x.opt.length ? pond(x.opt, '% Pack Confort', 'Nb Vente Opt') : null,
        pcEur: x.opt.length ? pond(x.opt, 'PM Pack Confort', 'Nb Vente Opt') : null,
        mdc: x.opt.length ? pond(x.opt, '% Marque Exclusive', 'Nb Vente Opt') : null,
        pm1: x.pm.length ? (x.pm.map(r => +r['Prix de vente moyen']).find(v => v > 0) || null) : null,
        transition: x.ver.length ? pond(x.ver, 'TRANS+PHOTO %', 'TOTAL Qt') : null,
        // AR 3 / antireflet HG (même définition que la colonne X du magasin : verres ARRESIST UV et AR MAX BLUE UV / total verres)
        arHG: x.ver.length && somme(x.ver, 'TOTAL Qt') ? 100 * somme(x.ver, 'ARRESIST UV AND AR MAX BLUE UV Qt') / somme(x.ver, 'TOTAL Qt') : null,
        depistage: x.aud.length ? pond(x.aud, '% Test auditif', 'Nb Ventes') : null,
        ventesAudio: x.aud.length ? somme(x.aud, 'Nb Ventes') : null,
        audio: x.aud.length ? {
          ventes: somme(x.aud, 'Nb Ventes'), protheses: somme(x.aud, 'Nb prothèses vendues'),
          panier: pond(x.aud, 'Panier Moyen vente', 'Nb Ventes'), pmProthese: pond(x.aud, 'Prix moy App Auditif', 'Nb prothèses vendues'),
          tc: pond(x.aud, 'Tx de concrétisation audio', 'Nb Ventes'), reussite: pond(x.aud, 'Tx de réussite essai', 'Nb Ventes'),
          garantie: pond(x.aud, '% Assur Audio Prev 4 ans', 'Nb Ventes'), ouiezen: pond(x.aud, '% Ouiezen Premium', 'Nb Ventes'),
          stereo: pond(x.aud, '% Vente Stéréo', 'Nb Ventes'), duree: pond(x.aud, "Durée période d'essai moy", 'Nb Ventes'),
          perfectClean: somme(x.aud, 'Nb de Perfect Clean'),
          ca: x.caa.length ? somme(x.caa, 'CA Généré Audio') : null, ventesAdd: x.caa.length ? pond(x.caa, '% Vente Additionnelle', 'CA Généré Audio') : null,
        } : null,
      };
    }
    return out;
  }

  const famille = p => { const n = norm(p); return n === 'manager' ? 'manager' : (n === 'audioprothesiste' || n === 'technicien audio') ? 'audio' : 'optique'; };

  // { code magasin: [personnes avec stats] } ; les deux codes canadiens (8001 / 8001A) vont sur la même fiche
  // etp (facultatif) : { matricule: coefficient moyen depuis janvier } — journées école et temps partiels (06/11/2026)
  function parMagasin(personnes, stats, ref, etp) {
    const refIdx = {}; ref.forEach(r => refIdx[String(r.code)] = r);
    const out = {};
    for (const p of personnes) {
      const mags = [...new Set(p.codes.map(c => refIdx[c] ? c : (refIdx[c.replace(/A$/, '')] ? c.replace(/A$/, '') : null)).filter(Boolean))];
      for (const c of mags) {
        (out[c] = out[c] || []).push({ matricule: p.matricule, prenom: p.prenom, nom: p.nom, poste: p.poste, famille: famille(p.poste), entree: p.entree, multi: mags.length > 1, part: (1 / mags.length) * (etp && etp[p.matricule] != null ? etp[p.matricule] : 1), s: stats[p.matricule] || null });
      }
    }
    const rang = { manager: 0, optique: 1, audio: 2 };
    for (const c in out) out[c].sort((a, b) => rang[a.famille] - rang[b.famille] || ((b.s && b.s.ca) || 0) - ((a.s && a.s.ca) || 0));
    return out;
  }

  // Indicateurs agrégés par magasin : XG âge moyen (pondéré), XH personnes femmes, XI personnes au genre connu, XJ personnes à l'âge connu
  function demographie(personnes, ref, annee, mois) {
    const refIdx = {}; ref.forEach(r => refIdx[String(r.code)] = r);
    const fin = new Date(annee, mois, 0), out = {};
    for (const p of personnes) {
      const mags = [...new Set(p.codes.map(c => refIdx[c] ? c : (refIdx[c.replace(/A$/, '')] ? c.replace(/A$/, '') : null)).filter(Boolean))];
      const part = mags.length ? 1 / mags.length : 0;
      const g = norm(p.genre), femme = /^(f|femme|feminin|mme|madame)/.test(g), homme = /^(h|m|homme|masculin|m\.|monsieur)/.test(g) && !femme;
      let age = null; if (p.naissance) { const d = new Date(p.naissance); age = (fin - d) / (365.25 * 86400000); if (!(age > 14 && age < 80)) age = null; }
      for (const c of mags) { const o = out[c] = out[c] || { f: 0, g: 0, a: 0, na: 0 };
        if (femme || homme) { o.g += part; if (femme) o.f += part; }
        if (age != null) { o.a += age * part; o.na += part; } }
    }
    const res = {};
    for (const c in out) { const o = out[c]; res[c] = { XG: o.na ? o.a / o.na : null, XH: o.g ? o.f : null, XI: o.g || null, XJ: o.na || null }; }
    return res;
  }
  // Moyenne des coefficients ETP des mois reçus depuis janvier (fichiers donnees/rh-etp/AAAA-MM.json transmis par
  // zimbra-relay à l'import de l'agenda validés). Une personne absente d'un mois (pas encore entrée) n'y compte pas.
  function etpMoyen(depots) {
    const somme = {}, nb = {}; let mois = 0;
    for (const d of (depots || [])) {
      if (!d || !d.coefs) continue; mois++;
      for (const k in d.coefs) { const m = mat(k), v = Number(d.coefs[k]); if (!m || !Number.isFinite(v)) continue; somme[m] = (somme[m] || 0) + v; nb[m] = (nb[m] || 0) + 1; }
    }
    const coefs = {}; for (const m in somme) coefs[m] = Math.round(somme[m] / nb[m] * 1000) / 1000;
    return { coefs, mois };
  }
  const api = { rh, rhLignes, demographie, indexVendeurs, parMagasin, etpMoyen, POSTES_RETENUS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Equipe = api;
})(typeof self !== 'undefined' ? self : this);
