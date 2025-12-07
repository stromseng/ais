# AIS

Two AI CLI tools: `ais` (AI Suggest) and `aip` (AI Prompt).

> [!WARNING]
> This is for my own personal use and learning, currently limited to calling the GitHub Copilot API as I have a free education pack.


## `ais` - AI Suggest

Describe what you want in plain English, get a shell command back. Execute it, copy it, or bail.

```
$ ais find all png files larger than 1mb
find . -name "*.png" -size +1M
Finds PNG files recursively that exceed 1MB in size

> Execute
  Copy
  Cancel
```

## `aip` - AI Prompt

Simple AI text generation. Pass a prompt, get a response.

```
$ aip explain what a monad is in one sentence
$ echo "some text" | aip summarize this
```

## Tech Stack
Built with [Effect](https://effect.website/), [Bun](https://bun.sh/), and the [Vercel AI SDK](https://sdk.vercel.ai/).

### Copilot
See https://docs.github.com/en/copilot/concepts/billing/copilot-requests for model list and pricing

### TODO
- [ ] Add Config service stored in users .config dir.
- [ ] Add `aic` for chatting?
- [ ] Check out using opencode via agent 2 agent protocol to get structured output or answers