#ifndef FSM_TRACE_H
#define FSM_TRACE_H

/*
 * Emit a 32-bit FSM tag ID into a dedicated sideband section.
 * The extension extracts this section (.fsm_trace) into a binary stream
 * for hardware FSM checker consumption.
 */
#define FSM_TRACE_EMIT_ID(tag_id)                                                \
  __asm__ volatile(                                                               \
      ".pushsection .fsm_trace,\"a\",@progbits\n"                                \
      ".balign 4\n"                                                               \
      ".word " #tag_id "\n"                                                      \
      ".popsection\n"                                                             \
      :                                                                           \
      :                                                                           \
      : "memory")

/* Emit both human-readable asm marker and sideband ID. */
#define FSM_TAG(state_name, tag_id)                                               \
  do {                                                                            \
    __asm__ volatile("# TAG:" #state_name);                                      \
    FSM_TRACE_EMIT_ID(tag_id);                                                    \
  } while (0)

#endif
