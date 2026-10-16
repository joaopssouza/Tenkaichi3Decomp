/* Memory for the Tag Team's extra fighters (src/battle/tag_team.c), outside the game's heap: the heap is the
   console's 28 MB (plat_mem.c) and nearly all of it is heap 0's, so what the extra fighters need beyond the two the
   game was made for comes from here. The Tag Team mod does the same on PCSX2 with the console's extended RAM
   (fresh_memory.py, heap128.py: docs/tagteam/core-mechanism.md).

   One static block, handed out in order and given back as a whole at the end of a battle: static, so that it is at
   the same address in every copy of the same program (two players' machines in a match must compute the same game),
   and below 4 GB in the 64-bit build too (the program is linked low). Addresses, not pointers, cross to the game's
   files, as Port_GameBigAlloc's do. */
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#define EXTRA_SIZE (16u << 20)

static uint8_t sExtra[EXTRA_SIZE] __attribute__((aligned(256)));
static uint32_t sUsed;

/* `size` bytes, zeroed, aligned to `align` (a power of two, at most 256); 0 when the block is full (said once). */
unsigned Port_ExtraAlloc(unsigned size, unsigned align) {
    static int said;
    uint32_t at;

    if (align == 0) {
        align = 16;
    }
    at = (sUsed + align - 1) & ~(align - 1);
    if (size > EXTRA_SIZE || at > EXTRA_SIZE - size) {
        if (!said) {
            said = 1;
            fprintf(stderr, "bt3: tag team: the extra memory is full (%u bytes asked, %u of %u used)\n", size, at, EXTRA_SIZE);
        }
        return 0;
    }
    sUsed = at + size;
    memset(sExtra + at, 0, size);
    return (unsigned)(uintptr_t)(sExtra + at);
}

/* Everything back (a battle's end: its fighters are gone). */
void Port_ExtraReset(void) {
    sUsed = 0;
}

#ifdef __EMSCRIPTEN__
#include <emscripten.h>
EMSCRIPTEN_KEEPALIVE unsigned Web_ExtraSize(void) { /* (tests: test/tag_offline.test.js) */
    return EXTRA_SIZE;
}
EMSCRIPTEN_KEEPALIVE unsigned Web_ExtraUsed(void) {
    return sUsed;
}
#endif
