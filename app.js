
// ═══════════════════════════════════════════════════════════
// §1  FFT  (Cooley-Tukey, in-place, sign=-1 for forward)
// ═══════════════════════════════════════════════════════════
function fftCore(re, im, inv) {
  const N = re.length;
  for (let i=0,j=0; i<N; i++) {
    if (i<j){ let t=re[i];re[i]=re[j];re[j]=t; t=im[i];im[i]=im[j];im[j]=t; }
    let bit=N>>1; for(;j&bit;bit>>=1)j^=bit; j^=bit;
  }
  for (let len=2; len<=N; len<<=1) {
    const ang=(inv?2:-2)*Math.PI/len, wR=Math.cos(ang), wI=Math.sin(ang);
    for (let i=0; i<N; i+=len) {
      let cR=1,cI=0;
      for (let k=0; k<(len>>1); k++) {
        const uR=re[i+k],uI=im[i+k];
        const vR=re[i+k+(len>>1)]*cR-im[i+k+(len>>1)]*cI;
        const vI=re[i+k+(len>>1)]*cI+im[i+k+(len>>1)]*cR;
        re[i+k]=uR+vR; im[i+k]=uI+vI;
        re[i+k+(len>>1)]=uR-vR; im[i+k+(len>>1)]=uI-vI;
        const nR=cR*wR-cI*wI; cI=cR*wI+cI*wR; cR=nR;
      }
    }
  }
  if (inv) { for(let i=0;i<N;i++){re[i]/=N;im[i]/=N;} }
}
const pow2 = n => 1<<Math.ceil(Math.log2(Math.max(n,2)));

// ═══════════════════════════════════════════════════════════
// §2  4×4 MATRIX UTILITIES  (row-major flat Float64Array)
// ═══════════════════════════════════════════════════════════
const M4 = {
  zero: ()=>new Float64Array(16),
  eye:  ()=>{ const m=new Float64Array(16); m[0]=m[5]=m[10]=m[15]=1; return m; },
  add:  (A,B)=>{ const C=new Float64Array(16); for(let i=0;i<16;i++)C[i]=A[i]+B[i]; return C; },
  // C = A*B
  mul:  (A,B)=>{ const C=new Float64Array(16);
    for(let i=0;i<4;i++) for(let j=0;j<4;j++) for(let k=0;k<4;k++) C[i*4+j]+=A[i*4+k]*B[k*4+j];
    return C; },
  // C = A*B^T
  mulT: (A,B)=>{ const C=new Float64Array(16);
    for(let i=0;i<4;i++) for(let j=0;j<4;j++) for(let k=0;k<4;k++) C[i*4+j]+=A[i*4+k]*B[j*4+k];
    return C; },
  // v = A*u  (4×1)
  mv:   (A,u)=>{ const v=new Float64Array(4);
    for(let i=0;i<4;i++) for(let j=0;j<4;j++) v[i]+=A[i*4+j]*u[j]; return v; },
  // in-place symmetrize
  sym:  (A)=>{ for(let i=0;i<4;i++) for(let j=0;j<i;j++){
      const a=(A[i*4+j]+A[j*4+i])*.5; A[i*4+j]=a; A[j*4+i]=a; } return A; },
};

// H = [0,0,-1,1]  fast specializations
const Hv    = v => -v[2]+v[3];                       // H·v  (scalar)
const PHT   = P => new Float64Array(              // P·H^T  (4×1)
  [-P[2]+P[3], -P[6]+P[7], -P[10]+P[11], -P[14]+P[15]]);
const HPHT  = P => P[10]-P[11]-P[14]+P[15];          // H·P·H^T  (scalar)
const IKH   = K => { const M=M4.eye();               // I - K·H  (4×4)
  for(let i=0;i<4;i++){M[i*4+2]+=K[i]; M[i*4+3]-=K[i];} return M; };
const resetP = P => {                                  // zero rows/cols 2,3
  for(let i=0;i<4;i++){P[2*4+i]=P[3*4+i]=P[i*4+2]=P[i*4+3]=0;} };

// ═══════════════════════════════════════════════════════════
// §3  NATURAL CUBIC SPLINE
// ═══════════════════════════════════════════════════════════
function makeSpline(xs, ys) {
  const n=xs.length, h=[],al=[],l=[1],mu=[0],z=[0];
  for(let i=0;i<n-1;i++) h[i]=xs[i+1]-xs[i];
  for(let i=1;i<n-1;i++) al[i]=3*((ys[i+1]-ys[i])/h[i]-(ys[i]-ys[i-1])/h[i-1]);
  for(let i=1;i<n-1;i++){
    l[i]=2*(xs[i+1]-xs[i-1])-h[i-1]*mu[i-1];
    mu[i]=h[i]/l[i]; z[i]=(al[i]-h[i-1]*z[i-1])/l[i];
  }
  l[n-1]=1; z[n-1]=0;
  const c=new Array(n).fill(0),b=[],d=[];
  for(let j=n-2;j>=0;j--){
    c[j]=z[j]-mu[j]*c[j+1];
    b[j]=(ys[j+1]-ys[j])/h[j]-h[j]*(c[j+1]+2*c[j])/3;
    d[j]=(c[j+1]-c[j])/(3*h[j]);
  }
  return x => {
    if(x<=xs[0]){ const dx=x-xs[0]; return ys[0]+b[0]*dx+c[0]*dx*dx+d[0]*dx*dx*dx; }
    if(x>=xs[n-1]){ const j=n-2,dx=x-xs[j]; return ys[j]+b[j]*dx+c[j]*dx*dx+d[j]*dx*dx*dx; }
    let lo=0,hi=n-2;
    while(lo<hi){ const m=(lo+hi)>>1; xs[m+1]<x?lo=m+1:hi=m; }
    const dx=x-xs[lo];
    return ys[lo]+b[lo]*dx+c[lo]*dx*dx+d[lo]*dx*dx*dx;
  };
}

// ═══════════════════════════════════════════════════════════
// §4  MORLET CWT → GLOBAL WAVELET SPECTRUM
// ═══════════════════════════════════════════════════════════
function morletGWS(signal, dt) {
  const omega0=6, N=signal.length, Np=pow2(N);
  const sRe=new Float64Array(Np), sIm=new Float64Array(Np);
  for(let i=0;i<N;i++) sRe[i]=signal[i];
  fftCore(sRe, sIm, false);

  // Angular frequencies (one-sided Morlet: positive ω only)
  const om=new Float64Array(Np);
  for(let k=1;k<=Np/2;k++) om[k]=2*Math.PI*k/(Np*dt);

  const fourierFactor=(4*Math.PI)/(omega0+Math.sqrt(2+omega0*omega0));
  const dj=0.25, s0=2*dt;
  const J=Math.floor(Math.log2(N*dt/s0)/dj);
  const scales=Array.from({length:J+1},(_,j)=>s0*Math.pow(2,j*dj));
  const freqs=scales.map(s=>1/(fourierFactor*s));

  const gws=new Float64Array(scales.length);
  const wR=new Float64Array(Np), wI=new Float64Array(Np);

  for(let si=0;si<scales.length;si++){
    const s=scales[si];
    const norm=Math.sqrt(2*Math.PI*s/dt)*Math.pow(Math.PI,-0.25);
    wR.fill(0); wI.fill(0);
    for(let k=1;k<Np;k++) if(om[k]>0){
      const arg=-0.5*(s*om[k]-omega0)*(s*om[k]-omega0);
      const psi=norm*Math.exp(arg);
      wR[k]=sRe[k]*psi; wI[k]=sIm[k]*psi;
    }
    fftCore(wR, wI, true);
    let p=0; for(let t=0;t<N;t++) p+=wR[t]*wR[t]+wI[t]*wI[t];
    gws[si]=p/N;
  }
  return { gws, freqs };
}

// ═══════════════════════════════════════════════════════════
// §4b  MORLET CWT — FULL TIME-FREQUENCY SCALOGRAM
//      Returns power[si][t] (Float32Array per scale row)
// ═══════════════════════════════════════════════════════════
function morletCWTScalogram(signal, dt) {
  const omega0=6, N=signal.length, Np=pow2(N);
  const sRe=new Float64Array(Np), sIm=new Float64Array(Np);
  for(let i=0;i<N;i++) sRe[i]=signal[i];
  fftCore(sRe,sIm,false);
  const om=new Float64Array(Np);
  for(let k=1;k<=Np/2;k++) om[k]=2*Math.PI*k/(Np*dt);
  const fourierFactor=(4*Math.PI)/(omega0+Math.sqrt(2+omega0*omega0));
  const dj=0.25, s0=2*dt;
  const J=Math.floor(Math.log2(N*dt/s0)/dj);
  const scales=Array.from({length:J+1},(_,j)=>s0*Math.pow(2,j*dj));
  const freqs=scales.map(s=>1/(fourierFactor*s));
  const wR=new Float64Array(Np), wI=new Float64Array(Np);
  const power=[];
  for(let si=0;si<scales.length;si++){
    const s=scales[si];
    const norm=Math.sqrt(2*Math.PI*s/dt)*Math.pow(Math.PI,-0.25);
    wR.fill(0); wI.fill(0);
    for(let k=1;k<Np;k++) if(om[k]>0){
      const arg=-0.5*(s*om[k]-omega0)*(s*om[k]-omega0);
      const psi=norm*Math.exp(arg);
      wR[k]=sRe[k]*psi; wI[k]=sIm[k]*psi;
    }
    fftCore(wR,wI,true);
    const row=new Float32Array(N);
    for(let t=0;t<N;t++) row[t]=wR[t]*wR[t]+wI[t]*wI[t];
    power.push(row);
  }
  return {power, freqs, scales, N};
}

// Inferno perceptual colormap — 256-entry RGB LUT
const _INFERNO_LUT=(()=>{
  const stops=[
    {t:0.00,r:0,  g:0,  b:4  },{t:0.13,r:40, g:11, b:84 },
    {t:0.25,r:101,g:21, b:110},{t:0.38,r:159,g:42, b:99 },
    {t:0.50,r:212,g:72, b:66 },{t:0.63,r:245,g:125,b:21 },
    {t:0.75,r:250,g:186,b:47 },{t:0.88,r:252,g:235,b:109},
    {t:1.00,r:252,g:255,b:164}
  ];
  return Array.from({length:256},(_,i)=>{
    const t=i/255;
    let lo=stops[0],hi=stops[stops.length-1];
    for(let k=0;k<stops.length-1;k++)
      if(t>=stops[k].t&&t<=stops[k+1].t){lo=stops[k];hi=stops[k+1];break;}
    const u=(hi.t-lo.t<1e-9)?0:(t-lo.t)/(hi.t-lo.t);
    return[Math.round(lo.r+u*(hi.r-lo.r)),Math.round(lo.g+u*(hi.g-lo.g)),Math.round(lo.b+u*(hi.b-lo.b))];
  });
})();

// ═══════════════════════════════════════════════════════════
// §5  SPECTRAL PRIORS  (CWT → ks_mode, kp_mode, energy_ratio)
// ═══════════════════════════════════════════════════════════
function extractSpectralPriors(dy) {
  const fs=4, dt=1/fs;
  let t=0; const tCum=dy.map(d=>(t+=d));
  const hrHz=dy.map(d=>1/d);
  const meanHr=hrHz.reduce((a,b)=>a+b,0)/hrHz.length;
  const sp=makeSpline(tCum, hrHz);
  const tMin=tCum[0], tMax=tCum[tCum.length-1];
  const Ng=Math.floor((tMax-tMin)*fs)+1;
  const hrC=Array.from({length:Ng},(_,i)=>sp(tMin+i*dt)-meanHr);

  const {gws, freqs}=morletGWS(hrC, dt);
  const M=freqs.length;
  const df=new Float64Array(M);
  for(let i=0;i<M-1;i++) df[i]=Math.abs(freqs[i]-freqs[i+1]);
  df[M-1]=df[M-2]||0.001;

  const lf=[], hf=[];
  for(let i=0;i<M;i++){
    if(freqs[i]>=0.04&&freqs[i]<0.15) lf.push(i);
    if(freqs[i]>=0.15&&freqs[i]<=0.40) hf.push(i);
  }
  const pLF=lf.reduce((s,i)=>s+gws[i]*df[i],0)||1e-10;
  const pHF=hf.reduce((s,i)=>s+gws[i]*df[i],0)||1e-10;
  const fcLF=lf.reduce((s,i)=>s+freqs[i]*gws[i]*df[i],0)/pLF;
  const fcHF=hf.reduce((s,i)=>s+freqs[i]*gws[i]*df[i],0)/pHF;
  let bwLF=Math.sqrt(lf.reduce((s,i)=>s+(freqs[i]-fcLF)**2*gws[i]*df[i],0)/pLF);
  let bwHF=Math.sqrt(hf.reduce((s,i)=>s+(freqs[i]-fcHF)**2*gws[i]*df[i],0)/pHF);
  let ksM=2*Math.PI*bwLF, kpM=2*Math.PI*bwHF;
  if(!isFinite(ksM)||ksM<0.01) ksM=0.10;
  if(!isFinite(kpM)||kpM<0.01) kpM=1.25;
  return { nu0Init:meanHr, energyRatio:pHF/pLF, ksMode:ksM, kpMode:kpM };
}

