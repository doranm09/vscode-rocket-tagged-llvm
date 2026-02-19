// Minimal tagged Rocket payload example.
#define TAG(name) __asm__ volatile("# TAG:" #name)

int main(void) {
  volatile int x = 41;
  TAG(BOOT);
  x += 1;
  TAG(INIT);
  x += 1;
  TAG(RUN);
  return x;
}
