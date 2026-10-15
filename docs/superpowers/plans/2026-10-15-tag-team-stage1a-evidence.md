# Tag Team etapa 1A — evidência do mod e porta de teste — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Saber, com evidência, o que o Tag Team Mod muda no jogo para pôr mais lutadores em campo, ligado aos símbolos do decomp, e ter uma porta de teste que inicia lutas de N lutadores sem menus.

**Architecture:** Uma ferramenta Python lê o código do mod (constantes `A(0x…)`, ganchos) e os mapas de símbolos/segmentos do decomp e gera um razão (ledger) JSON+Markdown. Com o ledger, o mecanismo central (tabela de atores, agendador, recursos, criação de lutadores) é lido no mod e conferido no executável original com as ferramentas REA, e documentado. A porta de teste estende o harness `port/src/headless.c` (luta do demo) com `BT3_TAG=<modo>:<n>` e funções de consulta exportadas.

**Tech Stack:** Python 3 (unittest), C (decomp/port), Emscripten, Node test runner + Chrome headless (`test/helpers/game_page.js`), REA MCP.

**Spec:** `docs/superpowers/specs/2026-10-15-tag-team-design.md`

## Global Constraints

- O 1v1 não muda: `test/battle_demo.test.js` ("same fight as before the Tag Team work") passa em todo commit.
- Tudo do Tag Team atrás do modo Tag Team; sem modo, nenhum caminho novo executa.
- Nada de mudança de motor sem evidência: cada mudança cita módulo do mod + endereço + símbolo do decomp.
- Memória: nunca pedir ao `Port_Malloc` além da região `0x003BE000–0x02000000`; estruturas dentro de `gBtlObjWork` têm layout fixo (tamanhos nos comentários `/* size 0x… */`) e não crescem.
- Build: `docker run --rm -v <árvore>:/src -w /src emscripten/emsdk:latest python3 port/web/build.py && … link.py web && … link.py webasync` no Optiplex; staging em `/home/jpadmin/bt3-staging`.

## Review Focus

- Endereço do mod que cai entre duas funções ou em dados: o ledger tem que dizer "dentro de <função>+deslocamento" ou "dado perto de <símbolo>", nunca inventar uma função.
- Endereços de região/PAL (`native_map.A`) — só a tabela USA é identidade; a ferramenta lê o endereço USA literal.
- Endereços altos do mod (`0x06…`, `0x07…`) são memória dele, não do jogo: marcados como "mod-memory", não resolvidos para símbolos.
- `BT3_TAG` ausente ou inválido: a luta do demo segue idêntica (coberto pelo teste "same fight").
- `BT3_TAG` com N maior que o suportado: erro claro no log e luta de 2, nunca travar.

---

### Task 1: Ledger dos endereços do mod

**Files:**
- Create: `port/tools/tagteam_ledger.py`
- Create: `port/tools/test_tagteam_ledger.py`
- Create (gerado): `docs/tagteam/ledger.json`, `docs/tagteam/ledger.md`

**Interfaces:**
- Produces: `load_symbols(paths) -> list[tuple[int, str]]` (ordenada por endereço); `load_segments(yaml_path) -> list[tuple[int, str]]` (vram inicial, arquivo C/asm); `resolve(addr, symbols, segments) -> dict` com chaves `addr`, `kind` (`"exact"`, `"inside"`, `"mod-memory"`, `"unknown"`), `symbol`, `offset`, `file`; `scan_module(path) -> list[dict]` com `name` (constante ou `None`), `addr`, `line`, `role` (`"hook"` se o nome contém HOOK/ENTRY, senão `"ref"`); CLI `python3 port/tools/tagteam_ledger.py <mod-tools-dir> --out docs/tagteam`.

- [ ] Step 1: testes em `test_tagteam_ledger.py` (unittest, fixtures em texto dentro do teste):
  `resolve(0x00127068, …)` → `kind "exact"`, `symbol "Battle_Load"`; `resolve(0x00127070, …)` → `"inside"`, `"Battle_Load"`, `offset 8`; `resolve(0x07368000, …)` → `"mod-memory"`; `scan_module` sobre `"HOOK = A(0x1C2A28)\nX = foo(A(0x100798))\n"` → 2 entradas, a primeira `{"name": "HOOK", "addr": 0x1C2A28, "role": "hook"}`, a segunda `name None`, `role "ref"`; `load_segments` sobre um trecho de YAML com `- [0x000258, c, main]` e `vram: 0x00100000` → `(0x100258, "main")`.
