import { Console, Effect, Layer } from "effect";
import { Keychain } from "./src/keychain";
import {
    BunCommandExecutor,
    BunContext,
    BunRuntime,
} from "@effect/platform-bun";

const program = Effect.gen(function* () {
    const keychain = yield* Keychain;
    yield* keychain.write("auth", "test");
    const auth = yield* keychain.read("auth");
    yield* Console.log(`Read auth: ${auth}`);
    yield* keychain.delete("auth");
}).pipe(Effect.provide(Layer.mergeAll(Keychain.Default, BunContext.layer)));

program.pipe(BunRuntime.runMain);
