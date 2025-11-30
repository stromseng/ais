import { Console, Effect } from "effect";
import { Keychain } from "../src/keychain";
import { BunRuntime } from "@effect/platform-bun";

const program = Effect.gen(function* () {
    const keychain = yield* Keychain;
    yield* keychain.write("auth", "test");
    const auth = yield* keychain.read("auth");
    yield* Console.log(`Read auth: ${auth}`);
    yield* keychain.delete("auth");
}).pipe(Effect.provide(Keychain.Default));

program.pipe(BunRuntime.runMain);
