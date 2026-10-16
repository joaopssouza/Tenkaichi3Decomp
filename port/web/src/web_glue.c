/* Browser build: WebAssembly JSPI and JavaScript glue exports. */
#include <emscripten.h>
#include <unistd.h>
#include <stdint.h>
#include <string.h>

unsigned char PortWeb_OverlayArea[16]; /* main.c's overlay load address */

/* Heap top query for page memory telemetry */
EMSCRIPTEN_KEEPALIVE unsigned Web_HeapTop(void) { 
    return (unsigned)(unsigned long)sbrk(0); 
}

/* External engine state */
extern int gPortMenuMode;
extern int Port_Setting(const char *name, int def);
extern void Port_SettingSave(const char *name, int value);
extern void Port_SettingsWrite(void);

/* Battle setup and result queries from decompiled engine (battle_setup.h) */
extern int32_t Battle_GetStage(void);
extern int32_t BattleSide_GetMemberCount(int32_t side);
extern int32_t BattleSide_GetMemberChara(int32_t side, int32_t idx);
extern int32_t BattleSide_GetMemberCostume(int32_t side, int32_t idx);
extern int32_t BattleSide_GetMemberVariant(int32_t side, int32_t idx);
extern int32_t BattleResult_GetFlags(void);
extern int32_t BattleResult_GetReason(void);

/* (Web_InLogos and Web_GameMode are port/src/headless.c's.) */

/* Set dynamic runtime options from frontend (0: interp, 1: texpack, 2: wide, 3: fx) */
EMSCRIPTEN_KEEPALIVE int Web_Option(int opt, int val) {
    switch (opt) {
        case 0: // Frame interpolation
            Port_SettingSave("interp", val);
            break;
        case 1: // Texture replacement pack
            Port_SettingSave("texture_pack", val);
            break;
        case 2: // Aspect ratio (0 = 4:3, 1 = 16:9)
            Port_SettingSave("aspect_milli", val ? 1777 : 1333);
            break;
        case 3: // FX off
            Port_SettingSave("fx_off", val);
            break;
        default:
            return -1;
    }
    Port_SettingsWrite();
    return 0;
}

/* Extract pre-battle characters, costumes and stage for batch streaming */
EMSCRIPTEN_KEEPALIVE int Web_BattleInfo(int key, int idx) {
    switch (key) {
        case 0: return (int)Battle_GetStage();
        case 1: return (int)BattleSide_GetMemberCount(0); // Side 1 fighter count
        case 2: return (int)BattleSide_GetMemberCount(1); // Side 2 fighter count
        case 3: return (int)BattleSide_GetMemberChara(0, idx); // Side 1 fighter ID
        case 4: return (int)BattleSide_GetMemberChara(1, idx); // Side 2 fighter ID
        case 5: return (int)BattleSide_GetMemberCostume(0, idx);
        case 6: return (int)BattleSide_GetMemberCostume(1, idx);
        case 7: return (int)BattleSide_GetMemberVariant(0, idx);
        case 8: return (int)BattleSide_GetMemberVariant(1, idx);
        default: return -1;
    }
}

/* Returns result flags & reason after match conclusion */
EMSCRIPTEN_KEEPALIVE int Web_BattleResultFlags(void) {
    int32_t flags = BattleResult_GetFlags();
    int32_t reason = BattleResult_GetReason();
    return (int)((flags & 0xFFFF) | ((reason & 0xFFFF) << 16));
}

/* Telemetry speed statistics */
EMSCRIPTEN_KEEPALIVE int Web_SpeedStat(int key) {
    switch (key) {
        case 0: return (int)(unsigned long)sbrk(0); // Heap size
        case 1: return gPortMenuMode;
        default: return 0;
    }
}
