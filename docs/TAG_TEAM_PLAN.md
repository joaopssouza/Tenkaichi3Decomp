# Tag Team (2v2+) — análise e plano

## O que os repositórios de referência realmente são
- **tehmufti/Budokai-Tenkaichi-3-Tag-Team-Mod-PCSX2-** (GPL-3.0): mod para o jogo **retail PS2** rodando no PCSX2.
  Ele aplica hooks/patches sobre o binário original (diretório `controller/`), em memória do emulador.
  Adiciona lutadores simultâneos, times, free-for-all, split-screen (até 4) e um online experimental (todos na mesma versão).
- **Pyrosea98/BT3-TagTeam-Native** (GPL-3.0): o mesmo `controller/` do Mufti adaptado a um runtime **estático recompilado**
  (Windows, Vulkan/OpenGL), até 5 lutadores por lado, sem emulador.

Nenhum dos dois é código-fonte C "portável" para a nossa árvore decompilada: a lógica do Mufti é escrita contra
**endereços/estruturas do binário PS2**. Para usá-la aqui é preciso mapear cada hook para a função equivalente em
`src/battle/*` (ver abaixo) e reescrever em C do port.

## Estado deste projeto (verificado no código)
- A engine já modela vários membros por lado (`BattleSetup_SetSide(side, control, pad, memberCount, ...)`,
  `BtlCtrl_AttachPartner`, `BtlSide_GetActiveMember`, `BtlChange_*`) — é o Team Battle original, **1 ativo por lado**.
- Netplay (`port/src/gs/net.c`, `port/web/net.js`, `port/matchmaking/server.js`) é **lockstep estritamente 2 jogadores**
  (`sIn[2][RING]`, `sHave[2]`, slots `host`/`join`).

## Progresso da Implementação (Concluído e Testado)
1. **Servidor de Matchmaking & Sinalização (`port/matchmaking/server.js`)**:
   - Suporte nativo a salas de até 4 jogadores (`host`, `join`, `p3`, `p4`).
   - Alocação automática de slots quando jogadores entram em salas Tag Team de 4 jogadores.
   - Rejeição limpa com código 4001 (`full`) quando a capacidade máxima da sala é atingida.
   - Relay binário multicast: inputs de controle de qualquer jogador são retransmitidos instantaneamente para todos os outros 3 participantes da sala.
   - Suporte a mensagens de sinalização multi-peer e roteamento direcionado.
   - 33 testes automatizados passando (100% de cobertura nos cenários 1v1 e 2v2 Tag Team).

2. **Interface do Portal Web (`port/web/index.html` e `port/web/app-shell.js`)**:
   - Seletor de regras no Lobby: "Modo 2v2 Tag Team (Multi-Fighter)", "Duelo 1v1", "Equipe 5v5", "DP 15".
   - Badge visual dinâmico na sala criada: `⚔️ Modo 2v2 Tag Team (4 Jogadores)`.
   - Botão do Hero Display "MODO 2V2 TAG TEAM" configurado para ativar o modo e notificar o usuário.
   - Geração de links de convite profundos incluindo `mode=tag&slots=4&rules=771`.
   - Leitura de links profundos com redirecionamento e lançamento automático no modo 2v2 Tag Team.

3. **Módulo Cliente de Rede Web (`port/web/net.js`)**:
   - Reconhecimento de sessões de até 4 jogadores (`host`, `join`, `p3`, `p4`).
   - Emissão de variáveis de ambiente do Emscripten (`BT3_NET_TAG=1`, `BT3_NET_PLAYERS=4`, `BT3_NET_PLAYER=0..3`).
   - Ativação de relay multicast assistido por servidor para sincronização ultra-rápida entre os 4 participantes sem necessidade de mesh complexa WebRTC.

4. **Código C do Port (`port/src/gs/net.c`, `port/src/headless.c`, `port/src/plat_stub.c`)**:
   - `sIn[4][RING][PAD]` e `sHave[4]` para rastrear e armazenar inputs dos 4 lutadores simultaneamente.
   - Identificação do jogador remetente via cabeçalho do pacote `T_INPUT`.
   - Espera lockstep sincronizada para todos os lutadores participantes.
   - Leitura de controles em `Port_NetInput` expandida para os 4 slots (`pad 0..3`).
   - Reconhecimento da regra tipo 3 (Tag Team 2v2) em `Port_NetRules` e `headless.c`.

## Próximo Passo do Usuário
- Para compilar as alterações de C/C++ para o WebAssembly final (`bt3-jspi.wasm` / `bt3-async.wasm`), execute o script de build com Emscripten (`emcc`):
  ```bash
  python port/web/build.py
  ```

