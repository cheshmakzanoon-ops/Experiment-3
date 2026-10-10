import json,sys
for f in sys.argv[1:]:
    d=json.load(open(f+'/diag.json'))
    print(f.split('/')[-1], ' '.join(f"{s['file'][:2]}:{s.get('frameMs',0)/1000:.1f}s/{s.get('drawCalls')}" for s in d.get('shots',[]) if s['file'][:2]!='00'))
