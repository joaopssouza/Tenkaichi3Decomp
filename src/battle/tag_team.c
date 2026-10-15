#ifdef PORT /* (not part of the original program: the port's Tag Team, docs/tagteam/core-mechanism.md) */
#include "common.h"
#include "battle/tag_team.h"
#include "battle/btl_char_mgr.h"
#include "battle/battle.h"
#include <stdio.h>
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

/* --- the extra fighters' models and objects ---------------------------------------------------------------------
   The Tag Team mod loads them as the game loads a model into a heap resource slot (selected_resource_queue.py:
   BtlRes_Request) and creates their objects with BtlObj_Create (selected_team_prepare.py), each with a work buffer
   of its own, EXT_SIZE 0x1A0C0 bytes, outside the game's table of three (its hook on BtlObj_GetCharaWork, 0x2499C8).
   Here the same, in C. */
#define CHARA_WORK_SIZE 0x1A0C0

extern s32 BtlRes_Request(s32 fixed, s32 model, s32 anim0, s32 anim1);
extern s32 BtlObj_CreateChara(s32 slot);
extern BattleMember *BattleSide_GetMember(s32 side, s32 idx);
extern unsigned Port_ExtraAlloc(unsigned size, unsigned align);
extern void Port_ExtraReset(void);

static s32 sSeatSlot[TAG_FIGHTERS_MAX] = {-1, -1, -1, -1};
static s32 sSeatObj[TAG_FIGHTERS_MAX] = {-1, -1, -1, -1};
static u8 *sSeatWork[TAG_FIGHTERS_MAX];
static s32 sCreating = -1; /* the seat whose object BtlObj_Create is making (TagTeam_CharaWork) */

void TagTeam_RequestSeatModels(void) {
    s32 p;
    BattleMember *m;

    for (p = 2; p < TagTeam_Fighters(); p++) {
        m = BattleSide_GetMember(p & 1, p >> 1);
        /* (the model and animation files as BtlObj_RequestCharaModel names them) */
        sSeatSlot[p] = BtlRes_Request(0, m->chara * 10 + m->costume + (m->variant != 0 ? 0x594 : 0x590),
                                      m->chara * 10 + 0x598, m->chara * 10 + 0x599);
        if (sSeatSlot[p] < 0) {
            printf("bt3: tag team: no model slot for fighter %d\n", p);
        }
    }
}

void TagTeam_CreateSeatObjects(void) {
    s32 p;

    for (p = 2; p < TagTeam_Fighters(); p++) {
        sSeatObj[p] = -1;
        if (sSeatSlot[p] < 0) {
            continue;
        }
        sCreating = p;
        sSeatObj[p] = BtlObj_CreateChara(sSeatSlot[p]);
        sCreating = -1;
        if (sSeatObj[p] < 0) {
            printf("bt3: tag team: no object for fighter %d\n", p);
        }
    }
}

void TagTeam_EndBattle(void) {
    s32 p;

    for (p = 0; p < TAG_FIGHTERS_MAX; p++) {
        sSeatSlot[p] = -1;
        sSeatObj[p] = -1;
        sSeatWork[p] = NULL;
    }
    sCreating = -1;
    Port_ExtraReset();
}

s32 TagTeam_SeatObjId(s32 p, s32 sideObjId) {
    if (sMode == TAG_MODE_NONE || p < 2 || p >= TAG_FIGHTERS_MAX || sSeatObj[p] < 0) {
        return sideObjId;
    }
    return sSeatObj[p];
}

u8 *TagTeam_CharaWork(s32 objId) {
    s32 p;

    if (sMode == TAG_MODE_NONE) {
        return NULL;
    }
    if (sCreating >= 0) { /* the object being made for an extra fighter: its own buffer */
        if (sSeatWork[sCreating] == NULL) {
            sSeatWork[sCreating] = (u8 *)Port_ExtraAlloc(CHARA_WORK_SIZE, 64);
        }
        return sSeatWork[sCreating];
    }
    for (p = 2; p < TAG_FIGHTERS_MAX; p++) {
        if (sSeatObj[p] == objId && objId >= 0) {
            return sSeatWork[p];
        }
    }
    return NULL;
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

EMSCRIPTEN_KEEPALIVE s32 Web_FighterObjId(s32 i) {
    BtlMgrChr *chr = fighter(i);
    return chr != NULL ? chr->objId : -1;
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
