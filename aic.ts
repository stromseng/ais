import { Effect, Schema, Layer, Logger, LogLevel, Console } from "effect";
import { BunContext, BunRuntime } from "@effect/platform-bun";
import { Command, Span } from "@effect/cli";
import { SelectInput } from "./src/selectInput";
import { TextInput } from "./src/textInput";
import chalk from "chalk";
import boxen from "boxen";
import { AI, make as makeAI } from "./src/ai";
import { CopilotAuth } from "./src/copilotAuth";

const outputSchema = Schema.Struct({
    message: Schema.String.annotations({
        description: "The commit message with subject line and optional body.",
    }),
});

type Action = "commit" | "edit" | "copy" | "cancel";

const systemPrompt = `You are a git commit message generator following the Conventional Commits specification.

## Format
\`<type>[optional scope]: <description>\`

- Use present tense, imperative mood ("add" not "added")
- Keep description under 50 characters
- Add body if needed (wrap at 72 characters)

## Commit types
- \`feat\`: new feature
- \`fix\`: bug fix
- \`docs\`: documentation changes
- \`style\`: formatting, missing semicolons, etc.
- \`refactor\`: code change that neither fixes bug nor adds feature
- \`test\`: adding or updating tests
- \`chore\`: maintenance tasks, dependency updates

Keep messages short and meaningful. Only include body if the change needs explanation.`;

const getUntrackedDiff = () => {
    const untracked = Bun.spawnSync([
        "git",
        "ls-files",
        "--others",
        "--exclude-standard",
    ]);
    const files = untracked.stdout
        .toString()
        .trim()
        .split("\n")
        .filter(Boolean);

    let diff = "";
    for (const file of files) {
        const content = Bun.spawnSync([
            "git",
            "diff",
            "--no-index",
            "/dev/null",
            file,
        ]);
        // git diff --no-index returns exit code 1 when there are differences
        diff += content.stdout.toString();
    }
    return diff;
};

const getGitInfo = () =>
    Effect.gen(function* () {
        // Get git status with colors
        const status = Bun.spawnSync([
            "git",
            "-c",
            "color.status=always",
            "status",
            "--short",
        ]);
        const statusText = status.stdout.toString();

        // Check for staged changes
        const staged = Bun.spawnSync(["git", "diff", "--cached"]);
        const stagedText = staged.stdout.toString();

        if (stagedText.trim()) {
            return { diff: stagedText, status: statusText, hasStaged: true };
        }

        // Use unstaged diff + untracked files if nothing staged
        const unstaged = Bun.spawnSync(["git", "diff"]);
        const unstagedText = unstaged.stdout.toString();
        const untrackedDiff = getUntrackedDiff();

        return {
            diff: unstagedText + untrackedDiff,
            status: statusText,
            hasStaged: false,
        };
    });

const command = Command.make("aic", {}, () => {
    return Effect.gen(function* () {
        const ai = yield* AI;
        const selectInput = yield* SelectInput;
        const textInput = yield* TextInput;

        const { diff, status, hasStaged } = yield* getGitInfo();

        if (!diff.trim()) {
            yield* Console.log(chalk.yellow("No changes to commit."));
            process.exit(0);
        }

        yield* Console.log(chalk.dim("Changes:"));
        yield* Console.log(status);

        if (!hasStaged) {
            yield* Console.log(
                chalk.yellow(
                    "No staged changes. Will stage all files on commit."
                )
            );
        }

        yield* Console.log(chalk.dim("Generating commit message..."));

        const parsed = yield* ai.generateObject(
            `Generate a commit message for these changes:

## Git Status
${status}

## Diff
${diff}`,
            outputSchema,
            {
                system: systemPrompt,
                schemaName: "commit_message",
            }
        );

        yield* Console.log(
            chalk.green(boxen(parsed.message, { title: "Commit Message" }))
        );

        yield* Console.log("");
        yield* Console.log("Choose an action:");

        const items: { label: string; value: Action }[] = [
            { label: "Commit", value: "commit" },
            { label: "Edit and commit", value: "edit" },
            { label: "Copy", value: "copy" },
            { label: "Cancel", value: "cancel" },
        ];

        const action = yield* selectInput.select(items);

        switch (action) {
            case "commit": {
                if (!hasStaged) {
                    yield* Console.log(chalk.dim("Staging all files..."));
                    Bun.spawnSync(["git", "add", "-A"]);
                }
                yield* Console.log(chalk.green("Committing..."));
                const proc = Bun.spawnSync(
                    ["git", "commit", "-m", parsed.message],
                    {
                        stdin: "inherit",
                        stdout: "inherit",
                        stderr: "inherit",
                    }
                );
                process.exit(proc.exitCode ?? 0);
            }
            case "edit": {
                const edited = yield* textInput.input({
                    message: "Edit commit message:",
                    default: parsed.message,
                    prefill: "editable",
                });
                if (!hasStaged) {
                    yield* Console.log(chalk.dim("Staging all files..."));
                    Bun.spawnSync(["git", "add", "-A"]);
                }
                yield* Console.log(chalk.green("Committing..."));
                const proc = Bun.spawnSync(["git", "commit", "-m", edited], {
                    stdin: "inherit",
                    stdout: "inherit",
                    stderr: "inherit",
                });
                process.exit(proc.exitCode ?? 0);
            }
            case "copy": {
                yield* Console.log(
                    chalk.green("Copying commit message to clipboard...")
                );
                const proc = Bun.spawnSync(["pbcopy"], {
                    stdin: new Blob([parsed.message]),
                });
                process.exit(proc.exitCode ?? 0);
            }
            case "cancel": {
                yield* Console.log(chalk.red("Cancelled."));
                process.exit(0);
            }
        }
    });
});

// Set up the CLI application
const cli = Command.run(command, {
    name: "AI Commit CLI",
    version: "0.0.1",
    summary: Span.text("Generate commit messages using AI."),
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
