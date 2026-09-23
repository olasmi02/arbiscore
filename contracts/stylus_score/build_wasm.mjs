/**
 * Local build of the optimized WASM with your default toolchain, for inspection and for the
 * float-opcode test in tests/model_tests.rs. Deployments use the reproducible cargo-stylus build
 * (rust-toolchain.toml + Stylus.toml), which applies the same wasm-opt recipe inside Docker.
 *
 * Recent Rust toolchains link a prebuilt std that emits bulk-memory ops (memory.copy/fill),
 * which the Stylus validator rejects ("zero byte expected"). Binaryen lowers them to loops.
 *
 * Output: target/arbiscore_engine.stylus.wasm
 */
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const raw = path.join(dir, 'target', 'wasm32-unknown-unknown', 'release', 'arbiscore_engine.wasm');
const out = path.join(dir, 'target', 'arbiscore_engine.stylus.wasm');
const run = (cmd) => execSync(cmd, { cwd: dir, stdio: 'inherit' });

run('cargo build --target wasm32-unknown-unknown --release');
run(
  `npx -y -p binaryen@132.0.0 wasm-opt "${raw}" ` +
    '--enable-bulk-memory --enable-sign-ext --enable-mutable-globals ' +
    '--llvm-memory-copy-fill-lowering -Os --converge --strip-debug --strip-producers ' +
    `--disable-bulk-memory -o "${out}"`
);
console.log(`Stylus-ready WASM: ${out}`);
