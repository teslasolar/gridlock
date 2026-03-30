// bridge.js — GitHub Issue chat bridge
// Polls a GitHub Issue for new comments and displays them in chat.
// Posts local chat messages as issue comments via GitHub API.
// This is how CLI/server agents talk to browser peers when WebRTC isn't available.

const Bridge = {
  active: false,
  issueUrl: null,   // e.g. "https://api.github.com/repos/teslasolar/gridlock/issues/1/comments"
  owner: null,
  repo: null,
  issueNumber: null,
  token: null,       // optional GitHub PAT for posting
  lastSeen: null,    // ISO timestamp of last seen comment
  pollInterval: null,
  onMessage: null,   // callback(msg) when new comment arrives
  seenIds: new Set(),

  // Start polling a GitHub issue for comments
  start(owner, repo, issueNumber, token) {
    this.owner = owner;
    this.repo = repo;
    this.issueNumber = issueNumber;
    this.token = token || null;
    this.issueUrl = `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/comments`;
    this.active = true;
    this.seenIds.clear();
    this.lastSeen = new Date().toISOString();

    console.log(`[bridge] started polling ${owner}/${repo}#${issueNumber}`);

    // Initial fetch to get existing comments
    this._poll(true);

    // Poll every 5 seconds
    this.pollInterval = setInterval(() => this._poll(false), 5000);
  },

  stop() {
    this.active = false;
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    console.log('[bridge] stopped');
  },

  async _poll(initial) {
    if (!this.active) return;
    try {
      const url = initial
        ? `${this.issueUrl}?per_page=20&sort=created&direction=desc`
        : `${this.issueUrl}?since=${this.lastSeen}&sort=created&direction=asc`;

      const headers = { 'Accept': 'application/vnd.github.v3+json' };
      if (this.token) headers['Authorization'] = `token ${this.token}`;

      const res = await fetch(url, { headers });
      if (!res.ok) {
        console.warn('[bridge] poll failed:', res.status);
        return;
      }

      const comments = await res.json();
      const toShow = initial ? comments.reverse().slice(-10) : comments;

      for (const c of toShow) {
        if (this.seenIds.has(c.id)) continue;
        this.seenIds.add(c.id);

        const msg = {
          from: `gh:${c.user.login}`,
          name: c.user.login,
          text: c.body,
          timestamp: new Date(c.created_at).getTime(),
          bridge: true
        };

        if (this.onMessage) this.onMessage(msg);
        this.lastSeen = c.created_at;
      }
    } catch (e) {
      console.warn('[bridge] poll error:', e.message);
    }
  },

  // Post a message to the GitHub issue
  async post(text, authorName) {
    if (!this.active || !this.token) {
      console.warn('[bridge] cannot post: no token or bridge not active');
      return false;
    }
    try {
      const body = `**${authorName}** (via GRIDLOCK):\n\n${text}`;
      const res = await fetch(this.issueUrl, {
        method: 'POST',
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'Authorization': `token ${this.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ body })
      });
      if (!res.ok) {
        console.warn('[bridge] post failed:', res.status);
        return false;
      }
      return true;
    } catch (e) {
      console.warn('[bridge] post error:', e.message);
      return false;
    }
  }
};

export default Bridge;
