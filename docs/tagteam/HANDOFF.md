# Tag Team — passagem para a próxima sessão (2026-10-16)

Leia primeiro: `docs/superpowers/specs/2026-10-15-tag-team-design.md` (design aprovado),
`docs/superpowers/plans/2026-10-15-tag-team-stage1b-engine.md` (plano da etapa 1B, concluído),
`docs/tagteam/core-mechanism.md` (como o mod funciona), ledger `.superpowers/sdd/2026-10-15-tag-team-stage1b-engine/progress.md`
(decisões de cada task, com o custo se estiverem erradas).
O usuário pediu: executar tudo sem perguntar, usar REA nas partes difíceis, produção pode ser alterada (backup + teste de boot).

## Estado

Etapa 1 (lutas de 3–4 lutadores offline, sem menus: `BT3_TAG=teams:4|ffa:4`) **concluída e em produção** (2026-10-16,
commit `1d32a95`; backup do build anterior em `optiplex:/home/jpadmin/bt3-backups/2026-10-16-tagteam-stage1`).
Suíte no staging: `tag_offline` + `battle_demo` + `boot_smoke` 17/17 (inclui o "same fight" do 1v1).
Os arquivos servidos em https://bt3.jpdev.uk têm o mesmo md5 do build testado.

O que a etapa 1 tem: assentos/objetos/modelos por lutador, V raso, IA dos dois pares, acertos entre todos os inimigos,
fim por time (teams) / último de pé (ffa), barras sobre a cabeça (nó 0x30 do modelo, como o mod).

Correções desta sessão (detalhes no commit e no ledger):
- pool de batalha 1 (e 3) estourava com 4 lutadores → arenas maiores na memória extra; `Web_BattlePoolOverflow()`;
- `btl_tech_b.c`: ordem de avaliação de argumentos (clang ≠ GCC do PS2) em 6 funções de ki blast;
- `BtlChar_FindBySide` com id de objeto da IA (2/3) → lutador do objeto (os extras não atacavam);
- `BtlOpp_MirrorFlags` usa o oponente do Tag Team (sobreviventes paravam quando os líderes caíam);
- barras: carregam a matriz da câmera e projetam a cabeça.

Desempenho (Chrome headless, software): luta de 4 ≈ 4% mais lenta que 1v1; build async igual ao JSPI.

Fontes de produção: as 546 fontes de build (src, include, port/src, port/include, port/web/{src,target,include})
foram sincronizadas em `optiplex:/home/jpadmin/bt3-build` e conferidas por md5 (backup das antigas em
`bt3-backups/2026-10-16-tagteam-stage1/bt3-build-sources.tgz`).
`boot_smoke` + `battle_demo` contra https://bt3.jpdev.uk/runtime.html: 3/3 (inclui o "same fight").

Branch `antigravity/tarefas` enviado ao fork do usuário (remote `fork` = joaopssouza/Tenkaichi3Decomp); PR contra
`web-port`: https://github.com/joaopssouza/Tenkaichi3Decomp/pull/1. `origin` (stufno102) é só leitura; o gh fica em
`C:\Program Files\GitHub CLI\gh.exe`, fora do PATH da sessão. O push é o usuário quem faz (o classificador barra).

## Como trabalhar

- Build+teste: `bash port/tools/tagteam_stage.sh [--no-build] [--test-name-pattern=...] test/tag_offline.test.js ...`
  (sincroniza as fontes para `optiplex:/home/jpadmin/bt3-staging`, compila jspi+async, serve em 127.0.0.1:3999 pelo
  contêiner `bt3-stg-srv`, abre túnel ssh e roda `node --test`). Para o build async: `BT3_BOOT_URL=...runtime.html?build=bt3-async`.
  O script agora para se algum arquivo não compilar (antes linkava o `.o` velho em silêncio). Build+suíte ≈ 30 min:
  rodar em segundo plano.
- Trap de wasm: `node test/helpers/repro_trap.js "BT3_TAG=teams:4" 200` imprime a pilha; mapear offset → instrução
  com `/emsdk/upstream/bin/llvm-objdump -d` e `wasm-dis` no contêiner emsdk (ver memória `bt3-wasm-trap-tracing`).
- Deploy produção: backup de bt3-jspi/async .js/.wasm em `/home/jpadmin/bt3-backups/<data>`, copiar do staging para
  `/home/jpadmin/bt3-build/port/build/web/` (sudo, senha no CLAUDE.md); conferir md5 via `curl https://bt3.jpdev.uk/<arq>`.
- Diagnóstico: `Web_FighterCount/Side/Hp/Coord100/ObjId/Debug`, `Web_BattleSeq/Winner`, `Web_OverheadBars`,
  `Web_ExtraUsed`, `Web_BattlePoolOverflow`; `?env=BT3_DEMO=1,BT3_TAG=teams:4,BT3_TAG_HP=4,BT3_SCALE=1`.
- Padrão das correções: tudo em `#ifdef PORT` + modo Tag Team; o 1v1 tem de continuar idêntico ("same fight").
  Classe de bug recorrente: código do jogo que usa 0/1 (lado, jogador, `BtlChar_Get(0/1)`, `objId ^ 1`) como "o
  oponente"/"o lutador" — procurar por esses padrões quando algo dos extras não funcionar.
- Não usar `taskkill` amplo no Chrome (fecha abas do usuário); matar só processos headless/playwright.

## Próximos passos

1. Etapa 2 (online 3–4): pads 2/3 (`gPad[2]` fixo em src/sys/pad.c; `scePad2Read(socket)` → `Port_NetInput`),
   lutador p lê a porta p; lockstep N jogadores em `port/src/gs/net.c` (remover o "força 4 jogadores" do
   Antigravity); IA dos bots dentro da simulação; queda vira bot. Começar por brainstorming + plano.
2. Etapa 3: lobby (sala com vagas pessoa/bot/vazia/aberta, 2v2 e todos contra todos, seleção, mapa) —
   mockup aprovado em `.superpowers/brainstorm/809-1792085260/content/fluxo-sala.html`.
3. Etapa 4+: recursos do mod um por vez (troca de mira entre vários — hoje o alvo é o par, depois o primeiro inimigo
   de pé —, fusões, reviver, efeitos completos dos extras, HUD/câmera do jogador local…).
