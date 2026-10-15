#ifdef PORT /* (not part of the original program: the port's Tag Team, docs/tagteam/core-mechanism.md) */
#include "common.h"
#include "battle/tag_team.h"
#include "battle/btl_char_mgr.h"
#include "sys/math3d.h"

extern s32 BtlCharApi_GetHp(s32 objId);
extern void BtlCharApi_GetPos(s32 objId, Vec4 *out);

static s32 sMode = TAG_MODE_NONE;
static s32 sFighters = 2;

void TagTeam_Set(s32 mode, s32 fighters) {
    if (mode == TAG_MODE_NONE || fighters < 2 || fighters > TAG_FIGHTERS_MAX) {
        sMode = TAG_MODE_NONE;
        sFighters = 2;
        return;
    }
    sMode = mode;
    sFighters = fighters;
}

s32 TagTeam_Mode(void) {
    return sMode;
}

s32 TagTeam_Fighters(void) {
    return sMode == TAG_MODE_NONE ? 2 : sFighters;
}

s32 TagTeam_SeatSide(s32 p) {
    return sMode == TAG_MODE_NONE ? p : (p & 1);
}

s32 TagTeam_SeatMemberCount(s32 p, s32 sideMembers) {
    (void)p;
    return sMode == TAG_MODE_NONE ? sideMembers : 1;
}

s32 TagTeam_SeatMember(s32 p, s32 i) {
    return sMode == TAG_MODE_NONE ? i : (p >> 1) + i;
}

#ifdef __EMSCRIPTEN__
#include <emscripten.h>
/* The fighters of the battle on now, for the tests (test/tag_offline.test.js): 0 fighters outside a battle. */
static BtlMgrChr *fighter(s32 i) {
    if (gBtlChars == NULL || gBtlChars->chars == NULL || i < 0 || i >= gBtlChars->count) {
        return NULL;
    }
    return &gBtlChars->chars[i];
}

EMSCRIPTEN_KEEPALIVE s32 Web_FighterCount(void) {
    return gBtlChars != NULL && gBtlChars->chars != NULL ? gBtlChars->count : 0;
}

EMSCRIPTEN_KEEPALIVE s32 Web_FighterSide(s32 i) {
    BtlMgrChr *chr = fighter(i);
    return chr != NULL ? chr->side : -1;
}

EMSCRIPTEN_KEEPALIVE s32 Web_FighterHp(s32 i) {
    BtlMgrChr *chr = fighter(i);
    return chr != NULL ? BtlCharApi_GetHp(chr->objId) : -1;
}

/* A coordinate times 100, as an integer: (the game's floats are software floats in this build; an integer crosses
   to the page as it is) */
EMSCRIPTEN_KEEPALIVE s32 Web_FighterCoord100(s32 i, s32 axis) {
    BtlMgrChr *chr = fighter(i);
    Vec4 p __attribute__((aligned(16)));
    if (chr == NULL || axis < 0 || axis > 2) {
        return 0;
    }
    BtlCharApi_GetPos(chr->objId, &p);
    return (s32)((axis == 0 ? p.x : axis == 1 ? p.y : p.z) * 100.0f);
}
#endif
#endif
