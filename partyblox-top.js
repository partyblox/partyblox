(function(){
  const isTop=window.top===window;
  if(!isTop)return;
  function findYouTubeFrames(){
    return [...document.querySelectorAll('iframe')].filter(f=>{
      try{return /(^|\\.)youtube(?:-nocookie)?\\.com$/i.test(new URL(f.src,location.href).hostname)}catch(_){return false;}
    });
  }
  function relay(action){
    for(const frame of findYouTubeFrames()){
      try{frame.contentWindow.postMessage({source:'partyblox-native-pip',action},'*');}catch(_){}
    }
  }
  window.addEventListener('message',e=>{
    if(e.source!==window||e.origin!==location.origin||!e.data||e.data.source!=='partyblox')return;
    if(e.data.action==='openNativeYouTubePiP')relay('open');
    if(e.data.action==='exitNativeYouTubePiP')relay('exit');
  });
  // Também observa o botão caso a página tente abrir o PiP diretamente.
  document.addEventListener('click',e=>{
    const b=e.target&&e.target.closest&&e.target.closest('#pipBtn');
    if(!b)return;
    setTimeout(()=>relay('open'),0);
  },true);
})();
