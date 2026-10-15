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

#endif
