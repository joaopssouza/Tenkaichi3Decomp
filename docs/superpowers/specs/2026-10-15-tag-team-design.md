# Tag Team no port WebAssembly — design

Data: 2026-10-15 · Autor do pedido: João Paulo · Estado: aprovado em 2026-10-15

## 1. Intenção

João quer jogar Budokai Tenkaichi 3 com amigos, online pelo próprio site (`bt3.jpdev.uk`, servidor
Optiplex), com **vários lutadores no mapa ao mesmo tempo**, como no Tag Team Mod do The Mufti para
PCSX2 (prints de referência: `Captura de tela 1/2/3.png` na raiz do repositório). Hoje o mod só existe
para emulador (PCSX2) e para um runtime nativo de Windows (Pyrosea98). O objetivo é ter isso no port
WebAssembly dele, no navegador, sem emulador.

Por que agora: houve várias tentativas anteriores (commits `eee3a93`, `a0493cd`, `017533b`, feitos por
outro agente) que adivinharam mudanças no motor sem evidência. Cada uma trouxe um problema novo, e a
última impediu o jogo de iniciar até no 1v1 (corrigido na etapa 0, ver §7). Este design troca o
"adivinhar" por "traduzir o que o mod comprovadamente faz".

## 2. Objetivos, não-objetivos, anti-objetivos

**Objetivos**
- Uma entrada nova "Tag Team" (no menu do jogo e no site) que leva a um ambiente próprio: lobby,
  seleção de personagens, seleção de mapa e luta com até 4 lutadores simultâneos.
- Dois modos: **2 contra 2** (por times) e **Todos contra Todos**.
- Online entre navegadores, pelo portal e servidor de sinalização que já existem.
- **Funciona no celular também** (decisão do João): computador, Android e iPhone/Safari, nos dois builds
  (`bt3-jspi` e `bt3-async`), com controles de toque, numa mesma partida misturando aparelhos.
- Bots (CPU) preenchendo vagas.
- Depois da base funcionando: os recursos do mod, um por vez (§6, etapa 4+), cada um só entra depois de
  implementado, testado e validado.

**Não-objetivos**
- Rodar o mod original (Python + payloads MIPS) no navegador, ou recompilar o executável original
  (`tools/ps2-web-recomp`). Decisão do João: construir dentro do port atual.
- Suporte a BT4 ou ao Power Scale. Alvo: o disco que o port já usa (SLUS-21678, tradução PT-BR).
- Os menus/telas do mod como estão. Lobby e menus são próprios (§3), no estilo visual dos prints.

**Anti-objetivos (falha mesmo que "funcione")**
- Quebrar o 1v1 atual (offline ou online) ou o boot do jogo. O modo normal de versus continua igual e
  não é usado pelo Tag Team.
- Mudanças no motor sem evidência: cada mudança de comportamento tem que apontar o que o mod faz
  (endereço/hook) e o símbolo equivalente no decomp, ou uma medição no port.
- Declarar uma etapa pronta sem a validação descrita para ela.

## 3. Experiência do jogador (aprovada pelo João)

Mockup aprovado: `.superpowers/brainstorm/809-1792085260/content/fluxo-sala.html`.

1. **Criar sala**: pelo menu do jogo ou pelo site. Quem cria é o **dono**. Código de 4 letras, como hoje.
2. **Lobby**: escolha do modo (2v2 / Todos contra Todos). As vagas mostram quem entrou e o estado
   (pronto/aguardando). Cada vaga livre, o dono define como **Bot**, **Vazia** (ninguém luta ali,
   permite 2v1) ou **Aberta** (esperando alguém entrar pelo código). Só o dono vê os controles das vagas
   e o botão "Confirmar e começar", que acende quando todos estão prontos.
3. **Carregando**: todos carregam juntos; a tela mostra quem ainda está carregando.
4. **Seleção de personagens**: cada pessoa escolhe o próprio lutador e vê os outros escolhendo ao vivo.
   O lutador de um bot é escolhido **pela pessoa do mesmo time do bot** (no time do dono, o dono; num
   2x1, a pessoa sozinha do outro lado escolhe o bot dela). Num time só de bots, o dono escolhe.
5. **Mapa**: o dono escolhe; os outros veem "O dono está escolhendo o mapa…".
6. **Tela "Team Battle"** (os dois times lado a lado, como o print 2) e então a luta.
7. **Luta**: todos no mapa ao mesmo tempo; cada pessoa tem câmera e HUD no próprio lutador; os outros
   lutadores aparecem com **barra de vida sobre a cabeça** (azul = time 1, laranja = time 2; no Todos
   contra Todos, uma cor por adversário — escolha do builder).

**Regras de morte e de vitória**
- **2v2**: quando uma pessoa morre e o parceiro é uma pessoa, ela **assiste o parceiro** (câmera nele).
  Quando o parceiro é um bot, ela **assume o controle do bot** (a CPU desliga nesse lutador) e continua.
  A partida acaba quando **todos os membros de um time** estão sem vida.
