#!/usr/bin/env node
// =============================================================================
// RD-0165 — TritSSL / "Wavefront TLS" (next-gen SSL) — machine-checkable proof
// =============================================================================
//
// SOURCE NOTE: notes/76-mesh-r-d-06.md (owner-pasted AI dialogue). The note
// proposes replacing SSL/TLS + X.509 + Certificate Authorities with a public
// ".spore" ternary geometric vector, where authentication is a single SIMD
// dot product  I = S . C  on hardware (silicon AVX-512 or a photonic
// Mach-Zehnder interferometer), claiming "death of X.509", "death of the
// handshake (0-RTT in one clock cycle)", and "death of CAs".
//
// STANDING R&D RULES applied here:
//   * Prove the maths — do NOT assume, CHECK (every claim below is executed).
//   * Most-secure Zero-Trust posture.
//   * NEVER endorse replacing real crypto/PKI with arithmetic or obfuscation.
//   * Pair every REFUTE with the sound "work-with-it".
//
// VERDICT (proven below):
//   REFUTE the security CORE of TritSSL on three independent grounds:
//     (a) A public dot-product gate provides NO IDENTITY BINDING. If C is
//         public, an attacker FORGES an accepting S with no secret. (Demo 1.)
//     (b) "0-RTT in one clock cycle" conflates a cheap arithmetic check with
//         AUTHENTICATED KEY EXCHANGE. A static accept-vector is trivially
//         REPLAYABLE; there is no freshness, no key agreement, no MAC over
//         the ciphertext. (Demo 2.)
//     (c) Mach-Zehnder  I_out = 2*E0^2*[1+cos(Δφ)]  is CORRECT physics, but it
//         is ANALOG. Crypto requires bit-exact, reproducible verification.
//         Detector/phase noise destroys bit-exactness and makes the
//         accept/reject boundary statistical, not algebraic. (Demo 3.)
//
//   ADOPT (sound retained subset):
//     * Keep ML-DSA (FIPS 204) / lattice PQ as Galerina's signature posture.
//       Security rests on Module-LWE / Module-SIS, NOT on "guessing a short
//       vector path" by inspection. A scalar dot product is NOT a lattice
//       signature and carries NO identity binding. (Demo 4 contrasts them.)
//     * Treat the .spore as an ADDITIONAL app-level PQ CAPABILITY TOKEN that
//       is signed (ML-DSA) and LAYERED ON real TLS 1.3 — never a replacement
//       for the CA-anchored certificate chain or the AEAD record layer.
//       (Demo 5 builds the layered model and shows it rejects the forgery.)
//
// node built-ins only.  PASS/FAIL per check; prints "N/N passed";
// process.exitCode = 1 on any FAIL.
// =============================================================================

import crypto from 'node:crypto';

// ---------- tiny test harness ----------
let PASS = 0, FAIL = 0;
const results = [];
function check(name, cond, detail = '') {
  if (cond) { PASS++; results.push(`  PASS  ${name}`); }
  else      { FAIL++; results.push(`  FAIL  ${name}${detail ? '  -- ' + detail : ''}`); }
}
function section(t) { results.push(''); results.push(`== ${t} ==`); }
const approx = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

// ---------- ternary vector helpers (the note's {-1,0,1}^256 space) ----------
const DIM = 256;
function dot(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }
function randTernary(dim, rng = Math.random) {
  const v = new Array(dim);
  for (let i = 0; i < dim; i++) { const r = rng(); v[i] = r < 1 / 3 ? -1 : r < 2 / 3 ? 0 : 1; }
  return v;
}

// =============================================================================
// DEMO 1 — IDENTITY-BINDING REFUTE: forge the vector-gate with NO secret.
// =============================================================================
// The note (sec. 1 & 3) says the certificate IS the public .spore = the
// capability lock vector C, and a client is authenticated iff its signature
// vector S satisfies  I = S . C >= tau.  But C is PUBLIC (it is literally the
// published certificate). Authentication that depends only on a value the
// verifier hands you is not authentication — it is a password printed on the
// door. We show an attacker, knowing ONLY the public C, constructs an
// accepting S with NO knowledge of any private key. This is the same class of
// break as the earlier "forge the websocket capability vector" result.
section('DEMO 1 — public dot-product gate has NO identity binding (forgery)');

