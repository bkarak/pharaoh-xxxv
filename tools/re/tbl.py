import sys,struct
img=open('game.bin','rb').read()
seg=int(sys.argv[1],16); off=int(sys.argv[2],16); n=int(sys.argv[3])
b=seg*16+off
print(' '.join('%d:%04x'%(i,struct.unpack_from('<H',img,b+i*2)[0]) for i in range(n)))
