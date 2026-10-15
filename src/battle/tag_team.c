#ifdef PORT /* (not part of the original program: the port's Tag Team, docs/tagteam/core-mechanism.md) */
#include "common.h"
#include "battle/tag_team.h"
#include "battle/btl_char_mgr.h"
#include "battle/battle.h"
#include <stdio.h>
#include "battle/stg_a.h"

extern f32 sqrtf(f32 x);
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

s32 TagTeam_Seat(void *chr) {
    s32 p;

    if (gBtlChars == NULL || gBtlChars->chars == NULL) {
        return -1;
    }
    p = ((u8 *)chr - (u8 *)gBtlChars->chars) / (s32)sizeof(BtlMgrChr);
    return p >= 0 && p < gBtlChars->count ? p : -1;
}

/* An extra fighter's start: the Tag Team mod's shallow V (spawn_placement.py, candidate_plan). forward points from
   side 0's start to side 1's (reversed for side 1), right is across it; the wing is 0.6 of the gap between the two
   starts, kept within 80..180. Rank r = p >> 1 stands on one flank (odd ranks left, even right), wing*0.6 behind its
   leader; ranks 3 and 4 a second, deeper V. The candidates are tried in the mod's order; the first with ground under
   it is taken (the mod's guest code also checks walls and the other fighters: not done here). */
s32 TagTeam_StartPlace(s32 p, Vec4 *pos, Vec4 *rot) {
    static const f32 cand[][2] = {{1.0f, 0.6f}, {0.8f, 0.8f}, {0.65f, 1.0f}, {1.0f, 1.2f}, {1.2f, 0.6f}, {0.65f, 1.5f},
                                  {0.5f, 1.8f}, {1.4f, 1.0f}, {1.6f, 0.6f}, {0.8f, 2.0f}, {1.2f, 1.8f}, {1.6f, 1.6f}};
    Vec4 a[2] __attribute__((aligned(16)));
    Vec4 r[2] __attribute__((aligned(16)));
    StgGroundHit hit;
    s32 side = p & 1, rank = p >> 1, zone = 0, i;
    f32 gap, fx, fz, wing, hand, row, lr, back;

    BtlStage_GetStartPlace(0, &a[0], &r[0], 0);
    BtlStage_GetStartPlace(1, &a[1], &r[1], 0);
    *rot = r[side];
    *pos = a[side];
    gap = sqrtf((a[1].x - a[0].x) * (a[1].x - a[0].x) + (a[1].z - a[0].z) * (a[1].z - a[0].z));
    if (rank == 0 || gap < 1.0f) {
        return BtlStage_ProbeGround(-1, pos, &hit);
    }
    fx = (a[1].x - a[0].x) / gap * (side == 0 ? 1.0f : -1.0f);
    fz = (a[1].z - a[0].z) / gap * (side == 0 ? 1.0f : -1.0f);
    wing = gap * 0.6f;
    wing = wing > 180.0f ? 180.0f : wing < 80.0f ? 80.0f : wing;
    hand = (rank & 1) ? -1.0f : 1.0f;
    row = (f32)((rank - 1) / 2);
    for (i = 0; i < (s32)(sizeof(cand) / sizeof(cand[0])); i++) {
        lr = hand * wing * cand[i][0];
        back = wing * cand[i][1] + row * wing * 0.9f;
        pos->x = a[side].x + fz * lr - fx * back; /* right = (fz, -fx) */
        pos->z = a[side].z - fx * lr - fz * back;
        pos->y = -700.0f;
        pos->w = 1.0f;
        zone = BtlStage_ProbeGround(-1, pos, &hit);
        if (hit.y > -690.0f) {
            pos->y = hit.y;
            return zone;
        }
    }
    *pos = a[side]; /* no ground anywhere in the V: a little behind the leader (the mod's last fallback) */
    pos->x -= fx * 32.0f;
    pos->z -= fz * 32.0f;
    return BtlStage_ProbeGround(-1, pos, &hit);
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