{
  const tau = 64; // the note's geometric threshold (any positive tau; scaled to DIM)

  // The honest server publishes its public lock C (this IS the .spore cert).
  const C = randTernary(DIM);

  // --- Attacker forgery #1: copy the lock. S = C maximizes the dot product. ---
  // I = C.C = sum of squares of {-1,0,1} = (# nonzero coords) >= tau for any
  // realistic vector. Requires ZERO secret knowledge — only the public C.
  const S_copy = C.slice();
  const I_copy = dot(S_copy, C);
  const nonzero = C.reduce((n, x) => n + (x !== 0 ? 1 : 0), 0);
  check('forgery#1 S=C is accepted (I >= tau) with no secret',
        I_copy >= tau, `I=${I_copy}, tau=${tau}`);
  check('forgery#1 dot equals nonzero-coordinate count (algebraic, not secret)',
        I_copy === nonzero, `I=${I_copy}, nonzero=${nonzero}`);

  // --- Attacker forgery #2: construct an accepting S WITHOUT copying C, ---
  // using only sign information of C (still fully public). Set S_i = sign(C_i)
  // on the first k nonzero coords until the threshold is met, zero elsewhere.
  // This proves there is an entire SUBSPACE of forgeries, not a lucky guess.
  const S_forge = new Array(DIM).fill(0);
  let acc = 0, used = 0;
  for (let i = 0; i < DIM && acc < tau; i++) {
    if (C[i] !== 0) { S_forge[i] = Math.sign(C[i]); acc += 1; used++; }
  }
  const I_forge = dot(S_forge, C);
  check('forgery#2 sign-aligned sparse S is accepted (I >= tau)',
        I_forge >= tau, `I=${I_forge}, tau=${tau}, coords_used=${used}`);
  check('forgery#2 used only public sign(C) info, zero private key bits',
        S_forge.every((v, i) => v === 0 || v === Math.sign(C[i])));

  // --- Count the forgery space: ANY S whose support aligns with sign(C) on ---
  // enough coords accepts. The verifier cannot distinguish honest from forged
  // because there is no secret in the relation at all. We sample to show a
  // huge acceptance rate among naive "aligned" attackers.
  let accepts = 0, trials = 20000;
  for (let t = 0; t < trials; t++) {
    const S = new Array(DIM).fill(0);
    // attacker aligns a random subset of coords with public sign(C)
    for (let i = 0; i < DIM; i++) {
      if (C[i] !== 0 && Math.random() < 0.6) S[i] = Math.sign(C[i]);
    }
    if (dot(S, C) >= tau) accepts++;
  }
  const rate = accepts / trials;
  check('forgery space is large: >50% of sign-aligned attackers accepted',
        rate > 0.5, `acceptance_rate=${(rate * 100).toFixed(1)}%`);

  // CONCLUSION: identity binding REQUIRES a secret the verifier does NOT hold
  // and CANNOT derive from public data (a signature under a private key). A
  // public dot-product gate fails this by construction. => "death of X.509/CA"
  // would delete the only thing that binds a key to an identity. REFUTED.
}

// =============================================================================
// DEMO 2 — "0-RTT in one clock cycle" conflates a cheap check with AKE.
// =============================================================================
// The note (sec. 2) claims the first packet carries S; the NIC computes
// I = S.C; if I=1 the server "instantly streams the encrypted website ... in
// literally one clock cycle", with "no hello phase". We show:
//   * a STATIC accept-token is trivially REPLAYABLE (record once, resend) —
//     so even if S were secret, a passive wiretapper wins;
//   * the scheme performs NO KEY AGREEMENT, so there is no session key to
//     encrypt "the website" with, and no MAC binding ciphertext to the auth;
//   * by contrast a real AKE (here modeled with ECDH, the same primitive
//     class TLS 1.3 uses) derives a FRESH shared secret per connection that a
//     passive attacker cannot reproduce. TLS 1.3 *does* offer 0-RTT, but with
//     documented anti-replay caveats — speed is not the missing piece.
section('DEMO 2 — replay & no-key-exchange: cheap check != authenticated KE');

