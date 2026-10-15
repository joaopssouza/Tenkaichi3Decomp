# Tag Team — passagem para a próxima sessão (2026-10-15)

Leia primeiro: `docs/superpowers/specs/2026-10-15-tag-team-design.md` (design aprovado),
`docs/superpowers/plans/2026-10-15-tag-team-stage1b-engine.md` (plano em execução),
`docs/tagteam/core-mechanism.md` (como o mod funciona), ledger `.superpowers/sdd/2026-10-15-tag-team-stage1b-engine/progress.md`.
O usuário pediu: executar tudo sem perguntar, usar REA nas partes difíceis, produção pode ser alterada (backup + teste de boot).

## Estado

Feito e em produção: etapa 0 (boot, `ff0ae1f`), batalhas travando no load (`9d32f6e`).
Feito e commitado, só em staging (ainda NÃO implantado): etapa 1A completa; etapa 1B tasks 1–5
(assentos, memória extra 16 MB, modelo/objeto por assento, V raso, IA do 2º par + congelamento + oponente por par).

Em andamento (código no working tree, ver último commit para o que entrou):
- Task 6 combate: `eft_det_a.c` testa golpe contra todos os inimigos e contato de corpo entre todos os pares
  (`TagTeam_Enemies`). 
- Efeitos por personagem: `BtlScene_SetCharCount(TagTeam_Fighters())` (btl_scene.c), segunda tabela de slots
  (`eft_aa.c`, `CHAR_SLOTS`), pools de efeito 9/10 para personagens 2/3 (`btl_pool.c`, `eft_q.c EftChar_SetPool`).
  Motivo: luta de 4 abortava com `memory access out of bounds` em EftCharge_Init / EftEmit_Spawn.
- Task 7 morte/fim: `TagTeam_TeamDead` (btl_capi_b.c BtlCtrl_IsTeamDead), `TagTeam_FfaDecided` (btl_seq.c
  CheckBattleEnd), `BT3_TAG_HP` (vida inicial %, testes), nocauteados fora de `TagTeam_Enemies`/`TagTeam_Opponent`.
- Task 8 barras: `TagTeam_DrawOverheadBars` após `Ot_Draw` em Battle_Draw/DrawSplit (formato do fade.c).

Testes: `test/tag_offline.test.js` (aceitação), `test/battle_demo.test.js` (1v1 idêntico ao 81507cd — nunca pode
quebrar), `test/boot_smoke.test.js`. Rodam no navegador: `BT3_BOOT_URL=http://localhost:3999/runtime.html`.

## Como trabalhar

- Build+teste: `bash port/tools/tagteam_stage.sh [--no-build] test/tag_offline.test.js ...` — sincroniza `git ls-files -co` de
  src include port/src port/include port/web/src|target|include para `optiplex:/home/jpadmin/bt3-staging`, roda
  `docker run --rm -v /home/jpadmin/bt3-staging:/src -w /src emscripten/emsdk:latest sh -c "python3 port/web/build.py
  && python3 port/web/link.py web && python3 port/web/link.py webasync"`, serve com
  `docker run -d --name bt3-stg-srv -p 127.0.0.1:3999:3000 -v .../bt3-staging/port/build/web:/app/port/build/web:ro
  -v /home/jpadmin/bt3-build/port/build/web/disc:/app/port/build/web/disc:ro -e DB_PATH=/tmp/s.json bt3-build-signaling`,
  túnel `ssh -N -L 3999:127.0.0.1:3999 optiplex`, e `node --test --test-concurrency=1 <arquivos>`.
  Build+suíte leva > 10 min: rodar em segundo plano.
- Deploy produção: backup de bt3-jspi/async .js/.wasm em `/home/jpadmin/bt3-backups/<data>`, copiar do staging
  para `/home/jpadmin/bt3-build/port/build/web/` (sudo, senha no CLAUDE.md), e sincronizar o código-fonte também.
- Diagnóstico: `Web_FighterCount/Side/Hp/Coord100/ObjId/Debug`, `Web_BattleSeq/Winner`, `Web_OverheadBars`,
  `Web_ExtraUsed`; `?env=BT3_DEMO=1,BT3_TAG=teams:4,BT3_TRACE=60,BT3_SCALE=1`. Traps do wasm aparecem como
  `RuntimeError` no console com pilha (o helper de teste já os trata como fatais).
- Padrão das correções: tudo em `#ifdef PORT` + modo Tag Team; tabelas fixas de 2 entradas ganham uma segunda
  tabela para os objetos 2/3 indexada por `objId & 1` (IA: `BTLAI_SLOT`; efeitos: `CHAR_SLOTS`; pools 9/10).
  Nunca crescer arrays dentro de `gBtlObjWork`/structs de layout fixo (foi o que travou tudo antes).
- Não usar `taskkill` amplo no Chrome (fecha abas do usuário); matar só processos headless/playwright.

## Último resultado (commit deste handoff)

Suíte no staging: 9 passam (inclui "same fight" do 1v1, 4 lutadores carregados/posicionados/se movendo); 4 falham
porque a luta de 4 ainda aborta com `RuntimeError: memory access out of bounds` depois de ~30 s, num caminho de
efeitos ainda não identificado (as correções de slots/pools já resolveram os dois primeiros). Para achar o próximo:
`node` + `test/helpers/game_page.js` abrindo `?env=BT3_DEMO=1,BT3_TAG=teams:4` e imprimindo `g.printed` (a pilha
wasm vem nas linhas seguintes ao RuntimeError). Candidatos já vistos com tamanho fixo 2 por personagem:
`gEftBodyFx->task[2]` (eft_o.h), `head/tail[2]` em eft_p.h, `gEftBubble->chr[]`, `gEftDust->wake[]`, `res[2]` eft_q.h.

## Próximos passos

1. Ler o resultado da suíte; corrigir o próximo acesso fora dos limites, se houver (pilha no console).
2. Fechar tasks 6–8 (dano entre os 4, fim de luta por time / último de pé, barras), task 9 (build async/celular).
3. Implantar a etapa 1 em produção (com backup) e verificar.
4. Etapa 2 (online 3–4): pads 2/3 (`gPad[2]` fixo em src/sys/pad.c; `scePad2Read(socket)` → `Port_NetInput`),
   lutador p lê a porta p; lockstep N jogadores em `port/src/gs/net.c` (remover o "força 4 jogadores" do
   Antigravity); IA dos bots dentro da simulação; queda vira bot.
5. Etapa 3: lobby (sala com vagas pessoa/bot/vazia/aberta, 2v2 e todos contra todos, seleção, mapa) —
   mockup aprovado em `.superpowers/brainstorm/809-1792085260/content/fluxo-sala.html`.
6. Etapa 4+: recursos do mod um por vez (mira entre vários, fusões, reviver, efeitos completos dos extras…).
