(module
  (memory 2 2048)
  (export "memory" (memory 0))

  ;; strict-trapping i32 helper — signed overflow traps (unreachable)
  (func $lln_checked_add_i32 (param $a i32) (param $b i32) (result i32)
    (local $r i32)
    (local.set $r (i32.add (local.get $a) (local.get $b)))
    ;; signed overflow iff (a^r) & (b^r) < 0
    (if (i32.lt_s (i32.and (i32.xor (local.get $a) (local.get $r)) (i32.xor (local.get $b) (local.get $r))) (i32.const 0)) (then unreachable))
    (local.get $r))

  ;; strict-trapping i32 helper — signed overflow traps (unreachable)
  (func $lln_checked_sub_i32 (param $a i32) (param $b i32) (result i32)
    (local $r i32)
    (local.set $r (i32.sub (local.get $a) (local.get $b)))
    ;; signed overflow iff (a^b) & (a^r) < 0
    (if (i32.lt_s (i32.and (i32.xor (local.get $a) (local.get $b)) (i32.xor (local.get $a) (local.get $r))) (i32.const 0)) (then unreachable))
    (local.get $r))

  ;; pure flow: sumHelper
  (func $sumHelper (param $p0 i32) (param $p1 i32) (result i32)
    (if (i32.le_s (local.get $p0) (i32.const 0))
      (then
        (return (local.get $p1))
      )
    )
    (call $sumHelper (call $lln_checked_sub_i32 (local.get $p0) (i32.const 1)) (call $lln_checked_add_i32 (local.get $p1) (local.get $p0)))
  )
  (export "sumHelper" (func $sumHelper))

  ;; pure flow: triangleNumber
  (func $triangleNumber (param $p0 i32) (result i32)
    (call $sumHelper (local.get $p0) (i32.const 0))
  )
  (export "triangleNumber" (func $triangleNumber))

  ;; pure flow: main
  (func $main (result i32)
    (call $triangleNumber (i32.const 100))
  )
  (export "main" (func $main))

)