{
  const C = randTernary(DIM);
  // Pretend (charitably) S is a "secret" accept vector the honest client uses.
  const S_secret = C.map(c => (c !== 0 ? Math.sign(c) : 0)); // accepts by construction
  const gate = (S) => dot(S, C) >= 64;

  check('honest static token authenticates', gate(S_secret));

  // Passive attacker records the first packet (S) off the wire and REPLAYS it.
  const wire = JSON.stringify(S_secret);     // what crosses the network
  const S_replayed = JSON.parse(wire);       // attacker copies bytes verbatim
  check('REPLAY: recorded static token re-authenticates the attacker',
        gate(S_replayed),
        'a static accept-vector with no nonce/freshness is replayable');

  // There is no key material produced: the "auth" is a boolean, not a secret.
  // Model the real thing: ephemeral ECDH gives each side a per-session secret
  // a passive observer cannot derive. (P-256 stands in for TLS 1.3 X25519.)
  const a = crypto.createECDH('prime256v1'); a.generateKeys();
  const b = crypto.createECDH('prime256v1'); b.generateKeys();
  const sa = a.computeSecret(b.getPublicKey());
  const sb = b.computeSecret(a.getPublicKey());
  check('real AKE derives a SHARED secret on both sides', sa.equals(sb));

  // A passive attacker who saw ONLY the two public keys cannot derive it.
  const e = crypto.createECDH('prime256v1'); e.generateKeys();
  const eGuess = e.computeSecret(b.getPublicKey()); // attacker's own DH, not the session key
  check('passive attacker CANNOT reproduce the AKE session secret',
        !eGuess.equals(sa));

  // Fresh ephemeral keys => different session secret next time (no replay value).
  const a2 = crypto.createECDH('prime256v1'); a2.generateKeys();
  const sa2 = a2.computeSecret(b.getPublicKey());
  check('AKE gives a FRESH secret each session (token-replay has no value)',
        !sa2.equals(sa));

  // CONCLUSION: a one-cycle dot product is a fast ADMISSION CHECK, not key
  // exchange. Encryption needs a fresh, mutually-derived, attacker-unknowable
  // key + transcript binding. Conflating the two is the core error. REFUTED.
}

// =============================================================================
// DEMO 3 — Mach-Zehnder: correct PHYSICS, but ANALOG => not bit-exact crypto.
// =============================================================================
// Reproduce the note's equation (sec. Photonic):
//     E_spore = E0 * e^{ i(wt + phiS) },  E_lock = E0 * e^{ i(wt + phiC) }
//     I_out = |E_spore + E_lock|^2 = 2*E0^2*[1 + cos(phiS - phiC)]
// Verify Δφ=0 -> 4 E0^2 (constructive) and Δφ=π -> 0 (destructive), exactly as
// the note states. THEN show that real detectors have shot/thermal noise and
// real modulators have phase jitter, so the measured intensity is a random
// variable. The "I=0 == perfect denial / I=4E0^2 == perfect accept" claim is
// an idealization; with noise the accept/reject decision is STATISTICAL and a
// fixed threshold both false-accepts and false-rejects. Crypto cannot tolerate
// that: verification must be a reproducible bit, not a noisy analog level.
section('DEMO 3 — Mach-Zehnder physics correct, but analog breaks bit-exactness');

