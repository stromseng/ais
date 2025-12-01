import { Effect, Layer, Logger, LogLevel } from "effect";
import { BunContext, BunRuntime } from "@effect/platform-bun";
import { Command, Args, Span } from "@effect/cli";
import { SelectInput } from "./src/selectInput";
import chalk from "chalk";
import { AI, make as makeAI } from "./src/ai";
import { CopilotAuth } from "./src/copilotAuth";

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

        const ai = yield* AI;
        const result = yield* ai.generateText(prompt);

        console.log(result);
    });
});

// Set up the CLI application
const cli = Command.run(command, {
    name: "AI Prompt CLI",
    version: "0.0.1",
    summary: Span.text("Prompt AI."),
});

// AI layer with specific model
const AILayer = makeAI("gpt51").pipe(Layer.provide(CopilotAuth.Default));

// Prepare and run the CLI application
cli(process.argv).pipe(
    Effect.provide(
        Layer.mergeAll(
            AILayer,
            SelectInput.Default,
            BunContext.layer,
            Logger.pretty
        )
    ),
    Logger.withMinimumLogLevel(LogLevel.Info),
    BunRuntime.runMain
);
