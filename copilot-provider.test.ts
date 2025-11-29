import { test, expect } from "bun:test";
import { Effect, Schema, JSONSchema } from "effect";
import { generateObject } from "ai";
import { Copilot } from "./src/copilot";
import { createCopilotProvider } from "./src/copilot-provider";
import { jsonSchema } from "ai";

const MathResult = Schema.Struct({
    answer: Schema.Number.annotations({ description: "The numeric answer" }),
    explanation: Schema.String.annotations({
        description: "Step by step explanation",
    }),
});

type MathResult = typeof MathResult.Type;

test("copilot provider structured object generation", async () => {
    const program = Effect.gen(function* () {
        const copilot = yield* Copilot;
        const provider = createCopilotProvider(copilot);

        const result = yield* Effect.promise(() =>
            generateObject({
                model: provider.chat("gpt-4o"),
                schema: jsonSchema<MathResult>(JSONSchema.make(MathResult)),
                schemaName: "math_result",
                prompt: "What is 15 * 7?",
            })
        );

        console.log("Result:", result.object);
        expect(result.object.answer).toBe(105);
        expect(typeof result.object.explanation).toBe("string");
    });

    await Effect.runPromise(program.pipe(Effect.provide(Copilot.Default)));
});
