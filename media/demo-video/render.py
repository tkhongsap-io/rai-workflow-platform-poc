"""Render original True RAI product motion from actual localhost captures.
Dependencies: pillow numpy imageio-ffmpeg. No browser automation here.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import numpy as np, math, subprocess, wave, json
import imageio_ffmpeg
ROOT=Path(__file__).resolve().parent
W,H,FPS=1920,1080,30
FF=imageio_ffmpeg.get_ffmpeg_exe()
RED='#E00000';INK='#303C46';MUTED='#64748B'
fontpath='/System/Library/Fonts/Supplemental/Arial.ttf'
boldpath='/System/Library/Fonts/Supplemental/Arial Bold.ttf'
def font(n,b=False):return ImageFont.truetype(boldpath if b else fontpath,n)
def ease(x):x=max(0,min(1,x));return x*x*(3-2*x)
def drawtext(d,xy,t,size=30,color=INK,b=False):d.text(xy,t,font=font(size,b),fill=color,spacing=12)
# chapter, start, end, capture, headline, caption, crop
SCENES=[
 ('01 / ORGANIZE',2.4,5.3,'queue','One place.\nEvery review.','Find the case. See the next step.',(350,122,1060,548)),
 ('02 / PREPARE',5.3,8.7,'documents','Nine documents.\nOne clear pack.','Attach samples. Record what is missing.',(348,278,1060,705)),
 ('03 / REVIEW',8.7,12,'lanes','Three lanes.\nIn parallel.','AI/COE · Privacy · IT/Security',(348,158,1060,585)),
 ('04 / IMPROVE',12,15.5,'sendback','Clear feedback.\nBetter evidence.','Name the artifact. Explain the correction.',(432,216,846,550)),
 ('05 / RESUBMIT',15.5,19,'history','New version.\nHistory intact.','Resubmit without losing the record.',(348,158,1060,585)),
 ('06 / CHECK',19,21.5,'awaiting','Approved?\nNot done yet.','Open findings still need a decision.',(348,142,1060,569)),
 ('07 / RESOLVE',21.5,24.5,'disposition','Resolve every\nfinding.','Fix with evidence. Or record a reason.',(430,170,848,622)),
 ('08 / COMPLETE',24.5,28,'ready','Desk complete.\nEvidence retained.','All lanes approved. All findings disposed.',(348,180,1060,607))]
imgs={p.stem:Image.open(p).convert('RGB') for p in (ROOT/'assets').glob('*.jpg')}
# Soft neutral background, restrained red glow.
y,x=np.mgrid[0:H,0:W];g=np.exp(-(((x-1700)/900)**2+((y-900)/650)**2))
a=np.zeros((H,W,3),dtype=np.uint8)
for c,v in enumerate((249,249,252)):a[:,:,c]=np.clip(v-g*(0 if c==0 else 10),0,255)
BG=Image.fromarray(a)
mask=Image.new('L',(1220,764));ImageDraw.Draw(mask).rounded_rectangle((0,0,1219,763),26,fill=255)
shadow=Image.new('RGBA',(W,H));sd=ImageDraw.Draw(shadow);sd.rounded_rectangle((605,178,1845,960),radius=32,fill=(48,60,70,35));shadow=shadow.filter(ImageFilter.GaussianBlur(28))

def base(t):
 im=BG.copy().convert('RGBA')
 d=ImageDraw.Draw(im)
 drawtext(d,(80,47),'True',37,RED,True);drawtext(d,(162,47),'Corp',37,INK,True)
 d.line((277,48,277,86),fill='#D3D9E0',width=2)
 drawtext(d,(303,55),'RAI REVIEW DESK',22,INK,True)
 d.rounded_rectangle((1514,44,1838,89),22,fill='#FDECEC')
 drawtext(d,(1537,55),'PROTOTYPE · SYNTHETIC DATA',16,RED,True)
 d.line((80,1016,1840,1016),fill='#DDE1E7',width=2)
 d.line((80,1016,80+1760*min(t/30,1),1016),fill=RED,width=3)
 drawtext(d,(80,1034),'TRUE RAI  /  PRODUCT WALKTHROUGH',16,MUTED,True)
 drawtext(d,(1513,1034),'REVIEW DESK, NOT LAUNCH AUTHORIZATION',12,MUTED)
 return im

def scene_frame(s,t):
 chapter,start,end,name,title,sub,box=s
 u=max(0,min(1,(t-start)/(end-start)))
 im=base(t);im.alpha_composite(shadow);d=ImageDraw.Draw(im)
 lift=22*(1-ease(u/.18))
 drawtext(d,(82,216+lift),chapter,20,RED,True)
 # Short lines maintain hierarchy and legibility in social feeds.
 drawtext(d,(78,283+lift),title,55,INK,True)
 words=sub.split();lines=[];cur=''
 for w in words:
  if len(cur+' '+w)>31:lines.append(cur);cur=w
  else:cur=(cur+' '+w).strip()
 lines.append(cur)
 drawtext(d,(82,470+lift),'\n'.join(lines),27,MUTED)
 d.rounded_rectangle((82,612,165,618),3,fill=RED)
 drawtext(d,(82,659),'REAL WORKFLOW.\nHUMAN DECISIONS.',17,INK,True)
 # Camera eases in, holds, then gently pulls back near cut.
 cam=1+0.085*ease(min(u/.7,1))-0.028*ease(max(0,(u-.75)/.25))
 x0,y0,x1,y1=box;cx=(x0+x1)/2;cy=(y0+y1)/2
 bw=(x1-x0)/cam;bh=(y1-y0)/cam
 # Very small vertical drift, no sudden jumps between keyframes.
 cy+=(-5+10*ease(u)) if name not in ('sendback','disposition') else 0
 # Anchor wide app scenes to the left so zoom never trims text starts.
 if name not in ('sendback','disposition'): cx=x0+bw/2
 crop=imgs[name].crop((cx-bw/2,cy-bh/2,cx+bw/2,cy+bh/2))
 panel=Image.new('RGB',(1220,764),'#EEF0F4');pd=ImageDraw.Draw(panel)
 pd.rectangle((0,0,1220,47),fill='white');pd.line((0,46,1220,46),fill='#E2E8F0')
 for i,col in enumerate(('#E00000','#D9DFE6','#D9DFE6')):pd.ellipse((22+i*20,18,31+i*20,27),fill=col)
 pd.text((104,15),'True RAI Review Desk',font=font(17,True),fill=INK)
 fit=min(1164/crop.width,675/crop.height)
 crop=crop.resize((round(crop.width*fit),round(crop.height*fit)),Image.Resampling.LANCZOS)
 panel.paste(crop,((1220-crop.width)//2,66+(675-crop.height)//2))
 im.paste(panel,(620,174),mask)
 # Focus line confirms location without covering source text.
 d=ImageDraw.Draw(im)
 d.rounded_rectangle((620,174,1840,938),26,outline='#DDE1E7',width=2)
 return im.convert('RGB')

def bookend(t,end=False):
 im=base(t);d=ImageDraw.Draw(im)
 u=ease((t-28)/.5) if end else ease(t/.7)
 if end:
  drawtext(d,(160,270+24*(1-u)),'True RAI Review Desk',92,INK,True)
  drawtext(d,(166,412),'One pack. Three lanes. A clear decision.',43,INK)
  d.rounded_rectangle((166,548,506,613),18,fill=RED)
  drawtext(d,(195,566),'EXPLORE THE PROTOTYPE',21,'white',True)
  drawtext(d,(166,665),'Designed for responsible AI review.',29,MUTED)
 else:
  drawtext(d,(156,210+30*(1-u)),'AI reviews.',105,INK,True)
  drawtext(d,(156,334+30*(1-u)),'One clear path.',105,RED,True)
  drawtext(d,(164,503),'From document pack to completed review.',35,MUTED)
  labels=['PREPARE','REVIEW','RESOLVE']
  for i,label in enumerate(labels):
   xx=164+i*408;yy=654+20*(1-ease((t-i*.15)/.8))
   d.rounded_rectangle((xx,yy,xx+350,yy+112),20,fill='white',outline='#E2E8F0',width=2)
   drawtext(d,(xx+24,yy+25),str(i+1).zfill(2),40,RED,True);drawtext(d,(xx+103,yy+40),label,24,INK,True)
   if i<2:drawtext(d,(xx+372,yy+31),'›',36,MUTED)
 return im.convert('RGB')

def rawframe(t):
 if t<2.4:return bookend(t)
 if t>=28:return bookend(t,True)
 return scene_frame(next(s for s in SCENES if s[1]<=t<s[2]),t)

def frame(t):
 im=rawframe(t)
 # Short cross-dissolve keeps scene changes crisp, not slideshow-like.
 for boundary in [2.4,5.3,8.7,12,15.5,19,21.5,24.5,28]:
  if boundary<=t<boundary+.18:
   prev=rawframe(boundary-.001);im=Image.blend(prev,im,ease((t-boundary)/.18));break
 return im

def audio():
 sr=48000;dur=30;n=int(sr*dur);a=np.zeros(n,dtype=np.float64)
 # Original minimal tonal bed and transition ticks; no sampled music.
 for k in range(60):
  start=k*.5;length=.42;tt=np.arange(int(length*sr))/sr
  hz=[130.8128,164.8138,195.9977,261.6256][(k//4)%4]
  tone=(np.sin(2*np.pi*hz*tt)+.22*np.sin(2*np.pi*hz*2*tt))*np.exp(-tt*9)*(1-np.exp(-tt*120))*.075
  ix=int(start*sr);a[ix:ix+len(tone)]+=tone[:min(len(tone),n-ix)]
 for tm in [2.4,5.3,8.7,12,15.5,19,21.5,24.5,28]:
  tt=np.arange(int(.16*sr))/sr;tick=np.sin(2*np.pi*(680*tt+500*tt**2))*np.exp(-tt*34)*.045
  ix=int(tm*sr);a[ix:ix+len(tick)]+=tick
 env=np.minimum(np.arange(n)/sr/1.1,1)*np.minimum((dur-np.arange(n)/sr)/1.3,1)
 a=np.clip(a*env,-.9,.9);st=np.stack([a,a*.96],axis=1)
 with wave.open(str(ROOT/'sound-design.wav'),'wb') as f:f.setnchannels(2);f.setsampwidth(2);f.setframerate(sr);f.writeframes((st*32767).astype('<i2').tobytes())

if __name__=='__main__':
 import sys
 if '--preview' in sys.argv:
  sheet=Image.new('RGB',(1440,1080),'white')
  for i,t in enumerate([1.5,4,6.8,10,13.4,17,20.3,23,26.2,29]):
   im=frame(t);im.save(ROOT/('frame-%04d.jpg'%int(t*10)),quality=93)
   im.thumbnail((480,270));sheet.paste(im,((i%3)*480,(i//3)*270))
  sheet.save(ROOT/'storyboard.jpg',quality=95);frame(1.5).save(ROOT/'poster.jpg',quality=96)
 else:
  audio()
  cmd=[FF,'-y','-f','rawvideo','-vcodec','rawvideo','-pix_fmt','rgb24','-s',f'{W}x{H}','-r',str(FPS),'-i','-','-i',str(ROOT/'sound-design.wav'),'-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p','-c:a','aac','-b:a','160k','-movflags','+faststart','-t','30',str(ROOT/'true-rai-demo-30s.mp4')]
  proc=subprocess.Popen(cmd,stdin=subprocess.PIPE,stderr=open(ROOT/'render.log','w'))
  for i in range(900):
   proc.stdin.write(frame(i/FPS).tobytes())
   if i%150==0:print(f'Rendered {i}/900 frames',flush=True)
  proc.stdin.close();assert proc.wait()==0
  print('Rendered 900 frames / 30 seconds',flush=True)
