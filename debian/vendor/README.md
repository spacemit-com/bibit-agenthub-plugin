# debian/vendor

Place the company-signed plugin bundle here before building the Debian package:

    cp artifacts/agent-hub-0.2.3.bibit-plugin.tgz \
       debian/vendor/agent-hub.bibit-plugin.tgz

The file must be named exactly `agent-hub.bibit-plugin.tgz`. It is produced by
the company signing service, so it is a build artifact and is not committed to
git (see `.gitignore`). `debian/rules` installs it to
`/usr/lib/bibit/plugins/agent-hub.bibit-plugin.tgz`.