- [ ] Step 2: `python3 -m unittest port/tools/test_tagteam_ledger.py` → FAIL (módulo inexistente).
- [ ] Step 3: implementar. Símbolos: linhas `Nome = 0xADDR;` de `config/symbols/*.txt` e `config/symbol_addrs.txt`. "inside" = maior símbolo de função ≤ addr dentro do mesmo segmento; addr ≥ `0x02000000` = mod-memory. Saída Markdown agrupada por módulo do mod, ganchos primeiro.
- [ ] Step 4: testes → PASS; rodar a CLI sobre `tools/Tag.Team.Mod.0.1.0-beta.13.3/Tag Team Mod Installer/setup/player-payload/bt3-usa/tools`; conferir que `0x1C2A28` e `0x2FEB14` aparecem resolvidos.
- [ ] Step 5: commit.

### Task 2: Mapa do mecanismo central (pesquisa com REA)

**Files:**
- Create: `docs/tagteam/core-mechanism.md`

**Interfaces:**
- Consumes: `docs/tagteam/ledger.json` (Task 1).
- Produces: para cada gancho dos módulos centrais (`prototype.py`, `capacity_stage.py`, `fresh_team_combat.py`, `spawn_placement.py`, `battle_mode_policy.py`, `quad_controller.py`, `team_targets.py`, `ffa_targeting.py` e os que o ledger mostrar ligados a eles): endereço, símbolo do decomp, o que o payload faz (lido do Python que monta o MIPS), e a função C equivalente a mudar. Lista ordenada dos subsistemas para a etapa 1B: tabela de atores e agendador, recursos/modelos, criação e posicionamento, CPU, alvo, câmera/HUD, regras de morte/fim.

- [ ] Step 1: abrir o executável original (`Tenkaichi3Decomp/gamedata/disc/SLUS_216.78`) com REA (`open_binary`), conferir 5 ganchos (`0x1C2A28`, `0x100798`, `0x2499C8`, o primeiro de `ACTOR_CALLS`, e o gancho de `spawn_placement`) contra o símbolo que o ledger deu: nome do decomp e corpo batem.
- [ ] Step 2: escrever `core-mechanism.md` com a tabela acima; cada linha com o arquivo/linha do mod de onde veio.
- [ ] Step 3: commit.

### Task 3: Porta de teste `BT3_TAG` e consultas

**Files:**
- Modify: `port/src/headless.c` (ramo do demo em `__wrap_Progress_Main`)
- Create: `port/src/tag_query.c` (exportações `EMSCRIPTEN_KEEPALIVE`)
- Create: `test/tag_offline.test.js`

**Interfaces:**
- Produces: `BT3_TAG=teams:<n>` / `ffa:<n>` (n 2..4) na luta do demo; `int Web_FighterCount(void)`; `int Web_FighterHp(int i)`; `void Web_FighterPos(int i, float *out3)`; `int Web_FighterSide(int i)`.

- [ ] Step 1: `test/tag_offline.test.js` com o mesmo padrão de `battle_demo.test.js` (pula sem `BT3_BOOT_URL`): com `BT3_TAG=ffa:4`, `Web_FighterCount() === 4` dentro do tempo, as 4 posições distintas, e em 120 quadros de luta pelo menos 3 dos 4 se movem; com `BT3_TAG` ausente, `Web_FighterCount() === 2`.
- [ ] Step 2: rodar contra o staging → FAIL (exportações inexistentes).
- [ ] Step 3: implementar as consultas sobre a tabela de atores mapeada na Task 2 e o parse de `BT3_TAG` (inválido → mensagem `bt3: BT3_TAG ignored: <motivo>` e luta normal).
- [ ] Step 4: o caso "ausente → 2" e "same fight" passam; o caso de 4 continua vermelho até a etapa 1B (é o teste de aceitação dela).
- [ ] Step 5: commit.

Etapa 1B (motor de N lutadores) é planejada em `docs/superpowers/plans/2026-10-15-tag-team-stage1b-engine.md` a partir de `core-mechanism.md`, com `test/tag_offline.test.js` como aceitação.