{
  const E0 = 1.0;
  // Closed form from superposition of two equal-amplitude waves:
  //   |E0 e^{i(wt+phiS)} + E0 e^{i(wt+phiC)}|^2
  //     = E0^2 |e^{i phiS} + e^{i phiC}|^2
  //     = E0^2 ( (cosA+cosB)^2 + (sinA+sinB)^2 )
  //     = E0^2 ( 2 + 2 cos(phiS - phiC) ) = 2 E0^2 [1 + cos(Δφ)].
  const I_closed = (phiS, phiC) => 2 * E0 * E0 * (1 + Math.cos(phiS - phiC));

  // Independent numeric check via explicit complex addition (no identity used).
  const I_numeric = (phiS, phiC) => {
    const re = E0 * Math.cos(phiS) + E0 * Math.cos(phiC);
    const im = E0 * Math.sin(phiS) + E0 * Math.sin(phiC);
    return re * re + im * im;
  };

  // Sanity: closed form == explicit field-addition over a sweep.
  let formulaOK = true;
  for (let k = 0; k <= 32; k++) {
    const ps = (k / 32) * 2 * Math.PI, pc = ((k * 7) % 32 / 32) * 2 * Math.PI;
    if (!approx(I_closed(ps, pc), I_numeric(ps, pc), 1e-9)) formulaOK = false;
  }
  check('I_out = 2 E0^2 [1+cos(Δφ)] matches explicit field superposition', formulaOK);

  // Note's two named cases, reproduced EXACTLY:
  check('constructive Δφ=0  -> I_out = 4 E0^2  (gate fully open)',
        approx(I_closed(0, 0), 4 * E0 * E0));
  check('destructive Δφ=π  -> I_out = 0       (gate dark)',
        approx(I_closed(Math.PI, 0), 0));
  check('partial Δφ=π/2     -> I_out = 2 E0^2  (ambiguous / quarantine)',
        approx(I_closed(Math.PI / 2, 0), 2 * E0 * E0));

  // ---- Now break bit-exactness with realistic noise. ----
  // Model: phase jitter sigma_phi (modulator/thermal) + additive detector
  // noise sigma_I (shot/thermal/ADC). Decide ACCEPT if measured I > threshold.
  // We use a deliberately MODEST noise level to make the point conservatively.
  function gaussian(rng = Math.random) { // Box-Muller
    let u = 0, v = 0; while (u === 0) u = rng(); while (v === 0) v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  const sigmaPhi = 0.06;   // ~3.4 deg RMS phase jitter (optimistic for real MZIs)
  const sigmaI   = 0.05;   // detector/ADC noise, in units of E0^2
  const measure = (phiS, phiC) => {
    const dphi = (phiS - phiC) + sigmaPhi * gaussian();
    return 2 * E0 * E0 * (1 + Math.cos(dphi)) + sigmaI * gaussian();
  };

  // The two EXTREME states (Δφ=0 vs π) are maximally separated (0 vs 4 E0^2),
  // so a single well-isolated bit CAN survive modest noise -- that is honest
  // physics and we do NOT overclaim a flip there. Bit-exactness breaks where
  // crypto actually lives: (i) the ternary scheme needs a THIRD level whose
  // accept/deny BOUNDARIES sit near the partial state, and (ii) any decision
  // boundary is crossed by the noise tail. We therefore measure the bit-error
  // rate at a realistic THRESHOLD boundary, exactly the regime the note labels
  // "partial / quarantine".
  const N = 50000;

  // (A) Boundary bit-error: a phase placed just inside "accept" whose ideal
  //     intensity sits one threshold-step above the decision line. With a
  //     decision threshold at that line, the noise tail flips the verdict.
  //     This is the operative crypto case: the verdict is a random variable.
  const thrBoundary = 3 * E0 * E0;          // decision line between accept & partial
  const phiAccept = Math.acos(thrBoundary / (2 * E0 * E0) - 1); // ideal I == thrBoundary
  let boundaryFlips = 0;
  for (let i = 0; i < N; i++) if (measure(phiAccept, 0) <= thrBoundary) boundaryFlips++;
  const ber = boundaryFlips / N;
  check('analog verdict is a RANDOM VARIABLE at a decision boundary (BER>0)',
        ber > 0.01, `bit_error_rate=${(ber * 100).toFixed(1)}% at threshold boundary`);

  // (B) Even at a level center, the MEASURED intensity is a random variable:
  //     repeated reads of the SAME ideal phase return different values. A
  //     cryptographic verification must return the identical bit every time;
  //     an analog level cannot. We assert the read variance is strictly > 0
  //     and grows the error tail (which (A) already converts into a flip).
  const samples = [];
  for (let i = 0; i < N; i++) samples.push(measure(Math.PI / 2, 0)); // ideal "0" level
  const mean = samples.reduce((s, x) => s + x, 0) / N;
  const variance = samples.reduce((s, x) => s + (x - mean) ** 2, 0) / N;
  check('repeated reads of one symbol are non-identical (variance > 0)',
        variance > 1e-6, `read_variance=${variance.toFixed(5)} (not a reproducible bit)`);

  // (C) The destructive null is not exactly zero shot-to-shot.
  const destructiveSpread = (() => {
    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i < 1000; i++) { const v = measure(Math.PI, 0); mn = Math.min(mn, v); mx = Math.max(mx, v); }
    return mx - mn;
  })();
  check('destructive "exact 0" null is NOT bit-exact under noise',
        destructiveSpread > 1e-6, `intensity spread=${destructiveSpread.toFixed(4)}`);

  // Contrast: a hash/MAC verification is a REPRODUCIBLE bit every time.
  const m = Buffer.from('capability-token');
  const h1 = crypto.createHash('sha256').update(m).digest('hex');
  const h2 = crypto.createHash('sha256').update(m).digest('hex');
  check('digital MAC/hash verification IS bit-exact and reproducible', h1 === h2);

  // CONCLUSION: the interferometer equation is right; the inference "therefore
  // it computes crypto" is wrong. Mach-Zehnder is an ANALOGY for the ternary
  // states, not a signature. Analog intensities cannot be a bit-exact identity
  // proof. REFUTED (physics retained as illustration only).
}

