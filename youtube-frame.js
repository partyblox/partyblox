(function(){
  function getVideo(){ return document.querySelector('video.html5-main-video, video'); }
  async function open(){
    const v=getVideo();
    if(!v || typeof v.requestPictureInPicture!=='function') return false;
    try{
      if(document.pictureInPictureElement===v) return true;
      await v.requestPictureInPicture();
      return true;
    }catch(err){
      console.warn('[PartyBlox PiP] PiP nativo recusado:',err);
      return false;
    }
  }
  async function exit(){
    try{ if(document.pictureInPictureElement) await document.exitPictureInPicture(); }catch(_){}
  }
  function status(event){
    try{ window.top.postMessage({source:'partyblox-native-pip-status',event},'*'); }catch(_){}
  }
  document.addEventListener('enterpictureinpicture',()=>status('entered'),true);
  document.addEventListener('leavepictureinpicture',()=>status('left'),true);
  window.addEventListener('message',async e=>{
    if(!e.data||e.data.source!=='partyblox-native-pip') return;
    if(e.data.action==='open') await open();
    if(e.data.action==='exit') await exit();
  });
})();
