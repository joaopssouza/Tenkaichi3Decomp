# How the Tag Team mod puts more fighters in a battle — and what that means for this port

Evidence: the mod's release `tools/Tag.Team.Mod.0.1.0-beta.13.3` (`…/player-payload/bt3-usa/tools`, cited below by
file name), the address ledger `docs/tagteam/ledger.{json,md}` (`port/tools/tagteam_ledger.py`), and the original
executable `Tenkaichi3Decomp/gamedata/disc/SLUS_216.78` (SHA-256 `811188ba…bf99`, the stock USA ELF the mod is
written for), disassembled with capstone where named below. REA's deep providers could not open this target on this
host (Ghidra not installed; on Windows REA's Ghidra lane takes PE only; Hopper/IDA have no MIPS lane), so the
instruction-level checks used capstone 5.0.6 directly on the ELF.

## 1. The mod's run-time pipeline (observed in `fresh_team_trainer.py`, `Session.prepare`)

The player picks a normal **Team Battle** in the game's own menus (up to five members per side). While the game sits
behind its loading screen, the mod's Python installs MIPS payloads through PCSX2's PINE interface, step by step,
waiting for each to report ready (`wait_word(<module>.CONTROL, …)`):

| # | Step (progress text) | Module | Game code it touches (ledger) |
|---|---|---|---|
| 1 | capture the selection | `fresh_team_trainer.capture` | the native team selection (members per side, participation mask) |
| 2 | "Preparing expanded game memory" | `fresh_memory.py` | `Heap_Alloc`, `Heap_Free`, `Heap_InitFreeBlock`; frame hook `BtlChars_SampleInput` |
| 3 | "Loading selected character resources" | `selected_resource_queue.py` | `BtlRes_Request`, `BtlRes_GetSlot`, `File_UpdateRequests`, `gFileReq`, `Battle_Update`, `Battle_Loop` |
| 4 | "Creating independent fighters" | `selected_team_prepare.py` | `BtlObj_Create`, `BtlChar_BindObject`, `BtlChar_OnModelLoaded`, `BtlObj_GetCharaWork`, `BtlObjBody_Init`, `BtlObjPose_CalcMatrices`, `BtlObjAnim_*`, `BtlAnim_Play`, `gBtlObjTbl`, `gBtlObjWork`, `Heap_Alloc` |
| 5 | "Expanding render object capacity" / "graphics buffers" | `fresh_render_capacity.py`, `packet_pool_grow.py` (`capacity_stage.py`) | draw-node pool (`gBtlObjWork`, 0xE0-byte nodes, `ADD_NODES = 512`), packet arenas (`Dma_Flush` hook) |
| 6 | combat engine, safety, AI | `fresh_team_combat.py`, `fresh_team_safety.py`, `fresh_team_ai.py` | `BtlChar_GetCount`, `BtlChar_Get`, `BtlChar_FindByObjId`, `BtlCharApi_GetHeight/GetRadius`, `BtlAiMgr_Update`, `BtlAct_CanSwitch`, `BtlActB_TickMemberChange`, `BtlReplay_*`, `Adx_*` |
| 7 | placement, effects, participation, HUD | `spawn_placement.py`, `extra_*_effects/auras.py`, `team_participation.py`, `guest_healthbars.py`, `lockon_switch.py`, … (`final_team_manifest`) | frame hook; render call sites `0x12B8DC/0x12BADC`; head projection `0x1210D8` |

Actor configuration (`fresh_team_trainer.actor_config`): physical fighter `i` is team `i & 1`; fighters 0 and 1 are
the game's own two (`*(gBtlChars+4) + i*0x1600`), the rest are the mod's created actors; each has a model id < 12
in the model table at `0x31C640`; CPU control per fighter.

## 2. Hook points checked against the original instructions

| Address | Decomp symbol | Used by | Check |
|---|---|---|---|
| `0x1C2A28` | `BtlChars_SampleInput` (`src/battle/btl_char_mgr.c`) | the mod's per-frame entry: capacity_stage, heap128, lockon_switch, prototype, shader_pool_fix, spectator_switch, team_prototype, team_start_gate (→ spawn_placement) | tests `Battle_GetWork()->flags` bits `0x100` and `0x2000` at `+0x19F0`, then loops over the fighters — same as the C |
| `0x1DC168` | `BtlChar_GetCount` (`btl_char_get.c`) | team_prototype (count override) | `lw v1, -0x575C(gp)` (= `0x2FEB14`, `gBtlChars`), returns `->count` — same as the C |
| `0x2499C8` | `BtlObj_GetCharaWork` (`btl_obj.c`) | prototype, team_prototype (extra fighters' work buffer) | calls `0x249748` (`BtlObj_GetTable`), `id < 3`, stride `0x1A0C0` (the mod's `EXT_SIZE`) — same as the C |
| `0x100798` | `Dma_Flush` (`src/sys/dma.c`) | capacity_stage (packet arena) | `DMA_TAG_CNT|2`, `VIF_FLUSHE`, `VIF_DIRECT|2` — same as the C |
| `0x2FEB14` | `gBtlChars` | 40+ modules | the fighter manager (`BtlCharMgr`, `include/battle/btl_char_mgr.h`) |

## 3. What this means for the port (C, not run-time patches)

The engine is already written for N fighters where it matters most: `BtlChar_AllocAll(count)` allocates `count`
fighters of `0x1600` bytes plus their `0x34`-byte side tables, and the per-frame loops run to `BtlChar_GetCount()`.
The game only ever calls it with 2. The mod cannot change that from outside a running game, so it creates its extra
actors separately and patches every place that assumes two. In C the clean path is:

1. **Allocate N fighters** in the Tag Team mode (`BtlChar_AllocAll(n)`), never by growing structures that live at
   fixed offsets inside `gBtlObjWork` (the stage-0 hang came from exactly that).
2. **Treat each mod hook/patch as a pointer to a two-fighter assumption** and fix that function in C, behind the
   mode: the ledger lists them by module.
3. **Memory**: extra model/work buffers come from a separate region, not from heap 0 (`Port_Malloc` ends at
   `0x02000000`); the mod's equivalent is `fresh_memory.py` (heap extension) + `heap128.py`.
4. **Capacity**: the draw-node pool and the packet arenas grow by *adding* nodes/arenas from that region (the mod adds
   512 nodes of 0xE0 bytes and grows packet arenas after submission), not by resizing the fixed pools.

## 4. Order for stage 1B (each a task with its own test)

1. Test entry and queries (stage 1A task 3) — `BT3_TAG`, `Web_Fighter*`.
2. Extra memory region for the port (the mod's `fresh_memory`/`heap128`).
3. N fighters allocated, resources loaded and objects created for each (`selected_resource_queue`,
   `selected_team_prepare`; `BtlChar_AllocAll`, `BtlRes_Request`, `BtlObj_Create`, `BtlChar_BindObject`,
   `BtlObj_GetCharaWork` for ids ≥ 3).
4. Render capacity (`fresh_render_capacity`, `packet_pool_grow`).
5. Placement on the stage (`spawn_placement`: shallow V from the stage's anchors, floor probe).
6. Combat between N fighters: hit/collision/targets (`fresh_team_combat`, `team_targets`, `ffa_targeting`,
   `lockon_switch`, `contact_matrix`).
7. CPU control for each fighter (`fresh_team_ai`).
8. Safety: member change, replays, audio, skills (`fresh_team_safety`).
9. Overhead health bars (`guest_healthbars`) and the local player's camera/HUD.
10. Death and victory rules of the design (spectator, take over a bot, end conditions) — the mod's
    `team_participation` / `spectator_switch` / `battle_mode_policy` as reference.
