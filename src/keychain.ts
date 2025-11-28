import {
    Effect,
    Console,
    Schema,
    JSONSchema,
    Config,
    Option,
    Context,
    pipe,
    Stream,
    String,
} from "effect";
import { Command } from "@effect/platform";
import { KEYCHAIN_SERVICE_NAME } from "./constants";
import type { Process } from "@effect/platform/CommandExecutor";

// We use the macOS keychain as a KV Store.
// Service -s is static
// Account -a is the key we are writing to
export class Keychain extends Effect.Service<Keychain>()("ais/Keychain", {
    dependencies: [],
    effect: Effect.gen(function* () {
        const deleteKey = Effect.fn("deleteKey")(function* (key: string) {
            // Check if key exists, if not, do nothing
            const exists = yield* keyExists(key);
            if (!exists) {
                yield* Console.debug(
                    `Key "${key}" does not exist, skipping deletion`
                );
                return;
            }
            const command = Command.make(
                "security",
                "delete-generic-password",
                "-s",
                KEYCHAIN_SERVICE_NAME,
                "-a",
                key
            );
            const [exitCode, stdout, stderr] = yield* exitStdOutErr(command);
            if (exitCode !== 0) {
                return yield* Effect.die(
                    new Error(
                        `Failed to delete key "${key}" with error: ${stderr}`
                    )
                );
            }
            yield* Console.debug(`Deleted key "${key}"`);
        });
        const keyExists = Effect.fn("existsKey")(function* (key: string) {
            const command = Command.make(
                "security",
                "find-generic-password",
                "-s",
                KEYCHAIN_SERVICE_NAME,
                "-a",
                key
            );
            const exitCode = yield* Command.exitCode(command);
            return exitCode === 0;
        });
        return {
            write: Effect.fn("write")(function* (key: string, value: string) {
                // Overwrite key, therefore delete before we write
                const exists = yield* keyExists(key);
                if (exists) {
                    yield* deleteKey(key);
                }
                const command = Command.make(
                    "security",
                    "add-generic-password",
                    "-s",
                    KEYCHAIN_SERVICE_NAME,
                    "-a",
                    key,
                    "-w",
                    value
                );
                const [exitCode, stdout, stderr] = yield* exitStdOutErr(
                    command
                );
                if (exitCode !== 0) {
                    return yield* Effect.die(
                        new Error(
                            `Failed to write to key "${key}" with error: ${stderr}`
                        )
                    );
                }
            }),
            read: Effect.fn("read")(function* (key: string) {
                const command = Command.make(
                    "security",
                    "find-generic-password",
                    "-s",
                    KEYCHAIN_SERVICE_NAME,
                    "-a",
                    key,
                    "-w"
                );
                const [exitCode, stdout, stderr] = yield* exitStdOutErr(
                    command
                );
                if (exitCode !== 0) {
                    return yield* Effect.die(
                        new Error(
                            `Failed to read key "${key}" with error: ${stderr}`
                        )
                    );
                }
                return stdout;
            }),
            delete: deleteKey,
        };
    }),
}) {}

const exitStdOutErr = <E, R>(command: Command.Command) =>
    pipe(
        Command.start(command),
        Effect.flatMap((process) =>
            Effect.all(
                [
                    process.exitCode,
                    runString(process.stdout),
                    runString(process.stderr),
                ],
                { concurrency: 3 }
            )
        ),
        Effect.scoped
    );

// Helper function to collect stream output as a string
const runString = <E, R>(
    stream: Stream.Stream<Uint8Array, E, R>
): Effect.Effect<string, E, R> =>
    stream.pipe(
        Stream.decodeText(),
        Stream.runFold(String.empty, String.concat)
    );
