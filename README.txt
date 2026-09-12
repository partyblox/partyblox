PARTYBLOX - PiP + TELA FLUTUANTE

Esta versão mantém a janela "Flutuante" dentro da página e adiciona o botão "⧉ PiP".

PICTURE-IN-PICTURE (PiP):
- O botão PiP usa o Picture-in-Picture nativo do navegador.
- Em vídeos enviados e compartilhamento de tela, a janela PiP pode ficar sobre outras janelas.
- Assim, você pode minimizar o navegador e continuar vendo o vídeo na janela PiP.
- A janela PiP é controlada pelo próprio navegador/Windows e pode ser reposicionada/redimensionada conforme o navegador permitir.
- Para YouTube, o vídeo está dentro de um iframe; o botão do PartyBlox não consegue chamar requestPictureInPicture() diretamente no iframe. Use o botão PiP do próprio player do YouTube quando disponível.
- Imagens e áudio puro não podem usar o PiP nativo como um vídeo sem criar uma composição de vídeo artificial.

TELA FLUTUANTE:
- "🪟 Flutuante" continua sendo a janela dentro do site.
- Pode arrastar e redimensionar.
- Para ficar visível mesmo com o navegador minimizado, use "⧉ PiP".

EXECUÇÃO:
npm install
npm start
