import { Keychain } from "./src/keychain";
import { Copilot } from "./src/copilot";
import { BunRuntime } from "@effect/platform-bun";
import { Schema, Effect, Console, Layer } from "effect";

// Example schema for structured output
const MathResult = Schema.Struct({
    answer: Schema.Number.annotations({ description: "The numeric answer" }),
    explanation: Schema.String.annotations({
        description: "Step by step explanation",
    }),
});

const program = Effect.gen(function* () {
    const copilot = yield* Copilot;

    // Test simple prompt (auth handled transparently)
    yield* Console.log("📤 Sending test prompt...\n");
    const response = yield* copilot.prompt("What is 2 + 2? Reply in one word.");
    yield* Console.log(`📥 Response: ${response}`);

    // Test structured output
    yield* Console.log("\n📤 Sending structured output request...\n");
    const result = yield* copilot.structuredOutput(
        MathResult,
        "What is 15 * 7?",
        { schemaName: "math_result" }
    );

    yield* Console.log(`📥 Structured Response:`);
    yield* Console.log(result);
});

BunRuntime.runMain(
    program.pipe(Effect.provide(Layer.mergeAll(Copilot.Default)))
);
