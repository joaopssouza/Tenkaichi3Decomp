# Tag Team etapa 1B — motor de N lutadores (offline) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Com `BT3_TAG=teams:4` / `ffa:4`, quatro lutadores no mapa ao mesmo tempo, carregados, posicionados, controlados pela CPU, lutando entre si, com as regras de morte/fim do design — sem mudar a luta de dois.

**Architecture:** Cada lutador tem um **assento** = seu índice físico `p` em `gBtlChars->chars` (`p = chr - gBtlChars->chars`). `chr->side = p & 1` (o time; tudo que o jogo lê por lado continua valendo para o time). O que é de cada lutador e o jogo guarda por lado — objeto 3D, slot de modelo, membro do time, controle — passa a vir de tabelas por assento em `src/battle/tag_team.c`, consultadas nos pontos que o ledger do mod aponta. Fora do modo Tag Team (`TagTeam_Mode() == TAG_MODE_NONE`) cada caminho novo devolve exatamente o valor de antes.

**Tech Stack:** C (decomp, `#ifdef PORT`), Emscripten, testes de navegador (`test/helpers/game_page.js`).

**Spec:** `docs/superpowers/specs/2026-10-15-tag-team-design.md` · evidência: `docs/tagteam/core-mechanism.md`, `docs/tagteam/ledger.md`

## Global Constraints

- `test/battle_demo.test.js` ("same fight as before the Tag Team work") e `test/boot_smoke.test.js` passam em todo commit; `test/tag_offline.test.js` é a aceitação.
- Todo código novo de motor atrás de `#ifdef PORT` e do modo Tag Team; nada cresce dentro de `gBtlObjWork` nem de `BattleSide`/`BtlMgrChr` (layouts fixos).
- Memória extra fora do heap 0: região própria do port (Task 2).
- Cada mudança de comportamento cita o módulo/endereço do mod ou a medição que a justifica (comentário no código).
- Build e teste: `stage.sh` (sincroniza → compila jspi+async no Optiplex → serve em 3999 → roda os testes).

## Review Focus

- Assento 2/3 lido onde o jogo indexa um array de 2 por `chr->side`: ler `side` fora de 0..1 corrompe memória — `side` fica sempre 0/1.
- 3 lutadores (`teams:3`, `ffa:3`): um lado com 2, outro com 1 — precisa funcionar como 4.
- Lutador sem vida continua sendo atualizado/desenhado? Deve parar de lutar sem travar a luta.
- `BT3_TAG` com mesmo personagem duas vezes no mesmo time (mesmo modelo) — recursos não podem ser compartilhados por engano.
- Celular (build `bt3-async`): mesmos testes passam no build async.

---

### Task 1: Assentos — N lutadores alocados e identificados

**Files:** Modify `src/battle/battle.c` (`Battle_Init`), `src/battle/tag_team.c`, `include/battle/tag_team.h`.
**Interfaces — Produces:** `s32 TagTeam_Seat(void *chr)` (índice físico, -1 se não é lutador); `s32 TagTeam_SeatMember(s32 p)` (membro do time: `p >> 1`); `BtlChar_AllocAll(TagTeam_Fighters())`.
- [ ] Teste: em `tag_offline`, `teams:4` → `Web_FighterCount() === 4` e lados `[0,1,0,1]` (já escrito: "two fighters on each side").
- [ ] Rodar → FAIL (2 lutadores).
- [ ] Implementar; os lutadores ≥ 2 ainda sem objeto próprio podem usar o do time (Task 3 separa).
- [ ] Rodar aceitação parcial + regressão → PASS "two fighters on each side"; "same fight" PASS. Commit.

### Task 2: Região de memória extra do port