// ═══════════════════════════════════════════════════════════
// §6  OU BLOCK  (exact transition moments with Taylor fallback)
// ═══════════════════════════════════════════════════════════
function ouBlock(k, dt, V) {
  const x=k*dt, s2=2*k*V;
  let phiInt, q11, q13, q33;
  if(x<1e-3){
    const d2=dt*dt,d3=d2*dt,d4=d3*dt,d5=d4*dt;
    phiInt=dt-k*d2/2+k*k*d3/6;
    q11=s2*(dt-k*d2+2*k*k*d3/3);
    q13=s2*(d2/2-k*d3/2+7*k*k*d4/24);
    q33=s2*(d3/3-k*d4/4+7*k*k*d5/60);
  } else {
    const e1=Math.exp(-x), e2=Math.exp(-2*x);
    phiInt=(1-e1)/k;
    q11=s2*(1-e2)/(2*k);
    q13=s2*(1-2*e1+e2)/(2*k*k);
    q33=s2*(2*x-3+4*e1-e2)/(2*k*k*k);
  }
  return {phiInt,q11,q13,q33};
}

// ═══════════════════════════════════════════════════════════
// §7  DUAL-FILTER GLS KALMAN  (causal forward pass)
// ═══════════════════════════════════════════════════════════
function runGLSFilter(dy, kp, ks, lp, lR, jThr, jPow) {
  const N=dy.length;

  // Jump gate
  const gate=new Float64Array(N);
  for(let k=0;k<N;k++){
    const bk=k>0   ? Math.abs(dy[k]-dy[k-1])/Math.max(dy[k-1],1e-6) : 0;
    const fw=k<N-1 ? Math.abs(dy[k+1]-dy[k])/Math.max(dy[k],1e-6)   : 0;
    let g=1+Math.pow(Math.max(bk,fw)/jThr,jPow);
    if(!isFinite(g))g=1e10; gate[k]=Math.min(g,1e10);
  }

  // State: [X_p, X_s, Phase_p, Phase_s]
  let X0=new Float64Array(4), Xv=new Float64Array(4);
  let P=M4.eye(); P[10]=P[15]=0; // diag(1,1,0,0)

  const Sv=new Float64Array(N), v0v=new Float64Array(N), vvv=new Float64Array(N);
  const Sung=new Float64Array(N);
  const X0s=new Float64Array(N*4), Xvs=new Float64Array(N*4), Ps=new Float64Array(N*16);

  const Phi=M4.zero(), Q=M4.zero();

  for(let k=0;k<N;k++){
    const dt=dy[k], dynLR=Math.min(lR*gate[k],1e12);
    const bp=ouBlock(kp,dt,lp), bs=ouBlock(ks,dt,1.0);

    // Phi
    Phi.fill(0);
    Phi[0]=Math.exp(-kp*dt); Phi[8]=bp.phiInt;  // [0,0] [2,0]
    Phi[5]=Math.exp(-ks*dt); Phi[13]=bs.phiInt; // [1,1] [3,1]

    // Q
    Q.fill(0);
    Q[0]=bp.q11; Q[2]=bp.q13; Q[8]=bp.q13; Q[10]=bp.q33;
    Q[5]=bs.q11; Q[7]=bs.q13; Q[13]=bs.q13; Q[15]=bs.q33;

    // Predict
    const X0p=M4.mv(Phi,X0), Xvp=M4.mv(Phi,Xv);
    const Pp=M4.add(M4.mulT(M4.mul(Phi,P),Phi), Q);

    // Innovation variance + Kalman gain
    const S=Math.max(HPHT(Pp)+dynLR*dt, 1e-12);
    Sung[k]=Math.max(HPHT(Pp)+lR*dt, 1e-12);
    const K=PHT(Pp).map(v=>v/S);

    // Innovations
    const v0=1.0-Hv(X0p), vv=dt-Hv(Xvp);

    // Update states
    const X0u=X0p.map((v,i)=>v+K[i]*v0);
    const Xvu=Xvp.map((v,i)=>v+K[i]*vv);

    // Joseph-form covariance update
    const ikH=IKH(K);
    const KKT=new Float64Array(16);
    for(let i=0;i<4;i++) for(let j=0;j<4;j++) KKT[i*4+j]=K[i]*K[j]*dynLR*dt;
    const Pu=M4.sym(M4.add(M4.mulT(M4.mul(ikH,Pp),ikH),KKT));

    // Store pre-reset
    X0s.set(X0u,k*4); Xvs.set(Xvu,k*4); Ps.set(Pu,k*16);

    // Phase reset
    X0=new Float64Array(X0u); X0[2]=X0[3]=0;
    Xv=new Float64Array(Xvu); Xv[2]=Xv[3]=0;
    P=new Float64Array(Pu); resetP(P);

    Sv[k]=S; v0v[k]=v0; vvv[k]=vv;
  }

  // GLS marginalization of ν₀
  let denN=0,numN=0;
  for(let k=0;k<N;k++) if(isFinite(vvv[k])&&Sv[k]>0){
    denN+=vvv[k]*vvv[k]/Sv[k]; numN+=v0v[k]*vvv[k]/Sv[k];
  }
  const nu0=denN>1e-12?numN/denN:1.0;

  // Combined innovations + global variance
  const vF=new Float64Array(N);
  let sv2s=0;
  for(let k=0;k<N;k++){
    vF[k]=v0v[k]-nu0*vvv[k];
    if(isFinite(vF[k])) sv2s+=vF[k]*vF[k]/Sv[k];
  }
  const sig2=Math.max(sv2s/N,1e-12);

  // Profile log-likelihood
  let LL=0;
  for(let k=0;k<N;k++) if(isFinite(Sv[k])) LL-=0.5*Math.log(Sv[k]);
  LL-=(N/2)*Math.log(sig2);

  // Final states: X0 - ν₀·Xv
  const stF=new Float64Array(N*4);
  for(let i=0;i<N*4;i++) stF[i]=X0s[i]-nu0*Xvs[i];

  // State variances (scaled by sig2)
  const XpV=new Float64Array(N), XsV=new Float64Array(N), rrV=new Float64Array(N);
  for(let k=0;k<N;k++){
    XpV[k]=Ps[k*16+0]*sig2;
    XsV[k]=Ps[k*16+5]*sig2;
    rrV[k]=(Ps[k*16+10]+Ps[k*16+15]-2*Ps[k*16+11])*sig2/(nu0*nu0);
  }

  // Standardized innovations + implied RR
  const zD=new Float64Array(N);
  const irr=new Float64Array(N);
  for(let k=0;k<N;k++){
    zD[k]=vF[k]/Math.sqrt(Sung[k]*sig2);
    irr[k]=(1+stF[k*4+2]-stF[k*4+3])/nu0;
  }

  return {
    LL_star:LL, nu0, sig2,
    Xp:  Array.from({length:N},(_,k)=>stF[k*4+0]),
    Xs:  Array.from({length:N},(_,k)=>stF[k*4+1]),
    XpV, XsV, rrV, irr, gate,
    innovations: Array.from(zD)
  };
}

// ═══════════════════════════════════════════════════════════
// §8  MAP OBJECTIVE  (returns value to minimise)
// ═══════════════════════════════════════════════════════════
function mapObj(theta, dy, pr, jThr, jPow) {
  const ks=Math.exp(theta[0]), kp=ks+Math.exp(theta[1]), lR=Math.exp(theta[2]);
  const Vp=pr.energyRatio;
  try {
    const res=runGLSFilter(dy,kp,ks,Vp,lR,jThr,jPow);
    const penKs= 3.0*Math.log(ks)-(3.0/pr.ksMode)*ks;
    const penKp= 5.0*Math.log(kp)-(5.0/pr.kpMode)*kp;
    const penLR= -3.0*Math.log(lR)-(0.0005*3.0)/lR;
    const U=(kp-ks)/(kp+ks), OU=2*ks/(kp+ks);
    if(U<=0||OU<=0) return 1e15;
    const penTop= 10/11*11*Math.log(U) + 1/11*11*Math.log(OU);
    const v=-(res.LL_star+penKs+penKp+penLR+penTop);
    return isFinite(v)?v:1e15;
  } catch(e){ return 1e15; }
}

// ═══════════════════════════════════════════════════════════
// §9  BFGS MINIMIZER  (3-D, numerical gradient)
// ═══════════════════════════════════════════════════════════
function bfgs(f, x0, maxIter=400) {
  const n=x0.length, h=1e-5;
  let x=[...x0];
  const H=Array.from({length:n},(_,i)=>Array.from({length:n},(_,j)=>i===j?1:0));
  const dot=(a,b)=>a.reduce((s,ai,i)=>s+ai*b[i],0);
  const norm=v=>Math.sqrt(dot(v,v));
  const grad=(x,fx)=>x.map((_,i)=>{ const xp=[...x]; xp[i]+=h; return (f(xp)-fx)/h; });
  let fx=f(x), gx=grad(x,fx);

  for(let it=0;it<maxIter;it++){
    const p=H.map(row=>-row.reduce((s,v,j)=>s+v*gx[j],0));
    const slope=dot(gx,p);
    if(slope>=0){ for(let i=0;i<n;i++) for(let j=0;j<n;j++) H[i][j]=i===j?1:0; continue; }

    let alpha=1; let xN,fN,gN,ok=false;
    for(let ls=0;ls<60;ls++){
      xN=x.map((xi,i)=>xi+alpha*p[i]); fN=f(xN);
      if(fN<fx+1e-4*alpha*slope){ ok=true; break; } alpha*=0.5;
    }
    if(!ok) break;
    gN=grad(xN,fN);
    const s=p.map(pi=>alpha*pi), y=gN.map((gi,i)=>gi-gx[i]);
    const sy=dot(s,y);
    if(sy>1e-12){
      const Hy=H.map(row=>row.reduce((a,v,j)=>a+v*y[j],0));
      const yHy=dot(y,Hy), rho=1/sy;
      for(let i=0;i<n;i++) for(let j=0;j<n;j++)
        H[i][j]+=(1+yHy/sy)*rho*s[i]*s[j]-rho*(Hy[i]*s[j]+s[i]*Hy[j]);
    }
    x=xN; fx=fN; gx=gN;
    if(norm(gx)<1e-6) break;
  }
  return {x,fx};
}

// ═══════════════════════════════════════════════════════════
// §10  FIT MODEL  (main entry point, async for UI updates)
// ═══════════════════════════════════════════════════════════
function fitModel(dy, jThr=0.1, jPow=10) {
  const pr=extractSpectralPriors(dy);
  const ksI=Math.max(pr.ksMode,0.01);
  const dkI=Math.max(pr.kpMode-ksI,0.05);
  const theta0=[Math.log(ksI),Math.log(dkI),Math.log(0.001)];
  const opt=bfgs(theta=>mapObj(theta,dy,pr,jThr,jPow), theta0, 400);
  const ks=Math.exp(opt.x[0]), kp=ks+Math.exp(opt.x[1]), lR=Math.exp(opt.x[2]);
  const Vp=pr.energyRatio;
  const res=runGLSFilter(dy,kp,ks,Vp,lR,jThr,jPow);
  let tAcc=0; const time=dy.map(d=>(tAcc+=d));
  return {
    dy,time,pr,
    params:{ks,kp,lR,lp:Vp,nu0:res.nu0,sig2:res.sig2,
            sigP:Math.sqrt(2*kp*Vp*res.sig2),sigS:Math.sqrt(2*ks*1.0*res.sig2)},
    Xp:res.Xp, Xs:res.Xs, XpV:res.XpV, XsV:res.XsV, rrV:res.rrV,
    irr:Array.from(res.irr), gate:res.gate,
    innovations:res.innovations
  };
}

// ═══════════════════════════════════════════════════════════
// §11  POWER SPECTRAL DENSITY  (Daniell-smoothed periodogram)
// ═══════════════════════════════════════════════════════════
function computePSD(signal, fs, spans=[3,5]) {
  const N=signal.length, Np=pow2(N);
  const mn=signal.reduce((a,b)=>a+b,0)/N;
  const re=new Float64Array(Np), im=new Float64Array(Np);
  for(let i=0;i<N;i++) re[i]=signal[i]-mn;
  fftCore(re,im,false);
  const M=Math.floor(Np/2)+1;
  const freq=Array.from({length:M},(_,k)=>k*fs/Np);
  let pow=new Array(M);
  pow[0]=re[0]*re[0]/(N*fs);
  for(let k=1;k<M-1;k++) pow[k]=2*(re[k]*re[k]+im[k]*im[k])/(N*fs);
  pow[M-1]=re[M-1]*re[M-1]/(N*fs);
  for(const span of spans){
    const m=Math.floor(span/2), s=[...pow];
    for(let i=m;i<M-m;i++){let t=0;for(let j=-m;j<=m;j++)t+=pow[i+j];s[i]=t/span;}
    pow=s;
  }
  const pf=[],pp=[];
  for(let i=0;i<M;i++) if(freq[i]>=0.01&&freq[i]<=0.5){pf.push(freq[i]);pp.push(pow[i]);}
  return {freq:pf,pow:pp};
}

function hrPSD(dy, irr, time, spans) {
  const fs=4, dt=1/fs;
  const tMin=time[0], tMax=time[time.length-1];
  const Ng=Math.floor((tMax-tMin)*fs)+1;
  const tG=Array.from({length:Ng},(_,i)=>tMin+i*dt);
  const hrObs=makeSpline(time,dy.map(d=>1/d));
  const hrFlt=makeSpline(time,irr.map(r=>1/r));
  return {
    obs: computePSD(tG.map(t=>hrObs(t)), fs, spans||[3,5]),
    flt: computePSD(tG.map(t=>hrFlt(t)), fs, [3,3])
  };
}

