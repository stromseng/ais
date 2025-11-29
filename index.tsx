import { Effect, Schema, Layer, Logger, LogLevel, JSONSchema } from "effect";
import { BunContext, BunRuntime } from "@effect/platform-bun";
import { Command, Args, Span } from "@effect/cli";
import { Copilot } from "./src/copilot";
import { SelectInput } from "./src/selectInput";
import chalk from "chalk";
import { generateObject, jsonSchema } from "ai";
import { createCopilotProvider } from "./src/copilot-provider";

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

type Action = "execute" | "copy" | "cancel";

const command = Command.make("ais", { longtext }, ({ longtext }) => {
    return Effect.gen(function* () {
        if (longtext.length === 0) {
            console.log(chalk.red("No command provided"));
            process.exit(1);
        }

        const copilot = yield* Copilot;
        const provider = createCopilotProvider(copilot);

        const result = yield* Effect.promise(() =>
            generateObject({
                model: provider.chat("gpt-4o"),
                schema: jsonSchema(JSONSchema.make(outputSchema)),
                schemaName: "command",
                prompt: longtext.join(" "),
                system: `You are a CLI command generator. Your task is to generate shell commands that accomplish what the user requests in plain English.

For each command you generate:
1. Provide the command itself
2. Include a clear explanation that covers:
   - What the command does
   - All flags and options used and their purposes
   - Any important details about the command's behavior

Format explanations like:
command-name : brief description

flag1    description of what this flag does
flag2    description of what this flag does

Make sure to use newlines to separate the command and the explanation, as well as every flag and option.

Be concise but thorough in your explanations.`,
            })
        );
        const parsed = yield* Schema.decodeUnknown(outputSchema)(result.object);

        console.log(chalk.blue(parsed.command));
        console.log(parsed.explanation);

        const selectInput = yield* SelectInput;

        const items: { label: string; value: Action }[] = [
            { label: "Execute", value: "execute" },
            { label: "Copy", value: "copy" },
            { label: "Cancel", value: "cancel" },
        ];

        const action = yield* selectInput.select(items);

        switch (action) {
            case "execute": {
                console.log(chalk.green("Executing command..."));
                const proc = Bun.spawnSync(["sh", "-c", parsed.command], {
                    stdin: "inherit",
                    stdout: "inherit",
                    stderr: "inherit",
                });
                process.exit(proc.exitCode ?? 0);
            }
            case "copy": {
                console.log(chalk.green("Copying command to clipboard..."));
                const proc = Bun.spawnSync(["pbcopy"], {
                    stdin: new Blob([parsed.command]),
                });
                process.exit(proc.exitCode ?? 0);
            }
            case "cancel": {
                console.log(chalk.red("Cancelling..."));
                process.exit(0);
            }
        }
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
