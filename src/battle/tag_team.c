#ifdef PORT /* (not part of the original program: the port's Tag Team, docs/tagteam/core-mechanism.md) */
#include "common.h"
#include "battle/tag_team.h"
#include "battle/btl_char_mgr.h"
#include "battle/battle.h"
#include <stdio.h>
#include "battle/stg_a.h"
#include "battle/btl_ai.h"
#include "battle/btl_seq.h"
#include "battle/battle_work.h"
#include "sys/dma.h"

extern BtlAi *gBtlAi;

extern f32 sqrtf(f32 x);
#include "sys/math3d.h"

extern s32 BtlCharApi_GetHp(s32 objId);
extern void BtlCharApi_GetPos(s32 objId, Vec4 *out);

static s32 alive(s32 p);

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

void *TagTeam_Opponent(void *chr, void *gameOpponent) {
    s32 p, q;

    if (sMode == TAG_MODE_NONE || (p = TagTeam_Seat(chr)) < 0) {
        return gameOpponent;
    }
    q = p ^ 1;
    if (q >= gBtlChars->count) { /* (an odd one out: the other side's leader) */
        q = (p & 1) ^ 1;
    }
    if (!alive(q)) { /* the pair is down: the first enemy still standing */
        s32 r;
        for (r = 0; r < gBtlChars->count; r++) {
            if (r != p && alive(r) && (sMode == TAG_MODE_FFA || (r & 1) != (p & 1))) {
                q = r;
                break;
            }
        }
    }
    return &gBtlChars->chars[q];
}

/* The objects of the fighters that the fighter with object objId may hit, its pair (p ^ 1) first: in teams those of
   the other side, in a free-for-all everybody else. -1 count: objId is not a fighter (the game's rule applies). */
/* Fighter p still in the fight: its health above 0 (BtlCharApi_GetHp: its member on now). */
static s32 alive(s32 p) {
    return BtlCharApi_GetHp(gBtlChars->chars[p].objId) > 0;
}

/* BT3_TAG_HP (tests): every member starts with pct percent of its health. Before BattleSetup_Finish. */
void TagTeam_SetHealthPct(s32 pct) {
    s32 side, k;

    for (side = 0; side < 2; side++) {
        for (k = 0; k < 5; k++) {
            BattleSide_GetMember(side, k)->health = (f32)pct;
        }
    }
}

/* A side is out when every fighter of it is down (the game asks only about its one fighter: gameDead). */
s32 TagTeam_TeamDead(s32 side, s32 gameDead) {
    s32 p;

    if (sMode == TAG_MODE_NONE || gBtlChars == NULL || side < 0 || side > 1) {
        return gameDead;
    }
    for (p = side; p < gBtlChars->count; p += 2) {
        if (alive(p)) {
            return 0;
        }
    }
    return 1;
}

/* A free-for-all is decided when at most one fighter stands: 1 and *winnerSide the survivor's side (-1: none). */
s32 TagTeam_FfaDecided(s32 *winnerSide) {
    s32 p, n = 0, last = -1;

    if (sMode != TAG_MODE_FFA || gBtlChars == NULL) {
        return 0;
    }
    for (p = 0; p < gBtlChars->count; p++) {
        if (alive(p)) {
            n++;
            last = p;
        }
    }
    *winnerSide = n == 1 ? (last & 1) : -1;
    return n <= 1;
}

s32 TagTeam_FighterCount(void) {
    return gBtlChars != NULL && gBtlChars->chars != NULL ? gBtlChars->count : 0;
}

s32 TagTeam_FighterObjId(s32 p) {
    return p >= 0 && p < TagTeam_FighterCount() ? gBtlChars->chars[p].objId : -1;
}

