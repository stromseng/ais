import { Effect, Schema, Layer, Logger, LogLevel, JSONSchema } from "effect";
import { BunContext, BunRuntime } from "@effect/platform-bun";
import { Command, Args, Span } from "@effect/cli";
import { Copilot } from "./src/copilot";
import { SelectInput } from "./src/selectInput";
import chalk from "chalk";
import { generateObject, generateText, jsonSchema } from "ai";
import { createCopilotProvider } from "./src/copilot-provider";
import boxen from "boxen";
import { MODEL_STRINGS } from "./src/utils";

// Define a text argument
const longtext = Args.text({ name: "prompt" }).pipe(Args.repeated);

const command = Command.make("aip", { longtext }, ({ longtext }) => {
    return Effect.gen(function* () {
        // Only read stdin if there's piped input (not a TTY)
        const piped = yield* Effect.promise(() =>
            process.stdin.isTTY ? Promise.resolve("") : Bun.stdin.text()
        );
        yield* Effect.logDebug(`piped: ${piped}`);

        if (longtext.length === 0 && !piped) {
            yield* Effect.logError(chalk.red("No prompt provided"));
            process.exit(1);
        }
        yield* Effect.logDebug(`longtext: ${longtext.join(" ")}`);

        const prompt = longtext.join(" ") + (piped ? `\n\n${piped}` : "");

        const copilot = yield* Copilot;
        const provider = createCopilotProvider(copilot);

        const result = yield* Effect.promise(() =>
            generateText({
                model: provider.chat(MODEL_STRINGS.gpt4o),
                prompt: prompt,
            })
        );
        const parsed = result.text;

        console.log(parsed);
    });
});

// Set up the CLI application
const cli = Command.run(command, {
    name: "AI Prompt CLI",
    version: "0.0.1",
    summary: Span.text("Prompt AI."),
});

// Prepare and run the CLI application
cli(process.argv).pipe(
    Effect.provide(
        Layer.mergeAll(
            Copilot.Default,
            SelectInput.Default,
            BunContext.layer,
            Logger.pretty
        )
    ),
    Logger.withMinimumLogLevel(LogLevel.Info),
    BunRuntime.runMain
);
