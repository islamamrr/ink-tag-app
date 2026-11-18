// Dither prototype. node proto.js in.rgb out.idx '{json opts}'
const fs=require('fs');
let W=528,H=792;
const MEAS=[[26,13,35],[185,202,205],[202,184,0],[121,9,0],[0,69,139],[40,82,57]];
const IDEAL=[[0,0,0],[255,255,255],[255,255,0],[255,0,0],[0,0,255],[0,255,0]];
const s2l=c=>{c/=255;return c<=0.04045?c/12.92:Math.pow((c+0.055)/1.055,2.4)};
const l2s=c=>{c=Math.max(0,Math.min(1,c));return 255*(c<=0.0031308?12.92*c:1.055*Math.pow(c,1/2.4)-0.055)};
function lab(r,g,b){const lr=s2l(r),lg=s2l(g),lb=s2l(b);
 const l=Math.cbrt(0.4122214708*lr+0.5363325363*lg+0.0514459929*lb),m=Math.cbrt(0.2119034982*lr+0.6806995451*lg+0.1073969566*lb),s=Math.cbrt(0.0883024619*lr+0.2817188376*lg+0.6299787005*lb);
 return [0.2104542553*l+0.793617785*m-0.0040720468*s,1.9779984951*l-2.428592205*m+0.4505937099*s,0.0259040371*l+0.7827717662*m-0.808675766*s]}
function rgb(L,a,b){let l=L+0.3963377774*a+0.2158037573*b,m=L-0.1055613458*a-0.0638541728*b,s=L-0.0894841775*a-1.291485548*b;l=l*l*l;m=m*m*m;s=s*s*s;
 return [l2s(4.0767416621*l-3.3077115913*m+0.2309699292*s),l2s(-1.2684380046*l+2.6097574011*m-0.3413193965*s),l2s(-0.0041960863*l-0.7034186147*m+1.707614701*s)]}
const K={fs:[[1,0,7],[-1,1,3],[0,1,5],[1,1,1]].map(t=>[t[0],t[1],t[2]/16]),
 atkinson:[[1,0],[2,0],[-1,1],[0,1],[1,1],[0,2]].map(t=>[t[0],t[1],1/8]),
 jjn:[[1,0,7],[2,0,5],[-2,1,3],[-1,1,5],[0,1,7],[1,1,5],[2,1,3],[-2,2,1],[-1,2,3],[0,2,5],[1,2,3],[2,2,1]].map(t=>[t[0],t[1],t[2]/48]),
 stucki:[[1,0,8],[2,0,4],[-2,1,2],[-1,1,4],[0,1,8],[1,1,4],[2,1,2],[-2,2,1],[-1,2,2],[0,2,4],[1,2,2],[2,2,1]].map(t=>[t[0],t[1],t[2]/42]),
 sierra:[[1,0,5],[2,0,3],[-2,1,2],[-1,1,4],[0,1,5],[1,1,4],[2,1,2],[-1,2,2],[0,2,3],[1,2,2]].map(t=>[t[0],t[1],t[2]/32])};
const [,,inp,outp,optj]=process.argv;const o=JSON.parse(optj||'{}');if(o.w){W=o.w;H=o.h}
const src=fs.readFileSync(inp);const N=W*H;
// --- pre-processing in Oklab
const LB=lab(...MEAS[0])[0],LW=lab(...MEAS[1])[0];
const px=new Float32Array(N*3);
for(let i=0;i<N;i++){let [L,a,b]=lab(src[i*3],src[i*3+1],src[i*3+2]);
 if(o.contrast){L=0.5+(L-0.5)*o.contrast}
 if(o.scurve){const t=Math.max(0,Math.min(1,L));const k=o.scurve;L=t+k*(t-0.5)*(1-Math.abs(2*t-1))*2*0.5;} // mild S
 if(o.sat){a*=o.sat;b*=o.sat}
 if(o.range){L=Math.max(0,Math.min(1,L));L=LB+(LW-LB)*L}
 px[i*3]=L;px[i*3+1]=a;px[i*3+2]=b;}
const palRGB=o.ideal?IDEAL:MEAS;const palLab=palRGB.map(c=>lab(...c));
const space=o.space||'srgb';
const buf=new Float32Array(N*3);
for(let i=0;i<N;i++){if(space==='oklab'){buf.set(px.subarray(i*3,i*3+3),i*3)}else{const c=rgb(px[i*3],px[i*3+1],px[i*3+2]);buf[i*3]=c[0];buf[i*3+1]=c[1];buf[i*3+2]=c[2];}}
const kern=K[o.kernel||'fs'];const es=o.err??1;const out=new Uint8Array(N);
const wL=o.wL??1, wC=o.wC??1;
function nearestLab(L,a,b){let bk=0,bd=1e9;for(let k=0;k<6;k++){const p=palLab[k];const d=wL*(L-p[0])**2+wC*((a-p[1])**2+(b-p[2])**2);if(d<bd){bd=d;bk=k}}return bk}
for(let y=0;y<H;y++){const rtl=(o.serp!==false)&&(y&1);
 for(let n=0;n<W;n++){const x=rtl?W-1-n:n;const i=y*W+x;let c0=buf[i*3],c1=buf[i*3+1],c2=buf[i*3+2];let k;
  if(space==='oklab'){c0=Math.max(0,Math.min(1,c0));c1=Math.max(-.5,Math.min(.5,c1));c2=Math.max(-.5,Math.min(.5,c2));k=nearestLab(c0,c1,c2);var e=[c0-palLab[k][0],c1-palLab[k][1],c2-palLab[k][2]];}
  else{c0=Math.max(0,Math.min(255,c0));c1=Math.max(0,Math.min(255,c1));c2=Math.max(0,Math.min(255,c2));const q=lab(c0|0,c1|0,c2|0);k=nearestLab(q[0],q[1],q[2]);var e=[c0-palRGB[k][0],c1-palRGB[k][1],c2-palRGB[k][2]];}
  out[i]=k;
  for(const [dx0,dy,wt] of kern){const dx=rtl?-dx0:dx0;const xx=x+dx,yy=y+dy;if(xx<0||xx>=W||yy>=H)continue;const j=(yy*W+xx)*3;const f=wt*es;buf[j]+=e[0]*f;buf[j+1]+=e[1]*f;buf[j+2]+=e[2]*f;}
 }}
fs.writeFileSync(outp,out);