// ═══════════════════════════════════════════════════════════
// §12  EXAMPLE DATA  (synthetic IPFM with OU drives)
// ═══════════════════════════════════════════════════════════
function genExampleRR(N=400) {
  let s=42>>>0;
  const rng=()=>{s=Math.imul(s^s>>>15,1|s);s^=s+Math.imul(s^s>>>7,61|s);return((s^s>>>14)>>>0)/4294967296;};
  const rn=()=>Math.sqrt(-2*Math.log(rng()+1e-9))*Math.cos(2*Math.PI*rng());
  const nu0=1.05, ks=0.07, kp=1.1, Vs=0.025, Vp=0.11;
  let xs=0,xp=0; const rr=[];
  for(let i=0;i<N;i++){
    const dta=1/nu0;
    xs=xs*Math.exp(-ks*dta)+Math.sqrt(Vs*(1-Math.exp(-2*ks*dta)))*rn();
    xp=xp*Math.exp(-kp*dta)+Math.sqrt(Vp*(1-Math.exp(-2*kp*dta)))*rn();
    const nu=Math.max(nu0-xp+xs,0.4);
    rr.push(Math.max(0.3,Math.min(2.0,1/nu+0.012*rn())));
  }
  return rr;
}

// ═══════════════════════════════════════════════════════════
// §13  DIAGNOSTIC & LATENT-STATE HELPERS
// ═══════════════════════════════════════════════════════════

function css(v){return getComputedStyle(document.documentElement).getPropertyValue(v).trim()||'#888'}

// Normal CDF — Abramowitz & Stegun §26.2.17
function normalCDF(x){
  const p=0.2316419,a=[0.319381530,-0.356563782,1.781477937,-1.821255978,1.330274429];
  const t=1/(1+p*Math.abs(x));
  const poly=t*(a[0]+t*(a[1]+t*(a[2]+t*(a[3]+t*a[4]))));
  const c=1-Math.exp(-x*x/2)/Math.sqrt(2*Math.PI)*poly;
  return x>=0?c:1-c;
}