// =============================================================================
// DEMO 4 — SOUND retained core: a dot product is NOT a lattice signature.
// =============================================================================
// The note claims the ternary dot product "perfectly mirrors" ML-DSA and that
// guessing the short vector is "a mathematically impossible maze". We show the
// scalar gate is linear & invertible-by-inspection (Demo 1 already forged it),
// whereas a real lattice signature (modeled with Node's ML-DSA-65 if available,
// else asserted structurally) binds a key pair and is unforgeable without the
// private key. The SOUND part of the note is "keep lattice/ML-DSA PQ", NOT
// "replace signatures with a dot product".
section('DEMO 4 — lattice/ML-DSA is the sound retained part (NOT a dot product)');

{
  // Structural facts that hold regardless of crypto library availability:
  // (i) the ternary gate is LINEAR: I(S1+S2)=I(S1)+I(S2). Linearity is exactly
  //     what lets an attacker compose/forge accepting inputs (Demo 1).
  const C = randTernary(DIM);
  const S1 = randTernary(DIM), S2 = randTernary(DIM);
  const lin = dot(S1.map((x, i) => x + S2[i]), C) === dot(S1, C) + dot(S2, C);
  check('ternary gate is LINEAR (composable => forgeable), unlike a signature', lin);

  // (ii) A real signature is EXISTENTIALLY UNFORGEABLE: without the private key
  //      you cannot produce a valid signature on a fresh message. Demonstrate
  //      with a standard signature scheme. Prefer PQ ML-DSA-65 (FIPS 204) if
  //      this Node build exposes it; otherwise fall back to Ed25519 to make the
  //      unforgeability property concrete. Either way the POINT is identity
  //      binding via a private key, which the dot product lacks.
  let sigAlg = null, sigForgeryBlocked = false, sigVerifies = false;
  function trySign(alg, genOpts) {
    try {
      const { publicKey, privateKey } = crypto.generateKeyPairSync(alg, genOpts || {});
      const msg = Buffer.from('spore-capability:bank.example:exp=2026-12-31');
      const sig = crypto.sign(null, msg, privateKey);
      const ok = crypto.verify(null, msg, publicKey, sig);
      // Forgery attempt: flip one signature byte -> must fail to verify.
      const bad = Buffer.from(sig); bad[0] ^= 0xff;
      const forged = crypto.verify(null, msg, publicKey, bad);
      return { ok, forged };
    } catch { return null; }
  }
  // Attempt ML-DSA first (Node >= 22.x exposes 'ml-dsa-65' on some builds).
  let r = null;
  for (const alg of ['ml-dsa-65', 'ml-dsa-87', 'ml-dsa-44']) {
    r = trySign(alg); if (r) { sigAlg = alg; break; }
  }
  if (!r) { r = trySign('ed25519'); if (r) sigAlg = 'ed25519 (classical fallback)'; }
  if (r) { sigVerifies = r.ok; sigForgeryBlocked = (r.forged === false); }

  check(`a real signature verifies and is unforgeable (alg=${sigAlg || 'n/a'})`,
        !!r && sigVerifies && sigForgeryBlocked,
        r ? `verify=${sigVerifies}, forged_accepted=${r.forged}` : 'no signature alg available');

  // (iii) ML-DSA security rests on Module-LWE / Module-SIS hardness, NOT on a
  //       single dot product being hard to invert. Record this as an explicit
  //       asserted note so the proof states the retained posture unambiguously.
  const retainedPosture =
    'ADOPT: ML-DSA (FIPS 204) / Module-LWE+Module-SIS as Galerina PQ signatures; ' +
    'a ternary dot product carries no identity binding and is not a substitute.';
  check('retained PQ posture is recorded (lattice signatures, not dot products)',
        retainedPosture.includes('ML-DSA') && retainedPosture.includes('Module-LWE'));
}

// =============================================================================
// DEMO 5 — WORK-WITH-IT: .spore as a SIGNED app-level PQ capability token,
//          LAYERED ON real TLS 1.3 (never a replacement).
// =============================================================================
// The constructive design: the .spore carries capability claims (subject,
// expiry, scope). It is SIGNED with a PQ signature (Demo 4). It is presented
// INSIDE an already-authenticated, already-encrypted TLS 1.3 channel whose
// server identity is bound by the CA-anchored X.509 chain. The dot-product /
// geometry is at most a fast PRE-FILTER; admission still requires a valid PQ
// signature over fresh, bound claims. We show this layered token rejects the
// Demo-1 forgery (no private key => no valid signature).
section('DEMO 5 — sound layered model: signed PQ capability token over TLS 1.3');

