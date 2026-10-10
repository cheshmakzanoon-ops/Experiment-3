"""mergeshots.py <out> <base-dir> <overlay-dir>...: copy base, then replace shots (png + diag record) from overlays."""
import json, shutil, sys, os, glob
out, base, overlays = sys.argv[1], sys.argv[2], sys.argv[3:]
shutil.rmtree(out, ignore_errors=True); shutil.copytree(base, out)
diag = json.load(open(os.path.join(out, 'diag.json')))
for o in overlays:
    od = json.load(open(os.path.join(o, 'diag.json')))
    for rec in od['shots']:
        if rec['file'].startswith('00'): continue
        shutil.copy(os.path.join(o, rec['file']), os.path.join(out, rec['file']))
        diag['shots'] = [r for r in diag['shots'] if r['file'][:2] != rec['file'][:2]] + [rec]
        print('replaced', rec['file'], 'from', os.path.basename(o))
diag['shots'].sort(key=lambda r: r['file'])
diag['merged'] = {'base': base, 'overlays': overlays}
json.dump(diag, open(os.path.join(out, 'diag.json'), 'w'), indent=1)