- **Todos contra Todos**: quem morre vira **espectador** (não assume bot).

## 4. Restrições técnicas (verificadas)

- O port é o jogo **descompilado à mão para C**, compilado para WebAssembly (`port/web/build.py`,
  `link.py`; build no Optiplex com `docker run emscripten/emsdk`). Funções e dados **não** estão nos
  endereços originais do PS2, então os patches do mod não podem ser aplicados diretamente.
- O decomp tem mapas de símbolos com os endereços originais: `config/symbols/*.txt` (~13 mil símbolos,
  ~7,6 mil funções) e `config/symbol_addrs.txt`. É a ponte entre um endereço que o mod altera e a
  função/variável correspondente no C.
- Memória: o `malloc` do jogo (`Port_Malloc`, `port/src/plat_mem.c`) é um bump allocator sobre a
  região `0x003BE000–0x02000000` (~28 MB), já quase toda tomada pelo heap 0 (`Heap_Create`,
  `src/sys/heap.c`). Pedir mais que isso mata o programa no boot (`exit(2)`), que foi a regressão da
  etapa 0. O build web tem 640 MB iniciais (`-sINITIAL_MEMORY=640MB`, crescimento até 2 GB).
- O mod precisa de **memória além dos 32 MB do PS2**: o runtime nativo dele usa 128 MB de RAM de guest
  e coloca código/dados extras acima de `0x02000000` (ex.: `0x06C10000`, `0x06C3F000`, `0x06933000`;
  ver `tools/BT3-TagTeam-Native/docs/NATIVE_PORT_ASSESSMENT.md` e `NATIVE_P3_P4_BRIEF.md`). No port,
  memória extra tem que ser uma **região nova mapeada à parte**, não algo tirado do heap 0.
- O jogo original só lê as portas de controle 0 e 1. O mod alimenta os assentos 3 e 4 por uma caixa de
  correio privada (mesmos documentos acima). No port, os assentos 3/4 vêm da rede ou da CPU.
- Netplay atual: lockstep de entradas (`port/src/gs/net.c`), WebRTC data channel ou relay pelo servidor
  (`port/web/net.js`, `port/matchmaking/server.js`). Já existe código parcial para 4 jogadores
  (`sIn[4]`, `sNumPlayers`, salas host/join/p3/p4) feito nas tentativas anteriores, sem validação real.
- Lockstep exige que a simulação seja **determinística** nos navegadores: mesmas entradas → mesmo
  estado. Bots precisam rodar dentro da simulação compartilhada (não numa máquina só).
- Celular: 4 lutadores pesam mais que 2 em CPU, memória e desenho. Telefones usam um cache de disco menor
  (`webCacheBudget` 256 MB em `runtime.html`) e o iPhone usa o build Asyncify (`bt3-async`), mais lento.
  O orçamento de desempenho de cada etapa é medido também em celular; lockstep faz o aparelho mais
  lento ditar o ritmo de todos.
- Produção: só o João usa; pode ser alterada sem pedir (fazer backup e verificar). Telemetria das
  partidas em `https://bt3.jpdev.uk/net/stat`. URL local: `http://192.168.1.3:4500/`.

## 5. Abordagem (decidida com o João)

Construir dentro do port atual, usando o mod como **referência do que mudar**:

1. Levantar, a partir do código do mod (`tools/Tag.Team.Mod.0.1.0-beta.13.3/.../player-payload/bt3-usa/tools/*.py`,
   ~100 mil linhas, ~93 `write_u32` e escritas de payload MIPS; e `tools/BT3-TagTeam-Native/controller`),
   **cada endereço que o mod lê, escreve ou desvia**, e o que ele faz ali.
2. Traduzir cada endereço para o símbolo do decomp (`config/symbols`). Usar as ferramentas REA
   (`reverse-engineer-anything`) para os payloads MIPS e para conferir funções no executável original.
3. Implementar o comportamento equivalente em C no decomp/port, guardado pelo modo Tag Team, para que
   o 1v1 fique intocado.
4. Validar cada mudança com teste automatizado e uma partida.

As mudanças do Tag Team que já estão na árvore (commits `eee3a93`, `a0493cd`, `017533b`) são
**auditadas** na etapa 1 contra essa evidência: o que tem respaldo fica; o que não tem, ou altera o 1v1,
sai.

## 6. Etapas

Cada etapa termina com uma versão que o João pode testar, e passa pelo ciclo: plano → testes primeiro
→ implementação → verificação com evidência. Uma etapa só começa quando a anterior foi validada.

**Etapa 0 — Destravar o boot (feita em 2026-10-15).** Revertido o Heap 1 de 64 MB em `src/sys/heap.c`;
teste `test/boot_smoke.test.js`; implantado em produção e verificado.

