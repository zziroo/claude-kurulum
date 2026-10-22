import json,os,glob,collections,sys
from datetime import datetime
SINCE=sys.argv[1]; MT=float(sys.argv[2]); UNTIL=sys.argv[3] if len(sys.argv)>3 else "9"
root=os.path.expanduser("~/.claude/projects")
P={"fable":(10,50,0.25),"opus":(4,20,0.20),"sonnet":(2,10,0.20),"haiku":(0.10,0.50,0.01)}
def price(model,u):
    k=next((k for k in P if k in model),None)
    if not k: return 0
    i,o,r=P[k]; cc=u.get("cache_creation",{}) or {}
    w5=cc.get("ephemeral_5m_input_tokens",u.get("cache_creation_input_tokens",0)); w1=cc.get("ephemeral_1h_input_tokens",0)
    return (u.get("input_tokens",0)*i+u.get("output_tokens",0)*o+u.get("cache_read_input_tokens",0)*r+w5*i*1.25+w1*i*2)/1e6
rows={}; seen=set()
for f in glob.glob(root+"/**/*.jsonl",recursive=True):
    if os.path.getmtime(f)<MT: continue
    agent="subagents" in f
    sid=os.path.basename(f).replace(".jsonl","") if not agent else f.split("/")[-3][:8]+" > "+os.path.basename(f)[6:14]
    r=rows.setdefault(f,dict(sid=sid,agent=agent,calls=0,peak=0,out=0,cost=0,shots=0,models=collections.Counter(),first=None,last=None,tools=collections.Counter(),proj=f.split("/")[5],title=""))
    for line in open(f):
        try: d=json.loads(line)
        except: continue
        if not r["title"] and d.get("customTitle"): r["title"]=d["customTitle"]
        ts=d.get("timestamp","")
        if ts<SINCE or ts>=UNTIL: continue
        m=d.get("message") or {}
        if d.get("type")=="assistant":
            u=m.get("usage"); mid=m.get("id")
            if not u or (mid and mid in seen): continue
            seen.add(mid)
            ctx=u.get("input_tokens",0)+u.get("cache_read_input_tokens",0)+u.get("cache_creation_input_tokens",0)
            r["calls"]+=1; r["peak"]=max(r["peak"],ctx); r["out"]+=u.get("output_tokens",0); r["cost"]+=price(m.get("model",""),u)
            r["models"][m.get("model","?").replace("claude-","")]+=1
            r["first"]=r["first"] or ts; r["last"]=ts
            for c in m.get("content",[]) if isinstance(m.get("content"),list) else []:
                if c.get("type")=="tool_use": r["tools"][c.get("name")]+=1
        elif d.get("type")=="user":
            for c in m.get("content",[]) if isinstance(m.get("content"),list) else []:
                if c.get("type")=="tool_result":
                    cc=c.get("content")
                    if isinstance(cc,list) and any(x.get("type")=="image" for x in cc): r["shots"]+=1
rows=[r for r in rows.values() if r["calls"]]; rows.sort(key=lambda r:-r["cost"])
print(f"{'tür':5} {'oturum/ajan':20} {'başlık':40} {'proje':14} {'çağrı':>5} {'zirve':>6} {'çıktı':>6} {'$':>6} {'ss':>3} saat  modeller / sık araçlar")
for r in rows:
    a=datetime.fromisoformat(r["first"].replace("Z","+00:00")); b=datetime.fromisoformat(r["last"].replace("Z","+00:00")); sure=f"{(b-a).total_seconds()/3600:.1f}"
    tools=",".join(f"{k.split('__')[-1][:14]}:{v}" for k,v in r["tools"].most_common(4))
    print(f"{'ajan' if r['agent'] else 'ana':5} {r['sid'][:20]:20} {r['title'][:40]:40} {r['proj'][27:41]:14} {r['calls']:5} {r['peak']//1000:5}k {r['out']//1000:5}k {r['cost']:6.1f} {r['shots']:3} {sure:>5} {dict(r['models'])} {tools}")
print("toplam $",round(sum(r["cost"] for r in rows)),"çağrı",sum(r["calls"] for r in rows),"ana",sum(1 for r in rows if not r["agent"]),"ajan",sum(1 for r in rows if r["agent"]))