// Normal quantile — Acklam's rational approximation
function normalQ(p){
  const a=[-3.969683028665376e1,2.209460984245205e2,-2.759285104469687e2,1.383577518672690e2,-3.066479806614716e1,2.506628277459239],
        b=[-5.447609879822406e1,1.615858368580409e2,-1.556989798598866e2,6.680131188771972e1,-1.328068155288572e1],
        c=[-7.784894002430293e-3,-3.223964580411365e-1,-2.400758277161838,-2.549732539343734,4.374664141464968,2.938163982698783],
        d=[7.784695709041462e-3,3.224671290700398e-1,2.445134137142996,3.754408661907416];
  const lo=0.02425,hi=1-lo;
  if(p<lo){const q=Math.sqrt(-2*Math.log(p));return(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5])/((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);}
  if(p<=hi){const q=p-0.5,r=q*q;return(((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q/((((( b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);}
  const q=Math.sqrt(-2*Math.log(1-p));return-(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5])/((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
}

// PACF — Durbin-Levinson recursion
function computePACF(series,maxLag){
  const N=series.length;
  const mean=series.reduce((a,b)=>a+b,0)/N;
  const c=series.map(x=>x-mean);
  const v=c.reduce((a,b)=>a+b*b,0)/N;
  if(v<1e-12) return new Array(maxLag).fill(0);
  const acf=[1];
  for(let k=1;k<=maxLag;k++){let s=0;for(let t=k;t<N;t++)s+=c[t]*c[t-k];acf.push(s/(N*v));}
  const pacf=[0]; let phi=[0,acf[1]]; pacf.push(acf[1]);
  for(let m=2;m<=maxLag;m++){
    let num=acf[m],den=1;
    for(let k=1;k<m;k++){num-=phi[k]*acf[m-k];den-=phi[k]*acf[k];}
    const pmm=Math.abs(den)>1e-12?num/den:0;
    const np=Array(m+1).fill(0); np[m]=pmm;
    for(let k=1;k<m;k++) np[k]=phi[k]-pmm*phi[m-k];
    phi=np; pacf.push(pmm);
  }
  return pacf.slice(1);
}

// KS uniformity test via time-rescaling theorem
function ksTest(z,gate){
  const valid=z.filter((_,i)=>!gate||gate[i]<1.5);
  const N=valid.length;
  if(N<5) return{D:NaN,p:NaN,u:[],N:0};
  const u=valid.map(zi=>normalCDF(zi)).sort((a,b)=>a-b);
  let D=0; for(let i=0;i<N;i++) D=Math.max(D,Math.abs(u[i]-(i+0.5)/N));
  const lam=(Math.sqrt(N)+0.12+0.11/Math.sqrt(N))*D;
  let p=0; for(let j=1;j<=50;j++) p+=2*Math.pow(-1,j-1)*Math.exp(-2*j*j*lam*lam);
  return{D,p:Math.max(0,Math.min(1,p)),u,N};
}

// Derived metrics from latent states
function derivedMetrics(fit){
  const{Xp,Xs,XpV,XsV,irr,dy,gate,params}=fit;
  const N=irr.length, e=1e-8;

  // ── Steady-state (stationary) variances of each OU drive — the natural
  // physiological amplitude scale for each branch. Used below both for the
  // balance index and for the entropy production rate.
  const V_P_ss=params.lp*params.sig2;   // steady-state parasympathetic variance Λ_P·σ²sys
  const V_S_ss=params.sig2;              // steady-state sympathetic variance σ²sys
  const sdP_ss=Math.sqrt(V_P_ss), sdS_ss=Math.sqrt(V_S_ss);

  // Map real-line states to (0, 1) preserving activation (+) vs withdrawal (-)
  // Baseline (0) maps to 0.5; Activation maps > 0.5; Withdrawal maps < 0.5
  const fP = Xp.map(xp => 0.5 + (1 / Math.PI) * Math.atan(xp / sdP_ss));
  const fS = Xs.map(xs => 0.5 + (1 / Math.PI) * Math.atan(xs / sdS_ss));

  // Stabilized and EMA-smoothed Autonomic Balance Index
  const abiSmoothingFactor = 0.1; // α: Lower is smoother (e.g., 0.05 - 0.2)
  let previousABI = 0;

  const abi = fP.map((v, i) => {
      // Log ratio of the shifted states.
      // Positive = vagal dominant, Negative = sympathetic dominant.
      const rawLogBalance = Math.log((v) / (fS[i]));

      // Initialize EMA on the first iteration
      if (i === 0) previousABI = rawLogBalance;

      const smoothedABI = (abiSmoothingFactor * rawLogBalance) + ((1 - abiSmoothingFactor) * previousABI);
      previousABI = smoothedABI;
      return smoothedABI;
  });
  const mABI = abi.reduce((a,b)=>a+b,0)/N;
  const abiStd = Math.sqrt(abi.reduce((s,v)=>s+(v-mABI)**2,0)/N);

  // ── Total drive magnitude ‖x‖
  const tad=Xp.map((xp,i)=>Math.sqrt(xp*xp+Xs[i]*Xs[i]));

  // ── HRV metrics
  let rf=0,ro=0;
  for(let i=1;i<N;i++){rf+=(irr[i]-irr[i-1])**2;ro+=(dy[i]-dy[i-1])**2;}
  const rmssdFlt=1000*Math.sqrt(rf/(N-1)), rmssdObs=1000*Math.sqrt(ro/(N-1));
  const mIrr=irr.reduce((a,b)=>a+b,0)/N;
  const sdnnFlt=1000*Math.sqrt(irr.reduce((a,b)=>a+(b-mIrr)**2,0)/N);

  // ── Fit quality
  let rms2=0,map2=0;
  for(let i=0;i<N;i++){rms2+=(dy[i]-irr[i])**2;map2+=Math.abs((dy[i]-irr[i])/Math.max(dy[i],1e-6));}
  const rmse=1000*Math.sqrt(rms2/N), mape=100*map2/N;
  const nGated=Array.from(gate).filter(g=>g>1.5).length;

  // ── Stochastic Entropy Production Rate — allostatic load proxy
  // For OU process: ṡ(t) = κ_P·(X_P²/V_P_ss − 1) + κ_S·(X_S²/V_S_ss − 1)
  // Zero at steady-state mean; positive = system working above thermodynamic baseline
  const epr=Xp.map((xp,i)=>
    params.kp*(xp*xp/V_P_ss - 1) + params.ks*(Xs[i]*Xs[i]/V_S_ss - 1)
  );

  // --- EMA Smoothing for Entropy Production Rate ---
  const eprAlpha = 0.1; // Smoothing factor (0.05 to 0.20). Lower = smoother.
  for(let i=1; i<epr.length; i++){
      epr[i] = (eprAlpha * epr[i]) + ((1 - eprAlpha) * epr[i-1]);
  }

  const mEPR=epr.reduce((a,b)=>a+b,0)/N;

  // ── Phase-plane areal velocity: instantaneous rate of area sweep, dA/dt
    // Discrete analogue of the continuous Green's-theorem rate ½(X_P·Ẋ_S − X_S·Ẋ_P),
    // formed by dividing each shoelace increment by the real elapsed time (dy[i])
    // instead of letting it accumulate. This is the velocity-type companion to the
    // distance-type cumulative hysteresis above.
    const arealVel=[0];
    for(let i=0;i<N-1;i++){
      const dt=Math.max(dy[i],1e-6);
      arealVel.push(0.5*(Xp[i]*Xs[i+1]-Xp[i+1]*Xs[i])/dt);
    }

    // --- EMA Smoothing for Areal Velocity (Least Invasive Fix) ---
    const avelAlpha = 0.005; // Smoothing factor
    for(let i=1; i<arealVel.length; i++){
        arealVel[i] = (avelAlpha * arealVel[i]) + ((1 - avelAlpha) * arealVel[i-1]);
    }
    // ------------------------------------------------------------------

    const mArealVel=arealVel.reduce((a,b)=>a+b,0)/N;
    const rmsArealVel=Math.sqrt(arealVel.reduce((s,v)=>s+v*v,0)/N);

  return{abi,tad,rmssdFlt,rmssdObs,sdnnFlt,mABI,abiStd,
    nGated,pctGated:100*nGated/N,rmse,mape,
    epr,mEPR,arealVel,mArealVel,rmsArealVel};
}

// ═══════════════════════════════════════════════════════════
// §14  CHART BUILDERS  (theme-aware, fully rebuilt on toggle)
// ═══════════════════════════════════════════════════════════

const _ch={};
function destroyChart(id){if(_ch[id]){_ch[id].destroy();delete _ch[id];}}

function tc(){
  return{tx2:css('--tx2'),bd:css('--bd'),s1:css('--s1'),
         acc:css('--acc'),teal:css('--teal'),red:css('--red'),
         grn:css('--grn'),amb:css('--amb'),pur:css('--pur')}
}

function chartDefaults(){
  const c=tc();
  Chart.defaults.color=c.tx2; Chart.defaults.borderColor=c.bd;
  Chart.defaults.font.family="-apple-system,'Segoe UI',system-ui,sans-serif";
  Chart.defaults.font.size=11;
}

function baseOpts(extra={}){
  const c=tc();
  return Object.assign({
    responsive:true,maintainAspectRatio:true,animation:false,
    plugins:{legend:{labels:{color:c.tx2,boxWidth:10,padding:9}}},
    scales:{
      x:{ticks:{color:c.tx2},grid:{color:c.bd+'44'}},
      y:{ticks:{color:c.tx2},grid:{color:c.bd+'44'}}
    }
  },extra);
}

// ── RR Fit with gated beat markers ──
function buildRRChart(time,dy,irr,rrV,gate){
  destroyChart('rr'); const c=tc(),z=1.96;
  const up=irr.map((v,i)=>v+z*Math.sqrt(Math.max(rrV[i],0)));
  const lo=irr.map((v,i)=>v-z*Math.sqrt(Math.max(rrV[i],0)));
  const lab=time.map(t=>t.toFixed(1));
  const gateDots=Array.from(dy).map((v,i)=>gate[i]>1.5?v:null);
  _ch.rr=new Chart(document.getElementById('chart-rr'),{
    type:'line',
    data:{labels:lab,datasets:[
      {label:'CI+',data:up,borderColor:'transparent',backgroundColor:c.red+'1a',pointRadius:0,fill:false,order:5},
      {label:'95% CI',data:lo,borderColor:'transparent',backgroundColor:c.red+'1a',pointRadius:0,fill:'-1',order:4},
      {label:'Observed RR',data:Array.from(dy),borderColor:c.tx2+'55',backgroundColor:'transparent',pointRadius:0,borderWidth:.9,order:3},
      {label:'Filtered RR',data:Array.from(irr),borderColor:c.red,backgroundColor:'transparent',pointRadius:0,borderWidth:1.8,order:2},
      {label:'Gated beat',data:gateDots,borderColor:'transparent',backgroundColor:c.amb,pointRadius:4,pointStyle:'triangle',showLine:false,order:1}
    ]},
    options:baseOpts({
      plugins:{legend:{labels:{filter:i=>i.datasetIndex>=2,color:c.tx2,boxWidth:10,padding:9}}},
      scales:{
        x:{title:{display:true,text:'Time (s)',color:c.tx2},ticks:{maxTicksLimit:8,color:c.tx2},grid:{color:c.bd+'44'}},
        y:{title:{display:true,text:'RR Interval (s)',color:c.tx2},ticks:{color:c.tx2},grid:{color:c.bd+'44'}}
      }
    })
  });
}

// ── Autonomic States with CI ──
function buildStatesChart(time,Xp,Xs,XpV,XsV){
  destroyChart('states'); const c=tc(),z=1.96;
  const pU=Xp.map((v,i)=>v+z*Math.sqrt(Math.max(XpV[i],0)));
  const pL=Xp.map((v,i)=>v-z*Math.sqrt(Math.max(XpV[i],0)));
  const sU=Xs.map((v,i)=>v+z*Math.sqrt(Math.max(XsV[i],0)));
  const sL=Xs.map((v,i)=>v-z*Math.sqrt(Math.max(XsV[i],0)));
  const lab=time.map(t=>t.toFixed(1));
  _ch.states=new Chart(document.getElementById('chart-states'),{
    type:'line',
    data:{labels:lab,datasets:[
      {data:pU,borderColor:'transparent',backgroundColor:c.teal+'18',pointRadius:0,fill:false},
      {data:pL,borderColor:'transparent',backgroundColor:c.teal+'18',pointRadius:0,fill:'-1'},
      {data:sU,borderColor:'transparent',backgroundColor:c.red+'14',pointRadius:0,fill:false},
      {data:sL,borderColor:'transparent',backgroundColor:c.red+'14',pointRadius:0,fill:'-1'},
      {label:'Parasympathetic',data:Xp,borderColor:c.teal,backgroundColor:'transparent',pointRadius:0,borderWidth:1.6},
      {label:'Sympathetic',data:Xs,borderColor:c.red,backgroundColor:'transparent',pointRadius:0,borderWidth:1.6}
    ]},
    options:baseOpts({
      plugins:{legend:{labels:{filter:i=>i.datasetIndex>=4,color:c.tx2,boxWidth:10,padding:9}}},
      scales:{
        x:{title:{display:true,text:'Time (s)',color:c.tx2},ticks:{maxTicksLimit:8,color:c.tx2},grid:{color:c.bd+'44'}},
        y:{title:{display:true,text:'Drive amplitude (Hz)',color:c.tx2},ticks:{color:c.tx2},grid:{color:c.bd+'44'}}
      }
    })
  });
}

// ── Phase Space with stationary energy ellipses ──
function buildPhaseChart(Xp,Xs,params){
  destroyChart('phase'); const c=tc(), N=Xp.length;
  const sigPStat=Math.sqrt(params.lp*params.sig2);
  const sigSStat=Math.sqrt(params.sig2);
  const isLight=document.documentElement.dataset.theme==='light';

  // Plasma-gradient trajectory colours
  const cols=Array.from({length:N},(_,k)=>{
    const t=k/Math.max(N-1,1);
    const r=Math.round(13+t*(220-13)),b=Math.round(135+t*(30-135));
    const g=Math.round(t<.5?8+t*2*(50-8):(1-(t-.5)*2)*50+(t-.5)*2*180);
    return`rgba(${r},${g},${b},.88)`;
  });

  // Plugin: draw stationary covariance ellipses + axes
  const ellipsePlugin={id:'ellipses',afterDraw:(ch)=>{
    const{ctx,chartArea:ca,scales:{x,y}}=ch;
    ctx.save();
    ctx.beginPath();ctx.rect(ca.left,ca.top,ca.right-ca.left,ca.bottom-ca.top);ctx.clip();
    // Crosshairs at origin
    ctx.save();ctx.setLineDash([2,5]);
    ctx.strokeStyle=isLight?'rgba(0,0,0,.10)':'rgba(255,255,255,.08)';ctx.lineWidth=1;
    const ox=x.getPixelForValue(0),oy=y.getPixelForValue(0);
    ctx.beginPath();ctx.moveTo(ca.left,oy);ctx.lineTo(ca.right,oy);
    ctx.moveTo(ox,ca.top);ctx.lineTo(ox,ca.bottom);ctx.stroke();ctx.restore();
    // Mahalanobis ellipses at 1σ, 2σ, 3σ (chi2(2) = 2.30, 5.99, 11.63 → radii = √lvl)
    const lvls=[1.517,2.448,3.413], alphas=[.30,.18,.09];
    for(let li=0;li<lvls.length;li++){
      const xR=sigPStat*lvls[li], yR=sigSStat*lvls[li];
      ctx.beginPath();ctx.setLineDash([3,4]);
      ctx.strokeStyle=isLight?`rgba(20,40,80,${alphas[li]})`:`rgba(180,210,255,${alphas[li]})`;
      ctx.lineWidth=1;
      for(let i=0;i<=80;i++){
        const th=2*Math.PI*i/80;
        const px=x.getPixelForValue(xR*Math.cos(th));
        const py=y.getPixelForValue(yR*Math.sin(th));
        i===0?ctx.moveTo(px,py):ctx.lineTo(px,py);
      }
      ctx.closePath();ctx.stroke();
    }
    ctx.restore();
  }};

  _ch.phase=new Chart(document.getElementById('chart-phase'),{
    type:'scatter',
    data:{datasets:[
      // ── Connecting lines with temporal gradient ──
      {
        type:'line',showLine:true,label:'',
        data:Array.from({length:N},(_,k)=>({x:Xp[k],y:Xs[k]})),
        pointRadius:0,borderWidth:0.9,backgroundColor:'transparent',
        order:2,
        segment:{
          borderColor:ctx=>{
            const t=ctx.p0DataIndex/Math.max(N-1,1);
            const r=Math.round(13+t*(220-13)),b2=Math.round(135+t*(30-135));
            const g2=Math.round(t<.5?8+t*2*(50-8):(1-(t-.5)*2)*50+(t-.5)*2*180);
            return`rgba(${r},${g2},${b2},.42)`;
          }
        }
      },
      // ── Scatter points with plasma gradient ──
      {
        label:'Trajectory (early→late)',
        data:Array.from({length:N},(_,k)=>({x:Xp[k],y:Xs[k]})),
        pointBackgroundColor:cols,pointRadius:2.2,pointHoverRadius:4,
        borderColor:'transparent',order:1
      }
    ]},
    options:{
      responsive:true,maintainAspectRatio:false,animation:false,
      plugins:{legend:{display:false}},
      scales:{
        x:{title:{display:true,text:'Parasympathetic drive (Hz)',color:c.tx2},ticks:{color:c.tx2},grid:{color:c.bd+'44'}},
        y:{title:{display:true,text:'Sympathetic drive (Hz)',color:c.tx2},ticks:{color:c.tx2},grid:{color:c.bd+'44'}}
      }
    },
    plugins:[ellipsePlugin]
  });
}

// ── Autonomic Log Balance Index (single axis) ──
function buildABIChart(time,abi){
  destroyChart('abi'); const c=tc();
  const lab=time.map(t=>t.toFixed(1));
  const zero=abi.map(()=>0);
  _ch.abi=new Chart(document.getElementById('chart-abi'),{
    type:'line',
    data:{labels:lab,datasets:[
      {label:'',data:zero,borderColor:c.tx2+'30',backgroundColor:'transparent',
       pointRadius:0,borderWidth:1,borderDash:[4,4]},
      {label:'Log balance (vagal / symp)',data:abi,
       borderColor:c.acc,backgroundColor:c.acc+'18',
       fill:true,pointRadius:0,borderWidth:1.8}
    ]},
    options:baseOpts({
      plugins:{legend:{labels:{filter:i=>i.datasetIndex>=1,color:c.tx2,boxWidth:10,padding:9}}},
      scales:{
        x:{title:{display:true,text:'Time (s)',color:c.tx2},ticks:{maxTicksLimit:8,color:c.tx2},grid:{color:c.bd+'44'}},
        y:{title:{display:true,text:'EMA[ ln( f(X_P) / f(X_S) ) ]',color:c.acc},ticks:{color:c.tx2},grid:{color:c.bd+'44'}}
      }
    })
  });
}

// ── Total Autonomic Drive ‖x‖ ──
function buildTotalDriveChart(time,tad){
  destroyChart('totaldrive'); const c=tc();
  const lab=time.map(t=>t.toFixed(1));
  _ch.totaldrive=new Chart(document.getElementById('chart-totaldrive'),{
    type:'line',
    data:{labels:lab,datasets:[{
      label:'Total drive ‖x‖',data:tad,
      borderColor:c.amb,backgroundColor:c.amb+'18',
      fill:true,pointRadius:0,borderWidth:1.8
    }]},
    options:baseOpts({
      scales:{
        x:{title:{display:true,text:'Time (s)',color:c.tx2},ticks:{maxTicksLimit:8,color:c.tx2},grid:{color:c.bd+'44'}},
        y:{title:{display:true,text:'‖x‖ (Hz)',color:c.amb},min:0,ticks:{color:c.tx2},grid:{color:c.bd+'44'}}
      }
    })
  });
}

// ── PSD with LF/HF band shading ──
function buildPSDChart(obsF,obsP,fltF,fltP){
  destroyChart('psd'); const c=tc();
  const bandPl={id:'bands',beforeDraw:ch=>{
    const{ctx,chartArea:ca,scales:{x}}=ch;
    const l1=x.getPixelForValue(.04),l2=x.getPixelForValue(.15),h2=x.getPixelForValue(.40);
    ctx.save();
    ctx.fillStyle=css('--lf');ctx.fillRect(Math.max(l1,ca.left),ca.top,Math.min(l2,ca.right)-Math.max(l1,ca.left),ca.bottom-ca.top);
    ctx.fillStyle=css('--hf');ctx.fillRect(Math.max(l2,ca.left),ca.top,Math.min(h2,ca.right)-Math.max(l2,ca.left),ca.bottom-ca.top);
    ctx.font='9.5px '+Chart.defaults.font.family;
    ctx.fillStyle=c.red+'70';ctx.fillText('LF',Math.max(l1,ca.left)+4,ca.top+13);
    ctx.fillStyle=c.teal+'80';ctx.fillText('HF',Math.max(l2,ca.left)+4,ca.top+13);
    ctx.restore();
  }};
  _ch.psd=new Chart(document.getElementById('chart-psd'),{
    type:'scatter',
    data:{datasets:[
      {type:'line',showLine:true,label:'Empirical PSD',data:obsF.map((f,i)=>({x:f,y:obsP[i]})),borderColor:c.tx2+'88',backgroundColor:'transparent',pointRadius:0,borderWidth:1.2},
      {type:'line',showLine:true,label:'Filtered PSD',data:fltF.map((f,i)=>({x:f,y:fltP[i]})),borderColor:c.red,backgroundColor:'transparent',pointRadius:0,borderWidth:1.8}
    ]},
    options:{
      responsive:true,maintainAspectRatio:true,animation:false,
      plugins:{legend:{labels:{color:c.tx2,boxWidth:10,padding:9}}},
      scales:{
        x:{type:'linear',min:.01,max:.5,title:{display:true,text:'Frequency (Hz)',color:c.tx2},ticks:{color:c.tx2,values:[.04,.15,.40]},grid:{color:c.bd+'44'}},
        y:{type:'logarithmic',title:{display:true,text:'PSD (log₁₀)',color:c.tx2},ticks:{color:c.tx2},grid:{color:c.bd+'44'}}
      }
    },
    plugins:[bandPl]
  });
}

// ── Morlet CWT Scalogram ──────────────────────────────────
let _cwtCache=null, _cwtRO=null;

function buildCWTChart(fit){
  const canvas=document.getElementById('chart-cwt'); if(!canvas) return;

  // Resample RR → 4 Hz equispaced mean-removed HR (same as spectral prior)
  const fs=4, dt=1/fs;
  const{time,dy}=fit;
  const tMin=time[0], tMax=time[time.length-1];
  const Ng=Math.floor((tMax-tMin)*fs)+1;
  const sp=makeSpline(time,dy.map(d=>1/d));
  const meanHr=dy.reduce((a,b)=>a+1/b,0)/dy.length;
  const hrC=Array.from({length:Ng},(_,i)=>sp(tMin+i*dt)-meanHr);

  // Full scalogram
  const{power,freqs}=morletCWTScalogram(hrC,dt);

  // Filter to HRV band (0.01–0.50 Hz)
  const band=freqs.map((f,i)=>({f,i})).filter(({f})=>f>=0.01&&f<=0.50);
  const bFreqs=band.map(({f})=>f);
  const bPow=band.map(({i})=>power[i]);
  const nS=bFreqs.length, nT=Ng;

  // Global log-power range for colormap normalisation
  let pMin=Infinity, pMax=-Infinity;
  for(const row of bPow) for(const v of row){
    const lv=Math.log(v+1e-10); if(lv<pMin)pMin=lv; if(lv>pMax)pMax=lv;
  }

  _cwtCache={bFreqs,bPow,nS,nT,tMin,tMax,pMin,pRange:pMax-pMin+1e-12};
  _renderCWT();

  // ResizeObserver fires when container becomes visible (tab switch) or resizes
  if(!_cwtRO){
    _cwtRO=new ResizeObserver(()=>_renderCWT());
    _cwtRO.observe(canvas.parentElement||canvas);
  }
}

function _renderCWT(){
  if(!_cwtCache) return;
  const canvas=document.getElementById('chart-cwt'); if(!canvas) return;
  const cc=canvas.closest('.cc')||canvas.parentElement;
  const W=Math.max((cc?cc.clientWidth-30:0)||600,250);
  if(W<50) return; // still hidden in inactive tab

  const{bFreqs,bPow,nS,nT,tMin,tMax,pMin,pRange}=_cwtCache;
  const c=tc();
  const isLight=document.documentElement.dataset.theme==='light';

  // Layout constants
  const PAD={top:12,bottom:40,left:50,right:56}; // right leaves room for colorbar
  const H=224;
  canvas.width=W; canvas.height=H;
  const ctx=canvas.getContext('2d');
  const pW=W-PAD.left-PAD.right, pH=H-PAD.top-PAD.bottom;

  // Background
  ctx.fillStyle=isLight?'#FFFFFF':'#07090F';
  ctx.fillRect(0,0,W,H);

  // ── Scalogram via ImageData (bilinear + log-power + inferno colormap) ──
  const img=ctx.createImageData(pW,pH);
  const pxBuf=img.data;
  const fMinLog=Math.log(bFreqs[nS-1]);
  const fMaxLog=Math.log(bFreqs[0]);
  const logRange=fMaxLog-fMinLog+1e-12;

  for(let py=0;py<pH;py++){
    // py=0 → top → high frequency; py=pH-1 → bottom → low frequency
    const logF=fMaxLog-(py/(pH-1))*logRange;
    const si_f=(fMaxLog-logF)/logRange*(nS-1);
    const si0=Math.min(Math.max(0,Math.floor(si_f)),nS-2);
    const sf=si_f-si0;
    for(let px2=0;px2<pW;px2++){
      const ti_f=px2/(pW-1)*(nT-1);
      const ti0=Math.min(Math.max(0,Math.floor(ti_f)),nT-2);
      const tf=ti_f-ti0;
      // Bilinear interpolation in log-power
      const v00=Math.log(bPow[si0][ti0]  +1e-10), v01=Math.log(bPow[si0][ti0+1]  +1e-10);
      const v10=Math.log(bPow[si0+1][ti0]+1e-10), v11=Math.log(bPow[si0+1][ti0+1]+1e-10);
      const lv=v00*(1-sf)*(1-tf)+v01*(1-sf)*tf+v10*sf*(1-tf)+v11*sf*tf;
      const norm=Math.max(0,Math.min(1,(lv-pMin)/pRange));
      const[r,g,b]=_INFERNO_LUT[Math.round(norm*255)];
      const idx=(py*pW+px2)*4;
      pxBuf[idx]=r; pxBuf[idx+1]=g; pxBuf[idx+2]=b; pxBuf[idx+3]=255;
    }
  }
  ctx.putImageData(img,PAD.left,PAD.top);

  // Helper: freq (Hz) → canvas y coordinate
  const freqToY=f=>PAD.top+pH-((Math.log(f)-fMinLog)/logRange)*pH;

  // ── LF / HF band boundary dashed lines ──
  const bDef=[{f:0.04,col:c.red,lbl:'VLF│LF'},{f:0.15,col:c.teal,lbl:'LF│HF'},{f:0.40,col:c.teal,lbl:''}];
  ctx.save(); ctx.setLineDash([3,5]); ctx.lineWidth=1;
  for(const{f,col,lbl} of bDef){
    if(f<=bFreqs[nS-1]||f>=bFreqs[0]) continue;
    const y=freqToY(f);
    ctx.strokeStyle=col+'cc';
    ctx.beginPath(); ctx.moveTo(PAD.left,y); ctx.lineTo(PAD.left+pW,y); ctx.stroke();
    if(lbl){
      ctx.fillStyle=col+'cc'; ctx.font='8.5px '+Chart.defaults.font.family;
      ctx.textAlign='left'; ctx.fillText(lbl,PAD.left+4,y-2.5);
    }
  }
  ctx.restore();

  // Band mid-point labels (right edge)
  ctx.font='9px '+Chart.defaults.font.family; ctx.textAlign='right';
  const fBotLF=Math.max(0.04,bFreqs[nS-1]), fTopHF=Math.min(0.40,bFreqs[0]);
  if(bFreqs[nS-1]<0.15&&bFreqs[0]>0.04){
    const yMid=(freqToY(fBotLF)+freqToY(Math.min(0.15,bFreqs[0])))/2;
    ctx.fillStyle=c.red+'88'; ctx.fillText('LF',PAD.left+pW-4,yMid+3.5);
  }
  if(bFreqs[nS-1]<0.40&&bFreqs[0]>0.15){
    const yMid=(freqToY(Math.max(0.15,bFreqs[nS-1]))+freqToY(fTopHF))/2;
    ctx.fillStyle=c.teal+'88'; ctx.fillText('HF',PAD.left+pW-4,yMid+3.5);
  }

  // ── Y-axis: frequency ticks & labels ──
  ctx.fillStyle=c.tx2; ctx.font='10px '+Chart.defaults.font.family; ctx.textAlign='right';
  const fTicks=[0.04,0.10,0.15,0.25,0.40].filter(f=>f>bFreqs[nS-1]*1.05&&f<bFreqs[0]*0.95);
  for(const f of fTicks){
    const y=freqToY(f);
    ctx.fillText(f.toFixed(2),PAD.left-5,y+3.5);
    ctx.fillStyle=c.tx2; ctx.fillRect(PAD.left-3,y-.5,3,1);
    ctx.fillStyle=c.tx2;
  }
  // Y-axis title (rotated)
  ctx.save();
  ctx.fillStyle=c.tx2; ctx.font='10px '+Chart.defaults.font.family;
  ctx.translate(11,PAD.top+pH/2); ctx.rotate(-Math.PI/2);
  ctx.textAlign='center'; ctx.fillText('Frequency (Hz)',0,0);
  ctx.restore();

  // ── X-axis: time ticks & labels ──
  ctx.fillStyle=c.tx2; ctx.font='10px '+Chart.defaults.font.family; ctx.textAlign='center';
  const nXT=Math.min(8,Math.max(4,Math.floor(pW/65)));
  for(let i=0;i<=nXT;i++){
    const t=tMin+i*(tMax-tMin)/nXT;
    const x=PAD.left+(i/nXT)*pW;
    ctx.fillText(t.toFixed(0),x,H-11);
    ctx.fillRect(x-.5,PAD.top+pH,1,3);
  }
  ctx.fillText('Time (s)',PAD.left+pW/2,H-1);

  // ── Colorbar (right of plot) ──
  const cbX=PAD.left+pW+5, cbY=PAD.top, cbW=12, cbH=pH;
  for(let cy=0;cy<cbH;cy++){
    const n=1-cy/cbH; // top→high power, bottom→low power
    const[r,g,b]=_INFERNO_LUT[Math.round(n*255)];
    ctx.fillStyle=`rgb(${r},${g},${b})`;
    ctx.fillRect(cbX,cbY+cy,cbW,1.5);
  }
  ctx.strokeStyle=c.bd; ctx.lineWidth=0.6; ctx.setLineDash([]);
  ctx.strokeRect(cbX,cbY,cbW,cbH);
  ctx.fillStyle=c.tx2; ctx.font='8.5px '+Chart.defaults.font.family; ctx.textAlign='left';
  ctx.fillText('High',cbX+cbW+2,cbY+8);
  ctx.fillText('Low', cbX+cbW+2,cbY+cbH-2);
  ctx.save();
  ctx.translate(cbX+cbW+16,cbY+cbH/2); ctx.rotate(-Math.PI/2);
  ctx.textAlign='center'; ctx.font='8px '+Chart.defaults.font.family;
  ctx.fillStyle=c.tx3; ctx.fillText('log power',0,0);
  ctx.restore();

  // ── Plot border ──
  ctx.strokeStyle=c.bd; ctx.lineWidth=1; ctx.setLineDash([]);
  ctx.strokeRect(PAD.left,PAD.top,pW,pH);
}

// ── Innovations histogram vs N(0,1) ──
function buildHistChart(z,gate){
  destroyChart('hist'); const c=tc();
  const valid=z.filter((_,i)=>!gate||gate[i]<1.5);
  if(valid.length<4) return;
  const mn=Math.min(...valid),mx=Math.max(...valid);
  const bins=Math.max(15,Math.min(28,Math.round(Math.sqrt(valid.length))));
  const w=(mx-mn)/bins;
  const centers=[],density=[];
  for(let b=0;b<bins;b++){
    const lo2=mn+b*w,hi2=lo2+w;
    centers.push((lo2+hi2)/2);
    density.push(valid.filter(v=>v>=lo2&&(v<hi2||b===bins-1)).length/(valid.length*w));
  }
  const normalDens=centers.map(x=>Math.exp(-x*x/2)/Math.sqrt(2*Math.PI));
  _ch.hist=new Chart(document.getElementById('chart-hist'),{
    type:'bar',
    data:{
      labels:centers.map(c2=>c2.toFixed(1)),
      datasets:[
        {label:'Innovations',data:density,backgroundColor:c.acc+'3a',borderColor:c.acc+'80',borderWidth:1},
        {type:'line',showLine:true,label:'N(0,1)',data:normalDens,borderColor:c.red+'cc',
         backgroundColor:'transparent',pointRadius:0,borderWidth:1.6,tension:.4}
      ]
    },
    options:baseOpts({
      scales:{
        x:{title:{display:true,text:'Standardized Innovation',color:c.tx2},ticks:{maxTicksLimit:8,color:c.tx2},grid:{color:c.bd+'44'}},
        y:{title:{display:true,text:'Density',color:c.tx2},ticks:{color:c.tx2},grid:{color:c.bd+'44'}}
      }
    })
  });
}

// ── Normal Q-Q plot ──
function buildQQChart(z,gate){
  destroyChart('qq'); const c=tc();
  const valid=z.filter((_,i)=>!gate||gate[i]<1.5).sort((a,b)=>a-b);
  const N=valid.length; if(N<4) return;
  const pts=valid.map((v,i)=>({x:normalQ((i+0.5)/N),y:v}));
  const xMn=pts[0].x,xMx=pts[N-1].x;
  _ch.qq=new Chart(document.getElementById('chart-qq'),{
    type:'scatter',
    data:{datasets:[
      {label:'Observations',data:pts,backgroundColor:c.acc+'90',pointRadius:2.2,borderColor:'transparent'},
      {label:'Identity',type:'line',showLine:true,data:[{x:xMn,y:xMn},{x:xMx,y:xMx}],
       borderColor:c.red+'aa',backgroundColor:'transparent',pointRadius:0,borderWidth:1.4,borderDash:[5,4]}
    ]},
    options:baseOpts({
      scales:{
        x:{title:{display:true,text:'Theoretical N(0,1)',color:c.tx2},ticks:{color:c.tx2},grid:{color:c.bd+'44'}},
        y:{title:{display:true,text:'Empirical quantile',color:c.tx2},ticks:{color:c.tx2},grid:{color:c.bd+'44'}}
      }
    })
  });
}

// ── PACF (bar + significance bounds as lines) ──
function buildPACFChart(pacf,N){
  destroyChart('pacf'); const c=tc();
  const bound=1.96/Math.sqrt(Math.max(N,1));
  const lags=pacf.map((_,i)=>i+1);
  const cols=pacf.map(v=>Math.abs(v)>bound?c.red+'cc':c.acc+'66');
  const up=pacf.map(()=>bound), dn=pacf.map(()=>-bound);
  _ch.pacf=new Chart(document.getElementById('chart-pacf'),{
    type:'bar',
    data:{labels:lags,datasets:[
      {label:'PACF',data:pacf,backgroundColor:cols,borderColor:'transparent',borderWidth:0,order:2},
      {type:'line',showLine:true,label:'±95% CI',data:up,borderColor:c.grn+'88',
       backgroundColor:'transparent',pointRadius:0,borderWidth:1.1,borderDash:[4,4],order:1},
      {type:'line',showLine:true,label:'',data:dn,borderColor:c.grn+'88',
       backgroundColor:'transparent',pointRadius:0,borderWidth:1.1,borderDash:[4,4],order:1}
    ]},
    options:baseOpts({
      plugins:{legend:{labels:{filter:i=>i.datasetIndex<=1,color:c.tx2,boxWidth:10,padding:9}}},
      scales:{
        x:{title:{display:true,text:'Lag (beats)',color:c.tx2},ticks:{color:c.tx2},grid:{color:c.bd+'44'}},
        y:{title:{display:true,text:'Partial autocorrelation',color:c.tx2},ticks:{color:c.tx2},grid:{color:c.bd+'44'}}
      }
    })
  });
}

// ── Time-Rescaling KS plot (ECDF of innovations vs Uniform) ──
function buildKSChart(ksRes){
  destroyChart('ks'); const c=tc();
  const{u,N}=ksRes; if(!u||!u.length) return;
  const bound=1.36/Math.sqrt(N);
  const ecdf=[{x:0,y:0},...u.map((v,i)=>({x:v,y:(i+1)/N})),{x:1,y:1}];
  _ch.ks=new Chart(document.getElementById('chart-ks'),{
    type:'scatter',
    data:{datasets:[
      {type:'line',showLine:true,label:'Empirical CDF',data:ecdf,stepped:'before',
       borderColor:c.red,backgroundColor:'transparent',pointRadius:0,borderWidth:1.7},
      {type:'line',showLine:true,label:'Uniform CDF',data:[{x:0,y:0},{x:1,y:1}],
       borderColor:c.tx2+'70',backgroundColor:'transparent',pointRadius:0,borderWidth:1.1,borderDash:[5,4]},
      {type:'line',showLine:true,label:'KS bounds',data:[{x:0,y:bound},{x:1,y:1+bound}],
       borderColor:c.grn+'70',backgroundColor:'transparent',pointRadius:0,borderWidth:1,borderDash:[3,5]},
      {type:'line',showLine:true,label:'',data:[{x:0,y:-bound},{x:1,y:1-bound}],
       borderColor:c.grn+'70',backgroundColor:'transparent',pointRadius:0,borderWidth:1,borderDash:[3,5]}
    ]},
    options:baseOpts({
      plugins:{legend:{labels:{filter:i=>i.datasetIndex<=2,color:c.tx2,boxWidth:10,padding:9}}},
      scales:{
        x:{min:0,max:1,title:{display:true,text:'Uniform(0,1)',color:c.tx2},ticks:{color:c.tx2},grid:{color:c.bd+'44'}},
        y:{min:0,max:1,title:{display:true,text:'Empirical CDF',color:c.tx2},ticks:{color:c.tx2},grid:{color:c.bd+'44'}}
      }
    })
  });
}

// ── Instantaneous Entropy Production Rate ṡ(t) ──
function buildEPRChart(time,epr){
  destroyChart('epr'); const c=tc();
  const lab=time.map(t=>t.toFixed(1));
  const zero=epr.map(()=>0);
  // Positive = above-baseline thermodynamic load; negative = recovery phase
  const posData=epr.map(v=>v>0?v:0);
  const negData=epr.map(v=>v<0?v:0);
  _ch.epr=new Chart(document.getElementById('chart-epr'),{
    type:'line',
    data:{labels:lab,datasets:[
      {label:'',data:zero,borderColor:c.tx2+'30',backgroundColor:'transparent',
       pointRadius:0,borderWidth:1,borderDash:[4,4]},
      {label:'ṡ > 0  (load)',data:posData,
       borderColor:'transparent',backgroundColor:c.red+'28',fill:true,pointRadius:0,borderWidth:0},
      {label:'ṡ < 0  (recovery)',data:negData,
       borderColor:'transparent',backgroundColor:c.teal+'28',fill:true,pointRadius:0,borderWidth:0},
      {label:'Entropy production rate ṡ(t)',data:epr,
       borderColor:c.pur,backgroundColor:'transparent',
       pointRadius:0,borderWidth:1.7}
    ]},
    options:baseOpts({
      plugins:{legend:{labels:{filter:i=>i.datasetIndex>=1,color:c.tx2,boxWidth:10,padding:9}}},
      scales:{
        x:{title:{display:true,text:'Time (s)',color:c.tx2},ticks:{maxTicksLimit:8,color:c.tx2},grid:{color:c.bd+'44'}},
        y:{title:{display:true,text:'ṡ(t)  (s⁻¹)',color:c.pur},ticks:{color:c.tx2},grid:{color:c.bd+'44'}}
      }
    })
  });
}

// ── Phase-plane areal velocity — instantaneous dA/dt (duration-independent) ──
function buildArealVelChart(time,arealVel){
  destroyChart('arealvel'); const c=tc();
  const lab=time.map(t=>t.toFixed(1));
  const zero=arealVel.map(()=>0);
  // Positive = counter-clockwise sweep; negative = clockwise sweep
  const posData=arealVel.map(v=>v>0?v:0);
  const negData=arealVel.map(v=>v<0?v:0);
  _ch.arealvel=new Chart(document.getElementById('chart-arealvel'),{
    type:'line',
    data:{labels:lab,datasets:[
      {label:'',data:zero,borderColor:c.tx2+'30',backgroundColor:'transparent',
       pointRadius:0,borderWidth:1,borderDash:[4,4]},
      {label:'CCW sweep (+)',data:posData,
       borderColor:'transparent',backgroundColor:c.red+'28',fill:true,pointRadius:0,borderWidth:0},
      {label:'CW sweep (−)',data:negData,
       borderColor:'transparent',backgroundColor:c.teal+'28',fill:true,pointRadius:0,borderWidth:0},
      {label:'Areal velocity dA/dt',data:arealVel,
       borderColor:c.grn,backgroundColor:'transparent',
       pointRadius:0,borderWidth:1.7}
    ]},
    options:baseOpts({
      plugins:{legend:{labels:{filter:i=>i.datasetIndex>=1,color:c.tx2,boxWidth:10,padding:9}}},
      scales:{
        x:{title:{display:true,text:'Time (s)',color:c.tx2},ticks:{maxTicksLimit:8,color:c.tx2},grid:{color:c.bd+'44'}},
        y:{title:{display:true,text:'dA/dt (Hz²·s⁻¹)',color:c.grn},ticks:{color:c.tx2},grid:{color:c.bd+'44'}}
      }
    })
  });
}

// ═══════════════════════════════════════════════════════════
// §15  PARAMETER TABLE & METRIC GRID
// ═══════════════════════════════════════════════════════════
function renderParamTable(p,dm){
  const fmt=n=>isFinite(n)?n.toFixed(5):'—';
  const rows=[
    {n:'ν₀',     g:'Base',   gc:'g-base',interp:'Intrinsic SA node pacing rate absent autonomic tone (Hz)',val:p.nu0,  st:'Profiled — GLS'},
    {n:'σ²sys',  g:'Scale',  gc:'g-sc',  interp:'Global stochastic system variance multiplier',           val:p.sig2, st:'Profiled — GLS'},
    {n:'κ_S',    g:'Kinetic',gc:'g-kin', interp:'Clearance rate of sympathetic neurotransmitters (Hz)',   val:p.ks,   st:'Estimated — MAP'},
    {n:'κ_P',    g:'Kinetic',gc:'g-kin', interp:'Clearance rate of vagal neurotransmitters (Hz)',         val:p.kp,   st:'Estimated — MAP'},
    {n:'τ_S',    g:'Kinetic',gc:'g-kin', interp:'Sympathetic relaxation time constant (s)',               val:1/p.ks, st:'Derived'},
    {n:'τ_P',    g:'Kinetic',gc:'g-kin', interp:'Parasympathetic relaxation time constant (s)',           val:1/p.kp, st:'Derived'},
    {n:'σ_P',    g:'Volatil',gc:'g-vol', interp:'Absolute parasympathetic drive amplitude (Hz½)',         val:p.sigP, st:'Profiled — GLS'},
    {n:'σ_S',    g:'Volatil',gc:'g-vol', interp:'Absolute sympathetic drive amplitude (Hz½)',             val:p.sigS, st:'Profiled — GLS'},
    {n:'Λ_P',    g:'Ratio',  gc:'g-rat', interp:'HF/LF energy balance — Parseval-anchored vagal anchor', val:p.lp,   st:'Spectral — CWT'},
    {n:'Λ_R',    g:'Ratio',  gc:'g-rat', interp:'SA node threshold jitter fraction',                      val:p.lR,   st:'Estimated — MAP'},
  ];
  document.getElementById('param-tbody').innerHTML=rows.map(r=>`
    <tr><td class="pn">${r.n}</td><td><span class="gtag ${r.gc}">${r.g}</span></td>
    <td class="pv">${fmt(r.val)}</td><td class="pi">${r.interp}</td><td class="ps">${r.st}</td></tr>`).join('');

  const items=[
    {l:'Heart Rate',        v:(p.nu0*60).toFixed(1),      u:'bpm', hi:true, t:'m-hr'},
    {l:'τ Sympathetic',     v:(1/p.ks).toFixed(1),        u:'s',            t:'m-ts'},
    {l:'τ Parasympathetic', v:(1/p.kp).toFixed(2),        u:'s',            t:'m-tp'},
    {l:'κ_P / κ_S',         v:(p.kp/p.ks).toFixed(2),     u:'×',            t:'m-kpks'},
    {l:'HF/LF Energy',      v:p.lp.toFixed(3),            u:'',             t:'m-hflf'},
    {l:'σ_P / σ_S',         v:(p.sigP/p.sigS).toFixed(2), u:'×',            t:'m-sigs'},
    {l:'RMSSD (filtered)',  v:dm.rmssdFlt.toFixed(1),     u:'ms',           t:'m-rmssd'},
    {l:'SDNN (filtered)',   v:dm.sdnnFlt.toFixed(1),      u:'ms',           t:'m-sdnn'},
    {l:'Fit RMSE',          v:dm.rmse.toFixed(2),          u:'ms',           t:'m-rmse'},
    {l:'Gated beats',       v:dm.pctGated.toFixed(1),     u:'%',            t:'m-gate'},
    {l:'Areal Velocity',    v:dm.rmsArealVel.toFixed(5),  u:'Hz²/s',        t:'m-avel'},
    {l:'Mean EPR  ṡ̄',      v:dm.mEPR.toFixed(4),         u:'s⁻¹',         t:'m-mepr'},
    {l:'Balance σ',         v:dm.abiStd.toFixed(3),       u:'nats',         t:'m-bstd'},
  ];
  document.getElementById('metric-grid').innerHTML=items.map(it=>`
    <div class="mc${it.hi?' hi':''}">
      <div class="mc-lbl"><span>${it.l}</span><button class="info-btn" data-tip="${it.t}" aria-label="About ${it.l}">i</button></div>
      <div class="mc-val">${it.v}<span class="mc-unit"> ${it.u}</span></div>
    </div>`).join('');
}

// ═══════════════════════════════════════════════════════════
// §16  UI LOGIC
// ═══════════════════════════════════════════════════════════
let loadedRR=null, simParams=null, lastFit=null;

function parseRR(txt){
  // Parse all finite positive numbers
  const raw=txt.trim().split(/[\n\r,;\t ]+/)
    .map(s=>parseFloat(s.trim())).filter(v=>isFinite(v)&&v>0);
  if(!raw.length) return null;
  // Auto-detect unit: if the median value > 3 the data is almost certainly in ms
  const sorted=[...raw].sort((a,b)=>a-b);
  const median=sorted[Math.floor(sorted.length/2)];
  const wasMs=median>3;
  const vals=raw.map(v=>wasMs?v/1000:v).filter(v=>v>0.1&&v<3.0);
  return vals.length>=30?{vals,wasMs}:null;
}

// ── Theme toggle ──
function applyTheme(light){
  document.documentElement.dataset.theme=light?'light':'';
  document.getElementById('ico-sun').style.display=light?'none':'block';
  document.getElementById('ico-moon').style.display=light?'block':'none';
  chartDefaults();
  if(lastFit) rebuildAllCharts(lastFit);
}
document.getElementById('theme-btn').onclick=()=>{
  applyTheme(document.documentElement.dataset.theme!=='light');
};

// Init theme from OS preference
(()=>{
  const light=!window.matchMedia('(prefers-color-scheme: dark)').matches;
  if(light) document.documentElement.dataset.theme='light';
  document.getElementById('ico-sun').style.display=light?'none':'block';
  document.getElementById('ico-moon').style.display=light?'block':'none';
  chartDefaults();
})();

// ── Tab navigation ──
document.querySelectorAll('.tab-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{
    const tab=btn.dataset.tab;
    document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-'+tab).classList.add('active');
  });
});

// ── Collapsible panels ──
function initCollapse(hdrId,bodyId,arrId){
  const hdr=document.getElementById(hdrId),body=document.getElementById(bodyId),arr=document.getElementById(arrId);
  hdr.addEventListener('click',()=>{
    const open=body.classList.contains('hidden');
    body.classList.toggle('hidden',!open);
    arr.classList.toggle('closed',!open); arr.classList.toggle('open',open);
    hdr.classList.toggle('open',open); hdr.classList.toggle('closed',!open);
  });
}
initCollapse('hdr-opts','body-opts','arr-opts');
initCollapse('hdr-sim','body-sim','arr-sim');

// ── Drag-and-drop on drop zone ──
const dz=document.getElementById('drop-zone');
['dragenter','dragover'].forEach(e=>dz.addEventListener(e,ev=>{ev.preventDefault();dz.classList.add('over');}));
['dragleave','drop'].forEach(e=>dz.addEventListener(e,()=>dz.classList.remove('over')));
dz.addEventListener('drop',ev=>{ev.preventDefault();const f=ev.dataTransfer.files[0];if(f)readFile(f);});
document.getElementById('file-in').onchange=function(){
  if(this.files[0]) readFile(this.files[0]);
  this.value=''; // reset so selecting the same file again still fires onchange
};

function readFile(f){
  const r=new FileReader();
  r.onload=e=>{
    const res=parseRR(e.target.result);
    if(!res){showAlert('err','Could not parse file — need ≥30 RR values in seconds (0.1–3.0 s) or milliseconds (100–3000 ms).');return;}
    const{vals,wasMs}=res;
    setData(vals,f.name);
    showAlert('ok',`Loaded: ${f.name}  (${vals.length} beats${wasMs?' · auto-converted ms → s':''})` );
  };
  r.readAsText(f);
}

document.getElementById('btn-example').onclick=()=>{
  setData(genExampleRR(400),'Example data');
  showAlert('ok','Example dataset loaded — 400 synthetic beats. Click Run Analysis.');
};

function setData(rr,label){
  loadedRR=rr; simParams=null;
  const chip=document.getElementById('data-chip');
  chip.classList.add('ok');
  document.getElementById('data-chip-text').textContent=`${label} — ${rr.length} beats · ${rr.reduce((a,b)=>a+b,0).toFixed(1)} s`;
  document.getElementById('btn-run').disabled=false;
  document.getElementById('results-wrap').style.display='none';
  document.getElementById('empty-state').style.display='flex';
  document.getElementById('sim-result').style.display='none';
}

function setProgress(msg,pct){
  document.getElementById('prog-fill').style.width=pct+'%';
  document.getElementById('prog-text').textContent=msg;
}
function showAlert(type,msg){
  ['ok','err'].forEach(t=>{const el=document.getElementById('alert-'+t);el.textContent='';el.classList.remove('show');});
  const el=document.getElementById('alert-'+type); el.textContent=msg; el.classList.add('show');
}

// ── Hyperparameter sliders ──
document.getElementById('sl-jthr').oninput=function(){document.getElementById('v-jthr').textContent=parseFloat(this.value).toFixed(2);};
document.getElementById('sl-jpow').oninput=function(){document.getElementById('v-jpow').textContent=this.value;};

// ── Simulation sliders ──
function updateSimLabels(){
  const nu0=parseFloat(document.getElementById('sl-nu0').value);
  const ks=parseFloat(document.getElementById('sl-ks').value);
  const kp=parseFloat(document.getElementById('sl-kp').value);
  const nb=parseInt(document.getElementById('sl-nb').value);
  document.getElementById('v-nu0').textContent=Math.round(nu0*60)+' bpm';
  document.getElementById('v-ks').textContent=ks.toFixed(3)+' Hz';
  document.getElementById('v-kp').textContent=kp.toFixed(3)+' Hz';
  document.getElementById('v-nb').textContent=nb;
}
['sl-nu0','sl-ks','sl-kp','sl-nb'].forEach(id=>document.getElementById(id).addEventListener('input',updateSimLabels));
updateSimLabels();

function genSimRR(nu0,ks,kp,N,seed=42){
  let s=seed>>>0;
  const rng=()=>{s=Math.imul(s^s>>>15,1|s);s^=s+Math.imul(s^s>>>7,61|s);return((s^s>>>14)>>>0)/4294967296;};
  const rn=()=>Math.sqrt(-2*Math.log(rng()+1e-9))*Math.cos(2*Math.PI*rng());
  const Vs=0.025,Vp=0.11; let xs=0,xp=0; const rr=[];
  for(let i=0;i<N;i++){
    const dta=1/nu0;
    xs=xs*Math.exp(-ks*dta)+Math.sqrt(Vs*(1-Math.exp(-2*ks*dta)))*rn();
    xp=xp*Math.exp(-kp*dta)+Math.sqrt(Vp*(1-Math.exp(-2*kp*dta)))*rn();
    const nu=Math.max(nu0-xp+xs,0.4);
    rr.push(Math.max(0.3,Math.min(2.0,1/nu+0.012*rn())));
  }
  return rr;
}

document.getElementById('btn-sim').onclick=async function(){
  const nu0=parseFloat(document.getElementById('sl-nu0').value);
  const ks=parseFloat(document.getElementById('sl-ks').value);
  const kp=parseFloat(document.getElementById('sl-kp').value);
  const nb=parseInt(document.getElementById('sl-nb').value);
  if(kp<=ks){showAlert('err','κ_P must be greater than κ_S for a valid model.');return;}
  const rr=genSimRR(nu0,ks,kp,nb);
  setData(rr,'Simulated data');          // resets simParams→null, so assign after
  simParams={nu0,ks,kp};
  showAlert('ok',`Synthetic RR generated (ν₀=${Math.round(nu0*60)} bpm, κ_S=${ks.toFixed(3)}, κ_P=${kp.toFixed(3)}). Launching analysis…`);
  await new Promise(r=>setTimeout(r,80));
  document.getElementById('btn-run').click();
};

// ── Full chart rebuild (used on theme toggle) ──
function rebuildAllCharts(fit){
  if(!fit) return;
  chartDefaults();
  const dm=derivedMetrics(fit);
  buildRRChart(fit.time,fit.dy,fit.irr,fit.rrV,fit.gate);
  buildStatesChart(fit.time,fit.Xp,fit.Xs,fit.XpV,fit.XsV);
  buildPhaseChart(fit.Xp,fit.Xs,fit.params);
  buildABIChart(fit.time,dm.abi);
  buildTotalDriveChart(fit.time,dm.tad);
  buildEPRChart(fit.time,dm.epr);
  buildArealVelChart(fit.time,dm.arealVel);
  const psd=hrPSD(fit.dy,fit.irr,fit.time);
  buildPSDChart(psd.obs.freq,psd.obs.pow,psd.flt.freq,psd.flt.pow);
  _renderCWT();
  if(fit.innovations){
    const validZ=fit.innovations.filter((_,i)=>Array.from(fit.gate)[i]<1.5);
    const pacf=computePACF(validZ,20);
    const ks=ksTest(fit.innovations,fit.gate);
    buildHistChart(fit.innovations,fit.gate);
    buildQQChart(fit.innovations,fit.gate);
    buildPACFChart(pacf,validZ.length);
    buildKSChart(ks);
  }
}

// ── Main run button ──
document.getElementById('btn-run').onclick=async function(){
  if(!loadedRR) return;
  const btn=this; btn.disabled=true;
  document.getElementById('prog-outer').style.display='block';
  document.getElementById('results-wrap').style.display='none';
  ['ok','err'].forEach(t=>document.getElementById('alert-'+t).classList.remove('show'));

  const jThr=parseFloat(document.getElementById('sl-jthr').value);
  const jPow=parseFloat(document.getElementById('sl-jpow').value);

  setProgress('Extracting Morlet CWT spectral priors…',5);
  await new Promise(r=>requestAnimationFrame(r));
  await new Promise(r=>setTimeout(r,30));

  try{
    setProgress('Running BFGS optimization (3-D MAP)…  may take 5–15 s',15);
    await new Promise(r=>requestAnimationFrame(r));
    await new Promise(r=>setTimeout(r,30));

    const fit=fitModel(loadedRR,jThr,jPow);
    lastFit=fit;

    setProgress('Computing derived metrics and building charts…',82);
    await new Promise(r=>requestAnimationFrame(r));

    const dm=derivedMetrics(fit);
    renderParamTable(fit.params,dm);

    chartDefaults();
    buildRRChart(fit.time,fit.dy,fit.irr,fit.rrV,fit.gate);
    buildStatesChart(fit.time,fit.Xp,fit.Xs,fit.XpV,fit.XsV);
    buildPhaseChart(fit.Xp,fit.Xs,fit.params);
    buildABIChart(fit.time,dm.abi);
    buildTotalDriveChart(fit.time,dm.tad);
    buildEPRChart(fit.time,dm.epr);
    buildArealVelChart(fit.time,dm.arealVel);
    const psd=hrPSD(fit.dy,fit.irr,fit.time);
    buildPSDChart(psd.obs.freq,psd.obs.pow,psd.flt.freq,psd.flt.pow);
    buildCWTChart(fit);

    // Diagnostics
    let ksRes={D:NaN,p:NaN,u:[],N:0}, pacfArr=[];
    if(fit.innovations){
      const validZ=fit.innovations.filter((_,i)=>Array.from(fit.gate)[i]<1.5);
      pacfArr=computePACF(validZ,20);
      ksRes=ksTest(fit.innovations,fit.gate);
      buildHistChart(fit.innovations,fit.gate);
      buildQQChart(fit.innovations,fit.gate);
      buildPACFChart(pacfArr,validZ.length);
      buildKSChart(ksRes);
    }

    // Diagnostic chips
    const b95=1.96/Math.sqrt(Math.max(ksRes.N,1));
    const nViol=pacfArr.filter(v=>Math.abs(v)>b95).length;
    const ksOk=ksRes.p>0.05;
    document.getElementById('dchips').innerHTML=`
      <div class="dchip ${ksOk?'pass':'fail'}"><span class="dk">KS p-value</span><span class="dv">${isFinite(ksRes.p)?ksRes.p.toFixed(4):'—'}</span></div>
      <div class="dchip ${ksOk?'pass':'fail'}"><span class="dk">KS stat</span><span class="dv">${isFinite(ksRes.D)?ksRes.D.toFixed(4):'—'}</span></div>
      <div class="dchip ${nViol===0?'pass':nViol<=2?'warn':'fail'}"><span class="dk">PACF violations</span><span class="dv">${nViol}/20 lags</span></div>
      <div class="dchip ${dm.pctGated<5?'pass':dm.pctGated<15?'warn':'fail'}"><span class="dk">Gated beats</span><span class="dv">${dm.pctGated.toFixed(1)}%</span></div>
      <div class="dchip"><span class="dk">Fit RMSE</span><span class="dv">${dm.rmse.toFixed(2)} ms</span></div>
      <div class="dchip"><span class="dk">Fit MAPE</span><span class="dv">${dm.mape.toFixed(2)}%</span></div>`;

    // Simulation parameter recovery display
    if(simParams){
      const sp=simParams,ep=fit.params;
      const pars=[{n:'ν₀',tr:sp.nu0,est:ep.nu0},{n:'κ_S',tr:sp.ks,est:ep.ks},{n:'κ_P',tr:sp.kp,est:ep.kp}];
      document.getElementById('sim-tbody').innerHTML=pars.map(r=>{
        const d=100*(r.est-r.tr)/r.tr;
        const cls=Math.abs(d)<5?'dok':Math.abs(d)<15?'dpos':'dneg';
        return`<tr><td>${r.n}</td><td>${r.tr.toFixed(4)}</td><td>${r.est.toFixed(4)}</td><td class="${cls}">${d>0?'+':''}${d.toFixed(1)}%</td></tr>`;
      }).join('');
      document.getElementById('sim-result').style.display='block';
    }

    // Activate Overview tab
    document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
    document.querySelector('.tab-btn[data-tab="overview"]').classList.add('active');
    document.getElementById('tab-overview').classList.add('active');

    document.getElementById('empty-state').style.display='none';
    document.getElementById('results-wrap').style.display='block';
    setProgress('Complete ✓',100);
    showAlert('ok',
      `ν₀ = ${(fit.params.nu0*60).toFixed(1)} bpm · κ_S = ${fit.params.ks.toFixed(4)} Hz · κ_P = ${fit.params.kp.toFixed(4)} Hz · RMSSD = ${dm.rmssdFlt.toFixed(1)} ms`);
  } catch(e){
    setProgress('Error',0);
    showAlert('err','Analysis failed: '+e.message);
    console.error(e);
  }
  btn.disabled=false;
};


// ── Responsive chart resize ──
// Chart.js uses an internal ResizeObserver but it watches canvas parents only.
// Sidebar-width changes and CSS-grid reflows can shift layout without the
// observer firing. This debounced handler forces a resize on all active charts.
(()=>{
  let _rzTimer;
  function forceChartResize(){
    Object.values(_ch).forEach(c=>{try{c.resize();}catch(_){}});
    _renderCWT();
  }
  window.addEventListener('resize',()=>{
    clearTimeout(_rzTimer);
    _rzTimer=setTimeout(forceChartResize,80);
  });
  // Also handle orientation changes on mobile (fires separately from 'resize')
  window.addEventListener('orientationchange',()=>{
    clearTimeout(_rzTimer);
    _rzTimer=setTimeout(forceChartResize,200);
  });
  // Re-run after any sidebar collapse/expand animation finishes
  // (collapsible panels use CSS transitions)
  document.querySelectorAll('.panel-hdr').forEach(hdr=>{
    hdr.addEventListener('click',()=>{
      clearTimeout(_rzTimer);
      _rzTimer=setTimeout(forceChartResize,200);
    });
  });
})();


// ═══════════════════════════════════════════════════════════
// §  INFO TOOLTIP SYSTEM
// ═══════════════════════════════════════════════════════════

// ── Tooltip content dictionary ──
// Each entry: { title, formula (optional), body }
const TIPS = {
  // ── Metric cards ──────────────────────────────────────────
  'm-hr':{
    title:'Heart Rate (bpm)',
    formula:'HR = ν₀ × 60',
    body:'Intrinsic SA node pacing rate absent all autonomic tone. This is the baseline rate the sinoatrial node would maintain if both vagal and sympathetic influences were simultaneously removed — equivalent to the pharmacologically-blocked "zero-tone" rate observed in denervation studies.'
  },
  'm-ts':{
    title:'τ Sympathetic (s)',
    formula:'τ_S = 1 / κ_S',
    body:'Sympathetic neurotransmitter time constant. Controls how long after a neural burst the norepinephrine-mediated drive remains elevated at the SA node. Longer τ_S (10–30 s typical) produces the slow, sustained adrenergic responses characteristic of the fight-or-flight arc.'
  },
  'm-tp':{
    title:'τ Parasympathetic (s)',
    formula:'τ_P = 1 / κ_P',
    body:'Vagal acetylcholine clearance time constant. Acetylcholine is hydrolysed by AChE on the ms timescale, so τ_P ≪ τ_S physiologically (0.5–3 s). This kinetic asymmetry enables rapid beat-to-beat heart rate slowing and is the principal generator of high-frequency HRV.'
  },
  'm-kpks':{
    title:'κ_P / κ_S — Kinetic Asymmetry',
    formula:'κ_P / κ_S',
    body:'Ratio of autonomic clearance rates. Values substantially > 1 confirm the expected physiological asymmetry: vagal control operates orders of magnitude faster than sympathetic. This ratio determines the frequency separation between LF (sympathetic) and HF (parasympathetic) HRV bands.'
  },
  'm-hflf':{
    title:'HF/LF Energy Λ_P',
    formula:'Λ_P = E_HF / E_LF  [CWT-anchored]',
    body:'Parasympathetic-to-sympathetic spectral energy ratio estimated via Morlet continuous wavelet transform prior. Higher values indicate vagal dominance of HRV. Used by the Kalman filter as a prior on the relative amplitude of the two latent OU drivers.'
  },
  'm-sigs':{
    title:'σ_P / σ_S — Drive Amplitude Ratio',
    formula:'σ_P / σ_S = √(2κ_P Λ_P σ²sys) / √(2κ_S σ²sys)',
    body:'Ratio of absolute parasympathetic-to-sympathetic drive amplitudes. Reflects the relative excursion range of each branch around its resting level. Values > 1 mean vagal modulation is larger in amplitude; values < 1 indicate sympathetic predominance.'
  },
  'm-rmssd':{
    title:'RMSSD — filtered (ms)',
    formula:'RMSSD = 1000 · √( Σ(IRR_i − IRR_{i−1})² / (N−1) )',
    body:'Root mean square of successive differences computed on the Kalman-filtered RR series. By operating on the smoothed latent rate rather than raw beats, it isolates true autonomic variation from ectopic artifacts and measurement noise. Primary index of parasympathetic (vagal) tone.'
  },
  'm-sdnn':{
    title:'SDNN — filtered (ms)',
    formula:'SDNN = 1000 · std(IRR)',
    body:'Standard deviation of the Kalman-filtered NN intervals. Overall HRV magnitude index spanning all frequencies — both sympathetic (LF) and parasympathetic (HF) contributions. Computed on the smoothed latent cardiac rate estimate rather than raw observed beats.'
  },
  'm-rmse':{
    title:'Fit RMSE (ms)',
    formula:'RMSE = 1000 · √( Σ(ŷ_k − y_k)² / N )',
    body:'Root mean square error between the model-predicted and observed RR intervals. The principal measure of overall model fit quality. Values < 15 ms are typical for normal sinus rhythm with clean data; higher values may indicate complex arrhythmia, non-stationarity, or sensor artifacts.'
  },
  'm-gate':{
    title:'Gated Beats (%)',
    formula:'g_k = 1 + (max(|Δbk|,|Δfw|) / θ_jump)^p_jump',
    body:'Percentage of beats identified as non-sinus (ectopic, artifact, or rhythm change) and down-weighted by a power-law noise-inflation gate. For each beat, the larger of its backward and forward fractional RR change is computed; when this exceeds θ_jump the measurement noise is inflated by g_k, so the Kalman filter trusts those beats far less without hard exclusion. The steepness of the transition is controlled by p_jump.'
  },
  'm-avel':{
    title:'Areal Velocity (Hz²/s)',
    formula:'Ω_rms = √⟨ (½(X_P Ẋ_S − X_S Ẋ_P))² ⟩_t',
    body:'Root-mean-square instantaneous rate at which the (X_P, X_S) trajectory sweeps phase-plane area. Because it is a rate rather than a running total, its scale does not grow with recording duration or beat count, making it directly comparable across recordings of different length.'
  },
  'm-mepr':{
    title:'Mean EPR  ṡ̄ (s⁻¹)',
    formula:'ṡ̄ = ⟨κ_P(X_P²/V_P^ss−1) + κ_S(X_S²/V_S^ss−1)⟩_t',
    body:'Time-averaged stochastic entropy production rate derived from Ornstein-Uhlenbeck non-equilibrium statistical mechanics. Zero at thermodynamic equilibrium. Positive values confirm the autonomic system operates as an open dissipative system, expending continuous metabolic work to maintain ordered chronotropic rhythms against environmental perturbations.'
  },
  'm-bstd':{
    title:'Balance σ (nats)',
    formula:'σ_B = std( EMA[ ln(f(X_P)/f(X_S)) ] )',
    body:'Standard deviation of the smoothed Autonomic Log Balance Index. Indicates the volatility or dynamic range of the autonomic balance over the recording. High values suggest a highly reactive and fluctuating autonomic equilibrium; low values suggest a rigid, highly constrained balance.'
  },

  // ── Chart panels ──────────────────────────────────────────
  'c-rr':{
    title:'RR Interval — Observed vs. Filtered',
    formula:'y_k ~ N(1/ν(x_k), Λ_R/ν²)',
    body:'Observed beat-to-beat RR intervals (grey), Kalman-filtered latent rate estimate (red line) and 95% prediction interval (shaded band). Gated beats (ectopic, artifact, or rhythm change) are marked with triangles. The filter separates true autonomic variation from measurement noise and non-sinus events without hard-rejecting beats.'
  },
  'c-psd':{
    title:'Power Spectral Density',
    formula:'LF: 0.04–0.15 Hz  |  HF: 0.15–0.40 Hz',
    body:'PSD of observed (grey) vs. Kalman-filtered (coloured) RR series estimated via Welch periodogram. Red shading marks the LF band (mixed sympathetic/parasympathetic); teal marks HF (primarily vagal). Close overlap of empirical and model spectra validates the spectral assumptions embedded in the Λ_P prior.'
  },
  'c-cwt':{
    title:'Morlet CWT Time-Frequency Scalogram',
    formula:'W(s,τ) = ∫ x(t) ψ*_{s,τ}(t) dt  |  ψ(η) = π^{-¼} e^{iω₀η} e^{-η²/2}  (ω₀=6)',
    body:'Continuous Wavelet Transform of the 4 Hz-resampled, mean-removed heart rate signal using a Morlet mother wavelet (ω₀=6). Each pixel encodes log-power in the joint time-frequency plane: bright yellow = high power, dark purple/black = low power (inferno colormap). The frequency axis is inherently log-spaced (dyadic scale grid, dj=0.25). Dashed horizontal lines mark band boundaries at 0.04 Hz (VLF/LF) and 0.15 Hz (LF/HF); 0.40 Hz marks the upper edge of the HF band. Unlike the global PSD, the scalogram reveals transient oscillatory bursts, non-stationarities, and temporal evolution of autonomic rhythms that are invisible to stationary spectral analysis — making it the primary diagnostic for time-varying sympatho-vagal dynamics.'
  },
  'c-states':{
    title:'Latent Autonomic Drivers',
    formula:'dX_P = −κ_P X_P dt + σ_P dW_P',
    body:'Kalman-smoothed estimates of the latent parasympathetic X_P (teal) and sympathetic X_S (red) drives with 95% credible intervals. Units are Hz — the instantaneous contribution each branch makes to the cardiac pacing rate. Values above zero are excitatory (increased HR); below zero are inhibitory (decreased HR).'
  },
  'c-phase':{
    title:'Autonomic Phase Space Topology',
    formula:'(X_P(t), X_S(t)) ∈ ℝ²',
    body:'Two-dimensional trajectory of the latent state vector through time. Colour encodes temporal progression from dark (early) to bright plasma (late); connecting lines highlight the sequential path. Ellipses mark the 1σ and 2σ steady-state covariance regions. Loops indicate cyclic modulation; concentrated clusters indicate autonomic quiescence. Loop area and direction reveal time-reversal asymmetry.'
  },
  'c-abi':{
    title:'Log Autonomic Balance Index',
    formula:'f(x) = 0.5 + (1/π)atan(x/σ_ss); ABI(t) = EMA[ ln(f(X_P)/f(X_S)) ]',
    body:'Each latent drive is mapped to a strictly positive (0, 1) probability-like domain while preserving its sign: baseline maps to 0.5, autonomic activation approaches 1.0, and withdrawal approaches 0.0. The natural log-ratio of these shifted states prevents division-by-zero artifacts. Finally, an Exponential Moving Average (EMA) is applied for temporal stabilization, yielding a noise-resistant index of true physiological dominance (positive = vagal, negative = sympathetic).'
  },
  'c-tdrive':{
    title:'Total Autonomic Drive ‖x‖',
    formula:'‖x(t)‖ = √( X_P(t)² + X_S(t)² )',
    body:'Euclidean norm of the two-dimensional latent state vector. Quantifies overall autonomic activity magnitude independent of which branch dominates. High values reflect strong bidirectional modulation; low values reflect autonomic quiescence. Proportional to the instantaneous kinetic energy of the autonomic oscillator.'
  },
  'c-epr':{
    title:'Entropy Production Rate ṡ(t)',
    formula:'ṡ(t) = κ_P(X_P²/V_P^ss−1) + κ_S(X_S²/V_S^ss−1)',
    body:'Instantaneous stochastic entropy production rate in s⁻¹, derived from Ornstein-Uhlenbeck non-equilibrium statistical mechanics. Zero at steady state. Red shading (ṡ > 0) marks periods of thermodynamic load where both drives exceed their typical amplitudes; teal (ṡ < 0) marks recovery phases where drives are sub-typical. Serves as the instantaneous allostatic cost signal.'
  },
  'c-avel':{
    title:'Phase-Plane Areal Velocity (Smoothed)',
    formula:'dA/dt = EMA[ 0.5 (X_P·dX_S/dt − X_S·dX_P/dt) ]',
    body:'The smoothed instantaneous rate at which the autonomic state sweeps out area in the sympathetic-parasympathetic phase plane. An Exponential Moving Average (EMA) is applied to filter high-frequency derivative noise, revealing the true macroscopic envelope of autonomic volatility and state transitions. Being a rate rather than a running total, this metric is directly comparable across recordings of different length.'
  },
  'c-hist':{
    title:'Innovation Distribution',
    formula:'z_k = (y_k − ŷ_k) / σ_k  ~  N(0,1)?',
    body:'Histogram of standardised Kalman filter innovations. A well-specified model produces i.i.d. N(0,1) innovations (red curve). Systematic skew indicates mis-specified drift; heavy tails indicate outliers not fully captured by the gate function; an overly narrow distribution suggests over-smoothing or an inflated measurement noise parameter.'
  },
  'c-qq':{
    title:'Normal Q-Q Plot of Innovations',
    formula:'z_(k) vs Φ⁻¹(k / (N+1))',
    body:'Normal quantile-quantile plot of standardised innovations. Points on the diagonal (dashed) confirm Gaussian innovation distributions — a necessary condition for Kalman filter optimality. Deviations in the tails indicate outliers not fully captured by the gating; an S-shape indicates systematic non-Gaussianity in the underlying process.'
  },
  'c-pacf':{
    title:'Partial Autocorrelation — Innovations',
    formula:'Bounds: ± 1.96 / √N',
    body:'Partial autocorrelation function of standardised innovations at lags 1–20. A well-specified model should show all bars within the 95% confidence bounds (dashed lines). Bars exceeding the bounds indicate residual temporal structure the model has not captured. A large lag-1 bar often signals that a clearance rate κ is underestimated; periodic patterns suggest mis-specified oscillator frequency.'
  },
  'c-ks':{
    title:'Time-Rescaling KS Uniformity Test',
    formula:'u_k = 1 − exp(−∫_{t_{k-1}}^{t_k} λ(s) ds)  ~  U(0,1)?',
    body:'Time-rescaling goodness-of-fit test. Under the true model, transformed inter-event times u_k should be i.i.d. Uniform(0,1). The empirical CDF (red) should fall within the Kolmogorov-Smirnov confidence bands (green dashed). Departure above the diagonal indicates the model predicts rates that are too low; departure below indicates over-prediction.'
  },
};

// ── Tooltip controller ──────────────────────────────────────
(()=>{
  const tip=document.getElementById('info-tip');
  const tipTitle=tip.querySelector('.tip-title');
  const tipFormula=tip.querySelector('.tip-formula');
  const tipBody=tip.querySelector('.tip-body');
  let _hideTimer, _lastBtn=null;

  function positionTip(btn){
    const rect=btn.getBoundingClientRect();
    const tw=tip.offsetWidth||272;
    requestAnimationFrame(()=>{
      const th=tip.offsetHeight;
      let left=rect.left+rect.width/2-tw/2;
      let top=rect.bottom+9;
      // clamp horizontally within viewport
      left=Math.max(8,Math.min(left,window.innerWidth-tw-8));
      // flip above button if too close to bottom
      if(top+th>window.innerHeight-8) top=rect.top-th-9;
      // clamp vertically — flipped tooltip must not escape above viewport
      top=Math.max(8,top);
      tip.style.left=left+'px';
      tip.style.top=top+'px';
    });
  }

  function showTip(btn){
    clearTimeout(_hideTimer);
    const d=TIPS[btn.dataset.tip];
    if(!d) return;
    tipTitle.textContent=d.title||'';
    tipTitle.style.display=d.title?'block':'none';
    tipFormula.textContent=d.formula||'';
    tipFormula.style.display=d.formula?'block':'none';
    tipBody.textContent=d.body||'';
    tip.classList.add('show');
    _lastBtn=btn;
    positionTip(btn);
  }

  function hideTip(){
    _hideTimer=setTimeout(()=>{tip.classList.remove('show');_lastBtn=null;},90);
  }

  // Hover (desktop)
  document.addEventListener('mouseenter',e=>{
    if(e.target.classList?.contains('info-btn')) showTip(e.target);
  },true);
  document.addEventListener('mouseleave',e=>{
    if(e.target.classList?.contains('info-btn')) hideTip();
  },true);

  // Focus (keyboard navigation)
  document.addEventListener('focusin',e=>{
    if(e.target.classList?.contains('info-btn')) showTip(e.target);
  });
  document.addEventListener('focusout',e=>{
    if(e.target.classList?.contains('info-btn')) hideTip();
  });

  // Click — toggle on mobile, dismiss on outside click
  document.addEventListener('click',e=>{
    if(e.target.classList?.contains('info-btn')){
      e.stopPropagation();
      if(tip.classList.contains('show')&&_lastBtn===e.target){hideTip();}
      else showTip(e.target);
    } else if(!tip.contains(e.target)){
      hideTip();
    }
  });

  // Hide on scroll (prevents stale tooltip positions)
  window.addEventListener('scroll',hideTip,{passive:true,capture:true});
  window.addEventListener('resize',hideTip,{passive:true});
})();

// ── Inject info buttons into chart card labels ─────────────
// Maps canvas id → TIPS key; runs once after DOM is ready.
(()=>{
  const chartMap={
    'chart-rr':'c-rr','chart-psd':'c-psd',
    'chart-cwt':'c-cwt',
    'chart-states':'c-states','chart-phase':'c-phase',
    'chart-abi':'c-abi','chart-totaldrive':'c-tdrive',
    'chart-epr':'c-epr','chart-alloload':'c-load',
    'chart-hysteresis':'c-hyst','chart-arealvel':'c-avel',
    'chart-hist':'c-hist','chart-qq':'c-qq',
    'chart-pacf':'c-pacf','chart-ks':'c-ks',
  };
  document.querySelectorAll('.cc').forEach(cc=>{
    const canvas=cc.querySelector('canvas');
    if(!canvas) return;
    const key=chartMap[canvas.id];
    if(!key) return;
    const lbl=cc.querySelector('.cc-lbl');
    if(!lbl||lbl.querySelector('.info-btn')) return;
    const btn=document.createElement('button');
    btn.className='info-btn';
    btn.dataset.tip=key;
    btn.setAttribute('aria-label','About this chart');
    btn.textContent='i';
    lbl.appendChild(btn);
  });
})();
