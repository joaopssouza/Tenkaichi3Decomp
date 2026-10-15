#ifndef BATTLE_BTL_AI_SLOT_H
#define BATTLE_BTL_AI_SLOT_H

/* The AI work of fighter objId in gBtlAi->work. The port's Tag Team runs a second manager block for the fighters
   with objects 2 and 3 (btl_ai_mgr.c), whose works are [0] and [1] too: objId & 1. The game: objId (0 or 1). */
#ifdef PORT
#define BTLAI_SLOT(id) ((id) & 1)
#else
#define BTLAI_SLOT(id) (id)
#endif

#endif
