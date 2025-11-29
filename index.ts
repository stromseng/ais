import {
    Effect,
    Console,
    Schema,
    JSONSchema,
    Config,
    Option,
    Layer,
    Logger,
    LogLevel,
} from "effect";
import { BunContext, BunRuntime } from "@effect/platform-bun";
import { Command, Args, HelpDoc, Span, Options } from "@effect/cli";
import { generateObject, generateText, jsonSchema } from "ai";
import { ollama } from "ollama-ai-provider-v2";
import { Copilot } from "./src/copilot";
import { Keychain } from "./src/keychain";

// Define a text argument
const longtext = Args.text({ name: "command prompt" }).pipe(Args.repeated);

const outputSchema = Schema.Struct({
    command: Schema.String.annotations({
        description:
            "The CLI command to execute the action the user wants to perform.",
    }),
    explanation: Schema.String.annotations({
        description: "A short explanation of the command and its arguments.",
    }),
});

const command = Command.make("ais", { longtext }, ({ longtext }) => {
    return Effect.gen(function* () {
        // const env_model = yield* Config.string("MODEL").pipe(
        //     Config.withDefault("qwen3:30b-a3b")
        // );

        // const { object } = yield* Effect.tryPromise(() =>
        //     generateObject({
        //         model: ollama(env_model),
        //         providerOptions: { ollama: { think: true } },
        //         system: "Generate a CLI command to execute the action the user wants to perform. Make sure to explain what every flag and argument does. Do not include any example output.",
        //         prompt: longtext.join(" "),
        //         schema: jsonSchema(JSONSchema.make(outputSchema)),
        //     })
        // );

        const copilot = yield* Copilot;
        const result = yield* copilot.structuredOutput(
            outputSchema,
            longtext.join(" ")
        );
        yield* Console.info(result);
    });
});

// Set up the CLI application
const cli = Command.run(command, {
    name: "AI Suggestions CLI",
    version: "0.0.1",
    summary: Span.text("Generate commands using AI."),
});

// Prepare and run the CLI application
cli(process.argv).pipe(
    Effect.provide(
        Layer.mergeAll(Copilot.Default, BunContext.layer, Logger.pretty)
    ),
    Logger.withMinimumLogLevel(LogLevel.Info),
    BunRuntime.runMain
);
