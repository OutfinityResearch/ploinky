window.LE_AUDIO = (function(){
  let ctx;
  function ac(){ try{ ctx = ctx || new (window.AudioContext||window.webkitAudioContext)(); }catch(_){ ctx=null; } return ctx; }
  function envGain(duration=0.2){ const a=ac(); if(!a) return null; const g=a.createGain(); g.gain.setValueAtTime(0,a.currentTime); g.gain.linearRampToValueAtTime(0.8, a.currentTime+0.01); g.gain.exponentialRampToValueAtTime(0.001, a.currentTime+duration); g.connect(a.destination); return g; }
  function playDing(){ const a=ac(); if(!a) return; const osc=a.createOscillator(); const g=envGain(0.25); osc.type='sine'; osc.frequency.setValueAtTime(660, a.currentTime); osc.frequency.exponentialRampToValueAtTime(880, a.currentTime+0.2); osc.connect(g); osc.start(); osc.stop(a.currentTime+0.22); }
  function playBuzz(){ const a=ac(); if(!a) return; const osc=a.createOscillator(); const g=envGain(0.3); osc.type='square'; osc.frequency.setValueAtTime(120, a.currentTime); osc.frequency.linearRampToValueAtTime(90, a.currentTime+0.25); osc.connect(g); osc.start(); osc.stop(a.currentTime+0.28); }
  return { playDing, playBuzz };
})();

