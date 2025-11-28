import { Effect, Console, Layer, Schema, pipe, Stream } from "effect";
import { Keychain } from "./src/keychain";
import { BunContext, BunRuntime } from "@effect/platform-bun";

// Constants
const CLIENT_ID = "Iv1.b507a08c87ecfe98";
const HEADERS = {
    "User-Agent": "GitHubCopilotChat/0.32.4",
    "Editor-Version": "vscode/1.105.1",
    "Editor-Plugin-Version": "copilot-chat/0.32.4",
    "Copilot-Integration-Id": "vscode-chat",
};

const DEVICE_CODE_URL = "https://github.com/login/device/code";
const ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";
const COPILOT_TOKEN_URL = "https://api.github.com/copilot_internal/v2/token";
const COPILOT_API_URL = "https://api.githubcopilot.com";

// Keychain keys
const KEYCHAIN_REFRESH_TOKEN = "copilot-refresh-token";
const KEYCHAIN_ACCESS_TOKEN = "copilot-access-token";
const KEYCHAIN_ACCESS_EXPIRES = "copilot-access-expires";

// Schemas
const DeviceCodeResponse = Schema.Struct({
    device_code: Schema.String,
    user_code: Schema.String,
    verification_uri: Schema.String,
    expires_in: Schema.Number,
    interval: Schema.Number,
});

const AccessTokenResponse = Schema.Struct({
    access_token: Schema.String,
    token_type: Schema.String,
    scope: Schema.String,
});

const AccessTokenPending = Schema.Struct({
    error: Schema.Literal("authorization_pending"),
});

const AccessTokenError = Schema.Struct({
    error: Schema.String,
});

const CopilotTokenResponse = Schema.Struct({
    token: Schema.String,
    expires_at: Schema.Number,
});

const ChatMessage = Schema.Struct({
    role: Schema.Union(
        Schema.Literal("system"),
        Schema.Literal("user"),
        Schema.Literal("assistant")
    ),
    content: Schema.String,
});

const ChatCompletionChoice = Schema.Struct({
    index: Schema.Number,
    message: ChatMessage,
    finish_reason: Schema.NullOr(Schema.String),
});

const ChatCompletionResponse = Schema.Struct({
    id: Schema.String,
    choices: Schema.Array(ChatCompletionChoice),
});

// Effect-based Copilot Service
class CopilotError extends Schema.TaggedError<CopilotError>()("CopilotError", {
    message: Schema.String,
}) {}

