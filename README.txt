PARTYBLOX — BUILD COMPLETA

Arquivos principais:
- index.html
- server.js
- package.json
- games/tictactoe.html
- games/chess.html
- games/checkers.html
- games/snes.html
- games/games.json
- games/roms/

Correções desta build:
1. Botão LIMPAR: somente o host pode limpar; o estado "clear" é enviado para todos e o servidor zera o dono da tela.
2. Upload principal continua em chunks de 10 MB, compatível com o server atual.
3. Upload principal: limite do servidor de 3 GB.
4. Chat: limite de 300 MB.
5. Super Nintendo adicionado na aba Jogos.
6. O servidor cria/lista automaticamente games/roms e aceita .sfc/.smc.
7. O emulador usa EmulatorJS no navegador. A ROM não é enviada pelo WebSocket e não interfere no telão.
8. Para usar ROMs, coloque arquivos que você possui/autorizou em games/roms/.

Instalação:
npm install
npm start

Abra:
http://localhost:3000

IMPORTANTE:
O emulador SNES depende do carregamento do EmulatorJS via CDN.
Cada jogador pode jogar localmente enquanto continua assistindo ao telão.
O estado dos jogos existentes (xadrez/damas/velha) continua sendo sincronizado pelo WebSocket.
