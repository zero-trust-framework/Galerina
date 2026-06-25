// Tower of Hanoi with a threaded move-checksum: acc = (acc*31 + moveCode) % 65521 over all 2^n-1 moves.
// Cross-language-identical (< 2^31, safe in LogicN's overflow-trapping i32). `result` = the checksum oracle.
#include <cstdio>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <chrono>

static int64_t hanoi(int64_t n, int64_t from, int64_t to, int64_t aux, int64_t acc) {
    if (n == 0) return acc;
    int64_t a1 = hanoi(n - 1, from, aux, to, acc);
    int64_t moveCode = n * 36 + from * 6 + to;
    int64_t mixed = (a1 * 31 + moveCode) % 65521;
    return hanoi(n - 1, aux, to, from, mixed);
}

int main(int argc, char** argv) {
    int64_t n = 16; long iterations = 2000;
    for (int i = 1; i + 1 < argc; i += 2) {
        if (!strcmp(argv[i], "--n")) n = atoll(argv[i+1]);
        else if (!strcmp(argv[i], "--operations") || !strcmp(argv[i], "--iterations")) iterations = atol(argv[i+1]);
    }
    volatile int64_t warm = hanoi(n, 0, 2, 1, 0); (void)warm;
    auto t0 = std::chrono::high_resolution_clock::now();
    int64_t result = 0;
    for (long i = 0; i < iterations; i++) result = hanoi(n, 0, 2, 1, 0);
    double elapsed = std::chrono::duration<double, std::milli>(std::chrono::high_resolution_clock::now() - t0).count();
    int64_t movesPerCall = ((int64_t)1 << n) - 1;
    double totalMoves = (double)movesPerCall * (double)iterations;
    printf("{\"runtime\":\"cpp\",\"benchmark\":\"tower-of-hanoi-v1\",\"n\":%lld,\"result\":%lld,\"iterations\":%ld,\"movesPerCall\":%lld,\"elapsedMs\":%.3f,\"movesPerSecond\":%.2f,\"iterationsPerSecond\":%.2f}\n",
        (long long)n, (long long)result, iterations, (long long)movesPerCall, elapsed, totalMoves / (elapsed / 1000.0), (double)iterations / (elapsed / 1000.0));
    return 0;
}