**Etapa 1 — Motor com vários lutadores, offline.** Uma pessoa contra bots, no próprio navegador, sem
lobby nem rede, entrando por uma porta de teste (ex.: parâmetro de URL ou variável `BT3_*`; escolha do
builder). Inclui: o levantamento do §5; a região de memória extra; até 4 lutadores carregados e
desenhados juntos; CPU para os bots; mira/alvo entre vários adversários; câmera e HUD do jogador local;
barra de vida sobre a cabeça; as regras de morte e de vitória do §3 nos dois modos.
*Validação*: teste automatizado que inicia uma luta de 4 e confere (por funções de consulta exportadas
do wasm) que os 4 lutadores existem, estão em posições válidas e distintas, se movem e levam dano; cenários
de morte (assistir / assumir bot / espectador) e de fim de partida; boot e 1v1 continuam passando;
partida jogada pelo João (você contra 3 bots, nos dois modos), no computador e num celular, nos dois
builds (`bt3-jspi` e `bt3-async`), sem queda de quadros que torne a luta injogável (meta: ~60 fps no
computador; no celular, o builder mede a linha de base do 1v1 no mesmo aparelho e a luta de 4 não pode
ficar muito abaixo dela — o número exato é definido no plano após a medição).

**Etapa 2 — Online com 3–4 pessoas.** Lockstep para N jogadores, bots dentro da simulação compartilhada,
assumir bot e espectador funcionando em rede, queda de conexão tratada (§8).
*Validação*: teste de determinismo (duas execuções com as mesmas entradas dão o mesmo estado; existe
`port/tools/compare_state.py`); teste do servidor de sinalização para N jogadores; partida real com 4
navegadores (pode ser na mesma máquina) acompanhada pela telemetria `/net/stat` (`mode` de batalha,
`fps` ~60, fila `q` sem crescer), e outra com pelo menos um celular entre os participantes.

**Etapa 3 — Lobby e menus.** O fluxo completo do §3: entrada no menu do jogo e no site, lobby com
vagas, seleção de personagens, mapa, tela "Team Battle".
*Validação*: testes do servidor para o protocolo do lobby; teste de navegador do fluxo; partida
completa com amigos.

**Etapa 4+ — Recursos do mod, um por vez.** Ordem proposta (o João não fez questão de nenhum; ordem é
do builder, mas cada um é uma etapa própria com plano e validação): troca de alvo e golpes com vários
adversários, golpes/assistência em dupla, reviver o parceiro, transformações com lutadores extras,
fusões, CPU tática do mod, demais recursos listados em `tools/BT3-TagTeam-Native/docs`.

## 7. Decisões que tomei (o João pode revisar)

- Máximo de **4 lutadores** por partida nos dois modos.
- Todos contra Todos termina quando sobra **um lutador de pé** (pessoa ou bot).
- Espectador pode alternar qual lutador assiste.
- Ao assumir um bot, a pessoa herda a vida e a energia que ele tinha naquele momento.
- Se alguém cair da conexão no meio da luta, o lutador dele vira bot e a partida segue.
- Na etapa 1 a porta de entrada é de teste (sem menu); o menu de verdade é da etapa 3.
- O 1v1 não compartilha caminho de código novo: tudo do Tag Team fica atrás do modo Tag Team.
- Tempo de luta padrão **infinito** (como no print 3); o dono pode mudar no lobby com as mesmas opções
  de tempo do versus atual.
- Bots no nível de dificuldade normal do jogo; escolha de dificuldade fica para uma etapa 4+.
- Personagens/formas que estourarem a memória com lutadores extras ficam bloqueados para lutadores
  extras até serem resolvidos (o runtime nativo do mod faz o mesmo, ex.: Mega Instinct Vegeta).

## 8. Deixado para quem constrói

- Como mapear a região de memória extra no wasm (endereço, tamanho, convivência com `GLOBAL_BASE`).
- O formato da porta de teste da etapa 1 e das funções de consulta para os testes.
- Posições de nascimento, comportamento de câmera no detalhe, cores no Todos contra Todos.
- O protocolo de rede do lobby e o formato das mensagens para N jogadores.
- Ordem interna dos recursos da etapa 4+.

## 9. Referências

- Mod (PCSX2): `tools/Budokai-Tenkaichi-3-Tag-Team-Mod-PCSX2`, release `tools/Tag.Team.Mod.0.1.0-beta.13.3`.
- Runtime nativo e especificações: `tools/BT3-TagTeam-Native` (docs: `NATIVE_PORT_ASSESSMENT.md`,
  `NATIVE_P3_P4_BRIEF.md`, `OVERHEAD_HUD_SPEC.md`, `CPU_TACTICS_SPEC.md`, `FUSION_CONTROL_SPEC.md`,
  `MODE_SCREENS_SPEC.md`), `tools/BT3-TagTeam-Runtime`.
- Plano/estado anterior (outro agente, sem validação): `docs/TAG_TEAM_PLAN.md`.
- Depuração em produção: telemetria `/net/stat`; teste de boot `test/boot_smoke.test.js`.
