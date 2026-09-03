import struct,collections,sys,json
d=open('game.dat','rb').read()
ents=[struct.unpack_from('<HI',d,22+i*6) for i in range(73)]
objs=ents[6:]
tab=[struct.unpack_from('<HHH',d,193276+i*6) for i in range(67)]
procs=collections.defaultdict(list); codes=collections.Counter()
VERBS={1:'LOOK',2:'USE',3:'TAKE',4:'EXAMINE',5:'USEWITH',6:'OPEN',7:'CLOSE',8:'GO'}
def sval(rec,a): return rec[a:].split(b'\0')[0].decode('latin1').replace('\n\r','|')
def decode_proc(rec,pn,a):
    if pn==20: return sval(rec,a)
    if pn in (30,31):
        obj,val,n=struct.unpack_from('<HHH',rec,a)
        sub=[]
        for k in range(n):
            spn,spd=struct.unpack_from('<HH',rec,a+6+k*4)
            sub.append((spn,decode_proc(rec,spn,a+spd)))
        return {'obj':obj,'val':val,'do':sub}
    raw=rec[a:a+8]
    return tuple(struct.unpack_from('<%dH'%(len(raw)//2),raw))
game={'objects':[]}
for i,(w,o) in enumerate(objs):
    end=objs[i+1][1] if i+1<len(objs) else len(d)
    rec=d[o:end]
    ng=struct.unpack_from('<H',rec,0)[0]
    cmdoff,x=struct.unpack_from('<II',rec,2)
    goffs=[struct.unpack_from('<I',rec,10+k*4)[0] for k in range(ng)]
    hl=10+ng*4
    names=[]
    p=hl
    while True:
        s=rec[p:].split(b'\0')[0]; p+=len(s)+1
        if s==b'': break
        names.append(s.decode('latin1'))
    gi=[struct.unpack_from('<HHHH',rec,g) if g else None for g in goffs]
    print(f"=== obj {i+1} {names[0]!r} SCR={tab[i][0]} FLG={tab[i][1]:#x} CDT={tab[i][2]} len {len(rec)} gfx(h,w,x,y)={gi} x={x}")
    ncond=struct.unpack_from('<H',rec,cmdoff)[0]
    coffs=[struct.unpack_from('<H',rec,cmdoff+2+k*2)[0] for k in range(ncond)]
    verbs=[]
    for k,co in enumerate(coffs):
        p=cmdoff+co
        cid=struct.unpack_from('<H',rec,p)[0]; l=struct.unpack_from('<I',rec,p+2)[0]; p+=6
        entries=[]
        while True:
            c=struct.unpack_from('<H',rec,p)[0]
            if c==0: p+=2; break
            off=struct.unpack_from('<I',rec,p+2)[0]; entries.append((c,off)); p+=6
        print(f"  verb {VERBS.get(cid,cid)} obj2={l}")
        dec=[]
        for c,off in entries:
            codes[c]+=1
            v=decode_proc(rec,c,off); dec.append((c,v))
            print(f"    {c:3d}: {v}")
            def coll(pn,v):
                if isinstance(v,dict):
                    for spn,sv in v['do']: coll(spn,sv)
                elif pn!=20: procs[pn].append(v)
            coll(c,v)
        verbs.append({'verb':cid,'obj2':l,'entries':dec})
    game['objects'].append({'id':i+1,'names':names,'scr':tab[i][0],'flg':tab[i][1],'cdt':tab[i][2],'gfx':gi,'verbs':verbs})
print("CODES",sorted(codes.items()))
for pn in sorted(procs): print("PROC",pn,"n=",len(procs[pn]),"samples",procs[pn][:10])
json.dump(game,open('game.json','w'),indent=1)
