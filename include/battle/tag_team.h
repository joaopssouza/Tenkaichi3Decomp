#ifndef BATTLE_TAG_TEAM_H
#define BATTLE_TAG_TEAM_H

#include "types.h"

/*
 * Tag Team: battles with more than two fighters on the stage at once (the port only; docs/tagteam/core-mechanism.md).
 * Off unless something sets it (port/src/headless.c: BT3_TAG); with it off nothing of the battle changes.
 *   teams  2 to 4 fighters, physical fighter i on team i & 1 (the Tag Team mod's rule)
 *   ffa    2 to 4 fighters, each on their own
 */
#define TAG_MODE_NONE 0
#define TAG_MODE_TEAMS 1
#define TAG_MODE_FFA 2
#define TAG_FIGHTERS_MAX 4

void TagTeam_Set(s32 mode, s32 fighters);
s32 TagTeam_Mode(void);
s32 TagTeam_Fighters(void); /* 2 when the mode is off */

/* Seats: fighter p is gBtlChars->chars[p]. Its side (team) is p & 1, and it fights as member p >> 1 of that side's
   setup, alone (one member). With the mode off: side p, every member of the side, as the game has it. */
s32 TagTeam_SeatSide(s32 p);
s32 TagTeam_SeatMemberCount(s32 p, s32 sideMembers);
s32 TagTeam_SeatMember(s32 p, s32 i); /* the side's member that the fighter's own member i is */

/* The extra fighters' models and objects (seats 2 and up; seats 0 and 1 are the game's own, per side):
   requested with the battle's first load, created after it, given back at the battle's end. */
void TagTeam_RequestSeatModels(void);          /* battle_load.c, with the leaders' models */
void TagTeam_CreateSeatObjects(void);          /* battle_work.c, after the leaders' objects */
void TagTeam_EndBattle(void);                  /* battle.c, Battle_Term */
s32 TagTeam_Seat(void *chr);                   /* the fighter's seat p, -1 if it is not one */
struct Vec4;
s32 TagTeam_StartPlace(s32 p, struct Vec4 *pos, struct Vec4 *rot); /* an extra seat's start (the shallow V); returns the zone */
s32 TagTeam_SeatObjId(s32 p, s32 sideObjId);   /* the fighter's object: its own for an extra seat, else sideObjId */
u8 *TagTeam_CharaWork(s32 objId);
s32 TagTeam_FighterCount(void);                /* fighters of the battle on now, 0 outside one */
s32 TagTeam_FighterObjId(s32 p);               /* fighter p's object, -1 if none */
s32 TagTeam_Enemies(s32 objId, s32 *out); /* objects objId may hit (up to TAG_FIGHTERS_MAX - 1), -1: not a fighter */
void *TagTeam_Opponent(void *chr, void *gameOpponent); /* the fighter's opponent: its pair p ^ 1, else gameOpponent */              /* an extra fighter's object's work buffer, NULL for any other */

#endif
