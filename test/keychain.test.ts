import { Console, Effect } from "effect";
import { Keychain } from "../src/keychain";
import { BunRuntime } from "@effect/platform-bun";
import { test, expect } from "bun:test";

test("Keychain test", async () => {
    const program = Effect.gen(function* () {
        const keychain = yield* Keychain;
        yield* keychain.write("auth", "test");
        const auth = yield* keychain.read("auth");
        expect(auth).toBe("test");
        yield* keychain.delete("auth");
    });
    await Effect.runPromise(program.pipe(Effect.provide(Keychain.Default)));
});
