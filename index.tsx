import { Effect, Schema, Layer, Logger, LogLevel } from "effect";
import { BunContext, BunRuntime } from "@effect/platform-bun";
import { Command, Args, Span } from "@effect/cli";
import { Copilot } from "./src/copilot";
import { SelectInput } from "./src/selectInput";

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
        const copilot = yield* Copilot;
        const result = yield* copilot.structuredOutput(
            outputSchema,
            longtext.join(" ")
        );

        console.log(result.command);
        console.log(result.explanation);

        const selectInput = yield* SelectInput;

        const items: { label: string; value: Action }[] = [
            { label: "Execute", value: "execute" },
            { label: "Copy", value: "copy" },
            { label: "Cancel", value: "cancel" },
        ];

        const action = yield* selectInput.select(items);

        switch (action) {
            case "execute": {
                const proc = Bun.spawnSync(["sh", "-c", result.command], {
                    stdin: "inherit",
                    stdout: "inherit",
                    stderr: "inherit",
                });
                process.exit(proc.exitCode ?? 0);
            }
            case "copy": {
                const proc = Bun.spawnSync(["pbcopy"], {
                    stdin: new Blob([result.command]),
                });
                console.log("Copied to clipboard");
                process.exit(proc.exitCode ?? 0);
            }
            case "cancel": {
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
