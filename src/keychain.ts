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
    Layer,
} from "effect";
import { Command, CommandExecutor } from "@effect/platform";
import { BunContext } from "@effect/platform-bun";

export const KEYCHAIN_SERVICE_NAME = "@stromseng/ais";

export class KeychainError extends Schema.TaggedError<KeychainError>()(
    "KeychainError",
    {
        message: Schema.String,
        key: Schema.String,
    }
) {}

// We use the macOS keychain as a KV Store.
// Service -s is static
// Account -a is the key we are writing to
export class Keychain extends Effect.Service<Keychain>()("ais/Keychain", {
    dependencies: [BunContext.layer],
    effect: Effect.gen(function* () {
        const executor = yield* CommandExecutor.CommandExecutor;

        const provideExecutor = <A, E>(
            effect: Effect.Effect<A, E, CommandExecutor.CommandExecutor>
        ) =>
            Effect.provideService(
                effect,
                CommandExecutor.CommandExecutor,
                executor
            );

        const runCommand = (command: Command.Command) =>
            provideExecutor(runExitStdOutErr(command));

        const runExitCode = (command: Command.Command) =>
            provideExecutor(Command.exitCode(command));

        const checkKeyExists = Effect.fn("checkKeyExists")(function* (
            key: string
        ) {
            const command = Command.make(
                "security",
                "find-generic-password",
                "-s",
                KEYCHAIN_SERVICE_NAME,
                "-a",
                key
            );
            const exitCode = yield* runExitCode(command);
            return exitCode === 0;
        });

        const deleteKey = Effect.fn("deleteKeychainKey")(function* (
            key: string
        ) {
            const exists = yield* checkKeyExists(key);
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
            const [exitCode, _, stderr] = yield* runCommand(command);
            if (exitCode !== 0) {
                return yield* new KeychainError({
                    message: `Failed to delete: ${stderr}`,
                    key,
                });
            }
            yield* Console.debug(`Deleted key "${key}"`);
        });

        return {
            write: Effect.fn("writeKeychainKey")(function* (
                key: string,
                value: string
            ) {
                const exists = yield* checkKeyExists(key);
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
                const [exitCode, _, stderr] = yield* runCommand(command);
                if (exitCode !== 0) {
                    return yield* new KeychainError({
                        message: `Failed to write: ${stderr}`,
                        key,
                    });
                }
            }),

            read: Effect.fn("readKeychainKey")(function* (key: string) {
                const command = Command.make(
                    "security",
                    "find-generic-password",
                    "-s",
                    KEYCHAIN_SERVICE_NAME,
                    "-a",
                    key,
                    "-w"
                );
                const [exitCode, stdout, stderr] = yield* runCommand(command);
                if (exitCode !== 0) {
                    return yield* new KeychainError({
                        message: `Failed to read: ${stderr}`,
                        key,
                    });
                }
                return stdout;
            }),

            delete: deleteKey,
        };
    }),
}) {}

const runExitStdOutErr = (command: Command.Command) =>
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