s32 TagTeam_Enemies(s32 objId, s32 *out) {
    s32 p, q, n = 0, me = -1;

    if (sMode == TAG_MODE_NONE || gBtlChars == NULL) {
        return -1;
    }
    for (p = 0; p < gBtlChars->count; p++) {
        if (gBtlChars->chars[p].objId == objId) {
            me = p;
        }
    }
    if (me < 0) {
        return -1;
    }
    if ((me ^ 1) < gBtlChars->count && alive(me ^ 1)) {
        out[n++] = gBtlChars->chars[me ^ 1].objId;
    }
    for (q = 0; q < gBtlChars->count; q++) {
        if (q == me || q == (me ^ 1)) {
            continue;
        }
        if ((sMode == TAG_MODE_FFA || (q & 1) != (me & 1)) && alive(q)) {
            out[n++] = gBtlChars->chars[q].objId;
        }
    }
    return n;
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


/* --- overhead health bars ------------------------------------------------------------------------------------------
   The Tag Team mod's guest_healthbars.py: after each view's ordering table is drawn (its hooks on Battle_Draw and
   Battle_DrawSplit's Ot_Draw calls, 0x12B8DC / 0x12BADC), every other fighter's head is projected with the view's
   matrix (Vu0Cur_ProjectPoint, 0x1210D8) and a bar is put 14 pixels above it as untextured GS sprites in a direct
   packet (Dma_BeginDirect / Dma_EndDirect, 0x100878 / 0x100890): 48 x 5 pixels, a one-pixel dark outline, a grey
   track, the health in the team's colour (GS ABGR 0x80FFBC48 blue, 0x804878FF red). The point projected is the
   model's node 0x30 (the mod reads model + 3436 + 48 * 4, as BtlCharApi_GetNodePos does) raised by 3 units. In a
   free-for-all each seat has a colour. */
#define BAR_W 48
#define BAR_H 5
#define BAR_GAP 14
#define BAR_NODE 0x30
#define BAR_LIFT 3.0f
#define SCR_X0 1792 /* the 512 x 448 screen in GS coordinates, centred on 2048, 2048 (src/sys/fade.c) */
#define SCR_Y0 1824
#define SCR_X1 (SCR_X0 + 512)
#define SCR_Y1 (SCR_Y0 + 448)

extern u64 *Dma_BeginDirect(void);
extern void Dma_EndDirect(u64 *end);
extern void Gfx_PutDefaultEnv(u64 **pp);
extern s32 Vu0Cur_ProjectPoint(s32 *out, Vec4 *pos); /* with the loaded matrix */
extern void Vu0Cur_Push(void);
extern void Vu0Cur_Pop(void);
extern void Vu0Cur_LoadMtx(Mtx44 *m);
#include "battle/btl_cam.h" /* gBtlCamView: the view being drawn */
extern void BtlCharApi_GetNodePos(s32 objId, s32 node, Vec4 *out);
extern s32 BtlCharApi_GetHpMax(s32 objId);

static const u32 sBarColor[TAG_FIGHTERS_MAX] = {0x80FFBC48, 0x804878FF, 0x8048E070, 0x8030D0F0};
static s32 sLocalSeat;   /* the fighter this screen belongs to: no bar over it */
static s32 sBarsDrawn;   /* bars of the last view drawn (tests) */

void TagTeam_SetLocalSeat(s32 p) {
    sLocalSeat = p;
}

s32 TagTeam_LocalSeat(void) {
    return sLocalSeat;
}

/* One untextured, alpha-blended sprite from (x0, y0) to (x1, y1), GS pixels. */
static u64 *bar_rect(u64 *p, s32 x0, s32 y0, s32 x1, s32 y1, u32 abgr) {
    p[0] = GIF_TAG(2, 0, 1);
    p[1] = GIF_REG_AD;
    p += 2;
    p[0] = 0x46; /* sprite, alpha blended (src/sys/fade.c) */
    p[1] = GS_PRIM;
    p += 2;
    p[0] = (u64)abgr | (0x3F800000ULL << 32);
    p[1] = GS_RGBAQ;
    p += 2;
    p[0] = GIF_TAG_EX(1, 0, GIF_FLG_REGLIST, 2);
    p[1] = GS_REG_XYZ2 | (GS_REG_XYZ2 << 4);
    p += 2;
    p[0] = GS_SET_XYZ(x0 << 4, y0 << 4, 0);
    p[1] = GS_SET_XYZ(x1 << 4, y1 << 4, 0);
    return p + 2;
}

void TagTeam_DrawOverheadBars(void) {
    Vec4 pos __attribute__((aligned(16)));
    s32 scr[4] __attribute__((aligned(16)));
    s32 p, objId, hp, max, x, y, fill;
    u64 *q;

    sBarsDrawn = 0;
    if (sMode == TAG_MODE_NONE || gBtlChars == NULL || gBtlChars->chars == NULL) {
        return;
    }
    q = Dma_BeginDirect();
    Gfx_PutDefaultEnv(&q);
    q[0] = GIF_TAG(2, 0, 1);
    q[1] = GIF_REG_AD;
    q += 2;
    q[0] = 0x30000; /* alpha and depth tests always pass */
    q[1] = GS_TEST_1;
    q += 2;
    q[0] = GS_SET_ZBUF(0xE0, GS_PSMZ24, 1); /* no depth writes */
    q[1] = GS_ZBUF_1;
    q += 2;
    Vu0Cur_Push();
    Vu0Cur_LoadMtx(&gBtlCamView->world2screen); /* the view's world-to-screen, as the effects load it (eft_g.c) */
    for (p = 0; p < gBtlChars->count; p++) {
        if (p == sLocalSeat) {
            continue;
        }
        objId = gBtlChars->chars[p].objId;
        hp = BtlCharApi_GetHp(objId);
        max = BtlCharApi_GetHpMax(objId);
        if (max <= 0) {
            continue;
        }
        BtlCharApi_GetNodePos(objId, BAR_NODE, &pos);
        pos.y -= BAR_LIFT; /* (negative y is up) */
        pos.w = 1.0f;
        Vu0Cur_ProjectPoint(scr, &pos);
        if (scr[3] <= 0) { /* behind the view */
            continue;
        }
        x = (scr[0] >> 4) - BAR_W / 2;
        y = (scr[1] >> 4) - BAR_GAP - BAR_H;
        if (x < SCR_X0 + 1 || x + BAR_W > SCR_X1 - 1 || y < SCR_Y0 + 1 || y + BAR_H > SCR_Y1 - 1) {
            continue;
        }
        fill = hp <= 0 ? 0 : hp >= max ? BAR_W : BAR_W * hp / max;
        q = bar_rect(q, x - 1, y - 1, x + BAR_W + 1, y + BAR_H + 1, 0x80101010);
        q = bar_rect(q, x, y, x + BAR_W, y + BAR_H, 0x80404040);
        if (fill > 0) {
            q = bar_rect(q, x, y, x + fill, y + BAR_H, sBarColor[sMode == TAG_MODE_FFA ? p : (p & 1)]);
        }
        sBarsDrawn++;
    }
    Vu0Cur_Pop();
    Dma_EndDirect(q);
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

/* Diagnostics for the tests: what drives fighter i. 0: its input is the AI's (injectOn); 1: the AI work of side i
   has parameters (runs); 2: that AI work's last buttons; 3: that AI work's object. -1: no such thing. */
EMSCRIPTEN_KEEPALIVE s32 Web_FighterDebug(s32 kind, s32 i) {
    BtlMgrChr *chr = fighter(i);
    switch (kind) {
    case 0:
        return chr != NULL ? chr->injectOn : -1;
    case 1:
        return gBtlAi != NULL && i >= 0 && i < 2 ? gBtlAi->work[i].param != NULL : -1;
    case 2:
        return gBtlAi != NULL && i >= 0 && i < 2 ? (s32)gBtlAi->work[i].out.buttons : -1;
    case 3:
        return gBtlAi != NULL && i >= 0 && i < 2 ? gBtlAi->work[i].objId : -1;
    }
    return -1;
}

EMSCRIPTEN_KEEPALIVE s32 Web_OverheadBars(void) { /* bars of the last view drawn */
    return sBarsDrawn;
}

EMSCRIPTEN_KEEPALIVE s32 Web_BattleSeq(void) { /* the battle sequence's state (battle/btl_seq.h), -1 outside */
    return gBtlSeq != NULL ? gBtlSeq->state : -1;
}

EMSCRIPTEN_KEEPALIVE s32 Web_BattleWinner(void) {
    return BattleResult_GetWinnerSide();
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
