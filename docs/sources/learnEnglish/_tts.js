window.LE_TTS = (function(){
  const supports = typeof window.speechSynthesis !== 'undefined';
  let last;
  function speak(text){
    if(!supports) return; 
    try{ if(last){ window.speechSynthesis.cancel(); } }catch(_){ }
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = 0.9;
    u.pitch = 1.1;
    u.volume = 1.0;
    last = u; window.speechSynthesis.speak(u);
  }
  return { speak, supported: supports };
})();

