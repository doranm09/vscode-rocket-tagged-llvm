#include "../runtime/fsm_trace.h"

enum {
  FSM_ID_BOOT = 1,
  FSM_ID_INIT = 2,
  FSM_ID_RUN = 3,
  FSM_ID_HALT = 4
};

int main(void) {
  volatile int x = 0;

  FSM_TAG(BOOT, FSM_ID_BOOT);
  x += 1;
  FSM_TAG(INIT, FSM_ID_INIT);
  x += 2;
  FSM_TAG(RUN, FSM_ID_RUN);
  x += 3;
  FSM_TAG(HALT, FSM_ID_HALT);

  return x;
}
