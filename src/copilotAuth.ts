import {
    Effect,
    Console,
    Schema,
    JSONSchema,
    Option,
    Either,
    Data,
    Schedule,
    Logger,
} from "effect";
import {
    HttpClient,
    HttpClientResponse,
    HttpBody,
    FetchHttpClient,
} from "@effect/platform";
import { Keychain } from "./keychain";

// Constants
const CLIENT_ID = "Iv1.b507a08c87ecfe98";

export const COPILOT_HEADERS = {
    "User-Agent": "GitHubCopilotChat/0.32.4",
    "Editor-Version": "vscode/1.105.1",
    "Editor-Plugin-Version": "copilot-chat/0.32.4",
    "Copilot-Integration-Id": "vscode-chat",
};

const DEVICE_CODE_URL = "https://github.com/login/device/code";
const ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";
const COPILOT_TOKEN_URL = "https://api.github.com/copilot_internal/v2/token";
export const COPILOT_API_URL = "https://api.githubcopilot.com";

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

export class CopilotAuth extends Effect.Service<CopilotAuth>()(
    "ais/CopilotAuth",
    {
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
                            HttpClientResponse.schemaBodyJson(
                                DeviceCodeResponse
                            )
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
                            yield* Effect.logDebug(
                                "Authorization pending, waiting..."
                            );
                            return yield* new AuthorizationPendingError();
                        }

                        // Check for error
                        const errorResult =
                            Schema.decodeUnknownOption(AccessTokenError)(
                                response
                            );
                        if (Option.isSome(errorResult)) {
                            return yield* new OAuthError({
                                error: errorResult.value.error,
                            });
                        }

                        yield* Effect.logError(
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
                yield* Console.info(
                    "Starting GitHub Copilot authentication..."
                );

                const deviceCode = yield* getDeviceCode;

                yield* Console.info(
                    `\n🔐 Open: ${deviceCode.verification_uri}`
                );
                yield* Console.info(`📋 Enter code: ${deviceCode.user_code}\n`);
                yield* Console.info("Waiting for authorization...");

                const accessToken = yield* pollAccessToken(
                    deviceCode.device_code,
                    deviceCode.interval
                );

                // Store refresh token in keychain
                yield* keychain.write(
                    KEYCHAIN_REFRESH_TOKEN,
                    accessToken.access_token
                );
                yield* Console.info(
                    "✅ Authentication successful! Token stored."
                );

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

                if (
                    Option.isSome(cachedToken) &&
                    Option.isSome(cachedExpires)
                ) {
                    const expiresAt = parseInt(cachedExpires.value, 10);
                    if (expiresAt > Date.now()) {
                        yield* Effect.logDebug("Using cached Copilot token");
                        return cachedToken.value;
                    }
                }

                // Get refresh token from keychain, authenticate if not found
                const refreshToken = yield* keychain
                    .read(KEYCHAIN_REFRESH_TOKEN)
                    .pipe(Effect.catchAll(() => authenticate));

                yield* Effect.logDebug("Fetching new Copilot API token...");

                const tokenData = yield* httpClientOk
                    .get(COPILOT_TOKEN_URL, {
                        headers: {
                            Accept: "application/json",
                            Authorization: `Bearer ${refreshToken}`,
                            ...COPILOT_HEADERS,
                        },
                    })
                    .pipe(
                        Effect.flatMap(
                            HttpClientResponse.schemaBodyJson(
                                CopilotTokenResponse
                            )
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

            return {
                getToken: getCopilotToken,
            };
        }),
    }
) {}