**Files:** Create `port/src/plat_extra.c`; Modify `src/battle/tag_team.c`.
**Interfaces — Produces:** `void *Port_ExtraAlloc(u32 size, u32 align)` (bump sobre um bloco próprio, 16 MB, zerado; `NULL` e mensagem quando acaba), usado pelos buffers dos lutadores extras (o equivalente do `fresh_memory`/`heap128` do mod).
- [ ] Teste C-free via navegador: `Web_ExtraFree()` diminui após uma luta `teams:4` e é 16 MB sem `BT3_TAG`.
- [ ] Implementar; commit.

### Task 3: Modelo e objeto 3D por assento

**Files:** Modify `src/battle/battle_work.c` (`Battle_Load`), `src/battle/battle_load.c` (carga do modelo do membro), `src/battle/btl_obj.c` (`BtlObj_GetCharaWork` para ids ≥ 3 a partir da região extra), `src/battle/btl_char_mgr.c` (`BtlChar_BindObject`).
**Evidência:** `selected_resource_queue.py` (`BtlRes_Request` em slot de heap), `selected_team_prepare.py` (`BtlObj_Create`, `BtlChar_BindObject`, `BtlObj_GetCharaWork` hook `0x2499C8`, `EXT_SIZE 0x1A0C0`).
**Interfaces — Produces:** `s32 TagTeam_SeatObjId(s32 p)`, `s32 TagTeam_SeatModelSlot(s32 p)`.
- [ ] Teste: `teams:4` → 4 lutadores com `hp > 0` e `Web_FighterObjId(i)` distintos (nova consulta).
- [ ] Implementar; commit.

### Task 4: Posicionamento (V raso)

**Files:** Modify o spawn (`BtlStage_GetStartPlace` / reset de posição do lutador).
**Evidência:** `spawn_placement.py` (V raso a partir das âncoras do mapa, sonda de chão).
- [ ] Teste: "four different places" (já escrito em `ffa:4`).
- [ ] Implementar; commit.

### Task 5: Cada lutador age (CPU por assento)

**Files:** entrada/IA por assento (`BtlChars_UpdateInput`, `BtlAiMgr_*`), alvo inicial = inimigo mais próximo.
**Evidência:** `fresh_team_ai.py` (`BtlAiMgr_Update` hook), `team_targets.py`, `ffa_targeting.py`.
- [ ] Teste: "they move" (já escrito em `ffa:4`).
- [ ] Implementar; commit.

### Task 6: Combate entre N

**Files:** acertos/colisão/alvo (`BtlHit_*`, `BtlBodyHit_Update`, `BtlOpp_*`).
**Evidência:** `fresh_team_combat.py`, `contact_matrix.py`, `lockon_switch.py`.
- [ ] Teste: em 600 quadros de `ffa:4`, pelo menos 3 lutadores levam dano; em `teams:4` nenhum leva dano de aliado (`Web_FighterHitBy(i)` registra o último atacante).
- [ ] Implementar; commit.

### Task 7: Morte e fim de partida

**Files:** `src/battle/tag_team.c` + o fim de rodada do jogo.
**Evidência:** `team_participation.py`, `spectator_switch.py`, `battle_mode_policy.py`.
- [ ] Testes: `teams:4` termina só quando os dois de um time caem; `ffa:4` termina com um de pé; lutador sem vida sai da luta sem travar (`BT3_TAG_HP=<pct>` reduz a vida inicial para os testes terminarem rápido).
- [ ] Implementar; commit.

### Task 8: Barras sobre a cabeça e câmera/HUD do jogador local

**Evidência:** `guest_healthbars.py` (render `0x12B8DC/0x12BADC`, projeção da cabeça `0x1210D8`).
- [ ] Teste: `Web_OverheadBars()` = número de barras desenhadas no último quadro (3 numa luta de 4 vista pelo lutador 0); captura de tela salva para inspeção.
- [ ] Implementar; commit.

### Task 9: Celular

- [ ] Rodar `tag_offline` com `?build=bt3-async`; medir fps de `teams:4` vs 1v1 no mesmo build; registrar no ledger.
