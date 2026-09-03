import sys,struct
lines=open('disasm.txt').read().split('\n')
seg=sys.argv[1]; lo=int(sys.argv[2],16); hi=int(sys.argv[3],16)
for l in lines:
    if l.startswith(seg+':'):
        a=int(l[5:9],16)
        if lo<=a<=hi: print(l)
