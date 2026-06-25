import gc, json, os, platform, sys, time, tracemalloc

# Tower of Hanoi with a threaded move-checksum: acc = (acc*31 + moveCode) % 65521 over all 2^n-1 moves.
# Cross-language-identical, < 2^31 (safe in LogicN's overflow-trapping i32). `result` = the checksum oracle.
DEFAULT_N = 16            # 65,535 moves per call
DEFAULT_ITERATIONS = 20

sys.setrecursionlimit(100000)

def hanoi(n, frm, to, aux, acc):
    if n == 0:
        return acc
    a1 = hanoi(n - 1, frm, aux, to, acc)
    move_code = n * 36 + frm * 6 + to
    mixed = (a1 * 31 + move_code) % 65521
    return hanoi(n - 1, aux, to, frm, mixed)

def run_bench(n, iterations):
    hanoi(n, 0, 2, 1, 0)  # warmup
    total_moves = (2 ** n - 1) * iterations
    t0 = time.perf_counter()
    cpu0 = time.process_time()
    result = 0
    for _ in range(iterations):
        result = hanoi(n, 0, 2, 1, 0)
    elapsed = (time.perf_counter() - t0) * 1000
    cpu_ms = (time.process_time() - cpu0) * 1000

    _mem_iters = min(iterations, 50)
    gc.collect(); tracemalloc.start()
    _base = tracemalloc.get_traced_memory()[0]
    for _ in range(_mem_iters):
        hanoi(n, 0, 2, 1, 0)
    _cur, _peak = tracemalloc.get_traced_memory(); tracemalloc.stop()

    return {
        "runtime": "python", "benchmark": "tower-of-hanoi-v1",
        "n": n, "result": result, "iterations": iterations, "movesPerCall": 2 ** n - 1,
        "elapsedMs": round(elapsed, 3),
        "movesPerSecond": round(total_moves / max(elapsed / 1000, 1e-9), 2),
        "iterationsPerSecond": round(iterations / max(elapsed / 1000, 1e-9), 2),
        "cpu": {"processMs": round(cpu_ms, 3)},
        "memory": {"heapUsedBytes": _cur, "heapUsedDelta": _cur - _base, "tracemallocPeak": _peak},
        "process": {"pid": os.getpid(), "python": platform.python_version(),
                    "platform": platform.platform(), "arch": platform.machine()},
    }

if __name__ == "__main__":
    n, its = DEFAULT_N, DEFAULT_ITERATIONS
    for i, a in enumerate(sys.argv):
        if a == "--n" and i + 1 < len(sys.argv): n = int(sys.argv[i + 1])
        if a in ("--operations", "--iterations") and i + 1 < len(sys.argv): its = int(sys.argv[i + 1])
    print(json.dumps(run_bench(n, its), indent=2))
