# debian/vendor

`agent-hub.bibit-plugin.tgz` is produced by `debian/rules` during packaging
and is not committed to git (see `.gitignore`).

`override_dh_auto_build` runs `npm ci` and `bibit-plugin build`, signing the
bundle with the private key at `AGENT_HUB_SIGNING_KEY` — a GitLab File
variable injected by CI, whose value is the key's file path. When that
variable is unset (local builds), the development key
`.bibit-keys/agent-hub-development-private.pem` is used instead. The produced
bundle is copied here and installed to
`/usr/lib/bibit/plugins/agent-hub.bibit-plugin.tgz`.
