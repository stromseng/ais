# AI Suggest (AIS)

Describe what you want in plain English, get a shell command back. Execute it, copy it, or bail.

```
$ ais find all png files larger than 1mb
find . -name "*.png" -size +1M
Finds PNG files recursively that exceed 1MB in size

> Execute
  Copy
  Cancel
```

### Tech Stack
Built with [Effect](https://effect.website/), [Bun](https://bun.sh/), [React](https://react.dev/) + [Ink](https://github.com/vadimdemedes/ink) for the CLI UI, and the [Vercel AI SDK](https://sdk.vercel.ai/).

### Copilot
See https://docs.github.com/en/copilot/concepts/billing/copilot-requests for model list and pricing

### TODO
- [ ] Allow stdin input the the promp
- [ ] Add Config service stored in users .config dir.
- [ ] Add optional `ai` command to simply prompt ai and get a response. Maybe add chat???
- [ ] Add `aic` for chatting?
- [ ] Check out using opencode via agent 2 agent protocol to get structured output or answers