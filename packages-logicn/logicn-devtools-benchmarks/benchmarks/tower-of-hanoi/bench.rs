// Tower of Hanoi with a threaded move-checksum: acc = (acc*31 + moveCode) % 65521 over all 2^n-1 moves.
// Cross-language-identical (< 2^31, safe in LogicN's overflow-trapping i32). `result` = the checksum oracle.
use std::time::Instant;
use std::env;
use std::hint::black_box;

fn hanoi(n: i64, from: i64, to: i64, aux: i64, acc: i64) -> i64 {
    if n == 0 { return acc; }
    let a1 = hanoi(n - 1, from, aux, to, acc);
    let move_code = n * 36 + from * 6 + to;
    let mixed = (a1 * 31 + move_code) % 65521;
    hanoi(n - 1, aux, to, from, mixed)
}

fn main() {
    let mut n: i64 = 16;
    let mut iterations: usize = 2000;
    let args: Vec<String> = env::args().collect();
    let mut i = 1;
    while i + 1 < args.len() {
        match args[i].as_str() {
            "--n" => n = args[i+1].parse().unwrap_or(n),
            "--operations" | "--iterations" => iterations = args[i+1].parse().unwrap_or(iterations),
            _ => {}
        }
        i += 2;
    }
    let _ = black_box(hanoi(black_box(n), 0, 2, 1, 0));
    let t0 = Instant::now();
    let mut result: i64 = 0;
    for _ in 0..iterations { result = black_box(hanoi(black_box(n), 0, 2, 1, 0)); }
    let elapsed = t0.elapsed().as_secs_f64() * 1000.0;
    let moves_per_call: i64 = (1i64 << n) - 1;
    let total_moves = (moves_per_call as f64) * (iterations as f64);
    println!("{{\"runtime\":\"rust\",\"benchmark\":\"tower-of-hanoi-v1\",\"n\":{},\"result\":{},\"iterations\":{},\"movesPerCall\":{},\"elapsedMs\":{:.3},\"movesPerSecond\":{:.2},\"iterationsPerSecond\":{:.2}}}",
        n, result, iterations, moves_per_call, elapsed, total_moves / (elapsed / 1000.0), (iterations as f64) / (elapsed / 1000.0));
}
