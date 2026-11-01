/* Moteur de lecture des exports Cosium — fonctionne dans le navigateur et sous Node.
 * Entrée : nom du fichier + texte CSV (UTF-8). Sortie : un objet normalisé.
 */
(function (root) {
  'use strict';

  // ---- Catalogue des états Cosium ------------------------------------------
  // id = clé interne ; level = magasin | vendeur ; used = utilisé dans le suivi.
  const REPORTS = [
    { id: 'stat_optique',   level: 'magasin', used: true,  re: /^Synthese_des_statistiques_de_ventes_Opt(ique)?_par_Magasin/i },
    { id: 'stat_audio',     level: 'magasin', used: true,  re: /^Synthese_des_statistiques_de_ventes_Audio_par_Magasin/i },
    { id: 'ca_audio',       level: 'magasin', used: true,  re: /^Synthese_des_CA_Audio_par_Magasin/i },
    { id: 'pm_1ere_paire',  level: 'magasin', used: true,  re: /^Statistiques_Prix_de_Vente_Moyen_1ere_Monture_par_Magasin/i },
    { id: 'carac_verres',   level: 'magasin', used: true,  re: /^Statistique_Caracteristiques_verres_par_Magasin/i },
    { id: 'lyris',          level: 'magasin', used: true,  re: /^Statistiques_Lyris_par_Magasin/i },
    { id: 'contacto',       level: 'magasin', used: true,  re: /^Statistics_Contactology_and_Visual_Aids_par_Magasin/i },
    { id: 'mdc',            level: 'magasin', used: true,  re: /^Statistiques_MDC_Optique_\+_Solaire_par_Magasin/i },
    { id: 'positionnement', level: 'magasin', used: true,  re: /^Positionnement_Annuel_par_Magasin/i },
    { id: 'accessoires_audio', level: 'magasin', used: true, re: /^Statistiques_Accessoires_Audio_par_Magasin/i },
    { id: 'v_stat_optique', level: 'vendeur', used: true,  re: /^Synthese_des_statistiques_de_ventes_Optique_par_Vendeur/i },
    { id: 'v_stat_audio',   level: 'vendeur', used: true,  re: /^Synthese_des_statistiques_de_ventes_Audio_par_Vendeur/i },
    { id: 'v_pm_1ere_paire',level: 'vendeur', used: true,  re: /^Statistique_Prix_de_Vente_Moyen_1ere_Monture_par_Vendeur/i },
    { id: 'v_carac_verres', level: 'vendeur', used: true,  re: /^Statistique_Caracteristiques_verres_par_Vendeur/i },
    { id: 'v_positionnement', level: 'vendeur', used: true, re: /^Positionnement_Annuel_par_Vendeur/i },
    // Reçus mais non utilisés aujourd'hui
    { id: 'easylens',       level: 'magasin', used: false, re: /^Statistiques_EasyLens_par_Magasin/i },
    { id: 'adaptation',     level: 'magasin', used: false, re: /^Statistiques_Adaptation_par_Magasin/i },
    { id: 'protheses',      level: 'magasin', used: false, re: /^Statistiques_Protheses_par_Magasin/i },
    { id: 'infini',         level: 'magasin', used: false, re: /^Statistiques_L'Infini_par_Magasin/i },
    { id: 'marque_monture', level: 'magasin', used: false, re: /^Statistiques_Vente_Par_marque_Monture/i },
    { id: 'marque_solaire', level: 'magasin', used: false, re: /^Statistiques_Vente_Par_marque_Solaire/i },
    { id: 'v_lyris',        level: 'vendeur', used: false, re: /^Statistiques_Lyris_par_Vendeur/i },
    { id: 'v_ca_audio',     level: 'vendeur', used: false, re: /^Synthese_des_CA_Audio_par_Vendeur/i },
  ];

  // Préfixe du nom de ZIP / objet du mail → serveur (complété au fil des lots reçus)
  const SERVER_PREFIX = { '01': 'EURO', '12': 'CANADA', '35': 'IRLANDE', '41': 'SUISSE', '44': 'UK', '59': 'MARTINIQUE', '97': 'ISRAEL' };

  // ---- Utilitaires ---------------------------------------------------------
  function baseName(path) { return String(path).split(/[\\/]/).pop(); }

  function identify(fileName) {
    const b = baseName(fileName);
    const r = REPORTS.find(x => x.re.test(b));
    const m = b.match(/du_(\d{2})_(\d{2})_(\d{4})_au_(\d{2})_(\d{2})_(\d{4})/);
    const period = m ? { from: `${m[3]}-${m[2]}-${m[1]}`, to: `${m[6]}-${m[5]}-${m[4]}`,
                         year: +m[6], month: +m[5] } : null;
    return { report: r ? r.id : null, level: r ? r.level : null, used: r ? r.used : false, period };
  }

  function serverFromZipName(zipName) {
    const m = baseName(zipName).match(/(?:^|[-_])(\d{2})OPTI\d+_(\d)(\d)_/) || baseName(zipName).match(/(\d{2})OPTI\d+/);
    if (!m) return { server: null, mail: null };
    const mail = m[2] ? +m[2] : null;
    return { server: SERVER_PREFIX[m[1]] || ('SERVEUR_' + m[1]), prefix: m[1], mail };
  }

  // Code magasin Cosium → clé référentiel : "001001" → "1001", "008001A" → "8001A"
  function normCode(v) {
    const s = String(v == null ? '' : v).trim();
    const m = s.match(/^0*(\d{3,6})([A-Za-z]?)$/);
    return m ? m[1] + m[2].toUpperCase() : null;
  }

  // Nombre : "1192759.38", "750,50", "2.3 %", "N/A", "  -  ", "1.2E8"
  function num(v) {
    if (v == null) return null;
    let s = String(v).replace(/ /g, ' ').trim();
    if (s === '' || s === '-' || /^n\/?a$/i.test(s)) return null;
    s = s.replace(/\s*%$/, '').replace(/\s/g, '');
    if (/^-?\d+,\d+$/.test(s)) s = s.replace(',', '.');
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  function splitCsv(text) {
    return text.replace(/^﻿/, '').split(/\r?\n/).map(l => l.split(';'));
  }

  // ---- Lecture d'un fichier -----------------------------------------------
  function parse(fileName, text) {
    const info = identify(fileName);
    const lines = splitCsv(text);
    const out = { file: baseName(fileName), ...info, title: (lines[1] || [''])[0], edited: (lines[0] || [''])[0].replace(/^Date Edition\s*:\s*/, ''),
                  columns: [], rows: [], skipped: [], warnings: [] };
    if (!info.report) { out.warnings.push('État inconnu'); return out; }

    // Ligne d'en-tête : celle qui contient Position / Code Magasin / Nom Vendeur…
    let h = lines.findIndex(r => r.some(c => /^(Position|Code Magasin|Nom Vendeur|Nom Magasin)$/i.test(c.trim())));
    if (h < 0) { out.warnings.push('En-tête introuvable'); return out; }
    let header = lines[h].map(c => c.trim());

    // Double en-tête (Lyris, Caractéristiques verres, Accessoires) : groupe + Qt/% ;
    // la ligne d'en-tête porte alors les totaux généraux dans les colonnes chiffrées.
    const sub = lines[h - 1] || [];
    if (sub.some(c => /^(Qt|%)$/.test(c.trim()))) {
      const grp = lines[h - 2] || [];
      let g = '';
      header = header.map((c, i) => {
        if (i < 3) return c;
        if ((grp[i] || '').trim()) g = grp[i].trim();
        const s = (sub[i] || '').trim();
        return s ? `${g} ${s === 'Qt' ? 'Qt' : '%'}` : '';
      });
      out.totalsRow = lines[h].slice(3).map(num);
    }
    out.columns = header;

    const isVendeur = info.level === 'vendeur';
    // Colonne qui porte le code magasin (Code Magasin, ou "Nom Magasin" qui contient le code)
    const codeCol = isVendeur ? -1 : header.findIndex(c => /^(Code Magasin|Nom Magasin)$/i.test(c));
    const nameCol = isVendeur ? header.findIndex(c => /^Nom (Vendeur|Magasin)$/i.test(c)) : header.findIndex(c => /^(Libelle Magasin|Nom Magasin)$/i.test(c) );
    const matCol = header.findIndex(c => /^Matricule/i.test(c));

    for (let i = h + 1; i < lines.length; i++) {
      const r = lines[i];
      if (r.length < 3 || r.every(c => !c.trim())) continue;
      const rec = {};
      if (isVendeur) {
        const name = (r[nameCol] || '').trim();
        if (!name) { out.skipped.push({ line: i + 1, raw: r.slice(0, 3).join(';'), why: 'total' }); continue; }
        rec.vendeur = name;
        const mat = (r[matCol] || '').trim();
        rec.matricule = /^\d+$/.test(mat) ? mat : null;
      } else {
        const code = normCode(r[codeCol]);
        if (!code) { out.skipped.push({ line: i + 1, raw: r.slice(0, 3).join(';'), why: (r[codeCol] || '').trim() ? 'code non standard' : 'total' }); continue; }
        rec.code = code;
        rec.libelle = (r[header.findIndex(c => /^Libelle Magasin$/i.test(c))] || '').trim();
      }
      header.forEach((c, j) => {
        if (!c || j === codeCol || j === nameCol || j === matCol || /^(Position|Libelle Magasin)$/i.test(c)) return;
        rec[c] = num(r[j]);
      });
      out.rows.push(rec);
    }
    return out;
  }

  const api = { REPORTS, SERVER_PREFIX, identify, serverFromZipName, normCode, num, parse };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Cosium = api;
})(typeof self !== 'undefined' ? self : this);
