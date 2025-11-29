import {
    Effect,
    Console,
    Layer,
    Schema,
    JSONSchema,
    Option,
    Either,
    Data,
    Schedule,
} from "effect";
import {
    HttpClient,
    HttpClientResponse,
    HttpBody,
    FetchHttpClient,
} from "@effect/platform";
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

// MacOS Keychain keys
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

class AuthorizationPendingError extends Data.TaggedError(
    "AuthorizationPendingError"
)<{}> {}

class UnknownResponseError extends Data.TaggedError("UnknownResponseError")<{
    response?: unknown;
}> {}

class OAuthError extends Data.TaggedError("OAuthError")<{
    error: string;
}> {}

export class Copilot extends Effect.Service<Copilot>()("ais/Copilot", {
    dependencies: [Keychain.Default, FetchHttpClient.layer],
    effect: Effect.gen(function* () {
        const keychain = yield* Keychain;
        const httpClient = yield* HttpClient.HttpClient;

        // Create client that filters non-2xx responses
        const httpClientOk = httpClient.pipe(HttpClient.filterStatusOk);

        // Get device code for OAuth
        const getDeviceCode = Effect.gen(function* () {
            const response = yield* httpClientOk
                .post(DEVICE_CODE_URL, {
                    headers: {
                        Accept: "application/json",
                        "Content-Type": "application/json",
                        "User-Agent": "GitHubCopilotChat/0.35.0",
                    },
                    body: HttpBody.unsafeJson({
                        client_id: CLIENT_ID,
                        scope: "read:user",
                    }),
                })
                .pipe(
                    Effect.flatMap(
                        HttpClientResponse.schemaBodyJson(DeviceCodeResponse)
                    ),
                    Effect.scoped,
                    Effect.mapError(
                        (e) =>
                            new CopilotError({
                                message: `Failed to get device code: ${e}`,
                            })
                    )
                );

            return response;
        });

        // Poll for access token
        const pollAccessToken = (deviceCode: string, interval: number) =>
            Effect.gen(function* () {
                const pollToken = Effect.fn("pollToken")(function* () {
                    const response = yield* httpClient
                        .post(ACCESS_TOKEN_URL, {
                            headers: {
                                Accept: "application/json",
                                "Content-Type": "application/json",
                                "User-Agent": "GitHubCopilotChat/0.35.0",
                            },
                            body: HttpBody.unsafeJson({
                                client_id: CLIENT_ID,
                                device_code: deviceCode,
                                grant_type:
                                    "urn:ietf:params:oauth:grant-type:device_code",
                            }),
                        })
                        .pipe(
                            Effect.flatMap((res) => res.json),
                            Effect.scoped,
                            Effect.mapError(
                                (e) =>
                                    new CopilotError({
                                        message: `Failed to poll access token: ${e}`,
                                    })
                            )
                        );

                    // Check if we got the token
                    const tokenResult =
                        Schema.decodeUnknownOption(AccessTokenResponse)(
                            response
                        );
                    if (Option.isSome(tokenResult)) {
                        return tokenResult.value;
                    }

                    // Check if still pending
                    const pendingResult =
                        Schema.decodeUnknownOption(AccessTokenPending)(
                            response
                        );
                    if (Option.isSome(pendingResult)) {
                        yield* Console.debug(
                            "Authorization pending, waiting..."
                        );
                        return yield* new AuthorizationPendingError();
                    }

                    // Check for error
                    const errorResult =
                        Schema.decodeUnknownOption(AccessTokenError)(response);
                    if (Option.isSome(errorResult)) {
                        return yield* new OAuthError({
                            error: errorResult.value.error,
                        });
                    }

                    yield* Console.debug(
                        `Got unknown response from GitHub copilot oauth: ${response}`
                    );
                    return yield* new UnknownResponseError({
                        response,
                    });
                });

                const policy = Schedule.addDelay(
                    Schedule.recurs(60),
                    () => `${interval} seconds`
                );

                return yield* Effect.retry(pollToken(), {
                    schedule: policy,
                    until: (e) => {
                        return (
                            e instanceof UnknownResponseError ||
                            e instanceof OAuthError
                        );
                    },
                });
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
        // Automatically triggers authentication if no refresh token exists
        const getCopilotToken = Effect.gen(function* () {
            // Check if we have a valid cached token
            const cachedToken = yield* keychain
                .read(KEYCHAIN_ACCESS_TOKEN)
                .pipe(Effect.option);

            const cachedExpires = yield* keychain
                .read(KEYCHAIN_ACCESS_EXPIRES)
                .pipe(Effect.option);

            if (Option.isSome(cachedToken) && Option.isSome(cachedExpires)) {
                const expiresAt = parseInt(cachedExpires.value, 10);
                if (expiresAt > Date.now()) {
                    yield* Console.debug("Using cached Copilot token");
                    return cachedToken.value;
                }
            }

            // Get refresh token from keychain, authenticate if not found
            const refreshToken = yield* keychain
                .read(KEYCHAIN_REFRESH_TOKEN)
                .pipe(Effect.catchAll(() => authenticate));

            yield* Console.debug("Fetching new Copilot API token...");

            const tokenData = yield* httpClientOk
                .get(COPILOT_TOKEN_URL, {
                    headers: {
                        Accept: "application/json",
                        Authorization: `Bearer ${refreshToken}`,
                        ...HEADERS,
                    },
                })
                .pipe(
                    Effect.flatMap(
                        HttpClientResponse.schemaBodyJson(CopilotTokenResponse)
                    ),
                    Effect.scoped,
                    Effect.mapError(
                        (e) =>
                            new CopilotError({
                                message: `Failed to get Copilot token: ${e}`,
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

                const completion = yield* httpClientOk
                    .post(`${COPILOT_API_URL}/chat/completions`, {
                        headers: {
                            "Content-Type": "application/json",
                            Authorization: `Bearer ${token}`,
                            ...HEADERS,
                            "Openai-Intent": "conversation-edits",
                            "X-Initiator": "user",
                        },
                        body: HttpBody.unsafeJson({
                            model,
                            messages,
                            stream: false,
                        }),
                    })
                    .pipe(
                        Effect.flatMap(
                            HttpClientResponse.schemaBodyJson(
                                ChatCompletionResponse
                            )
                        ),
                        Effect.scoped,
                        Effect.mapError(
                            (e) =>
                                new CopilotError({
                                    message: `Chat request failed: ${e}`,
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

        // Structured output using Effect Schema -> JSONSchema
        const structuredOutput = <A, I, R>(
            schema: Schema.Schema<A, I, R>,
            userPrompt: string,
            options?: { model?: string; schemaName?: string }
        ) =>
            Effect.gen(function* () {
                const token = yield* getCopilotToken;
                const model = options?.model ?? "gpt-4o";
                const schemaName = options?.schemaName ?? "response";

                // Convert Effect Schema to JSON Schema
                const jsonSchema = JSONSchema.make(schema);

                const completion = yield* httpClientOk
                    .post(`${COPILOT_API_URL}/chat/completions`, {
                        headers: {
                            "Content-Type": "application/json",
                            Authorization: `Bearer ${token}`,
                            ...HEADERS,
                            "Openai-Intent": "conversation-edits",
                            "X-Initiator": "user",
                        },
                        body: HttpBody.unsafeJson({
                            model,
                            messages: [{ role: "user", content: userPrompt }],
                            response_format: {
                                type: "json_schema",
                                json_schema: {
                                    name: schemaName,
                                    strict: true,
                                    schema: jsonSchema,
                                },
                            },
                        }),
                    })
                    .pipe(
                        Effect.flatMap(
                            HttpClientResponse.schemaBodyJson(
                                ChatCompletionResponse
                            )
                        ),
                        Effect.scoped,
                        Effect.mapError(
                            (e) =>
                                new CopilotError({
                                    message: `Structured output request failed: ${e}`,
                                })
                        )
                    );

                const content = completion.choices[0]?.message.content ?? "{}";

                // Parse JSON and validate against schema
                const parsed = yield* Effect.try({
                    try: () => JSON.parse(content),
                    catch: () =>
                        new CopilotError({
                            message: `Failed to parse JSON response: ${content}`,
                        }),
                });

                const validated = yield* Schema.decodeUnknown(schema)(
                    parsed
                ).pipe(
                    Effect.mapError(
                        (e) =>
                            new CopilotError({
                                message: `Response validation failed: ${e}`,
                            })
                    )
                );

                return validated;
            });

        return {
            chat,
            prompt,
            structuredOutput,
        };
    }),
}) {}

// ===================
// Test Script
// ===================

// Example schema for structured output
const MathResult = Schema.Struct({
    answer: Schema.Number.annotations({ description: "The numeric answer" }),
    explanation: Schema.String.annotations({
        description: "Step by step explanation",
    }),
});

const program = Effect.gen(function* () {
    const copilot = yield* Copilot;

    // Test simple prompt (auth handled transparently)
    yield* Console.log("📤 Sending test prompt...\n");
    const response = yield* copilot.prompt("What is 2 + 2? Reply in one word.");
    yield* Console.log(`📥 Response: ${response}`);

    // Test structured output
    yield* Console.log("\n📤 Sending structured output request...\n");
    const result = yield* copilot.structuredOutput(
        MathResult,
        "What is 15 * 7?",
        { schemaName: "math_result" }
    );

    yield* Console.log(`📥 Structured Response:`);
    yield* Console.log(result);
});

BunRuntime.runMain(
    program.pipe(
        Effect.provide(
            Layer.mergeAll(Copilot.Default, Keychain.Default, BunContext.layer)
        )
    )
);