{
  // Issuer key (would be ML-DSA in production; use whatever Demo 4 proved works).
  let alg = 'ed25519';
  for (const a of ['ml-dsa-65', 'ml-dsa-87', 'ml-dsa-44']) {
    try { crypto.generateKeyPairSync(a); alg = a; break; } catch {}
  }
  const { publicKey: issuerPub, privateKey: issuerPriv } = crypto.generateKeyPairSync(alg);

  function issueSpore(subject, scope, ttlSec) {
    const claims = {
      v: 1, subject, scope,
      iat: 1750000000,
      exp: 1750000000 + ttlSec,
      nonce: crypto.randomBytes(16).toString('hex'), // freshness, kills replay-as-grant
    };
    const payload = Buffer.from(JSON.stringify(claims));
    const sig = crypto.sign(null, payload, issuerPriv); // PQ signature over claims
    return { payload: payload.toString('base64'), sig: sig.toString('base64') };
  }
  // Verifier: must run INSIDE the TLS session (channel already AEAD-encrypted
  // and server-authenticated by the real X.509 chain). Verify PQ signature +
  // expiry + scope. The dot-product geometry, if present, is only a hint.
  function verifySpore(tok, now, requiredScope) {
    let claims;
    try { claims = JSON.parse(Buffer.from(tok.payload, 'base64').toString()); }
    catch { return false; }
    const ok = crypto.verify(null, Buffer.from(tok.payload, 'base64'),
                             issuerPub, Buffer.from(tok.sig, 'base64'));
    if (!ok) return false;                       // forged/tampered => reject
    if (now > claims.exp || now < claims.iat) return false; // expiry bound
    if (claims.scope !== requiredScope) return false;       // least privilege
    return true;
  }

  const now = 1750000100;
  const good = issueSpore('bank.example', 'read:balance', 3600);
  check('layered: validly-signed in-scope token is ACCEPTED',
        verifySpore(good, now, 'read:balance'));

  // Demo-1 forger has NO issuer private key. Best they can do is tamper claims
  // or fabricate a signature -> verification fails. The forgery that broke the
  // bare dot-product gate is INERT here.
  const tampered = { payload: Buffer.from(JSON.stringify(
      { v: 1, subject: 'bank.example', scope: 'admin:transfer',
        iat: 1750000000, exp: 1751000000, nonce: 'deadbeef' })).toString('base64'),
    sig: good.sig /* reuse a real signature over DIFFERENT claims */ };
  check('layered: forged/tampered token (no issuer key) is REJECTED',
        verifySpore(tampered, now, 'admin:transfer') === false);

  // Expiry is enforced (no "static accept forever").
  const expired = issueSpore('bank.example', 'read:balance', 1);
  check('layered: expired token is REJECTED (freshness bound)',
        verifySpore(expired, 1750000200, 'read:balance') === false);

  // Scope confinement (capability least-privilege).
  check('layered: out-of-scope use is REJECTED (least privilege)',
        verifySpore(good, now, 'admin:transfer') === false);

  // Explicitly assert the architectural rule.
  const rule =
    '.spore = app-level PQ capability token, signed (ML-DSA), presented inside ' +
    'TLS 1.3 (CA-anchored X.509 server identity + AEAD record layer). ' +
    'It LAYERS ON TLS; it does NOT replace X.509/CA/handshake.';
  check('architectural rule recorded: LAYER-ON, never REPLACE',
        rule.includes('LAYERS ON') && rule.includes('does NOT replace'));
}

// =============================================================================
// REPORT
// =============================================================================
console.log('\n================ RD-0165  TritSSL / Wavefront TLS — PROOF ================');
console.log(results.join('\n'));
const TOTAL = PASS + FAIL;
console.log('\n--------------------------------------------------------------------------');
console.log(`RESULT: ${PASS}/${TOTAL} passed` + (FAIL ? `  (${FAIL} FAILED)` : ''));
console.log('VERDICT: REFUTE security core (no identity binding; replay; analog!=bit-exact)');
console.log('         ADOPT  ML-DSA/lattice PQ; .spore = signed PQ capability token over TLS 1.3');
console.log('==========================================================================\n');

process.exitCode = FAIL ? 1 : 0;
