import { test, expect } from "bun:test";
import { Effect, Schema, Layer } from "effect";
import { CopilotAuth } from "../src/copilotAuth";
import { AI, make as makeAI } from "../src/ai";

const MathResult = Schema.Struct({
    answer: Schema.Number.annotations({ description: "The numeric answer" }),
    explanation: Schema.String.annotations({
        description: "Step by step explanation",
    }),
});

test("AI service structured object generation", async () => {
    const program = Effect.gen(function* () {
        const ai = yield* AI;

        const result = yield* ai.generateObject("What is 15 * 7?", MathResult, {
            schemaName: "math_result",
        });

        console.log("Result:", result);
        expect(result.answer).toBe(105);
        expect(typeof result.explanation).toBe("string");
        expect(result.explanation.length).toBeGreaterThan(0);
    });

    const AILayer = makeAI("gpt4o").pipe(Layer.provide(CopilotAuth.Default));

    await Effect.runPromise(program.pipe(Effect.provide(AILayer)));
});
