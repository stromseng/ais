import { Effect, Schema, Layer, Logger, LogLevel, Console } from "effect";
import { BunContext, BunRuntime } from "@effect/platform-bun";
import { Command, Args, Span } from "@effect/cli";
import { SelectInput } from "./src/selectInput";
import { TextInput } from "./src/textInput";
import chalk from "chalk";
import boxen from "boxen";
import { AI, make as makeAI } from "./src/ai";
import { CopilotAuth } from "./src/copilotAuth";

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

type Action = "execute" | "edit" | "copy" | "cancel";

const systemPrompt = `You are a CLI command generator. Your task is to generate shell commands that accomplish what the user requests in plain English.

For each command you generate:
1. Provide the command itself
2. Include a clear explanation that covers:
   - What the command does
   - All flags and options used and their purposes
   - Any important details about the command's behavior

Format explanations like:
command-name : brief description

flag1    brief description of what this flag does
flag2    brief description of what this flag does

Make sure to use newlines to separate the command and the explanation, as well as every flag and option.
For complex multi-step pipelines, make sure to include a backslash \\ and newlines to separate the commands.

Be concise but thorough in your explanations.`;

const command = Command.make("ais", { longtext }, ({ longtext }) => {
    return Effect.gen(function* () {
        const ai = yield* AI;

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

        const parsed = yield* ai.generateObject(prompt, outputSchema, {
            system: systemPrompt,
            schemaName: "command",
        });

        yield* Console.log(
            chalk.blue(boxen(parsed.command, { title: "Command" }))
        );
        yield* Console.log(boxen(parsed.explanation, { title: "Explanation" }));

        yield* Console.log("");
        yield* Console.log("Choose an action:");

        const selectInput = yield* SelectInput;
        const textInput = yield* TextInput;

        const items: { label: string; value: Action }[] = [
            { label: "Execute", value: "execute" },
            { label: "Edit and execute ", value: "edit" },
            { label: "Copy", value: "copy" },
            { label: "Cancel", value: "cancel" },
        ];

        const action = yield* selectInput.select(items);

        switch (action) {
            case "execute": {
                yield* Console.log(chalk.green("Executing command..."));
                const proc = Bun.spawnSync(["sh", "-c", parsed.command], {
                    stdin: "inherit",
                    stdout: "inherit",
                    stderr: "inherit",
                });
                process.exit(proc.exitCode ?? 0);
            }
            case "edit": {
                const edited = yield* textInput.input({
                    message: "Edit command:",
                    default: parsed.command,
                    prefill: "editable",
                });
                yield* Console.log(chalk.green("Executing edited command..."));
                const proc = Bun.spawnSync(["sh", "-c", edited], {
                    stdin: "inherit",
                    stdout: "inherit",
                    stderr: "inherit",
                });
                process.exit(proc.exitCode ?? 0);
            }
            case "copy": {
                yield* Console.log(
                    chalk.green("Copying command to clipboard...")
                );
                const proc = Bun.spawnSync(["pbcopy"], {
                    stdin: new Blob([parsed.command]),
                });
                process.exit(proc.exitCode ?? 0);
            }
            case "cancel": {
                yield* Console.log(chalk.red("Cancelling..."));
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

// AI layer with specific model
const AILayer = makeAI("gpt51Codex").pipe(Layer.provide(CopilotAuth.Default));

// Prepare and run the CLI application
cli(process.argv).pipe(
    Effect.provide(
        Layer.mergeAll(
            AILayer,
            SelectInput.Default,
            TextInput.Default,
            BunContext.layer,
            Logger.pretty
        )
    ),
    Logger.withMinimumLogLevel(LogLevel.Info),
    BunRuntime.runMain
);
