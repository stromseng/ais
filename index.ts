import { Effect, Console, Schema, JSONSchema } from "effect";
import { BunRuntime, BunContext } from "@effect/platform-bun";
import { Command, Args, HelpDoc, Span } from "@effect/cli";
import { generateObject, generateText, jsonSchema } from "ai";
import { ollama } from "ollama-ai-provider-v2";

const model = ollama("qwen3:30b-a3b");

// Define a text argument
const text = Args.text({ name: "text" });

const longtext = Args.repeated(text);

const outputSchema = Schema.Struct({
    command: Schema.String.annotations({
        description:
            "The CLI command to execute the action the user wants to perform.",
    }),
    explanation: Schema.String.annotations({
        description: "A short explanation of the command and its arguments.",
    }),
});

const command = Command.make("echo", { longtext }, ({ longtext }) => {
    return Effect.gen(function* () {
        const { object } = yield* Effect.tryPromise(() =>
            generateObject({
                model: model,
                providerOptions: { ollama: { think: true } },
                system: "Generate a CLI command to execute the action the user wants to perform. Make sure to explain what every flag and argument does. Do not include any example output.",
                prompt: longtext.join(" "),
                schema: jsonSchema(JSONSchema.make(outputSchema)),
            })
        );
        yield* Console.log(object);
    });
});

// Set up the CLI application
const cli = Command.run(command, {
    name: "AI Suggestions CLI",
    version: "0.0.1",
    summary: Span.text("Generate commands using AI."),
});

// Prepare and run the CLI application
cli(process.argv).pipe(Effect.provide(BunContext.layer), BunRuntime.runMain);