export class Copilot extends Effect.Service<Copilot>()("ais/Copilot", {
    dependencies: [Keychain.Default],
    effect: Effect.gen(function* () {
        const keychain = yield* Keychain;

        // Get device code for OAuth
        const getDeviceCode = Effect.gen(function* () {
            const response = yield* Effect.tryPromise({
                try: () =>
                    fetch(DEVICE_CODE_URL, {
                        method: "POST",
                        headers: {
                            Accept: "application/json",
                            "Content-Type": "application/json",
                            "User-Agent": "GitHubCopilotChat/0.35.0",
                        },
                        body: JSON.stringify({
                            client_id: CLIENT_ID,
                            scope: "read:user",
                        }),
                    }),
                catch: (e) =>
                    new CopilotError({
                        message: `Failed to fetch device code: ${e}`,
                    }),
            });

            if (!response.ok) {
                return yield* new CopilotError({
                    message: `Device code request failed: ${response.status}`,
                });
            }

            const json = yield* Effect.tryPromise({
                try: () => response.json(),
                catch: () =>
                    new CopilotError({
                        message: "Failed to parse device code response",
                    }),
            });

            return yield* Schema.decodeUnknown(DeviceCodeResponse)(json).pipe(
                Effect.mapError(
                    () =>
                        new CopilotError({
                            message: "Invalid device code response schema",
                        })
                )
            );
        });

        // Poll for access token
        const pollAccessToken = (deviceCode: string, interval: number) =>
            Effect.gen(function* () {
                while (true) {
                    yield* Effect.sleep(`${interval} seconds`);

                    const response = yield* Effect.tryPromise({
                        try: () =>
                            fetch(ACCESS_TOKEN_URL, {
                                method: "POST",
                                headers: {
                                    Accept: "application/json",
                                    "Content-Type": "application/json",
                                    "User-Agent": "GitHubCopilotChat/0.35.0",
                                },
                                body: JSON.stringify({
                                    client_id: CLIENT_ID,
                                    device_code: deviceCode,
                                    grant_type:
                                        "urn:ietf:params:oauth:grant-type:device_code",
                                }),
                            }),
                        catch: (e) =>
                            new CopilotError({
                                message: `Failed to poll access token: ${e}`,
                            }),
                    });

                    if (!response.ok) {
                        return yield* new CopilotError({
                            message: `Access token request failed: ${response.status}`,
                        });
                    }

                    const json = yield* Effect.tryPromise({
                        try: () => response.json(),
                        catch: () =>
                            new CopilotError({
                                message:
                                    "Failed to parse access token response",
                            }),
                    });

                    // Check if we got the token
                    const tokenResult =
                        Schema.decodeUnknownOption(AccessTokenResponse)(json);
                    if (tokenResult._tag === "Some") {
                        return tokenResult.value;
                    }

                    // Check if still pending
                    const pendingResult =
                        Schema.decodeUnknownOption(AccessTokenPending)(json);
                    if (pendingResult._tag === "Some") {
                        yield* Console.debug(
                            "Authorization pending, waiting..."
                        );
                        continue;
                    }

                    // Check for error
                    const errorResult =
                        Schema.decodeUnknownOption(AccessTokenError)(json);
                    if (errorResult._tag === "Some") {
                        return yield* new CopilotError({
                            message: `OAuth error: ${errorResult.value.error}`,
                        });
                    }

                    yield* Console.debug("Unknown response, continuing...");
                }
            });

        // Authenticate - full device code flow
        const authenticate = Effect.gen(function* () {
            yield* Console.log("Starting GitHub Copilot authentication...");

            const deviceCode = yield* getDeviceCode;

            yield* Console.log(`\n🔐 Open: ${deviceCode.verification_uri}`);
            yield* Console.log(`📋 Enter code: ${deviceCode.user_code}\n`);
            yield* Console.log("Waiting for authorization...");

            const accessToken = yield* pollAccessToken(
                deviceCode.device_code,
                deviceCode.interval
            );

            // Store refresh token in keychain
            yield* keychain.write(
                KEYCHAIN_REFRESH_TOKEN,
                accessToken.access_token
            );
            yield* Console.log("✅ Authentication successful! Token stored.");

            return accessToken.access_token;
        });

        // Get Copilot API token (exchanges GitHub OAuth token for Copilot token)
        const getCopilotToken = Effect.gen(function* () {
            // Check if we have a valid cached token
            const cachedToken = yield* keychain
                .read(KEYCHAIN_ACCESS_TOKEN)
                .pipe(Effect.option);

            const cachedExpires = yield* keychain
                .read(KEYCHAIN_ACCESS_EXPIRES)
                .pipe(Effect.option);

            if (cachedToken._tag === "Some" && cachedExpires._tag === "Some") {
                const expiresAt = parseInt(cachedExpires.value, 10);
                if (expiresAt > Date.now()) {
                    yield* Console.debug("Using cached Copilot token");
                    return cachedToken.value;
                }
            }

            // Get refresh token from keychain
            const refreshToken = yield* keychain
                .read(KEYCHAIN_REFRESH_TOKEN)
                .pipe(
                    Effect.catchAll(
                        () =>
                            new CopilotError({
                                message:
                                    "No refresh token found. Run authenticate() first.",
                            })
                    )
                );

            yield* Console.debug("Fetching new Copilot API token...");

            const response = yield* Effect.tryPromise({
                try: () =>
                    fetch(COPILOT_TOKEN_URL, {
                        headers: {
                            Accept: "application/json",
                            Authorization: `Bearer ${refreshToken}`,
                            ...HEADERS,
                        },
                    }),
                catch: (e) =>
                    new CopilotError({
                        message: `Failed to fetch Copilot token: ${e}`,
                    }),
            });

            if (!response.ok) {
                const text = yield* Effect.tryPromise(() => response.text());
                return yield* new CopilotError({
                    message: `Copilot token request failed: ${response.status} - ${text}`,
                });
            }

            const json = yield* Effect.tryPromise({
                try: () => response.json(),
                catch: () =>
                    new CopilotError({
                        message: "Failed to parse Copilot token response",
                    }),
            });

            const tokenData = yield* Schema.decodeUnknown(CopilotTokenResponse)(
                json
            ).pipe(
                Effect.mapError(
                    () =>
                        new CopilotError({
                            message: "Invalid Copilot token response schema",
                        })
                )
            );

            // Cache the token
            yield* keychain.write(KEYCHAIN_ACCESS_TOKEN, tokenData.token);
            yield* keychain.write(
                KEYCHAIN_ACCESS_EXPIRES,
                String(tokenData.expires_at * 1000)
            );

            return tokenData.token;
        });

        // Chat completion
        const chat = (
            messages: Array<{
                role: "system" | "user" | "assistant";
                content: string;
            }>,
            model = "gpt-4o"
        ) =>
            Effect.gen(function* () {
                const token = yield* getCopilotToken;

                const response = yield* Effect.tryPromise({
                    try: () =>
                        fetch(`${COPILOT_API_URL}/chat/completions`, {
                            method: "POST",
                            headers: {
                                "Content-Type": "application/json",
                                Authorization: `Bearer ${token}`,
                                ...HEADERS,
                                "Openai-Intent": "conversation-edits",
                                "X-Initiator": "user",
                            },
                            body: JSON.stringify({
                                model,
                                messages,
                                stream: false,
                            }),
                        }),
                    catch: (e) =>
                        new CopilotError({
                            message: `Failed to send chat request: ${e}`,
                        }),
                });

                if (!response.ok) {
                    const text = yield* Effect.tryPromise(() =>
                        response.text()
                    );
                    return yield* new CopilotError({
                        message: `Chat request failed: ${response.status} - ${text}`,
                    });
                }

                const json = yield* Effect.tryPromise({
                    try: () => response.json(),
                    catch: () =>
                        new CopilotError({
                            message: "Failed to parse chat response",
                        }),
                });

                const completion = yield* Schema.decodeUnknown(
                    ChatCompletionResponse
                )(json).pipe(
                    Effect.mapError(
                        () =>
                            new CopilotError({
                                message: `Invalid chat response schema: ${JSON.stringify(
                                    json
                                )}`,
                            })
                    )
                );

                return completion;
            });

        // Simple prompt helper
        const prompt = (userPrompt: string, model = "gpt-4o") =>
            Effect.gen(function* () {
                const response = yield* chat(
                    [{ role: "user", content: userPrompt }],
                    model
                );
                return response.choices[0]?.message.content ?? "";
            });

        return {
            authenticate,
            getCopilotToken,
            chat,
            prompt,
        };
    }),
}) {}

// ===================
// Test Script
// ===================

const program = Effect.gen(function* () {
    const copilot = yield* Copilot;

    // Check if already authenticated by trying to get token
    const hasToken = yield* copilot.getCopilotToken.pipe(
        Effect.map(() => true),
        Effect.catchAll(() => Effect.succeed(false))
    );

    if (!hasToken) {
        yield* Console.log("No valid token found. Starting authentication...");
        yield* copilot.authenticate;
    } else {
        yield* Console.log("✅ Already authenticated!");
    }

    // Test prompt
    yield* Console.log("\n📤 Sending test prompt...\n");
    const response = yield* copilot.prompt("What is 2 + 2? Reply in one word.");

    yield* Console.log(`📥 Response: ${response}`);
}).pipe(
    Effect.provide(
        Layer.mergeAll(Copilot.Default, Keychain.Default, BunContext.layer)
    )
);

BunRuntime.runMain(program);
