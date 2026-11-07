#!/usr/bin/env python3
"""Prépare le fichier mensuel « ocm-activite_AAAA-MM.json » pour l'import de Suivi Stats.

Source : base de l'artefact « Activité OCM » (claude.ai), lue par Claude dans une conversation avec
Artifact read_db (out_dir) — collections « releves » et « cosium », documents « analyses/transfo » et
« cockpit/potentiel ». Seules ces données chiffrées sont lues : jamais les listes de dossiers / clients.

Usage : python3 ocm_activite.py <dossier read_db> <AAAA-MM> <fichier de sortie>
"""
import json, sys, glob, os, datetime

CHAMPS_REL = ['rdv', 'jours', 'deplacements', 'ventes', 'livraisons', 'reglages', 'depistages', 'demarchages', 'annulations', 'autres']
CHAMPS_COS = ['ca', 'caN1', 'objectif', 'caAnnuel', 'caAnnuelN1', 'objectifAnnuel', 'caEncaisse', 'caAnnuelEncaisse', 'partiel', 'arrete']

def main(dossier, mois, sortie):
    annee = mois[:4]
    ocm, maj = {}, {}
    def ajoute(coll, champs):
        for f in glob.glob(os.path.join(dossier, coll, '*.json')):
            d = json.load(open(f))
            m, o = d.get('mois'), d.get('ocm')
            if not m or not o or m[:4] != annee or m > mois: continue
            x = ocm.setdefault(o, {'mois': {}})['mois'].setdefault(m, {})
            for c in champs:
                if c in d: x[c] = d[c]
            if m == mois: maj[coll] = max(maj.get(coll, ''), d.get('arrete') or d.get('maj') or '')
    ajoute('releves', CHAMPS_REL)
    ajoute('cosium', CHAMPS_COS)
    t = os.path.join(dossier, 'analyses', 'transfo.json')
    if os.path.exists(t):
        tr = json.load(open(t))
        for it in tr.get('items', []):
            m, o = it.get('mois'), it.get('ocm')
            if not m or not o or m[:4] != annee or m > mois: continue
            x = ocm.setdefault(o, {'mois': {}})['mois'].setdefault(m, {})
            x['depistInd'] = it.get('depistages', 0); x['transformes'] = it.get('transformes', 0); x['transfoEnCours'] = it.get('enCours', 0)
        maj['transfo'] = tr.get('finDonnees') or tr.get('maj')
    p = os.path.join(dossier, 'cockpit', 'potentiel.json')
    if os.path.exists(p):
        po = json.load(open(p))
        for o, v in (po.get('parOcm') or {}).items():
            ocm.setdefault(o, {'mois': {}})['potentiel'] = v
        maj['potentiel'] = po.get('facturationArrete') or po.get('maj')
    out = {'type': 'ocm-activite', 'version': 1, 'mois': mois, 'genereLe': datetime.date.today().isoformat(),
           'source': 'Artefact « Activité OCM »', 'arretes': maj, 'ocm': ocm}
    json.dump(out, open(sortie, 'w'), ensure_ascii=False, indent=1)
    act = [o for o, v in ocm.items() if (v['mois'].get(mois) or {}).get('rdv')]
    print(f"{sortie} : {len(ocm)} OCM, {len(act)} actifs en {mois} ; arrêtés : {maj}")

if __name__ == '__main__':
    main(*sys.argv[1:4])
